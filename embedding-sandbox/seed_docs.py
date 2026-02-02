#!/usr/bin/env python3
"""
SEED DOCS - Pre-load Python, JavaScript & TypeScript documentation for PCA training

This ensures the AI model always has enough samples for dimensionality
reduction (PCA) to work properly. Run once on fresh install.

Docs are stored in specmem_overflow.training_data and persist across restarts.

Included documentation:
- Python built-in functions and data structures
- JavaScript built-in methods (Array, Object, String, Math, Promise, etc.)
- TypeScript type system, error patterns, and best practices
- Programming concepts and patterns
"""

import os
import sys
import json
import hashlib
import time
from typing import List, Dict

import psycopg2
from psycopg2.extras import Json

# Database config
OVERFLOW_DB = {
    'host': os.environ.get('SPECMEM_DB_HOST', 'localhost'),
    'port': os.environ.get('SPECMEM_DB_PORT', '5432'),
    'dbname': os.environ.get('OVERFLOW_DB_NAME', 'specmem_overflow'),
    'user': os.environ.get('SPECMEM_DB_USER', 'specmem_westayunprofessional'),
    'password': os.environ.get('SPECMEM_DB_PASSWORD', 'specmem_westayunprofessional')
}

# Minimum samples needed for PCA
MIN_SAMPLES = 500

