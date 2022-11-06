import gdb
import re
import itertools
import inspect
import sys
import traceback

#-break-insert --source /home/bobg/github/bashParse/execute_cmd.c --line 846 -c running_trap==0

from gdb.FrameDecorator  import FrameDecorator

try:
	_bgtraceFile = open("/tmp/bgtrace.out","a")
except:
	_bgtraceFile = None

BASH_TOKENS = {
	258 : "IF",
	259 : "THEN",
	260 : "ELSE",
	261 : "ELIF",
	262 : "FI",
	263 : "CASE",
	264 : "ESAC",
	265 : "FOR",
	266 : "SELECT",
	267 : "WHILE",
	268 : "UNTIL",
	269 : "DO",
	270 : "DONE",
	271 : "FUNCTION",
	272 : "COPROC",
	273 : "COND_START",
	274 : "COND_END",
	275 : "COND_ERROR",
	276 : "IN",
	277 : "BANG",
	278 : "TIME",
	279 : "TIMEOPT",
	280 : "TIMEIGN",
	281 : "WORD",
	282 : "ASSIGNMENT_WORD",
	283 : "REDIR_WORD",
	284 : "NUMBER",
	285 : "ARITH_CMD",
	286 : "ARITH_FOR_EXPRS",
	287 : "COND_CMD",
	288 : "AND_AND",
	289 : "OR_OR",
	290 : "GREATER_GREATER",
	291 : "LESS_LESS",
	292 : "LESS_AND",
	293 : "LESS_LESS_LESS",
	294 : "GREATER_AND",
	295 : "SEMI_SEMI",
	296 : "SEMI_AND",
	297 : "SEMI_SEMI_AND",
	298 : "LESS_LESS_MINUS",
	299 : "AND_GREATER",
	300 : "AND_GREATER_GREATER",
	301 : "LESS_GREATER",
	302 : "GREATER_BAR",
	303 : "BAR_AND",
	304 : "yacc_EOF"
}
def getBashToken(id):
	try:
		return BASH_TOKENS[id]
	except:
		return "UNK_BASH_TOKEN({})".format(id)


_bgtraceSOL = True;

def _bgtrace(strMsg, indentLevel=0):
	global bgtraceOn
	global _bgtraceFile
	if not bgtraceOn.value or not _bgtraceFile:
		return
	global _bgtraceSOL
	strMsg=str(strMsg)
	if indentLevel==0 or not _bgtraceSOL:
		_bgtraceFile.write('{}'.format(strMsg))
	else:
		# replace all \n<ch> with \n<indent><ch>  (the <ch> stops it from matching the last, trailing \n)
		strMsg = re.sub("\n(.)", lambda x: '\n{1:{0}s}+{2}'.format(indentLevel*3-1,'',x.group(1)), strMsg)
		_bgtraceFile.write('{1:{0}s}{2}'.format(indentLevel*3,'',strMsg))

	_bgtraceSOL = re.search("\n$",strMsg)
	_bgtraceFile.flush()


