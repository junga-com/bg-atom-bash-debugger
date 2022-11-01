import { Disposables }  from 'bg-atom-utils';
import {
	Component,
	ComponentToEl,
	BackgroundMessage } from 'bg-dom';
import { BGAtomView }   from 'bg-atom-utils';
import fs               from 'fs';
import { File }         from 'atom';

class BGDBStackFrame extends Component {
	constructor(frmNum, stackFrame, isSelected, ...p) {
		super('$tr.BGDBStackFrame'+((isSelected)?".selected":""), ...p);
		this.frmNum = frmNum;
		this.frm = stackFrame;
		this.isSelected = isSelected;

		var match = /^(?<funcname>[^=]+)=(?<cmdLine>.*)$/.exec(this.frm.caller);
		if (match) {
			this.frm.caller = match.groups.funcname;
			this.frm.scriptCmdLine = match.groups.cmdLine;
			this.frm.tags = 'importantFrame';
		}

		this.mount([
			new Component('$td.location',
				new Component('$a.location', {
					href: this.frm.cmdFile+"#"+this.frm.cmdLineNo,
					content: "@TEXT"+this.frm.cmdLoc,
					onclick: ()=>{this.gotoLoc()}
				})
			),
			new Component('caller:$td.caller ',   {content:'@TEXT'+this.frm.caller}),
			new Component('cmdLine:$td.cmdLine ', {content:'@TEXT'+(this.frm.scriptCmdLine || this.frm.cmdLine)})
		])
		if (this.frm.tags)
			this.el.classList.add(this.frm.tags)

		if (!this.frm.scriptCmdLine && !this.frm.cmdLine && fs.existsSync(this.frm.cmdFile)) {
			var scrFile = new File(this.frm.cmdFile)
			scrFile.read().then((s)=>{
				var lines = s.split('\n');
				this.frm.cmdLine = lines[parseInt(this.frm.cmdLineNo)-1];
				// by the time this runs, this Component could have been replaced already if another update comes quickly
				if (this.cmdLine.el) {
					this.cmdLine.setLabel("@TEXT"+this.frm.cmdLine);
				}
			})
		}
	}

	gotoLoc() {
		this.frm.goto();
		//atom.workspace.open(this.frm.cmdFile, {initialLine : parseInt(this.frm.cmdLineNo)})
	}
}


export class StackView extends BGAtomView {
	constructor(plugin, ...p) {
		super('bgdebug://stack', plugin, {title:"Debugger Stack"}, "$table.bgStack", ...p);

	}

	destroy() {
		this.plugin = null;
		super.destroy();
	}


	update() {
		var brkSes = this.plugin.getActiveBreakSession();
		if (brkSes) {
			//console.log("stack update...", brkSes.stack);
			this.resetContent();
			var stack = brkSes.stack;

			// add the header row of the table
			this.mount(
				new Component("$thead",
					new Component("$tr",
						new Component("$th.location Location"),
						new Component("$th.caller Caller"),
						new Component("$th.cmdLine Cmd Line")
					)
				)
			)

			// add the frame rows
			for (var i in stack) {
				this.mount("frame"+i, new BGDBStackFrame(i, stack[i], i==brkSes.currentFrame));
			}
			this.mount(new Component("pstree:$div.pstree "));
			this.pstree.setLabel(brkSes.pstree)
		} else {
			this.resetContent();
			this.mount(new BackgroundMessage("Running...", "centered"));
		}
	}

	getElement() { return this.el;}
	isPermanentDockItem() {return true;}
}
