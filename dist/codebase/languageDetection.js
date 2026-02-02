// yooo this module detects programming languages like a BOSS
// we need this for smart codebase indexing
// file extensions, shebang lines, content heuristics - we got it all
import * as path from 'path';
import { TEXT_LIMITS } from '../constants.js';
/**
 * the BIG language registry - all the langs we recognize
 * ordered roughly by popularity cuz why not
 */
const LANGUAGE_REGISTRY = {
    // tier 1 - the absolute goats
    typescript: {
        id: 'typescript',
        name: 'TypeScript',
        extensions: ['.ts', '.tsx', '.mts', '.cts'],
        aliases: ['ts'],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    javascript: {
        id: 'javascript',
        name: 'JavaScript',
        extensions: ['.js', '.jsx', '.mjs', '.cjs'],
        aliases: ['js', 'node'],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    python: {
        id: 'python',
        name: 'Python',
        extensions: ['.py', '.pyw', '.pyx', '.pxd', '.pyi'],
        aliases: ['py', 'python3'],
        type: 'programming',
        lineCommentStart: '#',
        blockCommentStart: '"""',
        blockCommentEnd: '"""',
        supportsEmbeddings: true
    },
    java: {
        id: 'java',
        name: 'Java',
        extensions: ['.java'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    go: {
        id: 'go',
        name: 'Go',
        extensions: ['.go'],
        aliases: ['golang'],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    rust: {
        id: 'rust',
        name: 'Rust',
        extensions: ['.rs'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    csharp: {
        id: 'csharp',
        name: 'C#',
        extensions: ['.cs', '.csx'],
        aliases: ['c#', 'cs', 'dotnet'],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    cpp: {
        id: 'cpp',
        name: 'C++',
        extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.h++', '.c++'],
        aliases: ['c++', 'cplusplus'],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    c: {
        id: 'c',
        name: 'C',
        extensions: ['.c', '.h'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    ruby: {
        id: 'ruby',
        name: 'Ruby',
        extensions: ['.rb', '.rake', '.gemspec', '.ru'],
        aliases: ['rb'],
        type: 'programming',
        lineCommentStart: '#',
        blockCommentStart: '=begin',
        blockCommentEnd: '=end',
        supportsEmbeddings: true
    },
    php: {
        id: 'php',
        name: 'PHP',
        extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    swift: {
        id: 'swift',
        name: 'Swift',
        extensions: ['.swift'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    kotlin: {
        id: 'kotlin',
        name: 'Kotlin',
        extensions: ['.kt', '.kts'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    scala: {
        id: 'scala',
        name: 'Scala',
        extensions: ['.scala', '.sc'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    // shell scripts
    shell: {
        id: 'shell',
        name: 'Shell',
        extensions: ['.sh', '.bash', '.zsh', '.fish'],
        aliases: ['bash', 'zsh', 'sh'],
        type: 'programming',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    powershell: {
        id: 'powershell',
        name: 'PowerShell',
        extensions: ['.ps1', '.psm1', '.psd1'],
        aliases: ['ps1'],
        type: 'programming',
        lineCommentStart: '#',
        blockCommentStart: '<#',
        blockCommentEnd: '#>',
        supportsEmbeddings: true
    },
    // web languages
    html: {
        id: 'html',
        name: 'HTML',
        extensions: ['.html', '.htm', '.xhtml'],
        aliases: [],
        type: 'markup',
        blockCommentStart: '<!--',
        blockCommentEnd: '-->',
        supportsEmbeddings: true
    },
    css: {
        id: 'css',
        name: 'CSS',
        extensions: ['.css'],
        aliases: [],
        type: 'markup',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    scss: {
        id: 'scss',
        name: 'SCSS',
        extensions: ['.scss'],
        aliases: ['sass'],
        type: 'markup',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    less: {
        id: 'less',
        name: 'Less',
        extensions: ['.less'],
        aliases: [],
        type: 'markup',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    vue: {
        id: 'vue',
        name: 'Vue',
        extensions: ['.vue'],
        aliases: [],
        type: 'markup',
        blockCommentStart: '<!--',
        blockCommentEnd: '-->',
        supportsEmbeddings: true
    },
    svelte: {
        id: 'svelte',
        name: 'Svelte',
        extensions: ['.svelte'],
        aliases: [],
        type: 'markup',
        blockCommentStart: '<!--',
        blockCommentEnd: '-->',
        supportsEmbeddings: true
    },
    // data formats
    json: {
        id: 'json',
        name: 'JSON',
        extensions: ['.json', '.jsonc'],
        aliases: [],
        type: 'data',
        supportsEmbeddings: false // structure not semantic
    },
    yaml: {
        id: 'yaml',
        name: 'YAML',
        extensions: ['.yaml', '.yml'],
        aliases: [],
        type: 'data',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    xml: {
        id: 'xml',
        name: 'XML',
        extensions: ['.xml', '.xsd', '.xsl', '.xslt'],
        aliases: [],
        type: 'data',
        blockCommentStart: '<!--',
        blockCommentEnd: '-->',
        supportsEmbeddings: false
    },
    toml: {
        id: 'toml',
        name: 'TOML',
        extensions: ['.toml'],
        aliases: [],
        type: 'config',
        lineCommentStart: '#',
        supportsEmbeddings: false
    },
    ini: {
        id: 'ini',
        name: 'INI',
        extensions: ['.ini', '.cfg', '.conf'],
        aliases: ['config'],
        type: 'config',
        lineCommentStart: ';',
        supportsEmbeddings: false
    },
    // documentation
    markdown: {
        id: 'markdown',
        name: 'Markdown',
        extensions: ['.md', '.markdown', '.mdx'],
        aliases: ['md'],
        type: 'prose',
        supportsEmbeddings: true // documentation is valuable!
    },
    restructuredtext: {
        id: 'restructuredtext',
        name: 'reStructuredText',
        extensions: ['.rst'],
        aliases: ['rst'],
        type: 'prose',
        supportsEmbeddings: true
    },
    asciidoc: {
        id: 'asciidoc',
        name: 'AsciiDoc',
        extensions: ['.adoc', '.asciidoc'],
        aliases: [],
        type: 'prose',
        supportsEmbeddings: true
    },
    // database / query languages
    sql: {
        id: 'sql',
        name: 'SQL',
        extensions: ['.sql'],
        aliases: ['mysql', 'postgresql', 'sqlite'],
        type: 'programming',
        lineCommentStart: '--',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    graphql: {
        id: 'graphql',
        name: 'GraphQL',
        extensions: ['.graphql', '.gql'],
        aliases: ['gql'],
        type: 'programming',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    // infrastructure / devops
    dockerfile: {
        id: 'dockerfile',
        name: 'Dockerfile',
        extensions: [], // detected by filename
        aliases: ['docker'],
        type: 'config',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    terraform: {
        id: 'terraform',
        name: 'Terraform',
        extensions: ['.tf', '.tfvars'],
        aliases: ['tf', 'hcl'],
        type: 'config',
        lineCommentStart: '#',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    kubernetes: {
        id: 'kubernetes',
        name: 'Kubernetes',
        extensions: [], // usually .yaml
        aliases: ['k8s'],
        type: 'config',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    // other programming languages
    r: {
        id: 'r',
        name: 'R',
        extensions: ['.r', '.R', '.Rmd'],
        aliases: ['rlang'],
        type: 'programming',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    julia: {
        id: 'julia',
        name: 'Julia',
        extensions: ['.jl'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '#',
        blockCommentStart: '#=',
        blockCommentEnd: '=#',
        supportsEmbeddings: true
    },
    elixir: {
        id: 'elixir',
        name: 'Elixir',
        extensions: ['.ex', '.exs'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    erlang: {
        id: 'erlang',
        name: 'Erlang',
        extensions: ['.erl', '.hrl'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '%',
        supportsEmbeddings: true
    },
    haskell: {
        id: 'haskell',
        name: 'Haskell',
        extensions: ['.hs', '.lhs'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '--',
        blockCommentStart: '{-',
        blockCommentEnd: '-}',
        supportsEmbeddings: true
    },
    clojure: {
        id: 'clojure',
        name: 'Clojure',
        extensions: ['.clj', '.cljs', '.cljc', '.edn'],
        aliases: [],
        type: 'programming',
        lineCommentStart: ';',
        supportsEmbeddings: true
    },
    lua: {
        id: 'lua',
        name: 'Lua',
        extensions: ['.lua'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '--',
        blockCommentStart: '--[[',
        blockCommentEnd: ']]',
        supportsEmbeddings: true
    },
    perl: {
        id: 'perl',
        name: 'Perl',
        extensions: ['.pl', '.pm', '.pod'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '#',
        blockCommentStart: '=pod',
        blockCommentEnd: '=cut',
        supportsEmbeddings: true
    },
    dart: {
        id: 'dart',
        name: 'Dart',
        extensions: ['.dart'],
        aliases: [],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    objectivec: {
        id: 'objectivec',
        name: 'Objective-C',
        extensions: ['.m', '.mm'],
        aliases: ['objc'],
        type: 'programming',
        lineCommentStart: '//',
        blockCommentStart: '/*',
        blockCommentEnd: '*/',
        supportsEmbeddings: true
    },
    // config files
    makefile: {
        id: 'makefile',
        name: 'Makefile',
        extensions: [], // detected by filename
        aliases: ['make'],
        type: 'config',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    cmake: {
        id: 'cmake',
        name: 'CMake',
        extensions: ['.cmake'],
        aliases: [],
        type: 'config',
        lineCommentStart: '#',
        supportsEmbeddings: true
    },
    gradle: {
        id: 'gradle',
        name: 'Gradle',
        extensions: ['.gradle'],
        aliases: [],
        type: 'config',
        lineCommentStart: '//',
        supportsEmbeddings: true
    },
    maven: {
        id: 'maven',
        name: 'Maven POM',
        extensions: [], // detected by filename
        aliases: ['pom'],
        type: 'config',
        blockCommentStart: '<!--',
        blockCommentEnd: '-->',
        supportsEmbeddings: false
    },
    // plain text fallback
    text: {
        id: 'text',
        name: 'Plain Text',
        extensions: ['.txt', '.text'],
        aliases: ['plaintext'],
        type: 'prose',
        supportsEmbeddings: true
    },
    // unknown fallback
    unknown: {
        id: 'unknown',
        name: 'Unknown',
        extensions: [],
        aliases: [],
        type: 'data',
        supportsEmbeddings: false
    }
};
// filename -> language mapping for special files
const FILENAME_MAPPINGS = {
    'Dockerfile': 'dockerfile',
    'dockerfile': 'dockerfile',
    'Makefile': 'makefile',
    'makefile': 'makefile',
    'GNUmakefile': 'makefile',
    'CMakeLists.txt': 'cmake',
    'pom.xml': 'maven',
    '.gitignore': 'text',
    '.gitattributes': 'text',
    '.editorconfig': 'ini',
    '.npmrc': 'ini',
    '.nvmrc': 'text',
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    '.babelrc': 'json',
    'tsconfig.json': 'json',
    'package.json': 'json',
    'composer.json': 'json',
    'Cargo.toml': 'toml',
    'Pipfile': 'toml',
    'pyproject.toml': 'toml',
    'Gemfile': 'ruby',
    'Rakefile': 'ruby',
    'Vagrantfile': 'ruby',
    'Procfile': 'yaml',
    '.dockerignore': 'text',
    '.specmemignore': 'text'
};
// shebang -> language mapping
const SHEBANG_MAPPINGS = {
    'node': 'javascript',
    'nodejs': 'javascript',
    'python': 'python',
    'python3': 'python',
    'python2': 'python',
    'ruby': 'ruby',
    'perl': 'perl',
    'php': 'php',
    'bash': 'shell',
    'sh': 'shell',
    'zsh': 'shell',
    'fish': 'shell',
    'lua': 'lua',
    'Rscript': 'r'
};
// build extension -> language index for fast lookups
const EXTENSION_INDEX = new Map();
for (const [langId, info] of Object.entries(LANGUAGE_REGISTRY)) {
    for (const ext of info.extensions) {
        EXTENSION_INDEX.set(ext.toLowerCase(), langId);
    }
}
/**
 * WhatLanguageIsThis - the language detection engine
 *
 * detection priority:
 * 1. filename exact match (Dockerfile, Makefile, etc)
 * 2. file extension
 * 3. shebang line (#!/usr/bin/env python)
 * 4. content heuristics (fallback)
 */
export class WhatLanguageIsThis {
    stats = {
        detected: 0,
        byExtension: 0,
        byFilename: 0,
        byShebang: 0,
        byHeuristics: 0,
        unknown: 0
    };
    /**
     * detect - main detection function
     */
    detect(filePath, content) {
        this.stats.detected++;
        const filename = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        // 1. check filename mappings first
        if (FILENAME_MAPPINGS[filename]) {
            this.stats.byFilename++;
            return LANGUAGE_REGISTRY[FILENAME_MAPPINGS[filename]] ?? LANGUAGE_REGISTRY.unknown;
        }
        // 2. check extension
        if (ext && EXTENSION_INDEX.has(ext)) {
            this.stats.byExtension++;
            return LANGUAGE_REGISTRY[EXTENSION_INDEX.get(ext)] ?? LANGUAGE_REGISTRY.unknown;
        }
        // 3. check shebang if we have content
        if (content) {
            const shebangLang = this.detectFromShebang(content);
            if (shebangLang) {
                this.stats.byShebang++;
                return LANGUAGE_REGISTRY[shebangLang] ?? LANGUAGE_REGISTRY.unknown;
            }
            // 4. content heuristics
            const heuristicLang = this.detectFromContent(content);
            if (heuristicLang) {
                this.stats.byHeuristics++;
                return LANGUAGE_REGISTRY[heuristicLang] ?? LANGUAGE_REGISTRY.unknown;
            }
        }
        // unknown
        this.stats.unknown++;
        return LANGUAGE_REGISTRY.unknown;
    }
    /**
     * detectFromExtension - just checks extension
     */
    detectFromExtension(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext && EXTENSION_INDEX.has(ext)) {
            return LANGUAGE_REGISTRY[EXTENSION_INDEX.get(ext)] ?? null;
        }
        return null;
    }
    /**
     * getLanguageById - get info for a known language
     */
    getLanguageById(id) {
        return LANGUAGE_REGISTRY[id.toLowerCase()] ?? null;
    }
    /**
     * getAllLanguages - returns all known languages
     */
    getAllLanguages() {
        return Object.values(LANGUAGE_REGISTRY).filter(l => l.id !== 'unknown');
    }
    /**
     * getProgrammingLanguages - just the programming ones
     */
    getProgrammingLanguages() {
        return Object.values(LANGUAGE_REGISTRY)
            .filter(l => l.type === 'programming');
    }
    /**
     * getStats - detection statistics
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * resetStats - clear statistics
     */
    resetStats() {
        this.stats = {
            detected: 0,
            byExtension: 0,
            byFilename: 0,
            byShebang: 0,
            byHeuristics: 0,
            unknown: 0
        };
    }
    // private helpers
    detectFromShebang(content) {
        const firstLine = content.split('\n')[0] ?? '';
        if (!firstLine.startsWith('#!')) {
            return null;
        }
        // parse shebang: #!/usr/bin/env python or #!/usr/bin/python
        const match = firstLine.match(/^#!.*?(?:\/env\s+)?(\w+)/);
        if (match && match[1]) {
            const interpreter = match[1];
            return SHEBANG_MAPPINGS[interpreter] ?? null;
        }
        return null;
    }
    detectFromContent(content) {
        const firstFewLines = content.slice(0, TEXT_LIMITS.LANGUAGE_DETECTION_SLICE);
        // check for HTML
        if (/<(!DOCTYPE|html|head|body)/i.test(firstFewLines)) {
            return 'html';
        }
        // check for XML
        if (/^<\?xml/i.test(firstFewLines)) {
            return 'xml';
        }
        // check for JSON
        if (/^\s*[{\[]/.test(firstFewLines) && this.looksLikeJson(content)) {
            return 'json';
        }
        // check for kubernetes manifests
        if (/apiVersion:\s*['"]?[\w/]+['"]?/.test(firstFewLines) &&
            /kind:\s*['"]?\w+['"]?/.test(firstFewLines)) {
            return 'kubernetes';
        }
        // check for common patterns
        const patterns = [
            { regex: /^package\s+\w+\s*;/m, lang: 'java' },
            { regex: /^using\s+\w+\s*;/m, lang: 'csharp' },
            { regex: /^(import|from)\s+\w+/, lang: 'python' },
            { regex: /^(const|let|var)\s+\w+\s*=/, lang: 'javascript' },
            { regex: /^def\s+\w+.*:$/m, lang: 'python' },
            { regex: /^func\s+\w+\s*\(/, lang: 'go' },
            { regex: /^fn\s+\w+\s*\(/, lang: 'rust' },
            { regex: /^require\s*['"]/, lang: 'ruby' },
            { regex: /^CREATE\s+(TABLE|INDEX|VIEW)/im, lang: 'sql' },
            { regex: /^SELECT\s+.*\s+FROM/im, lang: 'sql' }
        ];
        for (const { regex, lang } of patterns) {
            if (regex.test(firstFewLines)) {
                return lang;
            }
        }
        return null;
    }
    looksLikeJson(content) {
        const trimmed = content.trim();
        if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
            return false;
        }
        try {
            JSON.parse(trimmed);
            return true;
        }
        catch (e) {
            // Not valid JSON - that's expected for non-JSON files
            return false;
        }
    }
}
// singleton
let languageDetector = null;
export function getLanguageDetector() {
    if (!languageDetector) {
        languageDetector = new WhatLanguageIsThis();
    }
    return languageDetector;
}
export function resetLanguageDetector() {
    languageDetector = null;
}
// export registry for external use
export { LANGUAGE_REGISTRY, EXTENSION_INDEX, FILENAME_MAPPINGS };
//# sourceMappingURL=languageDetection.js.map