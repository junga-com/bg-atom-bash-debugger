import {
	BGError,
}                            from 'bg-atom-utils';
import { DebuggedProcess }   from './DebuggedProcess';
import { BashBreakSession }  from './BashBreakSession';
import { DebuggerSocket }    from './DebuggerSocket';

export class BashDebuggedProcess extends DebuggedProcess
{
	constructor(plugin, name, pid, processPipe) {
		super(plugin, "bash:"+pid, name, pid);
		this.processPipe   = processPipe;

		this.sockToScript = new DebuggerSocket(this.processPipe+'-fromScript', this.processPipe+'-toScript');
		this.sockToScript.addDep(this);
	}

	onDestroy() {
		this.sockToScript.destroy();
	}

	isOurEditor(textEditor,grammar)
	{
		return grammar.scopeName == "source.shell"
	}

	// TODO: make breakpoints work in bash debugger
	async renderBreakpoint(breakpoint) {}
	async unrenderBreakpoint(breakpoint) {}


	onEnter(msg)
	{
		var breakLocation = {
			topPID: msg.args[1],
			pid:    msg.args[2],
			file:   msg.args[3],
			line:   parseInt(msg.args[4]),
			cmd:    msg.args.slice(5).join(" ")
		}
		this.addBreakSession(new BashBreakSession(this, msg.args[0], breakLocation));
	}

	// this gets called when the DebugSocket gets closed by the remote end
	onSocketEnd() {
		this.destroy()
	}

	// ask the target script to exit
	exit() {
		this.sockToScript.writeMsg('exit');
	}

	onSocketMsg(msg) {
		//console.log("BashDebuggedProcess msg received=", msg);
		switch (msg.cmd) {
			case 'enter':
				this.onEnter(msg)
			break;

			// goodbyeFrom is the mate of helloFrom and signifies that the debugger is detaching from the debugged process
			case 'goodbyeFrom':
				atom.notifications.addInfo("The '"+this.name+"' script has disconnected from the debugger")
				this.destroy()
			break;

			// 'scriptEnded' is simillar to 'goodbyeFrom'. Its sent from the exit trap of the debugged process
			case 'scriptEnded':
				atom.notifications.addInfo("The '"+this.name+"' script has ended")
				this.destroy()
			break;

			// attachToGdb
			case 'attachToGdb':
				let pid = parseInt(msg.args[0]);
				let functionToStopIn = msg.args[1];
				this.gdb.attachBash(pid, functionToStopIn)
					.then((theDebugged)=>{
						console.log("attachToGdb: attach cmd succeeded",theDebugged);
					})
					.catch((msg)=>{
						console.error("error while gdb attaching to process '"+pid+"'", msg );
						atom.notifications.addError("error while gdb attaching to process '"+pid+"'")
					})
			break;


			default:
				if (this.activeBreakSession)
					this.activeBreakSession.onSocketMsg(msg);
		}
	}
}
