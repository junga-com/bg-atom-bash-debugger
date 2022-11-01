import { Disposables }              from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';
import path                         from 'path';

class Breakpoint {
	constructor(gdb, file, line)
	{
		this.gdb = gdb;
		this.file = file;
		this.line = line;
		this.markers = [];
	}
	destroy()
	{
		for (var marker of this.markers) {
			marker.destroy();
		}
	}

	async set()
	{
		try {
			var resultMsg = await this.gdb.sendCmd("-break-insert --source "+this.file+"  --line "+this.line);
			this.error = null;
		} catch (e) {
			this.error = e;
		}
		return ! this.error
	}
}

export class DebuggedProcess
{
	constructor(plugin, id, name, pid)
	{
		this._isDestroyed  = false;
		this.plugin        = plugin;
		this.id            = id;
		this.name          = name;
		this.pid           = pid;
		this.gdb           = plugin.gdb

		this.disposables        = new Disposables();
		this.breakSessions      = new Map();
		this.activeBreakSession = null;
		this.editorsToClose     = new Set(); // trap handler temp source files
		this.openEditors        = new Map();
		this.breakpoints        = [];

		// watch text editors and add breakpoint gutters to any that have a 'source' code grammar
		// TODO: add an interface to BGAtomPlugin like 'this.observeGrammars(<matchRegEx>, <addFn>, <removeFn>)'
		this.disposables.add( atom.workspace.observeTextEditors( (textEditor)=> {
			this.disposables.add(textEditor.observeGrammar( (grammar)=>{
				if (this.isOurEditor(textEditor, grammar))
					this.addOpenEditor(textEditor);
				else
					this.removeOpenEditor(textEditor);
			} ) )
		} ) )

		//console.log("DebProc : creating : "+this.pid+"("+this.name+")");
	}

	destroy()
	{
		if (!this._isDestroyed) {
			//console.log("DebProc : destroying : "+this.pid+"("+this.name+")");
			this._isDestroyed  = true;
			this.onDestroy();
			for (var [key,brkSes] of this.breakSessions)
				brkSes.destroy();

			for (var textEditor of this.editorsToClose) {
				if (!textEditor.hasTerminatedPendingState)
					textEditor.destroy();
			}

			for (var breakpoint of this.breakpoints)
				breakpoint.destroy();

			this.plugin.removeDebuggedProcess(this.id);
		}
	}


	// should be overridden in derived class
	isOurEditor(textEditor,grammar)	{}

	toggleBreakpoint(file,line)
	{
		var breakpoint = null;
		for (var i in this.breakpoints)
			if (this.breakpoints[i].file==file && this.breakpoints[i].line==line)
				{ breakpoint = this.breakpoints[i]; break; }
		if (breakpoint)
			this.removeBreakPoint(file,line);
		else
			this.addBreakPoint(file,line);
	}

	addBreakPoint(file,line)
	{
		for (var breakpoint of this.breakpoints) {
			if (breakpoint.file==file && breakpoint.line==line)
				return;
		}


		var breakpoint = new Breakpoint(this.gdb, file,line);
		if (! breakpoint.set()) {
			atom.notifications.addWarning("could not set breakpoint there. see console for details");
			return;
		}

		this.breakpoints.push(breakpoint);
		for (var [path,textEditor] of this.openEditors) if (path == breakpoint.file) {
			var bpGutter = textEditor.gutterWithName('debug-gutter-show');
			var marker = textEditor.markBufferRange( [[breakpoint.line-1, 0], [breakpoint.line-1, 0]])
			bpGutter.decorateMarker(marker,{
				type: 'line-number',
				'class': 'debug-breakpoint'
			})
			breakpoint.markers.push(marker)
		}
	}

	removeBreakPoint(file,line)
	{
		var breakpoint = null;
		for (var i in this.breakpoints) {
			if (this.breakpoints[i].file==file && this.breakpoints[i].line==line) {
				breakpoint = this.breakpoints[i];
				this.breakpoints.splice(i,1);
				break;
			}
		}
		if (breakpoint)
			breakpoint.destroy();
	}

	addOpenEditor(textEditor)
	{
		var path = textEditor.getPath();

		var bpGutter = textEditor.gutterWithName('debug-gutter-click');

		// we have already added our gutter in this editor
		if (bpGutter) return;

		bpGutter = textEditor.addGutter({
			name: 'debug-gutter-click',
			type: 'line-number',
			labelFn: ()=>{},
			onMouseDown: (pos)=>{console.log("onMouseDown",pos); this.toggleBreakpoint(textEditor.getPath(), pos.bufferRow+1)},

			visible: true
		})
		bpGutter = textEditor.addGutter({
			name: 'debug-gutter-show',
			type: 'decorated',
			priority: -201,
			visible: true
		})

		this.openEditors.set(path, textEditor);

		for (var breakpoint of this.breakpoints) if (breakpoint.file == path) {
			var marker = textEditor.markBufferRange( [[breakpoint.line-1, 0], [breakpoint.line-1, 0]])
			bpGutter.decorateMarker(marker,{
				type: 'line-number',
				'class': 'debug-breakpoint'
			})
			breakpoint.markers.push(marker)
		}

		// getEventRow = (event) ->
		// 	screenPos = textEditorElement.component.screenPositionForMouseEvent event
		// 	bufferPos = textEditor.bufferPositionForScreenPosition screenPos
		// 	return bufferPos.row
		//
		// textEditorElement = textEditor.getElement()
		// gutterContainer = textEditorElement.querySelector '.gutter-container'
		// gutterContainer.addEventListener 'mousemove', (event) =>
		// 	row = getEventRow event
		//
		// 	marker = textEditor.markBufferRange [[row, 0], [row, 0]]
		// 	@breakpointHint?.destroy()
		// 	@breakpointHint = gutter.decorateMarker marker,
		// 		type: 'line-number'
		// 		'class': 'debug-breakpoint-hint'
		//
		// (atom.views.getView gutter).addEventListener 'click', (event) =>
		// 	row = getEventRow event
		// 	@toggleBreakpoint textEditor.getPath(), row+1
		//
		// gutterContainer.addEventListener 'mouseout', =>
		// 	@breakpointHint?.destroy()
		// 	@breakpointHint = null
		//
	}

	removeOpenEditor(textEditor)
	{
		// TODO: destroy the two gutters
	}


	getBreakSession()
	{
		if (!this.activeBreakSession) {
			this.activeBreakSession = this.breakSessions.values().next().value;
		}
		return this.activeBreakSession;
	}

	onDestroy() {}

	addBreakSession(breakSession)
	{
		this.activeBreakSession = breakSession;
		this.breakSessions.set(breakSession.pid, breakSession);
		this.plugin.onDepChanged();
	}

	// when the breakSession is destroyed, it calls this to remove itself
	removeBreakSession(breakPID)
	{
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
