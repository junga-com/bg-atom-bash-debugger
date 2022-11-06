import {
	BGError,
	Disposables,
	BGPromise,
	Component,
	ComponentToEl
}                    from 'bg-atom-utils';
import fs            from 'fs';
import path          from 'path';


// class BreakSession
// An instance of this class is created for the duration of each debug break in a DebuggedProcess. A DebuggedProcess can have multple
// break sessions each corresponding to a thread or child that is stopped.
//
// The BreakSession presents the state of the DebuggedProcess to the user and provides services for the user to explore that state.
// It also provides commands like stepOver, stepiIn, etc... that will terminate the current BreakSession and possibly cause a new
// one to be created.
//
// This is an abstract base class. A derived class needs to be implemented that knows about a specific underlying debugger that it
// uses. Typically a class derived from DebuggedProcess and one derived from BreakSession are created in tandom to work together.
// they would both use the same underlying debugger. There may be more than one set of derived classes that use the same underlying
// debugger. From example BashDebuggedProcess and GdbBashDebuggedProcess use gdb but in a way that is specific to debuggin the bash
// debugged process in gdb.
//
// DebuggedProcess State:
// The state consistes primarily of two things -- the call stack and variables.
//
// The call stack is an ordered array of StackFrames. StackFrames have several behaviors that the user can interact with to explore
// the state. StackFrame::goto() selects that frame so that the variables from that frame become selected. StackFrame::stepToHere()
// will end the current BreakSession and run the DebuggedProcess to the point where that frame contains the next line to be executed
// and a new BreakSession will be created from that stopped location.
//
// The variables consist of an array of variable description objects. Variables consist of arguments (aka parameters) to the function
// being called on the selected StackFrame, local variables contained by that function, static valiables that function has access to
// and global variables that it has access to. The type field of the StackFrame object indicates which of these the variable is in.
//
// Since the argument and local variables are specific to which stack frame is selected, the currentFrame is alos part of the logical
// state of the breakSession.
//
// Execution Commands:
// Execution commands all terminate the current BreakSession and return control back to the DebuggedProcess (i.e. the process
// continues running). Some like stepOver expect that a new BreakSession will be created soon after the current one ends but there
// is never a garantee that one will be created. For example the debuggedProcess could enter an infinite loop or it could terminate.
// The base class BreakSession defines a number of execution commands that the derived type should implement. If the underying
// debugger does not support a type of execution command then this class should either not implement it and let the base implementation
// throw an error or should implement it to throw an error that is more descriptive than the generic one.
export class BreakSession
{
	constructor(debuggedProcess, id, breakLocation) {
		this._isDestroyed     = false;
		this.debuggedProcess  = debuggedProcess;
		this.id               = id;
		this.breakLocation    = breakLocation;
		this.topPID           = breakLocation.topPID;
		this.pid              = breakLocation.pid;
		this.disposables      = new Disposables();
		this.plugin           = debuggedProcess.plugin;

		this.stack            = [];
		this.currentFrame     = 0;
		this.vars             = [];

		this.settledSemaphore = new BGPromise();

		global.mybreak = this; // for manual inspection
		//console.log("brkSes: creating : "+this.toString());
	}

