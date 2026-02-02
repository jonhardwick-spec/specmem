# Efficient Grep Patterns - Token Usage Optimization

-IMPORTANT-


## 🚨 CRITICAL: Grep Output Modes Save Tokens! 🚨

**Default behavior shows file path on EVERY line = TOKEN WASTE!**

## Token-Efficient Output Modes

### ❌ AVOID: Default output (shows path on every line)
```javascript
// BAD - Shows path multiple times
await Grep({
    pattern: 'functionName',
    path: 'serverModules'
});
// Output:
// serverModules/file1.js:10: function functionName() {
// serverModules/file1.js:15:   functionName();
// serverModules/file1.js:20:   functionName();
// serverModules/file2.js:5: function functionName() {
// ^^^ PATH REPEATED 4 TIMES = WASTED TOKENS ^^^
```

### ✅ USE: files_with_matches (only shows path once)
```javascript
// GOOD - Only shows which files match
await Grep({
    pattern: 'functionName',
    path: 'serverModules',
    output_mode: 'files_with_matches'
});
// Output:
// serverModules/file1.js
// serverModules/file2.js
// ^^^ EACH PATH SHOWN ONCE = MINIMAL TOKENS ^^^
```

### ✅ USE: count (shows match counts)
```javascript
// GOOD - Shows how many matches per file
await Grep({
    pattern: 'TODO',
    path: 'serverModules',
    output_mode: 'count'
});
// Output:
// serverModules/file1.js:5
// serverModules/file2.js:12
// ^^^ COMPACT FORMAT = LOW TOKENS ^^^
```

### ✅ USE: content with head_limit (limit results)
```javascript
// GOOD - Only get first N matches
await Grep({
    pattern: 'error',
    path: 'serverModules',
    output_mode: 'content',
    head_limit: 5
});
// Only returns first 5 matches instead of 500+
```

## When to Use Each Mode

### 1. **files_with_matches** - Finding locations
**Use when**: You need to know WHICH files contain a pattern
**Token savings**: ~70-90% vs default
```javascript
// Find which files have encryption logic
await Grep({
    pattern: 'encryptContent',
    path: 'serverModules',
    output_mode: 'files_with_matches'
});
```

### 2. **count** - Finding hotspots
**Use when**: You need to know HOW MANY times pattern appears
**Token savings**: ~80-95% vs default
```javascript
// Count how many TODOs in each file
await Grep({
    pattern: 'TODO',
    glob: '**/*.js !**/node_modules/**',
    output_mode: 'count'
});
```

### 3. **content with head_limit** - Getting context
**Use when**: You need actual code but not ALL matches
**Token savings**: ~50-80% vs default (depends on limit)
```javascript
// Get first 3 occurrences with context
await Grep({
    pattern: 'async function',
    path: 'serverModules/auth',
    output_mode: 'content',
    head_limit: 3,
    '-C': 3  // 3 lines context before/after
});
```

## Best Practices

### Workflow: Two-Stage Search

**Stage 1**: Use `files_with_matches` to find files
```javascript
const files = await Grep({
    pattern: 'encryptWithKey',
    path: 'serverModules',
    output_mode: 'files_with_matches'
});
// Returns: serverModules/protections/EncryptionProtection.js
```

**Stage 2**: Use `content` on specific file with context
```javascript
const code = await Grep({
    pattern: 'encryptWithKey',
    path: 'serverModules/protections/EncryptionProtection.js',
    output_mode: 'content',
    '-C': 5  // Get surrounding context
});
```

### Always Use Path Filters

**❌ BAD**: Search entire project
```javascript
await Grep({ pattern: 'config' });  // Searches EVERYTHING including node_modules
```

**✅ GOOD**: Specify path
```javascript
await Grep({
    pattern: 'config',
    path: 'serverModules'  // Only search relevant directory
});
```

**✅ BETTER**: Use glob exclusions
```javascript
await Grep({
    pattern: 'config',
    glob: '**/*.js !**/node_modules/**'  // Explicitly exclude node_modules
});
```

## Token Usage Comparison

| Output Mode | Token Cost | Use Case |
|-------------|-----------|----------|
| **Default (content)** | ~1000+ tokens | Full code review |
| **files_with_matches** | ~100-200 tokens | Find file locations |
| **count** | ~50-100 tokens | Count occurrences |
| **content + head_limit:5** | ~300-500 tokens | Quick peek at code |

## Summary

- **Default output repeats file paths = TOKEN WASTE**
- **Use `files_with_matches` to find files first** (~90% token savings)
- **Use `count` to find hotspots** (~95% token savings)
- **Use `content + head_limit` for targeted code** (~70% token savings)
- **ALWAYS specify `path:` or `glob:` to avoid node_modules**

**Rule of Thumb**: If you don't need the actual code content, use `files_with_matches`!
