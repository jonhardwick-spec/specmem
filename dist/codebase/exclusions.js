// bruh we aint storing node_modules thats just wasteful fr fr
// this module handles all the BORING stuff we wanna skip
// .gitignore vibes but for our codebase ingestion
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { getProjectPath } from '../config.js';
/**
 * EXCLUSION_CONFIG - central config for file exclusions
 * maxFileSize configurable via SPECMEM_MAX_FILE_SIZE env var
 */
export const EXCLUSION_CONFIG = {
    // Max file size to index (default 1MB, env override)
    maxFileSize: parseInt(process.env.SPECMEM_MAX_FILE_SIZE || '', 10) || 1024 * 1024,
    // Skip these patterns - minified, bundled, generated files
    excludePatterns: [
        // Minified files - these are obfuscated garbage for indexing
        '*.min.js',
        '*.min.css',
        '*.min.mjs',
        // Bundled files - huge and unreadable
        '*.bundle.js',
        '*.bundle.mjs',
        '*.chunk.js',
        '*.chunk.mjs',
        'bundle.js',
        'vendor.js',
        'main.*.js', // webpack output like main.abc123.js
        // Source maps - binary-ish, not code
        '*.map',
        '*.js.map',
        '*.css.map',
        // Lock files - huge and not useful for semantic search
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'composer.lock',
        'Cargo.lock',
        'Gemfile.lock',
        'poetry.lock',
        // WebAssembly - binary
        '*.wasm',
        // Large data files
        '*.csv',
        '*.parquet',
        '*.sqlite',
        '*.db',
        // Binary assets
        '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.webp',
        '*.pdf', '*.zip', '*.tar', '*.gz', '*.rar', '*.7z',
        '*.mp3', '*.mp4', '*.avi', '*.mov', '*.mkv',
        '*.ttf', '*.woff', '*.woff2', '*.eot', '*.otf',
        '*.exe', '*.dll', '*.so', '*.dylib', '*.bin',
        // Build artifacts
        '*.tsbuildinfo',
        '.DS_Store',
        'Thumbs.db'
    ],
    // Skip files larger than maxFileSize
    skipLargeFiles: true
};
/**
 * default exclusions - these are like the golden rules fr
 * we NEVER wanna ingest these folders/files
 */
const DEFAULT_EXCLUSIONS = [
    // package managers - absolute UNITS of wasted space
    // yooo we skip indexing node_modules but track package.json changes instead
    'node_modules',
    'node_modules/**',
    '.pnpm',
    '.yarn',
    '.npm',
    'bower_components',
    'vendor',
    'packages/*/node_modules',
    // build outputs - generated stuff we dont need
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.vercel',
    '.netlify',
    'coverage',
    '__pycache__',
    '*.pyc',
    '.pytest_cache',
    // version control - meta stuff
    '.git',
    '.svn',
    '.hg',
    '.gitignore',
    '.gitattributes',
    // IDE/editor configs
    '.idea',
    '.vscode',
    '*.swp',
    '*.swo',
    '*~',
    '.DS_Store',
    'Thumbs.db',
    // logs and temp files
    '*.log',
    'logs',
    'tmp',
    'temp',
    '.cache',
    '.parcel-cache',
    '.turbo',
    // lock files - we got the manifest thats enough
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Gemfile.lock',
    'poetry.lock',
    'Cargo.lock',
    'composer.lock',
    // environment and secrets - NEVER store these fr
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.cert',
    '*.crt',
    'secrets.*',
    'credentials.*',
    // test fixtures and snapshots
    '__snapshots__',
    '__mocks__',
    '*.snap',
    // binary and media files - just skip these
    '*.png',
    '*.jpg',
    '*.jpeg',
    '*.gif',
    '*.ico',
    '*.svg',
    '*.woff',
    '*.woff2',
    '*.ttf',
    '*.eot',
    '*.mp3',
    '*.mp4',
    '*.avi',
    '*.mov',
    '*.pdf',
    '*.zip',
    '*.tar',
    '*.gz',
    '*.rar',
    '*.7z',
    '*.exe',
    '*.dll',
    '*.so',
    '*.dylib',
    '*.bin',
    // large data files
    '*.csv',
    '*.parquet',
    '*.sqlite',
    '*.db',
    // specmem internal - dont eat our own tail lol
    // fr fr skipping ourselves from indexing
    '.specmem',
    '.specmem/**',
    '.specmemignore',
    'specmem',
    'specmem/**',
    // minified/bundled files - obfuscated garbage for indexing
    '*.min.js',
    '*.min.css',
    '*.min.mjs',
    '*.bundle.js',
    '*.bundle.mjs',
    '*.chunk.js',
    '*.chunk.mjs',
    'bundle.js',
    'vendor.js',
    // source maps
    '*.map',
    '*.js.map',
    '*.css.map',
    // tarballs and packages
    '*.tgz',
    '*.tar.gz'
];
/**
 * SkipTheBoringShit - the exclusion handler that keeps our db clean
 *
 * features that go hard:
 * - .gitignore style patterns
 * - glob pattern matching
 * - directory-specific rules
 * - custom .specmemignore file support
 * - negation patterns (! prefix)
 */
