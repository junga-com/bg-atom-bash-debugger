import { Disposables } from 'bg-atom-utils';
import { Component, ComponentToEl } from 'bg-dom';
import { BGAtomView } from 'bg-atom-utils';

class BGDBVar extends Component {
	static create(name, value) {
		return new BGDBVarSimple(name,value);
	}
}

class BGDBVarSimple extends BGDBVar {
	constructor(name, value) {
		super("$tr.BGDBVarSimple");
		this.var = {};
		this.var.name  = name;
		this.var.value = value;
		var match;
		if (match = /^(?<name>[^(]+)[(](?<type>[^)]+)[)]/.exec(name)) {
			this.var.name = match.groups.name.trim();
			this.var.type = match.groups.type;
		}
		this.mount([
			new Component("name:$td.name ",  {content:"@TEXT"+this.var.name}),
			new Component("value:$td.value ",{content:"@TEXT"+this.var.value})
		]);
		if (this.var.type)
			this.addTooltip("type:"+this.var.type);
	}
}

export class VariablesView extends BGAtomView {
	constructor(plugin, ...p) {
		super('bgdebug://vars', plugin, {title:"Debugger Variables"}, "$table.bgVars", ...p);
	}

	destroy() {
		super.destroy();
	}


	update() {
		var brkSes = this.plugin.getActiveBreakSession();
		if (brkSes) {
			//console.log("variables update...", brkSes.vars);
			this.setLabel("");
			var vars = brkSes.vars;
			this.mount(
				new Component("$thead",
					new Component("$tr",
						new Component("$th.name Name"),
						new Component("$th.value Value"),
					)
				)
			);
			for (var name in vars) {
				this.mount([
					BGDBVar.create(name, vars[name])
				]);
			}
		} else {
			this.setLabel("taking a break from variables");
		}
	}

	getElement() { return this.el;}
	isPermanentDockItem() {return true;}
}
