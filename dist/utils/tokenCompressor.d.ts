/**
 * tokenCompressor.ts - Token Conservative Communicator (Chinese Compactor)
 *
 * Compresses text to Traditional Chinese to save tokens while preserving semantics.
 * Uses ROUND-TRIP TRANSLATION VERIFICATION to ensure meaning is preserved.
 *
 * Why Traditional Chinese?
 * - CJK characters encode more semantic info per token
 * -  understands Chinese natively
 * - ~40-60% token reduction for English text
 *
 * ROUND-TRIP VERIFICATION ALGORITHM:
 * 1. Take English text input
 * 2. Convert to Traditional Chinese (forward translation)
 * 3. Convert back to English (round-trip translation)
 * 4. Compare original English vs round-trip English
 * 5. For each sentence/segment:
 *    - If context is PRESERVED after round-trip: keep as Traditional Chinese (saves tokens!)
 *    - If context is LOST after round-trip: keep original English (preserves meaning)
 * 6. Output hybrid text: Chinese where safe, English where necessary
 *
 * This ensures:
 * - Maximum token efficiency where translation is reliable
 * - Zero context loss for technical/domain-specific content
 * - Automatic detection of untranslatable content
 *
 * Configuration via environment variables:
 * - SPECMEM_COMPRESSION_ENABLED: Enable/disable compression (default: true)
 * - SPECMEM_COMPRESSION_MIN_LENGTH: Minimum text length to compress (default: 50)
 * - SPECMEM_COMPRESSION_THRESHOLD: Similarity threshold (default: 0.80)
 * - SPECMEM_COMPRESS_SEARCH: Compress search results (default: true)
 * - SPECMEM_COMPRESS_SYSTEM: Compress system output (default: true)
 * - SPECMEM_COMPRESS_HOOKS: Compress hook outputs (default: true)
 */
import { CompressionConfig } from '../config.js';
/**
 * Cache entry for verified translations
 * Stores both forward and round-trip results with confidence scores
 */
interface TranslationCacheEntry {
    original: string;
    chinese: string;
    roundTrip: string;
    confidence: number;
    preserved: boolean;
    timestamp: number;
    hitCount: number;
}
/**
 * Generate a simple hash for cache key
 */
declare function hashString(str: string): string;
/**
 * Get cached translation if available and not expired
 */
declare function getCachedTranslation(original: string): TranslationCacheEntry | null;
/**
 * Cache a translation result
 */
declare function cacheTranslation(entry: Omit<TranslationCacheEntry, 'timestamp' | 'hitCount'>): void;
/**
 * Get cache statistics
 */
export declare function getTranslationCacheStats(): {
    size: number;
    maxSize: number;
    totalHits: number;
    preservedCount: number;
    lostCount: number;
};
/**
 * Clear the translation cache
 */
export declare function clearTranslationCache(): void;
/**
 * Confidence score breakdown for a translation
 */
export interface TranslationConfidence {
    overall: number;
    lexicalSimilarity: number;
    semanticScore: number;
    technicalTermScore: number;
    structuralScore: number;
    details: string[];
}
/**
 * Compute detailed confidence score for a round-trip translation
 */
declare function computeTranslationConfidence(original: string, roundTrip: string): TranslationConfidence;
/**
 * Compute n-gram similarity between two strings
 */
declare function computeNGramSimilarity(s1: string, s2: string, n: number): number;
/**
 * Check how well technical terms are preserved through round-trip
 */
declare function computeTechnicalTermPreservation(original: string, roundTrip: string): number;
/**
 * Compute structural similarity (length, punctuation patterns)
 */
declare function computeStructuralSimilarity(s1: string, s2: string): number;
declare function computeSimilarity(original: string, roundTrip: string): number;
/**
 * IMPROVED: Per-word round-trip compression
 *
 * Strategy:
 * 1. Try to translate each English word to Traditional Chinese
 * 2. Translate it back to English (round-trip)
 * 3. If the word survives (same or similar) -> keep Chinese
 * 4. If the word gets corrupted -> keep original English
 *
 * Result: Hybrid mix where only "safe" words are compressed
 */
export declare function smartWordByWordCompress(text: string, options?: {
    threshold?: number;
    minWordLength?: number;
}): {
    result: string;
    compressionRatio: number;
    wordsCompressed: number;
    wordsPreserved: number;
};
/**
 * Compress text to Traditional Chinese
 * Preserves code blocks, URLs, and technical identifiers
 */
export declare function compressToTraditionalChinese(text: string): string;
/**
 * Decompress Traditional Chinese back to English
 */
export declare function decompressFromTraditionalChinese(text: string): string;
/**
 * Test if compression preserves semantic meaning using round-trip verification
 * Returns detailed confidence analysis
 *
 * ROUND-TRIP VERIFICATION:
 * 1. English -> Traditional Chinese (forward)
 * 2. Traditional Chinese -> English (reverse)
 * 3. Compare original vs round-trip
 * 4. If context preserved: use Chinese (saves tokens)
 * 5. If context lost: keep English (preserves meaning)
 */
export declare function testSemanticPreservation(original: string, options?: {
    threshold?: number;
    useCache?: boolean;
}): {
    compressed: string;
    roundTrip: string;
    similarity: number;
    preserved: boolean;
    confidence: TranslationConfidence;
    cached: boolean;
};
/**
 * Segment-level decision result
 */
