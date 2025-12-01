/**
 * contextRestorationParser.ts - Extracts individual interactions from context restorations
 *
 * Features:
 * - QOMS chunked extraction (rate limited, won't overwhelm system)
 * - Hash-based deduplication (content hash + project + role)
 * - ACK verification (confirms each insert)
 * - Auto-runs on startup via sessionWatcher integration
 * - Tags extracted memories for tracking
 *
 * INPUT: Large context restoration memory like:
 *   "This session is being continued...
 *    **User's First Request**: 'fix this bug'
 *    **Claude Response**: Fixed the bug by...
 *    **User Feedback**: 'now add tests'"
 *
 * OUTPUT: Individual memories with proper project_path, timestamps, and pairing metadata
 */
import { logger } from '../utils/logger.js';
import { qoms, Priority } from '../utils/qoms.js';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { getProjectPathForInsert, getCurrentProjectPath } from '../services/ProjectContext.js';
import { existsSync } from 'fs';
// ============================================================================
// Constants
// ============================================================================
const CHUNK_SIZE = 50; // Process 50 context restorations per chunk
const CHUNK_DELAY_MS = 100; // 100ms between chunks
const QOMS_PRIORITY = Priority.LOW; // Low priority to not block other operations
// ============================================================================
// Extraction Patterns
// ============================================================================
/**
 * Patterns to extract user prompts from context restorations
 *
 * FIX LOW-30: Added fallback patterns for varied context restoration formats
 * Primary patterns are more specific, fallbacks catch edge cases
 */
