import fs       from 'fs';

export class StackFrame
{
	constructor(breakSession, frmData)
	{
		this.breakSession = breakSession;
		this.cmdFile   = frmData.cmdFile;
		this.cmdLineNo = frmData.cmdLineNo;
		this.cmdLoc    = frmData.cmdLoc;
		this.caller    = frmData.caller;
		this.cmdLine   = frmData.cmdLine;
		this.level     = frmData.level;
		this.gdbFrm    = frmData.gdbFrm;
	}

	isSourceAvailable()
	{
		return fs.existsSync(this.cmdFile);
	}

	// make this StackFrame the focus of the UI
	goto()
	{
		this.breakSession.selectStackFrame(this.level);
	}

	// run the debuggedProcess up to the point where a line in this StackFrame is the next command to be executed
	runToThisFrame()
	{
		this.breakSession.stepOutToFrmNum(this.level);
	}
}
