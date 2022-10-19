import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';

export class DebuggedProcess
{
	constructor(plugin, id, name, pid) {
		this._isDestroyed  = false;
		this.plugin  = plugin;
		this.id = id;
		this.name = name;
		this.pid = pid;

		this.breakSessions = new Map();
		this.activeBreakSession = null;
		//console.log("DebProc : creating : "+this.pid+"("+this.name+")");
	}

	destroy() {
		if (!this._isDestroyed) {
			//console.log("DebProc : destroying : "+this.pid+"("+this.name+")");
			this._isDestroyed  = true;
			this.onDestroy();
			for (var [key,brkSes] of this.breakSessions)
				brkSes.destroy();
			this.plugin.removeDebuggedProcess(this.id);
		}
	}

	getBreakSession() {
		if (!this.activeBreakSession) {
			this.activeBreakSession = this.breakSessions.values().next().value;
		}
		return this.activeBreakSession;
	}

	onDestroy() {}

	addBreakSession(breakSession) {
		this.activeBreakSession = breakSession;
		this.breakSessions.set(breakSession.pid, breakSession);
		this.plugin.onDepChanged();
	}

	// when the breakSession is destroyed, it calls this to remove itself
	removeBreakSession(breakPID) {
		if (this.breakSessions.has(breakPID)) {
			var temp = this.breakSessions.get(breakPID);
			this.breakSessions.delete(breakPID);
			if (temp)
				temp.destroy();
		}
		if (this.activeBreakSession && ! this.breakSessions.has(this.activeBreakSession.pid) )
			this.activeBreakSession = null;
		this.getBreakSession();
		this.plugin.onDepChanged();
	}

	stepInto() {this.getBreakSession(); if (this.activeBreakSession) this.activeBreakSession.stepInto();}
	stepOver() {this.getBreakSession(); if (this.activeBreakSession) this.activeBreakSession.stepOver();}
	stepOut()  {this.getBreakSession(); if (this.activeBreakSession) this.activeBreakSession.stepOut();}
	resume()   {this.getBreakSession(); if (this.activeBreakSession) this.activeBreakSession.resume();}

	// this should be implemented by the derived clas
	exit()     {console.warn('exit is not implemented by this debugger');}
}