const USER_PATTERNS = [
    // PRIMARY PATTERNS - Most specific, highest confidence
    // **User's First Request**: "prompt here"
    /\*\*User'?s?\s+(?:First|Second|Third|Fourth|Fifth|Next|Final|Last)?\s*Request\*\*:\s*["'"]?([^"'"\n]{10,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // **User Feedback**: "prompt"
    /\*\*User\s+Feedback[^:]*\*\*:\s*["'"]?([^"'"\n]{5,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // **User said/asked**: "prompt"
    /\*\*User\s+(?:said|asked|requested|wanted)[^:]*\*\*:\s*["'"]?([^"'"\n]{5,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // User: "prompt" (bullet point)
    /^[-•*]\s*User:\s*["'"]?([^"'"\n]{5,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // Numbered: 1. **User**: "prompt"
    /\d+\.\s*\*\*User[^*]*\*\*:\s*["'"]?([^"'"\n]{5,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // "prompt" (after user mention context)
    /user\s+(?:message|said|asked|requested)[:\s]+["'"]([^"'"]{10,}?)["'"]/gi,
    // FIX LOW-30: FALLBACK PATTERNS - Less specific but catch edge cases
    // User prompt: content (various colon-separated formats)
    /User\s+(?:prompt|query|input|question|command)s?:\s*["'"]?([^"'"\n]{5,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // **Human**: "prompt" (alternative to User)
    /\*\*Human[^:]*\*\*:\s*["'"]?([^"'"\n]{5,}?)["'"]?(?:\s*$|\s*\n)/gim,
    // > User: quote block format
    /^>\s*User:\s*(.{5,}?)(?:\s*$|\s*\n)/gim,
    // [User] prefix format
    /\[User\]\s*:?\s*([^\[\]\n]{5,}?)(?:\s*$|\s*\n)/gim,
    // ### User heading format
    /^###?\s*User\s*(?:Message|Request)?\s*\n+([^\n#]{5,})/gim,
];
/**
 * Patterns to extract Claude responses from context restorations
 *
 * FIX LOW-30: Added fallback patterns for varied context restoration formats
 */
const CLAUDE_PATTERNS = [
    // PRIMARY PATTERNS - Most specific
    // **Claude Response**: "response"
    /\*\*Claude(?:'s)?\s+Response[^:]*\*\*:\s*([^\n]{15,})/gi,
    // **Assistant**: "response"
    /\*\*Assistant[^:]*\*\*:\s*([^\n]{15,})/gi,
    // Claude responded/replied: "response"
    /Claude\s+(?:responded|replied|said|answered)[:\s]+([^\n]{15,})/gi,
    // FIX LOW-30: FALLBACK PATTERNS - Less specific but catch edge cases
    // **AI**: or **Model**: format
    /\*\*(?:AI|Model)[^:]*\*\*:\s*([^\n]{15,})/gi,
    // [Claude] or [Assistant] prefix format
    /\[(?:Claude|Assistant)\]\s*:?\s*([^\[\]\n]{15,})/gi,
    // > Claude: quote block format
    /^>\s*(?:Claude|Assistant):\s*(.{15,}?)(?:\s*$|\s*\n)/gim,
    // ### Claude/Assistant heading format
    /^###?\s*(?:Claude|Assistant)\s*(?:Response|Reply)?\s*\n+([^\n#]{15,})/gim,
    // Claude/Assistant action descriptions
    /(?:Claude|Assistant)\s+(?:implemented|created|fixed|updated|added|modified)[:\s]+([^\n]{10,})/gi,
];
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Patterns that indicate tool calls that should NOT be stored as memories
 * NOTE: We KEEP thinking blocks - they contain valuable reasoning!
 */
const SKIP_PATTERNS = [
    /^\[Tools:/i,
    /^\[Tool:/i,
    /^\[Bash:/i,
    /^\[Read:/i,
    /^\[Grep:/i,
    /^\[Glob:/i,
    /^\[Write:/i,
    /^\[Edit:/i,
    /^\[WebFetch:/i,
    /^\[WebSearch:/i,
    /^\[TodoWrite:/i,
    /^\[NotebookEdit:/i,
    /^\[Skill:/i,
    /^\[mcp__/i, // MCP tool calls
    /^<function_calls>/i, // Raw function call blocks
    /^<invoke/i, // Raw invoke blocks
];
/**
 * Check if content should be skipped (tool calls, thinking blocks, etc.)
 */
function shouldSkipContent(content) {
    const trimmed = content.trim();
    return SKIP_PATTERNS.some(pattern => pattern.test(trimmed));
}
/**
 * Generate hash for deduplication
 *
 * FIX MED-44: Standardize deduplication key format across all entry points
 * - Removed .toLowerCase() to match sessionParser fix (MED-28)
 * - Uses same format as sessionParser.generateContentHash: role:content
 * - Includes projectPath for cross-project deduplication safety
 */
function generateContentHash(content, projectPath, role) {
    // FIX MED-44 & MED-28: Do NOT lowercase - case differences are meaningful!
    // Format: role:trimmed_content|projectPath for consistent deduplication
    const normalized = `${role}:${content.trim()}|${projectPath}`;
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
/**
 * Extract project path from context restoration content
 *
 * TIGHTENED REGEX: Patterns are more specific to avoid false positives
 * that could match partial paths or wrong directories
 *
 * FIX MED-43: Added filesystem existence validation to prevent matching incorrect paths
 */
function extractProjectPath(content) {
    // TIGHTENED: More specific patterns to avoid false matches
    // Each pattern requires the path to look like a real absolute path
    const patterns = [
        // Explicit working directory declarations - most reliable
        /Working directory:\s*(\/[^\s\n"']+)/i,
        // project_path JSON field - very specific format
        /["']?project_path["']?\s*[:=]\s*["']?(\/[^\s\n"',}]+)["']?/i,
        // "working on /path/to/project" - requires explicit context
        /working\s+(?:on|in|from)\s+(\/[^\s\n"']+)/i,
        // "cwd: /path" or "directory: /path" - explicit prefixes
        /(?:cwd|directory|project)\s*[:=]\s*["']?(\/[^\s\n"',}]+)["']?/i,
    ];
    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
            const extractedPath = match[1].trim();
            // VALIDATION: Must be absolute path with at least 2 components
            // Rejects things like "/" or "/tmp" which are too generic
            if (extractedPath.startsWith('/') &&
                extractedPath.split('/').filter(Boolean).length >= 2) {
                // FIX MED-43: Validate that the extracted path actually exists on filesystem
                // This prevents matching paths that look valid but don't exist
                try {
                    if (existsSync(extractedPath)) {
                        return extractedPath;
                    }
                    else {
                        logger.debug({
                            extractedPath,
                            pattern: pattern.source
                        }, '[MED-43] Extracted path does not exist on filesystem, skipping');
                    }
                }
                catch (err) {
                    // If we can't check (permissions, etc.), log and continue to next pattern
                    logger.debug({
                        extractedPath,
                        error: err instanceof Error ? err.message : String(err)
                    }, '[MED-43] Could not validate extracted path existence');
                }
            }
        }
    }
    return undefined;
}
/**
 * Check if extracted project path matches the current project
 *
 * PROJECT ISOLATION: Prevents processing context restorations from other projects
 */
function isProjectPathMatch(extractedPath) {
    const currentProject = getCurrentProjectPath();
    // If no path extracted, we can't verify - skip it to be safe
    if (!extractedPath) {
        return false;
    }
    // Exact match
    if (extractedPath === currentProject) {
        return true;
    }
    // Extracted is subdirectory of current project
    if (extractedPath.startsWith(currentProject + '/')) {
        return true;
    }
    // Current project is subdirectory of extracted (parent dir session)
    if (currentProject.startsWith(extractedPath + '/')) {
        return true;
    }
    return false;
}
/**
 * Check if a memory is a context restoration
 *
 * FIX LOW-30: Added fallback markers for varied context restoration formats
 */
export function isContextRestoration(content) {
    // Primary markers - most common Claude Code format
    const primaryMarkers = [
        'This session is being continued',
        'conversation is summarized below',
        'previous conversation that ran out of context',
        'Context Restore',
        'session continued from',
    ];
    // FIX LOW-30: Fallback markers for edge cases
    const fallbackMarkers = [
        'context window limit',
        'conversation history was compacted',
        'summarized conversation',
        'continued session',
        'previous context',
        'session restore',
        'restoring context',
        'context summary',
    ];
    // Check primary markers first (case-sensitive, more reliable)
    if (primaryMarkers.some(marker => content.includes(marker))) {
        return true;
    }
    // Check fallback markers (case-insensitive for broader catch)
    const lowerContent = content.toLowerCase();
    return fallbackMarkers.some(marker => lowerContent.includes(marker));
}
// ============================================================================
// Core Extraction Logic
// ============================================================================
/**
 * Parse a context restoration memory and extract individual interactions
 */
export function parseContextRestoration(memoryId, content, existingMetadata) {
    const interactions = [];
    let sequenceNumber = 0;
    // Extract project path from existing metadata FIRST (most accurate)
    // Context restorations store original project in metadata.project
    const projectPath = existingMetadata?.project // Most common - from session metadata
        || existingMetadata?.project_path // Fallback
        || extractProjectPath(content) // Extract from content text
        || '/unknown';
    logger.debug(`[ContextRestorationParser] Using project_path: ${projectPath} for memory ${memoryId}`);
    // Extract base timestamp
    const baseTimestamp = existingMetadata?.timestamp
        ? new Date(existingMetadata.timestamp)
        : new Date();
    // Track already extracted content to avoid duplicates within same restoration
    const extractedContent = new Set();
    // Extract user messages
    for (const pattern of USER_PATTERNS) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
            const userContent = match[1]?.trim();
            if (userContent && userContent.length >= 5) {
                // Skip tool calls and thinking blocks
                if (shouldSkipContent(userContent)) {
                    continue;
                }
                const contentLower = userContent.toLowerCase();
                if (!extractedContent.has(contentLower)) {
                    extractedContent.add(contentLower);
                    const timestamp = new Date(baseTimestamp.getTime() + (sequenceNumber * 2000));
                    const contentHash = generateContentHash(userContent, projectPath, 'user');
                    interactions.push({
                        content: userContent,
                        role: 'user',
                        sequenceNumber: sequenceNumber++,
                        projectPath,
                        timestamp,
                        sourceMemoryId: memoryId,
                        contentHash,
                    });
                }
            }
        }
    }
    // Extract Claude responses
    for (const pattern of CLAUDE_PATTERNS) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
            const claudeContent = match[1]?.trim();
            if (claudeContent && claudeContent.length >= 15) {
                // Skip tool calls and thinking blocks
                if (shouldSkipContent(claudeContent)) {
                    continue;
                }
                const contentLower = claudeContent.toLowerCase();
                if (!extractedContent.has(contentLower)) {
                    extractedContent.add(contentLower);
                    const timestamp = new Date(baseTimestamp.getTime() + (sequenceNumber * 2000));
                    const contentHash = generateContentHash(claudeContent, projectPath, 'assistant');
                    interactions.push({
                        content: claudeContent,
                        role: 'assistant',
                        sequenceNumber: sequenceNumber++,
                        projectPath,
                        timestamp,
                        sourceMemoryId: memoryId,
                        contentHash,
                    });
                }
            }
        }
    }
    // Sort by sequence number
    interactions.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return {
        sourceMemoryId: memoryId,
        projectPath,
        interactions,
        extractedAt: new Date(),
    };
}
// ============================================================================
// QOMS Chunked Extraction
// ============================================================================
/**
 * Process all context restoration memories with QOMS chunking and ACK verification
 *
 * IMPORTANT: Requires embeddingProvider to generate embeddings for semantic search!
 * Without embeddings, extracted memories won't be findable via find_memory.
 */
export async function extractAllContextRestorations(db, embeddingProvider, options = {}) {
    const { dryRun = false, limit = 10000, skipAlreadyProcessed = true, onProgress } = options;
    const stats = {
        processed: 0,
        extracted: 0,
        skipped: 0,
        duplicates: 0,
        errors: [],
        ackVerified: 0,
    };
    try {
        // PROJECT ISOLATION: Get current project path for filtering
        const currentProjectPath = getCurrentProjectPath();
        // Find all context restoration memories FROM CURRENT PROJECT ONLY
        // This prevents processing context restorations from other projects
        const query = `
      SELECT id, content, metadata, tags, created_at
      FROM memories
      WHERE (content LIKE '%This session is being continued%'
         OR content LIKE '%conversation is summarized below%')
      ${skipAlreadyProcessed ? "AND NOT ('context-restoration-processed' = ANY(tags))" : ''}
      AND (
        project_path = $2
        OR project_path LIKE $2 || '/%'
        OR $2 LIKE project_path || '/%'
        OR project_path IS NULL
      )
      ORDER BY created_at DESC
      LIMIT $1
    `;
        const result = await db.query(query, [limit, currentProjectPath]);
        logger.info({
            found: result.rows.length,
            currentProject: currentProjectPath
        }, '[ContextRestorationParser] Found context restorations from current project');
        if (result.rows.length === 0) {
            return stats;
        }
        // Get existing content hashes to check for duplicates
        const existingHashes = new Set();
        if (!dryRun) {
            const hashQuery = await db.query("SELECT DISTINCT metadata->>'contentHash' as content_hash FROM memories WHERE metadata->>'contentHash' IS NOT NULL");
            for (const row of hashQuery.rows) {
                if (row.content_hash)
                    existingHashes.add(row.content_hash);
            }
            logger.debug(`[ContextRestorationParser] Loaded ${existingHashes.size} existing hashes for dedup`);
        }
        // Process in chunks via QOMS
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += CHUNK_SIZE) {
            chunks.push(result.rows.slice(i, i + CHUNK_SIZE));
        }
        logger.info(`[ContextRestorationParser] Processing ${chunks.length} chunks of ${CHUNK_SIZE} each`);
        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const chunk = chunks[chunkIdx];
            // Use QOMS for rate limiting
            await qoms.enqueue(async () => {
                for (const row of chunk) {
                    stats.processed++;
                    // Parse and extract interactions
                    const extraction = parseContextRestoration(row.id, row.content, row.metadata);
                    if (extraction.interactions.length === 0) {
                        continue;
                    }
                    // PROJECT ISOLATION: Skip context restorations from other projects!
                    // This prevents cross-project pollution when multiple SpecMem instances run
                    if (!isProjectPathMatch(extraction.projectPath)) {
                        logger.debug({
                            memoryId: row.id,
                            extractedProject: extraction.projectPath,
                            currentProject: getCurrentProjectPath()
                        }, '[ContextRestorationParser] skipping context restoration from different project');
                        stats.skipped++;
                        continue;
                    }
                    for (const interaction of extraction.interactions) {
                        // Check for duplicate
                        if (existingHashes.has(interaction.contentHash)) {
                            stats.duplicates++;
                            continue;
                        }
                        if (!dryRun) {
                            try {
                                const content = `[${interaction.role.toUpperCase()}] ${interaction.content}`;
                                // Generate embedding for semantic search (CRITICAL for find_memory!)
                                const embedding = await qoms.medium(() => embeddingProvider.generateEmbedding(content));
                                // Insert with ACK verification - NOW INCLUDING EMBEDDING AND PROJECT_PATH!
                                // PROJECT ISOLATION: Get fresh project path at call time
                                const projectPath = getProjectPathForInsert();
                                const insertQuery = `
                  INSERT INTO memories (
                    id, content, memory_type, importance, tags, metadata, created_at, embedding, project_path
                  ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9
                  )
                  ON CONFLICT DO NOTHING
                  RETURNING id
                `;
                                const newId = uuidv4();
                                const tags = [
                                    `role:${interaction.role}`,
                                    'extracted-from-context-restoration',
                                    `source:${row.id.slice(0, 8)}`,
                                ];
                                const metadata = {
                                    role: interaction.role,
                                    project_path: interaction.projectPath,
                                    timestamp: interaction.timestamp?.toISOString(),
                                    timestampMs: interaction.timestamp?.getTime(),
                                    sourceMemoryId: interaction.sourceMemoryId,
                                    contentHash: interaction.contentHash,
                                    extractedAt: extraction.extractedAt.toISOString(),
                                    sequenceNumber: interaction.sequenceNumber,
                                };
                                const insertResult = await db.query(insertQuery, [
                                    newId,
                                    content,
                                    'episodic',
                                    'medium',
                                    tags,
                                    JSON.stringify(metadata),
                                    interaction.timestamp || new Date(),
                                    `[${embedding.join(',')}]`, // pgvector format
                                    projectPath
                                ]);
                                // ACK verification - check if row was actually inserted
                                if (insertResult.rowCount && insertResult.rowCount > 0) {
                                    stats.ackVerified++;
                                    existingHashes.add(interaction.contentHash); // Add to set to prevent future dupes
                                }
                                stats.extracted++;
                            }
                            catch (err) {
                                const errMsg = err instanceof Error ? err.message : String(err);
                                stats.errors.push(`Insert failed: ${errMsg}`);
                            }
                        }
                        else {
                            stats.extracted++;
                        }
                    }
                    // Mark source memory as processed (with ACK)
                    if (!dryRun) {
                        try {
                            const updateResult = await db.query(`
                UPDATE memories
                SET tags = array_append(tags, 'context-restoration-processed')
                WHERE id = $1
                  AND NOT ('context-restoration-processed' = ANY(tags))
                RETURNING id
              `, [row.id]);
                            if (updateResult.rowCount === 0) {
                                stats.skipped++;
                            }
                        }
                        catch (err) {
                            // Already processed or error - continue
                        }
                    }
                }
            }, QOMS_PRIORITY);
            // Progress callback
            if (onProgress) {
                onProgress({ ...stats });
            }
            // Small delay between chunks to not overwhelm
            if (chunkIdx < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
            }
        }
        logger.info(`[ContextRestorationParser] Complete`, {
            processed: stats.processed,
            extracted: stats.extracted,
            duplicates: stats.duplicates,
            ackVerified: stats.ackVerified,
            errors: stats.errors.length
        });
        return stats;
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        stats.errors.push(`Fatal error: ${errMsg}`);
        logger.error(`[ContextRestorationParser] Fatal error`, { error: errMsg });
        return stats;
    }
}
// ============================================================================
// Startup Integration
// ============================================================================
/**
 * Run context restoration extraction on startup
 * Called by sessionWatcher during initialization
 *
 * @param db - Database manager for queries
 * @param embeddingProvider - REQUIRED for generating embeddings so find_memory works
 */
export async function runStartupExtraction(db, embeddingProvider) {
    logger.info('[ContextRestorationParser] Running startup extraction...');
    try {
        const stats = await extractAllContextRestorations(db, embeddingProvider, {
            dryRun: false,
            limit: 5000, // Process up to 5000 on startup
            skipAlreadyProcessed: true,
            onProgress: (s) => {
                if (s.processed % 100 === 0) {
                    logger.debug(`[ContextRestorationParser] Progress: ${s.processed} processed, ${s.extracted} extracted`);
                }
            }
        });
        logger.info(`[ContextRestorationParser] Startup extraction complete`, {
            processed: stats.processed,
            extracted: stats.extracted,
            duplicates: stats.duplicates,
            ackVerified: stats.ackVerified
        });
    }
    catch (err) {
        logger.error('[ContextRestorationParser] Startup extraction failed', {
            error: err instanceof Error ? err.message : String(err)
        });
    }
}
//# sourceMappingURL=contextRestorationParser.js.map