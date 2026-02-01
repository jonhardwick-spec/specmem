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
/**
 * Zoom levels for camera roll style search
 */
export type ZoomLevel = 'ultra-wide' | 'wide' | 'normal' | 'close' | 'macro';
/**
 * Zoom level configuration
 */
export interface ZoomConfig {
    threshold: number;
    limit: number;
    contentPreview: number;
    includeContext: boolean;
    compression: 'none' | 'light' | 'full';
}
/**
 * Camera roll result item - CLEAN format (minimal metadata)
 * User feedback: "too many meta tags", "123+ lines too much"
 */
export interface CameraRollItem {
    content: string;
    CR?: string;
    drilldownID: number;
    memoryID: string;
    similarity: number;
    timestamp?: string;
    role?: 'user' | 'assistant';
}
/**
 * Camera roll response - CLEAN format (minimal top-level)
 * User feedback: reduce metadata bloat
 */
export interface CameraRollResponse {
    _HINT: string;
    items: CameraRollItem[];
    totalFound: number;
    query: string;
    searchType: 'memory' | 'code' | 'hybrid';
}
/**
 * Drilldown result - what you get when drilling down on a result
 */
export interface DrilldownResult {
    fullContent: string;
    fullCR?: string;
    pairedMessage?: CameraRollItem;
    pairedRole?: 'user' | 'assistant';
    conversationContext?: {
        before: CameraRollItem[];
        after: CameraRollItem[];
    };
    relatedMemories: CameraRollItem[];
    codeReferences: CameraRollItem[];
    originalTimestamp: string;
    sessionID?: string;
    projectContext?: string;
    parentDrilldownID?: number;
    childDrilldownIDs: number[];
}
/**
 * Registry entry for drilldown IDs
 */
interface DrilldownEntry {
    drilldownID: number;
    memoryID: string;
    type: 'memory' | 'code' | 'context';
    createdAt: Date;
    lastAccessed?: Date;
    accessCount: number;
    parentID?: number;
    searchQuery?: string;
    zoomLevel?: ZoomLevel;
}
/**
 * DrilldownRegistry - Maps simple numeric IDs to memory UUIDs
 *
 * This allows  to use simple drill_down(123) calls instead of
 * drill_down("550e8400-e29b-41d4-a716-446655440000")
 */
declare class DrilldownRegistry {
    private static instance;
    private registry;
    private reverseRegistry;
    private nextID;
    private maxEntries;
    private constructor();
    static getInstance(): DrilldownRegistry;
    /**
     * Register a memory and get its drilldown ID
     * Returns existing ID if already registered
     */
    register(memoryID: string, type?: 'memory' | 'code' | 'context', context?: {
        parentID?: number;
        searchQuery?: string;
        zoomLevel?: ZoomLevel;
    }): number;
    /**
     * Get memory ID from drilldown ID
     */
    resolve(drilldownID: number): DrilldownEntry | null;
    /**
     * Get drilldown ID for a memory ID
     */
    getID(memoryID: string): number | null;
    /**
     * Batch register multiple memories
     */
    registerBatch(items: Array<{
        memoryID: string;
        type?: 'memory' | 'code' | 'context';
    }>, context?: {
        searchQuery?: string;
        zoomLevel?: ZoomLevel;
    }): Map<string, number>;
    /**
     * Cleanup old entries when registry is full
     */
    private cleanup;
    /**
     * Get registry stats
     */
    getStats(): {
        totalEntries: number;
        oldestEntry?: Date;
        newestEntry?: Date;
    };
    /**
     * Clear registry (for testing)
     */
    clear(): void;
}
export declare const drilldownRegistry: DrilldownRegistry;
/**
 * Predefined zoom level configurations
 */
export declare const ZOOM_CONFIGS: Record<ZoomLevel, ZoomConfig>;
/**
 * Get zoom level from threshold
 */
export declare function thresholdToZoomLevel(threshold: number): ZoomLevel;
/**
 * Get next zoom level (in or out)
 */
export declare function getNextZoom(current: ZoomLevel, direction: 'in' | 'out'): ZoomLevel | null;
/**
 * Format a search result as a CameraRollItem
 */
export declare function formatAsCameraRollItem(result: {
    id: string;
    content: string;
    similarity: number;
    metadata?: Record<string, unknown>;
    tags?: string[];
    createdAt?: Date;
}, zoomConfig: ZoomConfig, context?: {
    claudeResponse?: string;
    relatedCount?: number;
    codePointers?: number;
}): CameraRollItem;
/**
 * Format search results as CameraRollResponse - HUMAN READABLE OUTPUT
 *
 * Returns human readable format with drilldown IDs for navigation.
 * Format: [N] XX% #ID [USER] prompt [CLAUDE] response
 */
export declare function formatAsCameraRollResponse(results: CameraRollItem[], query: string, zoomLevel: ZoomLevel, searchType?: 'memory' | 'code' | 'hybrid', totalInDB?: number): string;
/**
 * Drill down on a result - get more detail and related items
 * This is the main entry point for the drill_down(ID) function
 */
export declare function performDrilldown(drilldownID: number, db: any, // DatabaseManager type
options?: {
    includeConversationContext?: boolean;
    relatedLimit?: number;
    codeRefLimit?: number;
}): Promise<DrilldownResult | null>;
export { DrilldownRegistry, ZOOM_CONFIGS as ZoomConfigs };
//# sourceMappingURL=CameraZoomSearch.d.ts.map