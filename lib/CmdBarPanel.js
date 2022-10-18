import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl, Button } from 'bg-dom';
import { BGAtomPanel } from 'bg-atom-utils';

class ResumeButton extends Button {
	constructor(...p) {
		super(...p,  'btnResume:icon-playback-play');
		this.addTooltip("resume running the script", 'bg-atom-bash-debugger:resume');
	}
	onActivated() {
		atom.commands.dispatch(this.el, 'bg-atom-bash-debugger:resume');
	}
}

class ExitButton extends Button {
	constructor(...p) {
		super(...p,  'btnResume:icon-primitive-square');
		this.addTooltip("exit the script immediately", 'bg-atom-bash-debugger:stop');
	}
	onActivated() {
		atom.commands.dispatch(this.el, 'bg-atom-bash-debugger:stop');
	}
}

class StepOverButton extends Button {
	constructor(...p) {
		super(...p,  'btnResume:icon-move-right');
		this.addTooltip("step over", 'bg-atom-bash-debugger:stepOver');
	}
	onActivated() {
		atom.commands.dispatch(this.el, 'bg-atom-bash-debugger:stepOver');
	}
}

class StepIntoButton extends Button {
	constructor(...p) {
		super(...p,  'btnResume:icon-move-down');
		this.addTooltip("step into", 'bg-atom-bash-debugger:stepInto');
	}
	onActivated() {
		atom.commands.dispatch(this.el, 'bg-atom-bash-debugger:stepInto');
	}
}

class StepOutButton extends Button {
	constructor(...p) {
		super(...p,  'btnResume:icon-move-up');
		this.addTooltip("step out of function", 'bg-atom-bash-debugger:stepOut');
	}
	onActivated() {
		atom.commands.dispatch(this.el, 'bg-atom-bash-debugger:stepOut');
	}
}



export class CmdBarPanel extends BGAtomPanel {
	constructor(plugin, ...p) {
		super(plugin, 'cmdbarPanel', 'bottom', false, 1000, "$div.bgCmdBarPanel", ...p);

		this.mount([
			new ResumeButton(),
			new ExitButton(),
			new StepOverButton(),
			new StepIntoButton(),
			new StepOutButton()
		])
	}

	destroy() {
		this.plugin = null;
		super.destroy();
	}
}