export class SkipTheBoringShit {
    patterns = [];
    customPatterns = [];
    initialized = false;
    rootPath = '';
    // stats for debugging
    stats = {
        totalChecked: 0,
        totalSkipped: 0,
        byPattern: new Map()
    };
    constructor(additionalExclusions) {
        // load defaults
        this.loadPatterns(DEFAULT_EXCLUSIONS);
        // add any custom ones passed in
        if (additionalExclusions?.length) {
            this.loadPatterns(additionalExclusions);
        }
    }
    /**
     * initialize - loads .specmemignore from project root if exists
     */
    async initialize(rootPath) {
        this.rootPath = rootPath;
        // try to load .specmemignore
        const ignoreFilePath = path.join(rootPath, '.specmemignore');
        try {
            const content = await fs.readFile(ignoreFilePath, 'utf-8');
            const customPatterns = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
            if (customPatterns.length > 0) {
                this.loadPatterns(customPatterns, true);
                // Changed to debug to not break ProgressUI during specmem-init
                logger.debug({ patternCount: customPatterns.length }, 'loaded .specmemignore - custom exclusions activated fr');
            }
        }
        catch (err) {
            // file doesnt exist - thats fine
            logger.debug('no .specmemignore found - using defaults only');
        }
        // also try to load .gitignore patterns
        const gitignorePath = path.join(rootPath, '.gitignore');
        try {
            const content = await fs.readFile(gitignorePath, 'utf-8');
            const gitPatterns = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
            if (gitPatterns.length > 0) {
                this.loadPatterns(gitPatterns, true);
                logger.debug({ patternCount: gitPatterns.length }, 'loaded .gitignore patterns too');
            }
        }
        catch (e) {
            // no gitignore file - thats totally ok, not every project has one
        }
        this.initialized = true;
        // Changed to debug to not break ProgressUI during specmem-init
        logger.debug({ totalPatterns: this.patterns.length + this.customPatterns.length }, 'exclusion handler initialized - ready to skip the boring shit');
    }
    /**
     * shouldSkip - the main check function
     * returns true if we should skip this path
     */
    shouldSkip(filePath, isDirectory = false) {
        this.stats.totalChecked++;
        // normalize the path
        const normalizedPath = this.normalizePath(filePath);
        const basename = path.basename(normalizedPath);
        // check all patterns
        let shouldExclude = false;
        let matchedPattern = null;
        // check default patterns first
        for (const pattern of this.patterns) {
            if (this.matchPattern(normalizedPath, basename, pattern, isDirectory)) {
                if (pattern.isNegated) {
                    shouldExclude = false;
                    matchedPattern = null;
                }
                else {
                    shouldExclude = true;
                    matchedPattern = pattern.pattern;
                }
            }
        }
        // then check custom patterns (they can override defaults)
        for (const pattern of this.customPatterns) {
            if (this.matchPattern(normalizedPath, basename, pattern, isDirectory)) {
                if (pattern.isNegated) {
                    shouldExclude = false;
                    matchedPattern = null;
                }
                else {
                    shouldExclude = true;
                    matchedPattern = pattern.pattern;
                }
            }
        }
        if (shouldExclude && matchedPattern) {
            this.stats.totalSkipped++;
            const count = this.stats.byPattern.get(matchedPattern) ?? 0;
            this.stats.byPattern.set(matchedPattern, count + 1);
        }
        return shouldExclude;
    }
    /**
     * addPattern - adds a new exclusion pattern at runtime
     */
    addPattern(pattern, isCustom = true) {
        const parsed = this.parsePattern(pattern);
        if (isCustom) {
            this.customPatterns.push(parsed);
        }
        else {
            this.patterns.push(parsed);
        }
    }
    /**
     * removePattern - removes a pattern
     */
    removePattern(pattern) {
        const beforeCount = this.customPatterns.length + this.patterns.length;
        this.customPatterns = this.customPatterns.filter(p => p.pattern !== pattern);
        this.patterns = this.patterns.filter(p => p.pattern !== pattern);
        return (this.customPatterns.length + this.patterns.length) < beforeCount;
    }
    /**
     * getPatterns - returns all active patterns
     */
    getPatterns() {
        return {
            defaults: this.patterns.map(p => p.pattern),
            custom: this.customPatterns.map(p => p.pattern)
        };
    }
    /**
     * getStats - returns exclusion statistics
     */
    getStats() {
        const topPatterns = Array.from(this.stats.byPattern.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([pattern, count]) => ({ pattern, count }));
        return {
            totalChecked: this.stats.totalChecked,
            totalSkipped: this.stats.totalSkipped,
            skipRate: this.stats.totalChecked > 0
                ? this.stats.totalSkipped / this.stats.totalChecked
                : 0,
            topSkippedPatterns: topPatterns
        };
    }
    /**
     * resetStats - clears the statistics
     */
    resetStats() {
        this.stats.totalChecked = 0;
        this.stats.totalSkipped = 0;
        this.stats.byPattern.clear();
    }
    /**
     * saveSpecmemignore - saves current custom patterns to .specmemignore
     */
    async saveSpecmemignore(rootPath) {
        const targetPath = rootPath ?? this.rootPath;
        if (!targetPath) {
            throw new Error('no root path set - initialize first or pass a path');
        }
        const content = [
            '# SpecMem Exclusion Patterns',
            '# Generated automatically - edit to customize',
            '',
            '# Custom patterns:',
            ...this.customPatterns.map(p => p.pattern),
            ''
        ].join('\n');
        await fs.writeFile(path.join(targetPath, '.specmemignore'), content, 'utf-8');
        logger.info('saved .specmemignore file');
    }
    // private methods
    loadPatterns(patterns, isCustom = false) {
        for (const pattern of patterns) {
            const parsed = this.parsePattern(pattern);
            if (isCustom) {
                this.customPatterns.push(parsed);
            }
            else {
                this.patterns.push(parsed);
            }
        }
    }
    parsePattern(pattern) {
        let processedPattern = pattern.trim();
        let isNegated = false;
        let isDirectory = false;
        // check for negation
        if (processedPattern.startsWith('!')) {
            isNegated = true;
            processedPattern = processedPattern.slice(1);
        }
        // check for directory-only pattern
        if (processedPattern.endsWith('/')) {
            isDirectory = true;
            processedPattern = processedPattern.slice(0, -1);
        }
        // check if its a glob pattern
        const isGlob = /[*?[\]{}]/.test(processedPattern);
        // convert to regex if its a glob
        let regex;
        if (isGlob) {
            regex = this.globToRegex(processedPattern);
        }
        return {
            pattern,
            isGlob,
            isDirectory,
            isNegated,
            regex
        };
    }
    matchPattern(normalizedPath, basename, pattern, isDir) {
        // directory-only patterns should only match directories
        if (pattern.isDirectory && !isDir) {
            return false;
        }
        if (pattern.isGlob && pattern.regex) {
            // glob matching - check against full path and basename
            return pattern.regex.test(normalizedPath) || pattern.regex.test(basename);
        }
        // simple string matching
        const cleanPattern = pattern.pattern.replace(/^!/, '').replace(/\/$/, '');
        // check exact match with basename
        if (basename === cleanPattern) {
            return true;
        }
        // check if path contains pattern as segment
        const pathSegments = normalizedPath.split('/');
        if (pathSegments.includes(cleanPattern)) {
            return true;
        }
        // check path ending
        if (normalizedPath.endsWith('/' + cleanPattern) || normalizedPath === cleanPattern) {
            return true;
        }
        return false;
    }
    globToRegex(glob) {
        let regexStr = '';
        let i = 0;
        while (i < glob.length) {
            const char = glob[i];
            if (char === '*') {
                if (glob[i + 1] === '*') {
                    // ** matches any path including slashes
                    regexStr += '.*';
                    i += 2;
                    // skip trailing slash if present
                    if (glob[i] === '/')
                        i++;
                }
                else {
                    // * matches anything except slashes
                    regexStr += '[^/]*';
                    i++;
                }
            }
            else if (char === '?') {
                regexStr += '[^/]';
                i++;
            }
            else if (char === '[') {
                // character class
                const endBracket = glob.indexOf(']', i);
                if (endBracket !== -1) {
                    regexStr += glob.slice(i, endBracket + 1);
                    i = endBracket + 1;
                }
                else {
                    regexStr += '\\[';
                    i++;
                }
            }
            else if (char === '{') {
                // brace expansion
                const endBrace = glob.indexOf('}', i);
                if (endBrace !== -1) {
                    const options = glob.slice(i + 1, endBrace).split(',');
                    regexStr += '(' + options.map(o => this.escapeRegex(o)).join('|') + ')';
                    i = endBrace + 1;
                }
                else {
                    regexStr += '\\{';
                    i++;
                }
            }
            else if ('.+^$|()\\'.includes(char)) {
                // escape special regex chars
                regexStr += '\\' + char;
                i++;
            }
            else {
                regexStr += char;
                i++;
            }
        }
        // match full path or just the end
        return new RegExp('(^|/)' + regexStr + '(/|$)');
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    normalizePath(filePath) {
        // convert to forward slashes and remove leading ./
        let normalized = filePath.replace(/\\/g, '/');
        if (normalized.startsWith('./')) {
            normalized = normalized.slice(2);
        }
        // remove root path prefix if present
        if (this.rootPath && normalized.startsWith(this.rootPath.replace(/\\/g, '/'))) {
            normalized = normalized.slice(this.rootPath.length);
            if (normalized.startsWith('/')) {
                normalized = normalized.slice(1);
            }
        }
        return normalized;
    }
}
/**
 * BINARY_EXTENSIONS - extensions that are always binary no cap
 * checking extension first is O(1) vs reading file bytes
 */
const BINARY_EXTENSIONS = new Set([
    // images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif',
    '.psd', '.ai', '.eps', '.raw', '.cr2', '.nef', '.heic', '.heif', '.avif',
    // audio
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.aiff',
    // video
    '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg',
    // archives
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.lz', '.lzma',
    // executables and libraries
    '.exe', '.dll', '.so', '.dylib', '.bin', '.out', '.app', '.msi', '.deb', '.rpm',
    // documents (binary formats)
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
    // fonts
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    // databases
    '.sqlite', '.db', '.sqlite3', '.mdb', '.accdb',
    // other binary
    '.class', '.jar', '.war', '.ear', '.pyc', '.pyo', '.o', '.a', '.lib',
    '.node', '.wasm', '.blend', '.fbx', '.obj', '.stl', '.glb', '.gltf'
]);
/**
 * MAGIC_BYTES - file signatures that indicate binary fr fr
 * these are the first bytes of common binary formats
 */
const MAGIC_BYTES = [
    // Images
    { signature: [0x89, 0x50, 0x4E, 0x47], name: 'PNG' },
    { signature: [0xFF, 0xD8, 0xFF], name: 'JPEG' },
    { signature: [0x47, 0x49, 0x46, 0x38], name: 'GIF' },
    { signature: [0x42, 0x4D], name: 'BMP' },
    { signature: [0x52, 0x49, 0x46, 0x46], name: 'WEBP/RIFF' },
    // Archives
    { signature: [0x50, 0x4B, 0x03, 0x04], name: 'ZIP/JAR/DOCX' },
    { signature: [0x50, 0x4B, 0x05, 0x06], name: 'ZIP empty' },
    { signature: [0x50, 0x4B, 0x07, 0x08], name: 'ZIP spanned' },
    { signature: [0x1F, 0x8B], name: 'GZIP' },
    { signature: [0x42, 0x5A, 0x68], name: 'BZIP2' },
    { signature: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], name: '7z' },
    { signature: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07], name: 'RAR' },
    { signature: [0xFD, 0x37, 0x7A, 0x58, 0x5A], name: 'XZ' },
    // Executables
    { signature: [0x4D, 0x5A], name: 'EXE/DLL' },
    { signature: [0x7F, 0x45, 0x4C, 0x46], name: 'ELF' },
    { signature: [0xCF, 0xFA, 0xED, 0xFE], name: 'Mach-O 64' },
    { signature: [0xCE, 0xFA, 0xED, 0xFE], name: 'Mach-O 32' },
    { signature: [0xFE, 0xED, 0xFA, 0xCF], name: 'Mach-O 64 BE' },
    { signature: [0xFE, 0xED, 0xFA, 0xCE], name: 'Mach-O 32 BE' },
    // Documents
    { signature: [0x25, 0x50, 0x44, 0x46], name: 'PDF' },
    { signature: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], name: 'MS Office' },
    // Audio/Video
    { signature: [0x49, 0x44, 0x33], name: 'MP3 ID3' },
    { signature: [0xFF, 0xFB], name: 'MP3' },
    { signature: [0xFF, 0xFA], name: 'MP3' },
    { signature: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], name: 'MP4' },
    { signature: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], name: 'MP4' },
    { signature: [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70], name: 'MP4' },
    { signature: [0x4F, 0x67, 0x67, 0x53], name: 'OGG' },
    { signature: [0x66, 0x4C, 0x61, 0x43], name: 'FLAC' },
    // Fonts
    { signature: [0x00, 0x01, 0x00, 0x00], name: 'TTF' },
    { signature: [0x4F, 0x54, 0x54, 0x4F], name: 'OTF' },
    { signature: [0x77, 0x4F, 0x46, 0x46], name: 'WOFF' },
    { signature: [0x77, 0x4F, 0x46, 0x32], name: 'WOFF2' },
    // Database
    { signature: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65], name: 'SQLite' },
    // WebAssembly
    { signature: [0x00, 0x61, 0x73, 0x6D], name: 'WASM' },
    // Java class
    { signature: [0xCA, 0xFE, 0xBA, 0xBE], name: 'Java class' },
    // Python bytecode
    { signature: [0x03, 0xF3, 0x0D, 0x0A], name: 'Python 2.7' },
    { signature: [0x33, 0x0D, 0x0D, 0x0A], name: 'Python 3' },
];
/**
 * checkMagicBytes - checks if buffer starts with known binary magic bytes
 * returns the format name if match found, null otherwise
 */