# Python built-in functions and their descriptions
PYTHON_DOCS = [
    ("abs(x)", "Return the absolute value of a number. The argument may be an integer, a floating point number, or an object implementing __abs__()."),
    ("aiter(async_iterable)", "Return an asynchronous iterator for an asynchronous iterable."),
    ("all(iterable)", "Return True if all elements of the iterable are true (or if the iterable is empty)."),
    ("any(iterable)", "Return True if any element of the iterable is true. If the iterable is empty, return False."),
    ("ascii(object)", "Return a string containing a printable representation of an object, escaping non-ASCII characters."),
    ("bin(x)", "Convert an integer number to a binary string prefixed with '0b'."),
    ("bool(x)", "Return a Boolean value, True or False. x is converted using the standard truth testing procedure."),
    ("breakpoint(*args, **kws)", "This function drops you into the debugger at the call site."),
    ("bytearray([source[, encoding[, errors]]])", "Return a new array of bytes. The bytearray class is a mutable sequence of integers in the range 0 <= x < 256."),
    ("bytes([source[, encoding[, errors]]])", "Return a new bytes object which is an immutable sequence of integers in the range 0 <= x < 256."),
    ("callable(object)", "Return True if the object argument appears callable, False if not."),
    ("chr(i)", "Return the string representing a character whose Unicode code point is the integer i."),
    ("classmethod(function)", "Transform a method into a class method. A class method receives the class as implicit first argument."),
    ("compile(source, filename, mode)", "Compile the source into a code or AST object. Code objects can be executed by exec() or eval()."),
    ("complex([real[, imag]])", "Return a complex number with the value real + imag*1j or convert a string or number to a complex number."),
    ("delattr(object, name)", "Delete the named attribute from object, if the object allows it."),
    ("dict(**kwarg)", "Create a new dictionary. The dict object is the dictionary class."),
    ("dir([object])", "Without arguments, return the list of names in the current local scope. With an argument, return a list of valid attributes for that object."),
    ("divmod(a, b)", "Take two non-complex numbers as arguments and return a pair of numbers consisting of their quotient and remainder."),
    ("enumerate(iterable, start=0)", "Return an enumerate object. iterable must be a sequence, an iterator, or some other object which supports iteration."),
    ("eval(expression[, globals[, locals]])", "The expression argument is parsed and evaluated as a Python expression."),
    ("exec(object[, globals[, locals]])", "This function supports dynamic execution of Python code."),
    ("filter(function, iterable)", "Construct an iterator from those elements of iterable for which function returns true."),
    ("float([x])", "Return a floating point number constructed from a number or string x."),
    ("format(value[, format_spec])", "Convert a value to a formatted representation, as controlled by format_spec."),
    ("frozenset([iterable])", "Return a new frozenset object, optionally with elements taken from iterable."),
    ("getattr(object, name[, default])", "Return the value of the named attribute of object. name must be a string."),
    ("globals()", "Return the dictionary implementing the current module namespace."),
    ("hasattr(object, name)", "Return True if the string is the name of one of the object's attributes, False if not."),
    ("hash(object)", "Return the hash value of the object (if it has one). Hash values are integers."),
    ("help([object])", "Invoke the built-in help system. This function is intended for interactive use."),
    ("hex(x)", "Convert an integer number to a lowercase hexadecimal string prefixed with '0x'."),
    ("id(object)", "Return the identity of an object. This is an integer which is guaranteed to be unique and constant for this object during its lifetime."),
    ("input([prompt])", "If the prompt argument is present, it is written to standard output without a trailing newline."),
    ("int([x])", "Return an integer object constructed from a number or string x, or return 0 if no arguments are given."),
    ("isinstance(object, classinfo)", "Return True if the object argument is an instance of the classinfo argument."),
    ("issubclass(class, classinfo)", "Return True if class is a subclass of classinfo."),
    ("iter(object[, sentinel])", "Return an iterator object. The first argument is interpreted very differently depending on the presence of the second argument."),
    ("len(s)", "Return the length (the number of items) of an object. The argument may be a sequence or collection."),
    ("list([iterable])", "Rather than being a function, list is actually a mutable sequence type."),
    ("locals()", "Return a dictionary representing the current local symbol table."),
    ("map(function, iterable, ...)", "Return an iterator that applies function to every item of iterable, yielding the results."),
    ("max(iterable, *[, key, default])", "Return the largest item in an iterable or the largest of two or more arguments."),
    ("memoryview(object)", "Return a memory view object created from the given argument."),
    ("min(iterable, *[, key, default])", "Return the smallest item in an iterable or the smallest of two or more arguments."),
    ("next(iterator[, default])", "Retrieve the next item from the iterator by calling its __next__() method."),
    ("object()", "Return a new featureless object. object is a base for all classes."),
    ("oct(x)", "Convert an integer number to an octal string prefixed with '0o'."),
    ("open(file, mode='r')", "Open file and return a corresponding file object. If the file cannot be opened, an OSError is raised."),
    ("ord(c)", "Given a string representing one Unicode character, return an integer representing the Unicode code point of that character."),
    ("pow(base, exp[, mod])", "Return base to the power exp; if mod is present, return base to the power exp, modulo mod."),
    ("print(*objects, sep=' ', end='\\n')", "Print objects to the text stream file, separated by sep and followed by end."),
    ("property(fget=None, fset=None, fdel=None, doc=None)", "Return a property attribute."),
    ("range(stop)", "Rather than being a function, range is actually an immutable sequence type."),
    ("repr(object)", "Return a string containing a printable representation of an object."),
    ("reversed(seq)", "Return a reverse iterator. seq must be an object which has a __reversed__() method."),
    ("round(number[, ndigits])", "Return number rounded to ndigits precision after the decimal point."),
    ("set([iterable])", "Return a new set object, optionally with elements taken from iterable."),
    ("setattr(object, name, value)", "This is the counterpart of getattr(). The arguments are an object, a string, and an arbitrary value."),
    ("slice(stop)", "Return a slice object representing the set of indices specified by range(start, stop, step)."),
    ("sorted(iterable, *, key=None, reverse=False)", "Return a new sorted list from the items in iterable."),
    ("staticmethod(function)", "Transform a method into a static method. A static method does not receive an implicit first argument."),
    ("str(object='')", "Return a str version of object."),
    ("sum(iterable, /, start=0)", "Sums start and the items of an iterable from left to right and returns the total."),
    ("super([type[, object-or-type]])", "Return a proxy object that delegates method calls to a parent or sibling class of type."),
    ("tuple([iterable])", "Rather than being a function, tuple is actually an immutable sequence type."),
    ("type(object)", "With one argument, return the type of an object. The return value is a type object."),
    ("vars([object])", "Return the __dict__ attribute for a module, class, instance, or any other object with a __dict__ attribute."),
    ("zip(*iterables, strict=False)", "Iterate over several iterables in parallel, producing tuples with an item from each one."),
    ("__import__(name)", "This function is invoked by the import statement. It is not recommended to use this function."),
    # Python data structures
    ("list.append(x)", "Add an item to the end of the list. Equivalent to a[len(a):] = [x]."),
    ("list.extend(iterable)", "Extend the list by appending all the items from the iterable."),
    ("list.insert(i, x)", "Insert an item at a given position. The first argument is the index."),
    ("list.remove(x)", "Remove the first item from the list whose value is equal to x. Raises ValueError if not found."),
    ("list.pop([i])", "Remove the item at the given position in the list, and return it."),
    ("list.clear()", "Remove all items from the list. Equivalent to del a[:]."),
    ("list.index(x[, start[, end]])", "Return zero-based index in the list of the first item whose value is equal to x."),
    ("list.count(x)", "Return the number of times x appears in the list."),
    ("list.sort(*, key=None, reverse=False)", "Sort the items of the list in place."),
    ("list.reverse()", "Reverse the elements of the list in place."),
    ("list.copy()", "Return a shallow copy of the list. Equivalent to a[:]."),
    ("dict.clear()", "Remove all items from the dictionary."),
    ("dict.copy()", "Return a shallow copy of the dictionary."),
    ("dict.get(key[, default])", "Return the value for key if key is in the dictionary, else default."),
    ("dict.items()", "Return a new view of the dictionary's items ((key, value) pairs)."),
    ("dict.keys()", "Return a new view of the dictionary's keys."),
    ("dict.pop(key[, default])", "If key is in the dictionary, remove it and return its value, else return default."),
    ("dict.popitem()", "Remove and return a (key, value) pair from the dictionary. Pairs are returned in LIFO order."),
    ("dict.setdefault(key[, default])", "If key is in the dictionary, return its value. If not, insert key with a value of default."),
    ("dict.update([other])", "Update the dictionary with the key/value pairs from other, overwriting existing keys."),
    ("dict.values()", "Return a new view of the dictionary's values."),
    ("set.add(elem)", "Add element elem to the set."),
    ("set.remove(elem)", "Remove element elem from the set. Raises KeyError if elem is not contained."),
    ("set.discard(elem)", "Remove element elem from the set if it is present."),
    ("set.pop()", "Remove and return an arbitrary element from the set. Raises KeyError if the set is empty."),
    ("set.clear()", "Remove all elements from the set."),
    ("str.capitalize()", "Return a copy of the string with its first character capitalized and the rest lowercased."),
    ("str.casefold()", "Return a casefolded copy of the string. Casefolded strings may be used for caseless matching."),
    ("str.center(width[, fillchar])", "Return centered in a string of length width. Padding is done using the specified fill character."),
    ("str.count(sub[, start[, end]])", "Return the number of non-overlapping occurrences of substring sub."),
    ("str.encode(encoding='utf-8', errors='strict')", "Return an encoded version of the string as a bytes object."),
    ("str.endswith(suffix[, start[, end]])", "Return True if the string ends with the specified suffix, otherwise return False."),
    ("str.expandtabs(tabsize=8)", "Return a copy of the string where all tab characters are replaced by spaces."),
    ("str.find(sub[, start[, end]])", "Return the lowest index in the string where substring sub is found."),
    ("str.format(*args, **kwargs)", "Perform a string formatting operation. The string on which this method is called can contain literal text or replacement fields."),
    ("str.index(sub[, start[, end]])", "Like find(), but raise ValueError when the substring is not found."),
    ("str.isalnum()", "Return True if all characters in the string are alphanumeric and there is at least one character."),
    ("str.isalpha()", "Return True if all characters in the string are alphabetic and there is at least one character."),
    ("str.isascii()", "Return True if the string is empty or all characters in the string are ASCII."),
    ("str.isdecimal()", "Return True if all characters in the string are decimal characters and there is at least one character."),
    ("str.isdigit()", "Return True if all characters in the string are digits and there is at least one character."),
    ("str.islower()", "Return True if all cased characters in the string are lowercase and there is at least one cased character."),
    ("str.isnumeric()", "Return True if all characters in the string are numeric characters and there is at least one character."),
    ("str.isspace()", "Return True if there are only whitespace characters in the string and there is at least one character."),
    ("str.istitle()", "Return True if the string is a titlecased string and there is at least one character."),
    ("str.isupper()", "Return True if all cased characters in the string are uppercase and there is at least one cased character."),
    ("str.join(iterable)", "Return a string which is the concatenation of the strings in iterable."),
    ("str.ljust(width[, fillchar])", "Return the string left justified in a string of length width."),
    ("str.lower()", "Return a copy of the string with all the cased characters converted to lowercase."),
    ("str.lstrip([chars])", "Return a copy of the string with leading characters removed."),
    ("str.partition(sep)", "Split the string at the first occurrence of sep, return a 3-tuple."),
    ("str.replace(old, new[, count])", "Return a copy of the string with all occurrences of substring old replaced by new."),
    ("str.rfind(sub[, start[, end]])", "Return the highest index in the string where substring sub is found."),
    ("str.rindex(sub[, start[, end]])", "Like rfind() but raises ValueError when the substring is not found."),
    ("str.rjust(width[, fillchar])", "Return the string right justified in a string of length width."),
    ("str.rpartition(sep)", "Split the string at the last occurrence of sep, return a 3-tuple."),
    ("str.rsplit(sep=None, maxsplit=-1)", "Return a list of the words in the string, using sep as the delimiter string."),
    ("str.rstrip([chars])", "Return a copy of the string with trailing characters removed."),
    ("str.split(sep=None, maxsplit=-1)", "Return a list of the words in the string, using sep as the delimiter string."),
    ("str.splitlines([keepends])", "Return a list of the lines in the string, breaking at line boundaries."),
    ("str.startswith(prefix[, start[, end]])", "Return True if string starts with the prefix, otherwise return False."),
    ("str.strip([chars])", "Return a copy of the string with leading and trailing characters removed."),
    ("str.swapcase()", "Return a copy of the string with uppercase characters converted to lowercase and vice versa."),
    ("str.title()", "Return a titlecased version of the string where words start with an uppercase character."),
    ("str.upper()", "Return a copy of the string with all the cased characters converted to uppercase."),
    ("str.zfill(width)", "Return a copy of the string left filled with ASCII '0' digits to make a string of length width."),

    # === Python Error Patterns and Exception Handling ===
    # TypeError Patterns
    ("TypeError: 'NoneType' object is not subscriptable", "Error when trying to index None. Fix: Check if variable is None before accessing. Example: if data is not None: data[0]. Use .get() for dicts or default values."),
    ("TypeError: 'NoneType' object is not iterable", "Error when iterating over None. Fix: Check for None before loop. Example: for item in (data or []). Or use: if data: for item in data."),
    ("TypeError: 'NoneType' object is not callable", "Error when calling None as function. Common cause: method returns None and result is called. Fix: Check return values."),
    ("TypeError: unsupported operand type(s)", "Error when using operators with incompatible types. Example: '5' + 3. Fix: Convert types explicitly: int('5') + 3 or str(5) + '3'."),
    ("TypeError: can only concatenate str (not 'int') to str", "Error when concatenating string with non-string. Fix: Use str() conversion or f-strings: f'{text}{number}'."),
    ("TypeError: object of type 'X' has no len()", "Error when calling len() on object without __len__. Fix: Check type supports len() or implement __len__ method."),
    ("TypeError: unhashable type: 'list'", "Error when using mutable type as dict key or set element. Fix: Use tuple instead of list: {tuple(mylist): value}."),
    ("TypeError: argument of type 'NoneType' is not iterable", "Error with 'in' operator on None. Fix: Check for None: if data and item in data."),
    ("TypeError: 'X' object does not support item assignment", "Error assigning to immutable type (tuple, string). Fix: Convert to list, modify, convert back."),
    ("TypeError: missing required positional argument", "Error when function call missing argument. Fix: Provide all required arguments or use default values."),
    ("TypeError: takes X positional arguments but Y were given", "Error with wrong number of arguments. Fix: Check function signature and adjust call."),

    # ValueError Patterns
    ("ValueError: invalid literal for int()", "Error converting non-numeric string to int. Fix: Validate input or use try/except: try: int(s) except ValueError: handle_error()."),
    ("ValueError: list.remove(x): x not in list", "Error removing non-existent element. Fix: Check with 'in' first or use try/except."),
    ("ValueError: too many values to unpack", "Error when unpacking has mismatched count. Fix: Ensure left side matches iterable length or use *rest."),
    ("ValueError: not enough values to unpack", "Error when unpacking from shorter iterable. Fix: Check length or use default: a, b = (data + [None, None])[:2]."),
    ("ValueError: substring not found", "Error from str.index() when substring missing. Fix: Use str.find() which returns -1, or check with 'in' first."),
    ("ValueError: could not convert string to float", "Error converting non-numeric to float. Fix: Validate input, handle commas/currency, use try/except."),

    # KeyError Patterns
    ("KeyError: 'X'", "Error accessing missing dict key. Fix: Use dict.get(key, default) or check with 'in': if key in mydict."),
    ("KeyError vs dict.get() pattern", "Best practice: Use data.get('key') instead of data['key'] for optional keys. Returns None if missing, or specify default: data.get('key', 'default')."),
    ("KeyError in nested dicts", "Error accessing nested missing key. Fix: Use chained .get(): data.get('a', {}).get('b', default)."),
    ("KeyError with defaultdict", "Solution: Use collections.defaultdict(list) or defaultdict(int) to auto-create missing keys with default values."),

    # AttributeError Patterns
    ("AttributeError: 'NoneType' object has no attribute", "Error calling method on None. Fix: Check for None before method call: if obj is not None: obj.method()."),
    ("AttributeError: 'X' object has no attribute 'Y'", "Error accessing non-existent attribute. Fix: Use hasattr(obj, 'attr') or getattr(obj, 'attr', default)."),
    ("AttributeError: 'str' object has no attribute 'append'", "Error using list method on string. Strings are immutable. Fix: Use concatenation or list()."),
    ("AttributeError: module has no attribute", "Error from incorrect import or missing function. Fix: Check module documentation and import statement."),

    # IndexError Patterns
    ("IndexError: list index out of range", "Error accessing index beyond list length. Fix: Check len() before access or use try/except. Safe: lst[-1] if lst else None."),
    ("IndexError: string index out of range", "Error accessing character beyond string length. Fix: Check length or use slicing which won't raise: s[0:1]."),
    ("IndexError with negative indices", "Negative indices count from end. -1 is last element. IndexError if abs(index) > len(list)."),

    # NameError Patterns
    ("NameError: name 'X' is not defined", "Error using undefined variable. Fix: Define before use, check spelling, ensure proper scope, add imports."),
    ("NameError from scope issues", "Variables in functions have local scope. Fix: Use global/nonlocal keywords or pass as parameters."),
    ("NameError: name 'X' is not defined (circular import)", "Error from circular imports. Fix: Move import inside function, restructure modules, or use TYPE_CHECKING."),

    # IndentationError Patterns
    ("IndentationError: expected an indented block", "Error when code block has no body. Fix: Add pass statement or proper indentation after if/for/def/class."),
    ("IndentationError: unexpected indent", "Error from extra indentation. Fix: Align with surrounding code, use consistent spaces/tabs."),
    ("IndentationError: unindent does not match", "Error from inconsistent indentation levels. Fix: Use 4 spaces consistently, never mix tabs and spaces."),
    ("TabError: inconsistent use of tabs and spaces", "Error mixing tabs and spaces. Fix: Configure editor to use spaces only, run python -tt to detect."),

    # ModuleNotFoundError and ImportError
    ("ModuleNotFoundError: No module named 'X'", "Error when module not installed or in path. Fix: pip install X, check spelling, verify PYTHONPATH."),
    ("ImportError: cannot import name 'X'", "Error when name doesn't exist in module. Fix: Check available names with dir(module), verify version compatibility."),
    ("ImportError: attempted relative import with no known parent package", "Error with relative imports in script. Fix: Run as module: python -m package.module."),
    ("ImportError: circular import", "Error from modules importing each other. Fix: Restructure code, use lazy imports, or import inside functions."),

    # UnicodeDecodeError and Encoding
    ("UnicodeDecodeError: 'utf-8' codec can't decode byte", "Error reading file with wrong encoding. Fix: Specify encoding: open(file, encoding='latin-1') or use errors='ignore'."),
    ("UnicodeEncodeError: 'ascii' codec can't encode", "Error encoding non-ASCII character. Fix: Use .encode('utf-8') or specify encoding in open()."),
    ("UnicodeDecodeError handling strategies", "Options: errors='ignore' (skip), 'replace' (use ?), 'backslashreplace', or detect encoding with chardet library."),

    # FileNotFoundError and OSError
    ("FileNotFoundError: No such file or directory", "Error opening non-existent file. Fix: Check path with os.path.exists(), use pathlib, or try/except."),
    ("PermissionError: Permission denied", "Error accessing protected file. Fix: Check file permissions, run with appropriate privileges, or handle exception."),
    ("IsADirectoryError: Is a directory", "Error opening directory as file. Fix: Check with os.path.isfile() before opening."),

    # RuntimeError and RecursionError
    ("RuntimeError: dictionary changed size during iteration", "Error modifying dict while iterating. Fix: Iterate over list(dict.keys()) or dict.copy()."),
    ("RecursionError: maximum recursion depth exceeded", "Error from infinite or deep recursion. Fix: Add base case, use iteration, or increase sys.setrecursionlimit()."),
    ("RuntimeError: generator already executing", "Error from recursive generator call. Fix: Don't call next() on generator from within itself."),

    # ZeroDivisionError
    ("ZeroDivisionError: division by zero", "Error dividing by zero. Fix: Check divisor before division or use try/except."),
    ("ZeroDivisionError: integer division or modulo by zero", "Same error for // and %. Fix: if divisor != 0: result = a // divisor."),

    # StopIteration
    ("StopIteration handling", "Raised when iterator exhausted. Fix: Use for loop instead of next(), or catch exception with default: next(iter, default)."),

    # AssertionError
    ("AssertionError patterns", "Raised by assert statement when condition false. Use for debugging, not production validation. Can be disabled with -O flag."),

    # === Python Common Bugs and Antipatterns ===
    ("Mutable default argument bug", "Bug: def f(lst=[]). List is shared between calls! Fix: def f(lst=None): lst = lst or [] or lst = lst if lst is not None else []."),
    ("Late binding closure bug", "Bug: lambdas in loop capture variable by reference. Fix: Use default argument: lambda x=x: x, or functools.partial."),
    ("Modifying list while iterating", "Bug: for item in lst: lst.remove(item). Skips elements! Fix: Iterate over copy: for item in lst[:] or list(lst)."),
    ("String concatenation in loop", "Performance bug: result += string in loop is O(n^2). Fix: Use ''.join(list_of_strings) which is O(n)."),
    ("Using 'is' instead of '==' for values", "Bug: x is 1 may fail for large numbers. 'is' checks identity, '==' checks equality. Only use 'is' for None/True/False."),
    ("Catching bare except", "Antipattern: except: catches all including KeyboardInterrupt. Fix: Use except Exception: for all errors or specific exceptions."),
    ("Ignoring exceptions silently", "Antipattern: except: pass. Hides bugs. Fix: At minimum log the error or re-raise in finally."),
    ("Using eval() on user input", "Security bug: eval() executes arbitrary code. Fix: Use ast.literal_eval() for safe literal parsing or proper parsing."),
    ("SQL injection vulnerability", "Security bug: f'SELECT * FROM users WHERE id={user_input}'. Fix: Use parameterized queries: cursor.execute('SELECT * FROM users WHERE id=?', (user_id,))."),
    ("Shallow copy surprise", "Bug: list.copy() is shallow. Nested objects are shared. Fix: Use copy.deepcopy() for nested structures."),
    ("Boolean comparison with is", "Antipattern: if x is True. Fix: Use if x: or if x == True for boolean comparison."),
    ("Using type() for type checking", "Antipattern: type(x) == list. Misses subclasses. Fix: Use isinstance(x, list) which handles inheritance."),
    ("Global variable modification", "Bug: global var is modified unexpectedly. Fix: Avoid globals, use class attributes, or pass explicitly."),
    ("Unpacking with wrong number of values", "Bug: a, b = func() when func returns 3 values. Fix: Use starred expression: a, b, *rest = func()."),

    # === Python asyncio Patterns and Pitfalls ===
    ("asyncio.run() usage", "Entry point for async code: asyncio.run(main()). Creates event loop, runs coroutine, closes loop. Use once at top level."),
    ("async/await basics", "async def marks coroutine. await pauses execution until awaitable completes. Can only await inside async function."),
    ("asyncio.gather() pattern", "Run multiple coroutines concurrently: results = await asyncio.gather(coro1(), coro2()). Returns list of results in order."),
    ("asyncio.create_task() pattern", "Schedule coroutine to run: task = asyncio.create_task(coro()). Returns Task object. Remember to await it later."),
    ("asyncio.wait_for() timeout", "Add timeout to coroutine: await asyncio.wait_for(coro(), timeout=5.0). Raises TimeoutError if exceeded."),
    ("asyncio pitfall: forgetting await", "Bug: result = async_func() returns coroutine, not result. Fix: result = await async_func()."),
    ("asyncio pitfall: blocking in async", "Bug: Using time.sleep() blocks event loop. Fix: Use await asyncio.sleep() for non-blocking delay."),
    ("asyncio pitfall: fire and forget", "Bug: asyncio.create_task(coro()) without reference. Task may be garbage collected. Fix: Keep reference or use gather."),
    ("asyncio.Queue pattern", "Thread-safe async queue: queue = asyncio.Queue(); await queue.put(item); item = await queue.get()."),
    ("asyncio.Semaphore pattern", "Limit concurrent operations: sem = asyncio.Semaphore(10); async with sem: await limited_operation()."),
    ("async context manager", "Implement __aenter__ and __aexit__ for async with. Use @asynccontextmanager decorator for simpler syntax."),
    ("async iterator", "Implement __aiter__ returning self and async __anext__. Use async for to iterate: async for item in async_iter."),

    # === Python Context Manager Patterns ===
    ("Context manager basics", "with statement ensures cleanup. Calls __enter__ on entry, __exit__ on exit (even with exceptions)."),
    ("contextlib.contextmanager", "Decorator to create context manager from generator: @contextmanager def cm(): setup(); yield resource; cleanup()."),
    ("Multiple context managers", "Combine with comma or contextlib.ExitStack: with open(f1) as a, open(f2) as b: or with ExitStack() as stack."),
    ("Custom context manager class", "Implement __enter__(self) returning resource and __exit__(self, exc_type, exc_val, exc_tb). Return True to suppress exceptions."),
    ("contextlib.suppress", "Ignore specific exceptions: with suppress(FileNotFoundError): os.remove(file). Cleaner than try/except pass."),
    ("contextlib.redirect_stdout", "Redirect stdout: with redirect_stdout(f): print('goes to file'). Useful for capturing output."),
    ("Context manager for timing", "Pattern: @contextmanager def timer(): start = time.time(); yield; print(time.time() - start)."),
    ("Nested context managers", "with A() as a: with B() as b: code. Or use ExitStack for dynamic number of context managers."),

    # === Python Decorator Patterns ===
    ("Basic decorator pattern", "def decorator(func): @wraps(func) def wrapper(*args, **kwargs): return func(*args, **kwargs); return wrapper."),
    ("Decorator with arguments", "def decorator(arg): def actual_decorator(func): @wraps(func) def wrapper(*a, **kw): return func(*a, **kw); return wrapper; return actual_decorator."),
    ("functools.wraps importance", "Always use @wraps(func) in decorators. Preserves __name__, __doc__, and other attributes of original function."),
    ("Class-based decorator", "class Decorator: def __init__(self, func): self.func = func; def __call__(self, *args): return self.func(*args)."),
    ("Decorator for methods", "First argument is self/cls. Use descriptor protocol or functools.wraps for proper method decoration."),
    ("Stacking decorators", "@d1 @d2 def f(): pass is equivalent to f = d1(d2(f)). Order matters, d2 applied first."),
    ("functools.lru_cache", "Memoization decorator: @lru_cache(maxsize=128) def expensive_func(arg): return result. Caches results."),
    ("functools.cached_property", "Lazy computed property cached after first access: @cached_property def prop(self): return expensive_computation."),
    ("dataclass decorator", "@dataclass generates __init__, __repr__, __eq__. Options: frozen=True for immutable, order=True for comparison."),
    ("property decorator", "@property for getter, @prop.setter for setter, @prop.deleter for deleter. Makes attribute access controlled."),
    ("classmethod vs staticmethod", "@classmethod receives class as first arg (cls). @staticmethod receives no implicit arg. Use classmethod for factory methods."),

    # === Python Import System Gotchas ===
    ("Relative vs absolute imports", "Absolute: from package.module import X. Relative: from .module import X. Relative only works in packages."),
    ("Circular import solutions", "1) Import inside function. 2) Import at end of module. 3) Use TYPE_CHECKING. 4) Restructure code."),
    ("TYPE_CHECKING import pattern", "from typing import TYPE_CHECKING; if TYPE_CHECKING: from module import Type. Only imported for type checkers."),
    ("__init__.py purpose", "Makes directory a package. Can be empty or contain package initialization. Controls what from package import * exports."),
    ("__all__ list", "__all__ = ['public_name'] controls from module import *. Only listed names are imported."),
    ("Importing from __main__", "Code in if __name__ == '__main__' only runs when script executed directly, not when imported."),
    ("sys.path manipulation", "sys.path.insert(0, '/path') adds to import search path. Use sparingly, prefer proper package structure."),
    ("importlib for dynamic imports", "importlib.import_module('package.module') for runtime imports. Useful for plugins."),
    ("Reloading modules", "importlib.reload(module) reloads already imported module. Doesn't reload dependencies."),
    ("Package vs module", "Module is single .py file. Package is directory with __init__.py containing modules/subpackages."),

    # === Python Type Hint Patterns ===
    ("Basic type hints", "def func(name: str, age: int) -> str: return f'{name} is {age}'. Use for documentation and type checkers."),
    ("Optional type", "from typing import Optional. Optional[str] means str | None. For parameters that can be None."),
    ("Union types", "from typing import Union. Union[int, str] or int | str (Python 3.10+). Value can be any listed type."),
    ("List, Dict, Set types", "from typing import List, Dict, Set. List[int], Dict[str, int], Set[str]. Or use list[int] in 3.9+."),
    ("Callable type", "from typing import Callable. Callable[[int, str], bool] for function type with specific signature."),
    ("TypeVar for generics", "from typing import TypeVar; T = TypeVar('T'); def first(lst: list[T]) -> T: return lst[0]."),
    ("Generic classes", "from typing import Generic, TypeVar; T = TypeVar('T'); class Box(Generic[T]): def __init__(self, item: T): self.item = item."),
    ("Protocol for structural typing", "from typing import Protocol. Define interface: class Sized(Protocol): def __len__(self) -> int: ...."),
    ("Literal types", "from typing import Literal. Literal['red', 'blue'] restricts to specific values."),
    ("TypedDict for dict shapes", "from typing import TypedDict. class User(TypedDict): name: str; age: int. Types dict with known keys."),
    ("Final for constants", "from typing import Final. MAX_SIZE: Final = 100. Indicates value should not be reassigned."),
    ("cast() for type assertions", "from typing import cast. result = cast(str, unknown_value). Tells type checker to trust the type."),
    ("@overload for multiple signatures", "from typing import overload. Define multiple @overload signatures, then implement without decorator."),
    ("Self type", "from typing import Self. def clone(self) -> Self. Returns same type as class, useful for subclasses."),
    ("ParamSpec for decorator typing", "from typing import ParamSpec; P = ParamSpec('P'). Preserves parameter types in decorators."),

    # === Python Common Module Patterns ===
    # os module
    ("os.path.join", "Join path components safely: os.path.join('dir', 'subdir', 'file.txt'). Handles separators correctly."),
    ("os.path.exists/isfile/isdir", "Check path: os.path.exists(path), os.path.isfile(path), os.path.isdir(path). Returns boolean."),
    ("os.makedirs", "Create directory tree: os.makedirs('a/b/c', exist_ok=True). exist_ok prevents error if exists."),
    ("os.environ", "Access environment: os.environ['VAR'] or os.environ.get('VAR', 'default'). Modifiable dict-like object."),
    ("os.listdir vs os.scandir", "os.listdir returns names. os.scandir returns DirEntry objects with metadata, more efficient."),

    # sys module
    ("sys.argv", "Command line arguments list. sys.argv[0] is script name. Use argparse for complex parsing."),
    ("sys.path", "Module search path list. First item is script directory or empty string for current."),
    ("sys.exit", "Exit program: sys.exit(0) for success, sys.exit(1) for error. Raises SystemExit exception."),
    ("sys.stdin/stdout/stderr", "Standard streams. Can redirect: sys.stdout = open('log.txt', 'w'). Use contextlib.redirect_stdout."),

    # json module
    ("json.loads/dumps", "Parse: json.loads(json_string). Serialize: json.dumps(obj). Returns string, not bytes."),
    ("json.load/dump", "File operations: json.load(file_obj), json.dump(obj, file_obj). Works with file objects."),
    ("json custom encoder", "class CustomEncoder(JSONEncoder): def default(self, obj): return obj.__dict__. Pass cls=CustomEncoder."),
    ("json.dumps formatting", "Pretty print: json.dumps(obj, indent=2, sort_keys=True). Human-readable output."),

    # re (regex) module
    ("re.search vs re.match", "re.match only matches at start of string. re.search finds first match anywhere. Use re.fullmatch for entire string."),
    ("re.findall", "Returns list of all matches: re.findall(r'\\d+', text). Returns groups if pattern has groups."),
    ("re.sub", "Replace matches: re.sub(r'pattern', 'replacement', text). Can use function for replacement."),
    ("re.compile", "Compile pattern for reuse: pattern = re.compile(r'\\d+'); pattern.search(text). Faster for multiple uses."),
    ("re groups", "Access groups: match.group(0) full match, match.group(1) first group. Named: (?P<name>pattern)."),

    # datetime module
    ("datetime.now/utcnow", "Current time: datetime.now() local, datetime.utcnow() UTC. Prefer datetime.now(timezone.utc)."),
    ("datetime.strftime/strptime", "Format: dt.strftime('%Y-%m-%d'). Parse: datetime.strptime('2024-01-15', '%Y-%m-%d')."),
    ("timedelta arithmetic", "Date math: datetime.now() + timedelta(days=7). Supports days, hours, minutes, seconds."),
    ("timezone handling", "Use pytz or zoneinfo for timezones: from zoneinfo import ZoneInfo; dt.replace(tzinfo=ZoneInfo('UTC'))."),

    # collections module
    ("collections.defaultdict", "Dict with default factory: d = defaultdict(list); d['key'].append(val). Auto-creates missing keys."),
    ("collections.Counter", "Count occurrences: Counter(['a','b','a']).most_common(). Supports arithmetic operations."),
    ("collections.deque", "Double-ended queue: d = deque(maxlen=10). Efficient append/pop from both ends. Useful for LRU."),
    ("collections.namedtuple", "Immutable tuple with named fields: Point = namedtuple('Point', ['x', 'y']); p = Point(1, 2)."),
    ("collections.OrderedDict", "Dict remembering insertion order. Now regular dict maintains order (3.7+). Still useful for move_to_end()."),

    # itertools module
    ("itertools.chain", "Flatten iterables: chain([1,2], [3,4]) yields 1,2,3,4. chain.from_iterable for nested."),
    ("itertools.groupby", "Group consecutive elements: groupby(sorted(data), key=func). Must sort first for non-consecutive."),
    ("itertools.combinations/permutations", "combinations('ABC', 2) yields AB,AC,BC. permutations includes order variations."),
    ("itertools.islice", "Slice iterator: islice(iterable, stop) or islice(iterable, start, stop, step). Memory efficient."),
    ("itertools.cycle", "Infinite cycle: cycle([1,2,3]) yields 1,2,3,1,2,3.... Use with islice or break condition."),

    # functools module
    ("functools.partial", "Partial function application: add5 = partial(add, 5). Creates new function with some args fixed."),
    ("functools.reduce", "Reduce iterable: reduce(lambda a,b: a+b, [1,2,3]) returns 6. Import from functools."),
    ("functools.total_ordering", "Class decorator: define __eq__ and one comparison, get all comparison operators."),
    ("functools.singledispatch", "Generic function by type: @singledispatch def process(arg): pass; @process.register(int) def _(arg): pass."),

    # pathlib module
    ("pathlib.Path basics", "Object-oriented paths: Path('dir') / 'subdir' / 'file.txt'. Cross-platform path handling."),
    ("Path.exists/is_file/is_dir", "Check: path.exists(), path.is_file(), path.is_dir(). Returns boolean."),
    ("Path.read_text/write_text", "Read: path.read_text(encoding='utf-8'). Write: path.write_text(content). Simple file I/O."),
    ("Path.glob/rglob", "Find files: path.glob('*.txt') non-recursive, path.rglob('*.txt') recursive. Returns generator."),
    ("Path.mkdir/rmdir", "Create: path.mkdir(parents=True, exist_ok=True). Remove: path.rmdir() or shutil.rmtree(path)."),
]