	// Since the ctor launches async tasks to fully initially the BreakSession, this can be called after a BreakSession is created
	// to wait until those tasks complete and the object is fully ready to be used.
	waitForSettled(resolveFn, rejectFn) {return this.settledSemaphore.then(resolveFn).catch(rejectFn)}

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
			this.disposables.dispose();
			this.debuggedProcess.removeBreakSession(this.id);
			this.stack = null;
			this.vars = null;
		}
	}

	// this was added to aid in trace and error msgs
	toString() {
		return ""+this.pid+","+this.breakLocation.file.replace(/^.*\//,"")+","+this.breakLocation.line
	}

	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// these need to be implemented by the derived class to  operate on the specific debugger they use

	onDestroy() {}

	// exploring the debuggedProcess state is specific to the debugger that only the derived class knows about
	async requestFrmVars(frmNum) {}

	// execution commands need to operate on the specific debugger that only the derived class knows about
	async stepInto() {return new BGPromise().reject("This type of debugger session has not implemented the stepInto command"); }
	async stepOver() {return new BGPromise().reject("This type of debugger session has not implemented the stepOver command"); }
	async stepOut()  {return new BGPromise().reject("This type of debugger session has not implemented the stepOut command"); }
	async resume()   {return new BGPromise().reject("This type of debugger session has not implemented the resume command"); }
	async stepOutToFrmNum(frmNum) {return new BGPromise().reject("This type of debugger session has not implemented the stepOutToFrmNum command"); }

	// usage: stepToLocation(<locationSpec>)
	// Run the debuggedProcess up to the location described by <locationSpec>.
	//
	// frmShFunc:[(+|-)<offset> ]<shCmdPrefix>:
	// This step location spec identifies a current stack frame and runs until all the calls below it (that it called) are finished
	// and the execution is on the next line in that frame.
	// <shCmdPrefix> identifies the oldest frame on the stack that is augmented with matching text of a shell cmd. That frame
	// is optionally offest by <offset> to become the target frame that will be ran to.
	//
	// Gdb Augmentation:
	// The BashFrameIterator and BashFrameDecorator in gdbBash.py work together to append the string '=SH_CMD: <shCmd>' to the
	// caller (aka function) field of a frame that is the bash C function that executes that <shCmd>. This location spec relies
	// on that augmented caller value.
	//
	// Params:
	//    <offset> : a number that is added to the matched frame number to obtain the frame that will be stepped to
	//    <shCmdPrefix> : a string that matches the start of a <shCmd> currently on the stack.
	async stepToLocation(locationSpec) {return new BGPromise().reject("This type of debugger session has not implemented the stepToLocation command"); }

	// end of API for derived classes to implement
	//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////






	// this sets the local vars that will be shown for the current stack frame
	setVars(vars) {
		this.vars = vars;
		this.debuggedProcess.plugin.onDepChanged("vars");
	}

	setStack(stack)
	{
		// add goto methods to each stack frame to support clicking on the frame to goto it
		for (let i in stack) {
			if (!('level' in stack[i]))
				stack[i].level = i;
			stack[i].goto           = ()=>this.selectStackFrame(this.stack[i].level);
			stack[i].runToThisFrame = ()=>this.stepOutToFrmNum(     this.stack[i].level);
		}

		// sometimes we stop in low level libraries for which we have no source so set the initial selected frame to the first one
		// for which we have source. If no frames have source, leave it at 0
		var firstExistingFrm = 0;
		var foundAFrameWithSource=false
		while (firstExistingFrm<stack.length
			&& !fs.existsSync(stack[firstExistingFrm].cmdFile)) {
				foundAFrameWithSource=true
				firstExistingFrm++;
			}
		if (!foundAFrameWithSource)
			firstExistingFrm=0

		// set the stack and select the default starting frame (we skip over frames that do not have source available)
		this.stack = stack;
		this.selectStackFrame(firstExistingFrm);

		// let others know the stack has changed
		this.settledSemaphore.resolve()
		this.debuggedProcess.plugin.onDepChanged("stack");
	}

	// select a different stack frame to focus on. this will highlight the souce file line and also change the set of local vars
	async selectStackFrame(frmNum)
	{
		if (!this.stack)
			return false

		if (typeof frmNum == 'string')
			frmNum = parseInt(frmNum);
		if (typeof frmNum != 'number')
			frmNum = 0;

		if (frmNum <0)
			frmNum = 0;
		if (frmNum >= this.stack.length)
			frmNum = this.stack.length -1

		this.currentFrame = frmNum;
		this.requestFrmVars(frmNum);

		this.disposables.add(
			await this.plugin.showLocationInSource(this.stack[this.currentFrame].cmdFile, this.stack[this.currentFrame].cmdLineNo, this.stack[this.currentFrame].cmdLine)
		);

		// let others know the stack selection has changed
		this.debuggedProcess.plugin.onDepChanged("stack");

		return true
	}
}
