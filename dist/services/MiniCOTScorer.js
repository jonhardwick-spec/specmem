/**
 * MiniCOTScorer - Score code-memory relevance using Mini COT
 *
 * This service calls the MiniCOTProvider to score how relevant a code pointer
 * is to a memory. It also handles user/claude attribution based on memory role.
 *
 * Data Flow:
 *   1. Receive code pointer and associated memory
 *   2. Call MiniCOTProvider to analyze relevance with COT reasoning
 *   3. Extract user/claude attribution from memory role
 *   4. Return scored result with attribution
 *
 * Attribution Types:
 *   - 'user': Code written/discussed by the user
 *   - 'assistant': Code generated/explained by Claude
 *   - 'unknown': Role not determined
 */
import { MiniCOTProvider } from '../providers/MiniCOTProvider.js';
import { logger } from '../utils/logger.js';
import { smartCompress } from '../utils/tokenCompressor.js';
import { cotStart, cotAnalyze, cotResult, cotError } from '../utils/cotBroadcast.js';
// ============================================================================
// ATTRIBUTION UTILITIES
// ============================================================================
/**
 * Extract attribution from memory metadata
 */
export function extractAttribution(memoryRole, memoryTags) {
    // Priority 1: Explicit role in metadata
    if (memoryRole === 'user') {
        return { attribution: 'user', note: '用戶提供' };
    }
    if (memoryRole === 'assistant') {
        return { attribution: 'assistant', note: 'Claude生成' };
    }
    // Priority 2: Check tags
    if (memoryTags) {
        if (memoryTags.includes('role:user')) {
            return { attribution: 'user', note: '用戶標籤' };
        }
        if (memoryTags.includes('role:assistant')) {
            return { attribution: 'assistant', note: 'Claude標籤' };
        }
        // Check for code-related tags
        if (memoryTags.includes('user-code') || memoryTags.includes('user-provided')) {
            return { attribution: 'user', note: '用戶代碼標籤' };
        }
        if (memoryTags.includes('generated') || memoryTags.includes('claude-code')) {
            return { attribution: 'assistant', note: 'Claude代碼標籤' };
        }
    }
    // Priority 3: Unknown
    return { attribution: 'unknown' };
}
/**
 * Format attribution for display in results
 */
