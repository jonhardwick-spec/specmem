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
import { logger } from '../../utils/logger.js';
import { getEmbeddingSocketPath, getSocketSearchInfo } from '../../config.js';
import { getEmbeddingTimeout } from '../../config/embeddingTimeouts.js';
import { smartCompress } from '../../utils/tokenCompressor.js';
import { compactResponse } from '../../services/ResponseCompactor.js';
import { MiniCOTProvider } from '../../providers/MiniCOTProvider.js';
import { getDimensionService } from '../../services/DimensionService.js';
import { getProjectContext } from '../../services/ProjectContext.js';
// XML output removed - human readable only
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
import { drilldownRegistry, formatAsCameraRollResponse, thresholdToZoomLevel, ZOOM_CONFIGS } from '../../services/CameraZoomSearch.js';
import { getMiniCOTScorer, extractAttribution } from '../../services/MiniCOTScorer.js';
import { getCodeMemoryLinkService } from './codeMemoryLink.js';
import { cotStart, cotResult, cotError } from '../../utils/cotBroadcast.js';
// ============================================================================
// TIMEOUT & RETRY CONFIGURATION
// ============================================================================
/**
 * Get code search timeout using unified configuration
 * UNIFIED TIMEOUT: Set SPECMEM_EMBEDDING_TIMEOUT (seconds) to control ALL timeouts
 * Or use SPECMEM_CODE_SEARCH_TIMEOUT for specific override
 * See src/config/embeddingTimeouts.ts for full documentation
 */
function getCodeSearchTimeout() {
    return getEmbeddingTimeout('codeSearch');
}
/**
 * Get max retry attempts from environment variable or use default
 */
function getMaxRetries() {
    const envVal = process.env['SPECMEM_CODE_SEARCH_RETRIES'];
    if (envVal) {
        const retries = parseInt(envVal, 10);
        if (!isNaN(retries) && retries >= 0) {
            return retries;
        }
    }
    // Default: 2 retries (3 total attempts)
    return 2;
}
/**
 * Retry delay with exponential backoff
 */
function getRetryDelay(attempt) {
    // 1s, 2s, 4s exponential backoff
    return Math.min(1000 * Math.pow(2, attempt), 8000);
}
/**
 * Check if an error is transient (worth retrying)
 */
function isTransientError(error) {
    if (!(error instanceof Error))
        return false;
    const msg = error.message.toLowerCase();
    // Transient errors that may succeed on retry
    return (msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('socket hang up') ||
        msg.includes('aborted') ||
        msg.includes('etimedout') ||
        msg.includes('qoms') ||
        msg.includes('resource') ||
        msg.includes('busy'));
}
/**
 * Execute an async operation with timeout
 * FIXER AGENT 8: Added proper timeout handling
 */
async function withTimeout(operation, timeoutMs, operationName) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`[CodePointers] ${operationName} timed out after ${timeoutMs}ms. ` +
                `Set SPECMEM_CODE_SEARCH_TIMEOUT env var to adjust (current: ${timeoutMs}ms). ` +
                `This may indicate embedding service is slow or unresponsive.`));
        }, timeoutMs);
        operation()
            .then(result => {
            clearTimeout(timeoutId);
            resolve(result);
        })
            .catch(error => {
            clearTimeout(timeoutId);
            reject(error);
        });
    });
}
/**
 * Execute an operation with retry logic for transient failures
 * FIXER AGENT 8: Added retry logic
 */
