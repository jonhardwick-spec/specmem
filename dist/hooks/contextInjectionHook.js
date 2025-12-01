/**
 * SPECMEM CONTEXT INJECTION HOOK
 * ==============================
 *
 * Native SpecMem hook that auto-injects context into every prompt.
 * This is the CORE of the drilldown flow - it intercepts prompts
 * and enriches them with relevant memory context.
 *
 * Flow:
 *   1. User submits prompt
 *   2. Hook generates embedding for prompt (via sandboxed container)
 *   3. Hook searches SpecMem for semantically similar memories
 *   4. Context is injected into the prompt
 *   5. Claude sees enriched prompt with related context
 *
 * This hook uses:
 *   - Sandboxed embedding container (all-MiniLM-L6-v2, 384 dims)
 *   - PostgreSQL pgvector for semantic search
 *   - Chinese Compactor for token efficiency
 */
import { createConnection } from 'net';
import { existsSync } from 'fs';
import { Pool } from 'pg';
import path from 'path';
import { compactIfEnabled } from '../utils/tokenCompressor.js';
import { logger } from '../utils/logger.js';
import { projectEmbedding } from '../embeddings/projectionLayer.js';
import { getEmbeddingSocketPath, getProjectPath, getInstanceDir } from '../config.js';
import { getProjectSchema } from '../db/projectNamespacing.js';
/**
 * Get default config from environment or SpecMem's own config system
 * This makes SpecMem self-contained - no hardcoded values
 * NOW PER-PROJECT - uses {PROJECT}/specmem/config.json
 */
function getDefaultConfig() {
    // Try to load from SpecMem's config file first - NOW PER-PROJECT!
    let fileConfig = {};
    try {
        // Priority: env var > per-project config > legacy global config
        const configPath = process.env.SPECMEM_CONFIG_PATH ||
            path.join(getInstanceDir(), 'config.json') || // {PROJECT}/specmem/config.json
            path.join(process.env.HOME || '~', '.specmem', 'config.json'); // Legacy fallback
        if (existsSync(configPath)) {
            const fs = require('fs');
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    }
    catch {
        // Config file optional
    }
    return {
        // Search parameters
        searchLimit: parseInt(process.env.SPECMEM_SEARCH_LIMIT || '') || fileConfig.searchLimit || 5,
        threshold: parseFloat(process.env.SPECMEM_THRESHOLD || '') || fileConfig.threshold || 0.3,
        maxContentLength: parseInt(process.env.SPECMEM_MAX_CONTENT || '') || fileConfig.maxContentLength || 300,
        // Database - from env, config file, or sensible defaults
        dbHost: process.env.SPECMEM_DB_HOST || fileConfig.dbHost || 'localhost',
        dbPort: parseInt(process.env.SPECMEM_DB_PORT || '') || fileConfig.dbPort || 5432,
        dbName: process.env.SPECMEM_DB_NAME || fileConfig.dbName || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
        dbUser: process.env.SPECMEM_DB_USER || fileConfig.dbUser || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
        dbPassword: process.env.SPECMEM_DB_PASSWORD || fileConfig.dbPassword || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
        // Embedding socket - uses getEmbeddingSocketPath from config
        embeddingSocket: process.env.SPECMEM_EMBEDDING_SOCKET || fileConfig.embeddingSocket ||
            getEmbeddingSocketPath(),
        // Behavior flags
        enabled: process.env.SPECMEM_CONTEXT_HOOK !== 'false',
        compressContext: process.env.SPECMEM_COMPRESS !== 'false',
        includeMetadata: process.env.SPECMEM_INCLUDE_META !== 'false'
    };
}
// Lazy-loaded default config
let _defaultConfig = null;
const DEFAULT_CONFIG = new Proxy({}, {
    get(target, prop) {
        if (!_defaultConfig)
            _defaultConfig = getDefaultConfig();
        return _defaultConfig[prop];
    }
});
// Per-project pool management - prevents cross-project memory leakage
const poolsByProject = new Map();
function getPool(config) {
    const projectPath = getProjectPath();
    if (!poolsByProject.has(projectPath)) {
        const newPool = new Pool({
            host: config.dbHost,
            port: config.dbPort,
            database: config.dbName,
            user: config.dbUser,
            password: config.dbPassword,
            max: 5,
            idleTimeoutMillis: 30000
        });
        // Set search_path on connect to ensure schema isolation
        newPool.on('connect', async (client) => {
            try {
                const schemaName = getProjectSchema(projectPath);
                await client.query(`SET search_path TO ${schemaName}, public`);
            }
            catch (err) {
                logger.error({ err, projectPath }, '[ContextHook] Failed to set search_path');
            }
        });
        poolsByProject.set(projectPath, newPool);
        logger.info({ projectPath }, '[ContextHook] Created new pool for project with search_path hook');
    }
    return poolsByProject.get(projectPath);
}
/**
 * Generate embedding via sandboxed container
 */
async function generateEmbedding(text, config) {
    return new Promise((resolve, reject) => {
        if (!existsSync(config.embeddingSocket)) {
            // Fallback to hash-based embedding
            resolve(hashBasedEmbedding(text));
            return;
        }
        const socket = createConnection(config.embeddingSocket);
        let buffer = '';
        const timeout = setTimeout(() => {
            socket.destroy();
            resolve(hashBasedEmbedding(text));
        }, 5000);
        socket.on('connect', () => {
            socket.write(JSON.stringify({ type: 'embed', text }) + '\n');
        });
        socket.on('data', (data) => {
            buffer += data.toString();
            const newlineIdx = buffer.indexOf('\n');
            if (newlineIdx !== -1) {
                clearTimeout(timeout);
                try {
                    const response = JSON.parse(buffer.slice(0, newlineIdx));
                    socket.end();
                    if (response.embedding) {
                        resolve(response.embedding);
                    }
                    else {
                        resolve(hashBasedEmbedding(text));
                    }
                }
                catch {
                    resolve(hashBasedEmbedding(text));
                }
            }
        });
        socket.on('error', () => {
            clearTimeout(timeout);
            resolve(hashBasedEmbedding(text));
        });
    });
}
/**
 * Fallback hash-based embedding (384 dims)
 */
function hashBasedEmbedding(text) {
    const normalized = text.toLowerCase().trim();
    const embedding = new Array(384);
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    }
    hash = Math.abs(hash);
    for (let i = 0; i < 384; i++) {
        const seed = hash + i * 31;
        embedding[i] = Math.sin(seed) * Math.cos(seed * 0.7);
    }
    // Normalize
    const mag = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    if (mag > 0) {
        for (let i = 0; i < 384; i++) {
            embedding[i] /= mag;
        }
    }
    return embedding;
}
/**
 * Search SpecMem for related memories
 * NOW PER-PROJECT - only searches memories from current project!
 */
