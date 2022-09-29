import { BGAtomPlugin, dedent }         from 'bg-atom-utils';
import { BGBashDebuggerTutorial }       from './BGBashDebuggerTutorial';
import { BashDebuggedProcess }          from './BashDebuggedProcess';
import { BashBreakSession }             from './BashBreakSession';
import { StackView }                    from './StackView';

import C     from 'constants';
import fs    from 'fs';
import net   from 'net';
import { mkfifoSync } from 'mkfifo'

// Main Class for this Atom package
class BGBashDebugger extends BGAtomPlugin {
	constructor(state) {
		super('bg-atom-bash-debugger', state, __filename);

		this.debuggers = {}
		this.activeDebugger = null;

		this.addCommand("bg-atom-bash-debugger:run-tutorial",   ()=>atom.config.set('bg-atom-bash-debugger.showWelcomeOnActivation', true));

		this.addCommand("bg-atom-bash-debugger:stepInto",   ()=>this.dispatchRunCommand('stepInto'));
		this.addCommand("bg-atom-bash-debugger:stepOver",   ()=>this.dispatchRunCommand('stepOver'));
		this.addCommand("bg-atom-bash-debugger:stepOut",    ()=>this.dispatchRunCommand('stepOut'));
		this.addCommand("bg-atom-bash-debugger:resume",     ()=>this.dispatchRunCommand('resume'));
		this.addCommand("bg-atom-bash-debugger:stop",       ()=>this.dispatchRunCommand('stop'));

		// create the pipe that debugged scripts will use to find us.
		var sandboxID = process.env.bgVinstalledSandbox.replace(/^.*[\/]/,"");
		if (!sandboxID) sandboxID = process.env.PWD.replace(/^.*[\/]/,"");
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

		this.stackView = new StackView(this);

		BGBashDebuggerTutorial.configure('bg-atom-bash-debugger.showWelcomeOnActivation');
	}

	onURIOpening(uri) {
		if (uri == this.stackView.getURI())
			return this.stackView;
	}

	onDepChanged() {
		this.stackView.update();
	}

	destroy() {
		// remove the pipe that debugged scripts used to find us.
		this.listenPipe.removeAllListeners('data');
		this.listenPipe = null;
		execFile('rm',['-f',this.listenPipeName]);// fs.unlinkSync did not work on a FIFO
		super.destroy()
	}

	// the 'global/static' debugger cmds step* and resume registered with atom all call this function to route the command to the
	// current active BreakSession. If there is no active BreakSession, it does nothing
	dispatchRunCommand(runCmd) {
		console.log("!!! "+runCmd+" #####");
		if (! this.activeDebugger)
			return;
		switch (runCmd) {
			case 'stepInto': this.activeDebugger.stepInto(); break;
			case 'stepOver': this.activeDebugger.stepOver(); break;
			case 'stepOut':  this.activeDebugger.stepOut();  break;
			case 'resume':   this.activeDebugger.resume();   break;
			case 'stop':
				this.removeDebuggedProcess(this.activeDebugger.pid);
				break;
			default: console.warn("unknown debugger run command '"+runCmd+"'");
		}
	}

	// the messages recieved by this function are sent to the global toAtom pipe.
	// Each breakSession gets a new set of session pipes so those msgs are received by the breakSession object
	onListenPipeData(data)
	{
		console.log("onListenPipeData=",data);
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
		console.log("onListenPipeData::onMsgReceived cmd=", cmd, "args=",args);

		switch (cmd) {
			// helloFrom is a handshake in which we can exchange capabilities
			// usage: helloFrom <pipeSessionName> <pid> <name>
			case 'helloFrom':
				args = args.split(' ');
				var pipeSessionName = args[0];
				var pid = args[1];
				var name = args[2];
				this.activeDebugger = new BashDebuggedProcess(this, name, pid, pipeSessionName);
				this.debuggers[pid] = this.activeDebugger;
				this.onDepChanged();
				break;

			// goodbyeFrom is the mate of helloFrom and signifies that the debugger is detaching from the debugged process
			case 'goodbyeFrom':
				args = args.split(' ');
				this.removeDebuggedProcess(args[0])
				break;

			// 'scriptEnded' is simillar to 'goodbyeFrom'. Its sent from the exit trap of the debugged process.
			case 'scriptEnded':
				args = args.split(' ');
				this.removeDebuggedProcess(args[0])
				break;

			case 'ping':
				args = args.split(" ");
				var pidExists = (args[1] in this.debuggers);
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
			mkfifoSync(this.listenPipeName, 0o666)
		}
		this.listenPipe = fs.createReadStream(this.listenPipeName,{autoClose:false});
		this.listenPipe.on('data',(data)=>this.onListenPipeData(data));
		this.listenPipe.on('end',(data)=>this.onListenPipeEnd(data));
	}

	// when the breakSession is destroyed, it calls this to remove itself
	removeDebuggedProcess(pid) {
		if (pid in this.debuggers) {
			var temp = this.debuggers[pid];
			delete this.debuggers[pid];
			if (temp)
				temp.destroy();
		}
		if (this.activeDebugger && !(this.activeDebugger.pid in this.debuggers) )
			this.activeDebugger = null;
		this.onDepChanged();
	}



	// save our state so so that it persists accross Atom starts
	serialize() {
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
