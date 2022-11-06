import {
	BGError,
	BGAtomPlugin,
	dedent,
	BGPromise
}                                       from 'bg-atom-utils';
import { BGBashDebuggerTutorial }       from './BGBashDebuggerTutorial';
import { DebuggedProcess }              from './DebuggedProcess';
import { BreakSession }                 from './BreakSession';
import { BashDebuggedProcess }          from './BashDebuggedProcess';
import { BashBreakSession }             from './BashBreakSession';
import { Gdb }                          from './Gdb';
import { StackView }                    from './StackView';
import { VariablesView }                from './VariablesView';
import { CmdBarPanel }                  from './CmdBarPanel';
import { SourceMarker }                 from './SourceMarker'

import C     from 'constants';
import fs    from 'fs';
import net   from 'net';
import { mkfifoSync } from 'mkfifo'

// Main Class for this Atom package
class BGBashDebugger extends BGAtomPlugin {
	constructor(state) {
		super('bg-atom-bash-debugger', state, __filename);

		this.debuggers = new Map();
		this.activeDebugger = null;

		this.editorsToClose     = new Set(); // trap handler temp source files

		this.waitingForDebuggedProcesses = new Map();

		// this is for the startChange/endChange/onDepChanged mechanism
		this.changeNest = [];

		this.addCommand("bg-atom-bash-debugger:run-tutorial",   ()=>atom.config.set('bg-atom-bash-debugger.showWelcomeOnActivation', true));

		this.addCommand("bg-atom-bash-debugger:stepInto",      ()=>this.dispatchUserCommand('stepInto'));
		this.addCommand("bg-atom-bash-debugger:stepOver",      ()=>this.dispatchUserCommand('stepOver'));
		this.addCommand("bg-atom-bash-debugger:stepOut",       ()=>this.dispatchUserCommand('stepOut'));
		this.addCommand("bg-atom-bash-debugger:resume",        ()=>this.dispatchUserCommand('resume'));
		this.addCommand("bg-atom-bash-debugger:stop",          ()=>this.dispatchUserCommand('stop'));
		this.addCommand("bg-atom-bash-debugger:cycleDebugger", ()=>this.dispatchUserCommand('cycleDebugger'));


		// create the pipe that debugged scripts will use to find us.
		var sandboxID = process.env.bgVinstalledSandbox.replace(/^.*[\/]/,"");
		if (sandboxID == process.env.PWD.replace(/^.*[\/]/,"")) {
			this.listenPipeName = '/tmp/bgAtomDebugger-'+process.env.USER+'/'+sandboxID+'-toAtom'
			if (!fs.existsSync(this.listenPipeName)) {
				var pipeFolder = this.listenPipeName.replace(/[\/][^\/]*$/,"");
				if (!fs.existsSync(pipeFolder))
					fs.mkdirSync(pipeFolder, {recursive:true})
				mkfifoSync(this.listenPipeName, 0o666)
			}
			this.msgBuf = "";
			this.listenPipe = fs.createReadStream(this.listenPipeName,{autoClose:false,flags:"r+"});
			this.listenPipe.on('data',(data)=>this.onListenPipeData(data));
			this.listenPipe.on('end',(data)=>this.onListenPipeEnd(data));
			console.log("BGBashDebugger: listening for dbg sessions on "+this.listenPipeName);
		} else {
			console.log("BGBashDebugger: not listening for dbg sessions");
		}

		this.cmdBarPanel = new CmdBarPanel(this);
		this.stackView   = new StackView(this);
		this.varsView    = new VariablesView(this);

		this.gdb = new Gdb(this);

		BGBashDebuggerTutorial.configure('bg-atom-bash-debugger.showWelcomeOnActivation');
	}

	destroy() {
		// remove the pipe that debugged scripts used to find us.
		this.listenPipe.removeAllListeners('data');
		this.listenPipe = null;
		execFile('rm',['-f',this.listenPipeName]);// fs.unlinkSync did not work on a FIFO
		super.destroy()
	}

	// save our state so so that it persists accross Atom starts
	serialize() {
	}


	onURIOpening(uri) {
		if (uri == this.stackView.getURI()) {
			return this.stackView;
		} else if (uri == this.varsView.getURI()) {
			return this.varsView;
		}
	}

