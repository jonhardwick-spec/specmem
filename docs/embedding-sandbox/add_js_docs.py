#!/usr/bin/env python3
"""
ADD JAVASCRIPT DOCS - Enhance Mini-COT with comprehensive JS documentation

This script adds JavaScript documentation to the mini-cot docs database,
focusing on:
1. Common JavaScript errors (TypeError, ReferenceError, SyntaxError)
2. Async/await pitfalls and Promise patterns
3. Array/Object method gotchas
4. Scope, hoisting, and closure issues
5. Type coercion problems
6. Best practices and common bug fixes

Output: Appends to /app/docs.db or specified database
"""

import os
import sqlite3
import hashlib
from typing import List, Tuple

# Default output path (same as build_docs_db.py)
OUTPUT_DB = os.environ.get("DOCS_DB", "/specmem/embedding-sandbox/docs/python_docs.db")

# ============================================================================
# JAVASCRIPT ERROR PATTERNS AND FIXES
# ============================================================================

JS_ERROR_PATTERNS = [
    # TypeError patterns
    ("TypeError: Cannot read property 'x' of undefined",
     "This error occurs when trying to access a property on undefined or null. "
     "Common causes: 1) Accessing nested object properties without null checks, "
     "2) Calling methods on uninitialized variables, 3) Array index out of bounds. "
     "Fix: Use optional chaining (?.) like obj?.prop?.nested, or nullish coalescing (??) "
     "like obj?.prop ?? defaultValue. Always validate data before accessing nested properties."),

    ("TypeError: Cannot read property 'x' of null",
     "Similar to undefined error but the value is explicitly null. "
     "Common when: 1) DOM querySelector returns null, 2) JSON parsing returns null, "
     "3) API response has null fields. Fix: Check for null before accessing: "
     "if (element !== null) { element.innerHTML = 'text'; } or use optional chaining."),

    ("TypeError: x is not a function",
     "Occurs when calling something that isn't callable. Common causes: "
     "1) Overwriting a function with a variable of same name, "
     "2) Importing/exporting incorrectly (missing default export), "
     "3) Calling a property instead of a method. "
     "Fix: Check the type with typeof fn === 'function' before calling. "
     "Verify imports match exports (named vs default)."),

    ("TypeError: Cannot assign to read only property",
     "Attempting to modify a frozen object or const primitive. "
     "Common with: Object.freeze(), const declarations, or getter-only properties. "
     "Fix: Create a copy before modifying: const newObj = {...frozenObj, prop: newValue}; "
     "Or use Object.assign() to create mutable copies."),

    ("TypeError: x.map is not a function",
     "Calling array methods on non-arrays. Common causes: "
     "1) API returns object instead of array, 2) JSON.parse result isn't array, "
     "3) Variable shadowing hides the array. "
     "Fix: Verify with Array.isArray(x) before calling array methods. "
     "Use (x || []).map() as defensive pattern."),

    ("TypeError: Assignment to constant variable",
     "Trying to reassign a const variable. Remember const only prevents reassignment, "
     "not mutation of object/array contents. Fix: Use let for variables that need reassignment. "
     "For objects, you can still modify properties: const obj = {}; obj.prop = 'ok';"),

    # ReferenceError patterns
    ("ReferenceError: x is not defined",
     "Variable doesn't exist in current scope. Common causes: "
     "1) Typo in variable name, 2) Using before declaration (temporal dead zone with let/const), "
     "3) Variable declared in different scope/module. "
     "Fix: Check spelling, ensure variable is declared before use, "
     "verify imports are correct. Use typeof x === 'undefined' for safe checks."),

    ("ReferenceError: Cannot access 'x' before initialization",
     "Temporal Dead Zone (TDZ) error with let/const. Unlike var which hoists and initializes to undefined, "
     "let/const hoist but remain uninitialized until declaration line. "
     "Fix: Move declaration before usage, or use var if hoisting behavior is needed (not recommended)."),

    # SyntaxError patterns
    ("SyntaxError: Unexpected token",
     "Parser encountered something unexpected. Common causes: "
     "1) Missing comma in array/object, 2) Extra comma (trailing in old JS), "
     "3) Missing brackets/braces, 4) Invalid JSON (single quotes, trailing commas). "
     "Fix: Check for balanced brackets, proper comma placement. Use JSON.parse() with try-catch."),

    ("SyntaxError: Unexpected identifier",
     "Usually missing operator or keyword. Common causes: "
     "1) Missing 'function' keyword, 2) Missing semicolon (ASI failure), "
     "3) Reserved word as variable name. Fix: Add missing keywords, "
     "use descriptive non-reserved names like userData instead of class."),

    ("SyntaxError: Invalid or unexpected token",
     "Character not valid in JS. Often: 1) Smart quotes from copy-paste (curly quotes instead of straight), "
     "2) Invisible Unicode characters, 3) Template literal without backticks. "
     "Fix: Retype quotes manually, use straight quotes, check for hidden characters."),

    ("SyntaxError: Missing ) after argument list",
     "Unbalanced parentheses in function call. Often from: "
     "1) Nested function calls with wrong count, 2) Template literal confusion, "
     "3) Missing closing paren before brace. Fix: Count opening and closing parens, "
     "use editor bracket matching feature."),

    ("SyntaxError: Illegal return statement",
     "Return used outside a function. This happens when: "
     "1) Return is at module level, 2) Return inside a class body but outside method. "
     "Fix: Ensure return is inside a function body. For module exports, use export instead."),

    # RangeError patterns
    ("RangeError: Maximum call stack size exceeded",
     "Infinite recursion or very deep recursion. Causes: "
     "1) Recursive function without base case, 2) Circular object references in serialization, "
     "3) Event handlers triggering themselves. "
     "Fix: Add proper base case, limit recursion depth, use trampolining or iterative approach."),

    ("RangeError: Invalid array length",
     "Array length must be positive integer < 2^32. Causes: "
     "1) new Array(-1) or new Array(NaN), 2) Setting array.length to invalid value. "
     "Fix: Validate length before creating array: Math.max(0, Math.floor(len))."),

    ("RangeError: Invalid string length",
     "String operations exceeding max length. Often from: "
     "1) Infinite string concatenation in loop, 2) Very large repeat() call. "
     "Fix: Check string sizes, use streaming for large data, limit repeat count."),
]

