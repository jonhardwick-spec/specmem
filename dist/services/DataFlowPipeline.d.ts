/**
 * DATA FLOW PIPELINE
 *
 * Architecture:
 *   Raw Data → Embeddings → COT Drilldown → Compacted Content → Upchain
 *
 * Features:
 *   - Lightweight embeddings (pure keyword matching, no torch!)
 *   - COT drilldown for relevance analysis
 *   - Training absorption every 5m
 *   - Quick calls for on-demand processing
 *   - BackendPlus integration for violations/visitors
 */
import { EventEmitter } from 'events';
import type { Pool } from 'pg';
interface RawData {
    id?: string;
    type: 'violation' | 'visitor' | 'codebase' | 'memory';
    content: string;
    metadata?: Record<string, any>;
    priority?: number;
}
interface EmbeddedData extends RawData {
    embedding: number[];
    keywords: string[];
    dataHash: string;
}
interface COTAnalysis {
    relevance: number;
    reasoning: string;
    compactedContent: string;
    needsUpchain: boolean;
}
interface ProcessedData extends EmbeddedData {
    analysis: COTAnalysis;
    processedAt: Date;
}
export declare class DataFlowPipeline extends EventEmitter {
    private db;
    private trainingInterval;
    private lastTrainingRun;
    private processedHashes;
    constructor(db: Pool);
    /**
     * START PIPELINE
     * Initializes training absorption (every 5m)
     */
    start(): Promise<void>;
    /**
     * STOP PIPELINE
     */
    stop(): void;
    /**
     * QUICK CALL - On-demand processing
     * Used by BackendPlus for immediate violation/visitor analysis
     */
    quickCall(data: RawData): Promise<ProcessedData>;
    /**
     * TRAINING ABSORPTION
     * Every 5m, absorb new violations/visitors that haven't been trained
     */
    private runTrainingAbsorption;
    /**
     * GENERATE EMBEDDING
     * Lightweight keyword-based embedding (NO torch model!)
     */
    private generateEmbedding;
    /**
     * COT DRILLDOWN
     * Analyzes embedded data and determines relevance
     */
    private cotDrilldown;
    /**
     * EXTRACT KEYWORDS
     * Lightweight keyword extraction (no NLP models!)
     */
    private extractKeywords;
    /**
     * KEYWORDS TO VECTOR
     * Convert keywords to simple embedding vector
     */
    private keywordsToVector;
    /**
     * ANALYZE VIOLATION SEVERITY
     */
    private analyzeViolationSeverity;
    /**
     * ANALYZE VISITOR SUSPICION
     */
    private analyzeVisitorSuspicion;
    /**
     * COMPACT CONTENT
     * Extract and compress key information
     */
    private compactContent;
    /**
     * GET UNPROCESSED DATA
     * Fetch violations/visitors that haven't been trained since last run
     */
    private getUnprocessedData;
    /**
     * STORE PROCESSED DATA
     */
    private storeProcessed;
    /**
     * GET CACHED ANALYSIS
     */
    private getCachedAnalysis;
}
export {};
//# sourceMappingURL=DataFlowPipeline.d.ts.map