	// usage: activate(<dbgSesOrbrkSes>)
	// This sets the active debuggedProcess and breakSession within that process. <dbgSesOrbrkSes> can be either a debuggedProcess
	// or a breakSessions or null.
	// When the current activeDebugger or activeBreakSession ends, this is called with no arguments to select the next best
	// (activeDebugger,activeBreakSession). When the user resumes, the UI should go to another stopped breakSession if possible.
	// Usecases:
	//    1) a new breakSession is created, call this to activate it. When a running debuggedProcess stops, it creates a new
	//       breakSession and the debugger UI should switch to it so the user knows that it happenned.
	//    2) when the current activeDebugger or activeBreakSession ends, call this with no arguments to switch the UI to the next
	//       best thing that the user should be focused on.
	//    3) Call this with a specific debuggedProcess or breakSession to allow the user to select any existing one to display in
	//       the UI (even if its not the thing that is most interesting to focus on)
	activate(dbgSesOrbrkSes) {
		var origDbg = this.activeDebugger;
		var origBrkSes = (this.activeDebugger)?this.activeDebugger.activeBreakSession:null;
		if (dbgSesOrbrkSes instanceof DebuggedProcess) {
			if (!this.debuggers.has(dbgSesOrbrkSes.id))
				throw Error("dbgSesOrbrkSes is not registered in the plug list of debuggers (aka sessions)")
			this.activeDebugger = dbgSesOrbrkSes;
			this.activeDebugger.activate()
		}
		else if (dbgSesOrbrkSes instanceof BreakSession) {
			this.activeDebugger = dbgSesOrbrkSes.debuggedProcess;
			this.activeDebugger.activate(dbgSesOrbrkSes)
		}
		else if (dbgSesOrbrkSes) {
			console.error(dbgSesOrbrkSes);
			throw Error("dbgSesOrbrkSes is neither a DebuggedProcess nor BreakSession")
		}

		// this is the case where dbgSesOrbrkSes is null so we just make sure that both activeDebugger and its activeBreakSession
		// are both non-null if possible.
		else {
			// if the current this.activeDebugger's activeBreakSession is null, maybe it has a breakSession that it can  activate
			// we should stay on the selected activeDebugger is possible
			if (this.activeDebugger && ! this.activeDebugger.activeBreakSession)
				this.activeDebugger.activate()

			// this loop will break out immediately if both activeDebugger and its activeBreakSession are set
			// if either are not set, it will find a breakSession to activate or if none exist, a debuggedProcess without any
			// breakSessions
			for (var [dbgID, dbg] of this.debuggers) {
				// set this.activeDebugger if its not already set even if this debugger is not the best (it may not have a breakSes)
				if (!this.activeDebugger) {
					this.activeDebugger = dbg
					this.activeDebugger.activate()
					console.log("dbg: changed active dbg to ", this.activeDebugger);
				}
				// if the this.activeDebugger is set and it has a breakSession, we are done
				else if (this.activeDebugger.breakSessions.size>0)
					break;
				// this.activeDebugger is set but does not have a break session so prefer dbg if it does
				else if (dbg.breakSessions.size>0) {
					this.activeDebugger = dbg
					this.activeDebugger.activate()
					console.log("dbg: changed active dbg to ", this.activeDebugger);
					break;
				}
			}
		}

		if (this.activeDebugger != origDbg || origBrkSes != ((this.activeDebugger)?this.activeDebugger.activeBreakSession:null))
			this.onDepChanged();
	}

	// conveinence function to get the activeBreakSession
	getActiveBreakSession() {
		return (this.activeDebugger) ? this.activeDebugger.activeBreakSession : null
	}

	// // OBSOLETE? now that we have activate(), activeDebugger and activeBreakSession should never be null if there is at least one
	// // usage: getActiveDebugger()
	// // this is called whenever something is going to use a activeDebugger and it mkes sure that it is not null if there is at least
	// // one element in debuggers.
	// getActiveDebugger() {
	// 	if (!this.activeDebugger)
	// 		this.activate()
	//
	// 	// ask the debugger to set its activeBreakSession if needed
	// 	if (this.activeDebugger)
	// 		this.activeDebugger.getActiveBreakSession()
	// 	return this.activeDebugger;
	// }