function checkMagicBytes(buffer, bytesRead) {
    for (const magic of MAGIC_BYTES) {
        if (bytesRead >= magic.signature.length) {
            let matches = true;
            for (let i = 0; i < magic.signature.length; i++) {
                if (buffer[i] !== magic.signature[i]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return magic.name;
            }
        }
    }
    return null;
}
/**
 * isBinaryFile - check if file is binary using multiple methods
 *
 * detection order (fast to slow):
 * 1. extension check - O(1) lookup, catches most binaries
 * 2. magic bytes - read first 8 bytes, detect format
 * 3. null byte scan - binary files usually have null bytes
 * 4. non-text ratio - fallback for weird binary formats
 */
export async function isBinaryFile(filePath) {
    // fast path: check extension first - O(1) lookup
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
        return true;
    }
    try {
        const fd = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(8000);
        const { bytesRead } = await fd.read(buffer, 0, 8000, 0);
        await fd.close();
        // empty file aint binary
        if (bytesRead === 0) {
            return false;
        }
        // check magic bytes - catches binary files without common extensions
        const magicFormat = checkMagicBytes(buffer, bytesRead);
        if (magicFormat) {
            logger.debug({ filePath, format: magicFormat }, 'binary detected via magic bytes');
            return true;
        }
        // check for null bytes - binary files usually have these
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) {
                return true;
            }
        }
        // check for high ratio of non-text characters
        let nonTextCount = 0;
        for (let i = 0; i < bytesRead; i++) {
            const byte = buffer[i];
            // control chars (except common ones like tab/newline/CR) indicate binary
            if (byte !== undefined && byte < 32 && ![9, 10, 13].includes(byte)) {
                nonTextCount++;
            }
        }
        // if more than 30% non-text, its probably binary
        return nonTextCount / bytesRead > 0.3;
    }
    catch (e) {
        // if we cant read it, assume its binary/unusable
        logger.debug({ filePath, error: e }, 'file read failed - treating as binary');
        return true;
    }
}
/**
 * getFileSizeBytes - gets file size without reading content
 */
