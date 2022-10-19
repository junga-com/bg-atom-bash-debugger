import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';
import { BGAtomView } from 'bg-atom-utils';

class BGDBStackFrame extends Component {
	constructor(frmNum, stackFrame, isSelected, ...p) {
		super('$tr.BGDBStackFrame'+((isSelected)?".selected":""), ...p);
		this.frmNum = frmNum;
		this.frm = stackFrame;
		this.isSelected = isSelected;
		this.mount([
			new Component('$td.location',
				new Component('$a.location', {
					href: this.frm.cmdFile+"#"+this.frm.cmdLineNo,
					content: "@TEXT"+this.frm.cmdLoc,
					onclick: ()=>{this.gotoLoc()}
				})
			),
			new Component('caller:$td.caller ',   {content:'@TEXT'+this.frm.caller}),
			new Component('cmdLine:$td.cmdLine ', {content:'@TEXT'+this.frm.cmdLine})
		])
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
			this.setLabel("");
			var stack = brkSes.stack;
			this.mount(
				new Component("$thead",
					new Component("$tr",
						new Component("$th.location Location"),
						new Component("$th.caller Caller"),
						new Component("$th.cmdLine Cmd Line")
					)
				)
			)
			for (var i in stack) {
				this.mount("frame"+i, new BGDBStackFrame(i, stack[i], i==brkSes.currentFrame));
			}
			this.mount(new Component("pstree:$div.pstree "));
			this.pstree.setLabel(brkSes.pstree)
		} else {
			this.setLabel("taking a break from breaks");
		}
	}

	getElement() { return this.el;}
	isPermanentDockItem() {return true;}
}
