import {
	BGError,
	BGPromise,
	debounce
}                              from 'bg-atom-utils';
import {GdbMi3Msg}             from './GdbMi3Msg';
import {GdbDebuggedProcess}    from './GdbDebuggedProcess';
import {GdbBreakSession}       from './GdbBreakSession';
import {
	Breakpoint,
	BreakpointLine,
	BreakpointFunc }           from './Breakpoints.js'

import {BufferedProcess, File} from 'atom';
import fs                      from 'fs'


function bgtrace(msg) {
	msg = msg.replace(/\\n/g,"\n")
	msg = msg.replace(/\\t/g,"\t")
	if (! /\n$/.test(msg))
		msg += "\n"
	fs.appendFileSync('/tmp/bgtrace.out', msg)
}

// Gdb wraps a running instance of the gdb debugger.
// The architecture of gdb allows one instance to debug multiple process simultaneously so typically one global instance of Gdb
// can be a service to both launch new processes for debugging and also attach to running processes.
// The use case that this was written for is being able to attach to and step through bash source code while debugging a bash script
// with the bg-atom-bash-debugger atom package.
export class Gdb {
	static UpdateBreakpointState(bp, msg)
	{
		bp.impl = msg.data.bkpt
		bp.id = msg.data.bkpt.number

		// copy renderedLocs from the Mi3 msg
		// the Mi3 msg data is not consistant. if there is only one rendered location, its attributes are spread across
		// the breakpoint's attributes but if there are more that one they are in their own objects in the locations
		// array
		if (msg.data.bkpt.locations)
			bp.renderedLocs = msg.data.bkpt.locations
		else
			bp.renderedLocs.push({
				id       : msg.data.bkpt.number,
				file     : msg.data.bkpt.file || msg.data.bkpt.filename,
				fullname : msg.data.bkpt.fullname,
				func     : msg.data.bkpt.func,
				line     : msg.data.bkpt.line
			})
	}

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

		// this setting controls the 'file' attributes in frames.
		// by default, there was also a 'fullname' attribute with abs, but when I installed (even a do nothing) frame-filter,
		// the fullname was no longer included. I could not find out why but I found this setting. Now we get the full filename
		// from the 'file' attribute and strip the path for display.
		this.sendCmd("-gdb-set filename-display absolute");

		// set up logging to bgtrace
		// TODO: init bgtracing inside our gdbBash.py file using ENV var and configure both bgtrace and the log output
		this.sendCmd("-gdb-set logging file /tmp/bgtrace.out");
		//this.sendCmd("-gdb-set logging on");


		// 'detach-on-fork off' means that it will allow debugging both the parent and child as separate inferiors after a fork
		this.sendCmd("-gdb-set detach-on-fork on");
		this.sendCmd("-gdb-set follow-fork-mode parent");

		// '-enable-pretty-printing' opts in for the MI interface to use pretty-printers to affect the format
		this.sendCmd("-enable-pretty-printing");
		this.sendCmd("-enable-frame-filters");

		// get better error msgs for python exceptions
		this.sendCmd("-gdb-set python print-stack full");


		// load this init file into gdb and watch it for changes to reload
		// console.log('Your App Path: ' + app.getAppPath())
		// console.log('Your Remote Path: ' + remote.getAppPath())
		this.gdbBashFile = new File(this.plugin.pkgInfo.modulePath+"/gdbBash.py", false);
		if (this.gdbBashFile.existsSync()) {
			this.sendCmd("source "+this.gdbBashFile.getPath());
		} else {
			console.error("Woops. cant find gdbBash.py file at '"+this.plugin.pkgInfo.modulePath+"/gdbBash.py"+"'");
		}
		this.gdbBashFile.onDidChange(debounce(300, ()=>{

			this.sendCmd("source "+this.gdbBashFile.getPath())
		}));

