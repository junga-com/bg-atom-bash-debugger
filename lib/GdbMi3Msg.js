import json5 from 'json5'

const reMiMsgTop = /^(?<token>[0-9]+)?(?<type>[*+^=~@&])(?<data>.*)$/
const reMiMsgClsWord = /^(?<classToken>[^,]+)(,(?<structData>.*))?$/

var charToType = new Map();
charToType.set('^', {type:"result"    ,parseType:"structured"  });
charToType.set('*', {type:"exec"      ,parseType:"structured"  });
charToType.set('+', {type:"status"    ,parseType:"structured"  });
charToType.set('=', {type:"notify"    ,parseType:"structured"  });
charToType.set('~', {type:"console"   ,parseType:"stream" });
charToType.set('@', {type:"targetOut" ,parseType:"stream" });
charToType.set('&', {type:"log"       ,parseType:"stream" });

// GdbMi3Msg parses incoming msgs from the gdb debugger's MI interface.
// See Also:
//    https://sourceware.org/gdb/current/onlinedocs/gdb/GDB_002fMI-Output-Syntax.html#GDB_002fMI-Output-Syntax
export class GdbMi3Msg {
	constructor(mi3Txt) {
		this.type = "";
		this.class = "";
		this.data = {};
		this.zparser = {};
		try {
			this.zparser.msgRaw = mi3Txt;
			if (mi3Txt.startsWith("(gdb)")) {
				this.type = "END";
				return
			}
			var match = reMiMsgTop.exec(mi3Txt);
			if (!match)
				throw new Error("the regex reMiMsgTop did not match this msg from gdb");
			({type:this.type,parseType:this.zparser.parseType} = charToType.get(match.groups.type));

			switch (this.zparser.parseType) {
				case 'structured':
					var match2 = reMiMsgClsWord.exec(match.groups.data);
					if (!match2)
						throw new Error("unknown gdb mi format. regex reMiMsgClsWord did not match data. expected a class token followed by optional result list");
					this.class = match2.groups.classToken;
					this.zparser.structuredInput = '{'+(match2.groups.structData||"")+'}';
					this.zparser.cur = 0;
					this.data = this.readValue();
				break;

				case 'stream':
					this.data = match.groups.data || "";
					if (/^["].*["]$/.test(this.data))
						this.data = this.data.replace(/^["]|["]$/g,"")
				break;
			}
		} catch (e) {
			this.error = e;
		}
	}

	toString() {
		return "t:"+this.type+" c:"+this.class+" d:"+json5.stringify(this.data)
	}

	assertToken(ch) {
		if (this.zparser.structuredInput.charAt(this.zparser.cur) != ch)
			throw new Error("expected '"+ch+"' at char "+this.zparser.cur+' in structuredInput string');
		this.zparser.cur++;
	}

	readUntil(ch) {
		//{id="i1"}
		//0123456789
		var pos = this.zparser.cur;
		while (pos<this.zparser.structuredInput.length && this.zparser.structuredInput.charAt(pos) != ch)
			pos++;
		var s = this.zparser.structuredInput.slice(this.zparser.cur,pos);
		this.zparser.cur = pos;
		return s;
	}

	readValue() {
		switch (this.zparser.structuredInput.charAt(this.zparser.cur)) {
			case '"':      return this.readString();
			case '{':      return this.readObject();
			case '[':      return this.readList();
			case '':       return undefined;
			default:
				var pair = {}
				pair.name = this.readUntil('=');
				this.assertToken('=');
				pair.value = this.readValue();
				return pair;
		}
	}

	readString() {
		this.assertToken('"');
		var s = "";
		var count=300;
		do {
			s += this.readUntil('"');
			if (s.slice(-1) == '\\' && this.zparser.structuredInput[this.zparser.cur]=='"') {
				s += '"'
				this.zparser.cur++
			}
		} while (s.slice(-2) == '\\"' && this.zparser.cur<this.zparser.structuredInput.length && count-->0);
		this.assertToken('"');
		return s;
	}

	readObject() {
		var obj = {};
		this.assertToken('{');
		while (this.zparser.cur<this.zparser.structuredInput.length && this.zparser.structuredInput.charAt(this.zparser.cur) != '}') {
			var name = this.readUntil('=');
			this.assertToken('=');
			obj[name] = this.readValue();
			if (this.zparser.structuredInput.charAt(this.zparser.cur) == ',')
				this.zparser.cur++;
		}
		this.assertToken('}');
		return obj;
	}

	readList() {
		var list = [];
		this.assertToken('[');
		while (this.zparser.cur<this.zparser.structuredInput.length && this.zparser.structuredInput.charAt(this.zparser.cur) != ']') {
			list.push(this.readValue());
			if (this.zparser.structuredInput.charAt(this.zparser.cur) == ',')
				this.zparser.cur++;
		}
		this.assertToken(']');
		return list;
	}
}