export async function searchRelatedMemories(prompt, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const projectPath = getProjectPath();
    try {
        // Generate embedding (dimension from container/fallback)
        const rawEmbedding = await generateEmbedding(prompt, cfg);
        // Project to database target dimension (dynamically fetched from pgvector metadata)
        const embedding = projectEmbedding(rawEmbedding);
        const embeddingStr = `[${embedding.join(',')}]`;
        // Query database - NOW FILTERED BY project_path!
        const db = getPool(cfg);
        const result = await db.query(`
      SELECT id, content, importance, tags,
             1 - (embedding <=> $1::vector) as similarity
      FROM memories
      WHERE project_path = $4
        AND 1 - (embedding <=> $1::vector) > $2
      ORDER BY similarity DESC
      LIMIT $3
    `, [embeddingStr, cfg.threshold, cfg.searchLimit, projectPath]);
        logger.debug({
            projectPath,
            resultCount: result.rows.length,
            threshold: cfg.threshold
        }, '[ContextHook] Search completed');
        return result.rows.map(row => ({
            id: row.id,
            content: row.content?.slice(0, cfg.maxContentLength) || '',
            importance: row.importance || 'medium',
            tags: row.tags || [],
            similarity: parseFloat(row.similarity) || 0
        }));
    }
    catch (error) {
        logger.error({ error, projectPath }, '[ContextHook] Search failed');
        return [];
    }
}
/**
 * Format memories for context injection
 */
export function formatContextInjection(memories, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (!memories.length)
        return '';
    let output = '\n<specmem-context>\n';
    output += '## Related SpecMem Memories\n\n';
    memories.forEach((mem, i) => {
        const sim = `${(mem.similarity * 100).toFixed(0)}%`;
        const meta = cfg.includeMetadata && mem.tags.length
            ? ` [${mem.tags.slice(0, 3).join(', ')}]`
            : '';
        let content = mem.content;
        if (cfg.compressContext) {
            content = compactIfEnabled(content, 'hook').result;
        }
        output += `${i + 1}. (${sim} match)${meta}\n   ${content}\n\n`;
    });
    output += '*Use `/specmem-drilldown` for deeper search or `/specmem-research` for web research.*\n';
    output += '</specmem-context>\n';
    return output;
}
/**
 * Main hook handler - call this from Claude Code hooks
 */
export async function contextInjectionHook(prompt, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    // Skip if disabled
    if (!cfg.enabled)
        return '';
    // Skip short prompts
    if (!prompt || prompt.length < 10)
        return '';
    // Skip slash commands
    if (prompt.startsWith('/') || prompt.startsWith('!'))
        return '';
    try {
        const memories = await searchRelatedMemories(prompt, cfg);
        return formatContextInjection(memories, cfg);
    }
    catch (error) {
        logger.error({ error }, '[ContextHook] Failed');
        return '';
    }
}
/**
 * CLI entry point for use as external hook
 */
async function main() {
    // Read prompt from stdin
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
        input += chunk;
    }
    // Parse JSON or use raw input
    let prompt = '';
    try {
        const data = JSON.parse(input);
        prompt = data.prompt || data.message || data.content || '';
    }
    catch {
        prompt = input.trim();
    }
    const context = await contextInjectionHook(prompt);
    if (context) {
        console.log(context);
    }
}
// Note: CLI entry point is in cli.ts, not here
// This module is exported for programmatic use
export { DEFAULT_CONFIG };
//# sourceMappingURL=contextInjectionHook.js.map