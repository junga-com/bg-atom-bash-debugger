import {BufferedProcess}     from 'atom';
import {BGPromise}           from 'bg-atom-utils';
import {GdbMi3Msg}           from './GdbMi3Msg';
import {GdbDebuggedProcess}  from './GdbDebuggedProcess';
import {GdbBreakSession}     from './GdbBreakSession';

// TODO: maybe this should be replaced with GdbDebuggedProcess directly
// GdbTarget represents a process being debugged by the gdb debugger.
// Gdb's terminology is not that consistent. This is also refered to as an 'inferior' or a thread group whose type is 'process'
// This class is an internal helper class for the Gdb class that helps it keep track of its state. This class will spawn an instance
// of GdbDebuggedProcess which is the class used by the bg-atom-bash-debugger atom package to represent the same thing. The gdb
// documentation is a bit ambiguous so its not clear yet if there will always be a 1:1 between instances of these two classes.
class GdbTarget {
	constructor(gdb, pid, thrGrpID, thrID) {
		this.debugger = null;
		this.thrIDs = new Set();
		this.libs = new Map();
		this.gdb = gdb;
		this.addInfo(pid, thrGrpID, thrID);
	}

	destroy() {
		if (this.debugger)
			this.debugger.destroy();
	}

	addInfo(pid, thrGrpID, thrID) {
		if (!this.pid && pid) {
			this.pid = pid;
			this.gdb.targets.set(pid, this);
			this.debugger = new GdbDebuggedProcess(this.gdb.plugin, pid, this.gdb);
			this.gdb.plugin.addDebuggedProcess(this.debugger);
		}
		if (!this.thrGrpID && thrGrpID) {
			this.thrGrpID = thrGrpID;
			this.gdb.targets.set(thrGrpID, this);
		}
		if (thrID && !this.thrIDs.has(thrID)) {
			this.thrIDs.add(thrID);
			this.gdb.targets.set("THR:"+thrID, this);
		}
	}

	// when a breakpoint hits we 'enter' a breakSession
	async onEnter(data) {
		var breakLocation = {
			topPID: this.pid,
			pid:    this.pid,
			file:   data.frame.fullname,
			line:   parseInt(data.frame.line),
			cmd:    ""
		}
		this.debugger.addBreakSession(new GdbBreakSession(this.debugger, breakLocation, data));
	}

	// when the user steps or resumes we 'leave' the breakSession
	onLeave(thrID) {
		this.debugger.onLeave(thrID);
	}

	thrExit(thrID) {
		this.debugger.thrExit(thrID);
	}
}


// Gdb wraps a running instance of the gdb debugger.
// The architecture of gdb allows one instance to debug multiple process simultaneously so typically one global instance of Gdb
// can be a service to both launch new processes for debugging and also attach to running processes.
// The use case that this was written for is being able to attach to and step through bash source code while debugging a bash script
// with the bg-atom-bash-debugger atom package.
export class Gdb {
	constructor(plugin) {
		this.plugin = plugin;
		this.logMsg = false;
		this.outstandingCmds = [];
		this.targets = new Map();

		this.gdbProcess = new BufferedProcess({
			command: 'gdb',
			args:    ['-quiet','--interpreter=mi3'],
			stdout:  (data)=>this.onDbgStdout(data),
			stderr:  (data)=>this.onDbgStdErr(data),
			exit:    (data)=>this.onDbgExit(data),
		});
		global.gdb = this; // for manual inspection

		// mi-async means it will try to process commands while the target is running instead of blocking until the process stops
		this.sendCmd("-gdb-set mi-async on"); // this state var was called 'target-async' in gdb 7.7 and earlier

		// detach-on-fork off means that it will allow debugging both the parent and child as separate inferiors after a fork
		this.sendCmd("-gdb-set detach-on-fork off");

		this.bashPath = process.env.bgBashPath || "/home/bobg/github/bashParse/bash"
	}

	destroy() {
		deps.objectDestroyed(this);
	}

	// testing -- not yet used
	async sync() {
		var msg = await this.sendCmd('-list-thread-groups');
		for (var thrGrp of msg.data.groups) {
			console.log(thrGrp);
		}

		var msg = await this.sendCmd('-list-inferiors');

	}

