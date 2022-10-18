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

		// Ways to read and write the files
		// I first used fs.createWriteStream for the pipe we write and script reads but when the script forks and two breakSessions
		// are established concurrently, for an unknown reason, the this.toScriptPipe.write() just stopped working. I could observe
		// with lsof <pipename> (have to inhibit the pipe file deletion) that it was connected but writes just had no affect even though
		// i could send a cmd to that pipe manually from another terminal and that worked (showing that the script side was ready to
		// to read)
		// Then I changed to plain fs.openSync,closeSync,writeSync, but the openSync is fragile in that if the other side opens the
		// two pipes in the different order, atom would lockup and not be recoverable. so I changed to open() and I just assume...

		// pipe that we use to write to remote process
		this.toScriptPromise = fs.open(this.outPipeName, "a", (err,fd)=>{if (err) throw err; this.toScriptPipe=fd});

		// pipe that we will read from the remote process
		this.msgBuf = "";
		this.fromScriptPipe = fs.createReadStream(this.inPipeName, {autoClose:true});
		this.fromScriptPipe.on('data',(data)=>this.onDataReceived(data));
		this.fromScriptPipe.on('end',()=>this.onFromScriptEnd());

		this.onMsgCallback = [];
	}

	destroy() {
		if (!this._destroyed) {
			this._destroyed = true;

			fs.closeSync(this.toScriptPipe);
			this.toScriptPipe = null;
			this.fromScriptPipe.removeAllListeners('end'); // supress the onFromScriptEnd() method being called when we remove the pipe
			this.fromScriptPipe.close();
			this.fromScriptPipe = null;
		}
	}

	writeMsg(data) {
		fs.writeSync(this.toScriptPipe, data+"\n")
	}

	// data arrives in chunks which may not contain a full msg and may contain part of the next msg
	onDataReceived(data) {
		this.msgBuf += data.toString();
		var match;

		// for each full \n\n delimitted msg, removed it from the buffer and fire it to any deps
		while (match = this.msgBuf.match(/(?<firstMsg>^.*?)\n\n(?<leftOvers>.*)?$/s)) {
			this.msgBuf = (match.groups.leftOvers)?match.groups.leftOvers:"";
			var msg = {}
			msg.raw = match.groups.firstMsg;
			msg.cmd = msg.raw.replace(/\s.*$/s, '');
			msg.argsRaw = msg.raw.replace(new RegExp("^"+msg.cmd+"\\s*"),"");
			msg.args = msg.argsRaw.split(' ');
			for (const dep of this.onMsgCallback) {
				dep.onSocketMsg(msg);
			}
		}
	}

	// this gets called when the pipe gets closed
	onFromScriptEnd() {
		for (const dep of this.onMsgCallback) {
			dep.onSocketEnd();
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