# ============================================================================
# ASYNC/AWAIT AND PROMISE PATTERNS
# ============================================================================

JS_ASYNC_PATTERNS = [
    ("async/await: Unhandled promise rejection",
     "Async function throws but no try-catch or .catch(). Every async operation can fail. "
     "Fix: Always wrap await in try-catch: try { await fetch(); } catch (e) { handleError(e); } "
     "Or add global handler: process.on('unhandledRejection', handler);"),

    ("async/await: await in forEach doesn't work",
     "forEach doesn't wait for async callbacks. The loop completes before promises resolve. "
     "Fix: Use for...of loop: for (const item of items) { await process(item); } "
     "Or Promise.all with map: await Promise.all(items.map(async item => await process(item)));"),

    ("async/await: Parallel vs sequential execution",
     "Sequential: await a(); await b(); executes one after another. "
     "Parallel: await Promise.all([a(), b()]) starts both immediately. "
     "For independent operations, use parallel for better performance. "
     "Only use sequential when b() depends on a()'s result."),

    ("async/await: Forgetting to await",
     "async function returns Promise, not the resolved value. "
     "Without await, you get Promise object instead of data. "
     "Common symptom: [object Promise] in output. "
     "Fix: Always await async calls or handle with .then()."),

    ("Promise: then() returns new Promise",
     ".then() always returns a new Promise, enabling chaining. "
     "Return value becomes resolved value of new Promise. "
     "Throwing inside .then() rejects the new Promise. "
     "Pattern: fetch().then(r => r.json()).then(data => use(data));"),

    ("Promise: catch() placement matters",
     ".catch() only catches errors from preceding chain. "
     "promise.then(a).then(b).catch(e) - catches errors from both a and b. "
     "promise.then(a).catch(e).then(b) - b runs even if a throws. "
     "Place .catch() at end to catch all errors in chain."),

    ("Promise: Promise.all() fails fast",
     "Promise.all() rejects immediately when ANY promise rejects. "
     "Other promises continue but results are lost. "
     "For fail-safe: Use Promise.allSettled() to get all results regardless of rejection. "
     "For first success: Use Promise.any() (ES2021)."),

    ("Promise: Mixing async/await with .then()",
     "Avoid mixing styles in same code block - confusing and error-prone. "
     "Choose one: either async/await throughout or .then() chains. "
     "async/await is generally more readable for sequential logic."),

    ("async/await: async function always returns Promise",
     "Even if you return plain value, it's wrapped in Promise. "
     "return 5 becomes return Promise.resolve(5). "
     "return undefined becomes return Promise.resolve(undefined). "
     "Callers must await or .then() to get value."),

    ("Promise: Creating Promise executor anti-pattern",
     "Don't create new Promise when you already have one: "
     "BAD: new Promise(resolve => fetch(url).then(r => resolve(r))) "
     "GOOD: fetch(url) - fetch already returns Promise. "
     "Only use new Promise for wrapping callback-based APIs."),
]