		// we can launch a script using this bash path (not yet implemented)
		this.bashPath = process.env.bgBashPath
	}

	destroy() {
		deps.objectDestroyed(this);
	}

	// testing -- not yet used. the idea would be that we could refresh and fix any accumulated state errors
	async sync() {
		var msg = await this.sendCmd('-list-thread-groups');
		for (var thrGrp of msg.data.groups) {
			console.log(thrGrp);
		}

		var msg = await this.sendCmd('-list-inferiors');

	}

	// this was written to work with the bash script debugging integrations but its pretty generic and might work for general C/C++
	// program debugging
	async attachBash(pid, locationSpec,  resolveFn, rejectFn) {
		let p = new BGPromise(resolveFn, rejectFn)
		this.plugin.startChange()
		var resultMsg   = await this.sendCmd("-target-attach "+pid);
		let theDebugged = await this.plugin.getDebuggedProcessFor(pid,5000)
		var brkSession  = await theDebugged.waitForNextBreakSession()

		try {
			brkSession = await brkSession.stepToLocation(locationSpec);
		} catch(e) {
			console.error("error: attachBash: while advancing to locationSpec\n",e);
		}

		p.resolve(theDebugged)
		this.plugin.endChange()
		return p;
	}

	// this handles the exec async msgs coming from the gdbProcess
	// exec msgs inform us of the running state changes of threads (e.g. enterBreak is the 'stopped' msg)
	onExec(msg) {
		var target = null;
		switch (msg.class) {
			case 'stopped':
				target = this.getTarget("THR:"+msg.data["thread-id"]);
				if (target)
					target.onEnter(msg.data);
			break;

			case 'running':
				if (msg.data["thread-id"] == "all") {
					for (var [key,target] of this.targets) {
						target.onLeave();
					}
					return; // b/c this case does not set target but we handled it
				} else {
					target = this.getTarget("THR:"+msg.data["thread-id"]);
					if (target)
						target.onLeave(msg.data);
				}
			break;
		}
		if (!target)
			console.log("UNHANDLED: "+msg.type+" "+msg.class, msg.data);
	}

	onNotify(msg) {
		var target = null;
		switch (msg.class) {
			// the cardinality between pid and thrGrp is not clear in the docs. for bash it seems to be 1:1 but time will tell.
			// this msg when we attach to a bash pid contains only 'pid' and 'id' (thrGrpID) fields
			// before we attach, gdb sends a 'thread-group-added' msg for the thrGrp that is used in this msg
			case 'thread-group-started':
				target = new GdbDebuggedProcess(this, msg.data.pid, msg.data.id);
			break;

			case 'thread-group-exited':
				target = this.getTarget(msg.data.pid, msg.data.id);
				if (target)
					target.destroy(true);
			break;

			case 'thread-created':
				target = this.getTarget(msg.data["group-id"]);
				if (target)
					target.addThr(msg.data.id);
			break;

			case 'thread-exited':
				target = this.getTarget(msg.data["group-id"]);
				if (target)
					target.thrExit(msg.data.id);
			break;

			case 'library-loaded':
				target = this.getTarget(msg.data["thread-group"]);
				if (target)
					target.libs.set(msg.data.id, msg.data)
			break;

			case 'library-unloaded':
				target = this.getTarget(msg.data["thread-group"]);
				if (target)
					target.libs.delete(msg.data.id)
			break;

			case 'breakpoint-modified':
				// TODO: this might not handle some cases for bp with multiple locations. I dont know if gdb allows deleting just one location of a multiple
				for (var [dbgID, dbg] of this.plugin.debuggers)
					for (var bp of dbg.breakpoints)
						if (bp.id == msg.data.bkpt.number) {
							Gdb.UpdateBreakpointState(bp, msg);
						}
			break;

			case 'breakpoint-deleted':
				// TODO: this might not handle some cases for bp with multiple locations. I dont know if gdb allows deleting just one location of a multiple
				for (var [dbgID, dbg] of this.plugin.debuggers)
					for (var bp of dbg.breakpoints)
						if (bp.id == msg.data.id)
							dbg.removeBreakpoint(bp)
			break;
		}
		if (!target)
			console.log("UNHANDLED: "+msg.type+" "+msg.class, msg.data);
	}

	onStatus(msg) {
		console.log("UNHANDLED: "+msg.type+" "+msg.class, msg.data);
	}

	dispatchMsgFromGdb(msg) {
		switch (msg.type) {
			case 'result':
				//console.log("### pop",this.outstandingCmds);
				if (this.outstandingCmds.length == 0) {
					console.error(msg);
					throw Error("Gdb: unmatched cmd result received. (there is no cmd on the outstandingCmds queue)",msg);
				}
				var cmdObj = this.outstandingCmds.shift();
				if (!msg.error && msg.class!="error") {
					cmdObj.promise.resolve(msg);
				} else {
					cmdObj.promise.reject(msg);
				}
			break;

			case 'exec':   this.onExec(msg);    break;
			case 'notify': this.onNotify(msg);  break;
			case 'status': this.onStatus(msg);  break;

			case 'console':
			case 'targetOut':
			case 'log':
				bgtrace("<<<"+msg.type+">>>"+" "+msg.data);
				console.log("<<<"+msg.type+">>>"+" "+msg.data);
				break;
		}
	}

	sendCmd(command, resolveFn, rejectFn) {
		if (this.logMsg) console.log(("gdb > ",command));
		var p = new BGPromise().then(resolveFn, rejectFn);
		this.outstandingCmds.push({cmd:command,promise:p});
		//console.log("### push",this.outstandingCmds);
		this.gdbProcess.process.stdin.write(command+"\n");
		return p;
	}

	onDbgStdout(data) {
		//console.log(data);
		for (var line of data.split("\n")) if (line) {
			var msg = new GdbMi3Msg(line);
			if (this.logMsg && msg.type!="END" && msg.type!="console" && msg.type!="targetOut" && msg.type!="log") {
				(msg.error || msg.class=="error") ?
					console.error("gdb < ",msg.data.msg,msg)
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

	// usage: getTarget(<id1>, <id2>)
	// return the taget object indexed by one of the arguments.
	// A target is aka inferior. It represents a pid being debugged
	getTarget(id1, id2) {
		var target = this.targets.get(id1);
		if (!target) target = this.targets.get(id2);
		return target;
	}
}