	// TODO: this should use DependentsGraph but its not quite ready at the time of writing this class
	startChange(type) {
		this.changeNest.push(new Set([type || "all"]))
	}
	endChange(type) {
		var types = this.changeNest.pop()
		types.add(type || "all")
		if (this.changeNest.length == 0)
			this.onDepChanged(types)
		else
			for (var el of types)
				this.changeNest[this.changeNest.length-1].add(el)
	}
	onDepChanged(types) {
		if (! (types instanceof Set))
			types = new Set([types || "all"]);

		if (this.changeNest.length > 0) {
			for (var el of types)
				this.changeNest[this.changeNest.length-1].add(el)
			return false
		}

		var doAll = types.has("all")
		if (doAll || types.has("stack"))
			this.stackView.update();
		if (doAll || types.has("vars"))
			this.varsView.update();
		return true
	}

	show() {
		this.cmdBarPanel.show();
		atom.workspace.open("bgdebug://stack", {location:'bottom', split:'left', searchAllPanes:true});
		atom.workspace.open("bgdebug://vars", {location:'bottom', split:'right', searchAllPanes:true});
	}

	hide() {
		this.cmdBarPanel.hide();
		atom.workspace.hide("bgdebug://stack");
		atom.workspace.hide("bgdebug://vars");
	}

	// the 'global/static' debugger cmds step* and resume registered with atom all call this function to route the command to the
	// current active BreakSession. If there is no active BreakSession, it does nothing
	dispatchUserCommand(runCmd) {
		//console.log("!!! "+runCmd+" #####");
		if (! this.activeDebugger)
			return;
		switch (runCmd) {
			case 'stepInto':      this.activeDebugger.stepInto(); break;
			case 'stepOver':      this.activeDebugger.stepOver(); break;
			case 'stepOut':       this.activeDebugger.stepOut();  break;
			case 'resume':        this.activeDebugger.resume();   break;
			case 'stop':          this.activeDebugger.exit();     break;
			case 'cycleDebugger': this.switchTo();                break;

			default: console.warn("unknown debugger run command '"+runCmd+"'");
		}
	}

	// the messages recieved by this function are the ones sent to the global toAtom pipe.
	// Each breakSession gets a new set of session pipes so those msgs are received by the breakSession object
	onListenPipeData(data)
	{
		//console.log("onListenPipeData=",data);
		this.msgBuf += data.toString();
		var match;
		while (match = this.msgBuf.match(/(?<firstMsg>^.*)\n\n(?<leftOvers>.*)?$/s)) {
			this.msgBuf = (match.groups.leftOvers)?match.groups.leftOvers:"";
			this.onMsgReceived(match.groups.firstMsg);
		}
	}

	onMsgReceived(msg)
	{
		var cmd = msg.replace(/\s.*$/s, '');
		var args = msg.replace(new RegExp("^"+cmd+"\\s*"),""); args = args.replace(/^[[:space:]]*/,"");
		//console.log("onListenPipeData::onMsgReceived cmd=", cmd, "args=",args);

		switch (cmd) {
			// helloFrom is a handshake in which we can exchange capabilities
			// usage: helloFrom <pipeSessionName> <pid> <name>
			case 'helloFrom':
				args = args.split(' ');
				var pipeSessionName = args[0];
				var pid = args[1];
				var name = args[2];
				this.addDebuggedProcess(new BashDebuggedProcess(this, name, pid, pipeSessionName));
				break;

			case 'ping':
				args = args.split(" ");
				var pidExists = (this.debuggers.has(args[1]));
				var toBashSocket = fs.createWriteStream(args[0]);
				toBashSocket.write("pong "+(pidExists?'yes':'no')+"\n");
				break;

			default:
				console.log('unknown msg from the remote debugger', cmd);
		}
	}