# ============================================================================
# ARRAY AND OBJECT METHOD GOTCHAS
# ============================================================================

JS_ARRAY_OBJECT_GOTCHAS = [
    ("Array: sort() modifies original and sorts as strings",
     "[10, 2, 1].sort() returns [1, 10, 2] because it converts to strings. "
     "Fix: Use compare function: arr.sort((a, b) => a - b) for numbers. "
     "For descending: arr.sort((a, b) => b - a). "
     "Note: sort() mutates original array, use [...arr].sort() for copy."),

    ("Array: splice() vs slice()",
     "splice(start, deleteCount, ...items) MUTATES array, returns deleted items. "
     "slice(start, end) returns NEW array, doesn't mutate. "
     "Common mistake: using splice when you wanted slice. "
     "For immutable operations, prefer slice, filter, map."),

    ("Array: map() vs forEach() return values",
     "map() returns new array with transformed values. "
     "forEach() returns undefined, only for side effects. "
     "Don't use map() if you don't need return array (wasteful). "
     "Don't use forEach() expecting to collect results."),

    ("Array: filter() doesn't modify original",
     "filter() returns NEW array with elements passing test. "
     "Original array unchanged. To modify in place, use splice in loop. "
     "Pattern: arr = arr.filter(x => x !== valueToRemove);"),

    ("Array: reduce() initial value importance",
     "Without initial value, uses first element as accumulator. "
     "Empty array without initial throws TypeError. "
     "Always provide initial value: arr.reduce((acc, x) => acc + x, 0). "
     "For objects: arr.reduce((acc, x) => ({...acc, [x.id]: x}), {})."),

    ("Array: includes() vs indexOf()",
     "includes() returns boolean, handles NaN correctly. "
     "[NaN].includes(NaN) is true. [NaN].indexOf(NaN) is -1. "
     "Use includes() for existence check, indexOf() when you need position."),

    ("Array: find() vs filter() for single item",
     "find() returns first match or undefined, stops at first match. "
     "filter() returns array of all matches. "
     "For single item lookup, find() is more efficient and cleaner."),

    ("Array: flat() and flatMap()",
     "flat(depth) flattens nested arrays: [[1],[2]].flat() = [1,2]. "
     "Default depth is 1. Use Infinity for complete flatten. "
     "flatMap() is map() + flat(1) in one pass - more efficient."),

    ("Object: Object.keys/values/entries order",
     "Iteration order: 1) Integer keys in ascending order, "
     "2) String keys in insertion order, 3) Symbol keys in insertion order. "
     "For guaranteed order, use Map instead of Object."),

    ("Object: Shallow vs deep copy",
     "Object.assign() and spread {...obj} create SHALLOW copies. "
     "Nested objects still reference originals. "
     "For deep copy: JSON.parse(JSON.stringify(obj)) (loses functions, dates). "
     "Or use structuredClone(obj) (modern browsers, Node 17+)."),

    ("Object: in vs hasOwnProperty",
     "'prop' in obj checks prototype chain too. "
     "obj.hasOwnProperty('prop') only checks own properties. "
     "Modern: Object.hasOwn(obj, 'prop') - safer, works when hasOwnProperty overwritten."),

    ("Object: Property shorthand gotcha",
     "const name = 'John'; const obj = { name }; // { name: 'John' }. "
     "But computed properties need brackets: { [dynamicKey]: value }. "
     "Don't confuse { name } with { 'name': name }."),
]

