import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';

// An instance of this class is created for the duration of each debug break. While the process is stopped in the debugger (a break)
// it will be listening to the {sessionPipe}-toBash and this class instance will be listening to {sessionPipe}-toAtom
export class BreakSession
{
	constructor(debuggedProcess, breakLocation) {
		this._isDestroyed  = false;
		this.debuggedProcess  = debuggedProcess;
		this.breakLocation = breakLocation;
		this.topPID = breakLocation.topPID;
		this.pid = breakLocation.pid;
		this.showLocationInSource();
		global.mybreak = this; // for manual inspection
	}

	// its possible that destroy will be called more than once so we gaurd the real work with the _destroyed boolean.
	// This class is responsible for
	//     1) removing the marker and its decorations
	//     2) unregistering ourself from the debuggedProcess
	//     3) calling the derived class onDestroy()
	destroy() {
		console.log("destroying break session");
		if (!this._destroyed) {
			this._destroyed = true
			this.onDestroy();
			if (this.breakLocation.marker)
				this.breakLocation.marker.destroy();
			this.breakLocation.marker = null;
			this.debuggedProcess.removeBreakSession(this.breakLocation.pid);
		}
	}

	// these need to be overridden by the derived class to send the commands to the remote debugger.
	stepInto() {}
	stepOver() {}
	stepOut()  {}
	resume()   {}
	onDestroy() {}

	// this opens the source file and the stopped line and adds a marker around the command being executed. It addes several
	// decorations to the marker
	// CSS Classes:
	//   bg-debugger-location-line  : added to the (entire) line where the debugger is stopped
	//   bg-debugger-location-cmd   : if the cmd was found in the source line, this is added to the span within the line that contains the statement being executed.
	//   bg-debugger-ghostLine      : if the cmd was NOT found in the source line, an 'after' block containing the cmd is added with this style.
	showLocationInSource() {
		// open is done asynchronously. The then clause runs after its settled.
		atom.workspace.open(this.breakLocation.file,{
			initialLine: (this.breakLocation.line-1),
			initialColumn:1,
			pending: true,
			searchAllPanes: true
		}).then(
			(textEditor)=>{
				this.breakLocation.textEditor=textEditor
				this.breakLocation.range = this.getCmdRange(this.breakLocation);
				this.breakLocation.marker = this.breakLocation.textEditor.markBufferRange(this.breakLocation.range.range);
				this.breakLocation.textEditor.decorateMarker(this.breakLocation.marker, {
					type: this.breakLocation.range.type,
					class: 'bg-debugger-location-cmd'
				})
				this.breakLocation.textEditor.decorateMarker(this.breakLocation.marker, {
					type: 'line',
					class: 'bg-debugger-location-line'
				})
				if (this.breakLocation.range.type == "line")
					this.breakLocation.textEditor.decorateMarker(this.breakLocation.marker, {
						type: 'block',
						position: 'after',
						item: ComponentToEl(new Component('$span.bg-debugger-ghostLine '+this.breakLocation.cmd.join(" ")))
					})
			})
	}

	// when there are more than one statement on a line, this algorithm tries to identify the start and end of just the statement
	// being executed. If it finds the match, 'type' in the returned object will be set to 'text'. Otherwise it is set to "line"
	// Return Value:
	// This function returns an object with the following structure
	//   {
	//      range: {start:{row:<r>,column:<c>}, end:{row:<r>,column:<c>}}
	//      type: 'text'|'line'
	//   }
	getCmdRange(breakLocation) {
		var sourceLine = breakLocation.textEditor.getTextInRange({start: {row:(this.breakLocation.line-1),column:0}, end: {row:(this.breakLocation.line-1),column:100000 } });
		var start = sourceLine.indexOf(breakLocation.cmd[0]);
		while (start>-1 && start < sourceLine.length) {
			//console.log("###START:"+start);
			var end = start + breakLocation.cmd[0].length;
			for (var i=1; i<breakLocation.cmd.length; i++) {
				//console.log("###1   end:"+end);

				while (sourceLine.charAt(end)==' ') end++;
				//console.log("###2   end:"+end);

				if (!sourceLine.startsWith(breakLocation.cmd[i], end)) {
					end = start;
					break;
				}
				end = end + breakLocation.cmd[i].length
				//console.log("###3   end:"+end);
			}
			if (end>start) {
				break;
			}
			start = sourceLine.indexOf(breakLocation.cmd[0], start+1);
		}
		//console.log("###END range:"+start+" -> "+end);
		return {
			range: {
				start: {row: breakLocation.line-1,  column: (start>-1)?start:0},
				end:   {row: breakLocation.line-1,  column: (end>-1)?end:0},
			},
			type: (end>start && start>-1) ? 'text' : 'line'
		}
	}
}
