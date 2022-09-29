import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';

export class DebuggedProcess
{
	constructor(plugin, name, pid) {
		this._isDestroyed  = false;
		this.plugin  = plugin;
		this.name = name;
		this.pid = pid;

		this.breakSessions = {};
		this.activeBreakSession = null;
	}

	destroy() {
		if (!this._isDestroyed) {
			this._isDestroyed  = true;
			this.onDestroy();
			this.plugin.removeDebuggedProcess(this.pid);
		}
	}

	onDestroy() {}

	// when the breakSession is destroyed, it calls this to remove itself
	removeBreakSession(breakPID) {
		if (breakPID in this.breakSessions) {
			var temp = this.breakSessions[breakPID];
			delete this.breakSessions[breakPID];
			if (temp)
				temp.destroy();
		}
		if (this.activeBreakSession && (!(this.activeBreakSession.pid in this.breakSessions)))
			this.activeBreakSession = null;
		this.plugin.onDepChanged();
	}

}
