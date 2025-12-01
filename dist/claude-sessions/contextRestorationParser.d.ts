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
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
export interface ExtractedInteraction {
    content: string;
    role: 'user' | 'assistant';
    sequenceNumber: number;
    projectPath?: string;
    timestamp?: Date;
    sourceMemoryId: string;
    contentHash: string;
}
export interface ExtractionResult {
    sourceMemoryId: string;
    projectPath: string;
    interactions: ExtractedInteraction[];
    extractedAt: Date;
}
export interface ExtractionStats {
    processed: number;
    extracted: number;
    skipped: number;
    duplicates: number;
    errors: string[];
    ackVerified: number;
}
/**
 * Check if a memory is a context restoration
 *
 * FIX LOW-30: Added fallback markers for varied context restoration formats
 */
export declare function isContextRestoration(content: string): boolean;
/**
 * Parse a context restoration memory and extract individual interactions
 */
export declare function parseContextRestoration(memoryId: string, content: string, existingMetadata?: Record<string, unknown>): ExtractionResult;
/**
 * Process all context restoration memories with QOMS chunking and ACK verification
 *
 * IMPORTANT: Requires embeddingProvider to generate embeddings for semantic search!
 * Without embeddings, extracted memories won't be findable via find_memory.
 */
export declare function extractAllContextRestorations(db: DatabaseManager, embeddingProvider: EmbeddingProvider, options?: {
    dryRun?: boolean;
    limit?: number;
    skipAlreadyProcessed?: boolean;
    onProgress?: (stats: ExtractionStats) => void;
}): Promise<ExtractionStats>;
/**
 * Run context restoration extraction on startup
 * Called by sessionWatcher during initialization
 *
 * @param db - Database manager for queries
 * @param embeddingProvider - REQUIRED for generating embeddings so find_memory works
 */
export declare function runStartupExtraction(db: DatabaseManager, embeddingProvider: EmbeddingProvider): Promise<void>;
//# sourceMappingURL=contextRestorationParser.d.ts.map