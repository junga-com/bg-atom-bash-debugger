import { Disposables }              from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';
import fs                           from 'fs';
import path                         from 'path';


class SourceMarker {
	constructor(textEditor, file, line, cmd) {
		this.textEditor=textEditor;
		this.file=file;
		this.line=line;
		this.cmd=cmd || "";
		this.sourceLine = this.textEditor.getTextInRange({start: {row:(this.line-1),column:0}, end: {row:(this.line-1),column:100000 } });
		this.range = this.getCmdRange(this.line-1, this.sourceLine, this.cmd);

		this.marker = this.textEditor.markBufferRange(this.range.range, {invalidate:"never"});

		this.textEditor.decorateMarker(this.marker, {
			type: this.range.type,
			class: 'bg-debugger-location-cmd'
		})

		this.textEditor.decorateMarker(this.marker, {
			type: 'line',
			class: 'bg-debugger-location-line'
		})

		if (this.range.type == "line" && this.cmd)
			this.textEditor.decorateMarker(this.marker, {
				type: 'block',
				position: 'after',
				item: ComponentToEl(new Component('$span.bg-debugger-ghostLine '+this.cmd))
			})
	}

	destroy()     { this.marker.destroy();}
	isDestroyed() { return this.marker.isDestroyed();}

	// when there are more than one statement on a line, this algorithm tries to identify the start and end of just the statement
	// being executed. If it finds the match, 'type' in the returned object will be set to 'text'. Otherwise it is set to "line"
	// Return Value:
	// This function returns an object with the following structure
	//   {
	//      range: {start:{row:<r>,column:<c>}, end:{row:<r>,column:<c>}}
	//      type: 'text'|'line'
	//   }
	getCmdRange(line, sourceLine, cmd) {
		cmd = cmd.split(/\s+/);
		var start = sourceLine.indexOf(cmd[0]);
		while (start>-1 && start < sourceLine.length) {
			//console.log("###START:"+start);
			var end = start + cmd[0].length;
			for (var i=1; i<cmd.length; i++) {
				//console.log("###1   end:"+end);

				while (sourceLine.charAt(end)==' ') end++;
				//console.log("###2   end:"+end);

				if (!sourceLine.startsWith(cmd[i], end)) {
					end = start;
					break;
				}
				end = end + cmd[i].length
				//console.log("###3   end:"+end);
			}
			if (end>start) {
				break;
			}
			start = sourceLine.indexOf(cmd[0], start+1);
		}
		//console.log("###END range:"+start+" -> "+end);
		return {
			range: {
				start: {row: line,  column: (start>-1)?start:0},
				end:   {row: line,  column: (end>-1)?end:0},
			},
			type: (end>start && start>-1) ? 'text' : 'line'
		}
	}
}


// An instance of this class is created for the duration of each debug break. While the process is stopped in the debugger (a break)
// it will be listening to the {sessionPipe}-toBash and this class instance will be listening to {sessionPipe}-toAtom
export class BreakSession
{
	constructor(debuggedProcess, breakLocation) {
		this._isDestroyed     = false;
		this.debuggedProcess  = debuggedProcess;
		this.breakLocation    = breakLocation;
		this.topPID           = breakLocation.topPID;
		this.pid              = breakLocation.pid;

		this.srcMarkers       = new Map();
		this.stack            = [];
		this.currentFrame     = 0;
		this.vars             = {};

		global.mybreak = this; // for manual inspection
		//console.log("brkSes: creating : "+this.toString());
	}

	// its possible that destroy will be called more than once so we gaurd the real work with the _destroyed boolean.
	// This class is responsible for
	//     1) removing the marker and its decorations
	//     2) unregistering ourself from the debuggedProcess
	//     3) calling the derived class onDestroy()
	destroy() {
		if (!this._destroyed) {
			//console.log("brkSes: destroying : "+this.toString());
			this._destroyed = true
			this.onDestroy();
			for (var [loc,mark] of this.srcMarkers) {
				mark.destroy();
				this.srcMarkers.delete(loc);
			}
			this.debuggedProcess.removeBreakSession(this.breakLocation.pid);
			this.stack = null;
			this.vars = null;
		}
	}

	toString() {
		return ""+this.pid+","+this.breakLocation.file.replace(/^.*\//,"")+","+this.breakLocation.line
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
	async showLocationInSource(file, line, cmd) {
		if  (!fs.existsSync(file)) {
			atom.notifications.addWarning("The source file '"+file+"' can not be found to show this stack frame position");
			return;
		}

		var textEditor = await atom.workspace.open(file,{
			initialLine: (line-1),
			initialColumn:1,
			pending: true,
			searchAllPanes: true
		})

		// The debugger stub creates tmp files for trap handler source as needed and then deletes them when we continue
		// This code is meant to clean up those windows so that the user does not have to close them and worse, be prompted to
		// save them since their file has disappeared
		// Part one is monkey patching the textEditor so that it never thinks it needs saving or is modified.
		// Second is to record the URI so that the DebuggedProcess destroys it when it ends
		// /tmp/bgDbgSigHandlerSrc/EXIT_1924184_handler.sh
		if (/^\/tmp\/bgDbgSigHandlerSrc\/[A-Z<>]+_[0-9<UNK>]+_handler.sh$/.test(file)) {
			//console.log("#### detected a trap handler source file");
			textEditor.shouldPromptToSave = ()=>{return false;};
			textEditor.isModified = ()=>{return false;};
			textEditor.terminatePendingState = ()=>{};
			textEditor.keyboardInputEnabled=false;
			this.debuggedProcess.editorsToClose.add(textEditor);
		}

		var mark = this.srcMarkers.get(file+":"+line)
		if (!mark || mark.isDestroyed())
			this.srcMarkers.set(file+":"+line, new SourceMarker(textEditor, file,line,cmd) );
	}


	// implemented by derived class
	requestFrmVars(frmNum) {}

	// this sets the local vars that will be shown for the current stack frame
	setVars(vars) {
		this.vars = vars;
		this.debuggedProcess.plugin.onDepChanged("vars");
	}

	setStack(stack)
	{
		this.stack = stack;
		this.currentFrame = 0;
		this.debuggedProcess.plugin.onDepChanged("stack");
		for (let i in this.stack) {
			this.stack[i].frmNum = i;
			this.stack[i].goto = ()=>this.setStackFrame(i);
		}
		while (this.currentFrame<this.stack.length
			&& !fs.existsSync(this.stack[this.currentFrame].cmdFile))
			this.currentFrame++;
		this.setStackFrame(this.currentFrame);
		//console.log("stack=",this.stack);
	}

	// select a different stack frame to focus on. this will highlight the souce file line and also change the set of local vars
	setStackFrame(frmNum)
	{
		if (typeof frmNum == 'string')
			frmNum = parseInt(frmNum);
		if (frmNum <0)
			frmNum = 0;
		if (frmNum >= this.stack.length)
			frmNum = this.stack.length -1

		this.requestFrmVars(frmNum);
		this.currentFrame = frmNum;

		this.showLocationInSource(this.stack[this.currentFrame].cmdFile, this.stack[this.currentFrame].cmdLineNo, this.stack[this.currentFrame].cmdLine);

		this.debuggedProcess.plugin.onDepChanged();
	}
}