	onListenPipeEnd(data) {
		console.log("!!!######## onListenPipeEnd #######", data);

		// create the pipe that debugged scripts will use to find us.
		if (!fs.existsSync(this.listenPipeName)) {
			var pipeFolder = this.listenPipeName.replace(/[\/][^\/]*$/,"");
			if (!fs.existsSync(pipeFolder))
				fs.mkdirSync(pipeFolder, {recursive:true})
			mkfifoSync(this.listenPipeName, 0o666);
		}
		this.listenPipe = fs.createReadStream(this.listenPipeName,{autoClose:false});
		this.listenPipe.on('data',(data)=>this.onListenPipeData(data));
		this.listenPipe.on('end',(data)=>this.onListenPipeEnd(data));
	}

	// usage: Promise getDebuggedProcessFor(id,timeout, resolveFn, rejectFn)
	// return the debuggedProcess corresponding to the <id>. If there is not a debuggedProcess for this id and timeout is set to
	// non-zero, it will wait for it to start. If there is no debuggedProcess by the time timout expires, fail by rejecting the promise.
	// Params:
	//    <id> : for gdb debuggers <id> is the pid. For script debuggers <id> is <scriptType>:pid. This allows both gdb and a script
	//           debugger (like the bash debugger) to be active on the same pid without their ids conflicting
	getDebuggedProcessFor(id, timeout, resolveFn, rejectFn) {
		console.log("getDebuggedProcessFor: "+id, this.debuggers);
		var p = new BGPromise(resolveFn, rejectFn)
		if (this.debuggers.has(""+id)) {
			console.log("getDebuggedProcessFor: found it already");
			p.resolve(this.debuggers.get(""+id))
		} else if (timeout == 0) {
			p.reject("there is no debuggedProcess for '"+id+"' and timeout was not specified so not waiting")
		} else {
			console.log("getDebuggedProcessFor: not there yet -- setting up promise waiting");
			if (this.waitingForDebuggedProcesses.has(id))
				this.waitingForDebuggedProcesses.set(id, this.waitingForDebuggedProcesses.has(id).then(p))
			else
				this.waitingForDebuggedProcesses.set(id, p)
			console.log("getDebuggedProcessFor: setting timer");
			setTimeout((id)=>{
				console.log("getDebuggedProcessFor: timer firing...");
				if (this.waitingForDebuggedProcesses.has(id)) {
					console.log("getDebuggedProcessFor: timer found promise in waitingForDebuggedProcesses");
					var p = this.waitingForDebuggedProcesses.get(id)
					// we might be racing with the DebuggedProcess being created. Whoever deletes the record wins the race. We get
					// the promise first but will only do something with it if delete returns true indicating that it did find and
					// remove it.
					if (this.waitingForDebuggedProcesses.delete(id)) {
						console.log("getDebuggedProcessFor: timer removed promise and rejecting");
						p.reject()
					} else
						console.log("getDebuggedProcessFor: delete of waiting promise returned false");
				} else
					console.log("timer found no wating promise for id='"+id+"'");
			}, timeout)
		}
		return p;
	}

	addDebuggedProcess(theDebugger) {
		this.debuggers.set(theDebugger.id, theDebugger);

		this.activate(theDebugger)

		if (this.debuggers.size == 1)
			this.show();

		if (this.waitingForDebuggedProcesses.has(theDebugger.id)) {
			console.log("addDebuggedProcess: found the promise in waitingForDebuggedProcesses");
			var p = this.waitingForDebuggedProcesses.get(theDebugger.id)
			// if delete returns false, it means that the timeout barely won the race and it rejected the promise so we can not
			// resolve it.
			if (this.waitingForDebuggedProcesses.delete(theDebugger.id)) {
				console.log("addDebuggedProcess: removed p from waitingForDebuggedProcesses and resolving");
				p.resolve(theDebugger)
			} else
				console.log("addDebuggedProcess: delete from waitingForDebuggedProcesses returned false");
		} else
			console.log("addDebuggedProcess: no waiting promise for '"+theDebugger.id+"' ");
	}