	attachBash(pid) {
		var p = this.sendCmd("-target-attach "+pid);
		deps.fire({obj:this,channel:'attachBash'}, pid);
		return p;
	}

	// this handles the exec async msgs coming from the gdbProcess
	// exec msgs inform us of the running state changes of threads (e.g. enterBreak is the 'stopped' msg)
	onExec(msg) {
		switch (msg.class) {
			case 'stopped':
				var target = this.getTarget(null, null, msg.data["thread-id"]);
				target.onEnter(msg.data);
			break;

			case 'running':
				if (msg.data["thread-id"] == "all") {
					for (var [key,target] of this.targets) {
						target.onLeave();
					}
				} else
					console.log("UNHANDLED: "+msg.type+" "+msg.class, msg.data);
			break;

			default:
				console.log("UNHANDLED: "+msg.type+" "+msg.class, msg.data);
		}
	}

	onNotify(msg) {
		switch (msg.class) {
			case 'thread-group-started':
				var target = this.getTarget(msg.data.pid, msg.data.id);
			break;

			case 'thread-group-exited':
				var target = this.getTarget(msg.data.pid, msg.data.id);
				target.destroy(true);
			break;

			case 'thread-created':
				var target = this.getTarget(null, msg.data["group-id"]);
				target.addInfo(null, null, msg.data.id);
			break;

			case 'thread-exited':
				var target = this.getTarget(null, msg.data["group-id"]);
				target.thrExit(msg.data.id);
			break;

			case 'library-loaded':
				var target = this.getTarget(null, msg.data["thread-group"]);
				target.libs.set(msg.data.id, msg.data)
			break;

			case 'library-unloaded':
				var target = this.getTarget(null, msg.data["thread-group"]);
				target.libs.delete(msg.data.id)
			break;

			default:
				console.log("UNHANDLED: "+msg.type+" "+msg.class, msg.data);
		}
	}

	onStatus(msg) {
		console.log(msg.type+" "+msg.class, msg.data);
	}

	dispatchMsgFromGdb(msg) {
		switch (msg.type) {
			case 'result':
				if (this.outstandingCmds.length == 0)
					console.error("Gdb: unmatched cmd result received. (there is no cmd on the outstandingCmds queue)");
				var cmdObj = this.outstandingCmds.shift();
				if (!msg.error)
					cmdObj.promise.resolve(msg);
				else
					cmdObj.promise.reject(msg);
			break;

			case 'exec':   this.onExec(msg);    break;
			case 'notify': this.onNotify(msg);  break;
			case 'status': this.onStatus(msg);  break;

			case 'console':
			case 'targetOut':
			case 'log':
				console.log(msg.type, msg.data);
				break;
		}
	}

	sendCmd(command, resolveFn, rejectFn) {
		if (this.logMsg) console.log(("gdb > ",command));
		var p = new BGPromise().then(resolveFn, rejectFn);
		this.outstandingCmds.push({cmd:command,promise:p});
		this.gdbProcess.process.stdin.write(command+"\n");
		return p;
	}

	onDbgStdout(data) {
		//console.log(data);
		for (var line of data.split("\n")) if (line) {
			var msg = new GdbMi3Msg(line);
			if (this.logMsg) {
				(msg.error) ?
					console.error("gdb < ",msg)
					: console.log("gdb < ",msg);
			}
			this.dispatchMsgFromGdb(msg);
		}
	}

	onDbgStdErr(data) {
		console.log(("gdb < (err) ",data));
	}

	onDbgExit(exitCode) {
		console.log("gdb process has ended exitCode=",exitCode);
	}

	// usage: getTarget(<pid>, <thrGrpID>, <thrID>)
	// return the taget object indexed by one of the arguments.
	// A target is aka inferior. It represents a pid being debugged
	// the cardinality between pid and thrGrp is not clear in the docs. for bash it seems to be 1:1 but time will tell.
	getTarget(pid, thrGrpID, thrID) {
		var target = null;
		if (pid || thrGrpID || thrID) {
			target = this.targets.get(pid || thrGrpID || "THR:"+thrID);
			if (!target) target = this.targets.get(thrGrpID || "THR:"+thrID);
			if (!target) target = this.targets.get("THR:"+thrID);
			if (!target) {
				target = new GdbTarget(this, pid, thrGrpID, thrID);
			}
		}
		return target;
	}
}
