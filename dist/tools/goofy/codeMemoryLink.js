/**
 * Code-Memory Link Service
 *
 * Correlates code search results with related memories from the codebase_pointers table.
 * Adds attribution based on memory role:
 * - 'requested_by_user': User explicitly asked for this feature/code
 * - 'implemented_by_assistant': AI assistant created/modified this code
 * - 'discussed': Code was discussed but not explicitly requested
 *
 * This module is used by findCodePointers to enrich code search results with
 * context about WHY the code exists and WHO initiated it.
 */
import { logger } from '../../utils/logger.js';
import { extractAttribution } from '../../services/MiniCOTScorer.js';
import { getCurrentProjectPath } from '../../services/ProjectContext.js';
// ============================================================================
// CODE-MEMORY LINK SERVICE
// ============================================================================
/**
 * CodeMemoryLinkService
 *
 * Correlates code with related memories and adds attribution
 */
export class CodeMemoryLinkService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Add related memory links to code results
     * Queries codebase_pointers to find memories that reference each code file
     * Adds attribution based on memory role (user/assistant)
     */
    async addMemoryLinks(results) {
        const filePaths = [...new Set(results.map(r => r.file_path))];
        if (filePaths.length === 0)
            return;
        try {
            // Query codebase_pointers to find memories that reference these files
            // Join with memories table to get role for attribution
            const correlationQuery = `
        SELECT
          cp.file_path,
          cp.memory_id,
          cp.pointer_type,
          cp.start_line,
          cp.end_line,
          m.content,
          m.metadata->>'role' as role,
          m.tags,
          m.created_at,
          CASE
            WHEN m.embedding IS NOT NULL AND cp.embedding IS NOT NULL
            THEN 1 - (m.embedding <=> cp.embedding)
            ELSE 0.5
          END as memory_similarity
        FROM codebase_pointers cp
        JOIN memories m ON cp.memory_id = m.id
        WHERE cp.file_path = ANY($1::text[])
        ORDER BY memory_similarity DESC
        LIMIT 50
      `;
            const linkResult = await this.db.query(correlationQuery, [filePaths]);
            // Group by file_path, keep best match per file
            const memoryMap = new Map();
            for (const row of linkResult.rows) {
                const key = row.file_path;
                // Keep the best (highest similarity) memory for each file
                if (!memoryMap.has(key) || row.memory_similarity > memoryMap.get(key).memory_similarity) {
                    memoryMap.set(key, row);
                }
            }
            // Attach to results with attribution
            for (const result of results) {
                const memoryLink = memoryMap.get(result.file_path);
                if (memoryLink) {
                    // Extract attribution using MiniCOTScorer utility
                    const { attribution, note } = extractAttribution(memoryLink.role || undefined, memoryLink.tags || undefined);
                    // Add to result
                    result.memoryId = memoryLink.memory_id;
                    result.attribution = attribution;
                    result.attributionNote = note || this.getDefaultAttributionNote(attribution);
                }
            }
            logger.info({
                fileCount: filePaths.length,
                linkedCount: memoryMap.size
            }, '[CodeMemoryLink] Code-memory links added');
        }
        catch (error) {
            // Log but don't fail - memory links are optional enhancement
            logger.warn({ error }, '[CodeMemoryLink] Failed to get memory links (table may not exist)');
        }
    }
    /**
     * Get default attribution note based on role
     */
    getDefaultAttributionNote(attribution) {
        switch (attribution) {
            case 'user':
                return 'requested by user';
            case 'assistant':
                return 'implemented by assistant';
            default:
                return 'discussed';
        }
    }
    /**
     * Find memories related to a specific code file
     * Returns detailed memory information for drill-down
     */
    async findRelatedMemories(filePath, limit = 5) {
        try {
            const query = `
        SELECT
          m.id,
          m.content,
          m.metadata->>'role' as role,
          m.tags,
          m.created_at,
          CASE
            WHEN m.embedding IS NOT NULL AND cp.embedding IS NOT NULL
            THEN 1 - (m.embedding <=> cp.embedding)
            ELSE 0.5
          END as similarity
        FROM codebase_pointers cp
        JOIN memories m ON cp.memory_id = m.id
        WHERE cp.file_path = $1
        ORDER BY similarity DESC
        LIMIT $2
      `;
            const result = await this.db.query(query, [filePath, limit]);
            return result.rows.map(row => {
                const { attribution } = extractAttribution(row.role || undefined, row.tags || undefined);
                // Map to our attribution type
                let codeAttribution;
                if (attribution === 'user') {
                    codeAttribution = 'requested_by_user';
                }
                else if (attribution === 'assistant') {
                    codeAttribution = 'implemented_by_assistant';
                }
                else {
                    codeAttribution = 'discussed';
                }
                return {
                    id: row.id,
                    content_preview: row.content.substring(0, 200) + (row.content.length > 200 ? '...' : ''),
                    attribution: codeAttribution,
                    similarity: Math.round(row.similarity * 100) / 100,
                    timestamp: row.created_at
                };
            });
        }
        catch (error) {
            logger.warn({ error, filePath }, '[CodeMemoryLink] Failed to find related memories');
            return [];
        }
    }
    /**
     * Format attribution for human-readable display
     */
    static formatAttribution(attribution) {
        const formats = {
            'requested_by_user': 'Requested by user',
            'implemented_by_assistant': 'Implemented by assistant',
            'discussed': 'Discussed in conversation'
        };
        return formats[attribution] || 'Unknown origin';
    }
    /**
     * Format attribution with emoji for compact display
     */
    static formatAttributionCompact(attribution) {
        const formats = {
            'requested_by_user': 'user-req',
            'implemented_by_assistant': 'ai-impl',
            'discussed': 'discussed'
        };
        return formats[attribution] || 'unknown';
    }
}
// ============================================================================
// FACTORY
// ============================================================================
// Per-project instance management (Map pattern for project isolation)
// SCHEMA ISOLATION FIX: Previous global singleton caused cross-project pollution
const servicesByProject = new Map();
/**
 * Get or create the CodeMemoryLinkService instance for the current project
 */
export function getCodeMemoryLinkService(db, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    if (!servicesByProject.has(targetProject)) {
        servicesByProject.set(targetProject, new CodeMemoryLinkService(db));
        logger.debug({ projectPath: targetProject }, 'created new CodeMemoryLinkService for project');
    }
    return servicesByProject.get(targetProject);
}
/**
 * Reset service instance (for testing)
 */
export function resetCodeMemoryLinkService(projectPath) {
    if (projectPath) {
        servicesByProject.delete(projectPath);
    }
    else {
        // Reset all if no project specified (for testing)
        servicesByProject.clear();
    }
}
//# sourceMappingURL=codeMemoryLink.js.map