async function withRetry(operation, operationName, maxRetries = getMaxRetries()) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            // Log retry attempt
            if (attempt < maxRetries && isTransientError(error)) {
                const delay = getRetryDelay(attempt);
                logger.warn({
                    operationName,
                    attempt: attempt + 1,
                    maxRetries: maxRetries + 1,
                    error: lastError.message,
                    retryInMs: delay
                }, `[CodePointers] ${operationName} failed, retrying in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            else {
                // Non-transient error or final attempt - don't retry
                break;
            }
        }
    }
    // All retries exhausted
    throw new Error(`[CodePointers] ${operationName} failed after ${maxRetries + 1} attempts. ` +
        `Last error: ${lastError?.message || 'Unknown error'}. ` +
        `Set SPECMEM_CODE_SEARCH_RETRIES env var to adjust retry count.`);
}
// ============================================================================
// HELP OUTPUT - shown when no query provided
// ============================================================================
const HELP_OUTPUT = `
# SpecMem Code Pointers - Semantic Code Search

Search your codebase using natural language and see tracebacks (who uses what).

## Usage

\`\`\`
find_code_pointers({ query: "your search" })
find_code_pointers({ query: "authentication", galleryMode: true })
find_code_pointers({ query: "database", language: "typescript" })
\`\`\`

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | string | required | Natural language search query |
| limit | number | 10 | Max results to return |
| threshold | number | 0.1 | Min similarity score (0-1) |
| language | string | - | Filter by language (typescript, javascript, python, etc.) |
| filePattern | string | - | Filter by file path pattern (e.g., "routes/*.ts") |
| definitionTypes | string[] | - | Filter by type: function, class, method, interface, etc. |
| includeTracebacks | boolean | true | Show who imports/calls this code |
| galleryMode | boolean | false | Use Mini COT for deep analysis |
| summarize | boolean | false | Truncate content (default: show full content) |
| zoom | number | 50 | Zoom level 0-100: 0=signature only, 100=full context |

## Examples

### Find authentication code
\`\`\`json
{
  "query": "admin login authentication",
  "includeTracebacks": true
}
\`\`\`

### Find all database functions
\`\`\`json
{
  "query": "database query connection pool",
  "definitionTypes": ["function", "method"],
  "language": "typescript"
}
\`\`\`

### Deep analysis with Mini COT
\`\`\`json
{
  "query": "websocket handler",
  "galleryMode": true
}
\`\`\`

## Drill-Down

Results include a \`_drill\` field with the command to get full details:
- Use \`get_memory({ id: "..." })\` for full file content
- Use \`Read\` tool for the file path directly

## Tracebacks

When \`includeTracebacks: true\`, results show:
- **callers**: Files that import/require this file
- **callees**: Files that this file imports/requires

This helps you understand code dependencies and impact of changes.
`;
// Attribution for clean output
const SPECMEM_ATTRIBUTION = 'SpecMem Code Pointers';
// ============================================================================
// MAIN TOOL
// ============================================================================
export class FindCodePointers {
    db;
    embeddingProvider;
    name = 'find_code_pointers';
    description = 'Semantic code search with tracebacks - finds code by meaning and shows who uses it. Use for: finding functions, understanding dependencies, tracing imports. ZOOM CONTROL: Use zoom param (0-100) to control detail level. zoom=0 (signature only), zoom=50 (balanced), zoom=100 (full context). Start with zoom=0 for overview, increase to zoom in on specific results.';
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Natural language search - describe what code you\'re looking for. Leave empty for help.'
            },
            limit: {
                type: 'number',
                default: 10,
                minimum: 1,
                maximum: 100,
                description: 'Max results to return'
            },
            threshold: {
                type: 'number',
                default: 0.25,
                minimum: 0,
                maximum: 1,
                description: 'Min similarity score (0-1). Default 0.25 filters garbage. Local embeddings: 0.2-0.5 typical for real matches.'
            },
            language: {
                type: 'string',
                description: 'Filter by language: typescript, javascript, python, go, rust, etc.'
            },
            filePattern: {
                type: 'string',
                description: 'Filter by file path pattern (e.g., "routes/*.ts", "src/api/**")'
            },
            definitionTypes: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['function', 'method', 'class', 'interface', 'type', 'enum', 'variable', 'constant', 'constructor']
                },
                description: 'Filter by definition type'
            },
            includeTracebacks: {
                type: 'boolean',
                default: true,
                description: 'Include callers/callees (who uses this code)'
            },
            galleryMode: {
                oneOf: [
                    { type: 'boolean' },
                    { type: 'string', enum: ['ask'] }
                ],
                default: false,
                description: 'true=Mini COT analysis (slower), false=basic semantic search (default). Gallery mode falls back to basic semantic on failure.'
            },
            maxContentLength: {
                type: 'number',
                default: 0,
                description: 'Truncate content to this many chars (0 = full content, no truncation)'
            },
            summarize: {
                type: 'boolean',
                default: false,
                description: 'Truncate content for compact view. Default false = full content.'
            },
            zoom: {
                type: 'number',
                default: 50,
                minimum: 0,
                maximum: 100,
                description: 'Zoom level 0-100: 0=signature only (minimal), 50=balanced, 100=full context. Low zoom shows less content, high zoom shows more.'
            },
            zoomLevel: {
                type: 'string',
                enum: ['ultra-wide', 'wide', 'normal', 'close', 'macro'],
                description: 'Camera roll zoom level: ultra-wide (50 results, 15% threshold), wide (25, 25%), normal (15, 40%), close (10, 60%), macro (5, 80%)'
            },
            cameraRollMode: {
                type: 'boolean',
                default: true,
                description: 'Camera roll response format with drilldownIDs (default: enabled). Use drill_down(ID) to explore further.'
            },
            useCotScoring: {
                type: 'boolean',
                default: false,
                description: 'Enable Mini COT scoring to analyze code-memory relevance. Returns cotRelevance, cotReasoning, and combinedScore for each result.'
            },
            includeAttribution: {
                type: 'boolean',
                default: false,
                description: 'Add user/claude attribution based on memory role. Returns attribution (user/assistant/unknown) and attributionNote for each result.'
            },
            includeMemoryLinks: {
                type: 'boolean',
                default: true,
                description: 'Link code to related memories with attribution. Shows "requested by user" or "implemented by assistant" for each code result. Default: true.'
            },
            // I5 FIX: New parameters for better search coverage
            keywordFallback: {
                type: 'boolean',
                default: true,
                description: 'If embedding search returns no/low results, fallback to keyword (ILIKE) search on file paths and content.'
            },
            includeRecent: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 20,
                description: 'Force include the last N most recently modified files regardless of similarity.'
            },
            projectPath: {
                type: 'string',
                description: 'Search code from a specific project path instead of current project. Use absolute path like "/home/user/my-other-project"'
            },
            allProjects: {
                type: 'boolean',
                default: false,
                description: 'Search ALL projects instead of just current project. Useful for finding similar code patterns across repos.'
            },
            // humanReadable is always true - removed as configurable option per user request
        },
        required: [] // query is not required - empty shows help
    };
    dimensionService = null;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        try {
            this.dimensionService = getDimensionService(db, embeddingProvider);
        }
        catch {
            // Will initialize when needed
        }
    }
    /**
     * Get DimensionService (lazy initialization)
     */
    getDimService() {
        if (!this.dimensionService) {
            this.dimensionService = getDimensionService(this.db, this.embeddingProvider);
        }
        return this.dimensionService;
    }
    /**
     * Get project path for queries - supports cross-project search
     * Returns null if allProjects=true (skip project filtering)
     */
    getTargetProject(params) {
        if (params.allProjects) {
            return null; // No project filtering
        }
        return params.projectPath || getProjectContext().getProjectPath();
    }
    /**
     * Build project condition for SQL queries
     * Returns empty string if searching all projects
     */
    buildProjectClause(params, paramIndex) {
        const projectPath = this.getTargetProject(params);
        if (!projectPath) {
            return { clause: '', param: null };
        }
        return { clause: `project_path = $${paramIndex}`, param: projectPath };
    }
    /**
     * Validate and prepare embedding for search
     */
    async prepareEmbedding(embedding, tableName, originalQuery) {
        const dimService = this.getDimService();
        const prepared = await dimService.validateAndPrepare(tableName, embedding, originalQuery);
        if (prepared.wasModified) {
            logger.debug({ action: prepared.action, tableName }, 'Adjusted embedding dimension for code search');
        }
        return prepared.embedding;
    }
    async execute(params) {
        const startTime = Date.now();
        // HELP MODE: No query = show help
        if (!params.query || params.query.trim() === '' || params.query.toLowerCase() === 'help') {
            logger.info({}, '[CodePointers] Showing help - no query provided');
            return {
                results: [{
                        type: 'file',
                        file_path: 'HELP',
                        content_preview: HELP_OUTPUT,
                        similarity: 1.0
                    }],
                query: 'help',
                total_found: 0,
                search_type: 'semantic',
                attribution: SPECMEM_ATTRIBUTION
            };
        }
        // MODE SELECTION: Return options if user wants to choose
        if (params.galleryMode === 'ask') {
            return this.returnModeOptions(params.query);
        }
        const limit = Math.min(params.limit ?? 10, 100);
        const threshold = params.threshold ?? 0.35; // Raised to filter low-quality matches
        const includeTracebacks = params.includeTracebacks !== false;
        // Broadcast COT start to dashboard
        cotStart('find_code', params.query);
        // FIXER AGENT 8: Get configurable timeout (default 30s)
        const timeoutMs = getCodeSearchTimeout();
        // FIX: Deadline-based timeout to prevent compounding (was worst-case 390s!)
        // All operations share single deadline instead of stacking individual timeouts
        const deadline = Date.now() + timeoutMs;
        const remainingTime = () => Math.max(1000, deadline - Date.now()); // Min 1s
        // FIXER AGENT 7: Log socket path for debugging (same detection as find_memory)
        const socketPath = getEmbeddingSocketPath();
        if (process.env['SPECMEM_DEBUG']) {
            const socketInfo = getSocketSearchInfo();
            logger.debug({
                socketPath,
                socketFound: socketInfo.foundSocket,
                projectDirName: socketInfo.projectDirName,
                searchedLocations: socketInfo.searchedLocations.filter(l => l.isSocket).map(l => l.path)
            }, '[CodePointers] SPECMEM_DEBUG: Socket detection info');
        }
        try {
            // Generate embedding for query with timeout and retry
            // FIXER AGENT 7 & 8: Added timeout wrapper, retry logic, and socket path logging
            logger.info({
                query: params.query,
                timeoutMs,
                maxRetries: getMaxRetries(),
                socketPath // FIXER AGENT 7: Include socket path in logs
            }, '[CodePointers] Generating embedding for query');
            const rawEmbedding = await withRetry(() => withTimeout(() => this.embeddingProvider.generateEmbedding(params.query), remainingTime(), 'Embedding generation'), 'Embedding generation');
            // Validate and prepare embeddings for each table (may have different dimensions)
            // FIXER AGENT 8: Added timeout wrapper for dimension preparation
            const [queryEmbeddingFiles, queryEmbeddingDefs] = await withTimeout(() => Promise.all([
                this.prepareEmbedding(rawEmbedding, 'codebase_files', params.query),
                this.prepareEmbedding(rawEmbedding, 'code_definitions', params.query)
            ]), remainingTime(), 'Embedding dimension preparation');
            // Search both files and definitions with appropriate embeddings
            // FIXER AGENT 8: Added timeout wrapper for database searches
            const [fileResults, definitionResults] = await withTimeout(() => Promise.all([
                this.searchFiles(queryEmbeddingFiles, params, limit, threshold),
                this.searchDefinitions(queryEmbeddingDefs, params, limit, threshold)
            ]), remainingTime(), 'Database search');
            // Combine and sort by similarity
            let results = [
                ...fileResults.map(f => this.fileToResult(f, params)),
                ...definitionResults.map(d => this.definitionToResult(d, params))
            ];
            // AUTO-DEDUPE: Remove duplicates by file name (keeps shortest path = canonical version)
            // This handles cases where same file is indexed from different paths (e.g., mcp/specmem/src/foo.ts vs src/foo.ts)
            results = this.dedupeResults(results);
            // Sort by similarity descending
            results.sort((a, b) => b.similarity - a.similarity);
            // Take top N
            results = results.slice(0, limit);
            // ============================================================================
            // I5 FIX: APPLY KEYWORD FALLBACK AND RECENT FILES
            // ============================================================================
            const useKeywordFallback = params.keywordFallback !== false; // Default true
            const includeRecentCount = params.includeRecent ?? 0;
            logger.info({
                query: params.query,
                semanticResultCount: results.length,
                keywordFallback: useKeywordFallback,
                includeRecent: includeRecentCount
            }, '[I5 FIX] Code search phase 1 complete');
            // I5 FIX: Keyword fallback if semantic returned nothing good
            // FIXER AGENT 8: Added timeout wrapper for keyword fallback
            let keywordResults = [];
            const hasGoodSemanticResults = results.length > 0 && results[0]?.similarity >= 0.15;
            if (useKeywordFallback && !hasGoodSemanticResults) {
                logger.info({
                    query: params.query,
                    semanticResults: results.length,
                    topSimilarity: results[0]?.similarity
                }, '[I5 FIX] Low/no semantic results, triggering keyword fallback');
                try {
                    keywordResults = await withTimeout(() => this.keywordSearchFiles(params.query, params), remainingTime(), 'Keyword fallback search');
                }
                catch (err) {
                    // Log but don't fail - keyword fallback is optional
                    logger.warn({ error: err }, '[I5 FIX] Keyword fallback timed out, continuing without');
                }
            }
            // I5 FIX: Get recent files if requested
            // FIXER AGENT 8: Added timeout wrapper for recent files
            let recentResults = [];
            if (includeRecentCount > 0) {
                try {
                    recentResults = await withTimeout(() => this.getRecentCodeFiles(includeRecentCount, params), remainingTime(), 'Recent files lookup');
                    logger.info({
                        recentRequested: includeRecentCount,
                        recentFound: recentResults.length
                    }, '[I5 FIX] Recent code files retrieved');
                }
                catch (err) {
                    // Log but don't fail - recent files is optional
                    logger.warn({ error: err }, '[I5 FIX] Recent files lookup timed out, continuing without');
                }
            }
            // I5 FIX: Merge all results if we have additional sources
            if (recentResults.length > 0 || keywordResults.length > 0) {
                const originalCount = results.length;
                results = this.mergeCodeResults(results, recentResults, keywordResults, limit);
                logger.info({
                    originalSemanticCount: originalCount,
                    recentCount: recentResults.length,
                    keywordCount: keywordResults.length,
                    mergedCount: results.length
                }, '[I5 FIX] Code results merged from multiple sources');
            }
            // Add tracebacks if requested
            // FIXER AGENT 8: Added timeout wrapper for tracebacks
            // ZOOM FIX: Use zoom-based traceback depth in camera roll mode
            const zoom = params.zoom ?? 50;
            const tracebackDepth = this.zoomToTracebackDepth(zoom);
            // For non-camera-roll mode: use includeTracebacks boolean (default true)
            // For camera-roll mode: always include but depth controlled by zoom
            const cameraRollModeCheck = params.cameraRollMode === true ||
                params.cameraRollMode === 'true' ||
                params.zoomLevel;
            const shouldIncludeTracebacks = cameraRollModeCheck
                ? tracebackDepth.include // Camera roll: zoom controls inclusion
                : includeTracebacks; // Default: use boolean param (default true)
            if (shouldIncludeTracebacks && results.length > 0) {
                try {
                    // Pass traceback depth for zoom-based limiting
                    const depth = cameraRollModeCheck
                        ? { maxCallers: tracebackDepth.maxCallers, maxCallees: tracebackDepth.maxCallees }
                        : undefined; // Default mode uses default (3, 3)
                    await withTimeout(() => this.addTracebacks(results, depth), remainingTime(), 'Traceback lookup');
                }
                catch (err) {
                    // Log but don't fail - tracebacks are optional enrichment
                    logger.warn({ error: err }, '[CodePointers] Traceback lookup timed out, continuing without');
                }
            }
            // Add memory links with attribution (default: enabled)
            // This correlates code with related memories and shows "requested by user" or "implemented by assistant"
            // FIXER AGENT 8: Added timeout wrapper for memory links
            const includeMemoryLinks = params.includeMemoryLinks !== false;
            if (includeMemoryLinks && results.length > 0) {
                try {
                    const memoryLinkService = getCodeMemoryLinkService(this.db);
                    await withTimeout(() => memoryLinkService.addMemoryLinks(results), remainingTime(), 'Memory link lookup');
                }
                catch (err) {
                    // Log but don't fail - memory links are optional enrichment
                    logger.warn({ error: err }, '[CodePointers] Memory link lookup timed out, continuing without');
                }
            }
            const duration = Date.now() - startTime;
            logger.info({
                query: params.query,
                resultCount: results.length,
                duration,
                usedKeywordFallback: keywordResults.length > 0,
                usedRecentFiles: recentResults.length > 0
            }, '[CodePointers] Search complete with I5 fixes');
            // ============================================================================
            // MINI COT SCORING & ATTRIBUTION
            // Score code-memory relevance using Mini COT and add user/claude attribution
            // FIXER AGENT 8: Added timeout wrapper for COT scoring
            // ============================================================================
            if ((params.useCotScoring || params.includeAttribution) && results.length > 0) {
                try {
                    // COT scoring can be slow - use 1.5x timeout
                    const cotTimeout = Math.round(timeoutMs * 1.5);
                    results = await withTimeout(() => this.applyCotScoringAndAttribution(params.query, results, params.useCotScoring ?? false, params.includeAttribution ?? false), cotTimeout, 'COT scoring and attribution');
                    // Re-sort by combined score if COT scoring was applied
                    if (params.useCotScoring) {
                        results.sort((a, b) => (b.combinedScore ?? b.similarity) - (a.combinedScore ?? a.similarity));
                    }
                }
                catch (err) {
                    // Log but don't fail - COT scoring is optional enrichment
                    logger.warn({ error: err }, '[CodePointers] COT scoring timed out, continuing without');
                }
            }
            // GALLERY MODE: Send to Mini COT for analysis
            // FIXER AGENT 8: Added timeout wrapper for gallery mode (uses longer timeout)
            if (params.galleryMode === true && results.length > 0) {
                // Gallery mode uses Mini COT which is slower - use 2x timeout
                const galleryTimeout = timeoutMs * 2;
                return await withTimeout(() => this.processGalleryMode(params.query, results), galleryTimeout, 'Gallery mode processing');
            }
            // ============================================================================
            // CAMERA ROLL MODE - Default enabled, human-readable output with drilldownIDs
            // ============================================================================
            // Default: cameraRollMode is TRUE (enabled) unless explicitly set to false
            const cameraRollModeRaw = params.cameraRollMode;
            const cameraRollMode = cameraRollModeRaw !== false && cameraRollModeRaw !== 'false' && cameraRollModeRaw !== 0;
            const zoomLevelParam = params.zoomLevel;
            if (cameraRollMode || zoomLevelParam) {
                // Determine zoom level from parameter or threshold
                const zoomLevel = zoomLevelParam || thresholdToZoomLevel(params.threshold ?? 0.25); // MED-36 FIX: Standardized to 0.25
                const zoomConfig = ZOOM_CONFIGS[zoomLevel];
                logger.info({
                    query: params.query,
                    zoomLevel,
                    resultCount: results.length,
                    threshold: zoomConfig.threshold
                }, '[CodePointers] Camera roll mode enabled');
                // Convert results to camera roll format
                const cameraRollItems = results.map(result => {
                    // Register in drilldown registry
                    const codeId = result.file_path + (result.name ? `:${result.name}` : '');
                    const drilldownID = drilldownRegistry.register(codeId, 'code');
                    // Truncate content based on zoom level
                    let content = result.content_preview;
                    if (content.length > zoomConfig.contentPreview) {
                        content = content.substring(0, zoomConfig.contentPreview) + '...';
                    }
                    // Apply ROUND-TRIP VERIFIED compression based on zoom level
                    // User feedback: "English that couldn't be preserved stays as English"
                    if (zoomConfig.compression === 'full') {
                        const compressed = smartCompress(content, { threshold: 0.75 });
                        content = compressed.result;
                    }
                    else if (zoomConfig.compression === 'light') {
                        const compressed = smartCompress(content, { threshold: 0.85 });
                        content = compressed.result;
                    }
                    // CLEAN OUTPUT: Only essential fields (removed tags, hasMore, codePointers)
                    return {
                        content,
                        drilldownID,
                        memoryID: codeId,
                        similarity: Math.round(result.similarity * 100) / 100,
                        role: 'code'
                    };
                });
                // Format as camera roll response - CLEAN, no extra fields
                const cameraRollResponse = formatAsCameraRollResponse(cameraRollItems, params.query, zoomLevel, 'code');
                // Return directly - no extra zoom/attribution bloat
                return cameraRollResponse;
            }
            // ALWAYS use humanReadable mode - never use XML
            // Hook-style output with [SPECMEM-FIND-CODE-POINTERS] tags matching smart-context-hook format
            // humanReadable parameter is ignored - always true for consistency
            if (true) {
                const humanReadableData = results.map(r => ({
                    file: r.file_path,
                    line: r.line_range?.start || 0,
                    name: r.name,
                    definitionType: r.definition_type,
                    language: r.language,
                    signature: r.signature,
                    content: r.content_preview,
                    similarity: r.similarity,
                    drilldownID: r.drilldownID,
                    // Include tracebacks for zoom-based display
                    callers: r.callers?.map(c => c.source_file_path) || [],
                    callees: r.callees?.map(c => c.target_path) || []
                }));
                return formatHumanReadable('find_code_pointers', humanReadableData, {
                    grey: true,
                    showSimilarity: true,
                    maxContentLength: params.maxContentLength || 300,
                    query: params.query, // Pass query for header display
                    showTracebacks: shouldIncludeTracebacks // Show tracebacks based on zoom
                });
            }
            // Broadcast COT result to dashboard
            cotResult('find_code', `Found ${results.length} code pointers`, results.length);
            // Human readable output always returned above - this is unreachable
            // (kept for type safety, but if (true) block above always returns)
            return { results: [], query: params.query, total_found: 0 };
        }
        catch (error) {
            // Broadcast COT error to dashboard
            cotError('find_code', error?.message?.slice(0, 100) || 'Unknown error');
            // FIXER AGENT 7 & 8: Improved error handling with socket path logging and better timeout messages
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            // FIXER AGENT 7: Get socket info for debugging - same detection as find_memory
            const socketPath = getEmbeddingSocketPath();
            const socketInfo = getSocketSearchInfo();
            // Determine error type for better messaging
            const isTimeout = errorMessage.toLowerCase().includes('timeout') ||
                errorMessage.toLowerCase().includes('timed out');
            const isConnection = errorMessage.toLowerCase().includes('econnrefused') ||
                errorMessage.toLowerCase().includes('econnreset') ||
                errorMessage.toLowerCase().includes('socket');
            const isQoms = errorMessage.toLowerCase().includes('qoms');
            let enhancedMessage = errorMessage;
            let troubleshooting = '';
            // FIXER AGENT 7: Use dynamic socket path instead of hardcoded path
            if (isTimeout) {
                troubleshooting = `
Troubleshooting timeout:
  Socket path: ${socketPath}
  Socket found: ${socketInfo.foundSocket ? 'YES' : 'NO'}
  1. Check if embedding service is running: ps aux | grep frankenstein
  2. Check socket exists: ls -la ${socketPath}
  3. Increase timeout: export SPECMEM_CODE_SEARCH_TIMEOUT=60000 (60s)
  4. Increase retries: export SPECMEM_CODE_SEARCH_RETRIES=3`;
            }
            else if (isConnection) {
                troubleshooting = `
Troubleshooting connection error:
  Socket path: ${socketPath}
  Socket found: ${socketInfo.foundSocket ? 'YES' : 'NO'}
  Searched locations: ${socketInfo.searchedLocations.map(l => l.path).join(', ')}
  1. Restart embedding service: ./start-sandbox.sh
  2. Check Docker is running: docker ps
  3. Verify socket permissions: ls -la ${socketPath}`;
            }
            else if (isQoms) {
                troubleshooting = `
Troubleshooting QOMS resource error:
  1. System may be under heavy load - wait and retry
  2. Increase max wait: export SPECMEM_MAX_WAIT_MS=60000
  3. Check system resources: top -bn1 | head -20`;
            }
            // FIXER AGENT 7: Enhanced error logging with socket path info
            logger.error({
                error: errorMessage,
                query: params.query,
                duration,
                timeoutMs,
                isTimeout,
                isConnection,
                isQoms,
                socketPath,
                socketFound: socketInfo.foundSocket,
                projectDirName: socketInfo.projectDirName
            }, `[CodePointers] Search failed after ${duration}ms${troubleshooting ? ' - see logs for troubleshooting' : ''}`);
            // SPECMEM_DEBUG: Log all searched socket locations for debugging
            if (process.env['SPECMEM_DEBUG']) {
                logger.debug({
                    searchedLocations: socketInfo.searchedLocations,
                    projectHash: socketInfo.projectHash,
                    specmemRoot: socketInfo.specmemRoot,
                    specmemHome: socketInfo.specmemHome
                }, '[CodePointers] SPECMEM_DEBUG: Socket search details');
            }
            // Re-throw with enhanced message
            if (troubleshooting) {
                const enhancedError = new Error(`[CodePointers] Search failed: ${errorMessage}\n${troubleshooting}`);
                enhancedError.originalError = error;
                throw enhancedError;
            }
            throw error;
        }
    }
    // ============================================================================
    // SEARCH METHODS
    // ============================================================================
    async searchFiles(embedding, params, limit, threshold) {
        const conditions = ['embedding IS NOT NULL'];
        const queryParams = [];
        let paramIndex = 1;
        // Embedding for similarity
        queryParams.push(`[${embedding.join(',')}]`);
        paramIndex++;
        // CROSS-PROJECT SUPPORT: Project filtering (skipped if allProjects=true)
        const projectFilter = this.buildProjectClause(params, paramIndex);
        if (projectFilter.param) {
            conditions.push(projectFilter.clause);
            queryParams.push(projectFilter.param);
            paramIndex++;
        }
        // EXCLUDE data directories and nested copies - only search actual code
        conditions.push(`file_path NOT LIKE '%data/%'`); // Any data directory
        conditions.push(`file_path NOT LIKE '%/backups/%'`);
        conditions.push(`file_path NOT LIKE '%/node_modules/%'`);
        conditions.push(`file_path NOT LIKE '%.json'`); // Exclude JSON data files
        conditions.push(`file_path NOT LIKE '%.txt'`); // Exclude text files (prompts, logs)
        conditions.push(`file_path NOT LIKE '%.log'`); // Exclude log files
        conditions.push(`file_path NOT LIKE '%.md'`); // Exclude markdown (docs)
        conditions.push(`file_path NOT LIKE '%/dist/%'`); // Exclude compiled output
        // FIX: Exclude nested mcp/ directories (contain duplicate copies of codebase)
        conditions.push(`file_path NOT LIKE 'mcp/%'`); // Nested mcp server copies
        conditions.push(`file_path NOT LIKE '%SpecmemcSrc-%'`); // Backup copies
        // Language filter
        if (params.language) {
            conditions.push(`LOWER(language_name) = LOWER($${paramIndex})`);
            queryParams.push(params.language);
            paramIndex++;
        }
        // File pattern filter
        if (params.filePattern) {
            conditions.push(`file_path LIKE $${paramIndex}`);
            queryParams.push(params.filePattern.replace(/\*/g, '%'));
            paramIndex++;
        }
        // Threshold
        queryParams.push(threshold);
        const thresholdParam = paramIndex++;
        // Limit
        queryParams.push(limit);
        const limitParam = paramIndex;
        const query = `
      SELECT
        id, file_path, file_name, language_name, content, line_count,
        1 - (embedding <=> $1::vector) AS similarity
      FROM codebase_files
      WHERE ${conditions.join(' AND ')}
        AND 1 - (embedding <=> $1::vector) >= $${thresholdParam}
      ORDER BY similarity DESC
      LIMIT $${limitParam}
    `;
        const result = await this.db.query(query, queryParams);
        return result.rows;
    }
    async searchDefinitions(embedding, params, limit, threshold) {
        const conditions = ['embedding IS NOT NULL'];
        const queryParams = [];
        let paramIndex = 1;
        // Embedding for similarity
        queryParams.push(`[${embedding.join(',')}]`);
        paramIndex++;
        // CROSS-PROJECT SUPPORT: Project filtering (skipped if allProjects=true)
        const projectFilter = this.buildProjectClause(params, paramIndex);
        if (projectFilter.param) {
            conditions.push(projectFilter.clause);
            queryParams.push(projectFilter.param);
            paramIndex++;
        }
        // FIX: Exclude nested copies and data directories
        conditions.push(`file_path NOT LIKE 'mcp/%'`); // Nested mcp server copies
        conditions.push(`file_path NOT LIKE '%SpecmemcSrc-%'`); // Backup copies
        conditions.push(`file_path NOT LIKE '%/dist/%'`); // Compiled output
        // Language filter
        if (params.language) {
            conditions.push(`LOWER(language) = LOWER($${paramIndex})`);
            queryParams.push(params.language);
            paramIndex++;
        }
        // Definition type filter
        if (params.definitionTypes?.length) {
            conditions.push(`definition_type = ANY($${paramIndex}::text[])`);
            queryParams.push(params.definitionTypes);
            paramIndex++;
        }
        // File pattern filter
        if (params.filePattern) {
            conditions.push(`file_path LIKE $${paramIndex}`);
            queryParams.push(params.filePattern.replace(/\*/g, '%'));
            paramIndex++;
        }
        // Threshold
        queryParams.push(threshold);
        const thresholdParam = paramIndex++;
        // Limit
        queryParams.push(limit);
        const limitParam = paramIndex;
        const query = `
      SELECT
        id, file_path, name, qualified_name, definition_type,
        start_line, end_line, signature, docstring,
        1 - (embedding <=> $1::vector) AS similarity
      FROM code_definitions
      WHERE ${conditions.join(' AND ')}
        AND 1 - (embedding <=> $1::vector) >= $${thresholdParam}
      ORDER BY similarity DESC
      LIMIT $${limitParam}
    `;
        const result = await this.db.query(query, queryParams);
        return result.rows;
    }
    // ============================================================================
    // TRACEBACK METHODS
    // ============================================================================
    /**
     * Add traceback information to results
     * @param results - Code search results to enrich
     * @param depth - Traceback depth config from zoomToTracebackDepth()
     *               If not provided, uses default (3 callers, 3 callees)
     */
    async addTracebacks(results, depth) {
        const filePaths = [...new Set(results.map(r => r.file_path))];
        if (filePaths.length === 0)
            return;
        // Use provided depth or default to 3 each
        const maxCallers = depth?.maxCallers ?? 3;
        const maxCallees = depth?.maxCallees ?? 3;
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        try {
            // Get callers (who imports these files) - filtered by project
            const callersQuery = `
        SELECT source_file_path, target_path, import_type, imported_names, line_number
        FROM code_dependencies
        WHERE (resolved_path = ANY($1::text[])
           OR target_path = ANY($1::text[]))
           AND project_path = $2
        ORDER BY source_file_path
      `;
            const callersResult = await this.db.query(callersQuery, [filePaths, projectPath]);
            // Get callees (what these files import) - filtered by project
            const calleesQuery = `
        SELECT source_file_path, target_path, import_type, imported_names, line_number
        FROM code_dependencies
        WHERE source_file_path = ANY($1::text[])
          AND project_path = $2
        ORDER BY target_path
      `;
            const calleesResult = await this.db.query(calleesQuery, [filePaths, projectPath]);
            // Map back to results - DEDUPLICATE by source_file_path to avoid repeated imports
            const callersMap = new Map();
            const calleesMap = new Map();
            // Track seen source paths for deduplication
            const seenCallers = new Map();
            const seenCallees = new Map();
            for (const row of callersResult.rows) {
                const key = row.target_path;
                if (!callersMap.has(key)) {
                    callersMap.set(key, []);
                    seenCallers.set(key, new Set());
                }
                // DEDUPE: Only add if we haven't seen this source_file_path before
                if (!seenCallers.get(key).has(row.source_file_path)) {
                    seenCallers.get(key).add(row.source_file_path);
                    callersMap.get(key).push(row);
                }
            }
            for (const row of calleesResult.rows) {
                const key = row.source_file_path;
                if (!calleesMap.has(key)) {
                    calleesMap.set(key, []);
                    seenCallees.set(key, new Set());
                }
                // DEDUPE: Only add if we haven't seen this target_path before
                if (!seenCallees.get(key).has(row.target_path)) {
                    seenCallees.get(key).add(row.target_path);
                    calleesMap.get(key).push(row);
                }
            }
            // Attach to results - use zoom-based depth limits
            for (const result of results) {
                result.callers = (callersMap.get(result.file_path) || []).slice(0, maxCallers);
                result.callees = (calleesMap.get(result.file_path) || []).slice(0, maxCallees);
            }
        }
        catch (error) {
            logger.warn({ error }, '[CodePointers] Failed to get tracebacks');
        }
    }
    // ============================================================================
    // I5 FIX: KEYWORD FALLBACK AND RECENT FILES
    // ============================================================================
    /**
     * I5 FIX: Keyword fallback search for code files
     * When embeddings return nothing, do ILIKE search on file paths and content
     */
    async keywordSearchFiles(query, params) {
        logger.info({ query, allProjects: params.allProjects }, '[I5 FIX] Performing keyword fallback search for code');
        const limit = params.limit ?? 10;
        // Extract keywords from query
        const keywords = query.toLowerCase()
            .split(/\s+/)
            .filter(w => w.length >= 3)
            .slice(0, 5);
        if (keywords.length === 0) {
            return [];
        }
        // CROSS-PROJECT SUPPORT: Build conditions with optional project filter
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;
        const projectFilter = this.buildProjectClause(params, paramIndex);
        if (projectFilter.param) {
            conditions.push(projectFilter.clause);
            queryParams.push(projectFilter.param);
            paramIndex++;
        }
        // FIX: Exclude nested copies and data directories
        conditions.push(`file_path NOT LIKE 'mcp/%'`);
        conditions.push(`file_path NOT LIKE '%SpecmemcSrc-%'`);
        conditions.push(`file_path NOT LIKE '%/dist/%'`);
        conditions.push(`file_path NOT LIKE '%data/%'`);
        // Search in both file_path and content
        const keywordConditions = keywords.map((kw, idx) => {
            queryParams.push(`%${kw}%`);
            const pIdx = paramIndex + idx;
            return `(file_path ILIKE $${pIdx} OR content ILIKE $${pIdx})`;
        });
        conditions.push(`(${keywordConditions.join(' OR ')})`);
        paramIndex += keywords.length;
        // Language filter
        if (params.language) {
            conditions.push(`LOWER(language_name) = LOWER($${paramIndex})`);
            queryParams.push(params.language);
            paramIndex++;
        }
        queryParams.push(limit);
        const limitParam = paramIndex;
        const searchQuery = `
      SELECT
        id, file_path, file_name, language_name, content, line_count,
        0.25 AS similarity  -- Fixed similarity for keyword matches
      FROM codebase_files
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT $${limitParam}
    `;
        try {
            const result = await this.db.query(searchQuery, queryParams);
            logger.info({
                keywords,
                resultsFound: result.rows.length
            }, '[I5 FIX] Code keyword fallback complete');
            return result.rows.map(f => this.fileToResult(f, params));
        }
        catch (error) {
            logger.error({ error, keywords }, '[I5 FIX] Code keyword fallback failed');
            return [];
        }
    }
    /**
     * I5 FIX: Get recently modified code files
     */
    async getRecentCodeFiles(count, params) {
        if (count <= 0)
            return [];
        logger.info({ count, allProjects: params.allProjects }, '[I5 FIX] Fetching recent code files');
        // CROSS-PROJECT SUPPORT: Build conditions with optional project filter
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;
        const projectFilter = this.buildProjectClause(params, paramIndex);
        if (projectFilter.param) {
            conditions.push(projectFilter.clause);
            queryParams.push(projectFilter.param);
            paramIndex++;
        }
        // FIX: Exclude nested copies and data directories
        conditions.push(`file_path NOT LIKE 'mcp/%'`);
        conditions.push(`file_path NOT LIKE '%SpecmemcSrc-%'`);
        conditions.push(`file_path NOT LIKE '%/dist/%'`);
        conditions.push(`file_path NOT LIKE '%data/%'`);
        // Language filter
        if (params.language) {
            conditions.push(`LOWER(language_name) = LOWER($${paramIndex})`);
            queryParams.push(params.language);
            paramIndex++;
        }
        queryParams.push(count);
        const limitParam = paramIndex;
        const query = `
      SELECT
        id, file_path, file_name, language_name, content, line_count,
        0.4 AS similarity  -- Fixed similarity for recent files
      FROM codebase_files
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT $${limitParam}
    `;
        try {
            const result = await this.db.query(query, queryParams);
            logger.info({
                recentFound: result.rows.length
            }, '[I5 FIX] Recent code files retrieved');
            return result.rows.map(f => this.fileToResult(f, params));
        }
        catch (error) {
            logger.error({ error }, '[I5 FIX] Failed to get recent code files');
            return [];
        }
    }
    /**
     * I5 FIX: Merge and dedupe code search results
     */
    mergeCodeResults(semanticResults, recentResults, keywordResults, limit) {
        const seenPaths = new Set();
        const merged = [];
        // Add semantic results first
        for (const result of semanticResults) {
            const key = result.file_path + (result.name || '');
            if (!seenPaths.has(key)) {
                seenPaths.add(key);
                merged.push(result);
            }
        }
        // Add recent results
        for (const result of recentResults) {
            const key = result.file_path + (result.name || '');
            if (!seenPaths.has(key)) {
                seenPaths.add(key);
                merged.push({ ...result, _source: 'recent' });
            }
        }
        // Add keyword results
        for (const result of keywordResults) {
            const key = result.file_path + (result.name || '');
            if (!seenPaths.has(key)) {
                seenPaths.add(key);
                merged.push({ ...result, _source: 'keyword' });
            }
        }
        return merged
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }
    // ============================================================================
    // AUTO-DEDUPLICATION
    // ============================================================================
    /**
     * Remove duplicate results by file name, keeping the shortest path (canonical version)
     * This handles cases where the same file is indexed from multiple paths:
     * - src/db/foo.ts (canonical - shortest)
     * - mcp/specmem/src/db/foo.ts (duplicate - longer path)
     * - mcp/specmem/backup/src/db/foo.ts (duplicate - even longer)
     */
    dedupeResults(results) {
        const byFileName = new Map();
        for (const result of results) {
            // Extract just the filename from the path
            const fileName = result.file_path.split('/').pop() || result.file_path;
            // For definitions, include the name to avoid deduping different functions in same-named files
            const key = result.type === 'definition'
                ? `${fileName}:${result.name || ''}`
                : fileName;
            const existing = byFileName.get(key);
            if (!existing) {
                byFileName.set(key, result);
            }
            else {
                // Keep the one with shorter path (more canonical) or higher similarity
                const existingPathLen = existing.file_path.length;
                const newPathLen = result.file_path.length;
                if (newPathLen < existingPathLen ||
                    (newPathLen === existingPathLen && result.similarity > existing.similarity)) {
                    byFileName.set(key, result);
                }
            }
        }
        return Array.from(byFileName.values());
    }
    // ============================================================================
    // RESULT FORMATTING
    // ============================================================================
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
    zoomToContentLength(zoom) {
        // Clamp zoom to 0-100 range
        const clampedZoom = Math.max(0, Math.min(100, zoom));
        // At max zoom, no truncation
        if (clampedZoom >= 100) {
            return Infinity;
        }
        // Linear scaling for predictability: 100 + (zoom * 20)
        // This gives us: 0->100, 25->600, 50->1100, 75->1600, 99->2080
        return 100 + (clampedZoom * 20);
    }
    /**
     * Check if zoom level is low enough to show signature only
     * Signature-only mode kicks in at zoom < 20
     */
    isSignatureOnlyZoom(zoom) {
        return zoom < 20;
    }
    /**
     * Convert numeric zoom (0-100) to descriptive label
     */
    getZoomLabel(zoom) {
        if (zoom <= 10)
            return 'macro'; // Very zoomed in, minimal results
        if (zoom <= 30)
            return 'close'; // Close-up view
        if (zoom <= 60)
            return 'normal'; // Standard view
        if (zoom <= 80)
            return 'wide'; // Wide view, more results
        return 'ultra-wide'; // Panoramic, maximum results
    }
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
    zoomToTracebackDepth(zoom) {
        const clampedZoom = Math.max(0, Math.min(100, zoom));
        if (clampedZoom < 25) {
            // zoom 0-25: NO tracebacks
            return { include: false, maxCallers: 0, maxCallees: 0 };
        }
        else if (clampedZoom < 50) {
            // zoom 25-50: minimal tracebacks
            return { include: true, maxCallers: 1, maxCallees: 1 };
        }
        else if (clampedZoom < 75) {
            // zoom 50-75: summary tracebacks
            return { include: true, maxCallers: 3, maxCallees: 3 };
        }
        else {
            // zoom 75-100: FULL tracebacks
            return { include: true, maxCallers: 10, maxCallees: 10 };
        }
    }
    fileToResult(file, params) {
        // Use zoom parameter to determine content length (default zoom=50 -> 500 chars)
        const zoom = params.zoom ?? 50;
        const zoomBasedMaxLen = this.zoomToContentLength(zoom);
        // maxContentLength overrides zoom if explicitly set
        const maxLen = params.maxContentLength && params.maxContentLength > 0
            ? params.maxContentLength
            : zoomBasedMaxLen;
        let content = file.content;
        // Apply zoom-based truncation
        if (maxLen !== Infinity && content.length > maxLen) {
            content = content.substring(0, maxLen) + '...';
        }
        return {
            type: 'file',
            file_path: file.file_path,
            content_preview: content,
            similarity: Math.round(file.similarity * 100) / 100
        };
    }
    definitionToResult(def, params) {
        // Use zoom parameter to determine content length (default zoom=50 -> 500 chars)
        const zoom = params.zoom ?? 50;
        const signatureOnly = this.isSignatureOnlyZoom(zoom);
        const zoomBasedMaxLen = this.zoomToContentLength(zoom);
        // maxContentLength overrides zoom if explicitly set
        const maxLen = params.maxContentLength && params.maxContentLength > 0
            ? params.maxContentLength
            : zoomBasedMaxLen;
        // Build content preview from signature + docstring
        let content = '';
        // At low zoom (< 20), only show signature
        if (signatureOnly) {
            content = def.signature || `${def.definition_type} ${def.name}`;
        }
        else {
            // HIGH ZOOM (>= 20): Try to read actual code from file
            // This makes find_code_pointers self-sufficient - no drill_down needed!
            if (zoom >= 60 && def.file_path && def.start_line && def.end_line) {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
                    const fullPath = path.isAbsolute(def.file_path)
                        ? def.file_path
                        : path.join(projectPath, def.file_path);
                    if (fs.existsSync(fullPath)) {
                        const fileContent = fs.readFileSync(fullPath, 'utf8');
                        const lines = fileContent.split('\n');
                        // Get lines from start to end (1-indexed in DB, 0-indexed in array)
                        const startIdx = Math.max(0, def.start_line - 1);
                        const endIdx = Math.min(lines.length, def.end_line);
                        content = lines.slice(startIdx, endIdx).join('\n');
                    }
                }
                catch (e) {
                    // Fall back to signature if file read fails
                    logger.debug({ error: e, file: def.file_path }, 'Failed to read file for high-zoom code content');
                }
            }
            // Fallback to signature + docstring if no file content
            if (!content) {
                if (def.signature) {
                    content = def.signature;
                }
                if (def.docstring) {
                    content += content ? '\n\n' + def.docstring : def.docstring;
                }
            }
        }
        // Apply zoom-based truncation
        if (maxLen !== Infinity && content.length > maxLen) {
            content = content.substring(0, maxLen) + '...';
        }
        return {
            type: 'definition',
            file_path: def.file_path,
            name: def.qualified_name || def.name,
            definition_type: def.definition_type,
            content_preview: content || `${def.definition_type} ${def.name}`,
            similarity: Math.round(def.similarity * 100) / 100,
            line_range: { start: def.start_line, end: def.end_line }
        };
    }
    // ============================================================================
    // GALLERY MODE
    // ============================================================================
    returnModeOptions(query) {
        const modeHelp = `
# Search Mode Selection

Query: "${query}"

## ⚡ Basic Search (Recommended for quick lookups)
- **Speed**: Fast (~100-500ms)
- **Features**: Semantic similarity, tracebacks, file filtering
- **Best for**: Finding specific code, understanding imports

## 🎨 Gallery Mode (Deep analysis)
- **Speed**: Slower (~5-15s)
- **Features**: Mini COT Chain-of-Thought analysis, relevance explanations
- **Best for**: Understanding complex code, research synthesis

**To proceed, call find_code_pointers again with:**
- \`galleryMode: false\` for Basic Search
- \`galleryMode: true\` for Gallery Mode
`;
        return {
            results: [{
                    type: 'file',
                    file_path: 'MODE_SELECTOR',
                    content_preview: modeHelp,
                    similarity: 1.0
                }],
            query,
            total_found: 0,
            search_type: 'semantic',
            attribution: SPECMEM_ATTRIBUTION
        };
    }
    async processGalleryMode(query, results) {
        logger.info({ query, resultCount: results.length }, '[CodePointers] Gallery mode - sending to Mini COT');
        try {
            const miniCOT = new MiniCOTProvider();
            // Prepare for gallery - NO compression on keywords (Mini COT expects English input)
            const memoriesForGallery = results.map(r => ({
                id: r.file_path + (r.name ? `:${r.name}` : ''),
                keywords: [
                    r.type,
                    r.definition_type || '',
                    r.file_path.split('/').pop() || ''
                ].filter(Boolean).join(' '),
                snippet: r.content_preview.slice(0, 200)
            }));
            const gallery = await miniCOT.createGallery(query, memoriesForGallery);
            logger.info({
                query,
                galleryItems: gallery.gallery.length
            }, '[CodePointers] Gallery created');
            // Return with Chinese compactor applied
            return compactResponse(gallery, 'search');
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errMsg, stack: error instanceof Error ? error.stack : undefined }, '[CodePointers] Mini COT gallery failed - returning basic results');
            return {
                results,
                query,
                total_found: results.length,
                search_type: 'semantic',
                zoom: 'normal',
                attribution: SPECMEM_ATTRIBUTION
            };
        }
    }
    // ============================================================================
    // DRILLDOWN SUGGESTIONS
    // ============================================================================
    generateDrilldown(results, query) {
        const count = results.length;
        const topSim = results[0]?.similarity ?? 0;
        if (count === 0) {
            return {
                prompt: `🔍 No code found for "${query}" | Try: different keywords, check spelling, or use WebSearch`,
                action: 'research:web',
                needsResearch: true
            };
        }
        if (topSim < 0.15) {
            return {
                prompt: `⚠️ Low relevance (${Math.round(topSim * 100)}%) | Found ${count} results but may not match intent. Try more specific query.`,
                action: 'drilldown:refine',
                needsResearch: false
            };
        }
        if (count < 3) {
            return {
                prompt: `📊 Found ${count} results (${Math.round(topSim * 100)}% match) | May need broader search`,
                action: 'drilldown:broader',
                needsResearch: false
            };
        }
        // Good results
        const hasTracebacks = results.some(r => (r.callers?.length || 0) > 0 || (r.callees?.length || 0) > 0);
        const tracebackHint = hasTracebacks ? ' | Tracebacks included' : '';
        return {
            prompt: `✅ Found ${count} code matches (${Math.round(topSim * 100)}% top similarity)${tracebackHint} | Use _drill to get full content`,
            action: 'none',
            needsResearch: false
        };
    }
    // ============================================================================
    // MINI COT SCORING & ATTRIBUTION
    // ============================================================================
    /**
     * Apply Mini COT scoring and/or attribution to code search results
     *
     * This method:
     * 1. Calls MiniCOTScorer to score code-memory relevance (if useCotScoring=true)
     * 2. Extracts user/claude attribution based on memory role (if includeAttribution=true)
     * 3. Returns enriched results with scoring and attribution fields
     */
    async applyCotScoringAndAttribution(query, results, useCotScoring, includeAttribution) {
        logger.info({
            query,
            resultCount: results.length,
            useCotScoring,
            includeAttribution
        }, '[CodePointers] Applying COT scoring and attribution');
        try {
            // If only attribution is needed (no COT scoring), use fast path
            if (!useCotScoring && includeAttribution) {
                return this.applyAttributionOnly(results);
            }
            // Full COT scoring path
            const scorer = getMiniCOTScorer();
            // Convert results to CodePointerWithMemory format
            const pointersWithMemory = results.map(result => ({
                file_path: result.file_path,
                name: result.name,
                definition_type: result.definition_type,
                content_preview: result.content_preview,
                line_range: result.line_range,
                similarity: result.similarity,
                // Try to find associated memory (would come from code_pointers table)
                memoryId: result.memoryId,
                memoryRole: undefined, // Will be looked up if memoryId is present
                memoryTags: undefined // Will be looked up if memoryId is present
            }));
            // Score batch
            const scoringResult = await scorer.scoreBatch({
                query,
                codePointers: pointersWithMemory,
                options: {
                    includeReasoning: true,
                    compressOutput: true
                }
            });
            logger.info({
                query,
                scoredCount: scoringResult.totalScored,
                avgCotRelevance: scoringResult.avgCotRelevance,
                scoringMethod: scoringResult.scoringMethod,
                attributionBreakdown: scoringResult.attributionBreakdown
            }, '[CodePointers] COT scoring complete');
            // Map scored results back to CodeSearchResult
            return results.map((result, idx) => {
                const scored = scoringResult.scoredPointers[idx];
                if (!scored)
                    return result;
                const enrichedResult = {
                    ...result
                };
                // Add COT scoring fields if scoring was used
                if (useCotScoring) {
                    enrichedResult.cotRelevance = scored.cotRelevance;
                    enrichedResult.cotReasoning = scored.cotReasoning;
                    enrichedResult.combinedScore = scored.combinedScore;
                }
                // Add attribution fields if attribution was requested
                if (includeAttribution) {
                    enrichedResult.attribution = scored.attribution;
                    enrichedResult.attributionNote = scored.attributionNote;
                    enrichedResult.memoryId = scored.memoryId;
                }
                return enrichedResult;
            });
        }
        catch (error) {
            logger.warn({ error, query }, '[CodePointers] COT scoring/attribution failed, returning original results');
            // Fall back to attribution-only if COT fails but attribution was requested
            if (includeAttribution) {
                return this.applyAttributionOnly(results);
            }
            return results;
        }
    }
    /**
     * Fast path for attribution-only (no COT scoring)
     * Uses extractAttribution utility to determine user/claude attribution
     */
    applyAttributionOnly(results) {
        return results.map(result => {
            // Extract attribution based on any associated memory metadata
            // Since we don't have memory context here, we mark as unknown
            // unless there's embedded information in the result
            const { attribution, note } = extractAttribution(undefined, undefined);
            return {
                ...result,
                attribution,
                attributionNote: note
            };
        });
    }
    /**
     * Look up memory information for a code pointer
     * Used to get role/tags for attribution
     */
    async lookupMemoryInfo(codeId) {
        try {
            // Get project path for filtering
            const projectPath = getProjectContext().getProjectPath();
            // Query codebase_pointers table for memory associations - filtered by project
            const result = await this.db.query(`
        SELECT cp.memory_id, m.metadata->>'role' as role, m.tags
        FROM codebase_pointers cp
        JOIN memories m ON cp.memory_id = m.id
        WHERE cp.file_path = $1
          AND cp.project_path = $2
        LIMIT 1
      `, [codeId, projectPath]);
            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    memoryId: row.memory_id,
                    memoryRole: row.role,
                    memoryTags: row.tags
                };
            }
        }
        catch {
            // Table may not exist or query failed
        }
        return {};
    }
    // ============================================================================
    // CODE TRACING - Recursive caller/callee dependency tree
    // ============================================================================
    /**
     * traceCode - Build a full dependency tree for a given file
     *
     * Performs recursive caller/callee lookup to map out the complete
     * dependency graph for understanding code impact and relationships.
     *
     * @param params - TraceCodeParams with filePath, maxDepth, direction
     * @returns TraceCodeResult with tree, flat lists, and analysis
     */
    async traceCode(params) {
        const { filePath, definitionName, maxDepth = 5, direction = 'both', includeExternal = false } = params;
        logger.info({ filePath, definitionName, maxDepth, direction }, '[CodePointers] Starting code trace');
        // Get project path for filtering
        const projectPath = getProjectContext().getProjectPath();
        // Track visited nodes to detect circular dependencies
        const visited = new Set();
        const circularDeps = [];
        const flatCallers = [];
        const flatCallees = [];
        const nodeFrequency = new Map(); // Track hotspots
        // Build root node
        const root = {
            filePath,
            name: definitionName,
            depth: 0,
            direction: 'root',
            children: []
        };
        // Recursive function to build caller tree
        const buildCallerTree = async (node, currentPath) => {
            if (node.depth >= maxDepth)
                return;
            const nodeKey = node.filePath + (node.name ? `:${node.name}` : '');
            // Detect circular dependency
            if (currentPath.includes(nodeKey)) {
                circularDeps.push([...currentPath, nodeKey]);
                return;
            }
            if (visited.has(nodeKey))
                return;
            visited.add(nodeKey);
            try {
                // Query for files that import this file - filtered by project
                const query = `
          SELECT DISTINCT source_file_path, import_type, imported_names, line_number
          FROM code_dependencies
          WHERE (resolved_path = $1 OR target_path = $1)
          AND project_path = $2
          ${!includeExternal ? "AND source_file_path NOT LIKE 'node_modules%'" : ''}
          ORDER BY source_file_path
          LIMIT 50
        `;
                const result = await this.db.query(query, [node.filePath, projectPath]);
                for (const row of result.rows) {
                    // Track frequency for hotspot detection
                    const callerKey = row.source_file_path;
                    nodeFrequency.set(callerKey, (nodeFrequency.get(callerKey) || 0) + 1);
                    if (!flatCallers.includes(callerKey)) {
                        flatCallers.push(callerKey);
                    }
                    const childNode = {
                        filePath: row.source_file_path,
                        depth: node.depth + 1,
                        direction: 'caller',
                        importType: row.import_type,
                        importedNames: row.imported_names,
                        lineNumber: row.line_number,
                        children: []
                    };
                    node.children.push(childNode);
                    // Recurse
                    await buildCallerTree(childNode, [...currentPath, nodeKey]);
                }
            }
            catch (error) {
                logger.warn({ error, filePath: node.filePath }, '[CodePointers] Failed to query callers');
            }
        };
        // Recursive function to build callee tree
        const buildCalleeTree = async (node, currentPath) => {
            if (node.depth >= maxDepth)
                return;
            const nodeKey = node.filePath + (node.name ? `:${node.name}` : '');
            // Detect circular dependency
            if (currentPath.includes(nodeKey)) {
                circularDeps.push([...currentPath, nodeKey]);
                return;
            }
            // Use separate visited set for callees to allow bidirectional traversal
            const calleeVisitedKey = `callee:${nodeKey}`;
            if (visited.has(calleeVisitedKey))
                return;
            visited.add(calleeVisitedKey);
            try {
                // Query for files that this file imports - filtered by project
                const query = `
          SELECT DISTINCT target_path, resolved_path, import_type, imported_names, line_number
          FROM code_dependencies
          WHERE source_file_path = $1
          AND project_path = $2
          ${!includeExternal ? "AND target_path NOT LIKE 'node_modules%' AND (resolved_path IS NULL OR resolved_path NOT LIKE 'node_modules%')" : ''}
          ORDER BY target_path
          LIMIT 50
        `;
                const result = await this.db.query(query, [node.filePath, projectPath]);
                for (const row of result.rows) {
                    const targetPath = row.resolved_path || row.target_path;
                    // Track frequency for hotspot detection
                    nodeFrequency.set(targetPath, (nodeFrequency.get(targetPath) || 0) + 1);
                    if (!flatCallees.includes(targetPath)) {
                        flatCallees.push(targetPath);
                    }
                    const childNode = {
                        filePath: targetPath,
                        depth: node.depth + 1,
                        direction: 'callee',
                        importType: row.import_type,
                        importedNames: row.imported_names,
                        lineNumber: row.line_number,
                        children: []
                    };
                    node.children.push(childNode);
                    // Recurse
                    await buildCalleeTree(childNode, [...currentPath, nodeKey]);
                }
            }
            catch (error) {
                logger.warn({ error, filePath: node.filePath }, '[CodePointers] Failed to query callees');
            }
        };
        // Build trees based on direction
        if (direction === 'callers' || direction === 'both') {
            await buildCallerTree(root, []);
        }
        // Reset visited for callee traversal if doing both
        if (direction === 'both') {
            visited.clear();
        }
        if (direction === 'callees' || direction === 'both') {
            await buildCalleeTree(root, []);
        }
        // Count nodes recursively
        const countNodes = (node) => {
            return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
        };
        // Find max depth recursively
        const findMaxDepth = (node) => {
            if (node.children.length === 0)
                return node.depth;
            return Math.max(...node.children.map(findMaxDepth));
        };
        // Identify hotspots (files referenced more than once)
        const hotspots = Array.from(nodeFrequency.entries())
            .filter(([_, count]) => count > 1)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([path]) => path);
        // Calculate impact score (0-100)
        // Based on: total nodes, caller count, whether this is a widely-used module
        const totalNodes = countNodes(root);
        const impactScore = Math.min(100, Math.round((flatCallers.length * 5) + // Each caller adds 5 points
            (hotspots.length * 10) + // Each hotspot adds 10 points
            (circularDeps.length > 0 ? 20 : 0) // Circular deps indicate tight coupling
        ));
        const tree = {
            root,
            totalNodes,
            maxDepth: findMaxDepth(root),
            callerCount: flatCallers.length,
            calleeCount: flatCallees.length
        };
        // Generate hint for user
        const hintParts = [];
        if (flatCallers.length > 0) {
            hintParts.push(`${flatCallers.length} callers`);
        }
        if (flatCallees.length > 0) {
            hintParts.push(`${flatCallees.length} dependencies`);
        }
        if (circularDeps.length > 0) {
            hintParts.push(`${circularDeps.length} circular deps detected`);
        }
        if (hotspots.length > 0) {
            hintParts.push(`hotspots: ${hotspots.slice(0, 3).map(h => h.split('/').pop()).join(', ')}`);
        }
        const hint = hintParts.length > 0
            ? `Impact: ${impactScore}/100 | ${hintParts.join(' | ')}`
            : 'No dependencies found';
        logger.info({
            filePath,
            totalNodes,
            callerCount: flatCallers.length,
            calleeCount: flatCallees.length,
            circularCount: circularDeps.length,
            impactScore
        }, '[CodePointers] Code trace complete');
        return {
            tree,
            flatCallers,
            flatCallees,
            impactScore,
            circularDependencies: circularDeps,
            hotspots,
            _hint: hint
        };
    }
}
//# sourceMappingURL=findCodePointers.js.map