# ============================================================================
# SCOPE, HOISTING, AND CLOSURE ISSUES
# ============================================================================

JS_SCOPE_PATTERNS = [
    ("Hoisting: var vs let/const",
     "var is hoisted and initialized to undefined. "
     "let/const are hoisted but NOT initialized (TDZ). "
     "console.log(x); var x = 1; // undefined. "
     "console.log(x); let x = 1; // ReferenceError. "
     "Best practice: Always declare at top of scope, prefer const/let."),

    ("Hoisting: Function declarations vs expressions",
     "Function declarations are fully hoisted: fn(); function fn(){} works. "
     "Function expressions with var: fn(); var fn = function(){} // TypeError. "
     "Arrow functions same as expressions - not hoisted."),

    ("Closure: Loop variable capture",
     "Classic bug: for(var i=0; i<3; i++) setTimeout(() => console.log(i), 1000) "
     "Prints 3,3,3 not 0,1,2 because closures share same i. "
     "Fix 1: Use let: for(let i=0; ...) - each iteration gets own i. "
     "Fix 2: IIFE: (function(i){ setTimeout(()=>console.log(i), 1000) })(i);"),

    ("Closure: Memory leaks",
     "Closures keep references to outer scope variables. "
     "If closure outlives outer function, those variables aren't GC'd. "
     "Common in event handlers, timers, callbacks. "
     "Fix: Nullify references when done, remove event listeners, clear timers."),

    ("Scope: Block scope vs function scope",
     "var is function-scoped: visible throughout function. "
     "let/const are block-scoped: only within { }. "
     "if(true){ var x=1; let y=2; } // x accessible, y not. "
     "Best practice: Use let/const for predictable scoping."),

    ("Scope: Global pollution",
     "Assigning without declaration creates global: x = 1; // window.x in browser. "
     "'use strict' prevents this (throws ReferenceError). "
     "Always use const/let/var. Avoid modifying global objects."),

    ("this: Context binding",
     "Regular functions: this determined by call site. "
     "Arrow functions: this from enclosing lexical scope. "
     "obj.method() - this is obj. const fn = obj.method; fn() - this is undefined/window. "
     "Fix: Use arrow functions or .bind()/.call()/.apply()."),

    ("this: Lost context in callbacks",
     "class C { method() { setTimeout(function() { this.x }, 1000); } } "
     "this inside setTimeout is not the class instance. "
     "Fix 1: Arrow function: setTimeout(() => this.x, 1000). "
     "Fix 2: Bind: setTimeout(this.handler.bind(this), 1000). "
     "Fix 3: Store reference: const self = this;"),

    ("Closure: Creating functions in loops",
     "BAD: for(var i=0; i<btns.length; i++) btns[i].onclick = function(){ alert(i); }; "
     "All buttons alert same value (btns.length). "
     "GOOD: Use let, or forEach which creates closure per iteration: "
     "btns.forEach((btn, i) => btn.onclick = () => alert(i));"),
]

# ============================================================================
# TYPE COERCION PROBLEMS
# ============================================================================

