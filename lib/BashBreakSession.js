import { BreakSession } from './BreakSession';

import C                     from 'constants';
import fs                    from 'fs';
import net                   from 'net';
import path                  from 'path';
import json5                 from 'json5';
import { execFile }          from 'child_process';
import { Readable,Writable } from 'stream';
import { DebuggerSocket }    from './DebuggerSocket';


export class BashBreakSession extends BreakSession
{
	constructor(debuggedProcess, sessionPipe, breakLocation) {
		super(debuggedProcess, breakLocation);
		this.sessionPipe   = sessionPipe;

		// pipe that we use to write to the bash PID
		this.toScriptPipe = fs.createWriteStream(this.sessionPipe+'-toScript', {flags:'a'})

		// pipe that we will listen to
		this.msgBuf = "";
		this.fromScriptPipe = fs.createReadStream(this.sessionPipe+'-fromScript', {autoClose:false});
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
		console.log("BashBreakSession data=", data.toString());
		this.msgBuf += data.toString();
		var match;
		while (match = this.msgBuf.match(/(?<firstMsg>^.*)\n\n(?<leftOvers>.*)/s)) {
			this.msgBuf = (match.groups.leftOvers)?match.groups.leftOvers:"";
			this.onMsgReceived(match.groups.firstMsg);
		}
	}

	onMsgReceived(msg) {
		console.log("BashBreakSession msg received=", msg);
		var cmd = msg.replace(/\s.*$/s, '');
		var args = msg.replace(new RegExp("^"+cmd+"\s*"),""); args = args.replace(/^[[:space:]]*/,"");
		console.log("BashBreakSession::onMsgReceived cmd=", cmd, "args=",args);
		switch (cmd) {
			case 'leave': this.destroy(); break;
			case 'stack':
				this.stack = json5.parse(args);
				this.debuggedProcess.plugin.onDepChanged();
				console.log("stack=",this.stack);
			default:
		}
	}

	onFromScriptEnd() {
		console.log("onFromScriptEnd");
		this.destroy();
	}

	stepInto() {this.toScriptPipe.write("stepInto\n");}
	stepOver() {this.toScriptPipe.write("stepOver\n");}
	stepOut()  {this.toScriptPipe.write("stepOut\n");}
	resume()   {this.toScriptPipe.write("resume\n");}
}