	// when the DebuggedProcess is destroyed, it calls this to remove itself
	removeDebuggedProcess(id) {
		var temp = this.debuggers.get(""+id);
		this.debuggers.delete(""+id);

		if (this.activeDebugger && (this.activeDebugger.id == id) ) {
			this.activeDebugger = null;
			this.activate();
		}

		if (temp)
			temp.destroy();

		if (!this.activeDebugger) {
			this.hide();

			// TODO: remove this code and make these tabs automatically close when the file they are showing is deleted.
			//       this is not a great place to close these temp textEditor tabs (for the trap source code that bash script debugger creates).
			//       we want to move all the UI stuff to this atom plugin class
			//       but also, these temp editors are specific to a particular DebuggedProcess and should be destroyed specifically when
			//       that debuggedProcess ends.
			for (var textEditor of this.editorsToClose) {
				if (!textEditor.hasTerminatedPendingState)
					textEditor.destroy();
			}
		}
	}

	switchTo(debuggerID)
	{
		if (debuggerID && ! this.debuggers.has(""+debuggerID))
			console.warn("bg-bash-debugger.switchTo(debuggerID='"+debuggerID+"'): the debuggerID is not a running debugger");
		else if (this.debuggers.size == 0)
			console.warn("bg-bash-debugger.switchTo(debuggerID='"+debuggerID+"'): there are no running debuggers");
		else if (this.debuggers.size == 1 && this.activeDebugger)
			console.warn("bg-bash-debugger.switchTo(debuggerID='"+debuggerID+"'): there is only one running debugger");
		else {
			if (debuggerID) {
				this.activeDebugger = this.debuggers.get(""+debuggerID);
			} else if (!this.activeDebugger) {
				this.activeDebugger = this.debuggers.values().next().value;
			} else {
				// this block finds the key after this.activeDebugger.id (wrapping around to the start if needed)
				// there is probably a more elegant way of doing this
				var key;
				var ids = this.debuggers.keys();
				var count=10
				while ((key=ids.next().value) && key!=this.activeDebugger.id) {
					if (count-- <=0)
						return
				}

				if (key)  key=ids.next().value;
				if (!key) key = this.debuggers.keys().next().value;
				this.activeDebugger = this.debuggers.get(key);
				this.onDepChanged();
			}
		}
	}


	// usage: Disposable = async showLocationInSource(file, line, cmd)
	// this opens the source file and the stopped line and adds a marker around the command being executed. It addes several
	// decorations to the marker
	// CSS Classes:
	//   bg-debugger-location-line  : added to the (entire) line where the debugger is stopped
	//   bg-debugger-location-cmd   : if the cmd was found in the source line, this is added to the span within the line that contains the statement being executed.
	//   bg-debugger-ghostLine      : if the cmd was NOT found in the source line, an 'after' block containing the cmd is added with this style.
	async showLocationInSource(file, line, cmd)
	{
		var p = new BGPromise();

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

		// Sometimes a debugger (specifically the bash script debugger) will create a temporary source files for trap handler source
		// and then deletes them when we continue from that breakSession.
		// This code is meant to clean up those windows so that the user does not have to close them and worse, be prompted to
		// save them since their file has disappeared.
		// Part one is monkey patching the textEditor so that it never thinks it needs saving or is modified.
		// The second part is to record the URI so that the DebuggedProcess destroys it when it ends
		if (/^\/tmp\/$/.test(file)) {
			textEditor.shouldPromptToSave = ()=>{return false;};
			textEditor.isModified = ()=>{return false;};
			textEditor.terminatePendingState = ()=>{};
			textEditor.keyboardInputEnabled=false;
			this.editorsToClose.add(textEditor);
		}

		var disposeMarker = SourceMarker.add(textEditor, file,line,cmd)
		p.resolve(disposeMarker)

		return p;
	}

};

//"configSchema":
// BGBashDebugger.config =  {
// 	"showWelcomeOnActivation": {
// 		"type": "boolean",
// 		"default": true,
// 		"title": "Show Welcome Tutorial",
// 		"description": "Checking this will activate the welcome dialog one more time"
// 	},
// 	"enable-global-keymaps": {
// 		"type": "boolean",
// 		"default": true,
// 		"title": "Enable Global Keymaps",
// 		"description": "Deselecting this will disable only some of the the keymaps provided by this package.  Only the ones associated with this package's modal dialog will remain."
// 	}
// }

export default BGAtomPlugin.Export(BGBashDebugger);