JS_TYPE_COERCION = [
    ("Equality: == vs ===",
     "== performs type coercion: '1' == 1 is true. "
     "=== strict equality, no coercion: '1' === 1 is false. "
     "null == undefined is true, null === undefined is false. "
     "Best practice: Always use === unless you specifically need coercion."),

    ("Coercion: + operator with strings",
     "'1' + 2 = '12' (string concatenation). "
     "1 + '2' = '12' (string wins). "
     "1 + 2 + '3' = '33' (left to right: 3 + '3'). "
     "Fix: Explicit conversion: Number('1') + 2, or parseInt('1') + 2."),

    ("Coercion: Falsy values",
     "Falsy: false, 0, '', null, undefined, NaN. "
     "if(!x) catches all falsy, not just null/undefined. "
     "0 and '' are valid values that are falsy. "
     "Fix: Use x === null || x === undefined, or x ?? defaultValue (nullish coalescing)."),

    ("Coercion: NaN quirks",
     "NaN !== NaN is true (NaN is not equal to itself). "
     "typeof NaN is 'number'. "
     "Use Number.isNaN(x) not isNaN(x). "
     "isNaN('hello') is true (coerces to NaN), Number.isNaN('hello') is false."),

    ("Coercion: [] and {} in boolean context",
     "Empty array [] is truthy: if([]) is true. "
     "Empty object {} is truthy: if({}) is true. "
     "Only [] == false is true ([] coerces to '' coerces to 0). "
     "Check length: if(arr.length), or use Array.isArray() with length check."),

    ("Coercion: + unary for conversion",
     "+string converts to number: +'42' is 42. "
     "+'' is 0, +'hello' is NaN. "
     "Also works with dates: +new Date() gives timestamp. "
     "Prefer explicit Number() for clarity."),

    ("Coercion: Boolean conversion",
     "Boolean(x) or !!x for explicit conversion. "
     "!!0 is false, !!1 is true, !!'' is false, !!'x' is true. "
     "!![] is true, !!{} is true (objects are truthy)."),

    ("Coercion: Object to primitive",
     "Objects convert via valueOf() then toString(). "
     "[1,2,3] + '' = '1,2,3'. {} + '' = '[object Object]'. "
     "Custom objects can override: valueOf() { return 42; }"),

    ("typeof: Quirks and limitations",
     "typeof null is 'object' (historical bug). "
     "typeof [] is 'object' (use Array.isArray). "
     "typeof function is 'function'. "
     "typeof undeclaredVar is 'undefined' (doesn't throw)."),

    ("Coercion: parseInt gotchas",
     "parseInt('08') was 0 in old JS (octal). Now 8 in ES5+. "
     "Always specify radix: parseInt('08', 10). "
     "parseInt stops at first non-digit: parseInt('123abc') is 123. "
     "parseInt(0.0000005) is 5 (coerces to '5e-7', parses 5)."),
]

# ============================================================================
# MODERN JAVASCRIPT BEST PRACTICES
# ============================================================================

JS_BEST_PRACTICES = [
    ("Destructuring: Default values",
     "const { x = 10 } = obj; // x is 10 if obj.x is undefined. "
     "Works with arrays: const [a = 1, b = 2] = arr; "
     "Note: Only triggers on undefined, not null or 0."),

    ("Optional chaining: Safe property access",
     "obj?.prop?.nested - returns undefined if any part is null/undefined. "
     "Works with methods: obj.method?.() - calls only if method exists. "
     "Works with arrays: arr?.[0]?.prop. "
     "Combine with nullish coalescing: obj?.prop ?? defaultValue."),

    ("Nullish coalescing: ?? vs ||",
     "|| returns right side for ANY falsy value. "
     "?? returns right side only for null/undefined. "
     "0 || 10 is 10 (0 is falsy). "
     "0 ?? 10 is 0 (0 is not nullish). "
     "Use ?? when 0, '', or false are valid values."),

    ("Template literals: Tagged templates",
     "Tagged templates can process string: html`<div>${unsafe}</div>`. "
     "The tag function receives strings array and values. "
     "Useful for escaping, i18n, styled-components, SQL queries."),

    ("Spread operator: Use cases",
     "Array copy: [...arr], merge: [...arr1, ...arr2]. "
     "Object copy: {...obj}, merge: {...obj1, ...obj2}. "
     "Function args: Math.max(...numbers). "
     "Later spreads override earlier: {...defaults, ...userConfig}."),

    ("Rest parameters: Collecting arguments",
     "function fn(first, ...rest) - rest is array of remaining args. "
     "Must be last parameter. "
     "Replaces deprecated arguments object. "
     "Also in destructuring: const [head, ...tail] = arr."),

    ("Short-circuit evaluation: Common patterns",
     "condition && doSomething() - execute if true. "
     "value || defaultValue - use default if falsy. "
     "value ?? defaultValue - use default if nullish (preferred for defaults). "
     "Avoid complex logic - hard to read."),

    ("Default parameters: Function defaults",
     "function fn(x = 10) - x is 10 if undefined. "
     "Defaults evaluated at call time: fn(arr = []) - fresh array each call. "
     "Can reference earlier params: fn(x, y = x * 2). "
     "null doesn't trigger default (only undefined does)."),

    ("Object method shorthand",
     "const obj = { method() {} } instead of method: function() {}. "
     "const obj = { async method() {} } for async. "
     "const obj = { *generator() {} } for generators. "
     "const obj = { get prop() {}, set prop(v) {} } for accessors."),

    ("Class: Private fields",
     "class C { #privateField = 0; #privateMethod() {} }. "
     "Truly private - not accessible outside class. "
     "Accessed with #: this.#privateField. "
     "WeakMap alternative for older environments."),
]