# JavaScript built-in methods and descriptions
JAVASCRIPT_DOCS = [
    ("Array.from(arrayLike[, mapFn[, thisArg]])", "Creates a new, shallow-copied Array instance from an array-like or iterable object."),
    ("Array.isArray(value)", "Determines whether the passed value is an Array."),
    ("Array.of(element0[, element1[, ...[, elementN]]])", "Creates a new Array instance from a variable number of arguments."),
    ("array.at(index)", "Returns the element at the specified index, allowing for positive and negative integers."),
    ("array.concat(value1[, value2[, ...[, valueN]]])", "Returns a new array comprised of this array joined with other array(s) and/or value(s)."),
    ("array.copyWithin(target, start[, end])", "Shallow copies part of an array to another location in the same array."),
    ("array.entries()", "Returns a new Array Iterator object that contains the key/value pairs for each index."),
    ("array.every(callback(element[, index[, array]])[, thisArg])", "Tests whether all elements pass the test implemented by the provided function."),
    ("array.fill(value[, start[, end]])", "Fills all elements from a start index to an end index with a static value."),
    ("array.filter(callback(element[, index[, array]])[, thisArg])", "Creates a new array with elements that pass the test implemented by the provided function."),
    ("array.find(callback(element[, index[, array]])[, thisArg])", "Returns the first element that satisfies the provided testing function."),
    ("array.findIndex(callback(element[, index[, array]])[, thisArg])", "Returns the index of the first element that satisfies the provided testing function."),
    ("array.findLast(callback(element[, index[, array]])[, thisArg])", "Returns the last element that satisfies the provided testing function."),
    ("array.flat([depth])", "Creates a new array with all sub-array elements concatenated into it recursively up to the specified depth."),
    ("array.flatMap(callback(currentValue[, index[, array]])[, thisArg])", "Maps each element using a mapping function, then flattens the result into a new array."),
    ("array.forEach(callback(currentValue[, index[, array]])[, thisArg])", "Executes a provided function once for each array element."),
    ("array.includes(valueToFind[, fromIndex])", "Determines whether an array includes a certain value among its entries."),
    ("array.indexOf(searchElement[, fromIndex])", "Returns the first index at which a given element can be found."),
    ("array.join([separator])", "Joins all elements of an array into a string."),
    ("array.keys()", "Returns a new Array Iterator object that contains the keys for each index."),
    ("array.lastIndexOf(searchElement[, fromIndex])", "Returns the last index at which a given element can be found."),
    ("array.map(callback(currentValue[, index[, array]])[, thisArg])", "Creates a new array populated with the results of calling a provided function on every element."),
    ("array.pop()", "Removes the last element from an array and returns that element."),
    ("array.push(element1[, ...[, elementN]])", "Adds one or more elements to the end of an array and returns the new length."),
    ("array.reduce(callback(accumulator, currentValue[, index[, array]])[, initialValue])", "Executes a reducer function on each element, resulting in a single output value."),
    ("array.reduceRight(callback(accumulator, currentValue[, index[, array]])[, initialValue])", "Applies a function against an accumulator and each value from right to left."),
    ("array.reverse()", "Reverses an array in place. The first element becomes the last, and the last becomes the first."),
    ("array.shift()", "Removes the first element from an array and returns that removed element."),
    ("array.slice([start[, end]])", "Returns a shallow copy of a portion of an array into a new array object."),
    ("array.some(callback(element[, index[, array]])[, thisArg])", "Tests whether at least one element passes the test implemented by the provided function."),
    ("array.sort([compareFunction])", "Sorts the elements of an array in place and returns the sorted array."),
    ("array.splice(start[, deleteCount[, item1[, item2[, ...]]]])", "Changes the contents of an array by removing or replacing existing elements."),
    ("array.toLocaleString([locales[, options]])", "Returns a string representing the elements of the array."),
    ("array.toString()", "Returns a string representing the specified array and its elements."),
    ("array.unshift(element1[, ...[, elementN]])", "Adds one or more elements to the beginning of an array and returns the new length."),
    ("array.values()", "Returns a new Array Iterator object that contains the values for each index."),
    ("Object.assign(target, ...sources)", "Copies all enumerable own properties from one or more source objects to a target object."),
    ("Object.create(proto[, propertiesObject])", "Creates a new object with the specified prototype object and properties."),
    ("Object.defineProperty(obj, prop, descriptor)", "Defines a new property directly on an object, or modifies an existing property."),
    ("Object.defineProperties(obj, props)", "Defines new or modifies existing properties directly on an object."),
    ("Object.entries(obj)", "Returns an array of a given object's own enumerable string-keyed property [key, value] pairs."),
    ("Object.freeze(obj)", "Freezes an object: other code cannot delete or change its properties."),
    ("Object.fromEntries(iterable)", "Transforms a list of key-value pairs into an object."),
    ("Object.getOwnPropertyDescriptor(obj, prop)", "Returns a property descriptor for an own property of a given object."),
    ("Object.getOwnPropertyNames(obj)", "Returns an array of all properties found directly in a given object."),
    ("Object.getOwnPropertySymbols(obj)", "Returns an array of all symbol properties found directly in a given object."),
    ("Object.getPrototypeOf(obj)", "Returns the prototype of the specified object."),
    ("Object.hasOwn(obj, prop)", "Returns true if the specified object has the indicated property as its own property."),
    ("Object.is(value1, value2)", "Determines whether two values are the same value."),
    ("Object.isExtensible(obj)", "Determines if an object is extensible (whether it can have new properties added to it)."),
    ("Object.isFrozen(obj)", "Determines if an object is frozen."),
    ("Object.isSealed(obj)", "Determines if an object is sealed."),
    ("Object.keys(obj)", "Returns an array of a given object's own enumerable property names."),
    ("Object.preventExtensions(obj)", "Prevents new properties from ever being added to an object."),
    ("Object.seal(obj)", "Seals an object, preventing new properties from being added and marking all existing properties as non-configurable."),
    ("Object.setPrototypeOf(obj, prototype)", "Sets the prototype of a specified object to another object or null."),
    ("Object.values(obj)", "Returns an array of a given object's own enumerable property values."),
    ("String.fromCharCode(num1[, ...[, numN]])", "Returns a string created from the specified sequence of UTF-16 code units."),
    ("String.fromCodePoint(num1[, ...[, numN]])", "Returns a string created by using the specified sequence of code points."),
    ("String.raw(callSite, ...substitutions)", "Returns a raw string from template literals, without processing escape sequences."),
    ("string.at(index)", "Returns the character at the specified index, allowing for positive and negative integers."),
    ("string.charAt(index)", "Returns the character at the specified index."),
    ("string.charCodeAt(index)", "Returns an integer between 0 and 65535 representing the UTF-16 code unit at the given index."),
    ("string.codePointAt(pos)", "Returns a non-negative integer that is the Unicode code point value at the given position."),
    ("string.concat(str1[, str2[, ...[, strN]]])", "Combines the text of two or more strings and returns a new string."),
    ("string.endsWith(searchString[, length])", "Determines whether a string ends with the characters of a specified string."),
    ("string.includes(searchString[, position])", "Determines whether one string may be found within another string."),
    ("string.indexOf(searchValue[, fromIndex])", "Returns the index of the first occurrence of the specified value."),
    ("string.lastIndexOf(searchValue[, fromIndex])", "Returns the index of the last occurrence of the specified value."),
    ("string.localeCompare(compareString[, locales[, options]])", "Returns a number indicating whether a reference string comes before, after, or is the same."),
    ("string.match(regexp)", "Retrieves the result of matching a string against a regular expression."),
    ("string.matchAll(regexp)", "Returns an iterator of all results matching a string against a regular expression."),
    ("string.normalize([form])", "Returns the Unicode Normalization Form of the string."),
    ("string.padEnd(targetLength[, padString])", "Pads the current string from the end with a given string."),
    ("string.padStart(targetLength[, padString])", "Pads the current string from the start with a given string."),
    ("string.repeat(count)", "Returns a new string with a specified number of copies of an existing string."),
    ("string.replace(searchFor, replaceWith)", "Returns a new string with some or all matches of a pattern replaced by a replacement."),
    ("string.replaceAll(searchFor, replaceWith)", "Returns a new string with all matches of a pattern replaced by a replacement."),
    ("string.search(regexp)", "Executes a search for a match between a regular expression and this string."),
    ("string.slice(beginIndex[, endIndex])", "Extracts a section of a string and returns it as a new string."),
    ("string.split([separator[, limit]])", "Splits a String object into an array of strings by separating the string into substrings."),
    ("string.startsWith(searchString[, position])", "Determines whether a string begins with the characters of a specified string."),
    ("string.substring(indexStart[, indexEnd])", "Returns the part of the string between the start and end indexes."),
    ("string.toLocaleLowerCase([locale, ...locales])", "Returns the string converted to lower case according to locale-specific rules."),
    ("string.toLocaleUpperCase([locale, ...locales])", "Returns the string converted to upper case according to locale-specific rules."),
    ("string.toLowerCase()", "Returns the string converted to lowercase."),
    ("string.toString()", "Returns a string representing the specified object."),
    ("string.toUpperCase()", "Returns the string converted to uppercase."),
    ("string.trim()", "Removes whitespace from both ends of a string."),
    ("string.trimEnd()", "Removes whitespace from the end of a string."),
    ("string.trimStart()", "Removes whitespace from the beginning of a string."),
    ("string.valueOf()", "Returns the primitive value of the specified object."),
    ("Math.abs(x)", "Returns the absolute value of a number."),
    ("Math.acos(x)", "Returns the arccosine (in radians) of a number."),
    ("Math.acosh(x)", "Returns the hyperbolic arccosine of a number."),
    ("Math.asin(x)", "Returns the arcsine (in radians) of a number."),
    ("Math.asinh(x)", "Returns the hyperbolic arcsine of a number."),
    ("Math.atan(x)", "Returns the arctangent (in radians) of a number."),
    ("Math.atanh(x)", "Returns the hyperbolic arctangent of a number."),
    ("Math.atan2(y, x)", "Returns the arctangent of the quotient of its arguments."),
    ("Math.cbrt(x)", "Returns the cube root of a number."),
    ("Math.ceil(x)", "Returns the smallest integer greater than or equal to a given number."),
    ("Math.clz32(x)", "Returns the number of leading zero bits in the 32-bit binary representation."),
    ("Math.cos(x)", "Returns the cosine of a number."),
    ("Math.cosh(x)", "Returns the hyperbolic cosine of a number."),
    ("Math.exp(x)", "Returns E^x, where x is the argument, and E is Euler's number."),
    ("Math.expm1(x)", "Returns subtracting 1 from exp(x)."),
    ("Math.floor(x)", "Returns the largest integer less than or equal to a given number."),
    ("Math.fround(x)", "Returns the nearest 32-bit single precision float representation of a number."),
    ("Math.hypot([value1[, value2[, ...]]])", "Returns the square root of the sum of squares of its arguments."),
    ("Math.imul(a, b)", "Returns the result of the C-like 32-bit multiplication of the two parameters."),
    ("Math.log(x)", "Returns the natural logarithm (base e) of a number."),
    ("Math.log1p(x)", "Returns the natural logarithm (base e) of 1 + a number."),
    ("Math.log10(x)", "Returns the base 10 logarithm of a number."),
    ("Math.log2(x)", "Returns the base 2 logarithm of a number."),
    ("Math.max([value1[, value2[, ...]]])", "Returns the largest of zero or more numbers."),
    ("Math.min([value1[, value2[, ...]]])", "Returns the smallest of zero or more numbers."),
    ("Math.pow(base, exponent)", "Returns base to the exponent power, that is, base^exponent."),
    ("Math.random()", "Returns a pseudo-random number between 0 and 1."),
    ("Math.round(x)", "Returns the value of a number rounded to the nearest integer."),
    ("Math.sign(x)", "Returns the sign of the x, indicating whether x is positive, negative or zero."),
    ("Math.sin(x)", "Returns the sine of a number."),
    ("Math.sinh(x)", "Returns the hyperbolic sine of a number."),
    ("Math.sqrt(x)", "Returns the positive square root of a number."),
    ("Math.tan(x)", "Returns the tangent of a number."),
    ("Math.tanh(x)", "Returns the hyperbolic tangent of a number."),
    ("Math.trunc(x)", "Returns the integer part of a number by removing any fractional digits."),
    ("Promise.all(iterable)", "Wait for all promises to be resolved, or for any to be rejected."),
    ("Promise.allSettled(iterable)", "Wait until all promises have settled (each may resolve or reject)."),
    ("Promise.any(iterable)", "Returns a promise that resolves as soon as any of the promises in the iterable fulfills."),
    ("Promise.race(iterable)", "Wait until any of the promises is resolved or rejected."),
    ("Promise.reject(reason)", "Returns a Promise object that is rejected with the given reason."),
    ("Promise.resolve(value)", "Returns a Promise object that is resolved with the given value."),
    ("promise.catch(onRejected)", "Appends a rejection handler callback to the promise."),
    ("promise.finally(onFinally)", "Appends a handler to the promise that is called when the promise is settled."),
    ("promise.then(onFulfilled[, onRejected])", "Appends fulfillment and rejection handlers to the promise."),
    ("JSON.parse(text[, reviver])", "Parses a JSON string, constructing the JavaScript value or object described by the string."),
    ("JSON.stringify(value[, replacer[, space]])", "Converts a JavaScript value to a JSON string."),
    ("console.log(...data)", "Outputs a message to the web console."),
    ("console.error(...data)", "Outputs an error message to the web console."),
    ("console.warn(...data)", "Outputs a warning message to the web console."),
    ("console.info(...data)", "Outputs an informational message to the web console."),
    ("console.debug(...data)", "Outputs a message to the console with the log level debug."),
    ("console.table(data[, columns])", "Displays tabular data as a table."),
    ("console.time(label)", "Starts a timer you can use to track how long an operation takes."),
    ("console.timeEnd(label)", "Stops a timer that was previously started by calling console.time()."),
    ("console.trace(...data)", "Outputs a stack trace to the console."),
    ("console.clear()", "Clears the console if the console allows it."),
    ("console.count([label])", "Logs the number of times this particular call to count() has been called."),
    ("console.countReset([label])", "Resets the counter used with console.count()."),
    ("console.group([label])", "Creates a new inline group in the console."),
    ("console.groupEnd()", "Exits the current inline group in the console."),
    ("console.assert(assertion, ...data)", "Writes an error message to the console if the assertion is false."),
    ("fetch(resource[, options])", "Starts the process of fetching a resource from the network, returning a promise."),
    ("setTimeout(callback, delay[, ...args])", "Sets a timer which executes a function once the timer expires."),
    ("setInterval(callback, delay[, ...args])", "Repeatedly calls a function with a fixed time delay between each call."),
    ("clearTimeout(timeoutID)", "Cancels a timeout previously established by calling setTimeout()."),
    ("clearInterval(intervalID)", "Cancels a timed, repeating action which was previously established by a call to setInterval()."),
    ("parseInt(string[, radix])", "Parses a string argument and returns an integer of the specified radix."),
    ("parseFloat(string)", "Parses an argument and returns a floating point number."),
    ("isNaN(value)", "Determines whether a value is NaN or not."),
    ("isFinite(value)", "Determines whether the passed value is a finite number."),
    ("encodeURI(URI)", "Encodes a URI by replacing certain characters with UTF-8 escape sequences."),
    ("encodeURIComponent(uriComponent)", "Encodes a URI component by replacing certain characters with UTF-8 escape sequences."),
    ("decodeURI(encodedURI)", "Decodes a Uniform Resource Identifier (URI) previously created by encodeURI."),
    ("decodeURIComponent(encodedURIComponent)", "Decodes a URI component previously created by encodeURIComponent."),
]

