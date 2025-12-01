/**
 * SpecMem API Key Detection
 *
 * Auto-detects Claude/Anthropic API keys from common locations.
 * Used for orchestrating Claude instances via SpecMem CLI.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
/**
 * All locations where Claude/Anthropic API keys might be stored
 */
const KEY_LOCATIONS = [
    // Environment variables (highest priority)
    { type: 'env', path: 'ANTHROPIC_API_KEY' },
    { type: 'env', path: 'CLAUDE_API_KEY' },
    // Claude Code credentials file
    { type: 'file', path: '~/.claude/.credentials.json', keyPath: 'claudeAiOauth.accessToken' },
    // Claude config files
    { type: 'file', path: '~/.config/claude/credentials.json', keyPath: 'api_key' },
    { type: 'file', path: '~/.anthropic/credentials', keyPath: null }, // Plain text file
    // Project-level
    { type: 'file', path: '.env', keyPath: null, pattern: /ANTHROPIC_API_KEY=(.+)/ },
    { type: 'file', path: 'specmem.env', keyPath: null, pattern: /ANTHROPIC_API_KEY=(.+)/ },
    // Common dotenv locations
    { type: 'file', path: '.env.local', keyPath: null, pattern: /ANTHROPIC_API_KEY=(.+)/ },
    { type: 'file', path: '.env.development', keyPath: null, pattern: /ANTHROPIC_API_KEY=(.+)/ },
];
/**
 * Expand ~ to home directory
 */
function expandPath(p) {
    if (p.startsWith('~')) {
        return path.join(os.homedir(), p.slice(1));
    }
    return p;
}
/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj, keyPath) {
    const parts = keyPath.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined)
            return null;
        current = current[part];
    }
    return typeof current === 'string' ? current : null;
}
/**
 * Validate that a string looks like an Anthropic API key
 */
function isValidApiKey(key) {
    if (!key)
        return false;
    // Anthropic keys typically start with 'sk-ant-'
    return key.startsWith('sk-ant-') || key.startsWith('sk-');
}
/**
 * Try to read API key from a file
 */
async function readKeyFromFile(filePath, keyPath, pattern) {
    const fullPath = expandPath(filePath);
    try {
        const content = await fs.readFile(fullPath, 'utf-8');
        // If it's a JSON file with a keyPath
        if (keyPath) {
            try {
                const json = JSON.parse(content);
                return getNestedValue(json, keyPath);
            }
            catch {
                return null;
            }
        }
        // If we have a pattern (for .env files)
        if (pattern) {
            const match = content.match(pattern);
            if (match && match[1]) {
                // Remove quotes if present
                return match[1].replace(/^["']|["']$/g, '').trim();
            }
            return null;
        }
        // Plain text file - just trim and return
        return content.trim();
    }
    catch {
        return null;
    }
}
/**
 * Detect Claude/Anthropic API key from all known locations.
 * Returns the first valid key found.
 */
export async function detectApiKey() {
    for (const location of KEY_LOCATIONS) {
        let key = null;
        let source = '';
        if (location.type === 'env') {
            key = process.env[location.path] || null;
            source = `environment variable ${location.path}`;
        }
        else if (location.type === 'file') {
            key = await readKeyFromFile(location.path, location.keyPath || null, location.pattern);
            source = `file ${location.path}`;
        }
        if (isValidApiKey(key)) {
            logger.info({ source }, 'Found valid API key');
            return { key, source, isValid: true };
        }
    }
    logger.warn('No valid API key found in any known location');
    return { key: null, source: 'not found', isValid: false };
}
/**
 * Get API key from cache or detect fresh.
 * Caches the result in memory for subsequent calls.
 */
let cachedApiKey = null;
export async function getApiKey(forceRefresh = false) {
    if (!cachedApiKey || forceRefresh) {
        cachedApiKey = await detectApiKey();
    }
    return cachedApiKey;
}
/**
 * Set API key manually (overrides detection).
 * Useful for CLI commands that take --api-key argument.
 */
export function setApiKey(key, source = 'manual') {
    cachedApiKey = {
        key,
        source,
        isValid: isValidApiKey(key),
    };
    // Also set in environment for child processes
    process.env['ANTHROPIC_API_KEY'] = key;
    logger.info({ source }, 'API key set manually');
}
/**
 * Clear cached API key
 */
export function clearApiKeyCache() {
    cachedApiKey = null;
}
/**
 * Save API key to a persistent location.
 * Stores in ~/.specmem/credentials.json
 */
export async function saveApiKey(key) {
    const credPath = path.join(os.homedir(), '.specmem', 'credentials.json');
    try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(credPath), { recursive: true });
        // Read existing credentials if any
        let creds = {};
        try {
            const existing = await fs.readFile(credPath, 'utf-8');
            creds = JSON.parse(existing);
        }
        catch {
            // No existing file
        }
        // Update with new key
        creds.anthropic_api_key = key;
        creds.updated_at = new Date().toISOString();
        // Write atomically
        await fs.writeFile(credPath, JSON.stringify(creds, null, 2), 'utf-8');
        await fs.chmod(credPath, 0o600); // Owner read/write only
        logger.info({ path: credPath }, 'API key saved to credentials file');
        // Update cache
        setApiKey(key, credPath);
        return true;
    }
    catch (err) {
        logger.error({ err }, 'Failed to save API key');
        return false;
    }
}
/**
 * Extract API key from Claude Code's OAuth token.
 * This is what you stored at ~/.claude/.credentials.json
 */
export async function getClaudeCodeApiKey() {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    try {
        const content = await fs.readFile(credPath, 'utf-8');
        const creds = JSON.parse(content);
        // Claude Code stores the OAuth access token
        const token = creds?.claudeAiOauth?.accessToken;
        if (token && typeof token === 'string') {
            logger.info('Found Claude Code OAuth token');
            return token;
        }
    }
    catch {
        // File doesn't exist or invalid
    }
    return null;
}
/**
 * Check if we have a usable API key from any source.
 */
export async function hasValidApiKey() {
    const result = await getApiKey();
    return result.isValid;
}
//# sourceMappingURL=apiKeyDetection.js.map