# ============================================================================
# NODE.JS SPECIFIC PATTERNS
# ============================================================================

JS_NODEJS_PATTERNS = [
    ("Node: require vs import",
     "CommonJS: const fs = require('fs') - synchronous, dynamic. "
     "ES Modules: import fs from 'fs' - async, static. "
     "Use 'type': 'module' in package.json for ESM. "
     "Or .mjs extension for ESM, .cjs for CommonJS."),

    ("Node: __dirname and __filename in ESM",
     "__dirname and __filename not available in ES modules. "
     "Fix: import { fileURLToPath } from 'url'; "
     "const __filename = fileURLToPath(import.meta.url); "
     "const __dirname = path.dirname(__filename);"),

    ("Node: Callback error-first pattern",
     "Node callbacks: callback(error, result). "
     "Always handle error first: if (err) return handleError(err); "
     "Use util.promisify to convert to Promise: "
     "const readFile = util.promisify(fs.readFile);"),

    ("Node: Event emitter memory leak",
     "Default max listeners is 10. Warning if exceeded. "
     "emitter.setMaxListeners(20) to increase. "
     "Always remove listeners when done: emitter.removeListener(). "
     "Use once() for one-time listeners."),

    ("Node: process.nextTick vs setImmediate",
     "nextTick runs before I/O callbacks (microtask). "
     "setImmediate runs after I/O callbacks (macrotask). "
     "Recursive nextTick can starve I/O - use setImmediate for recursive calls. "
     "Promise callbacks also run in microtask queue."),

    ("Node: Buffer handling",
     "Buffer.from(string, encoding) to create. "
     "buf.toString(encoding) to convert back. "
     "Allocate with Buffer.alloc(size) (zeroed) or Buffer.allocUnsafe(size) (faster, uninitialized). "
     "Buffer.allocUnsafe may contain old memory - fill before use."),

    ("Node: Stream error handling",
     "Always handle 'error' event on streams. "
     "Unhandled error crashes process. "
     "stream.on('error', handleError). "
     "Use pipeline() for automatic error handling: "
     "pipeline(source, transform, dest, callback);"),

    ("Node: Graceful shutdown",
     "Handle SIGTERM/SIGINT for clean shutdown. "
     "process.on('SIGTERM', () => { server.close(() => process.exit(0)); }); "
     "Set timeout for forced exit if graceful takes too long. "
     "Close database connections, finish pending requests."),
]

# ============================================================================
# DATABASE FUNCTIONS
# ============================================================================

def create_tables(conn: sqlite3.Connection):
    """Ensure tables exist (same schema as build_docs_db.py)"""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            language TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT UNIQUE,
            created_at REAL DEFAULT (julianday('now'))
        )
    """)

    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_language ON docs(language)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_category ON docs(category)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_title ON docs(title)")

    # FTS for full-text search
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
            title, content, content='docs', content_rowid='id'
        )
    """)

    conn.commit()


def insert_docs(conn: sqlite3.Connection, docs: List[Tuple[str, str]],
                category: str, language: str = "javascript") -> int:
    """Insert documentation entries into database"""
    inserted = 0

    for title, content in docs:
        content_hash = hashlib.md5(content.encode()).hexdigest()

        try:
            cursor = conn.execute("""
                INSERT INTO docs (language, category, title, content, content_hash)
                VALUES (?, ?, ?, ?, ?)
            """, (language, category, title, content, content_hash))

            # Update FTS
            conn.execute("""
                INSERT INTO docs_fts (rowid, title, content)
                VALUES (?, ?, ?)
            """, (cursor.lastrowid, title, content))

            inserted += 1

        except sqlite3.IntegrityError:
            pass  # Duplicate

    conn.commit()
    return inserted