export async function getFileSizeBytes(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
}
/**
 * shouldSkipLargeFile - checks if file exceeds size limit
 * logs when skipping for debugging
 */
export async function shouldSkipLargeFile(filePath) {
    if (!EXCLUSION_CONFIG.skipLargeFiles) {
        return false;
    }
    try {
        const sizeBytes = await getFileSizeBytes(filePath);
        if (sizeBytes > EXCLUSION_CONFIG.maxFileSize) {
            logger.debug({
                filePath,
                sizeBytes,
                maxFileSize: EXCLUSION_CONFIG.maxFileSize,
                sizeMB: (sizeBytes / (1024 * 1024)).toFixed(2)
            }, 'skipping large file - exceeds maxFileSize');
            return true;
        }
    }
    catch (e) {
        // cant stat file, skip it
        logger.debug({ filePath, error: String(e) }, 'cant stat file - skipping');
        return true;
    }
    return false;
}
/**
 * isMinifiedOrBundled - quick pattern check for minified/bundled files
 * O(1) extension check + basename patterns
 */
export function isMinifiedOrBundled(filePath) {
    const basename = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    // minified patterns
    if (basename.endsWith('.min.js') || basename.endsWith('.min.css') || basename.endsWith('.min.mjs')) {
        logger.debug({ filePath }, 'skipping minified file');
        return true;
    }
    // bundled patterns
    if (basename.endsWith('.bundle.js') || basename.endsWith('.bundle.mjs') ||
        basename.endsWith('.chunk.js') || basename.endsWith('.chunk.mjs')) {
        logger.debug({ filePath }, 'skipping bundled file');
        return true;
    }
    // common bundle names
    if (basename === 'bundle.js' || basename === 'vendor.js' || basename === 'main.js') {
        logger.debug({ filePath }, 'skipping common bundle file');
        return true;
    }
    // source maps
    if (ext === '.map' || basename.endsWith('.js.map') || basename.endsWith('.css.map')) {
        logger.debug({ filePath }, 'skipping source map');
        return true;
    }
    // webpack-style hashed outputs (main.abc123.js, chunk.abc123.js)
    const webpackPattern = /^(main|chunk|vendor)\.[a-f0-9]{6,}\.(js|mjs)$/i;
    if (webpackPattern.test(basename)) {
        logger.debug({ filePath }, 'skipping webpack hashed output');
        return true;
    }
    return false;
}
// Per-project exclusion instances - prevents cross-project pollution
const exclusionsByProject = new Map();
export function getExclusionHandler(projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!exclusionsByProject.has(targetProject)) {
        exclusionsByProject.set(targetProject, new SkipTheBoringShit());
    }
    return exclusionsByProject.get(targetProject);
}
export function resetExclusionHandler(projectPath) {
    const targetProject = projectPath || getProjectPath();
    exclusionsByProject.delete(targetProject);
}
export function resetAllExclusionHandlers() {
    exclusionsByProject.clear();
}
// export the default exclusions for reference
export { DEFAULT_EXCLUSIONS };
//# sourceMappingURL=exclusions.js.map