def bgtrace(*args, indentLevel=0):
	global bgtraceOn
	global _bgtraceFile
	if not bgtraceOn.value or not _bgtraceFile:
		return
	if _bgtraceFile:
		for msg in args:
			t = type(msg)
			tStr = str(t)

			if t in [str,int,float,complex,bool,bytes, bytearray, memoryview]:
				_bgtrace(str(msg), indentLevel=indentLevel)

			elif t == dict:
				_bgtrace("{}\n".format(str(t)), indentLevel=indentLevel)
				for name in dir(msg):
					try:
						_bgtrace(name+": "+str(getattr(msg, 'name', '<error>'))+"\n", indentLevel=indentLevel+1)
					except Exception as e:
						_bgtrace(name+": <error: "+str(e)+">\n", indentLevel=indentLevel+1)


			elif t == tuple:
				_bgtrace(str(t)+"\n", indentLevel=indentLevel)
				count = 0
				for i in msg:
					_bgtrace("   [{}]=".format(count), indentLevel=indentLevel+1)
					bgtrace(i, indentLevel=indentLevel+2)
					count = count +1

			elif t == list:
				_bgtrace(str(t)+"\n", indentLevel=indentLevel)
				count = 0
				for i in msg:
					_bgtrace("   [{}]=".format(count), indentLevel=indentLevel+1)
					bgtrace(i, indentLevel=indentLevel+2)
					count = count +1

			elif tStr == "<class 'function'>" or tStr == "<class 'gdb.printing.RegexpCollectionPrettyPrinter'>":
				_bgtrace("name:"+getattr(msg,'__name__',"<UNK>")+" type:"+tStr, indentLevel=indentLevel)


			elif isinstance(msg, gdb.Symbol):
				_bgtrace('<gdb.Symbol>\n', indentLevel=indentLevel);
				_bgtrace('   name       ={}\n'.format(msg.name), indentLevel=indentLevel);
				_bgtrace('   type       ={}\n'.format(msg.type), indentLevel=indentLevel);
				_bgtrace('   needs_frame={}\n'.format(msg.needs_frame), indentLevel=indentLevel);
				_bgtrace('   value=', indentLevel=indentLevel);
				try:
					bgtrace(msg.value(), indentLevel=indentLevel+1);
				except Exception as e:
					_bgtrace('<error while accessing value:{}>\n'.format(str(e)), indentLevel=indentLevel+1)


			elif isinstance(msg, gdb.Type):
				try:
					_bgtrace("<gdp.Type> "+str(msg)+"\n", indentLevel=indentLevel);
					_bgtrace("name     : {}\n".format(str(msg.name)), indentLevel=indentLevel+1);
					_bgtrace("code     : {}\n".format(str(msg.code)), indentLevel=indentLevel+1);
					_bgtrace("sizeof   : {}\n".format(str(msg.sizeof)), indentLevel=indentLevel+1);
					_bgtrace("tag      : {}\n".format(str(msg.tag)), indentLevel=indentLevel+1);
					#_bgtrace("is_scalar: {}\n".format(str(getattr(msg, 'is_scalar','<error: is_scalar is not an attribute>'))), indentLevel=indentLevel+1);

					try:
						for field in msg.fields():
							_bgtrace("field : {} {}\n".format(str(field.type), field.name), indentLevel=indentLevel+1);
					except:
						_bgtrace("field : <none>\n", indentLevel=indentLevel+1)
				except Exception as e:
					_bgtrace("<error while bgtrace(<gdb.Type>): error = {}>\n".format(str(e)), indentLevel=indentLevel+1);


			elif isinstance(msg, gdb.Value):
				_bgtrace('<gdb.Value>\n', indentLevel=indentLevel);
				_bgtrace('   type   = {}\n'.format(str(msg.type)), indentLevel=indentLevel+1);
				_bgtrace('   address= 0x{:X}\n'.format(int(msg.address)), indentLevel=indentLevel+1);
				if msg.is_optimized_out:
					_bgtrace('   !!! is_optimized_out=True !!!\n', indentLevel=indentLevel+1);
				try:
					_bgtrace('   value  = {}\n'.format(msg.string()), indentLevel=indentLevel+1);
				except:
					_bgtrace('   value  = {}\n'.format(str(msg)), indentLevel=indentLevel+1);

				# for name in dir(msg):
				# 	_bgtrace("{}: {}\n".format(name, str(getattr(msg,name, "<getattr failed to get value>"))), indentLevel=indentLevel+1)


			elif isinstance(msg, type(None)):
				_bgtrace("<None>", indentLevel=indentLevel);

			else:
				_bgtrace("{} <unrecognized by bgtrace>\n".format(tStr), indentLevel=indentLevel)
				_bgtrace("name: {}\n".format(getattr(msg,'__name__',"<No Name>")), indentLevel=indentLevel+1)
				try:
					_bgtrace("str()= {}\n".format(str(msg)), indentLevel=indentLevel+1)
				except Exception as e:
					_bgtrace("str()= <error:{}>\n".format(str(e)), indentLevel=indentLevel+1)
				for name in dir(msg):
					_bgtrace("{}: {}\n".format(name, str(getattr(msg,name, "<getattr failed to get value>"))), indentLevel=indentLevel+1)
			_bgtrace("\n", indentLevel=indentLevel)
		_bgtraceFile.flush()