# TypeScript type system, error patterns, and best practices
TYPESCRIPT_DOCS = [
    # === TypeScript Error Codes and Fixes ===
    ("TS2322: Type assignment error", "Error TS2322: Type 'X' is not assignable to type 'Y'. This occurs when trying to assign a value of one type to a variable of an incompatible type. Fix: Ensure the value matches the expected type, use type assertion if certain, or widen the target type."),
    ("TS2322 fix: string to number", "TS2322: Type 'string' is not assignable to type 'number'. Fix: Use parseInt() or parseFloat() to convert string to number, or Number(value). Example: const num: number = parseInt(stringValue, 10);"),
    ("TS2322 fix: union types", "TS2322: Type 'A' is not assignable to type 'B'. When working with union types, narrow the type first. Example: if (typeof value === 'string') { /* now value is string */ }"),
    ("TS2339: Property does not exist", "Error TS2339: Property 'X' does not exist on type 'Y'. This occurs when accessing a property that TypeScript doesn't recognize. Fix: Add the property to the type definition, use type assertion, or check if the property exists."),
    ("TS2339 fix: add to interface", "TS2339 fix: Define the property in your interface. interface User { name: string; email?: string; } // Now user.email is valid"),
    ("TS2339 fix: type guard", "TS2339 fix: Use type guards to narrow types. if ('email' in user) { console.log(user.email); } // TypeScript now knows email exists"),
    ("TS2339 fix: optional chaining", "TS2339 fix: Use optional chaining for potentially undefined properties. const email = user?.email; // Returns undefined if user is nullish"),
    ("TS2345: Argument type mismatch", "Error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'. Function parameter types don't match. Fix: Ensure arguments match expected parameter types."),
    ("TS2345 fix: callback types", "TS2345 fix for callbacks: array.map((item: Item) => item.value); // Explicitly type the callback parameter to match expected signature"),
    ("TS2345 fix: overloads", "TS2345 with overloaded functions: Check which overload signature matches your use case. TypeScript picks the first matching overload."),
    ("TS2532: Object possibly undefined", "Error TS2532: Object is possibly 'undefined'. Accessing a property on a potentially undefined value. Fix: Add null check, use optional chaining, or non-null assertion if certain."),
    ("TS2532 fix: null check", "TS2532 fix: Add explicit null check. if (obj !== undefined && obj !== null) { obj.property; } // Or: if (obj) { obj.property; }"),
    ("TS2532 fix: non-null assertion", "TS2532 fix: Use non-null assertion operator (!) only when certain value exists. const value = obj!.property; // Dangerous: bypasses type checking"),
    ("TS2532 fix: nullish coalescing", "TS2532 fix: Use nullish coalescing for defaults. const value = obj?.property ?? 'default'; // Returns 'default' if undefined/null"),
    ("TS7006: Implicit any parameter", "Error TS7006: Parameter 'X' implicitly has an 'any' type. Function parameter lacks type annotation. Fix: Add explicit type annotation or enable noImplicitAny: false (not recommended)."),
    ("TS7006 fix: annotate parameters", "TS7006 fix: Always annotate function parameters. function greet(name: string): string { return `Hello, ${name}`; }"),
    ("TS7006 fix: callback typing", "TS7006 fix for callbacks: array.forEach((item: ItemType) => {}); or use generic typing: array.forEach<ItemType>(item => {});"),
    ("TS2531: Object possibly null", "Error TS2531: Object is possibly 'null'. Similar to TS2532 but specifically for null. Fix: Add null check or use non-null assertion."),
    ("TS2564: Property not initialized", "Error TS2564: Property 'X' has no initializer and is not definitely assigned. Class property declared but not initialized. Fix: Initialize in constructor, use definite assignment assertion (!), or make optional."),
    ("TS2564 fix: constructor init", "TS2564 fix: Initialize property in constructor. class User { name: string; constructor() { this.name = ''; } }"),
    ("TS2564 fix: definite assignment", "TS2564 fix: Use definite assignment assertion if initialized elsewhere. class User { name!: string; init() { this.name = 'test'; } }"),
    ("TS2769: No overload matches", "Error TS2769: No overload matches this call. None of the function's overload signatures match the provided arguments. Check each overload's parameter types."),
    ("TS2304: Cannot find name", "Error TS2304: Cannot find name 'X'. Identifier is not defined or imported. Fix: Import the identifier, declare it, or check spelling."),
    ("TS2307: Cannot find module", "Error TS2307: Cannot find module 'X'. Module import failed. Fix: Install the package, add @types package, or create declaration file."),
    ("TS2307 fix: types package", "TS2307 fix: Install type definitions. npm install --save-dev @types/packagename. For packages without types, create a .d.ts file."),
    ("TS2352: Conversion may be mistake", "Error TS2352: Conversion of type 'X' to type 'Y' may be a mistake. Type assertion might be incorrect. Fix: Use double assertion (as unknown as Y) or fix the underlying type issue."),
    ("TS2416: Property incompatible", "Error TS2416: Property 'X' in type 'Y' is not assignable to the same property in base type. Subclass property has incompatible type. Fix: Ensure subclass property matches or extends base property type."),
    ("TS2551: Did you mean", "Error TS2551: Property 'X' does not exist. Did you mean 'Y'? Typo in property name. Fix: Use the suggested property name or add the new property to the type."),
    ("TS18046: Unknown type", "Error TS18046: 'X' is of type 'unknown'. Cannot use unknown value directly. Fix: Narrow the type with type guards before using."),
    ("TS18046 fix: type narrowing", "TS18046 fix: Narrow unknown type. if (typeof value === 'string') { value.toUpperCase(); } // Now value is string"),

    # === strictNullChecks Issues ===
    ("strictNullChecks overview", "strictNullChecks: When enabled, null and undefined have their own distinct types and are not assignable to other types. This catches many null reference bugs at compile time."),
    ("strictNullChecks: null vs undefined", "With strictNullChecks: null and undefined are NOT assignable to other types. let name: string = null; // Error! Use: let name: string | null = null;"),
    ("strictNullChecks: function returns", "strictNullChecks with function returns: function find(): User | undefined { } const user = find(); user.name; // Error! user might be undefined"),
    ("strictNullChecks: array methods", "strictNullChecks with array.find(): const item = array.find(x => x.id === 1); // Type is T | undefined, must check before using"),
    ("strictNullChecks: optional params", "strictNullChecks with optional parameters: function greet(name?: string) { name.toUpperCase(); } // Error! name might be undefined"),
    ("strictNullChecks: definite assignment", "strictNullChecks with class properties: Enable strictPropertyInitialization to catch uninitialized properties. Use ! for definite assignment."),
    ("strictNullChecks: non-null map", "strictNullChecks pattern: Use Map<K,V>.get() returns V | undefined. Always check: const value = map.get(key); if (value !== undefined) { }"),

    # === any vs unknown Usage ===
    ("any type dangers", "any type: Disables type checking completely. Avoid using any as it defeats TypeScript's purpose. Use unknown or proper types instead."),
    ("any type: when acceptable", "Acceptable any uses: During migration from JavaScript, for truly dynamic content, or when proper typing is impossible. Always document why."),
    ("unknown type: safer any", "unknown type: Type-safe alternative to any. You must narrow the type before using the value. const data: unknown = JSON.parse(str);"),
    ("unknown narrowing patterns", "Narrowing unknown: Use typeof for primitives, instanceof for classes, 'prop' in obj for objects, or custom type guards."),
    ("unknown vs any comparison", "unknown vs any: any lets you do anything (unsafe). unknown requires type narrowing before use (safe). Prefer unknown for external data."),
    ("unknown type guard example", "Type guard for unknown: function isUser(value: unknown): value is User { return typeof value === 'object' && value !== null && 'name' in value; }"),
    ("any to unknown migration", "Migrating any to unknown: Replace any with unknown, then add type guards where the value is used. This reveals all unsafe type assumptions."),

    # === Interface vs Type Patterns ===
    ("interface vs type: basics", "interface vs type: Both define object shapes. Interfaces can be extended/merged, types can use unions/intersections. Choose based on use case."),
    ("interface declaration merging", "Interface declaration merging: Multiple interface declarations with same name merge. interface User { name: string; } interface User { email: string; } // User has both"),
    ("type alias unions", "Type alias for unions: type Status = 'pending' | 'active' | 'closed'; // Types excel at union types, interfaces cannot do this"),
    ("type alias intersections", "Type alias for intersections: type UserWithRole = User & { role: string }; // Combine types with &"),
    ("interface extends", "Interface extends: interface Admin extends User { permissions: string[]; } // Cleaner inheritance syntax than type intersections"),
    ("interface implements", "Interface with implements: class UserImpl implements User { name: string; } // Interfaces work with class implements, types also work"),
    ("type for function signatures", "Type for function signatures: type Handler = (event: Event) => void; // Types are cleaner for function type aliases"),
    ("interface for object shapes", "Interface for object shapes: interface User { name: string; age: number; } // Interfaces are conventional for object shapes"),
    ("mapped types require type", "Mapped types require type alias: type Optional<T> = { [K in keyof T]?: T[K] }; // Cannot do with interface"),
    ("conditional types require type", "Conditional types require type alias: type NonNullable<T> = T extends null | undefined ? never : T;"),
    ("when to use interface", "Use interface when: Defining object shapes, class contracts, extending existing types, or when declaration merging is needed."),
    ("when to use type", "Use type when: Creating unions, intersections, mapped types, conditional types, or aliasing primitives/tuples."),

    # === Generic Patterns ===
    ("generic function basics", "Generic function: function identity<T>(arg: T): T { return arg; } // T is inferred from argument or explicitly provided"),
    ("generic constraints", "Generic constraints: function getLength<T extends { length: number }>(arg: T): number { return arg.length; } // T must have length"),
    ("generic interface", "Generic interface: interface Container<T> { value: T; getValue(): T; } // Type parameter for flexible containers"),
    ("generic class", "Generic class: class Box<T> { constructor(public value: T) {} } const numBox = new Box<number>(42);"),
    ("generic default type", "Generic default type: interface Response<T = any> { data: T; } // T defaults to any if not specified"),
    ("multiple type parameters", "Multiple type parameters: function map<T, U>(arr: T[], fn: (item: T) => U): U[] { return arr.map(fn); }"),
    ("generic constraint keyof", "keyof constraint: function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; } // K must be key of T"),
    ("generic inference", "Generic inference: const result = identity('hello'); // TypeScript infers T as string from argument"),
    ("generic conditional types", "Generic conditional: type Flatten<T> = T extends Array<infer U> ? U : T; // Infer element type from array"),

    # === Utility Types ===
    ("Partial<T> utility", "Partial<T>: Makes all properties optional. interface User { name: string; age: number; } type PartialUser = Partial<User>; // { name?: string; age?: number; }"),
    ("Required<T> utility", "Required<T>: Makes all properties required. type RequiredUser = Required<PartialUser>; // Opposite of Partial"),
    ("Readonly<T> utility", "Readonly<T>: Makes all properties readonly. type ImmutableUser = Readonly<User>; // Cannot modify properties"),
    ("Pick<T, K> utility", "Pick<T, K>: Select specific properties. type UserName = Pick<User, 'name'>; // { name: string; }"),
    ("Omit<T, K> utility", "Omit<T, K>: Remove specific properties. type UserWithoutAge = Omit<User, 'age'>; // { name: string; }"),
    ("Record<K, T> utility", "Record<K, T>: Create object type with keys K and values T. type UserMap = Record<string, User>; // { [key: string]: User }"),
    ("Exclude<T, U> utility", "Exclude<T, U>: Remove types from union. type WithoutNull = Exclude<string | null, null>; // string"),
    ("Extract<T, U> utility", "Extract<T, U>: Extract types from union. type OnlyStrings = Extract<string | number, string>; // string"),
    ("NonNullable<T> utility", "NonNullable<T>: Remove null and undefined. type SafeString = NonNullable<string | null | undefined>; // string"),
    ("ReturnType<T> utility", "ReturnType<T>: Get function return type. type Result = ReturnType<typeof myFunction>; // Extracts return type"),
    ("Parameters<T> utility", "Parameters<T>: Get function parameter types as tuple. type Params = Parameters<typeof myFunction>; // [arg1Type, arg2Type]"),
    ("InstanceType<T> utility", "InstanceType<T>: Get instance type of constructor. type UserInstance = InstanceType<typeof UserClass>;"),
    ("Awaited<T> utility", "Awaited<T>: Unwrap Promise type. type Data = Awaited<Promise<string>>; // string. Works with nested promises."),

    # === Declaration Files (.d.ts) ===
    ("declaration file basics", "Declaration files (.d.ts): Provide type information for JavaScript code. Contains only type declarations, no implementations."),
    ("declare module", "declare module: Define types for a module. declare module 'my-lib' { export function doSomething(): void; }"),
    ("declare global", "declare global: Extend global scope. declare global { interface Window { myGlobal: string; } }"),
    ("ambient declarations", "Ambient declarations: declare const, declare function, declare class. Describe existing JavaScript without implementing."),
    ("triple-slash directives", "Triple-slash directives: /// <reference types='node' /> Include type definitions. Used at top of declaration files."),
    ("@types packages", "@types packages: Community-maintained type definitions. npm install --save-dev @types/lodash. Automatically included by TypeScript."),

    # === Common Type Patterns ===
    ("discriminated unions", "Discriminated unions: Union types with a common property that distinguishes them. type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number }"),
    ("exhaustive check pattern", "Exhaustive check: function assertNever(x: never): never { throw new Error('Unexpected: ' + x); } Use in switch default to catch unhandled cases."),
    ("type narrowing", "Type narrowing: TypeScript narrows types based on control flow. if (typeof x === 'string') { /* x is string here */ }"),
    ("type predicates", "Type predicates: function isString(value: unknown): value is string { return typeof value === 'string'; } // Custom type guard"),
    ("assertion functions", "Assertion functions: function assert(condition: unknown): asserts condition { if (!condition) throw new Error(); } // Narrows after call"),
    ("branded types", "Branded types: type UserId = string & { readonly brand: unique symbol }; // Create distinct types from primitives"),
    ("template literal types", "Template literal types: type EventName = `on${Capitalize<string>}`; // 'onClick', 'onHover', etc."),
    ("const assertions", "const assertions: const config = { name: 'app' } as const; // Makes object deeply readonly with literal types"),
    ("satisfies operator", "satisfies operator: const config = { theme: 'dark' } satisfies Config; // Type check without widening"),
    ("infer keyword", "infer keyword: type GetReturnType<T> = T extends (...args: any[]) => infer R ? R : never; // Extract types in conditionals"),

    # === Async/Promise Typing ===
    ("Promise type annotation", "Promise typing: async function fetch(): Promise<User> { } // Return type is Promise<User>"),
    ("Promise.all typing", "Promise.all typing: const [user, posts] = await Promise.all([getUser(), getPosts()]); // Returns tuple of resolved types"),
    ("async generator types", "Async generator: async function* stream(): AsyncGenerator<Data, void, unknown> { yield data; }"),
    ("error handling types", "Error handling: try { } catch (error: unknown) { if (error instanceof Error) { error.message; } } // error is unknown in TS 4.4+"),

    # === React TypeScript Patterns ===
    ("React FC typing", "React FC: const Component: React.FC<Props> = ({ name }) => <div>{name}</div>; // Function component with props"),
    ("React useState typing", "useState typing: const [user, setUser] = useState<User | null>(null); // Explicitly type state when initial value doesn't match"),
    ("React useRef typing", "useRef typing: const inputRef = useRef<HTMLInputElement>(null); // Type the ref element"),
    ("React event typing", "Event typing: const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => { }; // Type event and element"),
    ("React children typing", "Children typing: interface Props { children: React.ReactNode; } // ReactNode for any renderable content"),
    ("React props with generics", "Generic props: interface ListProps<T> { items: T[]; render: (item: T) => React.ReactNode; }"),

    # === Common Mistakes and Fixes ===
    ("mistake: {} type", "Avoid {} type: {} means any non-nullish value, not empty object. Use Record<string, never> for empty object or object for any object."),
    ("mistake: Object type", "Avoid Object type: Use object (lowercase) for non-primitive, or define specific shape. Object includes primitives via boxing."),
    ("mistake: Function type", "Avoid Function type: Too loose. Use specific signature: type Handler = (event: Event) => void; or (...args: any[]) => any"),
    ("mistake: any in catch", "Catch clause error type: In TS 4.4+ catch(e) has unknown type. Use: catch(e) { if (e instanceof Error) { } }"),
    ("mistake: array type", "Array typing: Prefer Type[] over Array<Type> for simple arrays. Use Array<Type> for complex generics only."),
    ("mistake: enum vs union", "Enum vs union: Prefer union types over enums. type Status = 'active' | 'inactive'; // Simpler, tree-shakeable"),
    ("mistake: interface for primitives", "Don't use interface for primitives: type ID = string; // Not: interface ID extends String {}"),
    ("mistake: mutation in reduce", "Reduce typing: array.reduce<Accumulator>((acc, item) => acc, initialValue); // Type the accumulator explicitly"),
    ("mistake: object index signature", "Index signature: interface Dict { [key: string]: number; } // Returns number | undefined with noUncheckedIndexedAccess"),
]

