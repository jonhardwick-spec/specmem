/**
 * CameraZoomSearch - Camera Roll style memory/code exploration
 *
 * Metaphor: Like a camera roll with zoom capability
 * - Zoom OUT = broad search, many results, less detail (threshold 0.3-0.5)
 * - Zoom IN = focused search, fewer results, more detail (threshold 0.8-0.9)
 * - Each result has a drilldownID for further exploration
 * - Drilling down reveals associated memories, context, related conversations
 *
 * Data Flow:
 * 1. Frankenstein embeddings -> generate vectors
 * 2. Vector search -> find relevant memories
 * 3. English text results
 * 4. Mini COT model -> decides relevancy, ranks results
 * 5. Output through Traditional Chinese compactor (for token reduction)
 *
 * Response Format:
 * ```
 * content: "Here's what I said from last week"
 * CR ( Response): "Well that's interesting because..."
 * drilldownID: 123
 * similarity: 0.87
 * ```
 *
 * Then  can:
 * - drill_down(123) - zoom in for more detail on that memory
 * - get_memory(123) - get full memory content
 * - Each drill-down may reveal MORE drilldown IDs for deeper exploration
 */
import { logger } from '../utils/logger.js';
import { smartCompress } from '../utils/tokenCompressor.js';
/**
 * DrilldownRegistry - Maps simple numeric IDs to memory UUIDs
 *
 * This allows  to use simple drill_down(123) calls instead of
 * drill_down("550e8400-e29b-41d4-a716-446655440000")
 */
