/**
 * codeAnalyzer.ts - Advanced Code Analysis for Semantic Search
 *
 * yo this analyzer SLAPS - extracts definitions, dependencies, chunks, and complexity
 * from code files for storage in PostgreSQL with vector embeddings
 *
 * Features:
 * - Function/class/variable definition extraction
 * - Import/dependency tracking
 * - Code chunking for semantic search
 * - Complexity metrics calculation
 * - Multi-language support (TypeScript, JavaScript, Python, etc.)
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { getProjectPath } from '../config.js';
// ========================================
// CODE ANALYZER CLASS
// ========================================
/**
 * CodeAnalyzer - extracts semantic information from code
 *
 * yo this class is the BRAIN of semantic code search
 * parses code and extracts definitions, dependencies, chunks
 */
export class CodeAnalyzer {
    chunkSize;
    chunkOverlap;
    analyzerVersion = '1.0.0';
    constructor(options) {
        this.chunkSize = options?.chunkSize ?? 50; // lines per chunk
        this.chunkOverlap = options?.chunkOverlap ?? 10; // overlap between chunks
    }
    /**
     * analyzeFile - performs complete analysis of a code file
     */
    async analyzeFile(fileId, filePath, content, language) {
        const startTime = Date.now();
        logger.debug({ filePath, language }, 'analyzing file...');
        const lines = content.split('\n');
        // Extract all components
        const definitions = this.extractDefinitions(fileId, filePath, content, language);
        const dependencies = this.extractDependencies(fileId, filePath, content, language);
        const chunks = this.createChunks(fileId, filePath, content, language, lines);
        const complexity = this.calculateComplexity(fileId, filePath, content, language, lines);
        const duration = Date.now() - startTime;
        logger.debug({
            filePath,
            definitions: definitions.length,
            dependencies: dependencies.length,
            chunks: chunks.length,
            duration
        }, 'file analysis complete');
        return {
            fileId,
            filePath,
            language,
            definitions,
            dependencies,
            chunks,
            complexity,
            analyzedAt: new Date()
        };
    }
    // ========================================
    // DEFINITION EXTRACTION
    // ========================================
    /**
     * extractDefinitions - extracts function/class/variable definitions
     */
    extractDefinitions(fileId, filePath, content, language) {
        const definitions = [];
        const lines = content.split('\n');
        // Language-specific extraction
        switch (language) {
            case 'typescript':
            case 'typescript-react':
            case 'javascript':
            case 'javascript-react':
                this.extractTSJSDefinitions(fileId, filePath, lines, language, definitions);
                break;
            case 'python':
                this.extractPythonDefinitions(fileId, filePath, lines, language, definitions);
                break;
            case 'go':
                this.extractGoDefinitions(fileId, filePath, lines, language, definitions);
                break;
            case 'rust':
                this.extractRustDefinitions(fileId, filePath, lines, language, definitions);
                break;
            case 'html':
                this.extractHTMLDefinitions(fileId, filePath, lines, language, definitions);
                break;
            case 'java':
            case 'kotlin':
            case 'scala':
                this.extractJavaDefinitions(fileId, filePath, lines, language, definitions);
                break;
            case 'cpp':
            case 'c':
                this.extractCppDefinitions(fileId, filePath, lines, language, definitions);
                break;
            default:
                // Generic extraction for unknown languages
                this.extractGenericDefinitions(fileId, filePath, lines, language, definitions);
        }
        return definitions;
    }
    /**
     * extractTSJSDefinitions - extracts TypeScript/JavaScript definitions
     *
     * Uses a definition stack to track nested functions/classes/methods
     * so inner functions get proper parentDefinitionId linkage
     */
    extractTSJSDefinitions(fileId, filePath, lines, language, definitions) {
        // Regex patterns for TS/JS
        const patterns = {
            // Functions: function name(), async function, etc.
            function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?/,
            // Top-level arrow functions
            arrowFunction: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,
            // Nested arrow functions (indented)
            nestedArrowFunction: /^\s+(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,
            // Nested function declarations (indented)
            nestedFunction: /^\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?/,
            // Classes and interfaces
            class: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/,
            interface: /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?/,
            type: /^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/,
            enum: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/,
            // Methods within classes
            method: /^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\{]+))?/,
            // Constants and variables
            constant: /^(?:export\s+)?const\s+(\w+)\s*(?::\s*([^=]+))?\s*=/,
            variable: /^(?:export\s+)?(?:let|var)\s+(\w+)\s*(?::\s*([^=]+))?\s*=/
        };
        // Stack to track nested definitions - each entry has {def, braceDepthAtStart}
        // bruh this stack approach lets us track nested functions properly
        const definitionStack = [];
        let braceDepth = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Track brace depth - do this BEFORE popping the stack
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            // Pop definitions from stack when their scope closes
            // gotta check before we update braceDepth so we catch the closing brace
            for (let b = 0; b < closeBraces; b++) {
                const newDepth = braceDepth - (b + 1);
                while (definitionStack.length > 0 && definitionStack[definitionStack.length - 1].braceDepthAtStart >= newDepth) {
                    definitionStack.pop();
                }
            }
            braceDepth += openBraces - closeBraces;
            // Skip comments and empty lines
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed === '') {
                continue;
            }
            // Helper to get current parent definition
            const getCurrentParent = () => {
                return definitionStack.length > 0 ? definitionStack[definitionStack.length - 1].def : null;
            };
            // Helper to get qualified name
            const getQualifiedName = (name) => {
                const parent = getCurrentParent();
                if (!parent)
                    return undefined;
                return parent.qualifiedName ? `${parent.qualifiedName}.${name}` : `${parent.name}.${name}`;
            };
            // Check for class definition
            let match = line.match(patterns.class);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'class',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('export'),
                    isAbstract: line.includes('abstract'),
                    parentDefinitionId: parent?.id,
                    signature: trimmed
                });
                definitions.push(def);
                // Push to stack so nested stuff knows its parent
                if (line.includes('{')) {
                    definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                }
                continue;
            }
            // Check for interface definition
            match = line.match(patterns.interface);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'interface',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('export'),
                    signature: trimmed
                }));
                continue;
            }
            // Check for type definition
            match = line.match(patterns.type);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'type',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('export'),
                    signature: trimmed
                }));
                continue;
            }
            // Check for enum definition
            match = line.match(patterns.enum);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'enum',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('export'),
                    signature: trimmed
                }));
                continue;
            }
            // Check for top-level function definition
            match = line.match(patterns.function);
            if (match) {
                const parent = getCurrentParent();
                const params = this.parseParameters(match[2] || '');
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'function',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('export'),
                    isAsync: line.includes('async'),
                    returnType: match[3]?.trim(),
                    parameters: params,
                    parentDefinitionId: parent?.id,
                    signature: trimmed
                });
                definitions.push(def);
                // Push to stack for nested function tracking
                if (line.includes('{')) {
                    definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                }
                continue;
            }
            // Check for top-level arrow function
            match = line.match(patterns.arrowFunction);
            if (match && braceDepth === 0) {
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'function',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('export'),
                    isAsync: line.includes('async'),
                    signature: trimmed
                });
                definitions.push(def);
                // Push if it has a body block
                if (line.includes('{')) {
                    definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                }
                continue;
            }
            // Check for nested function/arrow function inside another definition
            const parent = getCurrentParent();
            if (parent && braceDepth > 0) {
                // Check for nested function declaration
                match = line.match(patterns.nestedFunction);
                if (match) {
                    const params = this.parseParameters(match[2] || '');
                    const def = this.createDefinition(fileId, filePath, {
                        name: match[1],
                        qualifiedName: getQualifiedName(match[1]),
                        definitionType: 'function',
                        startLine: i + 1,
                        language,
                        isAsync: line.includes('async'),
                        returnType: match[3]?.trim(),
                        parameters: params,
                        parentDefinitionId: parent.id,
                        signature: trimmed
                    });
                    definitions.push(def);
                    if (line.includes('{')) {
                        definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                    }
                    continue;
                }
                // Check for nested arrow function
                match = line.match(patterns.nestedArrowFunction);
                if (match) {
                    const def = this.createDefinition(fileId, filePath, {
                        name: match[1],
                        qualifiedName: getQualifiedName(match[1]),
                        definitionType: 'function',
                        startLine: i + 1,
                        language,
                        isAsync: line.includes('async'),
                        parentDefinitionId: parent.id,
                        signature: trimmed
                    });
                    definitions.push(def);
                    if (line.includes('{')) {
                        definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                    }
                    continue;
                }
                // Check for method within class (parent must be a class)
                if (parent.definitionType === 'class') {
                    match = line.match(patterns.method);
                    if (match && match[1] !== 'if' && match[1] !== 'for' && match[1] !== 'while' && match[1] !== 'switch' && match[1] !== 'catch') {
                        const params = this.parseParameters(match[2] || '');
                        const def = this.createDefinition(fileId, filePath, {
                            name: match[1],
                            qualifiedName: `${parent.name}.${match[1]}`,
                            definitionType: 'method',
                            startLine: i + 1,
                            language,
                            visibility: this.detectVisibility(line),
                            isStatic: line.includes('static'),
                            isAsync: line.includes('async'),
                            returnType: match[3]?.trim(),
                            parameters: params,
                            parentDefinitionId: parent.id,
                            signature: trimmed
                        });
                        definitions.push(def);
                        if (line.includes('{')) {
                            definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                        }
                    }
                }
            }
            // Check for constant (top-level only)
            if (braceDepth === 0) {
                match = line.match(patterns.constant);
                if (match && !line.includes('=>')) {
                    definitions.push(this.createDefinition(fileId, filePath, {
                        name: match[1],
                        definitionType: 'constant',
                        startLine: i + 1,
                        language,
                        isExported: line.includes('export'),
                        signature: trimmed
                    }));
                }
            }
        }
    }
    /**
     * extractPythonDefinitions - extracts Python definitions
     *
     * Uses indentation-based stack to track nested functions/classes
     * Python's indentation makes this cleaner than brace-based languages
     */
    extractPythonDefinitions(fileId, filePath, lines, language, definitions) {
        const patterns = {
            function: /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/,
            class: /^(\s*)class\s+(\w+)(?:\(([^)]*)\))?:/,
            variable: /^(\w+)\s*(?::\s*([^=]+))?\s*=/
        };
        // Stack tracks {def, indentLevel} so we can pop when indent decreases
        // Python uses indentation not braces, so this approach is more accurate
        const definitionStack = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Skip comments and empty lines (but track them for line counting)
            if (trimmed.startsWith('#') || trimmed === '') {
                continue;
            }
            const indent = line.length - line.trimStart().length;
            // Pop stack when indentation decreases - we've left the nested scope
            while (definitionStack.length > 0 && definitionStack[definitionStack.length - 1].indentLevel >= indent) {
                definitionStack.pop();
            }
            // Helper to get current parent
            const getCurrentParent = () => {
                return definitionStack.length > 0 ? definitionStack[definitionStack.length - 1].def : null;
            };
            // Helper to build qualified name from stack
            const getQualifiedName = (name) => {
                if (definitionStack.length === 0)
                    return undefined;
                const names = definitionStack.map(s => s.def.name);
                names.push(name);
                return names.join('.');
            };
            // Check for class definition
            let match = line.match(patterns.class);
            if (match) {
                const classIndent = match[1].length;
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[2],
                    qualifiedName: getQualifiedName(match[2]),
                    definitionType: 'class',
                    startLine: i + 1,
                    language,
                    parentDefinitionId: parent?.id,
                    signature: trimmed
                });
                definitions.push(def);
                definitionStack.push({ def, indentLevel: classIndent });
                continue;
            }
            // Check for function/method definition
            match = line.match(patterns.function);
            if (match) {
                const funcIndent = match[1].length;
                const parent = getCurrentParent();
                const params = this.parsePythonParameters(match[3] || '');
                // Determine if this is a method (parent is a class) or nested function
                const isMethod = parent?.definitionType === 'class';
                const isNestedFunction = parent && !isMethod;
                const def = this.createDefinition(fileId, filePath, {
                    name: match[2],
                    qualifiedName: getQualifiedName(match[2]),
                    definitionType: isMethod ? 'method' : 'function',
                    startLine: i + 1,
                    language,
                    isAsync: line.includes('async'),
                    returnType: match[4]?.trim(),
                    parameters: params,
                    parentDefinitionId: parent?.id,
                    visibility: match[2].startsWith('__') ? 'private' : (match[2].startsWith('_') ? 'protected' : 'public'),
                    signature: trimmed
                });
                definitions.push(def);
                // Push to stack so nested functions inside this one get tracked
                definitionStack.push({ def, indentLevel: funcIndent });
                continue;
            }
            // Check for module-level variable (SCREAMING_CASE = constant)
            if (indent === 0) {
                match = trimmed.match(patterns.variable);
                if (match && match[1][0] === match[1][0].toUpperCase()) {
                    definitions.push(this.createDefinition(fileId, filePath, {
                        name: match[1],
                        definitionType: 'constant',
                        startLine: i + 1,
                        language,
                        signature: trimmed
                    }));
                }
            }
        }
    }
    /**
     * extractGoDefinitions - extracts Go definitions
     */
    extractGoDefinitions(fileId, filePath, lines, language, definitions) {
        const patterns = {
            function: /^func\s+(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*([^\{]+))?/,
            method: /^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*([^\{]+))?/,
            struct: /^type\s+(\w+)\s+struct\s*\{/,
            interface: /^type\s+(\w+)\s+interface\s*\{/,
            type: /^type\s+(\w+)\s+/,
            constant: /^const\s+(\w+)\s*(?:(\w+))?\s*=/,
            variable: /^var\s+(\w+)\s+/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Skip comments and empty lines
            if (trimmed.startsWith('//') || trimmed === '') {
                continue;
            }
            // Check for method (has receiver)
            let match = line.match(patterns.method);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[3],
                    qualifiedName: `${match[2]}.${match[3]}`,
                    definitionType: 'method',
                    startLine: i + 1,
                    language,
                    isExported: match[3][0] === match[3][0].toUpperCase(),
                    signature: trimmed
                }));
                continue;
            }
            // Check for function
            match = line.match(patterns.function);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'function',
                    startLine: i + 1,
                    language,
                    isExported: match[1][0] === match[1][0].toUpperCase(),
                    signature: trimmed
                }));
                continue;
            }
            // Check for struct
            match = line.match(patterns.struct);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'struct',
                    startLine: i + 1,
                    language,
                    isExported: match[1][0] === match[1][0].toUpperCase(),
                    signature: trimmed
                }));
                continue;
            }
            // Check for interface
            match = line.match(patterns.interface);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'interface',
                    startLine: i + 1,
                    language,
                    isExported: match[1][0] === match[1][0].toUpperCase(),
                    signature: trimmed
                }));
                continue;
            }
        }
    }
    /**
     * extractRustDefinitions - extracts Rust definitions
     */
    extractRustDefinitions(fileId, filePath, lines, language, definitions) {
        const patterns = {
            function: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^\{]+))?/,
            struct: /^(?:pub\s+)?struct\s+(\w+)/,
            enum: /^(?:pub\s+)?enum\s+(\w+)/,
            trait: /^(?:pub\s+)?trait\s+(\w+)/,
            impl: /^impl(?:<[^>]*>)?\s+(?:(\w+)\s+for\s+)?(\w+)/,
            constant: /^(?:pub\s+)?const\s+(\w+)\s*:/,
            static: /^(?:pub\s+)?static\s+(\w+)\s*:/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('//') || trimmed === '') {
                continue;
            }
            // Check for function
            let match = line.match(patterns.function);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'function',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('pub'),
                    isAsync: line.includes('async'),
                    returnType: match[3]?.trim(),
                    signature: trimmed
                }));
                continue;
            }
            // Check for struct
            match = line.match(patterns.struct);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'struct',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('pub'),
                    signature: trimmed
                }));
                continue;
            }
            // Check for enum
            match = line.match(patterns.enum);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'enum',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('pub'),
                    signature: trimmed
                }));
                continue;
            }
            // Check for trait
            match = line.match(patterns.trait);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'trait',
                    startLine: i + 1,
                    language,
                    isExported: line.includes('pub'),
                    signature: trimmed
                }));
                continue;
            }
        }
    }
    /**
     * extractGenericDefinitions - generic extraction for unknown languages
     */
    extractGenericDefinitions(fileId, filePath, lines, language, definitions) {
        // Basic patterns that work across many languages
        const patterns = {
            function: /(?:function|func|def|fn|sub)\s+(\w+)/,
            class: /(?:class|struct|type)\s+(\w+)/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            let match = line.match(patterns.function);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'function',
                    startLine: i + 1,
                    language,
                    signature: trimmed
                }));
                continue;
            }
            match = line.match(patterns.class);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'class',
                    startLine: i + 1,
                    language,
                    signature: trimmed
                }));
            }
        }
    }
    // ========================================
    // DEPENDENCY EXTRACTION
    // ========================================
    /**
     * extractDependencies - extracts import/require statements
     */
    extractDependencies(fileId, filePath, content, language) {
        const dependencies = [];
        const lines = content.split('\n');
        switch (language) {
            case 'typescript':
            case 'typescript-react':
            case 'javascript':
            case 'javascript-react':
                this.extractTSJSDependencies(fileId, filePath, lines, language, dependencies);
                break;
            case 'python':
                this.extractPythonDependencies(fileId, filePath, lines, language, dependencies);
                break;
            case 'go':
                this.extractGoDependencies(fileId, filePath, lines, language, dependencies);
                break;
            case 'rust':
                this.extractRustDependencies(fileId, filePath, lines, language, dependencies);
                break;
            case 'html':
                this.extractHTMLDependencies(fileId, filePath, lines, language, dependencies);
                break;
            case 'java':
            case 'kotlin':
            case 'scala':
                this.extractJavaDependencies(fileId, filePath, lines, language, dependencies);
                break;
            case 'cpp':
            case 'c':
                this.extractCppDependencies(fileId, filePath, lines, language, dependencies);
                break;
            default:
                // Try generic patterns
                this.extractGenericDependencies(fileId, filePath, lines, language, dependencies);
        }
        return dependencies;
    }
    /**
     * extractTSJSDependencies - extracts TypeScript/JavaScript imports
     */
    extractTSJSDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            // import { foo, bar } from 'module'
            namedImport: /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/,
            // import foo from 'module'
            defaultImport: /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
            // import * as foo from 'module'
            namespaceImport: /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
            // import 'module' (side effect)
            sideEffectImport: /^import\s+['"]([^'"]+)['"]/,
            // import type { foo } from 'module'
            typeImport: /^import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/,
            // const foo = require('module')
            require: /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
            // Dynamic import: import('module')
            dynamicImport: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
            // export { foo } from 'module' (re-export)
            reexport: /^export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Type import
            let match = trimmed.match(patterns.typeImport);
            if (match) {
                const names = match[1].split(',').map(n => n.trim());
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[2],
                    importType: 'import_type',
                    importStatement: trimmed,
                    importedNames: names,
                    isTypeImport: true,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[2])
                }));
                continue;
            }
            // Named import
            match = trimmed.match(patterns.namedImport);
            if (match) {
                const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
                const aliases = match[1].split(',').map(n => {
                    const parts = n.trim().split(/\s+as\s+/);
                    return parts[1] || parts[0];
                });
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[2],
                    importType: 'import',
                    importStatement: trimmed,
                    importedNames: names,
                    importedAs: aliases,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[2])
                }));
                continue;
            }
            // Namespace import
            match = trimmed.match(patterns.namespaceImport);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[2],
                    importType: 'import',
                    importStatement: trimmed,
                    importedAs: [match[1]],
                    isNamespaceImport: true,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[2])
                }));
                continue;
            }
            // Default import
            match = trimmed.match(patterns.defaultImport);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[2],
                    importType: 'import',
                    importStatement: trimmed,
                    importedAs: [match[1]],
                    isDefaultImport: true,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[2])
                }));
                continue;
            }
            // Side effect import
            match = trimmed.match(patterns.sideEffectImport);
            if (match && !trimmed.includes('from')) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'side_effect',
                    importStatement: trimmed,
                    isSideEffectImport: true,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[1])
                }));
                continue;
            }
            // Require
            match = trimmed.match(patterns.require);
            if (match) {
                const target = match[3];
                const names = match[1] ? match[1].split(',').map(n => n.trim()) : [];
                const alias = match[2];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: target,
                    importType: 'require',
                    importStatement: trimmed,
                    importedNames: names,
                    importedAs: alias ? [alias] : [],
                    isDefaultImport: !!alias,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(target)
                }));
                continue;
            }
            // Dynamic import
            match = trimmed.match(patterns.dynamicImport);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'dynamic',
                    importStatement: trimmed,
                    isDynamic: true,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[1])
                }));
                continue;
            }
            // Re-export
            match = trimmed.match(patterns.reexport);
            if (match) {
                const names = match[1].split(',').map(n => n.trim());
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[2],
                    importType: 'reexport',
                    importStatement: trimmed,
                    importedNames: names,
                    lineNumber: i + 1,
                    language,
                    ...this.classifyImport(match[2])
                }));
            }
        }
    }
    /**
     * extractPythonDependencies - extracts Python imports
     */
    extractPythonDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            // from module import foo, bar
            fromImport: /^from\s+([\w.]+)\s+import\s+(.+)/,
            // import module
            import: /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // from import
            let match = trimmed.match(patterns.fromImport);
            if (match) {
                const names = match[2].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'from',
                    importStatement: trimmed,
                    importedNames: names,
                    lineNumber: i + 1,
                    language,
                    isExternal: !match[1].startsWith('.'),
                    isRelative: match[1].startsWith('.')
                }));
                continue;
            }
            // simple import
            match = trimmed.match(patterns.import);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'import',
                    importStatement: trimmed,
                    importedAs: match[2] ? [match[2]] : [],
                    lineNumber: i + 1,
                    language,
                    isExternal: !match[1].startsWith('.'),
                    isRelative: match[1].startsWith('.')
                }));
            }
        }
    }
    /**
     * extractGoDependencies - extracts Go imports
     */
    extractGoDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            singleImport: /^import\s+(?:(\w+)\s+)?["']([^"']+)["']/,
            blockStart: /^import\s*\(/
        };
        let inBlock = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.match(patterns.blockStart)) {
                inBlock = true;
                continue;
            }
            if (inBlock && trimmed === ')') {
                inBlock = false;
                continue;
            }
            if (inBlock) {
                const match = trimmed.match(/^(?:(\w+)\s+)?["']([^"']+)["']/);
                if (match) {
                    dependencies.push(this.createDependency(fileId, filePath, {
                        targetPath: match[2],
                        importType: 'import',
                        importStatement: trimmed,
                        importedAs: match[1] ? [match[1]] : [],
                        lineNumber: i + 1,
                        language,
                        isExternal: !match[2].startsWith('.')
                    }));
                }
                continue;
            }
            const match = trimmed.match(patterns.singleImport);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[2],
                    importType: 'import',
                    importStatement: trimmed,
                    importedAs: match[1] ? [match[1]] : [],
                    lineNumber: i + 1,
                    language,
                    isExternal: !match[2].startsWith('.')
                }));
            }
        }
    }
    /**
     * extractRustDependencies - extracts Rust use statements
     */
    extractRustDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            use: /^use\s+([\w:]+)(?:::\{([^}]+)\})?(?:\s+as\s+(\w+))?;/,
            extern: /^extern\s+crate\s+(\w+)/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            let match = trimmed.match(patterns.use);
            if (match) {
                const names = match[2] ? match[2].split(',').map(n => n.trim()) : [];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'import',
                    importStatement: trimmed,
                    importedNames: names,
                    importedAs: match[3] ? [match[3]] : [],
                    lineNumber: i + 1,
                    language,
                    isExternal: !match[1].startsWith('crate') && !match[1].startsWith('self') && !match[1].startsWith('super')
                }));
                continue;
            }
            match = trimmed.match(patterns.extern);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'import',
                    importStatement: trimmed,
                    packageName: match[1],
                    lineNumber: i + 1,
                    language,
                    isExternal: true
                }));
            }
        }
    }
    /**
     * extractGenericDependencies - generic extraction for unknown languages
     */
    extractGenericDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            import: /(?:import|include|require|use)\s+['"]?([^\s'"]+)['"]?/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const match = trimmed.match(patterns.import);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'import',
                    importStatement: trimmed,
                    lineNumber: i + 1,
                    language
                }));
            }
        }
    }
    // ========================================
    // CODE CHUNKING
    // ========================================
    /**
     * createChunks - splits code into chunks for semantic search
     */
    createChunks(fileId, filePath, content, language, lines) {
        if (language === 'html') {
            return this.createHTMLChunks(fileId, filePath, content, language, lines);
        }
        const chunks = [];
        // Don't chunk small files
        if (lines.length <= this.chunkSize) {
            chunks.push(this.createChunk(fileId, filePath, {
                chunkIndex: 0,
                startLine: 1,
                endLine: lines.length,
                startChar: 0,
                endChar: content.length,
                content,
                language,
                chunkType: 'code'
            }));
            return chunks;
        }
        // Create overlapping chunks
        let chunkIndex = 0;
        let currentLine = 0;
        while (currentLine < lines.length) {
            const startLine = currentLine;
            const endLine = Math.min(currentLine + this.chunkSize, lines.length);
            const chunkLines = lines.slice(startLine, endLine);
            const chunkContent = chunkLines.join('\n');
            // Calculate character positions
            const startChar = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
            const endChar = startChar + chunkContent.length;
            // Get context
            const contextBefore = startLine > 0
                ? lines.slice(Math.max(0, startLine - 3), startLine).join('\n')
                : undefined;
            const contextAfter = endLine < lines.length
                ? lines.slice(endLine, Math.min(lines.length, endLine + 3)).join('\n')
                : undefined;
            // Determine chunk type
            const chunkType = this.determineChunkType(chunkContent, language);
            chunks.push(this.createChunk(fileId, filePath, {
                chunkIndex,
                startLine: startLine + 1,
                endLine,
                startChar,
                endChar,
                content: chunkContent,
                language,
                chunkType,
                contextBefore,
                contextAfter
            }));
            chunkIndex++;
            currentLine += this.chunkSize - this.chunkOverlap;
        }
        return chunks;
    }
    /**
     * determineChunkType - determines the type of a code chunk
     */
    determineChunkType(content, language) {
        const lines = content.split('\n');
        let codeLines = 0;
        let commentLines = 0;
        let importLines = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '')
                continue;
            if (this.isComment(trimmed, language)) {
                commentLines++;
            }
            else if (this.isImport(trimmed, language)) {
                importLines++;
            }
            else {
                codeLines++;
            }
        }
        const total = codeLines + commentLines + importLines;
        if (total === 0)
            return 'code';
        if (importLines / total > 0.7)
            return 'import';
        if (commentLines / total > 0.7)
            return 'comment';
        if (codeLines / total > 0.7)
            return 'code';
        return 'mixed';
    }
    // ========================================
    // COMPLEXITY CALCULATION
    // ========================================
    /**
     * calculateComplexity - calculates complexity metrics for a file
     */
    calculateComplexity(fileId, filePath, content, language, lines) {
        let linesOfCode = 0;
        let commentLines = 0;
        let blankLines = 0;
        let cyclomaticComplexity = 1; // Base complexity
        let nestingDepth = 0;
        let maxNestingDepth = 0;
        let returnStatements = 0;
        const issues = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '') {
                blankLines++;
                continue;
            }
            if (this.isComment(trimmed, language)) {
                commentLines++;
                continue;
            }
            linesOfCode++;
            // Track nesting depth
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            nestingDepth += openBraces - closeBraces;
            maxNestingDepth = Math.max(maxNestingDepth, nestingDepth);
            // Count decision points for cyclomatic complexity
            cyclomaticComplexity += (line.match(/\b(if|else if|elif|for|while|catch|case|&&|\|\||\?)/g) || []).length;
            // Count return statements
            returnStatements += (line.match(/\breturn\b/g) || []).length;
        }
        // Check for complexity issues
        if (cyclomaticComplexity > 10) {
            issues.push({
                type: 'high_cyclomatic_complexity',
                severity: cyclomaticComplexity > 20 ? 'error' : 'warning',
                message: `High cyclomatic complexity: ${cyclomaticComplexity}`
            });
        }
        if (maxNestingDepth > 4) {
            issues.push({
                type: 'deep_nesting',
                severity: maxNestingDepth > 6 ? 'error' : 'warning',
                message: `Deep nesting detected: ${maxNestingDepth} levels`
            });
        }
        if (linesOfCode > 300) {
            issues.push({
                type: 'long_file',
                severity: linesOfCode > 500 ? 'error' : 'warning',
                message: `File is too long: ${linesOfCode} lines`
            });
        }
        // Calculate maintainability index (simplified version)
        // MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)
        const halsteadVolume = Math.max(1, linesOfCode * 10); // Simplified
        const maintainabilityIndex = Math.max(0, Math.min(100, 171 - 5.2 * Math.log(halsteadVolume) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(Math.max(1, linesOfCode))));
        return {
            id: uuidv4(),
            fileId,
            filePath,
            scopeType: 'file',
            linesOfCode,
            logicalLines: linesOfCode,
            commentLines,
            blankLines,
            cyclomaticComplexity,
            cognitiveComplexity: cyclomaticComplexity, // Simplified
            halsteadVolume,
            maintainabilityIndex,
            returnStatementCount: returnStatements,
            nestingDepth: maxNestingDepth,
            issuesCount: issues.length,
            issues,
            duplicateBlocks: 0,
            duplicateLines: 0,
            language,
            metadata: {},
            analyzedAt: new Date(),
            analyzerVersion: this.analyzerVersion
        };
    }
    // ========================================
    // HELPER METHODS
    // ========================================
    // ========================================
    // JAVA/KOTLIN/SCALA ANALYSIS
    // ========================================
    extractJavaDefinitions(fileId, filePath, lines, language, definitions) {
        const patterns = {
            // Classes, abstract classes
            class: /^(?:\s*)(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w.<>]+))?(?:\s+implements\s+([^{]+))?/,
            // Interfaces
            interface: /^(?:\s*)(?:(?:public|private|protected|static)\s+)*interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([^{]+))?/,
            // Enums
            enum: /^(?:\s*)(?:(?:public|private|protected|static)\s+)*enum\s+(\w+)(?:\s+implements\s+([^{]+))?/,
            // Annotations
            annotationDef: /^(?:\s*)(?:(?:public|private|protected)\s+)*@interface\s+(\w+)/,
            // Records (Java 14+)
            record: /^(?:\s*)(?:(?:public|private|protected|static|final)\s+)*record\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)/,
            // Methods and constructors
            method: /^(?:\s*)(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp|override)\s+)*(?:(?:<[^>]*>\s+)?)([\w.<>\[\]?]+)\s+(\w+)\s*\(([^)]*)\)/,
            constructor: /^(?:\s*)(?:(?:public|private|protected)\s+)*(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/,
            // Fields, constants, variables
            field: /^(?:\s*)(?:(?:public|private|protected|static|final|volatile|transient)\s+)+([\w.<>\[\]?]+)\s+(\w+)\s*(?:=\s*(.+?))?;/,
            // Static/instance initializer blocks
            staticInit: /^(?:\s*)static\s*\{/,
            // Annotations on next line (track for context)
            annotation: /^(?:\s*)@(\w+)(?:\(([^)]*)\))?/,
            // Kotlin-specific
            kotlinFun: /^(?:\s*)(?:(?:public|private|protected|internal|open|override|suspend|inline|infix|operator|tailrec)\s+)*fun\s+(?:<[^>]*>\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*([\w.<>?]+))?/,
            kotlinVal: /^(?:\s*)(?:(?:public|private|protected|internal|open|override|const|lateinit)\s+)*(?:val|var)\s+(\w+)\s*(?::\s*([\w.<>?]+))?\s*(?:=|$)/,
            kotlinObject: /^(?:\s*)(?:(?:public|private|protected|internal)\s+)*(?:companion\s+)?object\s+(\w+)?/,
            kotlinDataClass: /^(?:\s*)(?:(?:public|private|protected|internal|open|sealed)\s+)*data\s+class\s+(\w+)/,
        };
        const definitionStack = [];
        let braceDepth = 0;
        let lastAnnotations = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            // Pop definitions from stack when scope closes
            for (let b = 0; b < closeBraces; b++) {
                const newDepth = braceDepth - (b + 1);
                while (definitionStack.length > 0 && definitionStack[definitionStack.length - 1].braceDepthAtStart >= newDepth) {
                    definitionStack.pop();
                }
            }
            braceDepth += openBraces - closeBraces;
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed === '') {
                continue;
            }
            const getCurrentParent = () => definitionStack.length > 0 ? definitionStack[definitionStack.length - 1].def : null;
            const getQualifiedName = (name) => {
                const parent = getCurrentParent();
                if (!parent) return undefined;
                return parent.qualifiedName ? `${parent.qualifiedName}.${name}` : `${parent.name}.${name}`;
            };
            const getVisibility = (line) => {
                if (line.includes('private')) return 'private';
                if (line.includes('protected')) return 'protected';
                if (line.includes('internal')) return 'internal';
                return 'public';
            };
            // Track annotations
            let match = line.match(patterns.annotation);
            if (match && !line.match(patterns.annotationDef)) {
                lastAnnotations.push(match[1]);
                continue;
            }
            const decorators = [...lastAnnotations];
            lastAnnotations = [];
            // Annotation definition (@interface)
            match = line.match(patterns.annotationDef);
            if (match) {
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'annotation',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isExported: line.includes('public'),
                    parentDefinitionId: getCurrentParent()?.id,
                    signature: trimmed,
                    decorators
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Enum
            match = line.match(patterns.enum);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'enum',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isExported: line.includes('public'),
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Record (Java 14+)
            match = line.match(patterns.record);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'record',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isExported: line.includes('public'),
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Interface
            match = line.match(patterns.interface);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'interface',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isExported: line.includes('public'),
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Kotlin data class
            match = line.match(patterns.kotlinDataClass);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'class',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators,
                    metadata: { isDataClass: true }
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Class
            match = line.match(patterns.class);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'class',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isExported: line.includes('public'),
                    isAbstract: line.includes('abstract'),
                    isStatic: line.includes('static'),
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Kotlin object/companion
            match = line.match(patterns.kotlinObject);
            if (match) {
                const name = match[1] || 'Companion';
                const def = this.createDefinition(fileId, filePath, {
                    name,
                    qualifiedName: getQualifiedName(name),
                    definitionType: 'class',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isStatic: true,
                    parentDefinitionId: getCurrentParent()?.id,
                    signature: trimmed,
                    metadata: { isObject: true, isCompanion: line.includes('companion') }
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Kotlin fun
            match = line.match(patterns.kotlinFun);
            if (match) {
                const parent = getCurrentParent();
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: parent?.definitionType === 'class' || parent?.definitionType === 'interface' ? 'method' : 'function',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isAsync: line.includes('suspend'),
                    returnType: match[3],
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators
                }));
                continue;
            }
            // Kotlin val/var
            match = line.match(patterns.kotlinVal);
            if (match) {
                const parent = getCurrentParent();
                const isConst = line.includes('const') || (line.includes('val') && braceDepth <= 1);
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: isConst ? 'constant' : 'variable',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    parentDefinitionId: parent?.id,
                    signature: trimmed,
                    decorators
                }));
                continue;
            }
            // Static initializer
            if (patterns.staticInit.test(line)) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: 'static_init',
                    qualifiedName: getQualifiedName('static_init'),
                    definitionType: 'function',
                    startLine: i + 1,
                    language,
                    isStatic: true,
                    parentDefinitionId: getCurrentParent()?.id,
                    signature: trimmed
                }));
                continue;
            }
            // Constructor — must match BEFORE method since constructors look like methods
            const parent = getCurrentParent();
            if (parent && parent.definitionType === 'class') {
                match = line.match(patterns.constructor);
                if (match && match[1] === parent.name) {
                    definitions.push(this.createDefinition(fileId, filePath, {
                        name: match[1],
                        qualifiedName: getQualifiedName(match[1]),
                        definitionType: 'constructor',
                        startLine: i + 1,
                        language,
                        visibility: getVisibility(line),
                        parentDefinitionId: parent.id,
                        signature: trimmed,
                        decorators
                    }));
                    continue;
                }
            }
            // Method
            match = line.match(patterns.method);
            if (match) {
                const returnType = match[1];
                const methodName = match[2];
                // Skip control flow keywords that look like methods
                if (['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw'].includes(methodName)) continue;
                const parentDef = getCurrentParent();
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: methodName,
                    qualifiedName: getQualifiedName(methodName),
                    definitionType: parentDef?.definitionType === 'class' || parentDef?.definitionType === 'interface' || parentDef?.definitionType === 'enum' ? 'method' : 'function',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isStatic: line.includes('static'),
                    isAbstract: line.includes('abstract'),
                    isAsync: line.includes('synchronized'),
                    returnType,
                    parentDefinitionId: parentDef?.id,
                    signature: trimmed,
                    decorators
                }));
                continue;
            }
            // Field / constant
            match = line.match(patterns.field);
            if (match) {
                const fieldType = match[1];
                const fieldName = match[2];
                // Skip if it's a keyword
                if (['return', 'throw', 'new', 'if', 'for', 'while'].includes(fieldName)) continue;
                const isFinal = line.includes('final');
                const isStatic = line.includes('static');
                const parentDef = getCurrentParent();
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: fieldName,
                    qualifiedName: getQualifiedName(fieldName),
                    definitionType: (isFinal && isStatic) ? 'constant' : 'variable',
                    startLine: i + 1,
                    language,
                    visibility: getVisibility(line),
                    isStatic,
                    parentDefinitionId: parentDef?.id,
                    signature: trimmed,
                    decorators,
                    metadata: { type: fieldType, isFinal }
                }));
            }
        }
    }
    extractJavaDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            // import com.foo.Bar;
            import: /^import\s+(?:static\s+)?([\w.]+(?:\.\*)?);/,
            // package com.foo.bar;
            package: /^package\s+([\w.]+);/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Package declaration
            let match = trimmed.match(patterns.package);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'package',
                    importStatement: trimmed,
                    lineNumber: i + 1,
                    language,
                    isExternal: false
                }));
                continue;
            }
            // Import
            match = trimmed.match(patterns.import);
            if (match) {
                const target = match[1];
                const isStatic = trimmed.includes('static');
                const isWildcard = target.endsWith('.*');
                const parts = target.split('.');
                const importedName = isWildcard ? '*' : parts[parts.length - 1];
                const packagePath = isWildcard ? target.slice(0, -2) : parts.slice(0, -1).join('.');
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: target,
                    importType: isStatic ? 'import_static' : 'import',
                    importStatement: trimmed,
                    importedNames: [importedName],
                    isNamespaceImport: isWildcard,
                    lineNumber: i + 1,
                    language,
                    isExternal: !target.startsWith('java.') && !target.startsWith('javax.'),
                    isBuiltin: target.startsWith('java.') || target.startsWith('javax.'),
                    packageName: packagePath
                }));
            }
        }
    }
    // ========================================
    // C/C++ ANALYSIS
    // ========================================
    extractCppDefinitions(fileId, filePath, lines, language, definitions) {
        const patterns = {
            // Functions: return_type name(params)
            function: /^(?:(?:static|inline|virtual|explicit|constexpr|consteval|extern|friend|template\s*<[^>]*>\s*)\s+)*(?:const\s+)?(?:unsigned\s+|signed\s+|long\s+|short\s+)*([\w:*&<>[\]]+(?:\s*[*&]+)?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const|override|noexcept|final|=\s*0|=\s*default|=\s*delete)?\s*[{;]/,
            // Methods with class:: prefix
            methodImpl: /^(?:(?:const\s+)?(?:unsigned\s+|signed\s+)*)?([\w:*&<>[\]]+(?:\s*[*&]+)?)\s+(\w+)::(\w+)\s*\(([^)]*)\)/,
            // Class/struct
            class: /^(?:(?:template\s*<[^>]*>\s*)?)?(?:class|struct)\s+(?:__attribute__\s*\([^)]*\)\s+)?(\w+)(?:\s*:\s*(?:public|private|protected)\s+([\w:<>]+(?:\s*,\s*(?:public|private|protected)\s+[\w:<>]+)*))?/,
            // Enum
            enum: /^(?:typedef\s+)?enum\s+(?:class\s+)?(\w+)?(?:\s*:\s*\w+)?\s*\{/,
            // Typedef
            typedef: /^typedef\s+(?:(?:struct|union|enum)\s+(?:\w+\s+)?)?([\w\s*&<>]+)\s+(\w+)\s*;/,
            // Using (C++ type alias)
            using: /^using\s+(\w+)\s*=\s*(.+);/,
            // Namespace
            namespace: /^namespace\s+(\w+)/,
            // Union
            union: /^(?:typedef\s+)?union\s+(\w+)/,
            // Macro definitions
            define: /^#define\s+(\w+)(?:\(([^)]*)\))?\s*(.*)/,
            // Global/static variables and constants
            globalVar: /^(?:(?:static|extern|const|constexpr|volatile|thread_local|inline)\s+)+(?:const\s+)?(?:unsigned\s+|signed\s+|long\s+|short\s+)*([\w:*&<>[\]]+(?:\s*[*&]+)?)\s+(\w+)\s*(?:=\s*(.+?))?;/,
            // Constructor/destructor in class body
            ctorDtor: /^\s+(?:(?:explicit|virtual|inline)\s+)*~?(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]*)?[{;]/,
            // Operator overload
            operator: /(?:[\w*&<>]+)\s+operator\s*([^\s(]+)\s*\(([^)]*)\)/,
        };
        const definitionStack = [];
        let braceDepth = 0;
        let inMultiLineComment = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Handle multi-line comments
            if (inMultiLineComment) {
                if (trimmed.includes('*/')) inMultiLineComment = false;
                continue;
            }
            if (trimmed.startsWith('/*')) {
                if (!trimmed.includes('*/')) inMultiLineComment = true;
                continue;
            }
            if (trimmed.startsWith('//') || trimmed === '') continue;
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            for (let b = 0; b < closeBraces; b++) {
                const newDepth = braceDepth - (b + 1);
                while (definitionStack.length > 0 && definitionStack[definitionStack.length - 1].braceDepthAtStart >= newDepth) {
                    definitionStack.pop();
                }
            }
            braceDepth += openBraces - closeBraces;
            const getCurrentParent = () => definitionStack.length > 0 ? definitionStack[definitionStack.length - 1].def : null;
            const getQualifiedName = (name) => {
                const parent = getCurrentParent();
                if (!parent) return undefined;
                return parent.qualifiedName ? `${parent.qualifiedName}::${name}` : `${parent.name}::${name}`;
            };
            const getVisibility = (line) => {
                if (/^\s*private\s*:/.test(line)) return 'private';
                if (/^\s*protected\s*:/.test(line)) return 'protected';
                if (/^\s*public\s*:/.test(line)) return 'public';
                return 'public';
            };
            // Macro (#define)
            let match = line.match(patterns.define);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: match[2] !== undefined ? 'macro' : 'constant',
                    startLine: i + 1,
                    language,
                    signature: trimmed,
                    metadata: match[2] !== undefined ? { params: match[2] } : {}
                }));
                continue;
            }
            // Namespace
            match = line.match(patterns.namespace);
            if (match) {
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    definitionType: 'namespace',
                    startLine: i + 1,
                    language,
                    signature: trimmed
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Enum
            match = line.match(patterns.enum);
            if (match) {
                const name = match[1] || `anon_enum_L${i + 1}`;
                const def = this.createDefinition(fileId, filePath, {
                    name,
                    qualifiedName: getQualifiedName(name),
                    definitionType: 'enum',
                    startLine: i + 1,
                    language,
                    parentDefinitionId: getCurrentParent()?.id,
                    signature: trimmed
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Union
            match = line.match(patterns.union);
            if (match) {
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'struct',
                    startLine: i + 1,
                    language,
                    parentDefinitionId: getCurrentParent()?.id,
                    signature: trimmed,
                    metadata: { isUnion: true }
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Class/struct
            match = line.match(patterns.class);
            if (match) {
                const parent = getCurrentParent();
                const def = this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: trimmed.startsWith('struct') || trimmed.match(/^template.*struct/) ? 'struct' : 'class',
                    startLine: i + 1,
                    language,
                    isAbstract: false,
                    parentDefinitionId: parent?.id,
                    signature: trimmed
                });
                definitions.push(def);
                if (line.includes('{')) definitionStack.push({ def, braceDepthAtStart: braceDepth - openBraces });
                continue;
            }
            // Typedef
            match = line.match(patterns.typedef);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[2],
                    definitionType: 'type',
                    startLine: i + 1,
                    language,
                    signature: trimmed,
                    metadata: { aliasOf: match[1].trim() }
                }));
                continue;
            }
            // Using alias
            match = line.match(patterns.using);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[1],
                    qualifiedName: getQualifiedName(match[1]),
                    definitionType: 'type',
                    startLine: i + 1,
                    language,
                    parentDefinitionId: getCurrentParent()?.id,
                    signature: trimmed,
                    metadata: { aliasOf: match[2].trim() }
                }));
                continue;
            }
            // Operator overload
            match = line.match(patterns.operator);
            if (match) {
                const parent = getCurrentParent();
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: `operator${match[1]}`,
                    qualifiedName: getQualifiedName(`operator${match[1]}`),
                    definitionType: 'method',
                    startLine: i + 1,
                    language,
                    parentDefinitionId: parent?.id,
                    signature: trimmed
                }));
                continue;
            }
            // Method implementation (ClassName::method)
            match = line.match(patterns.methodImpl);
            if (match) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: match[3],
                    qualifiedName: `${match[2]}::${match[3]}`,
                    definitionType: match[3] === match[2] ? 'constructor' : (match[3] === `~${match[2]}` ? 'destructor' : 'method'),
                    startLine: i + 1,
                    language,
                    returnType: match[1]?.trim(),
                    signature: trimmed
                }));
                continue;
            }
            // Constructor/destructor inside class body
            const parentDef = getCurrentParent();
            if (parentDef && (parentDef.definitionType === 'class' || parentDef.definitionType === 'struct')) {
                match = line.match(patterns.ctorDtor);
                if (match) {
                    const ctorName = match[1];
                    if (ctorName === parentDef.name || ctorName === `~${parentDef.name}` || `~${ctorName}` === trimmed.match(/~(\w+)/)?.[0]) {
                        const isDtor = trimmed.includes('~');
                        definitions.push(this.createDefinition(fileId, filePath, {
                            name: isDtor ? `~${parentDef.name}` : parentDef.name,
                            qualifiedName: getQualifiedName(isDtor ? `~${parentDef.name}` : parentDef.name),
                            definitionType: isDtor ? 'destructor' : 'constructor',
                            startLine: i + 1,
                            language,
                            parentDefinitionId: parentDef.id,
                            signature: trimmed
                        }));
                        continue;
                    }
                }
            }
            // Function (top-level or in namespace) / method (in class)
            match = line.match(patterns.function);
            if (match) {
                const returnType = match[1];
                const funcName = match[2];
                if (['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'sizeof', 'alignof', 'decltype', 'static_cast', 'dynamic_cast', 'const_cast', 'reinterpret_cast'].includes(funcName)) continue;
                const parentDef2 = getCurrentParent();
                const isMethod = parentDef2?.definitionType === 'class' || parentDef2?.definitionType === 'struct';
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: funcName,
                    qualifiedName: getQualifiedName(funcName),
                    definitionType: isMethod ? 'method' : 'function',
                    startLine: i + 1,
                    language,
                    isStatic: line.includes('static'),
                    isExported: !line.includes('static') && braceDepth === 0,
                    returnType: returnType?.trim(),
                    parentDefinitionId: parentDef2?.id,
                    signature: trimmed,
                    metadata: {
                        isVirtual: line.includes('virtual'),
                        isConstexpr: line.includes('constexpr'),
                        isInline: line.includes('inline'),
                        isConst: /\)\s*const/.test(line)
                    }
                }));
                continue;
            }
            // Global/static variables and constants
            if (braceDepth <= 1) {
                match = line.match(patterns.globalVar);
                if (match) {
                    const varName = match[2];
                    if (['if', 'for', 'while', 'switch', 'return'].includes(varName)) continue;
                    const isConst = line.includes('const') || line.includes('constexpr');
                    definitions.push(this.createDefinition(fileId, filePath, {
                        name: varName,
                        qualifiedName: getQualifiedName(varName),
                        definitionType: isConst ? 'constant' : 'variable',
                        startLine: i + 1,
                        language,
                        isStatic: line.includes('static'),
                        isExported: line.includes('extern'),
                        parentDefinitionId: getCurrentParent()?.id,
                        signature: trimmed,
                        metadata: { type: match[1].trim() }
                    }));
                }
            }
        }
    }
    extractCppDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            // #include <header> or #include "header"
            includeAngle: /^#include\s+<([^>]+)>/,
            includeQuote: /^#include\s+"([^"]+)"/,
            // using namespace foo;
            usingNamespace: /^using\s+namespace\s+([\w:]+);/,
            // using foo::bar;
            usingDecl: /^using\s+([\w:]+);/
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Angle bracket include (system/external)
            let match = trimmed.match(patterns.includeAngle);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'include',
                    importStatement: trimmed,
                    lineNumber: i + 1,
                    language,
                    isExternal: true,
                    isBuiltin: ['stdio.h', 'stdlib.h', 'string.h', 'math.h', 'iostream', 'vector', 'string', 'map', 'set', 'unordered_map', 'unordered_set', 'algorithm', 'memory', 'functional', 'utility', 'cassert', 'cstdio', 'cstdlib', 'cstring', 'cmath', 'thread', 'mutex', 'atomic', 'chrono', 'filesystem', 'fstream', 'sstream', 'iomanip', 'numeric', 'array', 'deque', 'list', 'queue', 'stack', 'tuple', 'variant', 'optional', 'any', 'type_traits', 'concepts', 'ranges', 'span', 'format'].includes(match[1])
                }));
                continue;
            }
            // Quote include (local/relative)
            match = trimmed.match(patterns.includeQuote);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'include',
                    importStatement: trimmed,
                    lineNumber: i + 1,
                    language,
                    isRelative: true,
                    isExternal: false
                }));
                continue;
            }
            // using namespace
            match = trimmed.match(patterns.usingNamespace);
            if (match) {
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'using_namespace',
                    importStatement: trimmed,
                    isNamespaceImport: true,
                    lineNumber: i + 1,
                    language,
                    isBuiltin: match[1] === 'std' || match[1].startsWith('std::')
                }));
                continue;
            }
            // using declaration
            match = trimmed.match(patterns.usingDecl);
            if (match) {
                const parts = match[1].split('::');
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: match[1],
                    importType: 'using',
                    importStatement: trimmed,
                    importedNames: [parts[parts.length - 1]],
                    lineNumber: i + 1,
                    language,
                    isBuiltin: match[1].startsWith('std::')
                }));
            }
        }
    }
    // ========================================
    // HTML ANALYSIS
    // ========================================
    extractHTMLDefinitions(fileId, filePath, lines, language, definitions) {
        const patterns = {
            idAttr: /\bid=["']([^"']+)["']/i,
            classAttr: /\bclass=["']([^"']+)["']/i,
            scriptOpen: /<script\b[^>]*>/i,
            scriptClose: /<\/script>/i,
            styleOpen: /<style\b[^>]*>/i,
            styleClose: /<\/style>/i,
            formTag: /<form\b[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/i,
            templateTag: /<template\b[^>]*(?:id)=["']([^"']+)["'][^>]*>/i,
            sectionTags: /<(header|footer|nav|main|section|article|aside)\b[^>]*(?:id=["']([^"']+)["'])?[^>]*>/i,
            dataAttr: /\bdata-([\w-]+)=["']([^"']+)["']/i,
            componentTags: /<(slot|component)\b[^>]*(?:(?:name|id)=["']([^"']+)["'])?[^>]*>/i,
        };
        let inScript = false;
        let scriptStart = -1;
        let inStyle = false;
        let styleStart = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Track script blocks
            if (!inScript && patterns.scriptOpen.test(line) && !line.includes(' src=')) {
                inScript = true;
                scriptStart = i;
            }
            if (inScript && patterns.scriptClose.test(line)) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: `script_block_L${scriptStart + 1}`,
                    definitionType: 'script',
                    startLine: scriptStart + 1,
                    endLine: i + 1,
                    language,
                    signature: lines[scriptStart].trim()
                }));
                inScript = false;
            }
            // Track style blocks
            if (!inStyle && patterns.styleOpen.test(line)) {
                inStyle = true;
                styleStart = i;
            }
            if (inStyle && patterns.styleClose.test(line)) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: `style_block_L${styleStart + 1}`,
                    definitionType: 'style',
                    startLine: styleStart + 1,
                    endLine: i + 1,
                    language,
                    signature: lines[styleStart].trim()
                }));
                inStyle = false;
            }
            // ID attributes
            const idMatch = line.match(patterns.idAttr);
            if (idMatch) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: idMatch[1],
                    definitionType: 'element',
                    startLine: i + 1,
                    language,
                    signature: line.trim()
                }));
            }
            // Class attributes
            const classMatch = line.match(patterns.classAttr);
            if (classMatch) {
                const classes = classMatch[1].split(/\s+/).filter(Boolean);
                for (const cls of classes) {
                    definitions.push(this.createDefinition(fileId, filePath, {
                        name: cls,
                        definitionType: 'class',
                        startLine: i + 1,
                        language,
                        signature: line.trim()
                    }));
                }
            }
            // Form tags
            const formMatch = line.match(patterns.formTag);
            if (formMatch) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: formMatch[1],
                    definitionType: 'form',
                    startLine: i + 1,
                    language,
                    signature: line.trim()
                }));
            }
            // Template tags
            const templateMatch = line.match(patterns.templateTag);
            if (templateMatch) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: templateMatch[1],
                    definitionType: 'component',
                    startLine: i + 1,
                    language,
                    signature: line.trim()
                }));
            }
            // Section tags with IDs
            const sectionMatch = line.match(patterns.sectionTags);
            if (sectionMatch && sectionMatch[2]) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: sectionMatch[2],
                    qualifiedName: `${sectionMatch[1]}#${sectionMatch[2]}`,
                    definitionType: 'element',
                    startLine: i + 1,
                    language,
                    signature: line.trim()
                }));
            }
            // Component/slot tags
            const componentMatch = line.match(patterns.componentTags);
            if (componentMatch) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: componentMatch[2] || `${componentMatch[1]}_L${i + 1}`,
                    definitionType: 'component',
                    startLine: i + 1,
                    language,
                    signature: line.trim()
                }));
            }
            // Data attributes on key elements
            const dataMatch = line.match(patterns.dataAttr);
            if (dataMatch) {
                definitions.push(this.createDefinition(fileId, filePath, {
                    name: `data-${dataMatch[1]}`,
                    definitionType: 'attribute',
                    startLine: i + 1,
                    language,
                    signature: line.trim(),
                    metadata: { value: dataMatch[2] }
                }));
            }
        }
    }
    extractHTMLDependencies(fileId, filePath, lines, language, dependencies) {
        const patterns = {
            scriptSrc: /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
            linkStylesheet: /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i,
            linkImport: /<link\b[^>]*\brel=["'](?:import|modulepreload)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i,
            imgSrc: /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
            sourceSrc: /<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
            iframeSrc: /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
            linkHref: /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i,
        };
        let inModuleScript = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Script src
            const scriptMatch = line.match(patterns.scriptSrc);
            if (scriptMatch) {
                const src = scriptMatch[1];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: src,
                    importType: 'script_src',
                    importStatement: line.trim(),
                    lineNumber: i + 1,
                    isExternal: src.startsWith('http') || src.startsWith('//'),
                    isRelative: src.startsWith('.') || (!src.startsWith('/') && !src.startsWith('http') && !src.startsWith('//')),
                    language
                }));
            }
            // Stylesheets
            const styleMatch = line.match(patterns.linkStylesheet);
            if (styleMatch) {
                const href = styleMatch[1];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: href,
                    importType: 'stylesheet',
                    importStatement: line.trim(),
                    lineNumber: i + 1,
                    isExternal: href.startsWith('http') || href.startsWith('//'),
                    isRelative: href.startsWith('.') || (!href.startsWith('/') && !href.startsWith('http') && !href.startsWith('//')),
                    language
                }));
            }
            // Link imports/modulepreload
            const importMatch = line.match(patterns.linkImport);
            if (importMatch) {
                const href = importMatch[1];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: href,
                    importType: 'import',
                    importStatement: line.trim(),
                    lineNumber: i + 1,
                    isExternal: href.startsWith('http') || href.startsWith('//'),
                    isRelative: href.startsWith('.'),
                    language
                }));
            }
            // Images
            const imgMatch = line.match(patterns.imgSrc);
            if (imgMatch) {
                const src = imgMatch[1];
                if (!src.startsWith('data:')) {
                    dependencies.push(this.createDependency(fileId, filePath, {
                        targetPath: src,
                        importType: 'asset',
                        importStatement: line.trim(),
                        lineNumber: i + 1,
                        isExternal: src.startsWith('http') || src.startsWith('//'),
                        isRelative: src.startsWith('.') || (!src.startsWith('/') && !src.startsWith('http') && !src.startsWith('//')),
                        language
                    }));
                }
            }
            // Source elements
            const sourceMatch = line.match(patterns.sourceSrc);
            if (sourceMatch) {
                const src = sourceMatch[1];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: src,
                    importType: 'asset',
                    importStatement: line.trim(),
                    lineNumber: i + 1,
                    isExternal: src.startsWith('http') || src.startsWith('//'),
                    language
                }));
            }
            // Iframes
            const iframeMatch = line.match(patterns.iframeSrc);
            if (iframeMatch) {
                const src = iframeMatch[1];
                dependencies.push(this.createDependency(fileId, filePath, {
                    targetPath: src,
                    importType: 'iframe',
                    importStatement: line.trim(),
                    lineNumber: i + 1,
                    isExternal: src.startsWith('http') || src.startsWith('//'),
                    language
                }));
            }
            // Track module script blocks for inline imports
            if (/<script\b[^>]*type=["']module["'][^>]*>/i.test(line) && !line.includes(' src=')) {
                inModuleScript = true;
            }
            if (inModuleScript && /<\/script>/i.test(line)) {
                inModuleScript = false;
            }
            // Inline ES imports inside module scripts
            if (inModuleScript) {
                const esImport = line.match(/^\s*import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/);
                if (esImport) {
                    const src = esImport[1];
                    dependencies.push(this.createDependency(fileId, filePath, {
                        targetPath: src,
                        importType: 'import',
                        importStatement: line.trim(),
                        lineNumber: i + 1,
                        isExternal: src.startsWith('http') || src.startsWith('//'),
                        isRelative: src.startsWith('.'),
                        language
                    }));
                }
            }
        }
    }
    createHTMLChunks(fileId, filePath, content, language, lines) {
        const chunks = [];
        const structuralTags = new Set(['head', 'body', 'section', 'div', 'article', 'nav', 'header', 'footer', 'main', 'aside', 'form', 'table']);
        const openTag = /<(head|body|section|div|article|nav|header|footer|main|aside|form|table)\b[^>]*>/i;
        const scriptOpen = /<script\b[^>]*>/i;
        const scriptClose = /<\/script>/i;
        const styleOpen = /<style\b[^>]*>/i;
        const styleClose = /<\/style>/i;
        let chunkIndex = 0;
        // First pass: extract script and style blocks
        let inScript = false, scriptStart = -1;
        let inStyle = false, styleStart = -1;
        const specialBlocks = []; // {start, end, type}
        for (let i = 0; i < lines.length; i++) {
            if (!inScript && scriptOpen.test(lines[i])) {
                inScript = true;
                scriptStart = i;
            }
            if (inScript && scriptClose.test(lines[i])) {
                specialBlocks.push({ start: scriptStart, end: i, type: 'code' });
                inScript = false;
            }
            if (!inStyle && styleOpen.test(lines[i])) {
                inStyle = true;
                styleStart = i;
            }
            if (inStyle && styleClose.test(lines[i])) {
                specialBlocks.push({ start: styleStart, end: i, type: 'style' });
                inStyle = false;
            }
        }
        // Second pass: structural blocks at depth 1
        let tagDepth = 0;
        let blockStart = -1;
        let blockTag = null;
        const structuralBlocks = [];
        const isInSpecial = (lineNum) => specialBlocks.some(b => lineNum >= b.start && lineNum <= b.end);
        for (let i = 0; i < lines.length; i++) {
            if (isInSpecial(i)) continue;
            const line = lines[i];
            const openMatch = line.match(openTag);
            if (openMatch && tagDepth === 0) {
                blockStart = i;
                blockTag = openMatch[1].toLowerCase();
                tagDepth = 1;
                // Check for self-closing or single-line
                const closeRegex = new RegExp(`</${blockTag}>`, 'i');
                if (closeRegex.test(line)) {
                    structuralBlocks.push({ start: i, end: i, tag: blockTag });
                    tagDepth = 0;
                    blockStart = -1;
                }
                continue;
            }
            if (tagDepth > 0 && blockTag) {
                const innerOpen = new RegExp(`<${blockTag}\\b`, 'gi');
                const innerClose = new RegExp(`</${blockTag}>`, 'gi');
                const opens = (line.match(innerOpen) || []).length;
                const closes = (line.match(innerClose) || []).length;
                tagDepth += opens - closes;
                if (tagDepth <= 0) {
                    structuralBlocks.push({ start: blockStart, end: i, tag: blockTag });
                    tagDepth = 0;
                    blockStart = -1;
                    blockTag = null;
                }
            }
        }
        // Create chunks from special blocks
        for (const block of specialBlocks) {
            const blockLines = lines.slice(block.start, block.end + 1);
            const blockContent = blockLines.join('\n');
            const startChar = lines.slice(0, block.start).join('\n').length + (block.start > 0 ? 1 : 0);
            chunks.push(this.createChunk(fileId, filePath, {
                chunkIndex: chunkIndex++,
                startLine: block.start + 1,
                endLine: block.end + 1,
                startChar,
                endChar: startChar + blockContent.length,
                content: blockContent,
                language,
                chunkType: block.type
            }));
        }
        // Create chunks from structural blocks
        for (const block of structuralBlocks) {
            const blockLines = lines.slice(block.start, block.end + 1);
            const blockContent = blockLines.join('\n');
            const startChar = lines.slice(0, block.start).join('\n').length + (block.start > 0 ? 1 : 0);
            chunks.push(this.createChunk(fileId, filePath, {
                chunkIndex: chunkIndex++,
                startLine: block.start + 1,
                endLine: block.end + 1,
                startChar,
                endChar: startChar + blockContent.length,
                content: blockContent,
                language,
                chunkType: 'structure',
                metadata: { tag: block.tag }
            }));
        }
        // If no chunks created, fall back to default line-based chunking
        if (chunks.length === 0) {
            const fallbackChunks = [];
            if (lines.length <= this.chunkSize) {
                fallbackChunks.push(this.createChunk(fileId, filePath, {
                    chunkIndex: 0,
                    startLine: 1,
                    endLine: lines.length,
                    startChar: 0,
                    endChar: content.length,
                    content,
                    language,
                    chunkType: 'markup'
                }));
            } else {
                let ci = 0;
                let currentLine = 0;
                while (currentLine < lines.length) {
                    const startLine = currentLine;
                    const endLine = Math.min(currentLine + this.chunkSize, lines.length);
                    const chunkLines = lines.slice(startLine, endLine);
                    const chunkContent = chunkLines.join('\n');
                    const startChar = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
                    fallbackChunks.push(this.createChunk(fileId, filePath, {
                        chunkIndex: ci++,
                        startLine: startLine + 1,
                        endLine,
                        startChar,
                        endChar: startChar + chunkContent.length,
                        content: chunkContent,
                        language,
                        chunkType: 'markup'
                    }));
                    currentLine += this.chunkSize - this.chunkOverlap;
                }
            }
            return fallbackChunks;
        }
        // Sort chunks by start line
        chunks.sort((a, b) => a.startLine - b.startLine);
        return chunks;
    }
    createDefinition(fileId, filePath, data) {
        return {
            id: uuidv4(),
            fileId,
            filePath,
            name: data.name || 'unknown',
            qualifiedName: data.qualifiedName,
            definitionType: data.definitionType || 'function',
            startLine: data.startLine || 1,
            endLine: data.endLine || data.startLine || 1,
            startColumn: data.startColumn,
            endColumn: data.endColumn,
            signature: data.signature,
            docstring: data.docstring,
            returnType: data.returnType,
            visibility: data.visibility || 'public',
            isExported: data.isExported || false,
            isAsync: data.isAsync || false,
            isStatic: data.isStatic || false,
            isAbstract: data.isAbstract || false,
            parentDefinitionId: data.parentDefinitionId,
            parameters: data.parameters || [],
            language: data.language || 'unknown',
            decorators: data.decorators || [],
            metadata: data.metadata || {}
        };
    }
    createDependency(fileId, filePath, data) {
        return {
            id: uuidv4(),
            sourceFileId: fileId,
            sourceFilePath: filePath,
            targetPath: data.targetPath || '',
            resolvedPath: data.resolvedPath,
            targetFileId: data.targetFileId,
            importType: data.importType || 'import',
            importStatement: data.importStatement || '',
            importedNames: data.importedNames || [],
            importedAs: data.importedAs || [],
            isDefaultImport: data.isDefaultImport || false,
            isNamespaceImport: data.isNamespaceImport || false,
            isTypeImport: data.isTypeImport || false,
            isSideEffectImport: data.isSideEffectImport || false,
            lineNumber: data.lineNumber || 1,
            columnNumber: data.columnNumber,
            isExternal: data.isExternal || false,
            isBuiltin: data.isBuiltin || false,
            isRelative: data.isRelative || false,
            isAbsolute: data.isAbsolute || false,
            isDynamic: data.isDynamic || false,
            packageName: data.packageName,
            packageVersion: data.packageVersion,
            language: data.language || 'unknown',
            metadata: data.metadata || {}
        };
    }
    createChunk(fileId, filePath, data) {
        return {
            id: uuidv4(),
            fileId,
            filePath,
            chunkIndex: data.chunkIndex || 0,
            startLine: data.startLine || 1,
            endLine: data.endLine || 1,
            startChar: data.startChar || 0,
            endChar: data.endChar || 0,
            content: data.content || '',
            language: data.language || 'unknown',
            chunkType: data.chunkType || 'code',
            contextBefore: data.contextBefore,
            contextAfter: data.contextAfter,
            metadata: data.metadata || {}
        };
    }
    parseParameters(paramString) {
        if (!paramString.trim())
            return [];
        return paramString.split(',').map(p => {
            const trimmed = p.trim();
            const [nameType, defaultValue] = trimmed.split('=').map(s => s.trim());
            const [name, type] = (nameType || '').split(':').map(s => s.trim());
            return {
                name: name || '',
                type: type,
                defaultValue: defaultValue,
                optional: trimmed.includes('?') || defaultValue !== undefined
            };
        }).filter(p => p.name);
    }
    parsePythonParameters(paramString) {
        if (!paramString.trim())
            return [];
        const params = [];
        for (const p of paramString.split(',')) {
            const trimmed = p.trim();
            if (trimmed === 'self' || trimmed === 'cls')
                continue;
            const [nameType, defaultValue] = trimmed.split('=').map(s => s.trim());
            const [name, type] = (nameType || '').split(':').map(s => s.trim());
            if (name) {
                params.push({
                    name,
                    type: type || undefined,
                    defaultValue: defaultValue || undefined,
                    optional: defaultValue !== undefined
                });
            }
        }
        return params;
    }
    detectVisibility(line) {
        if (line.includes('private'))
            return 'private';
        if (line.includes('protected'))
            return 'protected';
        if (line.includes('internal'))
            return 'internal';
        return 'public';
    }
    classifyImport(target) {
        const isRelative = target.startsWith('.') || target.startsWith('/');
        const isAbsolute = target.startsWith('/');
        const isBuiltin = ['fs', 'path', 'os', 'http', 'https', 'crypto', 'util', 'events', 'stream', 'buffer', 'url', 'querystring', 'child_process', 'cluster', 'dgram', 'dns', 'net', 'readline', 'repl', 'tls', 'tty', 'vm', 'zlib'].includes(target.split('/')[0]);
        const isExternal = !isRelative && !isBuiltin;
        const packageName = isExternal ? target.split('/')[0] : undefined;
        return {
            isRelative,
            isAbsolute,
            isBuiltin,
            isExternal,
            packageName: packageName?.startsWith('@') ? `${packageName}/${target.split('/')[1]}` : packageName
        };
    }
    isComment(line, language) {
        switch (language) {
            case 'python':
                return line.startsWith('#');
            case 'typescript':
            case 'typescript-react':
            case 'javascript':
            case 'javascript-react':
            case 'go':
            case 'rust':
            case 'java':
            case 'c':
            case 'cpp':
                return line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');
            default:
                return line.startsWith('//') || line.startsWith('#') || line.startsWith('/*');
        }
    }
    isImport(line, language) {
        switch (language) {
            case 'python':
                return line.startsWith('import ') || line.startsWith('from ');
            case 'typescript':
            case 'typescript-react':
            case 'javascript':
            case 'javascript-react':
                return line.startsWith('import ') || line.includes('require(');
            case 'go':
                return line.startsWith('import ');
            case 'rust':
                return line.startsWith('use ') || line.startsWith('extern crate');
            default:
                return line.startsWith('import ') || line.startsWith('include ');
        }
    }
}
// Per-project analyzer instances - prevents cross-project pollution
const analyzersByProject = new Map();
/**
 * getCodeAnalyzer - returns project-scoped analyzer instance
 * uses Map<projectPath, CodeAnalyzer> pattern for proper isolation
 */
export function getCodeAnalyzer(options, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!analyzersByProject.has(targetProject)) {
        analyzersByProject.set(targetProject, new CodeAnalyzer(options));
    }
    return analyzersByProject.get(targetProject);
}
/**
 * resetCodeAnalyzer - resets the analyzer for a specific project (for testing)
 */
export function resetCodeAnalyzer(projectPath) {
    const targetProject = projectPath || getProjectPath();
    analyzersByProject.delete(targetProject);
}
/**
 * resetAllCodeAnalyzers - resets all project analyzers (for testing)
 */
export function resetAllCodeAnalyzers() {
    analyzersByProject.clear();
}
//# sourceMappingURL=codeAnalyzer.js.map