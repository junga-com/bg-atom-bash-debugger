import {
	BGError,
	Disposable,
	Component,
	ComponentToEl
	}                         from 'bg-atom-utils';

var markers = new Map()

export class SourceMarker {
	// usage: Disposable d = await SourceMarker.add(textEditor, file, line, cmd);
	static add(textEditor, file, line, cmd)
	{
		if (markers.has(file+":"+line))
			return null;
		else {
			var marker = new SourceMarker(textEditor, file, line, cmd);
			markers.set(file+":"+line, marker);

			var disposeMarker = new Disposable(()=>{
				marker.destroy();
				markers.delete(file+":"+line);
			})

			// we give the disposable to both the textEditor and (by returning it) the breakSession
			// which ever ends first will actually destroy and unregister the marker from our list.
			// the other one will invoke the disposable too but both the destroy and delete from our list
			// are idempotent so its fine that it calls them again when they have already been done

			textEditor.disposables.add(disposeMarker);

			return disposeMarker
		}
	}

	constructor(textEditor, file, line, cmd) {
		this.textEditor=textEditor;
		this.file=file;
		this.line=line;
		this.cmd=cmd || "";
		this.sourceLine = this.textEditor.getTextInRange({start: {row:(this.line-1),column:0}, end: {row:(this.line-1),column:100000 } });
		this.range = this.getCmdRange(this.line-1, this.sourceLine, this.cmd);

		this.marker = this.textEditor.markBufferRange(this.range.range, {invalidate:"never"});

		this.textEditor.decorateMarker(this.marker, {
			type: this.range.type,
			class: 'bg-debugger-location-cmd'
		})

		this.textEditor.decorateMarker(this.marker, {
			type: 'line',
			class: 'bg-debugger-location-line'
		})

		if (this.range.type == "line" && this.cmd)
			this.textEditor.decorateMarker(this.marker, {
				type: 'block',
				position: 'after',
				item: ComponentToEl(new Component('$span.bg-debugger-ghostLine '+this.cmd))
			})
	}

	destroy()     { this.marker.destroy();}
	isDestroyed() { return this.marker.isDestroyed();}

	// when there are more than one statement on a line, this algorithm tries to identify the start and end of just the statement
	// being executed. If it finds the match, 'type' in the returned object will be set to 'text'. Otherwise it is set to "line"
	// Return Value:
	// This function returns an object with the following structure
	//   {
	//      range: {start:{row:<r>,column:<c>}, end:{row:<r>,column:<c>}}
	//      type: 'text'|'line'
	//   }
	getCmdRange(line, sourceLine, cmd) {
		cmd = cmd.split(/\s+/);
		var start = sourceLine.indexOf(cmd[0]);
		while (start>-1 && start < sourceLine.length) {
			//console.log("###START:"+start);
			var end = start + cmd[0].length;
			for (var i=1; i<cmd.length; i++) {
				//console.log("###1   end:"+end);

				while (sourceLine.charAt(end)==' ') end++;
				//console.log("###2   end:"+end);

				if (!sourceLine.startsWith(cmd[i], end)) {
					end = start;
					break;
				}
				end = end + cmd[i].length
				//console.log("###3   end:"+end);
			}
			if (end>start) {
				break;
			}
			start = sourceLine.indexOf(cmd[0], start+1);
		}
		//console.log("###END range:"+start+" -> "+end);
		return {
			range: {
				start: {row: line,  column: (start>-1)?start:0},
				end:   {row: line,  column: (end>-1)?end:0},
			},
			type: (end>start && start>-1) ? 'text' : 'line'
		}
	}
}
