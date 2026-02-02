/**
 * codebase-bridge.cjs - CommonJS bridge to ESM codebase modules
 *
 * yooo this bridges the gap between CJS (specmem-init.cjs) and ESM (dist/codebase/*)
 * uses dynamic import() to load ESM modules from CommonJS context
 *
 * DRY PRINCIPLE: Eliminates code duplication between specmem-init.cjs and ingestion.ts
 * Previously specmem-init.cjs reimplemented:
 *   - scanDir/findFiles (directory traversal)
 *   - countLines (LOC counting)
 *   - langMap (language detection)
 *   - excludeDirs (exclusion patterns)
 *   - extractDefinitions (definition extraction)
 *
 * Now it uses the REAL implementations from src/codebase/*.ts
 */

'use strict';

const path = require('path');
const fs = require('fs');

// cache for loaded ESM modules
let _codebaseModule = null;
let _languageDetector = null;
let _exclusionHandler = null;

/**
 * getCodebaseModule - dynamically loads the codebase ESM module
 * @returns {Promise<Object>} - the codebase module exports
 */
async function getCodebaseModule() {
  if (_codebaseModule) return _codebaseModule;

  // find the dist directory - try multiple paths
  const possiblePaths = [
    path.join(__dirname, '..', 'dist', 'codebase', 'index.js'),
    path.join(process.cwd(), 'dist', 'codebase', 'index.js'),
    path.join(process.cwd(), 'node_modules', 'specmem-hardwicksoftware', 'dist', 'codebase', 'index.js')
  ];

  let modulePath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      modulePath = 'file://' + p;
      break;
    }
  }

  if (!modulePath) {
    throw new Error('codebase module not found - run npm run build first');
  }

  _codebaseModule = await import(modulePath);
  return _codebaseModule;
}

/**
 * getLanguageDetector - returns the WhatLanguageIsThis instance
 * @returns {Promise<Object>} - language detector with detect() method
 */
async function getLanguageDetector() {
  if (_languageDetector) return _languageDetector;

  const mod = await getCodebaseModule();
  _languageDetector = mod.getLanguageDetector();
  return _languageDetector;
}

/**
 * getExclusionHandler - returns the SkipTheBoringShit instance
 * @param {string} rootPath - project root for loading .gitignore etc
 * @returns {Promise<Object>} - exclusion handler with shouldSkip() method
 */
async function getExclusionHandler(rootPath) {
  if (_exclusionHandler) return _exclusionHandler;

  const mod = await getCodebaseModule();
  _exclusionHandler = mod.getExclusionHandler();
  await _exclusionHandler.initialize(rootPath);
  return _exclusionHandler;
}

/**
 * detectLanguage - detect the programming language of a file
 * @param {string} filePath - path to the file
 * @param {string} [content] - optional file content for heuristic detection
 * @returns {Promise<Object>} - LanguageInfo object
 */
async function detectLanguage(filePath, content = null) {
  const detector = await getLanguageDetector();
  return detector.detect(filePath, content);
}

/**
 * shouldSkipPath - check if a path should be excluded
 * @param {string} rootPath - project root
 * @param {string} relativePath - path relative to root
 * @param {boolean} isDirectory - true if path is a directory
 * @returns {Promise<boolean>} - true if should skip
 */
async function shouldSkipPath(rootPath, relativePath, isDirectory) {
  const handler = await getExclusionHandler(rootPath);
  return handler.shouldSkip(relativePath, isDirectory);
}

/**
 * getDefaultExclusions - returns the default exclusion patterns
 * @returns {Promise<string[]>} - array of exclusion patterns
 */
async function getDefaultExclusions() {
  const mod = await getCodebaseModule();
  return mod.DEFAULT_EXCLUSIONS || [];
}

/**
 * getLanguageRegistry - returns the full language registry
 * @returns {Promise<Object>} - LANGUAGE_REGISTRY object
 */
async function getLanguageRegistry() {
  const mod = await getCodebaseModule();
  return mod.LANGUAGE_REGISTRY || {};
}

/**
 * scanSourceFiles - scan a directory for source files using the proper exclusion/language logic
 * @param {string} projectPath - root directory to scan
 * @param {Object} options - scan options
 * @param {number} [options.maxDepth=15] - max directory depth
 * @param {boolean} [options.includeHidden=false] - include hidden files
 * @param {string[]} [options.extensionFilter] - only include these extensions
 * @returns {Promise<Array>} - array of {filePath, relativePath, language} objects
 */
