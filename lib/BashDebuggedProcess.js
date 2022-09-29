import { DebuggedProcess }   from './DebuggedProcess';
import { BashBreakSession }  from './BashBreakSession';
import { DebuggerSocket }    from './DebuggerSocket';

export class BashDebuggedProcess extends DebuggedProcess
{
	constructor(plugin, name, pid, processPipe) {
		super(plugin, name, pid);
		this.processPipe   = processPipe;

		this.sockToScript = new DebuggerSocket(this.processPipe+'-fromScript', this.processPipe+'-toScript');
		this.sockToScript.addDep(this);
	}

	onDestroy() {
		this.sockToScript.destroy();
	}

	// this gets called when the DebugSocket gets closed by the remote end
	onSocketEnd() {
		this.destroy()
	}

	onSocketMsg(msg) {
		console.log("BashDebuggedProcess msg received=", msg);
		switch (msg.cmd) {
			case 'enter':
				var breakLocation = {
					topPID: msg.args[1],
					pid:    msg.args[2],
					file:   msg.args[3],
					line:   parseInt(msg.args[4]),
					cmd:    msg.args.slice(5)
				}
				this.activeBreakSession = new BashBreakSession(this, msg.args[0], breakLocation);
				this.breakSessions[breakLocation.pid] = this.activeBreakSession;
				break;

			case 'leave': this.destroy(); break;

			default:
				if (this.activeBreakSession)
					this.activeBreakSession.onMsgReceived(msg);
		}
	}

	stepInto() {if (this.activeBreakSession) this.activeBreakSession.stepInto();}
	stepOver() {if (this.activeBreakSession) this.activeBreakSession.stepOver();}
	stepOut()  {if (this.activeBreakSession) this.activeBreakSession.stepOut();}
	resume()   {if (this.activeBreakSession) this.activeBreakSession.resume();}
}
