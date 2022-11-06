import {
	BGError,
	Disposables,
	Component,
	ComponentToEl,
	BackgroundMessage,
	BGAtomView
}                     from 'bg-atom-utils';

class BGDBVar extends Component {
	static create(varObj) {
		return new BGDBVarSimple(varObj);
	}
}

class BGDBVarSimple extends BGDBVar {
	constructor(varObj) {
		super("$tr.BGDBVarSimple", {class:varObj.scope});
		this.varObj = varObj;

		// values from gdb have chars escaped.
		// TODO: move unescaping to the gdb code
		this.varObj.value = this.varObj.value || '';
		this.varObj.value = this.varObj.value.replace(/\\n/g,"\n");
		this.varObj.value = this.varObj.value.replace(/\\t/g,"\t");

		this.mount([
			new Component("name:$td.name ",  {content:"@TEXT"+this.varObj.name}),
			new Component("type:$td.type ",  {content:"@TEXT"+this.varObj.type}),
			new Component("value:$td.value ",{content:"@TEXT"+this.varObj.value})
		]);
		// if (this.varObj.type)
		// 	this.addTooltip("type:"+this.varObj.type);
	}
}

export class VariablesView extends BGAtomView {
	constructor(plugin, ...p) {
		super('bgdebug://vars', plugin, {title:"Debugger Frame Variables"}, "$table.bgVars", ...p);
	}

	destroy() {
		super.destroy();
	}


	update() {
		var brkSes = this.plugin.getActiveBreakSession();
		if (brkSes) {
			//console.log("variables update...", brkSes.vars);
			this.resetContent();
			var vars = brkSes.vars;


			// add the header row for the table
			this.mount(
				new Component("$thead",
					new Component("$tr",
						new Component("$th.name Name"),
						new Component("$th.type Type"),
						new Component("$th.value Value"),
					)
				)
			);

			// add the data rows
			// TODO: its probably cleanier to iterate args and locals separatly and enclose them in <tbody class="args|local">
			var argDivFlag = 0;
			for (var varObj of vars) {
				// keep track of the break between args and local and insert a divider row
				if (argDivFlag==0 && varObj.scope=="arg") argDivFlag++;
				if (argDivFlag==1 && varObj.scope=="local") {
					argDivFlag++;
					this.mount([new Component('$tr.divider @HTML<td colspan="3"></td>')])
				}
				this.mount([BGDBVar.create(varObj)]);
			}
		} else {
			this.resetContent();
			this.mount(new BackgroundMessage("Running...", "centered"));
		}
	}

	getElement() { return this.el;}
	isPermanentDockItem() {return true;}
}