def BGPtrCast(typeStr, val):
	return "(({type})0x{addr:X})".format(type=typeStr, addr=int(val))

def BGGetValue(gdbValue):
	typeStr = "<no type attrib>"
	try:
		typeStr = str(gdbValue.type)
		if typeStr == "char *":
			return gdbValue.string()
		if re.search("^enum",typeStr):
			return gdbValue.format_string(raw = True)

		bgtrace("BGGetValue:", str(gdbValue.type))
		return gdbValue.format_string(raw = True)
	except Exception as e:
		return "<BGGetValue(gdbVal) failed. type:'{}' error:'{}'>".format(typeStr, str(e))

def signalToString(sigNum):
	sigTbl = gdb.lookup_symbol('signal_names')[0].value();
	bgtrace(sigTbl)
	try:
		sigName = sigTbl[sigNum] if sigTbl else None;
	except:
		sigName = '{}(UNK name)'.format(str(sigNum))
	return sigName;

def ShellVar_getI(vVar,index):
	vArray = vVar['value']
	return BGGetValue(gdb.parse_and_eval('array_reference({}, {})'.format(BGPtrCast("ARRAY *", vArray), index)))


def WordList_toString(words):
	s = ""
	sep=""
	cur = words
	count = 0
	try:
		while cur:
			word = cur['word']['word'].string()
			if re.search("\s",word):
				word = "'{}'".format(word)
			s = s + sep + word
			sep=" "
			cur = cur['next'] if cur['next'] else None
			count = count + 1
		return s;
	except Exception as e:
		bgtrace("WordList_toString: caught exception after {} words. words='{}'".format(count, s), traceback.format_exc())
		return s+" <"+str(e)+">"



# cm_for
# cm_case
# cm_while
# cm_if
# cm_simple
# cm_select
# cm_connection
# cm_function_def
# cm_until
# cm_group
# cm_arith
# cm_cond
# cm_arith_for
# cm_subshell
# cm_coproc
def ShellCmd_typeToString(cmdType):
	# most of the struct names are upper case cmdType with the leading 'cm_' removed but there are a few exceptions
	if 'cm_connection' == cmdType:
		return 'CONNECTION';
	if 'cm_function_def' == cmdType:
		return 'FUNCTION_DEF';
	if 'cm_until' == cmdType:
		return 'WHILE_COM';
	return cmdType.replace("cm_","").upper() + "_COM"