class DrilldownRegistry {
    static instance;
    registry = new Map();
    reverseRegistry = new Map();
    nextID = 1;
    maxEntries = parseInt(process.env['SPECMEM_DRILLDOWN_MAX_SIZE'] || '10000');
    ttlMs = parseInt(process.env['SPECMEM_DRILLDOWN_TTL_MS'] || '1800000'); // 30 min default
    cleanupIntervalMs = parseInt(process.env['SPECMEM_DRILLDOWN_CLEANUP_INTERVAL_MS'] || '300000'); // 5 min default
    _cleanupTimer = null;
    constructor() {
        // Start periodic TTL cleanup
        this._startPeriodicCleanup();
    }
    static getInstance() {
        if (!DrilldownRegistry.instance) {
            DrilldownRegistry.instance = new DrilldownRegistry();
        }
        return DrilldownRegistry.instance;
    }
    /**
     * Start periodic cleanup timer for TTL-expired entries
     */
    _startPeriodicCleanup() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
        }
        this._cleanupTimer = setInterval(() => {
            this._expireTTLEntries();
        }, this.cleanupIntervalMs);
        // Allow the process to exit even if the timer is running
        if (this._cleanupTimer && typeof this._cleanupTimer.unref === 'function') {
            this._cleanupTimer.unref();
        }
        logger.debug({ cleanupIntervalMs: this.cleanupIntervalMs, ttlMs: this.ttlMs }, 'DrilldownRegistry periodic TTL cleanup started');
    }
    /**
     * Remove entries that have exceeded their TTL
     */
    _expireTTLEntries() {
        const now = Date.now();
        let expiredCount = 0;
        for (const [id, entry] of this.registry.entries()) {
            const lastTouched = entry.lastAccessed?.getTime() || entry.createdAt.getTime();
            if ((now - lastTouched) > this.ttlMs) {
                this.registry.delete(id);
                this.reverseRegistry.delete(entry.memoryID);
                expiredCount++;
            }
        }
        if (expiredCount > 0) {
            logger.info({ expiredCount, remaining: this.registry.size, ttlMs: this.ttlMs }, 'DrilldownRegistry TTL expiration: removed stale entries');
        }
    }
    /**
     * Stop the periodic cleanup timer (for shutdown)
     */
    shutdown() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
            logger.debug('DrilldownRegistry cleanup timer cleared on shutdown');
        }
    }
    /**
     * Register a memory and get its drilldown ID
     * Returns existing ID if already registered
     */
    register(memoryID, type = 'memory', context) {
        // Check if already registered
        const existing = this.reverseRegistry.get(memoryID);
        if (existing !== undefined) {
            const entry = this.registry.get(existing);
            if (entry) {
                // Refresh TTL on access
                entry.lastAccessed = new Date();
                entry.accessCount++;
            }
            return existing;
        }
        // Create new entry
        const drilldownID = this.nextID++;
        const entry = {
            drilldownID,
            memoryID,
            type,
            createdAt: new Date(),
            lastAccessed: new Date(),
            accessCount: 1,
            ...context
        };
        this.registry.set(drilldownID, entry);
        this.reverseRegistry.set(memoryID, drilldownID);
        // Cleanup old entries if needed (LRU eviction when over max size)
        this.cleanup();
        logger.debug({ drilldownID, memoryID, type }, 'Registered drilldown ID');
        return drilldownID;
    }
    /**
     * Get memory ID from drilldown ID (numeric or UUID short code)
     */
    resolve(drilldownID) {
        // Handle numeric IDs
        if (typeof drilldownID === 'number') {
            const entry = this.registry.get(drilldownID);
            if (entry) {
                // Refresh TTL on access (touch)
                entry.lastAccessed = new Date();
                entry.accessCount++;
                return entry;
            }
            return null;
        }
        // Handle string IDs (UUID short code like "a9efbf91")
        if (typeof drilldownID === 'string') {
            // Try parsing as number first
            const numID = parseInt(drilldownID, 10);
            if (!isNaN(numID)) {
                return this.resolve(numID);
            }
            // Search by UUID prefix
            const shortCode = drilldownID.toLowerCase().replace(/-/g, '');
            for (const [id, entry] of this.registry.entries()) {
                const memID = entry.memoryID.toLowerCase().replace(/-/g, '');
                if (memID.startsWith(shortCode) || memID.includes(shortCode)) {
                    // Refresh TTL on access (touch)
                    entry.lastAccessed = new Date();
                    entry.accessCount++;
                    return entry;
                }
            }
        }
        return null;
    }
    /**
     * Get drilldown ID for a memory ID
     */
    getID(memoryID) {
        return this.reverseRegistry.get(memoryID) ?? null;
    }
    /**
     * Batch register multiple memories
     */
    registerBatch(items, context) {
        const result = new Map();
        for (const item of items) {
            const id = this.register(item.memoryID, item.type || 'memory', context);
            result.set(item.memoryID, id);
        }
        return result;
    }
    /**
     * Cleanup old entries when registry is full (LRU eviction)
     */
    cleanup() {
        if (this.registry.size <= this.maxEntries)
            return;
        // Sort by last accessed (oldest first)
        const entries = Array.from(this.registry.entries())
            .sort((a, b) => {
            const aTime = a[1].lastAccessed?.getTime() || a[1].createdAt.getTime();
            const bTime = b[1].lastAccessed?.getTime() || b[1].createdAt.getTime();
            return aTime - bTime;
        });
        // Remove oldest 20%
        const toRemove = Math.floor(this.maxEntries * 0.2);
        for (let i = 0; i < toRemove && i < entries.length; i++) {
            const [id, entry] = entries[i];
            this.registry.delete(id);
            this.reverseRegistry.delete(entry.memoryID);
        }
        logger.info({ removed: toRemove, remaining: this.registry.size }, 'Cleaned up drilldown registry (LRU eviction)');
    }
    /**
     * Get registry stats
     */
    getStats() {
        const entries = Array.from(this.registry.values());
        const dates = entries.map(e => e.createdAt.getTime());
        return {
            totalEntries: this.registry.size,
            maxEntries: this.maxEntries,
            ttlMs: this.ttlMs,
            cleanupIntervalMs: this.cleanupIntervalMs,
            oldestEntry: dates.length > 0 ? new Date(Math.min(...dates)) : undefined,
            newestEntry: dates.length > 0 ? new Date(Math.max(...dates)) : undefined
        };
    }
    /**
     * Clear registry (for testing)
     */
    clear() {
        this.registry.clear();
        this.reverseRegistry.clear();
        this.nextID = 1;
    }
}
// Export singleton
export const drilldownRegistry = DrilldownRegistry.getInstance();
// ============================================================================
// ZOOM CONFIGURATIONS
// ============================================================================
/**
 * Predefined zoom level configurations
 */
// User feedback: "content wayyy too trimmed" - DOUBLED preview lengths
export const ZOOM_CONFIGS = {
    'ultra-wide': {
        threshold: 0.15,
        limit: 50,
        contentPreview: 200, // Was 100
        includeContext: false,
        compression: 'full'
    },
    'wide': {
        threshold: 0.25,
        limit: 25,
        contentPreview: 400, // Was 200
        includeContext: false,
        compression: 'full'
    },
    'normal': {
        threshold: 0.4,
        limit: 15,
        contentPreview: 600, // Was 350
        includeContext: true,
        compression: 'light'
    },
    'close': {
        threshold: 0.6,
        limit: 10,
        contentPreview: 800, // Was 500
        includeContext: true,
        compression: 'light'
    },
    'macro': {
        threshold: 0.8,
        limit: 5,
        contentPreview: 1500, // Was 1000
        includeContext: true,
        compression: 'none'
    }
};
/**
 * Get zoom level from threshold
 */