# Common programming concepts and patterns
PROGRAMMING_CONCEPTS = [
    ("async/await pattern", "A way to write asynchronous code that looks and behaves like synchronous code. async functions return Promises and await pauses execution until a Promise resolves."),
    ("callback function", "A function passed as an argument to another function, to be called back at a later time when some operation completes."),
    ("closure", "A function that has access to variables from its outer scope, even after the outer function has returned."),
    ("currying", "The technique of converting a function that takes multiple arguments into a sequence of functions that each take a single argument."),
    ("debouncing", "A technique to ensure that a function is not called too frequently. It delays execution until after a specified time has passed since the last call."),
    ("decorator pattern", "A design pattern that allows behavior to be added to an individual object dynamically, without affecting other objects of the same class."),
    ("dependency injection", "A technique where an object receives its dependencies from external sources rather than creating them internally."),
    ("destructuring assignment", "A syntax that makes it possible to unpack values from arrays or properties from objects into distinct variables."),
    ("event delegation", "A technique where a single event listener is attached to a parent element to handle events for its child elements."),
    ("factory pattern", "A creational design pattern that uses factory methods to create objects without specifying the exact class of the object to be created."),
    ("higher-order function", "A function that takes one or more functions as arguments or returns a function as its result."),
    ("hoisting", "JavaScript's default behavior of moving declarations to the top of their scope before code execution."),
    ("immutability", "The concept of data that cannot be changed after it's created. New data structures are created instead of modifying existing ones."),
    ("memoization", "An optimization technique that stores the results of expensive function calls and returns the cached result when the same inputs occur again."),
    ("middleware", "Software that acts as a bridge between different applications or components, processing requests before they reach their final destination."),
    ("module pattern", "A design pattern used to create self-contained pieces of code with private and public parts."),
    ("observer pattern", "A design pattern where an object maintains a list of dependents and notifies them automatically of any state changes."),
    ("polymorphism", "The ability of different classes to be treated as instances of the same class through inheritance or interfaces."),
    ("promise chaining", "A technique where multiple asynchronous operations are executed in sequence by chaining .then() methods."),
    ("prototype chain", "The mechanism by which JavaScript objects inherit features from one another through their prototype property."),
    ("pure function", "A function that always returns the same result for the same arguments and has no side effects."),
    ("recursion", "A technique where a function calls itself to solve smaller instances of the same problem."),
    ("rest parameters", "A syntax that allows a function to accept an indefinite number of arguments as an array."),
    ("singleton pattern", "A design pattern that restricts the instantiation of a class to a single instance."),
    ("spread operator", "A syntax that allows an iterable to be expanded in places where zero or more arguments or elements are expected."),
    ("state machine", "A model where an object can be in one of a finite number of states and can transition between states based on events."),
    ("throttling", "A technique that ensures a function is called at most once in a specified time period."),
    ("type coercion", "The automatic or implicit conversion of values from one data type to another."),
    ("variable shadowing", "When a variable in a local scope has the same name as a variable in an outer scope."),
    ("virtual DOM", "A programming concept where a virtual representation of a UI is kept in memory and synced with the real DOM."),
    ("generator function", "A function that can be paused and resumed, yielding multiple values over time."),
    ("iterator protocol", "A standard way to produce a sequence of values, one at a time, in an object."),
    ("proxy pattern", "A design pattern that provides a surrogate or placeholder for another object to control access to it."),
    ("reflection", "The ability of a program to examine and modify its own structure and behavior at runtime."),
    ("lazy evaluation", "A strategy that delays the evaluation of an expression until its value is needed."),
    ("tail call optimization", "A compiler optimization that reuses the current stack frame for the next function call when possible."),
    ("event loop", "A mechanism that handles execution of code, collecting and processing events, and executing queued sub-tasks."),
    ("lexical scope", "The scope determined by the physical placement of the code, where inner functions have access to variables declared in their outer scope."),
    ("monadic pattern", "A design pattern that wraps a value and provides methods to transform it while maintaining the wrapped structure."),
    ("composition over inheritance", "A design principle that favors combining simple objects to achieve more complex behavior rather than using class hierarchies."),
]