def CmdDynStruct_getSummaryText(vTypedCmd, dynType=None):
	# bgtrace("$$$ here")
	# bgtrace(vTypedCmd, vTypedCmd.type)
	if not dynType:
		dynType = str(vTypedCmd.type)
		dynType = re.sub(" \*$","", dynType)
		# bgtrace("$$$ dynType='"+dynType+"'")

	if 'FOR_COM'          == dynType:
		return 'for {} ...'.format(vTypedCmd['name']['word'].string())
	elif 'CASE_COM'         == dynType:
		return 'case {} ...'.format(vTypedCmd['word']['word'].string())
	elif 'WHILE_COM'        == dynType:
		return 'while {}; ...'.format( ShellCmd_getSummaryText(vTypedCmd['test']) )
	elif 'IF_COM'           == dynType:
		return 'if {}; ...'.format( ShellCmd_getSummaryText(vTypedCmd['test']) )
	elif 'SIMPLE_COM'       == dynType:
		return WordList_toString(vTypedCmd['words'])
	elif 'SELECT_COM'       == dynType:
		return 'for {} ...'.format(vTypedCmd['name']['word'].string())
	elif 'CONNECTION'   == dynType:
		try:
			return '{} {} {}'.format(
				ShellCmd_getSummaryText(vTypedCmd['first']),
				getBashToken( int(vTypedCmd['connector']) ),
				ShellCmd_getSummaryText(vTypedCmd['second'])
			)
		except Exception as e:
			return '<error: {}>'.format(str(e))
	elif 'FUNCTION_DEF' == dynType:
		return 'function {}() \{...} ...'.format(vTypedCmd['name']['word'].string())
	elif 'GROUP_COM'        == dynType:
		return 'grouped cmd block {...}';
	elif 'ARITH_COM'        == dynType:
		return WordList_toString(vTypedCmd['exp'])
	elif 'COND_COM'         == dynType:
		return '<expr> {} <expr>'.format(vTypedCmd['op']['word'].string())
	elif 'ARITH_FOR_COM'    == dynType:
		return 'for (( {}; {}; {} ))'.format(
			WordList_toString(vTypedCmd['init']),
			WordList_toString(vTypedCmd['test']),
			WordList_toString(vTypedCmd['step'])
		)
	elif 'SUBSHELL_COM'     == dynType:
		return '$(...)'
	elif 'COPROC_COM'       == dynType:
		return '<creating coproc>'

	return "<unknown cmd struct type '"+dynType+"'"

def ShellCmd_getSummaryText(vCmd):
	dynType = ShellCmd_typeToString(BGGetValue(vCmd['type']));
	vTypedCmd = vCmd['value'].cast(gdb.lookup_type(dynType).pointer()).dereference()
	return CmdDynStruct_getSummaryText(vTypedCmd)

# experimental -- not yet used
def getAltStackData():
	vFUNC = gdb.parse_and_eval('ShellVar_find("FUNCNAME")')

	frm = gdb.newest_frame()
	count = 0
	while frm:
		bgtrace("   frame {}".format(frm.function()))
		frm = frm.older()
		count = count +1

	f0 = ShellVar_getI(vFUNC, 0)
	bgtrace("f0="+f0)

	s = 'one\ntwo\nthree\n'
	bgtrace(s, indentLevel=1)

	# if vFUNC:
	# 	print("yes "+str(int(vFUNC)))
	# 	print("yes "+str(vFUNC.address))
	# 	print("yes "+str(vFUNC.dereference().address))
	# else:
	# 	print("no")
	# cmd = "array_reference((ARRAY *)("+str(int(vFUNC))+")->value, 0)"
	# print(cmd)
	# f0=gdb.parse_and_eval(cmd)
	# if f0:
	# 	print("f0="+str(f0))
	# else:
	# 	print("didnt work f0 is bad")

# class MIEcho(gdb.MICommand):
#     """Echo arguments passed to the command."""
#
#     def __init__(self, name, mode):
#         self._mode = mode
#         super(MIEcho, self).__init__(name)
#
#     def invoke(self, argv):
#         if self._mode == 'dict':
#             return { 'dict': { 'argv' : argv } }
#         elif self._mode == 'list':
#             return { 'list': argv }
#         else:
#             return { 'string': ", ".join(argv) }
#
#
# MIEcho("-echo-dict", "dict")
# MIEcho("-echo-list", "list")
# MIEcho("-echo-string", "string")



