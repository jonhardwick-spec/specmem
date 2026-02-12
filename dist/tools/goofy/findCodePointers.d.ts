/**
 * findCodePointers - semantic code search with tracebacks
 *
 * Searches codebase using embeddings to find code by meaning
 * Shows tracebacks: who imports/calls this code
 * Uses gallery mode with Mini COT for analysis
 *
 * Usage:
 *   find_code_pointers({ query: "admin login authentication" })
 *   find_code_pointers({ query: "database connection", galleryMode: true })
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { EmbeddingProvider } from '../../types/index.js';
interface CodeSearchParams {
    query: string;
    limit?: number;
    threshold?: number;
    language?: string;
    filePattern?: string;
    definitionTypes?: string[];
    includeTracebacks?: boolean;
    galleryMode?: boolean | 'ask';
    maxContentLength?: number;
    summarize?: boolean;
    zoom?: number;
    useCotScoring?: boolean;
    includeAttribution?: boolean;
    includeMemoryLinks?: boolean;
    keywordFallback?: boolean;
    includeRecent?: number;
}
interface CodeDependency {
    source_file_path: string;
    target_path: string;
    import_type: string;
    imported_names: string[];
    line_number: number;
}
interface CodeSearchResult {
    type: 'file' | 'definition';
    file_path: string;
    name?: string;
    definition_type?: string;
    content_preview: string;
    similarity: number;
    line_range?: {
        start: number;
        end: number;
    };
    callers?: CodeDependency[];
    callees?: CodeDependency[];
    cotRelevance?: number;
    cotReasoning?: string;
    combinedScore?: number;
    attribution?: 'user' | 'assistant' | 'unknown';
    attributionNote?: string;
    memoryId?: string;
}
interface PointerSearchResponse {
    results: CodeSearchResult[];
    query?: string;
    total_found?: number;
    total?: number;
    search_type?: 'semantic';
    zoom?: string;
    attribution?: string;
    _contextHint?: string;
    _REMINDER?: string;
    [key: string]: any;
}
/**
 * DependencyNode - represents a single node in the dependency tree
 * Each node is a file/module with its relationship to the root
 */
export interface DependencyNode {
    filePath: string;
    name?: string;
    definitionType?: string;
    depth: number;
    direction: 'caller' | 'callee' | 'root';
    importType?: string;
    importedNames?: string[];
    lineNumber?: number;
    children: DependencyNode[];
}
/**
 * DependencyTree - the complete dependency tree structure
 * Contains the root node and metadata about the tree
 */
export interface DependencyTree {
    root: DependencyNode;
    totalNodes: number;
    maxDepth: number;
    callerCount: number;
    calleeCount: number;
}
/**
 * TraceCodeParams - parameters for the traceCode() method
 */
export interface TraceCodeParams {
    filePath: string;
    definitionName?: string;
    maxDepth?: number;
    direction?: 'callers' | 'callees' | 'both';
    includeExternal?: boolean;
}
/**
 * TraceCodeResult - the result of traceCode() including the tree and analysis
 */