def get_conn():
    """Get database connection"""
    return psycopg2.connect(**OVERFLOW_DB)


def count_training_entries() -> int:
    """Count existing training data entries"""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM training_data")
            return cur.fetchone()[0]
    finally:
        conn.close()


def seed_docs():
    """Seed database with Python, JavaScript, and TypeScript documentation"""
    conn = get_conn()

    try:
        existing = count_training_entries()
        print(f"Existing training entries: {existing}")

        if existing >= MIN_SAMPLES:
            print(f"Already have {existing} samples (min: {MIN_SAMPLES}). Skipping seed.")
            return

        print(f"Seeding {len(PYTHON_DOCS)} Python docs...")
        print(f"Seeding {len(JAVASCRIPT_DOCS)} JavaScript docs...")
        print(f"Seeding {len(TYPESCRIPT_DOCS)} TypeScript docs...")
        print(f"Seeding {len(PROGRAMMING_CONCEPTS)} programming concepts...")

        all_docs = []

        # Python docs
        for name, desc in PYTHON_DOCS:
            all_docs.append(('python', f"Python: {name} - {desc}"))

        # JavaScript docs
        for name, desc in JAVASCRIPT_DOCS:
            all_docs.append(('javascript', f"JavaScript: {name} - {desc}"))

        # TypeScript docs
        for name, desc in TYPESCRIPT_DOCS:
            all_docs.append(('typescript', f"TypeScript: {name} - {desc}"))

        # Programming concepts
        for name, desc in PROGRAMMING_CONCEPTS:
            all_docs.append(('concepts', f"Programming concept: {name} - {desc}"))

        inserted = 0
        with conn.cursor() as cur:
            for service, text in all_docs:
                input_hash = hashlib.sha256(text.encode()).hexdigest()[:32]
                size_bytes = len(text.encode())

                try:
                    cur.execute("""
                        INSERT INTO training_data
                        (service, input_text, input_hash, size_bytes)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (input_hash) DO NOTHING
                    """, (service, text, input_hash, size_bytes))
                    if cur.rowcount > 0:
                        inserted += 1
                except Exception as e:
                    print(f"  Error inserting: {e}")

            conn.commit()

        print(f"\nSeeded {inserted} new entries")
        print(f"Total training entries: {count_training_entries()}")

    finally:
        conn.close()