def add_all_js_docs(db_path: str = OUTPUT_DB) -> dict:
    """Add all JavaScript documentation to the database"""
    print(f"Adding JavaScript docs to: {db_path}")

    conn = sqlite3.connect(db_path)
    create_tables(conn)

    stats = {}

    # Add error patterns
    count = insert_docs(conn, JS_ERROR_PATTERNS, "errors/common")
    stats["Error Patterns"] = count
    print(f"  Added {count} error pattern sections")

    # Add async/await patterns
    count = insert_docs(conn, JS_ASYNC_PATTERNS, "async/patterns")
    stats["Async/Await Patterns"] = count
    print(f"  Added {count} async/await sections")

    # Add array/object gotchas
    count = insert_docs(conn, JS_ARRAY_OBJECT_GOTCHAS, "methods/gotchas")
    stats["Array/Object Gotchas"] = count
    print(f"  Added {count} array/object gotcha sections")

    # Add scope patterns
    count = insert_docs(conn, JS_SCOPE_PATTERNS, "scope/patterns")
    stats["Scope/Closure Patterns"] = count
    print(f"  Added {count} scope/closure sections")

    # Add type coercion
    count = insert_docs(conn, JS_TYPE_COERCION, "types/coercion")
    stats["Type Coercion"] = count
    print(f"  Added {count} type coercion sections")

    # Add best practices
    count = insert_docs(conn, JS_BEST_PRACTICES, "best-practices")
    stats["Best Practices"] = count
    print(f"  Added {count} best practice sections")

    # Add Node.js patterns
    count = insert_docs(conn, JS_NODEJS_PATTERNS, "nodejs/patterns")
    stats["Node.js Patterns"] = count
    print(f"  Added {count} Node.js pattern sections")

    # Get totals
    cursor = conn.execute("""
        SELECT language, COUNT(*)
        FROM docs
        GROUP BY language
    """)

    print("\nTotal by language:")
    for row in cursor:
        print(f"  {row[0]}: {row[1]} sections")

    cursor = conn.execute("SELECT COUNT(*) FROM docs WHERE language = 'javascript'")
    total_js = cursor.fetchone()[0]

    conn.close()

    stats["Total JS Sections"] = total_js
    return stats


def search_docs(query: str, db_path: str = OUTPUT_DB, limit: int = 5):
    """Search the docs database (for testing)"""
    conn = sqlite3.connect(db_path)

    cursor = conn.execute("""
        SELECT d.language, d.category, d.title,
               snippet(docs_fts, 1, '>>>', '<<<', '...', 50) as snippet
        FROM docs_fts
        JOIN docs d ON docs_fts.rowid = d.id
        WHERE docs_fts MATCH ?
        ORDER BY rank
        LIMIT ?
    """, (query, limit))

    results = cursor.fetchall()
    conn.close()

    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Add JavaScript docs to Mini-COT database")
    parser.add_argument("--db", type=str, default=OUTPUT_DB, help="Database path")
    parser.add_argument("--search", type=str, help="Search the database")
    parser.add_argument("--stats", action="store_true", help="Show statistics")

    args = parser.parse_args()

    if args.search:
        results = search_docs(args.search, args.db)
        for lang, cat, title, snippet in results:
            print(f"\n[{lang}] {cat}/{title}")
            print(f"  {snippet}")
    elif args.stats:
        conn = sqlite3.connect(args.db)
        cursor = conn.execute("""
            SELECT language, category, COUNT(*)
            FROM docs
            GROUP BY language, category
            ORDER BY language, COUNT(*) DESC
        """)
        print("Documentation sections by category:")
        for row in cursor:
            print(f"  {row[0]}/{row[1]}: {row[2]}")
        conn.close()
    else:
        stats = add_all_js_docs(args.db)
        print("\n=== JavaScript Documentation Added ===")
        for key, value in stats.items():
            print(f"  {key}: {value}")