export function thresholdToZoomLevel(threshold) {
    if (threshold >= 0.75)
        return 'macro';
    if (threshold >= 0.55)
        return 'close';
    if (threshold >= 0.35)
        return 'normal';
    if (threshold >= 0.2)
        return 'wide';
    return 'ultra-wide';
}
/**
 * Get next zoom level (in or out)
 */
export function getNextZoom(current, direction) {
    const levels = ['ultra-wide', 'wide', 'normal', 'close', 'macro'];
    const currentIndex = levels.indexOf(current);
    if (direction === 'in') {
        return currentIndex < levels.length - 1 ? levels[currentIndex + 1] : null;
    }
    else {
        return currentIndex > 0 ? levels[currentIndex - 1] : null;
    }
}
// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================
/**
 * Format a search result as a CameraRollItem
 */
export function formatAsCameraRollItem(result, zoomConfig, context) {
    // Register in drilldown registry
    const drilldownID = drilldownRegistry.register(result.id, 'memory');
    // Extract role from tags or metadata
    const role = result.tags?.includes('role:user') ? 'user' :
        result.tags?.includes('role:assistant') ? 'assistant' :
            result.metadata?.role;
    // Truncate content based on zoom level
    let content = result.content;
    if (content.length > zoomConfig.contentPreview) {
        content = content.substring(0, zoomConfig.contentPreview) + '...';
    }
    // Apply ROUND-TRIP VERIFIED compression based on zoom level
    // User feedback: "English that couldn't be preserved stays as English"
    if (zoomConfig.compression === 'full') {
        // Full compression with round-trip verification - keeps English where Chinese loses context
        const compressed = smartCompress(content, { threshold: 0.75 });
        content = compressed.result;
    }
    else if (zoomConfig.compression === 'light') {
        const compressed = smartCompress(content, { threshold: 0.85 });
        content = compressed.result;
    }
    // Format  Response if included
    let CR;
    if (zoomConfig.includeContext && context?.claudeResponse) {
        CR = context.claudeResponse;
        if (CR.length > zoomConfig.contentPreview / 2) {
            CR = CR.substring(0, Math.floor(zoomConfig.contentPreview / 2)) + '...';
        }
        if (zoomConfig.compression === 'full') {
            // Round-trip verified - keeps English where Chinese loses context
            const compressed = smartCompress(CR, { threshold: 0.75 });
            CR = compressed.result;
        }
    }
    // CLEAN OUTPUT: Only essential fields, no bloat
    // User feedback: "too many meta tags", "123+ lines too much"
    return {
        content,
        CR,
        drilldownID,
        memoryID: result.id, // Keep for drill_down lookup
        similarity: Math.round(result.similarity * 100) / 100,
        // Simplified timestamp - just date, not full ISO
        timestamp: result.createdAt?.toISOString()?.split('T')[0] ||
            result.metadata?.timestamp?.split('T')[0],
        role
        // REMOVED: tags, hasMore, relatedCount, codePointers (bloat)
    };
}
/**
 * Format search results as CameraRollResponse - HUMAN READABLE OUTPUT
 *
 * Returns human readable format with drilldown IDs for navigation.
 * Format: [N] XX% #ID [USER] prompt [CLAUDE] response
 */
