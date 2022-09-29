import { DebuggedProcess } from './DebuggedProcess';

import C                     from 'constants';
import fs                    from 'fs';
import net                   from 'net';
import path                  from 'path';
import json5                 from 'json5';
import { execFile }          from 'child_process';
import { Readable,Writable } from 'stream';
import { BashBreakSession }  from './BashBreakSession';
import { DebuggerSocket }    from './DebuggerSocket';

export class BashDebuggedProcess extends DebuggedProcess
{
	constructor(plugin, name, pid, processPipe) {
		super(plugin, name, pid);
		this.processPipe   = processPipe;

		// pipe that we use to write to the bash PID
		this.toScriptPipe = fs.createWriteStream(this.processPipe+'-toScript', {flags:'a'})

		// pipe that we will listen to
		this.msgBuf = "";
		this.fromScriptPipe = fs.createReadStream(this.processPipe+'-fromScript', {autoClose:false});
		this.fromScriptPipe.on('data',(data)=>this.onFromScriptData(data));
		this.fromScriptPipe.on('end',()=>this.onFromScriptEnd());
	}

	onDestroy() {
		this.toScriptPipe.close();
		this.toScriptPipe = null;
		this.fromScriptPipe.removeAllListeners('end'); // supress the onFromScriptEnd() method being called when we remove the pipe
		this.fromScriptPipe.close();
		this.fromScriptPipe = null;
	}

	onFromScriptData(data) {
		console.log("BashDebuggedProcess data=", data.toString());
		this.msgBuf += data.toString();
		var match;
		while (match = this.msgBuf.match(/(?<firstMsg>^.*)\n\n(?<leftOvers>.*)?$/s)) {
			this.msgBuf = (match.groups.leftOvers)?match.groups.leftOvers:"";
			this.onMsgReceived(match.groups.firstMsg);
		}
	}

	onMsgReceived(msg) {
		console.log("BashDebuggedProcess msg received=", msg);
		var cmd = msg.replace(/\s.*$/s, '');
		var args = msg.replace(new RegExp("^"+cmd+"\\s*"),"");
		console.log("BashDebuggedProcess::onMsgReceived cmd=", cmd, "args=",args);
		switch (cmd) {

			case 'enter':
				args = args.split(' ');
				var breakLocation = {
					topPID: args[1],
					pid: args[2],
					file: args[3],
					line: parseInt(args[4]),
					cmd: args.slice(5)
				}
				this.activeBreakSession = new BashBreakSession(this, args[0], breakLocation);
				this.breakSessions[breakLocation.pid] = this.activeBreakSession;
				break;

			case 'leave': this.destroy(); break;

			default:
				if (this.activeBreakSession)
					this.activeBreakSession.onMsgReceived(msg);
		}
	}

	// this gets called when the pipe gets closed
	onFromScriptEnd() {
		console.log("onFromScriptEnd");
		this.destroy();
	}

	stepInto() {if (this.activeBreakSession) this.activeBreakSession.stepInto();}
	stepOver() {if (this.activeBreakSession) this.activeBreakSession.stepOver();}
	stepOut()  {if (this.activeBreakSession) this.activeBreakSession.stepOut();}
	resume()   {if (this.activeBreakSession) this.activeBreakSession.resume();}
}
