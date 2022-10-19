import { DebuggedProcess }   from './DebuggedProcess';
import { GdbBreakSession }   from './GdbBreakSession';
import { DebuggerSocket }    from './DebuggerSocket';
import {BufferedProcess}     from 'atom';

// GdbDebuggedProcess coresponds to a 'inferior' or 'thread-group' being debugged by the gdb debugger.
// It is launched by the GdbTarget class which is an internal class to the Gdb class wrapper over a running gdb process.
export class GdbDebuggedProcess extends DebuggedProcess
{
	constructor(gdb, pid, thrGrpID, thrID) {
		super(gdb.plugin, pid, null, pid);
		this.thrGrpID = thrGrpID;
		this.startType = "attached"
		this.thrIDs = new Set();
		this.libs = new Map();
		this.gdb = gdb;

		// gdb needs to look us up by either pid or thrGrpID
		if (pid)
			this.gdb.targets.set(pid, this);
		if (thrGrpID)
			this.gdb.targets.set(thrGrpID, this);

		// register with the debugging UI
		this.plugin.addDebuggedProcess(this);
	}

	onDestroy() {
	}

	// usage: addThr(thrID)
	addThr(thrID) {
		this.thrIDs.add(thrID);
		this.gdb.targets.set("THR:"+thrID, this);
	}

	// from the 'thread-exited' gdb msg
	thrExit(thrID) {
		for (var [key,brkSes] of this.breakSessions) {
			if (brkSes.thrID == thrID) {
				brkSes.destroy()
			}
		}
		this.thrIDs.delete(thrID);
		this.gdb.targets.delete("THR:"+thrID);
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
		this.addBreakSession(new GdbBreakSession(this, breakLocation, data));
	}


	// usage: onLeave(thrID)
	// when the user steps or resumes we 'leave' the breakSession
	// Params:
	//    <thrID> : default is 'all'. Identifies which thread(s) has(ve) continued.
	onLeave(thrID) {
		for (var [key,brkSes] of this.breakSessions) {
			if (!thrID || (thrID=="all") || brkSes.thrID == thrID) {
				brkSes.destroy()
			}
		}
	}

	// usage: exit()
	// This is a user action that terminates the debugging session. Depending on how the DebuggedProcess was started it may or
	// may not leave it running without the debugger
	exit() {
		if (this.startType=="attached")
			this.gdb.sendCmd("-target-detach "+this.pid)
	}
}
