#!/usr/bin/env python3
import sqlite3
import hashlib

DB = "/specmem/embedding-sandbox/docs/python_docs.db"
DOCS = [
    ("TypeError: Cannot read property of undefined", "This error occurs when trying to access a property on undefined or null. Fix: Use optional chaining (?.) like obj?.prop or nullish coalescing."),
    ("TypeError: Cannot read property of null", "Similar to undefined error. Fix: Check for null before accessing or use optional chaining."),
    ("TypeError: x is not a function", "Calling something that isn't callable. Common causes: Overwriting a function with a variable. Fix: Check type with typeof fn === 'function'."),
    ("TypeError: x.map is not a function", "Calling array methods on non-arrays. Fix: Use Array.isArray(x) before array methods."),
    ("ReferenceError: x is not defined", "Variable doesn't exist in current scope. Causes: Typo, using before declaration. Fix: Check spelling."),
    ("ReferenceError: Cannot access before initialization", "Temporal Dead Zone error with let/const. Fix: Move declaration before usage."),
    ("SyntaxError: Unexpected token", "Parser encountered something unexpected. Causes: Missing comma, brackets. Fix: Check syntax."),
    ("RangeError: Maximum call stack size exceeded", "Infinite recursion. Fix: Add proper base case."),
    ("async/await: Unhandled promise rejection", "Async function throws but no try-catch. Fix: Always wrap await in try-catch."),
    ("async/await: await in forEach doesn't work", "forEach doesn't wait for async callbacks. Fix: Use for...of loop."),
    ("async/await: Forgetting to await", "Without await, you get Promise object. Fix: Always await async calls."),
    ("Promise: Promise.all fails fast", "Rejects when ANY promise rejects. Fix: Use Promise.allSettled()."),
    ("Array: sort() sorts as strings", "[10, 2, 1].sort() returns [1, 10, 2]. Fix: arr.sort((a, b) => a - b)."),
    ("Array: splice vs slice", "splice MUTATES array, slice returns NEW array."),
    ("Object: Shallow vs deep copy", "Spread creates SHALLOW copies. Fix: Use structuredClone(obj)."),
    ("Hoisting: var vs let/const", "var is hoisted to undefined. let/const have TDZ."),
    ("Closure: Loop variable capture", "for(var i) captures same i. Fix: Use let."),
    ("this: Lost context in callbacks", "this in callbacks is not instance. Fix: Use arrow functions."),
    ("Equality: == vs ===", "== coerces types. Best practice: Always use ===."),
    ("Coercion: + with strings", "'1' + 2 = '12'. Fix: Number('1') + 2."),
    ("Coercion: Falsy values", "0 and '' are falsy but valid. Fix: Use ?? for null/undefined."),
    ("Optional chaining: ?.", "obj?.prop returns undefined if null/undefined."),
    ("Nullish coalescing: ??", "Only returns right for null/undefined. 0 ?? 10 is 0."),
    ("Node: require vs import", "CommonJS: require synchronous. ESM: import static."),
    ("Node: __dirname in ESM", "__dirname not in ESM. Fix: import.meta.url."),
    ("Node: Callback error-first", "callback(error, result). Handle error first."),
    ("Node: Stream error handling", "Always handle error event on streams."),
    ("Array: reduce initial value", "Empty array without initial throws. Fix: arr.reduce((a,x)=>a+x,0)."),
    ("Object: in vs hasOwn", "'prop' in obj checks prototype. Use Object.hasOwn()."),
    ("Spread operator: Array/Object", "[...arr] copies array. {...obj} copies object."),
]

conn = sqlite3.connect(DB)
conn.execute('CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, language TEXT, category TEXT, title TEXT, content TEXT, content_hash TEXT UNIQUE, created_at REAL)')
conn.execute('CREATE INDEX IF NOT EXISTS idx_docs_language ON docs(language)')
conn.execute('CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, content, content=docs, content_rowid=id)')
conn.commit()

n = 0
for title, content in DOCS:
    h = hashlib.md5(content.encode()).hexdigest()
    try:
        c = conn.execute("INSERT INTO docs (language, category, title, content, content_hash) VALUES (?, ?, ?, ?, ?)", ("javascript", "errors", title, content, h))
        conn.execute("INSERT INTO docs_fts (rowid, title, content) VALUES (?, ?, ?)", (c.lastrowid, title, content))
        n += 1
    except: pass
conn.commit()

r = conn.execute("SELECT language, COUNT(*) FROM docs GROUP BY language").fetchall()
print(f"Inserted: {n}")
for lang, cnt in r:
    print(f"  {lang}: {cnt}")
conn.close()
