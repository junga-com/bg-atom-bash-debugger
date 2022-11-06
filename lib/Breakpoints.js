import {
	BGError,
}                            from 'bg-atom-utils';

// Breakpoint is a value semantics class. Its identify is its location spec. It also has other optional attributes
// This class describes the logical breakpoint (bp) and is rendered into a specific debugger which may or may not support all
// features that the bp describes.
//
// Breakpoint is a concrete class but it has a few derived classes that only serve to provide explicit ways to specify the location
// spec. Breakpoint can be instanciated directly passing in a string locationSpec that support several syntax.
//
// Location Spec:
// The location spec of a breakpoint describes one or more locations in the debuggedProcess.
// The base Breakpoint class constructor accepts a locationSpec string that consists of a list of optional terms.
// There are also several derived class that allow specifying the location parameters explicity
//    new BreakpointLine(file, line, options)
//    new BreakpointFunc(funcname, file, options)
//    new BreakpointLabel(label, funcname, file, options)
// Once created, all Breakpoint instances are locically the same as if they were created by the Breakpoint constructor with the
// equivalent locationSpec string
//
// locationSpec string Syntax:
// a locationSpec string is a list of space separated terms similar to the optional argument list to a *nix command line.
// Terms
//    line:<file>|<line>                  : shortcut to specify file and line number type locations
//    func:<funcname>[|<file>]            : shortcut to specify function name type locations
//    label:<label>[|<funcname>[|<file>]] : shortcut to specify label type locations
//    -t|--temp                           : temporary. will be removed after it hits
//    -h|--hardware                       : use hardware mechanism if avaialable
//    -d|--disabled                       : start the bp disabled
//    -c|--condition <expression>         : <expression> is in the language of the debuggedProcess and the target will only stop
//                                          on this breakpoint if this condition is true at the time.
//    -i|--skipCount <count> (aka ignore) : after rendering, the bp will not stop the first <count> times it is hit
//    -p|--thread-id <thrID>              : only stop when this <thrID> hits the breakpoint
//    --source <file>                     : set <file>
//    --line <line>                       : set <line>
//    --function <function>               : set <function>
//    --label <label>                     : set <label>
//
// Attributes:
// These attributes may or may not be supported by the debugger that the breakpoint is rendered to.
//     isTemp  : when true, the breakpoint will be automatically removed after it is hit
//     isHardware : give a hint to the debugger that this should be implemented in the hardware bp facility if available
//     condition  : only stop if this condition (written in the debuggedProcess language) evaluates true
//     skipCount  : only stop after this many hits after the bp is rendered
//     thrID      : only stop when this thread id hits.
export class Breakpoint {
	constructor(locationSpec)
	{
		// location spec members
		this.type = null // 'line', 'func', 'label'
		this.file       = null
		this.line       = null
		this.funcname   = null
		this.label      = null

		this.isTemp     = false;
		this.isHardware = false
		this.isEnabled  = true
		this.condition  = null
		this.skipCount  = null
		this.thrID      = null

		// attributes for rendering. debugger specific info can be put in the impl object when the bp is rendered
		// while the bp is rendered, id will be non-null. (!id) means the the bp is not rendered
		// error is set by either renderBreakpoint or unrenderBreakpoint if they fail.
		// renderedLocs is an array of locations, each being {file,fullname,line,func}
		// TODO: the bash debuggedProcess is straight C and has no scoped function names that could lead to rendering to multiple
		//       locations so that code is untested.
		this.id = null;
		this.impl = {};
		this.error = null;
		this.renderedLocs = [];

		this.markers = [];

		this.locationSpec = locationSpec
		while (locationSpec) {
			locationSpec = locationSpec.trim()
			var match = null;
			// line:<file>|<line> -- specify a specific filename and line number.
			if (match = /^line:(?<file>[^|]*)([|](?<line>([^| \t]*)))?([|]?(?<rest>.*))?$/.exec(locationSpec)) {
				this.file = match.groups.file
				this.line = match.groups.line
				locationSpec = match.groups.rest
			}
			// func:<funcname>[|<file>] -- The bp will be at the start of the function. A file can be specified to narrow done the location
			else if (match = /^func:(?<funcname>[^| \t]*)([|](?<file>([^| \t]*)))?([|]?(?<rest>.*))?$/.exec(locationSpec)) {
				this.funcname = match.groups.funcname
				this.file     = match.groups.file
				locationSpec = match.groups.rest
			}
			// label:<label>[|<funcname>[|<file>]] -- a label in the symbols of the debuggedProcess. function and file can optionally be specified
			else if (match = /^label:(?<label>[^|]*)([|](?<funcname>([^|]*)))?([|](?<file>([ ]*)))?([|]?(?<rest>.*))$/.exec(locationSpec)) {
				this.label    = match.groups.label
				this.funcname = match.groups.funcname
				this.file     = match.groups.file
				locationSpec = match.groups.rest
			}
			// -t|--temp
			else if (match = /^(-t|--temp)\s*(?<rest>.*)$/.exec(locationSpec)) {
				this.isTemp = true;
				locationSpec = match.groups.rest
			}
			// -h|--hardware
			else if (match = /^(-h|--hardware)\s*(?<rest>.*)$/.exec(locationSpec)) {
				this.isHardware = true;
				locationSpec = match.groups.rest
			}
			// -d|--disabled
			else if (match = /^(-d|--disabled)\s*(?<rest>.*)$/.exec(locationSpec)) {
				this.isEnabled = false;
				locationSpec = match.groups.rest
			}
			// -c|--condition <condition>
			else if (match = /^(-c|--condition)\s+(?<cond>((['][^']*['])|(["][^"]*["])|([^\s]*)))\s*(?<rest>.*)$/.exec(locationSpec)) {
				this.condition = match.groups.cond;
				locationSpec = match.groups.rest
			}
			// -i|--skipCount <ignoreCount>
			else if (match = /^(-i|--skipCount)\s+(?<skipCount>([0-9]*))\s*(?<rest>.*)$/.exec(locationSpec)) {
				this.skipCount = match.groups.skipCount;
				locationSpec = match.groups.rest
			}
			// -p|--thread-id <thrID>
			else if (match = /^(-p|thread-id)\s+(?<thrID>([^ \t]*))(?<rest>.*)$/.exec(locationSpec)) {
				this.thrID = match.groups.thrID;
				locationSpec = match.groups.rest
			}
			// --source <file>
			else if (match = /^--source\s+(?<file>([^ \t]*))(?<rest>.*)$/.exec(locationSpec)) {
				this.file = match.groups.file;
				locationSpec = match.groups.rest
			}
			// --line <line>
			else if (match = /^--line\s+(?<line>([^ \t]*))(?<rest>.*)$/.exec(locationSpec)) {
				this.line = match.groups.line;
				locationSpec = match.groups.rest
			}
			// --function <function>
			else if (match = /^--function\s+(?<funcname>([^ \t]*))(?<rest>.*)$/.exec(locationSpec)) {
				this.funcname = match.groups.funcname;
				locationSpec = match.groups.rest
			}
			// --label <label>
			else if (match = /^--label\s+(?<label>([^ \t]*))(?<rest>.*)$/.exec(locationSpec)) {
				this.label = match.groups.label;
				locationSpec = match.groups.rest
			}
			else {
				throw Error("unrecognized or invalid location spec term encountered origLocSpe:'"+this.locationSpec+"', errorAt:'"+locationSpec+"'");
			}
		}
	}

	// This indicates only whether the idendity (aka location spec) of the breakpoints are the same
	isEqual(that)
	{
		return 	this.file     == that.file      &&
				this.line     == that.line      &&
				this.label    == that.label     &&
				this.funcname == that.funcname;
	}
	destroy()
	{
		for (var marker of this.markers) {
			marker.destroy();
		}
	}
}

export class BreakpointLine extends Breakpoint {
	constructor(file,line, options) {
		super(options)
		this.file = file;
		this.line = line;
	}
}

export class BreakpointFunc extends Breakpoint {
	constructor(funcname, file, options) {
		super(options)
		this.funcname = funcname;
		this.file = file;
	}
}

export class BreakpointLabel extends Breakpoint {
	constructor(label, funcname, file, options) {
		super(options)
		this.label = label;
		this.funcname = funcname;
		this.file = file;
	}
}

// for testing constructor locationSpec parsing from the console
global.Breakpoint = Breakpoint
