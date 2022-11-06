import {
	BGError,
}                            from 'bg-atom-utils';
import { BreakSession }      from './BreakSession';
import { DebuggerSocket }    from './DebuggerSocket';
import { StackFrame }        from './StackFrame';

import json5                 from 'json5';


// GdbBreakSession represents a stopped thread in the gdb debugger.
export class GdbBreakSession extends BreakSession
{
	constructor(debuggedProcess, breakLocation, data) {
		super(debuggedProcess, breakLocation.pid, breakLocation);
		this.data = data;
		this.thrID = data["thread-id"];
		this.gdb = this.debuggedProcess.gdb;
		this.requestFrmStack();
	}

	onDestroy() {
	}

	isOurEditor(textEditor,grammar)
	{
		return this.grammar.scopeName == "source.shell"
	}

	async stepInto()          {this.gdb.sendCmd("-exec-step     --thread "+this.thrID);     return this.debuggedProcess.waitForNextBreakSession(this.id); }
	async stepOver()          {this.gdb.sendCmd("-exec-next     --thread "+this.thrID);     return this.debuggedProcess.waitForNextBreakSession(this.id); }
	async stepOut()           {this.gdb.sendCmd("-exec-finish   --thread "+this.thrID);     return this.debuggedProcess.waitForNextBreakSession(this.id); }
	async resume()            {this.gdb.sendCmd("-exec-continue --thread "+this.thrID);     return this.debuggedProcess.waitForNextBreakSession(this.id); }
	async stepOutToFrmNum(frmNum) {this.gdb.sendCmd("python stepOutToFrmNum("+frmNum+")");  return this.debuggedProcess.waitForNextBreakSession(this.id); }

	async stepToLocation(locationSpec)
	{
		var bp = null;
		var match = null;

		if (match = /^frmShFunc:(?<offset>[-+][0-9]+)?\s*(?<shCmdPrefix>.*)$/.exec(locationSpec) ) {
			var {offset, shCmdPrefix} = match.groups

			// since we need to access the stack, wait for all the initialization to be done
			await this.waitForSettled()

			var frmNum = 0
			for (var i in this.stack) {
				if (RegExp("SH_CMD:\\s+"+shCmdPrefix).test(this.stack[i].caller))
					frmNum = i;
			}
			if (frmNum == 0)
			 	throw Error("GdbBreakSession::stepToLocation('"+locationSpec+"') failed to match any frame on the stack", this.stack)
			var targetFrm = frmNum + parseInt(offset)
			this.gdb.sendCmd("python stepOutToFrmNum("+(frmNum)+")")
		}

		else if (match = /^afterDEBUGTrap:(?<offset>[-+][0-9]+)?$/.exec(locationSpec) ) {
			var {offset} = match.groups

			// the "running_trap!=66" means "not in the DEBUG trap"
			// 65 is DEBUG's id but running_trap is set to (id+1) (so that 0(false) is no trap (ERROR==0))
			// The DEBUG's id can change from platorm to platform. Its recorded in a #define which is not always in the debug symbols
			// See trap.h where DEBUG is defined as NSIG (seems like DEBUG is one more than is seems it should be)
			// Use this in the js console to check actual values at runtime
			//       await gdb.sendCmd("py print(gdb.parse_and_eval('signal_names[65]'))")
			bp = await this.debuggedProcess.addBreakpoint(new Breakpoint(locationSpec+" -t -c running_trap!=66"))
			console.log("attachBash: added temp bp to stop at ",bp);
			if (bp && bp.id)
				this.debuggedProcess.resume()
		}

		// if this function does not recognize <locationSpec>, then pass it off to Breakpoint(<locationSpec>)
		else if (locationSpec) {
			// the "running_trap!=66" means "not in the DEBUG trap"
			// 65 is DEBUG's id but running_trap is set to (id+1) (so that 0(false) is no trap (ERROR==0))
			// The DEBUG's id can change from platorm to platform. Its recorded in a #define which is not always in the debug symbols
			// See trap.h where DEBUG is defined as NSIG (seems like DEBUG is one more than is seems it should be)
			// Use this in the js console to check actual values at runtime
			//       await gdb.sendCmd("py print(gdb.parse_and_eval('signal_names[65]'))")
			bp = await this.debuggedProcess.addBreakpoint(new Breakpoint(locationSpec+" -t -c running_trap!=66"))
			console.log("attachBash: added temp bp to stop at ",bp);
			if (bp && bp.id)
				this.debuggedProcess.resume()
		}

		return this.debuggedProcess.waitForNextBreakSession(this.id);
	}


	async requestFrmStack() {
		var msg = await this.gdb.sendCmd("-stack-list-frames");
		var stack = [];
		for (var gdbFrame of msg.data.stack) {
			gdbFrame = gdbFrame.value;
			stack.push(new StackFrame(this, {
				cmdFile:   gdbFrame.file,
				cmdLineNo: gdbFrame.line,
				cmdLoc:    (gdbFrame.file)?gdbFrame.file.replace(/^.*\//,"")+"("+gdbFrame.line+")":"<error>",
				caller:    gdbFrame.func,
				cmdLine:   "",
				level:     gdbFrame.level,
				gdbFrm:    gdbFrame
			}))
		}
		this.setStack(stack);
	}

	// TODO: I think that we should store the args and locals in their stack frame instead of overwriting each time we select another frame.
	//       then we could also retrieve them only if they have not yet been retrieved
	async requestFrmVars(frmNum) {
		var vars = [];

		var msg = await this.gdb.sendCmd("-stack-list-arguments --thread "+this.thrID+" 2 "+frmNum+" "+frmNum);
		var stkFrmArgs = msg.data["stack-args"][0].value.args;
		for (var i in stkFrmArgs) {
			stkFrmArgs[i].scope="arg"
			vars.push(stkFrmArgs[i]);
		}

		msg = await this.gdb.sendCmd("-stack-list-locals --thread "+this.thrID+" --frame "+frmNum+" 2");
		for (var i in msg.data.locals) {
			msg.data.locals[i].scope="local"
			vars.push(msg.data.locals[i]);
		}

		this.setVars(vars);
	}

}