export function formatAttribution(attribution) {
    const formats = {
        'user': '👤 用戶',
        'assistant': '🤖 Claude',
        'unknown': '❓ 未知'
    };
    return formats[attribution] || formats['unknown'];
}
// ============================================================================
// MINI COT SCORER CLASS
// ============================================================================
export class MiniCOTScorer {
    miniCOT;
    defaultVectorWeight;
    constructor(options) {
        this.miniCOT = new MiniCOTProvider(undefined, options?.timeout);
        this.defaultVectorWeight = options?.vectorWeight ?? 0.4; // 40% vector, 60% COT
    }
    /**
     * Score a batch of code pointers against a query
     * Uses Mini COT to determine semantic relevance beyond vector similarity
     */
    async scoreBatch(request) {
        const { query, codePointers, options } = request;
        const vectorWeight = options?.vectorWeight ?? this.defaultVectorWeight;
        const includeReasoning = options?.includeReasoning ?? true;
        const compressOutput = options?.compressOutput ?? true;
        logger.info({
            query,
            pointerCount: codePointers.length,
            vectorWeight
        }, '[MiniCOTScorer] Starting batch scoring');
        // Broadcast COT start to dashboard
        cotStart('mini_cot', query);
        cotAnalyze('mini_cot', `Scoring ${codePointers.length} code pointers`);
        try {
            // Prepare memories for gallery (Mini COT format)
            const memoriesForGallery = codePointers.map((pointer, idx) => ({
                id: pointer.memoryId || `code_${idx}`,
                keywords: [
                    pointer.definition_type || 'code',
                    pointer.name || '',
                    pointer.file_path.split('/').pop() || ''
                ].filter(Boolean).join(' '),
                snippet: this.buildCodeSnippet(pointer),
                role: pointer.memoryRole
            }));
            // Call Mini COT to analyze relevance
            const gallery = await this.miniCOT.createGallery(query, memoriesForGallery);
            // Map gallery results back to scored pointers
            const scoredPointers = this.mapGalleryToScored(codePointers, gallery.gallery, vectorWeight, includeReasoning, compressOutput);
            // Calculate attribution breakdown
            const attributionBreakdown = {
                user: scoredPointers.filter(p => p.attribution === 'user').length,
                assistant: scoredPointers.filter(p => p.attribution === 'assistant').length,
                unknown: scoredPointers.filter(p => p.attribution === 'unknown').length
            };
            // Calculate average COT relevance
            const avgCotRelevance = scoredPointers.reduce((sum, p) => sum + p.cotRelevance, 0) / scoredPointers.length;
            logger.info({
                query,
                scoredCount: scoredPointers.length,
                avgCotRelevance,
                attributionBreakdown
            }, '[MiniCOTScorer] Batch scoring complete');
            // Broadcast COT result to dashboard
            cotResult('mini_cot', `Scored ${scoredPointers.length} pointers, avg relevance ${Math.round(avgCotRelevance * 100)}%`, scoredPointers.length, avgCotRelevance);
            return {
                query,
                scoredPointers,
                totalScored: scoredPointers.length,
                scoringMethod: 'mini-cot',
                avgCotRelevance,
                attributionBreakdown
            };
        }
        catch (error) {
            logger.warn({ error, query }, '[MiniCOTScorer] Mini COT failed, using fallback scoring');
            cotError('mini_cot', 'Fallback to vector scoring');
            return this.fallbackScoring(query, codePointers, vectorWeight);
        }
    }
    /**
     * Score a single code pointer
     */
    async scoreOne(query, pointer) {
        const result = await this.scoreBatch({
            query,
            codePointers: [pointer]
        });
        return result.scoredPointers[0];
    }
    /**
     * Check if Mini COT service is available
     */
    async isAvailable() {
        return this.miniCOT.isAvailable();
    }
    // ============================================================================
    // PRIVATE METHODS
    // ============================================================================
    /**
     * Build code snippet for Mini COT analysis
     */
    buildCodeSnippet(pointer) {
        const parts = [];
        // Add file context
        if (pointer.file_path) {
            parts.push(`File: ${pointer.file_path}`);
        }
        // Add definition info
        if (pointer.definition_type && pointer.name) {
            parts.push(`${pointer.definition_type}: ${pointer.name}`);
        }
        // Add line range
        if (pointer.line_range) {
            parts.push(`Lines: ${pointer.line_range.start}-${pointer.line_range.end}`);
        }
        // Add content preview
        if (pointer.content_preview) {
            parts.push(`Code:\n${pointer.content_preview.substring(0, 200)}`);
        }
        // Add memory context if available
        if (pointer.memoryContent) {
            parts.push(`Context: ${pointer.memoryContent.substring(0, 100)}`);
        }
        return parts.join('\n');
    }
    /**
     * Map gallery results back to scored pointers
     */
    mapGalleryToScored(originalPointers, galleryItems, vectorWeight, includeReasoning, compressOutput) {
        // Create map of gallery items by ID
        const galleryMap = new Map();
        for (const item of galleryItems) {
            galleryMap.set(item.memory_id, item);
        }
        return originalPointers.map((pointer, idx) => {
            const id = pointer.memoryId || `code_${idx}`;
            const galleryItem = galleryMap.get(id);
            // Get COT relevance (default to vector similarity if not found)
            const cotRelevance = galleryItem?.relevance ?? pointer.similarity;
            // Calculate combined score
            const combinedScore = (pointer.similarity * vectorWeight) +
                (cotRelevance * (1 - vectorWeight));
            // Get attribution
            const { attribution, note } = extractAttribution(pointer.memoryRole, pointer.memoryTags);
            // Get COT reasoning - use ROUND-TRIP VERIFIED compression
            let cotReasoning = galleryItem?.cot || '';
            if (compressOutput && cotReasoning) {
                cotReasoning = smartCompress(cotReasoning, { threshold: 0.75 }).result;
            }
            // Build drill hint
            const drillHint = pointer.memoryId
                ? `get_memory({id: "${pointer.memoryId}"})`
                : `Read({file_path: "${pointer.file_path}"})`;
            return {
                file_path: pointer.file_path,
                name: pointer.name,
                definition_type: pointer.definition_type,
                // ROUND-TRIP VERIFIED - keeps English where Chinese loses context
                content_preview: compressOutput
                    ? smartCompress(pointer.content_preview.substring(0, 300), { threshold: 0.75 }).result
                    : pointer.content_preview,
                line_range: pointer.line_range,
                vectorSimilarity: Math.round(pointer.similarity * 100) / 100,
                cotRelevance: Math.round(cotRelevance * 100) / 100,
                cotReasoning: includeReasoning ? cotReasoning : undefined,
                combinedScore: Math.round(combinedScore * 100) / 100,
                attribution,
                attributionNote: note,
                memoryId: pointer.memoryId,
                drillHint
            };
        });
    }
    /**
     * Fallback scoring when Mini COT is unavailable
     * Uses vector similarity only with attribution extraction
     */
    fallbackScoring(query, codePointers, vectorWeight) {
        const scoredPointers = codePointers.map((pointer, idx) => {
            const { attribution, note } = extractAttribution(pointer.memoryRole, pointer.memoryTags);
            return {
                file_path: pointer.file_path,
                name: pointer.name,
                definition_type: pointer.definition_type,
                content_preview: pointer.content_preview,
                line_range: pointer.line_range,
                vectorSimilarity: Math.round(pointer.similarity * 100) / 100,
                cotRelevance: pointer.similarity, // Use vector as fallback
                cotReasoning: '(Mini COT不可用 - 使用向量相似度)',
                combinedScore: Math.round(pointer.similarity * 100) / 100,
                attribution,
                attributionNote: note,
                memoryId: pointer.memoryId,
                drillHint: pointer.memoryId
                    ? `get_memory({id: "${pointer.memoryId}"})`
                    : `Read({file_path: "${pointer.file_path}"})`
            };
        });
        return {
            query,
            scoredPointers,
            totalScored: scoredPointers.length,
            scoringMethod: 'fallback',
            avgCotRelevance: scoredPointers.reduce((sum, p) => sum + p.cotRelevance, 0) / scoredPointers.length,
            attributionBreakdown: {
                user: scoredPointers.filter(p => p.attribution === 'user').length,
                assistant: scoredPointers.filter(p => p.attribution === 'assistant').length,
                unknown: scoredPointers.filter(p => p.attribution === 'unknown').length
            }
        };
    }
}
// ============================================================================
// FACTORY & SINGLETON
// ============================================================================
let scorerInstance = null;
/**
 * Get or create the Mini COT scorer instance
 */
export function getMiniCOTScorer(options) {
    if (!scorerInstance) {
        scorerInstance = new MiniCOTScorer(options);
    }
    return scorerInstance;
}
/**
 * Reset scorer instance (for testing)
 */
export function resetMiniCOTScorer() {
    scorerInstance = null;
}
//# sourceMappingURL=MiniCOTScorer.js.map