class ShellVarPrinter:
	def __init__(self,val):
		self.val = val

	def to_string(self):
		try:
			return self.val['name'].string()
		except:
			bgtrace("ShellVarPrinter::to_string(): caught exception", traceback.format_exc())
			return "<error>"

	def children(self):
		try:
			# from bash variable.h (it seems that gdb can not access defines the way I am building bash)
			att_exported  = 0x0000001
			att_readonly  = 0x0000002
			att_array     = 0x0000004
			att_function  = 0x0000008
			att_integer   = 0x0000010
			att_local     = 0x0000020
			att_assoc     = 0x0000040
			att_trace     = 0x0000080
			att_uppercase = 0x0000100
			att_lowercase = 0x0000200
			att_capcase   = 0x0000400
			att_nameref   = 0x0000800

			yield 'name',self.val['name'].string()

			type = 'simple'
			if (self.val['attributes'] & att_function): type = 'function'
			if (self.val['attributes'] & att_array):    type = 'array'
			if (self.val['attributes'] & att_assoc):    type = 'assoc'
			if (self.val['attributes'] & att_nameref):  type = 'nameref'
			yield 'type', type

			attr = ""
			if (self.val['attributes'] & att_exported):  attr = attr + 'exported,'
			if (self.val['attributes'] & att_readonly):  attr = attr + 'readonly,'
			if (self.val['attributes'] & att_array):     attr = attr + 'array,'
			if (self.val['attributes'] & att_function):  attr = attr + 'function,'
			if (self.val['attributes'] & att_integer):   attr = attr + 'integer,'
			if (self.val['attributes'] & att_local):     attr = attr + 'local,'
			if (self.val['attributes'] & att_assoc):     attr = attr + 'assoc,'
			if (self.val['attributes'] & att_trace):     attr = attr + 'trace,'
			if (self.val['attributes'] & att_uppercase): attr = attr + 'uppercase,'
			if (self.val['attributes'] & att_lowercase): attr = attr + 'lowercase,'
			if (self.val['attributes'] & att_capcase):   attr = attr + 'capcase,'
			if (self.val['attributes'] & att_nameref):   attr = attr + 'nameref,'
			yield 'attr', attr

			value = ""
			if (type == "simple"):   value = self.val['value'].string()
			if (type == "nameref"):  value = self.val['value'].string()
			if (type == "function"):
				pass
				# funcType = gdb.lookup_type('COMMAND')
				# func = self.val.cast(funcType)
				# value = self.val['value']
			if (value != ""):
				yield 'value', value
		except:
			bgtrace("ShellVarPrinter::children(): caught exception", traceback.format_exc())


	def displayHint(self):
		return 'map'



class WordListPrinter:
	def __init__(self, val):
		self.val = val
		#bgtrace("WordListPrinter addr =",val.address)

	def to_string(self):
		try:
			s = WordList_toString(self.val);
		except:
			bgtrace("WordListPrinter::to_string(): caught exception", traceback.format_exc())
			s = '<error reading words>'
		return s;


class WordDescPrinter:
	def __init__(self, val):
		self.val = val

	def to_string(self):
		try:
			return self.val['word'].string()
		except Exception as e:
			bgtrace("WordDescPrinter::to_string(): caught exception", traceback.format_exc())
			return str(e)


class CommandPrinter:
	def __init__(self, val):
		self.val = val

	def to_string(self):
		try:
			self.cmdSummary = ShellCmd_getSummaryText(self.val);
			return "'{}'".format(self.cmdSummary)
		except:
			bgtrace("CommandPrinter::to_string(): caught exception", traceback.format_exc())
		# not returning seems to tell gdb to try the next pretty-printer

	def children(self):
		try:
			self.typeStr = BGGetValue(self.val['type'])
			return [ ("type",self.typeStr), ("flags",self.val['flags']), ("line",self.val['line'])]
		except:
			bgtrace("CommandPrinter::children(): caught exception", traceback.format_exc())

class CmdDynStructPrinter:
	def __init__(self, val, cmdTypeStr):
		self.val = val
		self.cmdTypeStr = cmdTypeStr

	def to_string(self):
		try:
			self.cmdSummary = CmdDynStruct_getSummaryText(self.val, self.cmdTypeStr);
		except:
			self.cmdSummary = "<error: evaluating command summary>"
		bgtrace("self.cmdSummary='{}'".format(self.cmdSummary))
		return "'{}'".format(self.cmdSummary)

	def children(self):
		children = []
		for field in self.val.type.fields():
			try:
				children.append( (field.name, self.val[field.name]) );
			except Exception as e:
				children.append( (field.name, '<error: {}>'.format(str(e))) );
		return children


