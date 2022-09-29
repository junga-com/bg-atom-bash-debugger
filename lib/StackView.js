import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';
import { BGAtomView } from 'bg-atom-utils';

class BGDBStackFrame extends Component {
	constructor(stackFrame, ...p) {
		super('$div.BGDBStackFrame', ...p);
		this.frm = stackFrame;
		this.mount([
			new Component('$a.location', {
				href: "file://"+this.frm.cmdFile+"#"+this.frm.cmdLineNo,
				content: this.frm.cmdLoc
			}, ()=>this.gotoLoc()),
			new Component('$span.location  on it...')
		])
	}
	gotoLoc() {
		//"atom://core/open/file?filename=<filepath>&line=<line>&column=<col>"
		atom.workspace.open(this.frm.cmdFile, {initialLine: this.frm.cmdLineNo});
	}
}


export class StackView extends BGAtomView {
	constructor(plugin, ...p) {
		super('bgdebug://stack', plugin, {title:"Debugger Stack"}, ...p);

	}

	destroy() {
		super.destroy();
	}


	update() {
		if (this.plugin.activeBreakSession) {
			this.setLabel("debug break is active");
			var stack = this.plugin.activeBreakSession.stack;
			for (var i in stack) {
				this.mount([new BGDBStackFrame(stack[i])]);
			}
		} else {
			this.setLabel("taking a break from breaks");
		}
	}

	getElement() { return this.el;}
}
