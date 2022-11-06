import {
	BGError,
	Disposables,
 	BGPromise,
	Component,
	ComponentToEl
}                         from 'bg-atom-utils';
import path               from 'path';
import {Breakpoint}       from './Breakpoints.js'

// class DebuggedProcess
// DebuggedProcess represents a process being debugged in a debugger or in other words, a debugging session. This is an abstract
// base class that is not specific to a specific debugger. Every specific type of DebuggedProcess has a class derived from this
// class to represent it. A derived class knows what underlying debugger it uses and communicates with it in a way that is specific
// to it.
//
// There can be more than one derived DebuggedProcess class that use the same underlying debugger. For example, gdb can be used to
// debug any arbitrary process but when it is use to debug bash, its has a specific DebuggedProcess class that augments the information
// based on what it knows about the bash process.
//
// Initially two DebuggedProcess derived classes were developed -- BashDebuggedProcess and GdbBashDebuggedProcess. BashDebuggedProcess
// is the script level debugger and  GdbBashDebuggedProcess uses gdb to debug the bash executable running the script. These classes
// work together to alow the user to go between the bash source and the script in one logical debugging session.
//
// Execution Commands:
// The commands like stepOver, stepIn, resume, etc... are implemented by the breakSession but as a convienence, the debuggedProcess
// includes those commands by passing them on to its activeBreakSession. If there is no activeBreakSession these commands are quietly
// ignored.
//
// BreakSessions:
// A DebuggedProcess can have zero or more breakSessions. Each breakSession corresponds to a thread in the DebuggedProcess that is
// stopped in the debugger. Each time the user steps, the breakSession that is stepped ends and a new one is created when the
// debugger stops on the next line.
//
// There is a concept of the activeBreakSession in a debuggedProcess. That is the breakSession that is displayed in the UI and the
// one that commands are forwarded to. The activeBreakSession should only be null if the debuggedProcess has no breakSessions which
// means that the debuggedProcess is currently running and no threads are stopped in the debugger.
//
// Breakpoints:
// A DebuggedProcess can have zero or more breakpoints. The Breakpoint object is independent of the particular debugger being used.
// There is a concept of 'rendering' a breakpoint in the specific debugger being used when it is added and 'unredering' it when it
// is removed from the debuggedProcess. Derived classes of DebuggedProcess implement how to render the breakpoint for the debugger
// that they use.
//
// Open Editors:
// Instances of this class keep track of open editors whose files are source code for the debuggedProcess so that it can provide UI
// services in that file related to the debugger session. Typically this means maintaining decorations to show breakpoints and
// locations where the debuggedProcess is current stopped on and allow the user toggling breakpoints. Other services can be added
// for example inline variable values.
//
// Note:
// Currently (circa 2022-11) the instance of DebuggedProcess ends when the debugged process terminates but this could change in
// the future so that it persists and allows its executable to be restarted to enter a new debugger session.
export class DebuggedProcess
{
	constructor(plugin, id, name, pid)
	{
		this._isDestroyed  = false;
		this.plugin        = plugin;
		this.id            = ""+id;
		this.name          = name;
		this.pid           = pid;
		this.gdb           = plugin.gdb

		this.disposables        = new Disposables();
		this.breakSessions      = new Map();
		this.activeBreakSession = null;
		this.openEditors        = new Map();
		this.breakpoints        = [];
		this.waitingForStop     = new Map();

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

			for (var breakpoint of this.breakpoints)
				breakpoint.destroy();

			for (var [path, textEditor] of this.openEditors)
				this.removeOpenEditor(textEditor)

			// anyone waiting for a breakSession from this debuggedProcess wont get one because it has ended
			for (var [brkSesID, p] of this.openEditors) {
				this.waitingForStop.delete(breakSession.id);
				p.reject(new BGError("the debugged process has ended"));
			}


			this.plugin.removeDebuggedProcess(this.id);
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// these need to be implemented by the derived class to  operate on the specific debugger they use

	onDestroy() {}

	// these should be overridden in derived class
	isOurEditor(textEditor,grammar)	{}
	async renderBreakpoint(breakpoint) {}
	async unrenderBreakpoint(breakpoint) {}

	exit()     {console.warn('exit is not implemented by this debugger');}

	// end of API for derived classes to implement
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Breakpoint management

	toggleBreakpoint(breakpoint)
	{
		for (var i in this.breakpoints)
			if (breakpoint.isEqual(i)) {
				this.removeBreakpoint(breakpoint)
				return;
			}

		this.addBreakpoint(breakpoint);
	}

	async addBreakpoint(newBreakpoint)
	{
		for (var breakpoint of this.breakpoints) {
			// TODO: maybe we should update the bp if newBreakpoint has different attributes
			if (breakpoint.isEqual(newBreakpoint))
				return;
		}

		if (! await this.renderBreakpoint(newBreakpoint)) {
			atom.notifications.addWarning("could not set breakpoint there. see console for details");
			return;
		}

		this.breakpoints.push(newBreakpoint);

		// render in the UI. This block will create a marker for each location the breakpoint is rendered in
		// the markers are stored in the bp. we can unrender them by destroying the markers.
		for (var [path,textEditor] of this.openEditors) {
			for (var loc of newBreakpoint.renderedLocs) {
				if (path == loc.fullname) {
					var bpGutter = textEditor.gutterWithName('debug-gutter-show');
					var marker = textEditor.markBufferRange( [[loc.line-1, 0], [loc.line-1, 0]])
					bpGutter.decorateMarker(marker,{
						type: 'line-number',
						'class': 'debug-breakpoint'
					})
					newBreakpoint.markers.push(marker)
				}
			}
		}

		return newBreakpoint
	}

	removeBreakpoint(breakpoint)
	{
		for (var i in this.breakpoints) {
			if (breakpoint.isEqual(i)) {
				var bp = this.breakpoints[i];
				this.breakpoints.splice(i,1);
				this.unrenderBreakpoint(bp)
				bp.destroy();
				break;
			}
		}
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// OpenEditor management -- these are the open editors that are source code for this debuggedProcess

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
			onMouseDown: (pos)=>{console.log("onMouseDown",pos); this.toggleBreakpoint(new Breakpoint(textEditor.getPath(), pos.bufferRow+1 ) )},

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
	}

	removeOpenEditor(textEditor)
	{
		this.openEditors.delete(textEditor.getPath());

		var bpGutter = textEditor.gutterWithName('debug-gutter-click');
		if (bpGutter)
			bpGutter.destroy();
		var bpGutter = textEditor.gutterWithName('debug-gutter-show');
		if (bpGutter)
			bpGutter.destroy();
	}


	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// BreakSession management

	// usage: activate(brkSession)
	// Use this to activate a specific breakSession amoung the ones present in this.breakSessions or if called without an argument
	// select the first of this.breakSessions to become active.
	// When a breakSession ends (i.e. the use resumes) this is called to choose the next one that should be selected in the plugin's UI.
	// Typically plugin.activate() is called which will call this as needed. The plugin version of activate can switch the
	// the activeDebugger away from this one if this one has no more breakSessions but another debuggedProcess does have some to activate.
	activate(brkSession)
	{
		var origBrkSes = this.activeBreakSession;

		if (brkSession) {
			if (! this.breakSessions.has(brkSession.id)) {
				console.error("activate: ", {brkSession, brkSess:this.breakSessions});
				throw new BGError("<brkSession> is not contained in this debuggedProcess", {brkSession, debuggedProcess:this});
			}
			this.activeBreakSession = brkSession;
		}

		// when brkSession is null it means to just make sure activeBreakSession is not null if it does not have to be
		else if (!this.activeBreakSession && this.breakSessions.size>0)
			this.activeBreakSession = this.breakSessions.values().next().value;

		if (origBrkSes != this.activeBreakSession)
			this.plugin.onDepChanged();
	}

	// This was added to facilitate the execution commands (like stepOver, etc...) returning the next BreakSession
	// This allows an async function to script multiple steps without dealing with the breakSession changing.
	// Note that if a breakSession exists for this brkSesID when this function is called, it wont be considered the 'next' one so
	// this function behaives the same whetehr or not there this brkSesID currently exists. It has to be this way because the
	// execution commands implemented in the breakSession all use this function to return a promise that will resolve to the
	// breakSessions that comes after it
	// Example:
	//     breakSession = await breakSession.stepOver();
	//     breakSession.stack...
	//     breakSession = await breakSession.stepIn();
	async waitForNextBreakSession(brkSesID, resolveFn, rejectFn)
	{
		if (!this.waitingForStop.has(brkSesID))
			this.waitingForStop.set(brkSesID, new BGPromise());
		return this.waitingForStop.get(brkSesID).then(resolveFn, rejectFn);
	}

	// // usage: getBreakSession(timeout, resolveFn, rejectFn)
	// // This is used when we have issued a command that we expect will cause the debuggedProcess to stop and create a breakSession
	// // but since its async, we dont know if that break session is already available or if we have to wait a while for it to be
	// // created. This will return it immediately if its available or wait up to <timeout> for it to be created. If timeout passes
	// // and their is no matching breakSession, return null.
	// // TODO: this will need to support passing the pid and/or thread id to specify which breakSession to get but for now its sufficient to wait for any
	// getBreakSession(timeout, resolveFn, rejectFn)
	// {
	// 	var p = new BGPromise(resolveFn, rejectFn)
	// 	if (this.activeBreakSession) {
	// 		p.resolve(this.activeBreakSession)
	// 	} else if (!timeout) {
	// 		p.reject("there is no breakSession and timeout was not specified so not waiting")
	// 	} else {
	// 		if (this.waitingForStop)
	// 			this.waitingForStop.then(p)
	// 		else
	// 			this.waitingForStop = p;
	// 		if (timeout) {
	// 			setTimeout(()=>{
	// 				if (this.waitingForStop) {
	// 					var p = this.waitingForStop
	// 					this.waitingForStop = null
	// 					p.reject("timed out waiting for the debuggedProcess to stop")
	// 				}
	// 			}, timeout);
	// 		}
	// 	}
	// 	return p
	// }

	// when a breakSession is created, it calls this to register itself
	addBreakSession(breakSession)
	{
		this.breakSessions.set(breakSession.id, breakSession);

		this.plugin.activate(breakSession);

		// fire those waiting on this specific brekSesID
		var p = this.waitingForStop.get(breakSession.id);
		if (p) {
			this.waitingForStop.delete(breakSession.id);
			p.resolve(breakSession);
		}

		// fire those waiting on any brekSesID ('undefined' means any brkSesID)
		p = this.waitingForStop.get(undefined);
		if (p) {
			this.waitingForStop.delete();
			p.resolve(breakSession);
		}
	}

	// when the breakSession is destroyed, it calls this to remove itself
	removeBreakSession(breakID)
	{
		var temp = this.breakSessions.get(breakID);
		this.breakSessions.delete(breakID);

		if ( (this.activeBreakSession) && (this.activeBreakSession.id == breakID) ) {
			this.activeBreakSession = null;
			this.plugin.activate()
		}

		if (temp)
			temp.destroy();
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Execution Commands
	// pass these commands through to the activeBreakSession. These are conveinence methods so that you can issue cmds to the
	// debuggedProcess directly instead of getting the activeBreakSession from the debuggedProcess checjing to see if its null
	// and then issuing the cmd.

	async stepInto() { return (this.activeBreakSession) ? this.activeBreakSession.stepInto() : new BGPromise().resolve(null) ;}
	async stepOver() { return (this.activeBreakSession) ? this.activeBreakSession.stepOver() : new BGPromise().resolve(null) ;}
	async stepOut()  { return (this.activeBreakSession) ? this.activeBreakSession.stepOut()  : new BGPromise().resolve(null) ;}
	async resume()   { return (this.activeBreakSession) ? this.activeBreakSession.resume()   : new BGPromise().resolve(null) ;}

	async stepOutToFrmNum(frmNum)      { return (this.activeBreakSession) ? this.activeBreakSession.stepOutToFrmNum(frmNum)      : new BGPromise().resolve(null) ;}
	async stepToLocation(locationSpec) { return (this.activeBreakSession) ? this.activeBreakSession.stepToLocation(locationSpec) : new BGPromise().resolve(null) ;}
}