class PointerPrinter:
	def __init__(self, val):
		self.val = val
		if val.type.code != gdb.TYPE_CODE_PTR:
			raise Exception("PointerPrinter called with a val that is not a gdb.TYPE_CODE_PTR")

	def to_string(self):
		global bgShowPtrAddr

		addrInt = int(self.val);
		if addrInt == 0:
			return "0x0"

		typeStr = str(self.val.type)
		if typeStr == "PROCESS *" or re.search("void",typeStr) or re.search("\*\*$",typeStr):
			return "0x{:x}".format(addrInt)

		try:
			gdb.selected_inferior().read_memory(self.val,1)
		except:
			bgtrace("PointerPrinter::to_string(): reading one byte threw exception", traceback.format_exc())
			return "0x{:x} <invalid address>".format(addrInt)
		try:
			derefVal = self.val.dereference();
			if derefVal.type.code == gdb.TYPE_CODE_PTR:
				return "0x{:x} <deref yielded another ptr so stopped>".format(addrInt)
			# return the value which will recurse printy printer lookup
			if bgShowPtrAddr.value:
				bgtrace("!!! PointerPrinter temp self.val.type=",self.val.type, derefVal.type)
				return "(0x{:x}) {}".format(addrInt, str(derefVal ) );
			else:
				return derefVal;
		except:
			bgtrace("PointerPrinter::to_string(): dereference() threw exception", traceback.format_exc())
			return "0x{:x} <dereference failed>".format(addrInt)

class BadPointerPrinter:
	def __init__(self, val):
		self.val = val

	def to_string(self):
		try:
			_bgtrace("bad pointer .... \n")
			return "0x{:x} <bad ptr>".format(str(int(self.val)))
		except:
			bgtrace("BadPointerPrinter::to_string(): threw exception accessing ptr val as a long", traceback.format_exc())


class CharStarPrinter:
	def __init__(self, val):
		self.val = val

	def to_string(self):
		ptrVal = int(self.val)
		if ptrVal==0:
			return "0x0"
		try:
			return "'{}'".format(self.val.string());
		except:
			bgtrace("CharStarPrinter::to_string(): dereference() threw exception", traceback.format_exc())
			return "0x{} <invalid mem loc>".format(ptrVal)


