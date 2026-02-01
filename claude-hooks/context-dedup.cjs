#!/usr/bin/env node
/**
 * CONTEXT DEDUPLICATION MODULE
 * ============================
 *
 * Prevents duplicate context injection during a  session.
 * Uses file-based cache that persists across hook invocations.
 *
 * Cache is automatically cleared when:
 *   - Session ID changes (new session)
 *   - Cache is older than 1 hour (stale session)
 *
 * @author hardwicksoftwareservices
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use shared path resolution
let getProjectSocketDir;
try {
  getProjectSocketDir = require('./specmem-paths.cjs').getProjectSocketDir;
} catch (e) {
  getProjectSocketDir = (cwd) => path.join(cwd || process.cwd(), 'specmem', 'sockets');
}

const CACHE_FILENAME = 'context-injection-cache.json';
// NO TTL - cache persists until session-start clears it
// NO COOLDOWN - once injected, it's blocked for the entire session

/**
 * Get cache file path for project
 */
function getCachePath(projectPath) {
  const socketDir = getProjectSocketDir(projectPath);
  return path.join(socketDir, CACHE_FILENAME);
}

/**
 * Hash a query string for storage
 */
function hashQuery(query) {
  return crypto.createHash('md5').update(query.toLowerCase().trim()).digest('hex').slice(0, 12);
}

/**
 * Load cache from file
 */
function loadCache(projectPath) {
  const cachePath = getCachePath(projectPath);
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (e) {
    // Corrupted cache - will be recreated
  }
  return { sessionId: null, injectedQueries: {}, timestamp: 0 };
}

/**
 * Save cache to file
 */
function saveCache(projectPath, cache) {
  const cachePath = getCachePath(projectPath);
  try {
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch (e) {
    // Silent fail - cache is optional optimization
  }
}

/**
 * Check if a query has been injected in this session
 *
 * Session-scoped: once injected, it's blocked until session-start clears the cache.
 * NO cooldown - if it's in the cache, skip it.
 *
 * @param {string} projectPath - Project path
 * @param {string} sessionId - Current session ID (not used for cache key anymore)
 * @param {string} query - Query string to check
 * @returns {boolean} - True if should skip (already injected this session), false if should inject
 */
function shouldSkipInjection(projectPath, sessionId, query) {
  const cache = loadCache(projectPath);
  const queryHash = hashQuery(query);

  // If query hash exists in cache AT ALL, skip it (session-scoped dedup)
  if (cache.injectedQueries && cache.injectedQueries[queryHash]) {
    return true; // Already injected this session, skip
  }

  return false; // Not yet injected, allow
}

/**
 * Mark a query as injected for this session
 *
 * Session-scoped: stays in cache until session-start clears it.
 * No cleanup - session-start hook is responsible for clearing.
 *
 * @param {string} projectPath - Project path
 * @param {string} sessionId - Current session ID (stored for debugging)
 * @param {string} query - Query string that was injected
 */
function markInjected(projectPath, sessionId, query) {
  const cache = loadCache(projectPath);
  const queryHash = hashQuery(query);

  if (!cache.injectedQueries) {
    cache.injectedQueries = {};
  }

  cache.injectedQueries[queryHash] = Date.now();
  cache.sessionId = sessionId; // Track for debugging
  cache.timestamp = Date.now();

  saveCache(projectPath, cache);
}

/**
 * Clear the cache for a session (called when session ends)
 */
function clearCache(projectPath) {
  const cachePath = getCachePath(projectPath);
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch (e) {
    // Silent fail
  }
}

module.exports = {
  shouldSkipInjection,
  markInjected,
  clearCache,
  hashQuery,
  getCachePath
};