export interface SegmentDecision {
    original: string;
    output: string;
    usedChinese: boolean;
    confidence: number;
    reason: string;
}
/**
 * ROUND-TRIP VERIFIED SMART COMPRESSION
 *
 * This is the main compression function using round-trip verification.
 *
 * Algorithm:
 * 1. Split text into segments (sentences/chunks)
 * 2. For each segment:
 *    a. Translate to Traditional Chinese
 *    b. Translate back to English (round-trip)
 *    c. Compare original vs round-trip using confidence scoring
 *    d. If context PRESERVED: use Chinese (saves tokens!)
 *    e. If context LOST: keep original English (preserves meaning)
 * 3. Output hybrid text: Chinese where safe, English where necessary
 *
 * Example:
 *   Input: "The React component uses useState hook for state management"
 *   Chinese: "React 組件使用 useState 鉤子進行狀態管理"
 *   Round-trip: "React component uses useState hook for state management"
 *   Result: Context preserved! -> Use Chinese version
 *
 *   Input: "The QQMS proactively throttles at 20% CPU"
 *   Chinese: "QQMS 在 20% CPU 時主動節流"
 *   Round-trip: "QQMS actively saves at 20% CPU"
 *   Result: Context LOST ("throttles" != "saves") -> Keep English
 */
export declare function smartCompress(text: string, options?: {
    threshold?: number;
    minLength?: number;
    preserveCodeBlocks?: boolean;
    verbose?: boolean;
}): {
    result: string;
    compressionRatio: number;
    wasCompressed: boolean;
    segmentDecisions?: SegmentDecision[];
    stats?: {
        totalSegments: number;
        compressedSegments: number;
        preservedSegments: number;
        cacheHits: number;
        avgConfidence: number;
    };
};
/**
 * Split text into segments for compression
 * Uses smart boundary detection (sentences, line breaks, clause boundaries)
 */
declare function splitIntoSegments(text: string): string[];
/**
 * Check if a chunk is mostly code-like content that shouldn't be translated
 */
declare function isCodeLikeChunk(chunk: string): boolean;
/**
 * Compress memory content for hook output
 * Designed for specmem context injection
 */
export declare function compressMemoryContext(memories: Array<{
    content: string;
    similarity?: number;
    id?: string;
}>): string;
/**
 * HYBRID COMPRESSION WITH ROUND-TRIP VERIFICATION
 *
 * This is the recommended high-level API for compression.
 * It produces a hybrid output: Chinese where translation is verified safe,
 * English where context would be lost.
 *
 * Features:
 * - Segment-level round-trip verification
 * - Confidence scoring with weighted metrics
 * - Translation cache for performance
 * - Detailed decision logging for debugging
 *
 * @param text - Input English text
 * @param options - Compression options
 * @returns Hybrid compressed text with detailed stats
 */
export declare function hybridRoundTripCompress(text: string, options?: {
    threshold?: number;
    verbose?: boolean;
    minSegmentLength?: number;
}): {
    result: string;
    stats: {
        inputLength: number;
        outputLength: number;
        compressionRatio: number;
        segmentsTotal: number;
        segmentsCompressed: number;
        segmentsPreserved: number;
        cacheHitRate: number;
        averageConfidence: number;
    };
    decisions?: SegmentDecision[];
};
/**
 * Analyze a text for translation quality WITHOUT actually compressing
 * Useful for debugging and tuning compression thresholds
 */
export declare function analyzeTranslationQuality(text: string): {
    segments: Array<{
        text: string;
        chinese: string;
        roundTrip: string;
        confidence: TranslationConfidence;
        recommendation: 'compress' | 'preserve';
    }>;
    summary: {
        totalSegments: number;
        recommendCompression: number;
        recommendPreservation: number;
        avgConfidence: number;
        potentialSavings: number;
    };
};
/**
 * Demo function showing round-trip verification in action
 * Useful for understanding how the algorithm works
 */
export declare function demonstrateRoundTrip(examples?: string[]): void;
export declare const _internal: {
    computeSimilarity: typeof computeSimilarity;
    computeTranslationConfidence: typeof computeTranslationConfidence;
    computeNGramSimilarity: typeof computeNGramSimilarity;
    computeTechnicalTermPreservation: typeof computeTechnicalTermPreservation;
    computeStructuralSimilarity: typeof computeStructuralSimilarity;
    splitIntoSegments: typeof splitIntoSegments;
    isCodeLikeChunk: typeof isCodeLikeChunk;
    getCachedTranslation: typeof getCachedTranslation;
    cacheTranslation: typeof cacheTranslation;
    hashString: typeof hashString;
    TECHNICAL_TERMS: Record<string, string>;
    REVERSE_TERMS: Record<string, string>;
};
/**
 * Check if compression should be applied based on config
 */
export declare function shouldCompress(text: string, context?: 'search' | 'system' | 'hook'): boolean;
/**
 * Compress text if config allows, otherwise return original
 * This is the main entry point for compression
 */
export declare function compactIfEnabled(text: string, context?: 'search' | 'system' | 'hook'): {
    result: string;
    compressed: boolean;
    ratio: number;
};
/**
 * Compress MCP tool response for token efficiency
 * Handles both string and object responses
 */
export declare function compressMCPResponse<T>(response: T, context?: 'search' | 'system' | 'hook'): T;
/**
 * Format compressed output with metadata indicator
 * Shows [ZH] prefix when content is compressed
 */
export declare function formatCompressedOutput(text: string, context?: 'search' | 'system' | 'hook'): string;
/**
 * Get current compression statistics
 */
export declare function getCompressionStats(): {
    enabled: boolean;
    config: CompressionConfig;
    termCount: number;
};
export {};
//# sourceMappingURL=tokenCompressor.d.ts.map