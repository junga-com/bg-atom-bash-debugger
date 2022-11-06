import {
	BGError,
}                            from 'bg-atom-utils';
import { BreakSession }      from './BreakSession';
import { DebuggerSocket }    from './DebuggerSocket';

import json5                 from 'json5';


export class BashBreakSession extends BreakSession
{
	constructor(debuggedProcess, sessionPipe, breakLocation) {
		super(debuggedProcess, breakLocation.pid, breakLocation);
		this.sessionPipe   = sessionPipe;

		this.sockToScript = new DebuggerSocket(this.sessionPipe+'-fromScript', this.sessionPipe+'-toScript');
		this.sockToScript.addDep(this);
		//console.log("BrkSes create: "+this.pid+","+this.sessionPipe);
	}

	onDestroy() {
		//console.log("BrkSes destroy: "+this.pid+","+this.sessionPipe);
		this.sockToScript.destroy();
	}

	onSocketMsg(msg) {
		//console.log("BrkSes: "+this.pid+" msg received=", msg);
		// TODO: debounce the onDepChanged and call it after every msg.
		switch (msg.cmd) {
			case 'pstree':
				this.pstree = msg.argsRaw;
			break;

			case 'stack':
				if (msg.argsRaw)
					this.setStack(json5.parse(msg.argsRaw));
				else
					this.setStack([]);
				this.debuggedProcess.plugin.onDepChanged("stack");
			break;

			case 'vars':
				var vars = [];
				if (msg.argsRaw)
					vars = json5.parse(msg.argsRaw);
				this.setVars(vars);
			break;

			case 'leave': this.destroy(); break;

			default:
		}
	}

	// this gets called when the DebugSocket gets closed by the remote end
	onSocketEnd() {
		this.destroy()
	}

	async stepInto() { this.sockToScript.writeMsg("stepIn");   return this.debuggedProcess.waitForNextBreakSession(this.id);}
	async stepOver() { this.sockToScript.writeMsg("stepOver"); return this.debuggedProcess.waitForNextBreakSession(this.id);}
	async stepOut()  { this.sockToScript.writeMsg("stepOut");  return this.debuggedProcess.waitForNextBreakSession(this.id);}
	async resume()   { this.sockToScript.writeMsg("resume");   return this.debuggedProcess.waitForNextBreakSession(this.id);}

	// TODO: these have not yet been implemented
	// async stepOutToFrmNum(frmNum)      {}
	// async stepToLocation(locationSpec) {}

	async requestFrmVars(frmNum) { this.sockToScript.writeMsg("getFrmVars "+frmNum);    return this.debuggedProcess.waitForNextBreakSession(this.id);}
}
