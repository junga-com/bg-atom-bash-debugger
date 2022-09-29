import fs                    from 'fs';
import net                   from 'net';
import path                  from 'path';
import json5                 from 'json5';
import { execFile }          from 'child_process';
import { Readable,Writable } from 'stream';


export class DebuggerSocket {
	constructor(inPipeName, outPipeName) {
		this._isDestroyed = false;
		this.inPipeName   = inPipeName;
		this.outPipeName  = outPipeName;

		// pipe that we use to write to remote process
		this.toScriptPipe = fs.createWriteStream(this.outPipeName, {flags:'a'})

		// pipe that we will read from the remote process
		this.msgBuf = "";
		this.fromScriptPipe = fs.createReadStream(this.inPipeName, {autoClose:false});
		this.fromScriptPipe.on('data',(data)=>this.onDataReceived(data));
		this.fromScriptPipe.on('end',()=>this.onFromScriptEnd());

		this.onMsgCallback = [];
	}

	destroy() {
		if (!this._destroyed) {
			this._destroyed = true;

			this.toScriptPipe.close();
			this.toScriptPipe = null;
			this.fromScriptPipe.removeAllListeners('end'); // supress the onFromScriptEnd() method being called when we remove the pipe
			this.fromScriptPipe.close();
			this.fromScriptPipe = null;
		}
	}

	writeMsg(data) {
		this.toScriptPipe.write(data+"\n");
	}

	// data arrives in chunks which may not contain a full msg and may contain part of the next msg
	onDataReceived(data) {
		console.log("BashDebuggedProcess data=", data.toString());
		this.msgBuf += data.toString();
		var match;

		// for each full \n\n delimitted msg, removed it from the buffer and fire it to any deps
		while (match = this.msgBuf.match(/(?<firstMsg>^.*)\n\n(?<leftOvers>.*)?$/s)) {
			this.msgBuf = (match.groups.leftOvers)?match.groups.leftOvers:"";
			var msg = {}
			msg.raw = match.groups.firstMsg;
			msg.cmd = msg.raw.replace(/\s.*$/s, '');
			msg.argsRaw = msg.raw.replace(new RegExp("^"+cmd+"\\s*"),"");
			msg.args = msg.argsRaw.split(' ');
			for (const dep in this.onMsgCallback) {
				dep.onSocketMsg(msg);
			}
		}
	}

	// this gets called when the pipe gets closed
	onFromScriptEnd() {
		for (const dep in this.onMsgCallback) {
			dep.onSocketEnd(msg);
		}
	}

	addDep(depObj) {
		this.onMsgCallback.push(depObj);
	}

	removeDep(depObj) {
		for (var i=0; i<this.onMsgCallback.length; i++) {
			if (this.onMsgCallback[i] === depObj) {
				this.onMsgCallback.slice(i,1);
				return;
			}
		}
	}
}