export function formatAsCameraRollResponse(results, query, zoomLevel, searchType = 'memory', totalInDB) {
    // Build header
    const lines = [];
    lines.push(`[CAMERA-ROLL]`);
    lines.push(`Query: "${query}"`);
    lines.push(`Zoom: ${zoomLevel} | Found: ${results.length}/${totalInDB ?? results.length}`);
    lines.push('');
    // Format each result as human readable line
    // Format: [N] XX% #ID [ROLE] content
    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        const simPercent = Math.round(item.similarity * 100);
        const roleTag = item.role === 'user' ? '[USER]' : item.role === 'assistant' ? '[CLAUDE]' : item.role === 'code' ? '[CODE]' : '';
        // Main line: [N] XX% #ID content
        let line = `[${i + 1}] ${simPercent}% #${item.drilldownID}`;
        if (roleTag)
            line += ` ${roleTag}`;
        line += ` ${item.content}`;
        lines.push(line);
        // If there's a  Response, add it on the next line
        if (item.CR) {
            lines.push(`    [CR] ${item.CR}`);
        }
        // TRACEBACKS: Show callers/callees for code items
        if (item.callers && item.callers.length > 0) {
            const callerNames = item.callers.slice(0, 5).map(c => c.split('/').pop() || c).join(', ');
            lines.push(`    ← Called by: ${callerNames}${item.callers.length > 5 ? ` (+${item.callers.length - 5} more)` : ''}`);
        }
        if (item.callees && item.callees.length > 0) {
            const calleeNames = item.callees.slice(0, 5).map(c => c.split('/').pop() || c).join(', ');
            lines.push(`    → Calls: ${calleeNames}${item.callees.length > 5 ? ` (+${item.callees.length - 5} more)` : ''}`);
        }
    }
    // Add hint for drill-down
    lines.push('');
    lines.push(`drill_down(ID) for full content | get_memory_by_id(ID) for quick view`);
    lines.push(`[/CAMERA-ROLL]`);
    return lines.join('\n');
}
// ============================================================================
// DRILLDOWN FUNCTIONS
// ============================================================================
/**
 * Drill down on a result - get more detail and related items
 * This is the main entry point for the drill_down(ID) function
 */