export interface TraceCodeResult {
    tree: DependencyTree;
    flatCallers: string[];
    flatCallees: string[];
    impactScore: number;
    circularDependencies: string[][];
    hotspots: string[];
    _hint: string;
}
export declare class FindCodePointers implements MCPTool<CodeSearchParams, PointerSearchResponse | string> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            threshold: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            language: {
                type: string;
                description: string;
            };
            filePattern: {
                type: string;
                description: string;
            };
            definitionTypes: {
                type: string;
                items: {
                    type: string;
                    enum: string[];
                };
                description: string;
            };
            includeTracebacks: {
                type: string;
                default: boolean;
                description: string;
            };
            galleryMode: {
                oneOf: ({
                    type: string;
                    enum?: undefined;
                } | {
                    type: string;
                    enum: string[];
                })[];
                default: boolean;
                description: string;
            };
            maxContentLength: {
                type: string;
                default: number;
                description: string;
            };
            summarize: {
                type: string;
                default: boolean;
                description: string;
            };
            zoom: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            zoomLevel: {
                type: string;
                enum: string[];
                description: string;
            };
            cameraRollMode: {
                type: string;
                default: boolean;
                description: string;
            };
            useCotScoring: {
                type: string;
                default: boolean;
                description: string;
            };
            includeAttribution: {
                type: string;
                default: boolean;
                description: string;
            };
            includeMemoryLinks: {
                type: string;
                default: boolean;
                description: string;
            };
            keywordFallback: {
                type: string;
                default: boolean;
                description: string;
            };
            includeRecent: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            projectPath: {
                type: string;
                description: string;
            };
            allProjects: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: any[];
    };
    private dimensionService;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    /**
     * Get DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Get project path for queries - supports cross-project search
     * Returns null if allProjects=true (skip project filtering)
     */
    private getTargetProject;
    /**
     * Build project condition for SQL queries
     * Returns empty string if searching all projects
     */
    private buildProjectClause;
    /**
     * Validate and prepare embedding for search
     */
    private prepareEmbedding;
    execute(params: CodeSearchParams): Promise<PointerSearchResponse>;
    private searchFiles;
    private searchDefinitions;
    /**
     * Add traceback information to results
     * @param results - Code search results to enrich
     * @param depth - Traceback depth config from zoomToTracebackDepth()
     *               If not provided, uses default (3 callers, 3 callees)
     */
    private addTracebacks;
    /**
     * I5 FIX: Keyword fallback search for code files
     * When embeddings return nothing, do ILIKE search on file paths and content
     */
    private keywordSearchFiles;
    /**
     * I5 FIX: Get recently modified code files
     */
    private getRecentCodeFiles;
    /**
     * I5 FIX: Merge and dedupe code search results
     */
    private mergeCodeResults;
    /**
     * Remove duplicate results by file name, keeping the shortest path (canonical version)
     * This handles cases where the same file is indexed from multiple paths:
     * - src/db/foo.ts (canonical - shortest)
     * - mcp/specmem/src/db/foo.ts (duplicate - longer path)
     * - mcp/specmem/backup/src/db/foo.ts (duplicate - even longer)
     */
    private dedupeResults;
    /**
     * Calculate content length from zoom parameter (0-100)
     *
     * Zoom 0 = signature only (100 chars)
     * Zoom 25 = minimal (300 chars)
     * Zoom 50 = balanced (800 chars) - default
     * Zoom 75 = detailed (1500 chars)
     * Zoom 100 = full context (unlimited)
     *
     * User asked for MORE content, not less - so we're generous here.
     */
    private zoomToContentLength;
    /**
     * Check if zoom level is low enough to show signature only
     * Signature-only mode kicks in at zoom < 20
     */
    private isSignatureOnlyZoom;
    /**
     * Convert numeric zoom (0-100) to descriptive label
     */
    private getZoomLabel;
    /**
     * Convert zoom level to traceback depth configuration
     *
     * Camera Roll / Gallery Mode traceback control:
     * - zoom 0-25: NO tracebacks (signature only view)
     * - zoom 25-50: minimal tracebacks (1 caller, 1 callee)
     * - zoom 50-75: summary tracebacks (3 callers, 3 callees)
     * - zoom 75-100: FULL tracebacks (all callers, all callees)
     *
     * @returns { include: boolean, maxCallers: number, maxCallees: number }
     */
    private zoomToTracebackDepth;
    private fileToResult;
    private definitionToResult;
    private returnModeOptions;
    private processGalleryMode;
    private generateDrilldown;
    /**
     * Apply Mini COT scoring and/or attribution to code search results
     *
     * This method:
     * 1. Calls MiniCOTScorer to score code-memory relevance (if useCotScoring=true)
     * 2. Extracts user/claude attribution based on memory role (if includeAttribution=true)
     * 3. Returns enriched results with scoring and attribution fields
     */
    private applyCotScoringAndAttribution;
    /**
     * Fast path for attribution-only (no COT scoring)
     * Uses extractAttribution utility to determine user/claude attribution
     */
    private applyAttributionOnly;
    /**
     * Look up memory information for a code pointer
     * Used to get role/tags for attribution
     */
    private lookupMemoryInfo;
    /**
     * traceCode - Build a full dependency tree for a given file
     *
     * Performs recursive caller/callee lookup to map out the complete
     * dependency graph for understanding code impact and relationships.
     *
     * @param params - TraceCodeParams with filePath, maxDepth, direction
     * @returns TraceCodeResult with tree, flat lists, and analysis
     */
    traceCode(params: TraceCodeParams): Promise<TraceCodeResult>;
}
export {};
//# sourceMappingURL=findCodePointers.d.ts.map