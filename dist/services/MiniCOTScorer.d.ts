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
 *   - 'assistant': Code generated/explained by 
 *   - 'unknown': Role not determined
 */
/**
 * Code pointer with memory association
 */
export interface CodePointerWithMemory {
    file_path: string;
    name?: string;
    definition_type?: string;
    content_preview: string;
    line_range?: {
        start: number;
        end: number;
    };
    similarity: number;
    memoryId?: string;
    memoryContent?: string;
    memoryRole?: 'user' | 'assistant';
    memoryTags?: string[];
}
/**
 * Scored code pointer result
 */
export interface ScoredCodePointer {
    file_path: string;
    name?: string;
    definition_type?: string;
    content_preview: string;
    line_range?: {
        start: number;
        end: number;
    };
    vectorSimilarity: number;
    cotRelevance: number;
    cotReasoning: string;
    combinedScore: number;
    attribution: 'user' | 'assistant' | 'unknown';
    attributionNote?: string;
    memoryId?: string;
    drillHint?: string;
}
/**
 * Batch scoring request
 */
export interface BatchScoringRequest {
    query: string;
    codePointers: CodePointerWithMemory[];
    options?: {
        vectorWeight?: number;
        includeReasoning?: boolean;
        compressOutput?: boolean;
    };
}
/**
 * Batch scoring response
 */
export interface BatchScoringResponse {
    query: string;
    scoredPointers: ScoredCodePointer[];
    totalScored: number;
    scoringMethod: 'mini-cot' | 'fallback';
    avgCotRelevance: number;
    attributionBreakdown: {
        user: number;
        assistant: number;
        unknown: number;
    };
}
/**
 * Extract attribution from memory metadata
 */
export declare function extractAttribution(memoryRole?: 'user' | 'assistant', memoryTags?: string[]): {
    attribution: 'user' | 'assistant' | 'unknown';
    note?: string;
};
/**
 * Format attribution for display in results
 */
export declare function formatAttribution(attribution: 'user' | 'assistant' | 'unknown'): string;
export declare class MiniCOTScorer {
    private miniCOT;
    private defaultVectorWeight;
    constructor(options?: {
        vectorWeight?: number;
        timeout?: number;
    });
    /**
     * Score a batch of code pointers against a query
     * Uses Mini COT to determine semantic relevance beyond vector similarity
     */
    scoreBatch(request: BatchScoringRequest): Promise<BatchScoringResponse>;
    /**
     * Score a single code pointer
     */
    scoreOne(query: string, pointer: CodePointerWithMemory): Promise<ScoredCodePointer>;
    /**
     * Check if Mini COT service is available
     */
    isAvailable(): Promise<boolean>;
    /**
     * Build code snippet for Mini COT analysis
     */
    private buildCodeSnippet;
    /**
     * Map gallery results back to scored pointers
     */
    private mapGalleryToScored;
    /**
     * Fallback scoring when Mini COT is unavailable
     * Uses vector similarity only with attribution extraction
     */
    private fallbackScoring;
}
/**
 * Get or create the Mini COT scorer instance
 */
export declare function getMiniCOTScorer(options?: {
    vectorWeight?: number;
    timeout?: number;
}): MiniCOTScorer;
/**
 * Reset scorer instance (for testing)
 */
export declare function resetMiniCOTScorer(): void;
//# sourceMappingURL=MiniCOTScorer.d.ts.map