async function scanSourceFiles(projectPath, options = {}) {
  const maxDepth = options.maxDepth || 15;
  const includeHidden = options.includeHidden || false;
  const extensionFilter = options.extensionFilter || null;

  const exclusionHandler = await getExclusionHandler(projectPath);
  const langDetector = await getLanguageDetector();

  const files = [];

  function scan(dir, depth) {
    if (depth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // skip hidden unless requested
        if (!includeHidden && entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(projectPath, fullPath);

        // check exclusions
        if (exclusionHandler.shouldSkip(relativePath, entry.isDirectory())) {
          continue;
        }

        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          // apply extension filter if provided
          if (extensionFilter && !extensionFilter.includes(ext)) {
            continue;
          }

          // detect language
          const language = langDetector.detect(fullPath, null);

          // only include programming languages that support embeddings
          if (language && language.supportsEmbeddings) {
            files.push({
              filePath: fullPath,
              relativePath: relativePath,
              fileName: entry.name,
              extension: ext,
              language: language
            });
          }
        }
      }
    } catch (e) {
      // permission denied or other read error - skip silently
    }
  }

  scan(projectPath, 0);
  return files;
}

/**
 * countLinesOfCode - count lines of code using proper language detection
 * @param {string} projectPath - root directory to scan
 * @param {Object} options - count options
 * @returns {Promise<Object>} - {totalFiles, totalLines, byLanguage}
 */
async function countLinesOfCode(projectPath, options = {}) {
  const files = await scanSourceFiles(projectPath, options);

  const result = {
    totalFiles: 0,
    totalLines: 0,
    byLanguage: {}
  };

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.filePath, 'utf8');
      const lines = content.split('\n').length;

      result.totalFiles++;
      result.totalLines += lines;

      const langId = file.language.id;
      if (!result.byLanguage[langId]) {
        result.byLanguage[langId] = { files: 0, lines: 0 };
      }
      result.byLanguage[langId].files++;
      result.byLanguage[langId].lines += lines;
    } catch (e) {
      // skip unreadable files
    }
  }

  return result;
}

/**
 * getCodeAnalyzer - get the CodeAnalyzer class for definition extraction
 * @returns {Promise<Function>} - CodeAnalyzer class constructor
 */
async function getCodeAnalyzer() {
  // try to load the codeAnalyzer module directly
  const possiblePaths = [
    path.join(__dirname, '..', 'dist', 'codebase', 'codeAnalyzer.js'),
    path.join(process.cwd(), 'dist', 'codebase', 'codeAnalyzer.js')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const mod = await import('file://' + p);
      return mod.CodeAnalyzer;
    }
  }

  throw new Error('codeAnalyzer module not found');
}

/**
 * extractDefinitions - extract function/class definitions from code
 * Uses the proper CodeAnalyzer from codeAnalyzer.ts instead of the duplicated regex patterns
 *
 * @param {string} content - file content
 * @param {string} filePath - path to the file (for language detection)
 * @param {string} fileId - UUID for the file
 * @returns {Promise<Array>} - array of definition objects
 */
async function extractDefinitions(content, filePath, fileId) {
  try {
    const CodeAnalyzer = await getCodeAnalyzer();
    const analyzer = new CodeAnalyzer();

    const langDetector = await getLanguageDetector();
    const language = langDetector.detect(filePath, content);

    const result = analyzer.analyze(content, {
      filePath: filePath,
      fileId: fileId,
      language: language.id
    });

    return result.definitions || [];
  } catch (e) {
    // fallback to empty array if analyzer fails
    return [];
  }
}

/**
 * reset - clear all cached modules/handlers
 * useful for testing or when project context changes
 */
function reset() {
  _codebaseModule = null;
  _languageDetector = null;
  _exclusionHandler = null;
}

// yooo export all the goodies
module.exports = {
  getCodebaseModule,
  getLanguageDetector,
  getExclusionHandler,
  detectLanguage,
  shouldSkipPath,
  getDefaultExclusions,
  getLanguageRegistry,
  scanSourceFiles,
  countLinesOfCode,
  getCodeAnalyzer,
  extractDefinitions,
  reset
};