def show_stats():
    """Show training data statistics"""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT service, COUNT(*), SUM(size_bytes)
                FROM training_data
                GROUP BY service
                ORDER BY COUNT(*) DESC
            """)

            print("\nTraining Data by Service:")
            print("-" * 50)
            total = 0
            total_size = 0
            for row in cur:
                service, count, size = row
                size = size or 0
                print(f"  {service}: {count} entries ({size/1024:.1f} KB)")
                total += count
                total_size += size

            print("-" * 50)
            print(f"  TOTAL: {total} entries ({total_size/1024:.1f} KB)")
            print(f"  Min required for PCA: {MIN_SAMPLES}")
            print(f"  Status: {'READY' if total >= MIN_SAMPLES else 'NEED MORE SAMPLES'}")

    finally:
        conn.close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Seed Python/JS/TS docs for PCA training')
    parser.add_argument('--seed', action='store_true', help='Seed the database')
    parser.add_argument('--stats', action='store_true', help='Show statistics')
    parser.add_argument('--force', action='store_true', help='Force re-seed even if samples exist')

    args = parser.parse_args()

    if args.stats:
        show_stats()
    elif args.seed or args.force:
        if args.force:
            print("Force seeding...")
        seed_docs()
        show_stats()
    else:
        print("Usage: python seed_docs.py --seed|--stats|--force")
        print("\nThis script pre-loads Python, JavaScript, and TypeScript documentation")
        print("into the training database to ensure PCA has enough samples.")