export async function performDrilldown(drilldownID, db, // DatabaseManager type
options) {
    const entry = drilldownRegistry.resolve(drilldownID);
    if (!entry) {
        logger.warn({ drilldownID }, 'Drilldown ID not found in registry');
        return null;
    }
    const memoryID = entry.memoryID;
    const includeContext = options?.includeConversationContext ?? true;
    const relatedLimit = options?.relatedLimit ?? 5;
    const codeRefLimit = options?.codeRefLimit ?? 3;
    // ZOOM LEVELS FOR CODE: 0=signature, 50=truncated, 100=full
    const zoom = options?.zoom ?? 50;
    // Calculate max content based on zoom (0-100 maps to ~200-5000 chars)
    const getMaxContentForZoom = (z) => {
        if (z <= 10) return 200;    // Signature only
        if (z <= 30) return 500;    // Very brief
        if (z <= 50) return 1500;   // Truncated (default)
        if (z <= 70) return 3000;   // More detail
        if (z <= 90) return 5000;   // Most content
        return 0;                    // 100 = no limit
    };
    const maxContent = getMaxContentForZoom(zoom);
    try {
        // HANDLE CODE TYPE DRILLDOWNS
        // memoryID format from find_code_pointers: "file_path:name" or just "file_path"
        if (entry.type === 'code') {
            logger.debug({ drilldownID, memoryID, zoom, maxContent }, '[Drilldown] Code type - parsing file path');
            // Parse memoryID - format is "file_path:functionName" or just "file_path"
            const colonIdx = memoryID.lastIndexOf(':');
            let filePath;
            let defName = null;
            if (colonIdx > 0 && !memoryID.substring(0, colonIdx).includes('/')) {
                // No colon or colon is part of path (Windows drive letter)
                filePath = memoryID;
            }
            else if (colonIdx > 0) {
                filePath = memoryID.substring(0, colonIdx);
                defName = memoryID.substring(colonIdx + 1);
            }
            else {
                filePath = memoryID;
            }
            // Helper to truncate content based on zoom
            const truncateContent = (content, max) => {
                if (!content) return '(content not available)';
                if (max === 0) return content; // No limit at zoom 100
                if (content.length <= max) return content;
                // Smart truncation: try to break at line boundaries
                const lines = content.split('\n');
                let result = '';
                for (const line of lines) {
                    if (result.length + line.length + 1 > max) break;
                    result += (result ? '\n' : '') + line;
                }
                const remaining = content.length - result.length;
                return result + `\n\n... [${remaining} more chars - use zoom:100 for full content]`;
            };
            // First try code_definitions if we have a definition name
            if (defName) {
                const defResult = await db.query(`
          SELECT id, name, qualified_name, definition_type, language, file_path,
                 start_line, end_line, content, signature, docstring, is_exported
          FROM code_definitions
          WHERE file_path = $1 AND name = $2
          LIMIT 1
        `, [filePath, defName]);
                if (defResult.rows.length > 0) {
                    const code = defResult.rows[0];
                    // At zoom 0-10: just show signature
                    // At zoom 50: show truncated content
                    // At zoom 100: show full content
                    let bodyContent;
                    if (zoom <= 10) {
                        bodyContent = code.signature || '(no signature)';
                    } else {
                        bodyContent = truncateContent(code.content, maxContent);
                    }
                    const codeContent = [
                        `[${code.definition_type?.toUpperCase() || 'CODE'}] ${code.name}`,
                        `File: ${code.file_path}:${code.start_line || 1}-${code.end_line || '?'}`,
                        `Language: ${code.language || 'unknown'}${code.is_exported ? ' (exported)' : ''}`,
                        `Zoom: ${zoom}%${zoom < 100 ? ' (use zoom:100 for full)' : ''}`,
                        '',
                        code.signature || '',
                        '',
                        bodyContent
                    ].filter(Boolean).join('\n');
                    return {
                        fullContent: codeContent,
                        fullCR: code.docstring || undefined,
                        relatedMemories: [],
                        codeReferences: [],
                        conversationContext: undefined,
                        originalTimestamp: new Date().toISOString(),
                        parentDrilldownID: undefined,
                        childDrilldownIDs: [],
                        zoom
                    };
                }
            }
            // Fallback: query codebase_files for full file content
            const fileResult = await db.query(`
        SELECT id, file_path, file_name, language_id, content, line_count
        FROM codebase_files
        WHERE file_path = $1
        LIMIT 1
      `, [filePath]);
            if (fileResult.rows.length === 0) {
                logger.warn({ filePath, memoryID }, '[Drilldown] Code file not found');
                return null;
            }
            const file = fileResult.rows[0];
            // Apply zoom-based truncation
            const fileContent = truncateContent(file.content, maxContent);
            const codeContent = [
                `[FILE] ${file.file_name}`,
                `Path: ${file.file_path}`,
                `Language: ${file.language_id || 'unknown'} | ${file.line_count || '?'} lines`,
                `Zoom: ${zoom}%${zoom < 100 ? ' (use zoom:100 for full)' : ''}`,
                '',
                fileContent
            ].join('\n');
            return {
                fullContent: codeContent,
                fullCR: undefined,
                relatedMemories: [],
                codeReferences: [],
                conversationContext: undefined,
                originalTimestamp: new Date().toISOString(),
                parentDrilldownID: undefined,
                childDrilldownIDs: [],
                zoom
            };
        }
        // MEMORY TYPE - Original logic
        // Fetch full memory content
        const memoryResult = await db.query(`
      SELECT id, content, tags, metadata, created_at, embedding
      FROM memories
      WHERE id = $1
    `, [memoryID]);
        if (memoryResult.rows.length === 0) {
            return null;
        }
        const memory = memoryResult.rows[0];
        // CRITICAL: Get the PAIRED message (user prompt for  response, or vice versa)
        // This is the most important context for any drill-down!
        let pairedMessage;
        const memoryRole = memory.metadata?.role ||
            (memory.tags?.includes('role:user') ? 'user' :
                memory.tags?.includes('role:assistant') ? 'assistant' : undefined);
        const sessionId = memory.metadata?.sessionId || memory.metadata?.session_id;
        const memoryTimestamp = memory.metadata?.timestamp || memory.created_at;
        if (sessionId && memoryRole) {
            const pairedRole = memoryRole === 'assistant' ? 'user' : 'assistant';
            const timeDirection = memoryRole === 'assistant' ? '<' : '>'; // User prompt comes BEFORE  response
            const sortOrder = memoryRole === 'assistant' ? 'DESC' : 'ASC';
            try {
                const pairedResult = await db.query(`
          SELECT id, content, tags, metadata, created_at,
                 1 - (embedding <=> $1::vector) as similarity
          FROM memories
          WHERE (metadata->>'sessionId' = $2 OR metadata->>'session_id' = $2)
            AND (metadata->>'role' = $3 OR $4 = ANY(tags))
            AND content NOT LIKE '%[Tools:%'
            AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz ${timeDirection} $5::timestamptz
          ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz ${sortOrder}
          LIMIT 1
        `, [memory.embedding, sessionId, pairedRole, `role:${pairedRole}`, memoryTimestamp]);
                if (pairedResult.rows.length > 0) {
                    const row = pairedResult.rows[0];
                    pairedMessage = formatAsCameraRollItem({
                        id: row.id,
                        content: row.content,
                        similarity: row.similarity,
                        metadata: row.metadata,
                        tags: row.tags,
                        createdAt: row.created_at
                    }, ZOOM_CONFIGS.normal);
                    logger.debug({ pairedRole, pairedId: row.id }, '[Drilldown] Found paired message');
                }
            }
            catch (e) {
                logger.debug({ error: e }, '[Drilldown] Failed to find paired message');
            }
        }
        // Get conversation context (before/after messages in same session)
        let conversationContext;
        if (includeContext) {
            if (sessionId) {
                const contextResult = await db.query(`
          SELECT id, content, tags, metadata, created_at,
                 1 - (embedding <=> $1::vector) as similarity
          FROM memories
          WHERE metadata->>'sessionId' = $2 OR metadata->>'session_id' = $2
            AND id != $3
          ORDER BY created_at
          LIMIT 10
        `, [memory.embedding, sessionId, memoryID]);
                const memoryTime = new Date(memory.created_at).getTime();
                const before = [];
                const after = [];
                for (const row of contextResult.rows) {
                    const item = formatAsCameraRollItem({
                        id: row.id,
                        content: row.content,
                        similarity: row.similarity,
                        metadata: row.metadata,
                        tags: row.tags,
                        createdAt: row.created_at
                    }, ZOOM_CONFIGS.normal);
                    if (new Date(row.created_at).getTime() < memoryTime) {
                        before.push(item);
                    }
                    else {
                        after.push(item);
                    }
                }
                conversationContext = {
                    before: before.slice(-3), // Last 3 before
                    after: after.slice(0, 3) // First 3 after
                };
            }
        }
        // Get related memories (by embedding similarity)
        const relatedResult = await db.query(`
      SELECT id, content, tags, metadata, created_at,
             1 - (embedding <=> $1::vector) as similarity
      FROM memories
      WHERE id != $2
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [memory.embedding, memoryID, relatedLimit]);
        const relatedMemories = relatedResult.rows.map((row) => formatAsCameraRollItem({
            id: row.id,
            content: row.content,
            similarity: row.similarity,
            metadata: row.metadata,
            tags: row.tags,
            createdAt: row.created_at
        }, ZOOM_CONFIGS.normal));
        // Get code references (if codebase_pointers table exists)
        let codeReferences = [];
        try {
            const codeResult = await db.query(`
        SELECT cp.file_path, cp.line_start, cp.line_end, cp.function_name,
               cf.content, cf.id
        FROM codebase_pointers cp
        LEFT JOIN codebase_files cf ON cp.file_path = cf.file_path
        WHERE cp.memory_id = $1
        LIMIT $2
      `, [memoryID, codeRefLimit]);
            codeReferences = codeResult.rows.map((row) => {
                const codeId = row.id || `code:${row.file_path}`;
                const drilldownID = drilldownRegistry.register(codeId, 'code');
                return {
                    content: row.function_name
                        ? `${row.function_name} in ${row.file_path}:${row.line_start}-${row.line_end}`
                        : `${row.file_path}:${row.line_start || 1}`,
                    drilldownID,
                    memoryID: codeId,
                    similarity: 1.0, // Direct reference
                    hasMore: true
                };
            });
        }
        catch {
            // codebase_pointers table may not exist
        }
        // Extract  Response from content if available
        let fullContent = memory.content;
        let fullCR;
        // Check if content has assistant response embedded
        if (memory.metadata?.claudeResponse) {
            fullCR = memory.metadata.claudeResponse;
        }
        // Collect child drilldown IDs from related items
        const childDrilldownIDs = [
            ...relatedMemories.map(m => m.drilldownID),
            ...codeReferences.map(c => c.drilldownID),
            ...(conversationContext?.before.map(m => m.drilldownID) || []),
            ...(conversationContext?.after.map(m => m.drilldownID) || [])
        ];
        return {
            fullContent,
            fullCR,
            // CRITICAL: Include the paired message for conversation context
            pairedMessage,
            pairedRole: memoryRole,
            conversationContext,
            relatedMemories,
            codeReferences,
            originalTimestamp: memory.created_at?.toISOString(),
            sessionID: memory.metadata?.sessionId || memory.metadata?.session_id,
            projectContext: memory.metadata?.project,
            parentDrilldownID: entry.parentID,
            childDrilldownIDs
        };
    }
    catch (error) {
        logger.error({ error, drilldownID, memoryID }, 'Failed to perform drilldown');
        throw error;
    }
}
// ============================================================================
// EXPORTS
// ============================================================================
export { DrilldownRegistry, ZOOM_CONFIGS as ZoomConfigs };
//# sourceMappingURL=CameraZoomSearch.js.map