def isAgdbBashMatch(val):
	type = str(val.type.unqualified())
	# if type != str(val.type):
	# 	_bgtrace("### isAgdbBashMatch({} original:{})\n".format(type, str(val.type)));

	# for some unknown reason, we get things like 'COMMAND **' when eval a var of type "COMMAND *"
	# ignoring them seems to work fine
	if re.search("\*\*$", type):
		return None;

	if type == 'char *':         return CharStarPrinter(val)

	# # We cant dereference all unless we add infinite loop detection and limits for large arrays
	# # it almost works  but stopping on a frame with the wrong locals can blow it up
	# # dereference all ptrs -- PointerPrinter will detect null and invalid addresses
	# if val.type.code == gdb.TYPE_CODE_PTR:
	# 	#if re.search("\*$", type):
	# 	return PointerPrinter(val)

	if type == 'WORD_DESC *':    return PointerPrinter(val)
	if type == 'WORD_LIST *':    return PointerPrinter(val)
	if type == 'SHELL_VAR *':    return PointerPrinter(val)
	if type == 'COMMAND *':      return PointerPrinter(val)
	if type == 'FOR_COM *':      return PointerPrinter(val)
	if type == 'CASE_COM *':     return PointerPrinter(val)
	if type == 'WHILE_COM *':    return PointerPrinter(val)
	if type == 'IF_COM *':       return PointerPrinter(val)
	if type == 'SIMPLE_COM *':   return PointerPrinter(val)
	if type == 'SELECT_COM *':   return PointerPrinter(val)
	if type == 'CONNECTION *':   return PointerPrinter(val)
	if type == 'FUNCTION_DEF *': return PointerPrinter(val)
	if type == 'GROUP_COM *':    return PointerPrinter(val)
	if type == 'ARITH_COM *':    return PointerPrinter(val)
	if type == 'COND_COM *':     return PointerPrinter(val)
	if type == 'ARITH_FOR_COM *':return PointerPrinter(val)
	if type == 'SUBSHELL_COM *': return PointerPrinter(val)
	if type == 'COPROC_COM *':   return PointerPrinter(val)
	if type == 'arrayind_t *':   return PointerPrinter(val)


	if type == 'WORD_DESC':    return WordDescPrinter(val)
	if type == 'WORD_LIST':    return WordListPrinter(val)
	if type == 'SHELL_VAR':    return ShellVarPrinter(val)
	if type == 'COMMAND':      return CommandPrinter(val)

	if type == 'FOR_COM':      return CmdDynStructPrinter(val,'FOR_COM')
	if type == 'CASE_COM':     return CmdDynStructPrinter(val,'CASE_COM')
	if type == 'WHILE_COM':    return CmdDynStructPrinter(val,'WHILE_COM')
	if type == 'IF_COM':       return CmdDynStructPrinter(val,'IF_COM')
	if type == 'SIMPLE_COM':   return CmdDynStructPrinter(val,'SIMPLE_COM')
	if type == 'SELECT_COM':   return CmdDynStructPrinter(val,'SELECT_COM')
	if type == 'CONNECTION':   return CmdDynStructPrinter(val,'CONNECTION')
	if type == 'FUNCTION_DEF': return CmdDynStructPrinter(val,'FUNCTION_DEF')
	if type == 'GROUP_COM':    return CmdDynStructPrinter(val,'GROUP_COM')
	if type == 'ARITH_COM':    return CmdDynStructPrinter(val,'ARITH_COM')
	if type == 'COND_COM':     return CmdDynStructPrinter(val,'COND_COM')
	if type == 'ARITH_FOR_COM':return CmdDynStructPrinter(val,'ARITH_FOR_COM')
	if type == 'SUBSHELL_COM': return CmdDynStructPrinter(val,'SUBSHELL_COM')
	if type == 'COPROC_COM':   return CmdDynStructPrinter(val,'COPROC_COM')

	return None;

gdb.pretty_printers = list(filter(lambda x: getattr(x,'__name__','')!='isAgdbBashMatch', gdb.pretty_printers))
gdb.pretty_printers.append(isAgdbBashMatch)
#bgtrace(gdb.pretty_printers)


class SymValueWrapper(object):
	def __init__(self, symbol, value):
		self.sym = symbol
		self.val = value
	def value(self):
		return self.val
	def symbol(self):
		return self.sym

class BashFrameDecorator(FrameDecorator):

	def __init__(self, frame):
		super(BashFrameDecorator, self).__init__(frame)
		#bgtrace("#### decorator ctor")

	def frame_locals(self):
		origFrm = self.inferior_frame()
		vars = []
		try:
			block = origFrm.block()
		except:
			return None

		# add all the non-arg symbols in this block.
		for sym in block:
			if sym.is_argument:
				continue
			vars.append(SymValueWrapper(sym,None))

		while block and not block.is_global:
			block = block.superblock;

		vars.append(SymValueWrapper("foo", "99"))

		# CRITICALTODO: change to use block.global_block and block.static_block
		if block:
			for sym in block:
				if not sym.is_valid():
					bgtrace("   FrmDec:frame_locals: skipped invalid symbol "+sym.name)
					continue
				if sym.is_function:
					#bgtrace("   FrmDec:frame_locals: skipped function "+sym.name)
					continue

				try:
					vars.append(SymValueWrapper("GBL:"+sym.name,sym.value()))
				except Exception as e:
					vars.append(SymValueWrapper("GBL:"+sym.name,"<error: "+str(e)+">"))
					#bgtrace("   FrmDec:frame_locals: skipped '"+sym.name+"' error="+str(e), traceback.format_exc())


		# Add an example of a synthetic local variable.
		vars.append(SymValueWrapper("bar", 99))

		return vars

	def function(self):
		origFrm = self.inferior_frame()
		funcName = str(origFrm.name())
		if 'execute_builtin_or_function' == funcName:
			s = WordList_toString(origFrm.block()['words'].value(origFrm))
			if s:
				return "{}=SH_CMD: {}".format(funcName,s)

		if 'execute_command' == funcName and origFrm.older() and origFrm.older().name() == 'reader_loop':
			vCmd = origFrm.block()['command'].value(origFrm)
			s = ShellCmd_getSummaryText(vCmd)
			if s:
				return "{}=SH_CMD: {}".format(funcName,s)

		if '_run_trap_internal' == funcName:
			signalName = signalToString(int(origFrm.block()['sig'].value(origFrm)))
			try:
				trapCmd = origFrm.block()['trap_command'].value(origFrm).string()
				trapSummary = re.sub("\n.*$","", trapCmd)
				if len(trapSummary) > 40:
					trapSummary = trapSummary[0:40]
				if trapSummary != trapCmd:
					trapSummary = trapSummary + " ..."
			except Exception as e:
				bgtrace("!!! except while making trapSummary " + e)
				trapSummary = '...'
			return "{}=Trap<{}> '{}'".format(funcName,signalName, trapSummary)


		return funcName



