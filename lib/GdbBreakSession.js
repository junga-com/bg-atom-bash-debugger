import json5                 from 'json5';

import { BreakSession }      from './BreakSession';
import { DebuggerSocket }    from './DebuggerSocket';


// GdbBreakSession represents a stopped thread in the gdb debugger.
export class GdbBreakSession extends BreakSession
{
	constructor(debuggedProcess, breakLocation, data) {
		super(debuggedProcess, breakLocation);
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

	stepInto() {this.gdb.sendCmd("-exec-step     --thread "+this.thrID);}
	stepOver() {this.gdb.sendCmd("-exec-next     --thread "+this.thrID);}
	stepOut()  {this.gdb.sendCmd("-exec-finish   --thread "+this.thrID);}
	resume()   {this.gdb.sendCmd("-exec-continue --thread "+this.thrID);}

	async requestFrmStack() {
		var msg = await this.gdb.sendCmd("-stack-list-frames");
		var stack = [];
		for (var gdbFrame of msg.data.stack) {
			gdbFrame = gdbFrame.value;
			stack.push({
				cmdFile:   gdbFrame.file,
				cmdLineNo: gdbFrame.line,
				cmdLoc:    (gdbFrame.file)?gdbFrame.file.replace(/^.*\//,"")+"("+gdbFrame.line+")":"<error>",
				caller:    gdbFrame.func,
				cmdLine:   "",
				level:     gdbFrame.level,
				gdbFrm:    gdbFrame
			})
		}
		this.setStack(stack);
	}

	async requestFrmVars(frmNum) {
		var vars = [];
		var msg = await this.gdb.sendCmd("-stack-list-arguments --thread "+this.thrID+" 2 "+frmNum+" "+frmNum);
		var stkFrmArgs = msg.data["stack-args"][0].value.args;
		for (var i in stkFrmArgs) {
			stkFrmArgs[i].scope="arg"
			vars.push(stkFrmArgs[i]);
		}

		msg = await this.gdb.sendCmd("-stack-list-locals --thread "+this.thrID+" --frame "+frmNum+" 2");

		var stkFrm = this.stack[this.currentFrame];

		for (var i in msg.data.locals) {
			msg.data.locals[i].scope="local"
			vars.push(msg.data.locals[i]);
		}

		//console.log("!!!!VARS",vars);
		this.setVars(vars);
	}

}
