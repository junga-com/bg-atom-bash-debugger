import { DebuggedProcess }   from './DebuggedProcess';
import { GdbBreakSession }   from './GdbBreakSession';
import { DebuggerSocket }    from './DebuggerSocket';
import {BufferedProcess}     from 'atom';

// GdbDebuggedProcess coresponds to a 'inferior' or 'thread-group' being debugged by the gdb debugger.
// It is launched by the GdbTarget class which is an internal class to the Gdb class wrapper over a running gdb process.
export class GdbDebuggedProcess extends DebuggedProcess
{
	constructor(plugin, pid, gdb, startType) {
		super(plugin, null, pid);
		this.gdb = gdb;
		this.startType = startType || "attached"
	}

	onDestroy() {
	}

	onLeave(thrID) {
		for (var [key,brkSes] of this.breakSessions) {
			if (!thrID || (thrID=="all") || brkSes.thrID == thrID) {
				brkSes.destroy()
			}
		}
	}

	exit() {
		if (this.startType=="attached")
			this.gdb.sendCmd("-target-detach "+this.pid)
	}

	thrExit(thrID) {
		for (var [key,brkSes] of this.breakSessions) {
			if (brkSes.thrID == thrID) {
				brkSes.destroy()
			}
		}
	}
}