class BashFrameIterator:
	def __init__(self):
		self.name     = "BashFrameIterator"
		self.priority = 100
		self.enabled  = True

		# Register this frame filter with the global frame_filters dictionary.
		gdb.frame_filters[self.name] = self
		bgtrace("#### registered "+self.name)

	def filter(self, frame_iter):
		if bgFrameFilters.value:
			wrapped_iter = map(BashFrameDecorator, frame_iter)
		else:
			wrapped_iter = frame_iter
		return wrapped_iter

#When ptr vars are automatically dereferenced, should the ptr's value be displayed also
class Param_bgShowPtrAddr(gdb.Parameter):
	def __init__ (self):
		"""(my class doc)"""
		super (Param_bgShowPtrAddr, self).__init__ (
				'bgShowPtrAddr',
				gdb.COMMAND_DATA,
				gdb.PARAM_BOOLEAN)
		self.value = False
		self.set_doc = "(my set doc)"
		self.show_doc = "(my show doc)"

bgShowPtrAddr = Param_bgShowPtrAddr()

class Param_bgtraceOn(gdb.Parameter):
	def __init__ (self):
		"""(my class doc)"""
		super (Param_bgtraceOn, self).__init__ (
				'bgtraceOn',
				gdb.COMMAND_DATA,
				gdb.PARAM_BOOLEAN)
		self.value = True
		self.set_doc = "(my set doc)"
		self.show_doc = "(my show doc)"

bgtraceOn = Param_bgtraceOn()

class Param_bgFrameFilters(gdb.Parameter):
	def __init__ (self):
		"""(my class doc)"""
		super (Param_bgFrameFilters, self).__init__ (
				'bgFrameFilters',
				gdb.COMMAND_DATA,
				gdb.PARAM_BOOLEAN)
		self.value = True
		self.set_doc = "(my set doc)"
		self.show_doc = "(my show doc)"

bgFrameFilters = Param_bgFrameFilters()

# gdb.MICommand was introduced in gdb 12 in commit 740b42ceb7c7ae7b5343183782973576a93bc7b3
# class stepOutToFrmNum(gdb.MICommand):
# 	def __init__(self):
# 		super(stepOutToFrmNum, self).__init__("-bg-run-to-stack-frame")
#
# 	def invoke(self, argv):
#		pass

# class MyFinishBreakpoint (gdb.FinishBreakpoint)
# 	def stop (self):
# 		print ("normal finish")
# 		return True
#
# 	def out_of_scope ():
# 		print ("abnormal finish")

def stepOutToFrmNum(frmNum):
	frm = gdb.newest_frame()
	for i in range(frmNum):
		frm = frm.older()
	fbp = gdb.FinishBreakpoint(frm, True);
	gdb.execute("continue")


bgFrmItr = BashFrameIterator()
