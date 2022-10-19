import json5                 from 'json5';

import { BreakSession }      from './BreakSession';
import { DebuggerSocket }    from './DebuggerSocket';


export class BashBreakSession extends BreakSession
{
	constructor(debuggedProcess, sessionPipe, breakLocation) {
		super(debuggedProcess, breakLocation);
		this.sessionPipe   = sessionPipe;

		this.sockToScript = new DebuggerSocket(this.sessionPipe+'-fromScript', this.sessionPipe+'-toScript');
		this.sockToScript.addDep(this);
		console.log("BrkSes create: "+this.pid+","+this.sessionPipe);
	}

	onDestroy() {
		console.log("BrkSes destroy: "+this.pid+","+this.sessionPipe);
		this.sockToScript.destroy();
	}

	onSocketMsg(msg) {
		//console.log("BrkSes: "+this.pid+" msg received=", msg);
		// TODO: debounce the onDepChanged
		switch (msg.cmd) {
			case 'traps':
				this.traps = json5.parse(msg.argsRaw);
			break;

			case 'pstree':
				this.pstree = msg.argsRaw;
			break;

			case 'stack':
				this.setStack(json5.parse(msg.argsRaw));
				this.debuggedProcess.plugin.onDepChanged("stack");
			break;

			case 'vars':
				this.vars = json5.parse(msg.argsRaw);
			break;

			case 'leave': this.destroy(); break;

			default:
		}
	}

	// this gets called when the DebugSocket gets closed by the remote end
	onSocketEnd() {
		this.destroy()
	}

	stepInto() {this.sockToScript.writeMsg("stepIn");}
	stepOver() {this.sockToScript.writeMsg("stepOver");}
	stepOut()  {this.sockToScript.writeMsg("stepOut");}
	resume()   {this.sockToScript.writeMsg("resume");}

	requestFrmVars(frmNum) {this.sockToScript.writeMsg("getFrmVars "+frmNum);}

}
