/**
 * findWhatISaid - semantic search hitting different
 *
 * uses vector similarity to find relevant memories
 * supports natural language time queries like "yesterday" or "last week"
 * also does hybrid search combining semantic + full-text for best results
 *
 * Now integrated with LWJEB event bus for memory:retrieved events
 */
import { parseTimeExpression } from '../../mcp/mcpProtocolHandler.js';
import { logger } from '../../utils/logger.js';
import { getDebugLogger } from '../../utils/debugLogger.js';
import { getCoordinator } from '../../coordination/integration.js';
import { getEmbeddingSocketPath } from '../../config.js';
import { getEmbeddingTimeout, formatTimeout } from '../../config/embeddingTimeouts.js';
import { getHotPathManager } from '../../db/hotPathManager.js';
import { smartCompress } from '../../utils/tokenCompressor.js';
import { MiniCOTProvider } from '../../providers/MiniCOTProvider.js';
import { getDimensionService } from '../../services/DimensionService.js';
import { buildProjectWhereClause, getProjectContext, getProjectPathForInsert } from '../../services/ProjectContext.js';
import { formatAsCameraRollItem, thresholdToZoomLevel, ZOOM_CONFIGS } from '../../services/CameraZoomSearch.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
import { cotStart, cotResult, cotError } from '../../utils/cotBroadcast.js';
// DEBUG LOGGING - only enabled when SPECMEM_DEBUG=1
const __debugLog = process.env['SPECMEM_DEBUG'] === '1'
    ? (...args) => console.error('[DEBUG]', ...args) // stderr, not stdout!
    : () => { };
/**
 * Extract discoverable paths from memory content
 * This is the KEY to getting lots of info from few memories
 */
function extractDiscoverablePaths(content) {
    const paths = {
        filePaths: [],
        codeBlocks: [],
        urls: [],
        memoryRefs: [],
        technicalTerms: [],
        researchQuestions: []
    };
    // Extract file paths (Unix and Windows style)
    const filePathRegex = /(?:\/[\w.-]+)+\.(?:ts|js|tsx|jsx|py|go|rs|java|json|yaml|yml|md|css|html|sql|sh)/gi;
    const fileMatches = content.match(filePathRegex);
    if (fileMatches) {
        paths.filePaths = [...new Set(fileMatches)].slice(0, 10);
    }
    // Extract code blocks with language detection
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
        const lang = match[1] || 'unknown';
        const code = match[2].trim();
        if (code.length > 10) {
            // Try to infer file path from code content
            let possiblePath;
            const importMatch = code.match(/from ['"]([^'"]+)['"]/);
            const requireMatch = code.match(/require\(['"]([^'"]+)['"]\)/);
            if (importMatch)
                possiblePath = importMatch[1];
            else if (requireMatch)
                possiblePath = requireMatch[1];
            paths.codeBlocks.push({
                language: lang,
                preview: code.substring(0, 100) + (code.length > 100 ? '...' : ''),
                fullContent: code.length > 200 ? undefined : code, // Only keep short code
                possiblePath
            });
        }
    }
    paths.codeBlocks = paths.codeBlocks.slice(0, 5);
    // Extract URLs
    const urlRegex = /https?:\/\/[^\s\])"'<>]+/g;
    const urlMatches = content.match(urlRegex);
    if (urlMatches) {
        paths.urls = [...new Set(urlMatches)].slice(0, 5);
    }
    // Extract technical terms (PascalCase classes, UPPER_CONSTANTS, function names)
    const techTermRegex = /\b(?:[A-Z][a-z]+){2,}\b|\b[A-Z][A-Z0-9_]{2,}\b|\b\w+(?:Service|Manager|Handler|Provider|Factory|Controller|Repository)\b/g;
    const techMatches = content.match(techTermRegex);
    if (techMatches) {
        paths.technicalTerms = [...new Set(techMatches)].slice(0, 10);
    }
    // Detect potential research questions (things that sound like external knowledge)
    const researchIndicators = [
        /how (?:does|do|to|can)/gi,
        /what is (?:a |the )?[\w\s]+\?/gi,
        /(?:documentation|docs|api|reference) for/gi,
        /latest version of/gi,
        /best practice for/gi
    ];
    for (const regex of researchIndicators) {
        const matches = content.match(regex);
        if (matches) {
            paths.researchQuestions.push(...matches.slice(0, 2));
        }
    }
    paths.researchQuestions = paths.researchQuestions.slice(0, 3);
    return paths;
}
/**
 * Format discoverable paths as compact Chinese-annotated hints
 * These hints guide Claude on what to explore next
 */
function formatDiscoverableHints(paths) {
    const hints = [];
    if (paths.filePaths.length > 0) {
        hints.push(`📁 文件路徑(${paths.filePaths.length}): ${paths.filePaths.slice(0, 3).join(', ')}${paths.filePaths.length > 3 ? '...' : ''}`);
    }
    if (paths.codeBlocks.length > 0) {
        const langs = [...new Set(paths.codeBlocks.map(c => c.language))].join('/');
        hints.push(`💻 代碼塊(${paths.codeBlocks.length}): ${langs}`);
    }
    if (paths.urls.length > 0) {
        hints.push(`🔗 URL(${paths.urls.length}): 可研究`);
    }
    if (paths.technicalTerms.length > 0) {
        hints.push(`🔧 技術詞: ${paths.technicalTerms.slice(0, 5).join(', ')}`);
    }
    if (paths.researchQuestions.length > 0) {
        hints.push(`❓ 研究問題: ${paths.researchQuestions.length}個待確認`);
    }
    return hints.join(' | ');
}
/**
 * Enrich a search result with discoverable paths
 * This is what makes few memories yield lots of info
 * NOW WITH CODE ORIGIN TRACKING - shows WHERE code came from!
 */
function enrichSearchResult(result) {
    const paths = extractDiscoverablePaths(result.memory.content);
    // CRITICAL: Add source origin info to each code block
    // This tells you WHERE the code came from (session, timestamp, who wrote it)
    const memoryMeta = result.memory.metadata || {};
    paths.codeBlocks = paths.codeBlocks.map(block => ({
        ...block,
        sourceMemoryId: result.memory.id,
        sourceSessionId: memoryMeta.sessionId || memoryMeta.session_id,
        sourceTimestamp: memoryMeta.timestamp || result.memory.createdAt?.toString(),
        sourceRole: memoryMeta.role || (result.memory.tags?.includes('role:user') ? 'user' :
            result.memory.tags?.includes('role:assistant') ? 'assistant' : undefined),
        sourceProject: memoryMeta.project
    }));
    const hints = formatDiscoverableHints(paths);
    return {
        ...result,
        _discoverable: paths,
        _hints: hints.length > 0 ? hints : undefined
    };
}
// Drilldown configuration - triggers intelligent prompts for user
const DRILLDOWN_THRESHOLDS = {
    lowRelevance: 0.25, // Below this, suggest deeper search
    highRelevance: 0.5, // Above this, results are good
    fewResults: 3, // Fewer than this, suggest broader search
    manyResults: 15 // More than this, suggest filtering
};
/**
 * Generate user interaction prompt based on search results
 * Returns structured data for AskUserQuestion tool
 */
function generateUserInteractionPrompt(results, query, drilldown, aggregatedPaths) {
    const resultCount = results.length;
    const topSimilarity = results[0]?.similarity ?? 0;
    // Case 1: No results - offer research options
    if (resultCount === 0) {
        return {
            shouldPromptUser: true,
            questionType: 'research',
            question: `沒有找到關於 "${query}" 的記憶。要進行網絡研究嗎?`,
            header: '研究選項',
            options: [
                { label: '快速WebSearch', description: '1-2個來源快速查找' },
                { label: '深度研究', description: '3-5個來源詳細研究' },
                { label: '跳過', description: '不需要額外資訊' }
            ],
            multiSelect: false,
            contextHint: `查詢: "${query}" | 無本地記憶 | 建議網絡研究`
        };
    }
    // Case 2: Very low relevance - offer drilldown
    if (topSimilarity < DRILLDOWN_THRESHOLDS.lowRelevance) {
        return {
            shouldPromptUser: true,
            questionType: 'drilldown',
            question: `找到 ${resultCount} 條記憶,但相關性較低 (${Math.round(topSimilarity * 100)}%)。要深入搜索嗎?`,
            header: '搜索深度',
            options: [
                { label: '深入搜索(50條)', description: '150MB RAM - 徹底搜索' },
                { label: '擴大搜索(100條)', description: '150MB RAM - 搜索所有相關' },
                { label: '網絡研究', description: '使用WebSearch獲取外部資訊' },
                { label: '使用現有結果', description: '繼續使用當前結果' }
            ],
            multiSelect: false,
            contextHint: `找到: ${resultCount}條 | 最高相似度: ${Math.round(topSimilarity * 100)}% | ${drilldown.prompt}`
        };
    }
    // Case 3: Need research - offer research options
    if (drilldown.needsResearch || aggregatedPaths.researchQuestions.length > 0) {
        const researchTopics = aggregatedPaths.researchQuestions.slice(0, 2);
        return {
            shouldPromptUser: true,
            questionType: 'research',
            question: `記憶中發現需要研究的問題。要啟動研究代理嗎?`,
            header: '研究建議',
            options: [
                { label: '啟動研究代理', description: `研究: ${researchTopics[0] || query}` },
                { label: '快速WebSearch', description: '直接搜索不啟動代理' },
                { label: '跳過研究', description: '本地記憶已足夠' }
            ],
            multiSelect: false,
            contextHint: `研究問題: ${researchTopics.join(', ') || '無'} | ${drilldown.prompt}`
        };
    }
    // Case 4: Has URLs to explore - offer to fetch
    if (aggregatedPaths.urls.length > 0) {
        return {
            shouldPromptUser: true,
            questionType: 'research',
            question: `記憶中包含 ${aggregatedPaths.urls.length} 個URL。要獲取內容嗎?`,
            header: 'URL探索',
            options: [
                { label: '獲取所有URL', description: `使用WebFetch獲取 ${aggregatedPaths.urls.length} 個URL` },
                { label: '僅查看列表', description: '不獲取,只顯示URL列表' },
                { label: '跳過', description: '不需要URL內容' }
            ],
            multiSelect: false,
            contextHint: `URL數量: ${aggregatedPaths.urls.length} | 技術詞: ${aggregatedPaths.technicalTerms.slice(0, 3).join(', ')}`
        };
    }
    // Case 5: Many results - offer filtering
    if (resultCount > DRILLDOWN_THRESHOLDS.manyResults) {
        return {
            shouldPromptUser: true,
            questionType: 'filter',
            question: `找到 ${resultCount} 條結果,較多。要過濾嗎?`,
            header: '結果過濾',
            options: [
                { label: '按相關性排序', description: '只保留最相關的10條' },
                { label: '按時間過濾', description: '只看最近的記憶' },
                { label: '查看全部', description: '不過濾,顯示所有結果' }
            ],
            multiSelect: false,
            contextHint: `找到: ${resultCount}條 | 最高: ${Math.round(topSimilarity * 100)}% | 建議過濾`
        };
    }
    // Case 6: Good results - no prompt needed, but still return confirmation structure
    if (topSimilarity >= DRILLDOWN_THRESHOLDS.highRelevance) {
        // Results are good, no user interaction needed
        return null;
    }
    // Default: Medium relevance - let Claude decide
    return null;
}
// Chinese compacted drilldown prompts (saves ~40% tokens)
const DRILLDOWN_PROMPTS = {
    // When top result has low similarity
    lowRelevance: {
        zh: '🔍 搜索結果相關性低 (相似度<25%) | 建議: 深度搜索或調整查詢',
        en: 'Low relevance results - suggest deeper search or query refinement',
        action: 'drilldown:deeper'
    },
    // When few results found
    fewResults: {
        zh: '📊 找到結果少於3條 | 建議: 擴大搜索範圍或嘗試同義詞',
        en: 'Few results found - suggest broader search or synonyms',
        action: 'drilldown:broader'
    },
    // When too many results
    manyResults: {
        zh: '📈 結果過多(>15條) | 建議: 添加過濾條件或更具體查詢',
        en: 'Too many results - suggest filtering or more specific query',
        action: 'drilldown:filter'
    },
    // When research might help
    needsResearch: {
        zh: '🌐 本地記憶不足 | 建議: WebSearch獲取最新資訊',
        en: 'Local memory insufficient - suggest web research',
        action: 'research:web'
    },
    // Good results
    goodResults: {
        zh: '✅ 找到相關記憶 | 上下文已壓縮保留',
        en: 'Relevant memories found - context compressed and preserved',
        action: 'none'
    }
};
/**
 * Analyze search results and generate drilldown suggestion
 * Returns Traditional Chinese compacted prompt for token efficiency
 */
function generateDrilldownSuggestion(results, query) {
    const resultCount = results.length;
    const topSimilarity = results[0]?.similarity ?? 0;
    // Priority 1: No results at all
    if (resultCount === 0) {
        return {
            prompt: `${DRILLDOWN_PROMPTS.needsResearch.zh}\n查詢: "${query}" → 無本地記憶匹配`,
            action: 'research:web',
            needsResearch: true
        };
    }
    // Priority 2: Very low relevance (might be asking about something new)
    if (topSimilarity < DRILLDOWN_THRESHOLDS.lowRelevance) {
        const avgSim = results.reduce((a, r) => a + r.similarity, 0) / resultCount;
        if (avgSim < 0.15) {
            // Very poor match - likely needs web research
            return {
                prompt: `${DRILLDOWN_PROMPTS.needsResearch.zh}\n最高相似度: ${Math.round(topSimilarity * 100)}% | 平均: ${Math.round(avgSim * 100)}%`,
                action: 'research:web',
                needsResearch: true
            };
        }
        return {
            prompt: `${DRILLDOWN_PROMPTS.lowRelevance.zh}\n最高相似度: ${Math.round(topSimilarity * 100)}%`,
            action: 'drilldown:deeper',
            needsResearch: false
        };
    }
    // Priority 3: Few results
    if (resultCount < DRILLDOWN_THRESHOLDS.fewResults) {
        return {
            prompt: `${DRILLDOWN_PROMPTS.fewResults.zh}\n找到: ${resultCount}條 | 最高相似度: ${Math.round(topSimilarity * 100)}%`,
            action: 'drilldown:broader',
            needsResearch: false
        };
    }
    // Priority 4: Too many results
    if (resultCount > DRILLDOWN_THRESHOLDS.manyResults) {
        return {
            prompt: `${DRILLDOWN_PROMPTS.manyResults.zh}\n找到: ${resultCount}條 | 建議過濾標籤或類型`,
            action: 'drilldown:filter',
            needsResearch: false
        };
    }
    // Good results!
    return {
        prompt: `${DRILLDOWN_PROMPTS.goodResults.zh}\n找到: ${resultCount}條 | 最高: ${Math.round(topSimilarity * 100)}%`,
        action: 'none',
        needsResearch: false
    };
}
// fr fr we track search performance
let _searchCount = 0;
let _totalSearchTime = 0;
// ============================================================================
// DRILLDOWN REMINDERS - Force Claude to actually USE the memory!
// ============================================================================
// Compact reminder - at TOP of response so Claude sees it first
const DRILLDOWN_REMINDER = `⚠️ MEMORY POINTERS - DRILL DOWN BEFORE PROCEEDING:
1. get_memory({ id }) - get FULL content of relevant memories
2. find_memory({ query: "related term" }) - check related topics
3. find_code_pointers({ query }) - explore any code paths mentioned
💡 User has discussed this before - check their context!`;
// Compact empty results reminder
const EMPTY_RESULTS_REMINDER = `⚠️ NO MEMORIES FOUND - Try these:
1. Rephrase: try synonyms, different wording
2. find_code_pointers({ query }) - search code instead
3. Remove filters (memoryTypes, tags, dateRange)`;
// ============================================================================
// HELP OUTPUT - shown when query is empty or "help"
// ============================================================================
const HELP_OUTPUT = `
# find_memory - Semantic Memory Search

Search across memories using meaning-based semantic search.
Finds content based on concepts and context, not just keywords.

## Usage

\`\`\`
find_memory({ query: "your search" })
find_memory({ query: "authentication", galleryMode: true })
find_memory({ query: "last week", role: "user" })
\`\`\`

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | string | required | Natural language search query |
| limit | number | 10 | Max results to return (max: 1000) |
| threshold | number | 0.25 | Min similarity score (0-1) |
| role | string | - | Filter by "user" or "assistant" |
| memoryTypes | array | - | Filter: episodic, semantic, procedural, working |
| tags | array | - | Filter by tags (OR logic) |
| importance | array | - | Filter: critical, high, medium, low, trivial |
| dateRange | object | - | { start, end } ISO timestamps |
| galleryMode | boolean | false | Enable Mini COT analysis (falls back to basic on error) |
| cameraRollMode | boolean | true | DEFAULT TRUE - Returns drilldownIDs for drill_down() |
| zoomLevel | string | - | ultra-wide/wide/normal/close/macro |
| summarize | boolean | true | Truncate content to save tokens |
| includeRecent | number | 0 | Force include last N recent memories |
| recencyBoost | boolean | true | Boost recent memories in ranking |
| keywordFallback | boolean | true | Fallback to keyword if semantic fails |

## Examples

### Find what the user said about a topic
\`\`\`json
{
  "query": "database migration strategy",
  "role": "user"
}
\`\`\`

### Search with date filter
\`\`\`json
{
  "query": "API authentication",
  "dateRange": { "start": "2024-01-01", "end": "2024-12-31" }
}
\`\`\`

### Camera roll mode is DEFAULT (drilldownIDs included)
\`\`\`json
{
  "query": "websocket implementation",
  "zoomLevel": "wide"
}
\`\`\`

## Drill-Down

Results always include drilldownIDs (cameraRollMode is true by default):
- Use \`drill_down({ drilldownID: 123 })\` for full content + context
- Use \`get_memory({ id: "uuid..." })\` for raw memory

## Tips

1. **Time queries**: "yesterday", "last week", "3 days ago" are parsed automatically
2. **Role filter**: Use \`role: "user"\` to find what YOU said (not Claude)
3. **Low results?**: Try \`keywordFallback: true\` and lower threshold
4. **Recent activity?**: Set \`includeRecent: 10\` to see latest memories
`;
/**
 * FindWhatISaid - semantic search tool
 *
 * fr fr this semantic search hitting different
 * combines vector similarity with optional filters for precision
 *
 * Emits LWJEB events: memory:retrieved
 */
export class FindWhatISaid {
    db;
    embeddingProvider;
    name = 'find_memory';
    description = 'Search across memories using semantic search - finds content based on meaning, not just keywords. Supports time queries like "yesterday" or "last week"';
    coordinator = getCoordinator();
    hotPathManager = null;
    debugLogger = getDebugLogger();
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'what you looking for - natural language works best. Leave empty for help.'
            },
            limit: {
                type: 'number',
                default: 10,
                minimum: 1,
                maximum: 1000,
                description: 'how many results you want'
            },
            threshold: {
                type: 'number',
                default: 0.25,
                minimum: 0,
                maximum: 1,
                description: 'minimum similarity score (0-1) - higher = more relevant. Default 0.25 filters garbage. Local embeddings: 0.2-0.5 typical for real matches.'
            },
            includeRecent: {
                type: 'number',
                default: 0,
                minimum: 0,
                maximum: 50,
                description: 'Force include the last N most recent memories regardless of similarity. Use this to check recent prompts/discussions. Set to 5-10 to see recent activity.'
            },
            recencyBoost: {
                type: 'boolean',
                default: true,
                description: 'Boost relevance of recent memories. Memories from last hour get 20% boost, last day 10% boost.'
            },
            keywordFallback: {
                type: 'boolean',
                default: true,
                description: 'If embedding search returns no results, fallback to keyword (ILIKE) search.'
            },
            memoryTypes: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['episodic', 'semantic', 'procedural', 'working', 'consolidated']
                },
                description: 'filter by memory type'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'filter by tags (OR logic)'
            },
            importance: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['critical', 'high', 'medium', 'low', 'trivial']
                },
                description: 'filter by importance level'
            },
            dateRange: {
                type: 'object',
                properties: {
                    start: { type: 'string', format: 'date-time' },
                    end: { type: 'string', format: 'date-time' }
                },
                description: 'filter by creation date range'
            },
            includeExpired: {
                type: 'boolean',
                default: false,
                description: 'include expired memories in results'
            },
            role: {
                type: 'string',
                enum: ['user', 'assistant'],
                description: 'filter by message role - use "user" to find only things YOU said, "assistant" for Claude responses'
            },
            summarize: {
                type: 'boolean',
                default: true,
                description: 'DEFAULT TRUE - returns summarized content (first 500 chars) to save context. Set to false for full content. Use get_memory with the ID for drill-down'
            },
            galleryMode: {
                oneOf: [
                    { type: 'boolean' },
                    { type: 'string', enum: ['ask'] }
                ],
                default: false,
                description: 'Enable Mini COT analysis. Falls back to basic semantic search on error. "ask"=show mode options'
            },
            maxContentLength: {
                type: 'number',
                default: 500,
                description: 'DEFAULT 500 - truncate content to this many characters. Set to 0 for no truncation. Reduces context consumption'
            },
            zoomLevel: {
                type: 'string',
                enum: ['ultra-wide', 'wide', 'normal', 'close', 'macro'],
                description: 'Camera roll zoom level: ultra-wide (50 results, 15% threshold), wide (25, 25%), normal (15, 40%), close (10, 60%), macro (5, 80%)'
            },
            cameraRollMode: {
                type: 'boolean',
                default: true,
                description: 'DEFAULT TRUE - Returns drilldownIDs for drill_down() exploration. Set to false for raw results.'
            },
            projectPath: {
                type: 'string',
                description: 'Search memories from a specific project path instead of current project. Use absolute path like "/home/user/my-other-project"'
            },
            allProjects: {
                type: 'boolean',
                default: false,
                description: 'Search ALL projects instead of just current project. Useful for cross-referencing code/patterns across repos.'
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
     * Build project filter condition for SQL queries
     * Supports: current project (default), specific project (projectPath), or all projects (allProjects)
     * Returns: { condition: string, params: unknown[], nextIndex: number }
     */
    buildProjectCondition(params, startIndex = 1) {
        const conditions = [];
        const queryParams = [];
        let nextIndex = startIndex;
        // allProjects = true: skip project filtering entirely
        if (params.allProjects) {
            // No project condition - search ALL projects
            return { conditions, queryParams, nextIndex };
        }
        // Use specified projectPath or fall back to current project
        const targetProject = params.projectPath || getProjectContext().getProjectPath();
        conditions.push(`project_path = $${nextIndex}`);
        queryParams.push(targetProject);
        nextIndex++;
        return { conditions, queryParams, nextIndex };
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
     * Validate and prepare embedding for memories table search
     */
    async prepareEmbedding(embedding, originalQuery) {
        const dimService = this.getDimService();
        const prepared = await dimService.validateAndPrepare('memories', embedding, originalQuery);
        if (prepared.wasModified) {
            logger.debug({ action: prepared.action }, 'Adjusted embedding dimension for memory search');
        }
        return prepared.embedding;
    }
    async execute(params) {
        _searchCount++;
        const startTime = Date.now();
        // ============================================================================
        // DEEP DEBUG: Method Entry
        // ============================================================================
        __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'METHOD_ENTRY', {
            query: params.query?.slice(0, 100),
            limit: params.limit,
            threshold: params.threshold,
            memoryTypes: params.memoryTypes,
            tags: params.tags,
            galleryMode: params.galleryMode,
            cameraRollMode: params.cameraRollMode,
            zoomLevel: params.zoomLevel,
            includeRecent: params.includeRecent,
            recencyBoost: params.recencyBoost,
            keywordFallback: params.keywordFallback,
            startTime,
            searchCount: _searchCount
        });
        // HELP MODE: No query = show help
        if (!params.query || params.query.trim() === '' || params.query.toLowerCase() === 'help') {
            logger.info({}, '[find_memory] Showing help - no query provided');
            const now = new Date();
            return [{
                    memory: {
                        id: 'help-output',
                        content: HELP_OUTPUT,
                        createdAt: now,
                        updatedAt: now,
                        tags: ['help', 'system'],
                        importance: 'medium',
                        memoryType: 'semantic',
                        metadata: { _isHelp: true }
                    },
                    similarity: 1.0,
                    highlights: []
                }];
        }
        logger.debug({ query: params.query, limit: params.limit }, 'searching memories fr');
        // Broadcast COT to dashboard
        cotStart('find_memory', params.query || 'browsing');
        try {
            // Apply max result limit to prevent memory issues
            const MAX_RESULTS = 1000;
            const safeLimit = Math.min(params.limit ?? 10, MAX_RESULTS);
            // humanReadable is always true - no longer configurable
            const safeParams = {
                ...params,
                limit: safeLimit
            };
            // ============================================================================
            // DEEP DEBUG: After Parameter Validation
            // ============================================================================
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'PARAMS_VALIDATED', {
                originalLimit: params.limit,
                safeLimit,
                MAX_RESULTS,
                elapsedMs: Date.now() - startTime
            });
            // ============================================================================
            // MODE SELECTION - Return options if user wants to choose
            // ============================================================================
            if (safeParams.galleryMode === 'ask') {
                logger.info({ query: safeParams.query }, 'Returning search mode options for user selection');
                const now = new Date();
                return [{
                        memory: {
                            id: 'mode-selector',
                            content: `# Search Mode Selection\n\nQuery: "${safeParams.query}"\n\nChoose your search mode:\n\n## ⚡ Basic Search (Recommended for quick lookups)\n- **Speed**: Instant (~100-500ms)\n- **Features**: Semantic similarity, keyword matching, tag filtering, drill-down hints\n- **Best for**: Quick lookups, finding specific info, browsing history\n\n## 🎨 Gallery Mode (Deep analysis)\n- **Speed**: Slower (~5-15s depending on results)\n- **Features**: Mini COT brain analyzes with Chain-of-Thought reasoning, relevance explanations, research notes for unknown terms, Traditional Chinese compression\n- **Best for**: Deep analysis, understanding complex topics, research synthesis\n- **Note**: EXPERIMENTAL - requires Mini COT service running (TinyLlama)\n\n**Recommendation**: Use BASIC for most searches. Use GALLERY when you need the AI to deeply analyze and explain the results.\n\nTo proceed, call find_memory again with:\n- \`galleryMode: false\` for Basic Search\n- \`galleryMode: true\` for Gallery Mode`,
                            createdAt: now,
                            updatedAt: now,
                            tags: ['mode-selector', 'system'],
                            importance: 'medium',
                            memoryType: 'semantic',
                            metadata: {
                                _modeOptions: {
                                    query: safeParams.query,
                                    basic: { galleryMode: false, description: 'Fast semantic + keyword search' },
                                    gallery: { galleryMode: true, description: 'Mini COT analysis with COT reasoning' }
                                }
                            }
                        },
                        similarity: 1.0,
                        highlights: []
                    }];
            }
            // check for natural language time expressions
            let dateRange = safeParams.dateRange;
            if (!dateRange) {
                const parsedTime = parseTimeExpression(safeParams.query);
                if (parsedTime) {
                    dateRange = {
                        start: parsedTime.start.toISOString(),
                        end: parsedTime.end.toISOString()
                    };
                    logger.debug({ dateRange }, 'parsed time expression from query');
                }
            }
            // generate query embedding with timeout protection
            // UNIFIED TIMEOUT CONFIG: Set SPECMEM_EMBEDDING_TIMEOUT (seconds) to control ALL timeouts
            // Or use SPECMEM_FIND_EMBEDDING_TIMEOUT_MS for specific override
            // See src/config/embeddingTimeouts.ts for full documentation
            const EMBEDDING_TIMEOUT_MS = getEmbeddingTimeout('search');
            // Get socket path for error reporting
            const socketPath = getEmbeddingSocketPath();
            // ============================================================================
            // DEEP DEBUG: Before Embedding Generation
            // ============================================================================
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'BEFORE_EMBEDDING', {
                query: safeParams.query?.slice(0, 100),
                socketPath,
                timeoutMs: EMBEDDING_TIMEOUT_MS,
                elapsedMs: Date.now() - startTime,
                embeddingProviderType: this.embeddingProvider?.constructor?.name || 'unknown'
            });
            // Debug log: Search operation starting
            this.debugLogger.searchOperation(safeParams.query, 'start', { socketPath });
            const embeddingStartTime = Date.now();
            this.debugLogger.embeddingGeneration(safeParams.query, socketPath, 'start');
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'EMBEDDING_STARTED', {
                embeddingStartTime,
                socketPath,
                query: safeParams.query?.slice(0, 50)
            });
            const embeddingPromise = this.embeddingProvider.generateEmbedding(safeParams.query);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    const timeoutError = new Error(`Embedding generation timeout after ${formatTimeout(EMBEDDING_TIMEOUT_MS)}. ` +
                        `Socket: ${socketPath}. ` +
                        `Set SPECMEM_EMBEDDING_TIMEOUT env var to increase timeout.`);
                    timeoutError.socketPath = socketPath;
                    timeoutError.code = 'EMBEDDING_TIMEOUT';
                    reject(timeoutError);
                }, EMBEDDING_TIMEOUT_MS);
            });
            let rawEmbedding;
            try {
                __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AWAITING_EMBEDDING_PROMISE', {
                    elapsedMs: Date.now() - startTime
                });
                rawEmbedding = await Promise.race([embeddingPromise, timeoutPromise]);
                const embeddingDuration = Date.now() - embeddingStartTime;
                // ============================================================================
                // DEEP DEBUG: After Embedding Generation (Success)
                // ============================================================================
                __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AFTER_EMBEDDING_SUCCESS', {
                    embeddingDuration,
                    rawEmbeddingDimension: rawEmbedding?.length,
                    rawEmbeddingFirstValues: rawEmbedding?.slice(0, 3),
                    elapsedMs: Date.now() - startTime
                });
                this.debugLogger.embeddingGeneration(safeParams.query, socketPath, 'complete', {
                    durationMs: embeddingDuration,
                    dimension: rawEmbedding.length
                });
            }
            catch (embeddingError) {
                const embeddingDuration = Date.now() - embeddingStartTime;
                const err = embeddingError;
                // ============================================================================
                // DEEP DEBUG: After Embedding Generation (Error)
                // ============================================================================
                __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AFTER_EMBEDDING_ERROR', {
                    embeddingDuration,
                    errorMessage: err?.message?.slice(0, 200),
                    errorCode: err?.code,
                    errorName: err?.name,
                    socketPath,
                    elapsedMs: Date.now() - startTime
                });
                // Enhanced error with socket path info
                this.debugLogger.embeddingGeneration(safeParams.query, socketPath, err.message.includes('timeout') ? 'timeout' : 'error', {
                    durationMs: embeddingDuration,
                    error: err
                });
                // Re-throw with enhanced message including socket path
                const enhancedError = new Error(`Embedding generation failed: ${err.message}. ` +
                    `Socket path: ${socketPath}. ` +
                    `Duration: ${embeddingDuration}ms. ` +
                    `Troubleshooting: Check if embedding service is running (ps aux | grep frankenstein), ` +
                    `verify socket exists (ls -la ${socketPath}), check SPECMEM_DEBUG=true for more logs.`);
                enhancedError.originalError = err;
                enhancedError.socketPath = socketPath;
                enhancedError.durationMs = embeddingDuration;
                enhancedError.code = err.code || 'EMBEDDING_ERROR';
                throw enhancedError;
            }
            // Validate and prepare embedding dimension using DimensionService
            const queryEmbedding = await this.prepareEmbedding(rawEmbedding, safeParams.query);
            // Debug log: Embedding phase complete
            this.debugLogger.searchOperation(safeParams.query, 'embedding', {
                durationMs: Date.now() - embeddingStartTime,
                socketPath
            });
            // DEBUG: Log query embedding dimension and first few values
            logger.info({
                queryEmbeddingDim: queryEmbedding.length,
                query: safeParams.query,
                firstValues: queryEmbedding.slice(0, 3),
                socketPath
            }, 'Generated query embedding');
            // do the search with timeout protection
            // UNIFIED TIMEOUT CONFIG: See src/config/embeddingTimeouts.ts
            // Uses 'dbSearch' timeout (6x master, or SPECMEM_FIND_SEARCH_TIMEOUT_MS)
            const SEARCH_TIMEOUT_MS = getEmbeddingTimeout('dbSearch');
            // ============================================================================
            // DEEP DEBUG: Before Database Query
            // ============================================================================
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'BEFORE_DB_QUERY', {
                queryEmbeddingDimension: queryEmbedding?.length,
                searchTimeoutMs: SEARCH_TIMEOUT_MS,
                dateRange: dateRange ? { start: dateRange.start, end: dateRange.end } : null,
                memoryTypes: safeParams.memoryTypes,
                tags: safeParams.tags,
                limit: safeParams.limit,
                threshold: safeParams.threshold,
                elapsedMs: Date.now() - startTime
            });
            // Debug log: Search phase starting
            this.debugLogger.searchOperation(safeParams.query, 'search');
            const searchStartTime = Date.now();
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'DB_QUERY_STARTED', {
                searchStartTime,
                query: safeParams.query?.slice(0, 50)
            });
            const searchPromise = this.semanticSearch({
                ...safeParams,
                dateRange
            }, queryEmbedding);
            const searchTimeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    const timeoutError = new Error(`Search timeout after ${formatTimeout(SEARCH_TIMEOUT_MS)}. ` +
                        `Query: "${safeParams.query.slice(0, 50)}...". ` +
                        `Set SPECMEM_EMBEDDING_TIMEOUT env var to increase timeout.`);
                    timeoutError.code = 'SEARCH_TIMEOUT';
                    reject(timeoutError);
                }, SEARCH_TIMEOUT_MS);
            });
            let results;
            try {
                __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AWAITING_DB_QUERY_PROMISE', {
                    elapsedMs: Date.now() - startTime
                });
                results = await Promise.race([searchPromise, searchTimeoutPromise]);
                const searchDuration = Date.now() - searchStartTime;
                // ============================================================================
                // DEEP DEBUG: After Database Query (Success)
                // ============================================================================
                __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AFTER_DB_QUERY_SUCCESS', {
                    searchDuration,
                    resultCount: results?.length,
                    topSimilarity: results?.[0]?.similarity,
                    topMemoryId: results?.[0]?.memory?.id?.slice(0, 20),
                    elapsedMs: Date.now() - startTime
                });
                this.debugLogger.searchOperation(safeParams.query, 'complete', {
                    durationMs: searchDuration,
                    resultCount: results.length
                });
            }
            catch (searchError) {
                const searchDuration = Date.now() - searchStartTime;
                const err = searchError;
                // ============================================================================
                // DEEP DEBUG: After Database Query (Error)
                // ============================================================================
                __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AFTER_DB_QUERY_ERROR', {
                    searchDuration,
                    errorMessage: err?.message?.slice(0, 200),
                    errorCode: err?.code,
                    errorName: err?.name,
                    elapsedMs: Date.now() - startTime
                });
                // Enhanced debug logging for search errors
                this.debugLogger.searchOperation(safeParams.query, 'error', {
                    durationMs: searchDuration,
                    error: err,
                    socketPath
                });
                // Re-throw with enhanced context
                const enhancedError = new Error(`Search failed: ${err.message}. ` +
                    `Duration: ${searchDuration}ms. ` +
                    `Query: "${safeParams.query.slice(0, 50)}...". ` +
                    `Socket: ${socketPath}. ` +
                    `Enable SPECMEM_DEBUG=true for detailed logs.`);
                enhancedError.originalError = err;
                enhancedError.code = err.code || 'SEARCH_ERROR';
                enhancedError.durationMs = searchDuration;
                throw enhancedError;
            }
            // ============================================================================
            // I5 FIX: APPLY NEW SEARCH FEATURES
            // ============================================================================
            // ============================================================================
            // DEEP DEBUG: Before Result Processing
            // ============================================================================
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'BEFORE_RESULT_PROCESSING', {
                rawResultCount: results?.length,
                topRawSimilarity: results?.[0]?.similarity,
                elapsedMs: Date.now() - startTime
            });
            // I5 FIX: Get includeRecent, recencyBoost, keywordFallback from params
            const includeRecentCount = safeParams.includeRecent ?? 0;
            const applyRecencyBoost = safeParams.recencyBoost !== false; // Default true
            const useKeywordFallback = safeParams.keywordFallback !== false; // Default true
            logger.info({
                query: safeParams.query,
                semanticResultCount: results.length,
                includeRecent: includeRecentCount,
                recencyBoost: applyRecencyBoost,
                keywordFallback: useKeywordFallback
            }, '[I5 FIX] Search phase 1 complete, applying fixes');
            // I5 FIX: Apply recency boost to semantic results
            if (applyRecencyBoost && results.length > 0) {
                results = this.applyRecencyBoost(results);
                logger.debug({ boostedCount: results.length }, '[I5 FIX] Recency boost applied');
            }
            // I5 FIX: Keyword fallback if semantic search returned nothing useful
            let keywordResults = [];
            const hasGoodSemanticResults = results.length > 0 && results[0]?.similarity >= 0.15;
            if (useKeywordFallback && !hasGoodSemanticResults) {
                logger.info({
                    query: safeParams.query,
                    semanticResults: results.length,
                    topSimilarity: results[0]?.similarity
                }, '[I5 FIX] Low/no semantic results, triggering keyword fallback');
                keywordResults = await this.keywordSearch(safeParams.query, safeParams);
            }
            // I5 FIX: Get recent memories if requested
            let recentResults = [];
            if (includeRecentCount > 0) {
                recentResults = await this.getRecentMemories(includeRecentCount, safeParams);
                logger.info({
                    recentRequested: includeRecentCount,
                    recentFound: recentResults.length
                }, '[I5 FIX] Recent memories retrieved');
            }
            // I5 FIX: Merge all results if we have additional sources
            if (recentResults.length > 0 || keywordResults.length > 0) {
                const originalCount = results.length;
                results = this.mergeAndDedupeResults(results, recentResults, keywordResults, safeParams.limit ?? 10);
                logger.info({
                    originalSemanticCount: originalCount,
                    recentCount: recentResults.length,
                    keywordCount: keywordResults.length,
                    mergedCount: results.length
                }, '[I5 FIX] Results merged from multiple sources');
            }
            const duration = Date.now() - startTime;
            _totalSearchTime += duration;
            // ============================================================================
            // DEEP DEBUG: After Result Processing
            // ============================================================================
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'AFTER_RESULT_PROCESSING', {
                finalResultCount: results?.length,
                topFinalSimilarity: results?.[0]?.similarity,
                usedKeywordFallback: keywordResults?.length > 0,
                keywordResultCount: keywordResults?.length,
                usedRecentMemories: recentResults?.length > 0,
                recentResultCount: recentResults?.length,
                totalDurationMs: duration,
                avgSearchTimeMs: _totalSearchTime / _searchCount,
                elapsedMs: Date.now() - startTime
            });
            logger.info({
                resultCount: results.length,
                duration,
                avgSearchTime: _totalSearchTime / _searchCount,
                usedKeywordFallback: keywordResults.length > 0,
                usedRecentMemories: recentResults.length > 0
            }, 'search complete with I5 fixes');
            // Log warning if search was slow
            if (duration > 1000) {
                logger.warn({ duration, query: safeParams.query }, 'slow search detected');
            }
            // Generate drilldown suggestion based on results
            const drilldown = generateDrilldownSuggestion(results, safeParams.query);
            // Log drilldown analysis
            logger.info({
                query: safeParams.query,
                resultCount: results.length,
                topSimilarity: results[0]?.similarity,
                drilldownAction: drilldown.action,
                needsResearch: drilldown.needsResearch
            }, '[Drilldown] 分析完成');
            // Handle empty results with informative message
            if (results.length === 0) {
                logger.info({ query: safeParams.query, filters: { memoryTypes: safeParams.memoryTypes, tags: safeParams.tags } }, 'no results found for query');
                // Always use humanReadable format
                return formatHumanReadable('find_memory', [], {
                    grey: true,
                    showSimilarity: true,
                    query: safeParams.query,
                    emptyMessage: `No memories found for "${safeParams.query}". Try: broader terms, check_sync, or save_memory to add context.`
                });
            }
            // ============================================================================
            // GALLERY MODE - Mini COT Decision Model creates semantic gallery
            // ============================================================================
            if (safeParams.galleryMode === true) {
                logger.info({ query: safeParams.query, resultCount: results.length }, 'Gallery mode enabled - sending to Mini COT');
                try {
                    const miniCOT = new MiniCOTProvider();
                    // Prepare memories for gallery creation (send ENGLISH to CoT!)
                    const memoriesForGallery = results.map(result => ({
                        id: result.memory.id,
                        keywords: result.memory.metadata?._semanticHints || result.memory.tags.join(', '),
                        snippet: result.memory.content.slice(0, 300), // First 300 chars
                        timestamp: result.memory.metadata?.timestamp, // When it was said
                        role: result.memory.metadata?.role // Who said it (user/assistant)
                    }));
                    // Call Mini COT to create gallery (CoT analyzes in ENGLISH)
                    const gallery = await miniCOT.createGallery(safeParams.query, memoriesForGallery);
                    // ROUND-TRIP VERIFIED compression - compress CoT OUTPUT for token efficiency
                    // Uses smartCompress: EN→Chinese→EN comparison, keeps English where context lost
                    // MED-40 FIX: Add null check before compression to avoid undefined errors
                    gallery.gallery = gallery.gallery.map(item => ({
                        ...item,
                        thumbnail: item.thumbnail ? smartCompress(item.thumbnail, { threshold: 0.75 }).result : '',
                        cot: item.cot ? smartCompress(item.cot, { threshold: 0.75 }).result : ''
                    }));
                    logger.info({
                        query: safeParams.query,
                        galleryItems: gallery.gallery.length,
                        researchedTerms: gallery.total_researched_terms
                    }, 'Gallery created by Mini COT and compressed');
                    // Always use humanReadable format
                    const humanReadableData = gallery.gallery.map((item, idx) => ({
                        id: item.id || `gallery-${idx}`,
                        similarity: item.relevance ? item.relevance / 100 : 0.5,
                        content: `[GALLERY] ${item.thumbnail || item.cot || 'No preview'}`,
                    }));
                    return formatHumanReadable('find_memory', humanReadableData, {
                        grey: true,
                        showSimilarity: true,
                        query: safeParams.query,
                        mode: 'gallery'
                    });
                }
                catch (error) {
                    logger.error({ error, query: safeParams.query }, 'Mini COT gallery creation failed - falling back to normal results');
                    // Fall through to normal results on error
                }
            }
            // ============================================================================
            // CAMERA ROLL MODE - Default TRUE - zoom-based response format with drilldownIDs
            // ============================================================================
            // DEFAULT TRUE: Only disable if explicitly set to false
            const cameraRollModeRaw = safeParams.cameraRollMode;
            const cameraRollMode = cameraRollModeRaw !== false && cameraRollModeRaw !== 'false' && cameraRollModeRaw !== 0;
            const zoomLevelParam = safeParams.zoomLevel;
            logger.debug({
                cameraRollMode,
                cameraRollModeRaw,
                zoomLevelParam
            }, '[find_memory] Camera roll mode check (default: true)');
            if (cameraRollMode) {
                // Determine zoom level from parameter or threshold
                const zoomLevel = zoomLevelParam || thresholdToZoomLevel(safeParams.threshold ?? 0.1);
                const zoomConfig = ZOOM_CONFIGS[zoomLevel];
                logger.info({
                    query: safeParams.query,
                    zoomLevel,
                    resultCount: results.length,
                    threshold: zoomConfig.threshold
                }, 'Camera roll mode enabled');
                // Convert results to camera roll format
                const cameraRollItems = results.map(result => {
                    // Try to find Claude Response if this is a user message
                    const metadata = result.memory.metadata || {};
                    const claudeResponse = metadata.claudeResponse || metadata.response;
                    return formatAsCameraRollItem({
                        id: result.memory.id,
                        content: result.memory.content,
                        similarity: result.similarity,
                        metadata,
                        tags: result.memory.tags,
                        createdAt: result.memory.createdAt
                    }, zoomConfig, {
                        claudeResponse,
                        relatedCount: metadata.relatedCount,
                        codePointers: metadata.codePointers
                    });
                });
                // Always use humanReadable format
                const humanReadableData = cameraRollItems.map((item) => ({
                    id: item.drilldownID || item.id,
                    similarity: item.similarity || 0.5,
                    content: item.preview || item.content || 'No preview',
                }));
                return formatHumanReadable('find_memory', humanReadableData, {
                    grey: true,
                    showSimilarity: true,
                    query: safeParams.query,
                    mode: 'camera_roll',
                    zoomLevel
                });
            }
            // ============================================================================
            // CONTEXT ENRICHMENT PIPELINE
            // Like human memory: fragment -> connections -> deeper recall
            // ONLY when NOT in summarize mode - drill-down should be MINIMAL
            // ============================================================================
            // CLEAN OUTPUT - Show conversation pairs:
            // Claude: <response>
            // UP: <user prompt that triggered it>
            // Default mode (summarize=true)
            // User feedback: "content wayyy too trimmed" - increased default
            if (safeParams.summarize !== false) {
                const maxContentLen = safeParams.maxContentLength || 1000; // Was 500
                const halfLen = Math.floor(maxContentLen / 2); // 500 each for user/claude
                // Helper to strip [CLAUDE] and [USER] prefixes
                const stripPrefix = (text) => {
                    return text.replace(/^\[CLAUDE\]\s*/i, '').replace(/^\[USER\]\s*/i, '').trim();
                };
                // Helper to check if content is tool usage noise
                // IMPROVED: Check for tool calls anywhere in content, not just start
                const isToolNoise = (text) => {
                    if (!text)
                        return false;
                    // Tool call patterns to filter
                    const toolPatterns = [
                        /\[Tools?:\s*\w+\]/i,
                        /\[(?:Bash|Read|Write|Edit|Grep|Glob|Task|WebFetch|WebSearch|NotebookEdit):/i,
                        /^(?:Bash|Read|Write|Edit|Grep|Glob)\s*$/i, // Tool name only
                        /^\s*\{[\s\S]*"tool":\s*"\w+"/ // JSON tool call format
                    ];
                    return toolPatterns.some(p => p.test(text.slice(0, 200)));
                };
                // Helper to parse content that already contains both [USER] and [CLAUDE]
                const parseInlineConversation = (text) => {
                    if (!text)
                        return null;
                    const userMatch = text.match(/\[USER\]\s*([^\[]*)/i);
                    const claudeMatch = text.match(/\[CLAUDE\]\s*([\s\S]*?)(?:\[USER\]|$)/i);
                    if (userMatch && claudeMatch && userMatch[1].trim() && claudeMatch[1].trim()) {
                        return {
                            user: userMatch[1].trim(),
                            claude: claudeMatch[1].trim()
                        };
                    }
                    return null;
                };
                // Build conversation-style output
                const formattedResults = await Promise.all(results.map(async (r) => {
                    // CRITICAL FIX: Ensure metadata is never null/undefined before accessing properties
                    const metadata = r.memory.metadata ?? {};
                    // SKIP tool noise memories entirely
                    if (isToolNoise(r.memory.content)) {
                        return null; // Will be filtered out
                    }
                    // FIRST: Check if content already has both [USER] and [CLAUDE] parts
                    // If so, parse directly without paired lookup
                    const inlineParsed = parseInlineConversation(r.memory.content || '');
                    if (inlineParsed) {
                        const userPart = inlineParsed.user.length > halfLen
                            ? inlineParsed.user.slice(0, halfLen) + '...'
                            : inlineParsed.user;
                        const claudePart = inlineParsed.claude.length > halfLen
                            ? inlineParsed.claude.slice(0, halfLen) + '...'
                            : inlineParsed.claude;
                        return {
                            id: r.memory.id,
                            user: userPart,
                            claude: claudePart,
                            relevance: Math.round(r.similarity * 100) + '%'
                        };
                    }
                    // Extract role with multiple fallback strategies
                    const role = metadata.role
                        || (r.memory.tags?.includes('role:user') ? 'user' : null)
                        || (r.memory.tags?.includes('role:assistant') ? 'assistant' : null)
                        // Content-based role detection as fallback
                        || (r.memory.content?.startsWith('[CLAUDE]') ? 'assistant' : null)
                        || (r.memory.content?.startsWith('[USER]') ? 'user' : null)
                        || undefined;
                    // CRITICAL FIX: Check both camelCase and snake_case for sessionId
                    // Also check tags for session info as ultimate fallback
                    let sessionId = metadata.sessionId || metadata.session_id;
                    // Fallback: Check tags for session info (format: "session:xxx")
                    if (!sessionId && r.memory.tags) {
                        const sessionTag = r.memory.tags.find((tag) => tag.startsWith('session:'));
                        if (sessionTag) {
                            sessionId = sessionTag.replace('session:', '');
                        }
                    }
                    // DEBUG: Log session extraction with all checked sources
                    logger.debug({
                        memoryId: r.memory.id,
                        sessionId,
                        sessionIdSource: metadata.sessionId ? 'metadata.sessionId'
                            : metadata.session_id ? 'metadata.session_id'
                                : sessionId ? 'tags' : 'none',
                        role,
                        timestamp: metadata.timestamp,
                        hasMetadata: !!r.memory.metadata
                    }, '[PAIRING] Session extraction for memory');
                    let content = stripPrefix(r.memory.content || '');
                    // Trim content to half length
                    if (content.length > halfLen) {
                        content = content.slice(0, halfLen) + '...';
                    }
                    // DYNAMIC PAIRED MESSAGE LOOKUP
                    // Try multiple strategies to find the paired user/claude message
                    let pairedContent;
                    const memoryTimestamp = metadata.timestamp || r.memory.createdAt?.toISOString();
                    const pairedRole = role === 'assistant' ? 'user' : 'assistant';
                    // CROSS-PROJECT FIX: Use memory's own project_path for paired lookup
                    // This ensures paired messages are found from the same project as the result
                    const projectPath = metadata.project_path || getProjectContext().getProjectPath();
                    try {
                        let pairedQuery;
                        // Track if we found a session-scoped result (prevents cross-session fallback)
                        let foundInSession = false;
                        // Strategy 1: Same session (if sessionId exists)
                        // IMPORTANT: Use metadata->>'timestamp' (original time) NOT created_at (bulk import time)
                        // EXCLUDE tool calls - they're not useful context
                        // CRITICAL FIX: If sessionId exists, we MUST only return pairs from the SAME session
                        // Do NOT fall through to cross-session strategies when sessionId is present
                        // FIX: Check both camelCase 'sessionId' and snake_case 'session_id' in SQL
                        if (sessionId && memoryTimestamp) {
                            if (role === 'assistant') {
                                // Claude response -> find user prompt BEFORE it
                                pairedQuery = await this.db.query(`
                  SELECT content FROM memories
                  WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
                    AND (metadata->>'role' = 'user' OR 'role:user' = ANY(tags))
                    AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz < $2::timestamptz
                    AND content NOT LIKE '%[Tools:%'
                  ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz DESC
                  LIMIT 1
                `, [sessionId, memoryTimestamp]);
                            }
                            else {
                                // User prompt -> find Claude response AFTER it (skip tool calls!)
                                pairedQuery = await this.db.query(`
                  SELECT content FROM memories
                  WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
                    AND (metadata->>'role' = 'assistant' OR 'role:assistant' = ANY(tags))
                    AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz > $2::timestamptz
                    AND content NOT LIKE '%[Tools:%'
                  ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz ASC
                  LIMIT 1
                `, [sessionId, memoryTimestamp]);
                            }
                            // SIMPLIFIED PAIRING LOGIC (3 strategies max)
                            // Pattern: user types → prompt saved → claude responds → response saved AFTER
                            // So for user prompts: look for NEXT assistant message
                            // For assistant responses: look for PREVIOUS user message
                            if (pairedQuery && pairedQuery.rows.length > 0) {
                                foundInSession = true;
                            }
                            else {
                                // Strategy 1: Same session - find adjacent message with opposite role
                                // User prompt → next assistant response in session
                                // Assistant response → previous user prompt in session
                                if (role === 'user') {
                                    // Find NEXT assistant message in this session (Claude's response to this prompt)
                                    pairedQuery = await this.db.query(`
                    SELECT content FROM memories
                    WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
                      AND (metadata->>'role' = 'assistant' OR 'role:assistant' = ANY(tags))
                      AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz > $2::timestamptz
                      AND content NOT LIKE '%[Tools:%'
                    ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz ASC
                    LIMIT 1
                  `, [sessionId, memoryTimestamp]);
                                }
                                else {
                                    // Find PREVIOUS user message in this session (the prompt Claude responded to)
                                    pairedQuery = await this.db.query(`
                    SELECT content FROM memories
                    WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
                      AND (metadata->>'role' = 'user' OR 'role:user' = ANY(tags))
                      AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz < $2::timestamptz
                      AND content NOT LIKE '%[Tools:%'
                    ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz DESC
                    LIMIT 1
                  `, [sessionId, memoryTimestamp]);
                                }
                                if (pairedQuery && pairedQuery.rows.length > 0) {
                                    foundInSession = true;
                                }
                            }
                        }
                        // ============================================================================
                        // NO-SESSION FALLBACK (Strategies 2-3) - ONLY when NO sessionId exists
                        // ============================================================================
                        else if (memoryTimestamp) {
                            // Strategy 2: Same project - find adjacent message by timestamp
                            // Simple: user → next assistant, assistant → previous user
                            if (!pairedQuery || pairedQuery.rows.length === 0) {
                                if (role === 'user') {
                                    // Find NEXT assistant message in project
                                    pairedQuery = await this.db.query(`
                    SELECT content FROM memories
                    WHERE (metadata->>'role' = 'assistant' OR 'role:assistant' = ANY(tags))
                      AND metadata->>'project_path' = $1
                      AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz > $2::timestamptz
                      AND content NOT LIKE '%[Tools:%'
                    ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz ASC
                    LIMIT 1
                  `, [projectPath, memoryTimestamp]);
                                }
                                else {
                                    // Find PREVIOUS user message in project
                                    pairedQuery = await this.db.query(`
                    SELECT content FROM memories
                    WHERE (metadata->>'role' = 'user' OR 'role:user' = ANY(tags))
                      AND metadata->>'project_path' = $1
                      AND COALESCE(metadata->>'timestamp', created_at::text)::timestamptz < $2::timestamptz
                      AND content NOT LIKE '%[Tools:%'
                    ORDER BY COALESCE(metadata->>'timestamp', created_at::text)::timestamptz DESC
                    LIMIT 1
                  `, [projectPath, memoryTimestamp]);
                                }
                            }
                            // Strategy 3: ULTIMATE FALLBACK - closest opposite role in project by timestamp
                            // Only if strategy 2 found nothing
                            if (!pairedQuery || pairedQuery.rows.length === 0) {
                                pairedQuery = await this.db.query(`
                  SELECT content FROM memories
                  WHERE (metadata->>'role' = $1 OR $2 = ANY(tags))
                    AND metadata->>'project_path' = $3
                    AND id != $5
                    AND content NOT LIKE '%[Tools:%'
                  ORDER BY ABS(EXTRACT(EPOCH FROM (
                    COALESCE(metadata->>'timestamp', created_at::text)::timestamptz - $4::timestamptz
                  )))
                  LIMIT 1
                `, [pairedRole, `role:${pairedRole}`, projectPath, memoryTimestamp, r.memory.id]);
                            }
                        } // end no-session fallback block
                        if (pairedQuery && pairedQuery.rows.length > 0) {
                            pairedContent = stripPrefix(pairedQuery.rows[0].content);
                            logger.debug({
                                memoryId: r.memory.id,
                                sessionId,
                                pairedContentPreview: pairedContent.slice(0, 50),
                                pairedRole: role === 'assistant' ? 'user' : 'assistant'
                            }, '[PAIRING] Found paired message');
                            if (pairedContent.length > halfLen) {
                                pairedContent = pairedContent.slice(0, halfLen) + '...';
                            }
                        }
                        else {
                            logger.debug({
                                memoryId: r.memory.id,
                                sessionId,
                                role,
                                timestamp: metadata.timestamp
                            }, '[PAIRING] No paired message found');
                        }
                    }
                    catch (e) {
                        // Ignore - paired lookup is optional
                        logger.debug({ error: e, sessionId }, 'Paired message lookup failed');
                    }
                    // ALWAYS show both user: and claude: fields
                    // Format: { user: "what user said", claude: "what claude said", relevance: "X%" }
                    if (role === 'assistant') {
                        return {
                            id: r.memory.id,
                            user: pairedContent || '(no user prompt found)',
                            claude: content,
                            relevance: Math.round(r.similarity * 100) + '%'
                        };
                    }
                    else {
                        // role === 'user' or undefined
                        return {
                            id: r.memory.id,
                            user: content,
                            claude: pairedContent || '', // Empty if no paired response found
                            relevance: Math.round(r.similarity * 100) + '%'
                        };
                    }
                })).then(results => results.filter((r) => r !== null));
                // Always use humanReadable format
                const humanReadableData = formattedResults.map(r => ({
                    id: r.id,
                    similarity: parseFloat(r.relevance) / 100,
                    // Only include [CLAUDE] if there's actual content (length > 0)
                    content: r.claude && r.claude.length > 0 ? `[USER] ${r.user}\n[CLAUDE] ${r.claude}` : `[USER] ${r.user}`,
                }));
                return formatHumanReadable('find_memory', humanReadableData, {
                    grey: true,
                    showSimilarity: true,
                    maxContentLength: safeParams.maxContentLength || 500,
                    query: safeParams.query
                });
            }
            // FULL MODE: Enrich results with discoverable paths
            // Step 1: Enrich each result with discoverable paths
            const enrichedResults = results.map(enrichSearchResult);
            // Step 2: Aggregate all discoverable paths across results
            const aggregatedPaths = this.aggregateDiscoverablePaths(enrichedResults);
            // Step 3: Generate context enrichment summary (Chinese compacted)
            const contextEnrichment = this.generateContextEnrichment(safeParams.query, enrichedResults, aggregatedPaths, drilldown);
            // Step 4: Log enrichment for debugging
            logger.info({
                query: safeParams.query,
                filesFound: aggregatedPaths.filePaths.length,
                codeBlocksFound: aggregatedPaths.codeBlocks.length,
                urlsFound: aggregatedPaths.urls.length,
                techTermsFound: aggregatedPaths.technicalTerms.length,
                researchQuestionsFound: aggregatedPaths.researchQuestions.length
            }, '[ContextEnricher] 發現可探索路徑');
            // update access counts for returned memories (non-blocking)
            if (results.length > 0) {
                // Fire and forget - don't block on access count updates
                this.updateAccessCounts(results.map(r => r.memory.id)).catch(err => {
                    logger.warn({ error: err }, 'failed to update access counts');
                });
                // Emit memory:retrieved event via LWJEB
                this.coordinator.emitMemoryRetrieved(results.map(r => r.memory.id), safeParams.query);
                // Record access for hot path tracking (non-blocking)
                // This helps build memory access patterns for prediction
                this.recordAccessPatterns(results.map(r => r.memory.id)).catch(err => {
                    logger.debug({ error: err }, 'failed to record access patterns (non-critical)');
                });
            }
            // Step 5: Generate user interaction prompt for CLI control
            const userInteractionPrompt = generateUserInteractionPrompt(results, safeParams.query, drilldown, aggregatedPaths);
            // Step 6: Format research spawn instructions if needed
            const researchSpawnInstructions = drilldown.needsResearch
                ? this.generateResearchSpawnInstructions(safeParams.query, aggregatedPaths)
                : null;
            // ============================================================================
            // DEEP DEBUG: Method Exit (Success)
            // ============================================================================
            const finalDuration = Date.now() - startTime;
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'METHOD_EXIT_SUCCESS', {
                finalDuration,
                enrichedResultCount: enrichedResults?.length,
                query: safeParams.query?.slice(0, 50)
            });
            // Broadcast COT result to dashboard
            cotResult('find_memory', `Found ${enrichedResults?.length || 0} memories`, enrichedResults?.length || 0);
            // Always use humanReadable format
            const humanReadableData = enrichedResults.map(r => ({
                id: r.memory.id,
                drilldownID: r.drilldownID,
                similarity: r.similarity,
                content: r.memory.content,
                tags: r.memory.tags,
                type: r.memory.memoryType,
                importance: r.memory.importance,
                createdAt: r.memory.createdAt
            }));
            return formatHumanReadable('find_memory', humanReadableData, {
                grey: true,
                showSimilarity: true,
                showTags: true,
                maxContentLength: safeParams.maxContentLength || 300,
                query: safeParams.query // Pass query for header display
            });
        }
        catch (error) {
            const duration = Date.now() - startTime;
            // Broadcast COT error to dashboard
            cotError('find_memory', error?.message?.slice(0, 100) || 'Unknown error');
            // ============================================================================
            // DEEP DEBUG: Method Exit (Error)
            // ============================================================================
            __debugLog('[FIND_MEMORY DEBUG]', Date.now(), 'METHOD_EXIT_ERROR', {
                duration,
                errorMessage: error?.message?.slice(0, 200),
                errorCode: error?.code,
                errorName: error?.name,
                query: params.query?.slice(0, 50)
            });
            // Get socket path for error context (may fail if error occurred before socketPath was set)
            let errorSocketPath = 'unknown';
            try {
                errorSocketPath = getEmbeddingSocketPath();
            }
            catch {
                // Ignore - socket path detection may have failed
            }
            // Extract error details for comprehensive logging
            const err = error;
            // Enhanced error logging with all context
            logger.error({
                error: {
                    message: err.message,
                    code: err.code,
                    stack: err.stack?.slice(0, 1000),
                    socketPath: err.socketPath || errorSocketPath,
                    durationMs: err.durationMs
                },
                query: params.query?.slice(0, 100),
                duration,
                socketPath: errorSocketPath,
                debug: process.env['SPECMEM_DEBUG'] === 'true'
            }, 'search failed - see error details for troubleshooting');
            // Debug log the error with full context
            this.debugLogger.searchOperation(params.query || '', 'error', {
                durationMs: duration,
                error: err,
                socketPath: errorSocketPath
            });
            // Build comprehensive error message for MCP response
            const errorCode = err.code || 'UNKNOWN_ERROR';
            let userMessage;
            switch (errorCode) {
                case 'EMBEDDING_TIMEOUT':
                    userMessage = `Embedding service timeout (${duration}ms). ` +
                        `Socket: ${err.socketPath || errorSocketPath}. ` +
                        `Check: 1) Is embedding service running? (ps aux | grep frankenstein) ` +
                        `2) Socket exists? (ls -la ${err.socketPath || errorSocketPath}) ` +
                        `3) Service healthy? (check logs in /tmp/specmem-*/embedding.log)`;
                    break;
                case 'SEARCH_TIMEOUT':
                    userMessage = `Database search timeout (${duration}ms). ` +
                        `Check: 1) Database connection (pg_isready) ` +
                        `2) Query complexity - try simpler terms ` +
                        `3) Database load (check pg_stat_activity)`;
                    break;
                case 'EMBEDDING_ERROR':
                    userMessage = `Embedding generation failed: ${err.message}. ` +
                        `Socket: ${err.socketPath || errorSocketPath}. ` +
                        `This could be: socket not found, service not running, or input too long.`;
                    break;
                case 'SEARCH_ERROR':
                    userMessage = `Search query failed: ${err.message}. ` +
                        `Check database connection and query syntax.`;
                    break;
                default:
                    userMessage = `find_memory error: ${err.message}. ` +
                        `Socket: ${errorSocketPath}. ` +
                        `Duration: ${duration}ms. ` +
                        `Enable SPECMEM_DEBUG=true for detailed logs.`;
            }
            // Create error that will be properly serialized in MCP response
            const mcpError = new Error(userMessage);
            mcpError.code = errorCode;
            mcpError.socketPath = err.socketPath || errorSocketPath;
            mcpError.durationMs = duration;
            mcpError.query = params.query?.slice(0, 50);
            mcpError.troubleshooting = {
                enableDebug: 'Set SPECMEM_DEBUG=true for detailed logs',
                checkSocket: `ls -la ${err.socketPath || errorSocketPath}`,
                checkService: 'ps aux | grep frankenstein',
                checkLogs: 'tail -f /tmp/specmem-*/mcp-startup.log'
            };
            throw mcpError;
        }
    }
    /**
     * semanticSearch - the main search logic
     *
     * uses pgvector for cosine similarity search
     * applies filters for type, tags, importance, dates
     */
    async semanticSearch(params, queryEmbedding) {
        // build the query dynamically based on filters
        const conditions = ['embedding IS NOT NULL'];
        const queryParams = [];
        let paramIndex = 1;
        // IMPORTANT: Embedding MUST be $1 for the vector similarity query
        // Add embedding first as $1
        queryParams.push(`[${queryEmbedding.join(',')}]`);
        paramIndex++;
        // PROJECT NAMESPACING: Filter by current project (now $2)
        const projectFilter = buildProjectWhereClause(paramIndex);
        conditions.push(projectFilter.sql);
        queryParams.push(projectFilter.param);
        paramIndex = projectFilter.nextIndex;
        // expired filter
        if (!params.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        // memory type filter
        if (params.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}::memory_type[])`);
            queryParams.push(params.memoryTypes);
            paramIndex++;
        }
        // tags filter (OR logic)
        if (params.tags?.length) {
            conditions.push(`tags && $${paramIndex}::text[]`);
            queryParams.push(params.tags);
            paramIndex++;
        }
        // importance filter
        if (params.importance?.length) {
            conditions.push(`importance = ANY($${paramIndex}::importance_level[])`);
            queryParams.push(params.importance);
            paramIndex++;
        }
        // date range filter
        if (params.dateRange?.start) {
            conditions.push(`created_at >= $${paramIndex}::timestamptz`);
            queryParams.push(params.dateRange.start);
            paramIndex++;
        }
        if (params.dateRange?.end) {
            conditions.push(`created_at <= $${paramIndex}::timestamptz`);
            queryParams.push(params.dateRange.end);
            paramIndex++;
        }
        // NEW: Role filter - uses metadata->>'role' or tags
        if (params.role) {
            // Filter by role:user or role:assistant tag (more efficient with index)
            conditions.push(`$${paramIndex}::text = ANY(tags)`);
            queryParams.push(`role:${params.role}`);
            paramIndex++;
        }
        // ============================================================================
        // NOISE FILTERS: Exclude system-generated content dynamically via tags
        // ============================================================================
        // These tags are set at ingestion time by sessionParser/sessionWatcher:
        // - 'context-restoration' = raw context restoration summaries (not real user prompts)
        // - 'agent-deployment' = agent/team member deployment prompts
        // - 'consolidation-task' = code consolidation task prompts
        // Exclude these by default to avoid polluting find_memory results
        const noiseTags = ['context-restoration', 'agent-deployment', 'consolidation-task'];
        conditions.push(`NOT (tags && $${paramIndex}::text[])`);
        queryParams.push(noiseTags);
        paramIndex++;
        // threshold and limit - now parameterized for query plan caching
        // NOTE: Default 0.35 filters out noise while catching real matches
        // Local embeddings typically produce 0.2-0.5 similarity for relevant content
        const threshold = params.threshold ?? 0.35;
        const limit = params.limit ?? 10;
        // Add threshold and limit as parameters
        queryParams.push(threshold);
        const thresholdParam = paramIndex++;
        queryParams.push(limit);
        const limitParam = paramIndex;
        // the query - cosine similarity with pgvector
        // 1 - cosine_distance gives us similarity score
        // NOW FULLY PARAMETERIZED for better query plan caching
        const query = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        1 - (embedding <=> $1::vector) AS similarity
      FROM memories
      WHERE ${conditions.join(' AND ')}
        AND 1 - (embedding <=> $1::vector) >= $${thresholdParam}
      ORDER BY similarity DESC
      LIMIT $${limitParam}
    `;
        // DEBUG: Log the first param (embedding) length before query
        const embeddingParamStr = queryParams[0];
        const embeddingParamLen = embeddingParamStr?.match(/,/g)?.length || 0;
        logger.info({
            embeddingParamLength: embeddingParamLen + 1,
            embeddingPreview: embeddingParamStr?.substring(0, 50),
            paramCount: queryParams.length
        }, 'About to execute semantic search query');
        const queryStart = Date.now();
        const result = await this.db.query(query, queryParams);
        const queryDuration = Date.now() - queryStart;
        // Enhanced logging with similarity score distribution for debugging relevance issues
        const similarityScores = result.rows.map((r) => r.similarity);
        const sortedScores = [...similarityScores].sort((a, b) => b - a);
        logger.info({
            queryDuration,
            resultCount: result.rows.length,
            threshold,
            limit,
            // Similarity distribution - CRITICAL for debugging relevance issues
            topSimilarity: sortedScores[0] || 0,
            minSimilarity: sortedScores[sortedScores.length - 1] || 0,
            avgSimilarity: similarityScores.length > 0
                ? Math.round(similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length * 1000) / 1000
                : 0,
            // Show distribution buckets
            above50pct: similarityScores.filter((s) => s >= 0.5).length,
            above30pct: similarityScores.filter((s) => s >= 0.3).length,
            above25pct: similarityScores.filter((s) => s >= 0.25).length,
            // Show top 3 scores for debugging
            top3Scores: sortedScores.slice(0, 3).map(s => Math.round(s * 1000) / 1000)
        }, '[RELEVANCE] Semantic search similarity distribution');
        // Apply Chinese Compactor approach: pass summarize/maxContentLength options
        const compactionOpts = {
            summarize: params.summarize,
            maxContentLength: params.maxContentLength
        };
        return result.rows.map((row) => this.rowToSearchResult(row, compactionOpts));
    }
    // ============================================================================
    // I5 FIX: NEW METHODS FOR RECENT MEMORIES, RECENCY BOOST, KEYWORD FALLBACK
    // ============================================================================
    /**
     * I5 FIX: Get recent memories regardless of similarity
     * This ensures we can always find recent prompts even if embeddings aren't ready
     */
    async getRecentMemories(count, params) {
        if (count <= 0)
            return [];
        logger.info({ count, allProjects: params.allProjects, projectPath: params.projectPath }, '[I5 FIX] Fetching recent memories for includeRecent');
        // Use helper for project filtering (supports cross-project search)
        const projectFilter = this.buildProjectCondition(params, 1);
        const conditions = [...projectFilter.conditions];
        const queryParams = [...projectFilter.queryParams];
        let paramIndex = projectFilter.nextIndex;
        // Apply same filters as main search (except threshold/embedding)
        if (!params.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        if (params.memoryTypes?.length) {
            conditions.push(`memory_type = ANY($${paramIndex}::memory_type[])`);
            queryParams.push(params.memoryTypes);
            paramIndex++;
        }
        if (params.role) {
            conditions.push(`$${paramIndex}::text = ANY(tags)`);
            queryParams.push(`role:${params.role}`);
            paramIndex++;
        }
        // Exclude noise tags (same as main search)
        const noiseTags = ['context-restoration', 'agent-deployment', 'consolidation-task'];
        conditions.push(`NOT (tags && $${paramIndex}::text[])`);
        queryParams.push(noiseTags);
        paramIndex++;
        queryParams.push(count);
        const limitParam = paramIndex;
        // MED-38 FIX: Mark fallback results clearly - similarity is not from semantic search
        const query = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        0.5 AS similarity,  -- Fixed similarity for recent memories (not semantic)
        true AS is_fallback  -- MED-38: Flag to indicate this is a fallback result
      FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam}
    `;
        try {
            const result = await this.db.query(query, queryParams);
            logger.info({
                recentFound: result.rows.length,
                newestTimestamp: result.rows[0]?.created_at
            }, '[I5 FIX] Recent memories retrieved');
            const compactionOpts = {
                summarize: params.summarize,
                maxContentLength: params.maxContentLength
            };
            return result.rows.map((row) => this.rowToSearchResult(row, compactionOpts));
        }
        catch (error) {
            logger.error({ error }, '[I5 FIX] Failed to get recent memories');
            return [];
        }
    }
    /**
     * I5 FIX: Apply recency boost to search results
     * Memories from last hour: +20% similarity
     * Memories from last day: +10% similarity
     * This ensures recent discussions rank higher
     */
    applyRecencyBoost(results) {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const oneDay = 24 * oneHour;
        return results.map(result => {
            const createdAt = result.memory.createdAt?.getTime() || 0;
            const age = now - createdAt;
            let boostFactor = 1.0;
            if (age < oneHour) {
                boostFactor = 1.20; // 20% boost for last hour
            }
            else if (age < oneDay) {
                boostFactor = 1.10; // 10% boost for last day
            }
            if (boostFactor > 1.0) {
                logger.debug({
                    memoryId: result.memory.id,
                    originalSimilarity: result.similarity,
                    boostFactor,
                    newSimilarity: Math.min(1.0, result.similarity * boostFactor),
                    ageMinutes: Math.round(age / 60000)
                }, '[I5 FIX] Applied recency boost');
            }
            return {
                ...result,
                similarity: Math.min(1.0, result.similarity * boostFactor)
            };
        });
    }
    /**
     * I5 FIX: Keyword fallback search using ILIKE
     * When embeddings return nothing, do text-based search
     */
    async keywordSearch(query, params) {
        logger.info({ query, allProjects: params.allProjects, projectPath: params.projectPath }, '[I5 FIX] Performing keyword fallback search');
        const limit = params.limit ?? 10;
        // Extract keywords from query (split on spaces, filter short words)
        const keywords = query.toLowerCase()
            .split(/\s+/)
            .filter(w => w.length >= 3)
            .slice(0, 5); // Max 5 keywords
        if (keywords.length === 0) {
            logger.warn({ query }, '[I5 FIX] No usable keywords for fallback search');
            return [];
        }
        // Use helper for project filtering (supports cross-project search)
        const projectFilter = this.buildProjectCondition(params, 1);
        const conditions = [...projectFilter.conditions];
        const queryParams = [...projectFilter.queryParams];
        let paramIndex = projectFilter.nextIndex;
        // Add keyword conditions (OR logic - any keyword matches)
        const keywordConditions = keywords.map((_, idx) => {
            queryParams.push(`%${keywords[idx]}%`);
            return `content ILIKE $${paramIndex + idx}`;
        });
        conditions.push(`(${keywordConditions.join(' OR ')})`);
        paramIndex += keywords.length;
        if (!params.includeExpired) {
            conditions.push('(expires_at IS NULL OR expires_at > NOW())');
        }
        if (params.role) {
            conditions.push(`$${paramIndex}::text = ANY(tags)`);
            queryParams.push(`role:${params.role}`);
            paramIndex++;
        }
        // Exclude noise tags (same as main search)
        const noiseTags = ['context-restoration', 'agent-deployment', 'consolidation-task'];
        conditions.push(`NOT (tags && $${paramIndex}::text[])`);
        queryParams.push(noiseTags);
        paramIndex++;
        queryParams.push(limit);
        const limitParam = paramIndex;
        // MED-38 FIX: Mark fallback results clearly - similarity is not from semantic search
        const searchQuery = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        0.3 AS similarity,  -- Fixed similarity for keyword matches (not semantic)
        true AS is_fallback  -- MED-38: Flag to indicate this is a fallback result
      FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam}
    `;
        try {
            const result = await this.db.query(searchQuery, queryParams);
            logger.info({
                keywordCount: keywords.length,
                resultsFound: result.rows.length,
                keywords
            }, '[I5 FIX] Keyword fallback search complete');
            const compactionOpts = {
                summarize: params.summarize,
                maxContentLength: params.maxContentLength
            };
            return result.rows.map((row) => this.rowToSearchResult(row, compactionOpts));
        }
        catch (error) {
            logger.error({ error, keywords }, '[I5 FIX] Keyword fallback search failed');
            return [];
        }
    }
    /**
     * I5 FIX: Merge and dedupe results from multiple sources
     * Priority: semantic results > recent results > keyword results
     *
     * REACTIVE DEDUPE: Also checks for content duplicates and queues DB cleanup
     */
    mergeAndDedupeResults(semanticResults, recentResults, keywordResults, limit) {
        const seenIds = new Set();
        const seenContent = new Map(); // content hash -> kept memory id
        const duplicateIds = []; // IDs to delete from DB
        const merged = [];
        // Helper to normalize content for comparison
        const normalizeContent = (content) => {
            return content
                .toLowerCase()
                .trim()
                .replace(/^\[user\]\s*/i, '')
                .replace(/^\[claude\]\s*/i, '')
                .slice(0, 500); // Compare first 500 chars
        };
        // Helper to add result with content dedup check
        const addResult = (result, source) => {
            if (seenIds.has(result.memory.id))
                return;
            const contentKey = normalizeContent(result.memory.content);
            const existingId = seenContent.get(contentKey);
            if (existingId) {
                // Content duplicate found - queue for DB deletion
                duplicateIds.push(result.memory.id);
                logger.debug({
                    duplicateId: result.memory.id,
                    keptId: existingId,
                    contentPreview: contentKey.slice(0, 50)
                }, '[REACTIVE DEDUPE] Content duplicate detected');
                return;
            }
            seenIds.add(result.memory.id);
            seenContent.set(contentKey, result.memory.id);
            if (source) {
                merged.push({
                    ...result,
                    memory: {
                        ...result.memory,
                        metadata: { ...result.memory.metadata, _source: source }
                    }
                });
            }
            else {
                merged.push(result);
            }
        };
        // Add semantic results first (highest priority)
        for (const result of semanticResults) {
            addResult(result);
        }
        // Add recent results second
        for (const result of recentResults) {
            addResult(result, 'recent');
        }
        // Add keyword results last
        for (const result of keywordResults) {
            addResult(result, 'keyword');
        }
        // REACTIVE DEDUPE: Delete duplicates from DB asynchronously
        // MED-42 FIX: Delay deletion by 30 seconds to allow drilldown on results before deletion
        // This prevents race condition where user tries to drill_down on a memory that was just deleted
        if (duplicateIds.length > 0) {
            logger.info({ count: duplicateIds.length, delaySeconds: 30 }, '[REACTIVE DEDUPE] Queuing content duplicates for cleanup (30s delay)');
            setTimeout(() => {
                this.cleanupDuplicates(duplicateIds).catch(err => {
                    logger.warn({ error: err }, '[REACTIVE DEDUPE] Failed to cleanup duplicates');
                });
            }, 30000); // 30 second delay before deletion
        }
        // Sort by similarity (descending) and take limit
        return merged
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }
    /**
     * REACTIVE DEDUPE: Delete duplicate memories from database
     * PROJECT ISOLATED: Only deletes from current project
     * Called asynchronously when content duplicates are detected in search results
     */
    async cleanupDuplicates(ids) {
        if (ids.length === 0)
            return;
        try {
            const projectPath = getProjectPathForInsert();
            const result = await this.db.query(`DELETE FROM memories WHERE id = ANY($1::uuid[]) AND project_path = $2 RETURNING id`, [ids, projectPath]);
            logger.info({
                requested: ids.length,
                deleted: result.rowCount,
                projectPath
            }, '[REACTIVE DEDUPE] Duplicates cleaned from DB');
        }
        catch (error) {
            logger.error({ error, ids }, '[REACTIVE DEDUPE] Failed to delete duplicates');
        }
    }
    /**
     * hybridSearch - combines semantic + full-text search
     *
     * best of both worlds - vector similarity for meaning
     * plus full-text search for exact matches
     */
    async hybridSearch(params, queryEmbedding) {
        const limit = params.limit ?? 10;
        // NOTE: Default 0.35 filters out noise while catching real matches
        const threshold = params.threshold ?? 0.35;
        // CROSS-PROJECT SUPPORT: Build project condition
        const allProjects = params.allProjects === true;
        const targetProject = params.projectPath || getProjectContext().getProjectPath();
        // Build project filter clause (empty if allProjects)
        const projectClause = allProjects ? '' : 'AND project_path = $3';
        // semantic search component - with optional project filter
        const semanticQuery = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        1 - (embedding <=> $1::vector) AS similarity,
        0.7 AS weight
      FROM memories
      WHERE embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        ${projectClause}
        AND 1 - (embedding <=> $1::vector) >= ${threshold}
    `;
        // full-text search component - with optional project filter
        const ftsQuery = `
      SELECT
        id, content, memory_type, importance, tags, metadata,
        embedding, created_at, updated_at, access_count, last_accessed_at,
        ts_rank(content_tsv, plainto_tsquery('english', $2)) AS similarity,
        0.3 AS weight
      FROM memories
      WHERE content_tsv @@ plainto_tsquery('english', $2)
        AND (expires_at IS NULL OR expires_at > NOW())
        ${projectClause}
    `;
        // combine and dedupe - semantic results get priority
        // NOTE: Using ON instead of USING to avoid vector type comparison issues
        const combinedQuery = `
      WITH semantic AS (${semanticQuery}),
           fts AS (${ftsQuery})
      SELECT DISTINCT ON (COALESCE(s.id, f.id))
        COALESCE(s.id, f.id) AS id,
        COALESCE(s.content, f.content) AS content,
        COALESCE(s.memory_type, f.memory_type) AS memory_type,
        COALESCE(s.importance, f.importance) AS importance,
        COALESCE(s.tags, f.tags) AS tags,
        COALESCE(s.metadata, f.metadata) AS metadata,
        COALESCE(s.embedding, f.embedding) AS embedding,
        COALESCE(s.created_at, f.created_at) AS created_at,
        COALESCE(s.updated_at, f.updated_at) AS updated_at,
        COALESCE(s.access_count, f.access_count) AS access_count,
        COALESCE(s.last_accessed_at, f.last_accessed_at) AS last_accessed_at,
        COALESCE(s.similarity * s.weight, 0) + COALESCE(f.similarity * f.weight, 0) AS similarity
      FROM semantic s
      FULL OUTER JOIN fts f ON s.id = f.id
      ORDER BY COALESCE(s.id, f.id), similarity DESC
      LIMIT ${limit}
    `;
        // Build query params - include projectPath only if not searching all projects
        const queryParams = allProjects
            ? [`[${queryEmbedding.join(',')}]`, params.query]
            : [`[${queryEmbedding.join(',')}]`, params.query, targetProject];
        const result = await this.db.query(combinedQuery, queryParams);
        // Apply Chinese Compactor approach
        const compactionOpts = {
            summarize: params.summarize,
            maxContentLength: params.maxContentLength
        };
        return result.rows.map((row) => this.rowToSearchResult(row, compactionOpts));
    }
    /**
     * update access counts for returned memories
     *
     * helps with relevance scoring over time
     */
    async updateAccessCounts(memoryIds) {
        try {
            await this.db.query(`UPDATE memories
         SET access_count = access_count + 1,
             last_accessed_at = NOW()
         WHERE id = ANY($1::uuid[])`, [memoryIds]);
        }
        catch (error) {
            // non-critical, just log it
            logger.warn({ error }, 'failed to update access counts');
        }
    }
    /**
     * Record access patterns for hot path tracking
     *
     * When memories are accessed together, we track the transition
     * to build up hot paths that can be predicted/prefetched
     */
    async recordAccessPatterns(memoryIds) {
        if (memoryIds.length < 2)
            return;
        try {
            // Lazy initialize hot path manager
            if (!this.hotPathManager) {
                try {
                    this.hotPathManager = getHotPathManager(this.db.pool);
                }
                catch {
                    // If hot path manager isn't initialized yet, skip
                    return;
                }
            }
            // Record each memory access in sequence
            for (const memoryId of memoryIds) {
                await this.hotPathManager.recordAccess(memoryId);
            }
        }
        catch (error) {
            // Non-critical - just log
            logger.debug({ error }, 'hot path recording failed (tables may not exist yet)');
        }
    }
    /**
     * highlight matching content
     *
     * shows context around matches for better UX
     */
    getHighlights(content, query) {
        const highlights = [];
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const contentLower = content.toLowerCase();
        for (const word of words) {
            const index = contentLower.indexOf(word);
            if (index !== -1) {
                const start = Math.max(0, index - 50);
                const end = Math.min(content.length, index + word.length + 50);
                let highlight = content.substring(start, end);
                if (start > 0)
                    highlight = '...' + highlight;
                if (end < content.length)
                    highlight = highlight + '...';
                highlights.push(highlight);
            }
        }
        return highlights.slice(0, 3); // max 3 highlights
    }
    /**
     * Create search result with AGGRESSIVE content compaction
     * Uses Chinese Compactor for token savings + truncation for drill-down
     *
     * When summarize=true (DEFAULT): Returns MINIMAL structure for drill-down decision
     * When summarize=false: Returns full Memory object
     */
    rowToSearchResult(row, opts = {}) {
        let content = row.content;
        let contentTruncated = false;
        const originalLength = row.content.length;
        // STEP 1: Truncate first - User feedback: "content wayyy too trimmed"
        const summarize = opts.summarize !== false; // Default TRUE
        const maxLen = opts.maxContentLength ?? 1000; // Was 500 - doubled for more context
        if (maxLen > 0 && content.length > maxLen) {
            content = content.substring(0, maxLen) + '...';
            contentTruncated = true;
        }
        // STEP 2: Apply Chinese compression for additional token savings
        // Only compress if content is long enough to benefit
        let compressionRatio = 1.0;
        if (content.length > 50) {
            const compressed = smartCompress(content, {
                threshold: 0.80, // Allow slightly lossy for big savings
                minLength: 30
            });
            content = compressed.result;
            compressionRatio = compressed.compressionRatio;
        }
        // DRILL-DOWN MODE: Return minimal but MEANINGFUL structure when summarize=true
        // Key: Show ACTUAL CONTENT preview, not just IDs and metadata!
        if (summarize) {
            // Extract the most meaningful part of content (skip metadata-looking text)
            const meaningfulContent = this.extractMeaningfulContent(content, maxLen);
            // Create a semantic summary in Traditional Chinese for token efficiency
            const semanticHint = this.createSemanticHint(row, meaningfulContent);
            const memory = {
                id: row.id,
                // CRITICAL: Show actual meaningful content, not just truncated raw text
                content: meaningfulContent,
                // Include semantic hint for understanding
                memoryType: row.memory_type,
                // Tags help Claude understand context
                tags: row.tags.slice(0, 5),
                // Metadata: PRESERVE original (sessionId, timestamp, role) + add drill hints
                metadata: {
                    ...row.metadata, // CRITICAL: Keep sessionId, timestamp, role for pairing!
                    _preview: semanticHint, // Chinese-compressed semantic summary
                    _drill: `get_memory({id: "${row.id}"})`,
                    _fullLen: originalLength,
                    _created: row.created_at ? new Date(row.created_at).toLocaleDateString() : undefined
                }
            };
            // MED-38 FIX: Include isFallback flag to indicate similarity is synthetic, not from semantic search
            return {
                memory,
                similarity: row.similarity,
                highlights: [],
                ...(row.is_fallback ? { isFallback: true, fallbackNote: 'Similarity score is synthetic (recent/keyword), not from semantic search' } : {})
            };
        }
        // FULL MODE: Return complete Memory object when summarize=false
        const memory = {
            id: row.id,
            content: content,
            memoryType: row.memory_type,
            importance: row.importance,
            tags: row.tags,
            metadata: {
                ...row.metadata,
                ...(contentTruncated ? {
                    _truncated: true,
                    _len: originalLength,
                    _drill: `get_memory({id: "${row.id}"})`
                } : {}),
                ...(compressionRatio < 0.9 ? { _compressed: true } : {})
            },
            embedding: undefined, // NEVER return embeddings - huge token waste
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            accessCount: row.access_count,
            lastAccessedAt: row.last_accessed_at ?? undefined
        };
        // MED-38 FIX: Include isFallback flag to indicate similarity is synthetic, not from semantic search
        return {
            memory,
            similarity: row.similarity,
            highlights: [],
            ...(row.is_fallback ? { isFallback: true, fallbackNote: 'Similarity score is synthetic (recent/keyword), not from semantic search' } : {})
        };
    }
    parseEmbedding(embeddingStr) {
        const cleaned = embeddingStr.replace(/[\[\]]/g, '');
        return cleaned.split(',').map(Number);
    }
    // ============================================================================
    // CONTEXT ENRICHMENT METHODS
    // Like human memory recall - fragment leads to connections leads to deeper recall
    // ============================================================================
    /**
     * Aggregate discoverable paths from all enriched results
     * Combines and deduplicates paths for a unified exploration map
     */
    aggregateDiscoverablePaths(results) {
        const aggregated = {
            filePaths: [],
            codeBlocks: [],
            urls: [],
            memoryRefs: [],
            technicalTerms: [],
            researchQuestions: []
        };
        for (const result of results) {
            if (!result._discoverable)
                continue;
            const paths = result._discoverable;
            aggregated.filePaths.push(...paths.filePaths);
            aggregated.codeBlocks.push(...paths.codeBlocks);
            aggregated.urls.push(...paths.urls);
            aggregated.memoryRefs.push(...paths.memoryRefs);
            aggregated.technicalTerms.push(...paths.technicalTerms);
            aggregated.researchQuestions.push(...paths.researchQuestions);
        }
        // Deduplicate
        aggregated.filePaths = [...new Set(aggregated.filePaths)].slice(0, 15);
        aggregated.urls = [...new Set(aggregated.urls)].slice(0, 10);
        aggregated.technicalTerms = [...new Set(aggregated.technicalTerms)].slice(0, 15);
        aggregated.researchQuestions = [...new Set(aggregated.researchQuestions)].slice(0, 5);
        return aggregated;
    }
    /**
     * Generate context enrichment summary
     * This is the KEY output that tells Claude what to explore next
     * Uses Traditional Chinese for token efficiency
     */
    generateContextEnrichment(query, results, aggregatedPaths, drilldown) {
        const lines = [];
        // Header with query context (Chinese compacted)
        lines.push(`<specmem-context query="${query}">`);
        lines.push(`  記憶召回: ${results.length}條 | ${drilldown.prompt}`);
        // Discoverable exploration paths
        if (aggregatedPaths.filePaths.length > 0) {
            lines.push(`  📁 可探索文件(${aggregatedPaths.filePaths.length}):`);
            for (const path of aggregatedPaths.filePaths.slice(0, 5)) {
                lines.push(`     → ${path}`);
            }
            if (aggregatedPaths.filePaths.length > 5) {
                lines.push(`     ... +${aggregatedPaths.filePaths.length - 5}個文件`);
            }
        }
        if (aggregatedPaths.codeBlocks.length > 0) {
            const langs = [...new Set(aggregatedPaths.codeBlocks.map(c => c.language))];
            lines.push(`  💻 代碼塊(${aggregatedPaths.codeBlocks.length}): ${langs.join(', ')}`);
            // Show first code block preview
            const first = aggregatedPaths.codeBlocks[0];
            if (first.possiblePath) {
                lines.push(`     → 可能來源: ${first.possiblePath}`);
            }
        }
        if (aggregatedPaths.technicalTerms.length > 0) {
            lines.push(`  🔧 技術概念: ${aggregatedPaths.technicalTerms.slice(0, 8).join(', ')}`);
        }
        if (aggregatedPaths.urls.length > 0) {
            lines.push(`  🔗 相關URL(${aggregatedPaths.urls.length}): 可WebFetch研究`);
        }
        // Research suggestions
        if (drilldown.needsResearch || aggregatedPaths.researchQuestions.length > 0) {
            lines.push(`  ❓ 研究建議:`);
            if (drilldown.needsResearch) {
                lines.push(`     → 本地記憶不足,建議WebSearch: "${query}"`);
            }
            for (const q of aggregatedPaths.researchQuestions.slice(0, 2)) {
                lines.push(`     → ${q}`);
            }
        }
        // Drilldown action hint
        if (drilldown.action !== 'none') {
            lines.push(`  🎯 建議操作: ${this.formatDrilldownAction(drilldown.action)}`);
        }
        lines.push(`</specmem-context>`);
        return lines.join('\n');
    }
    /**
     * Format drilldown action as Chinese instruction
     */
    formatDrilldownAction(action) {
        const actions = {
            'drilldown:deeper': '深入搜索 - 使用get_memory獲取完整內容',
            'drilldown:broader': '擴大搜索 - 嘗試相關詞或增加limit',
            'drilldown:filter': '過濾結果 - 添加memoryTypes或tags參數',
            'research:web': '網絡研究 - 使用WebSearch獲取最新資訊',
            'none': '記憶足夠'
        };
        return actions[action] || action;
    }
    /**
     * Generate context for empty results
     * Guides Claude on what to do when no memories match
     */
    generateEmptyResultContext(query, drilldown) {
        return `<specmem-context query="${query}">
  ⚠️ 無匹配記憶
  ${drilldown.prompt}

  建議操作:
  1. WebSearch "${query}" - 獲取外部資訊
  2. 調整查詢 - 嘗試不同關鍵詞
  3. 檢查拼寫 - 確保查詢正確
  4. 擴大範圍 - 移除過濾條件
</specmem-context>`;
    }
    /**
     * Generate research spawn instructions
     * These instructions tell Claude how to spawn a research team member
     * when local memory is insufficient
     */
    generateResearchSpawnInstructions(query, aggregatedPaths) {
        const hasCodePaths = aggregatedPaths.filePaths.length > 0 || aggregatedPaths.codeBlocks.length > 0;
        const hasResearchQuestions = aggregatedPaths.researchQuestions.length > 0;
        const hasUrls = aggregatedPaths.urls.length > 0;
        // Determine research type
        let researchType = 'web';
        if (hasCodePaths && (hasResearchQuestions || hasUrls)) {
            researchType = 'both';
        }
        else if (hasCodePaths) {
            researchType = 'code';
        }
        // Build task prompt for the research team member
        const taskParts = [];
        if (researchType === 'code' || researchType === 'both') {
            taskParts.push(`探索代碼路徑: ${aggregatedPaths.filePaths.slice(0, 3).join(', ')}`);
            if (aggregatedPaths.technicalTerms.length > 0) {
                taskParts.push(`技術概念: ${aggregatedPaths.technicalTerms.slice(0, 5).join(', ')}`);
            }
        }
        if (researchType === 'web' || researchType === 'both') {
            if (hasResearchQuestions) {
                taskParts.push(`研究問題: ${aggregatedPaths.researchQuestions.slice(0, 2).join('; ')}`);
            }
            else {
                taskParts.push(`WebSearch查詢: "${query}"`);
            }
            if (hasUrls) {
                taskParts.push(`可WebFetch的URL: ${aggregatedPaths.urls.length}個`);
            }
        }
        // Context for the research team member (Chinese compacted)
        const contextForTeamMember = `<specmem-research-context>
  原始查詢: "${query}"
  研究類型: ${researchType}
  ${taskParts.map(p => `  ${p}`).join('\n')}

  指示:
  - 收集相關資訊後,使用save_memory保存重要發現
  - 研究完成後返回簡潔摘要
  - 使用傳統中文壓縮輸出以節省tokens
</specmem-research-context>`;
        // Subteam member type based on research needs
        const subteamMemberType = researchType === 'code' ? 'Explore' : 'general-purpose';
        // Task prompt for spawning
        const taskPrompt = researchType === 'code'
            ? `探索SpecMem代碼庫以理解: ${query}\n重點文件: ${aggregatedPaths.filePaths.slice(0, 3).join(', ')}`
            : `研究: ${query}\n${hasResearchQuestions ? `問題: ${aggregatedPaths.researchQuestions[0]}` : '使用WebSearch獲取最新資訊'}`;
        return {
            shouldSpawnResearch: true,
            researchType,
            taskPrompt,
            subteamMemberType,
            contextForTeamMember
        };
    }
    /**
     * Extract meaningful preview from content
     * Avoids showing just metadata like session IDs and timestamps
     */
    extractMeaningfulPreview(content) {
        // Skip metadata-looking lines (session IDs, timestamps, etc.)
        const lines = content.split('\n');
        let meaningfulLine = '';
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip empty lines
            if (!trimmed)
                continue;
            // Skip lines that look like metadata
            if (/^(session|memory|created|id|timestamp|metadata)[:=]/i.test(trimmed))
                continue;
            if (/^[a-f0-9-]{36}$/i.test(trimmed))
                continue; // UUIDs
            if (/^\d{4}-\d{2}-\d{2}/.test(trimmed))
                continue; // Dates
            // Found a meaningful line
            meaningfulLine = trimmed;
            break;
        }
        // Truncate to 60 chars
        if (meaningfulLine.length > 60) {
            meaningfulLine = meaningfulLine.substring(0, 57) + '...';
        }
        return meaningfulLine || content.substring(0, 50) + '...';
    }
    /**
     * Extract meaningful content, skipping metadata-looking lines
     * Returns actual content Claude can understand and drill down on
     */
    extractMeaningfulContent(content, maxLen) {
        const lines = content.split('\n');
        const meaningfulLines = [];
        let charCount = 0;
        // Patterns that indicate metadata (should skip)
        const metadataPatterns = [
            /^session[_\s-]?id[:=\s]/i,
            /^memory[_\s-]?id[:=\s]/i,
            /^created[_\s-]?at[:=\s]/i,
            /^updated[_\s-]?at[:=\s]/i,
            /^timestamp[:=\s]/i,
            /^id[:=\s]/i,
            /^uuid[:=\s]/i,
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUID only line
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO timestamp only line
            /^metadata[:=\s]*\{/i,
            /^tags[:=\s]*\[/i,
        ];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            // Skip metadata lines
            let isMetadata = false;
            for (const pattern of metadataPatterns) {
                if (pattern.test(trimmed)) {
                    isMetadata = true;
                    break;
                }
            }
            if (isMetadata)
                continue;
            // Add meaningful line
            meaningfulLines.push(trimmed);
            charCount += trimmed.length;
            // Stop if we have enough
            if (charCount >= maxLen)
                break;
        }
        // If we found meaningful content, use it
        if (meaningfulLines.length > 0) {
            let result = meaningfulLines.join('\n');
            if (result.length > maxLen) {
                result = result.substring(0, maxLen - 3) + '...';
            }
            return result;
        }
        // Fallback: just use first maxLen chars
        return content.length > maxLen ? content.substring(0, maxLen - 3) + '...' : content;
    }
    /**
     * Create a semantic hint in Traditional Chinese for token efficiency
     * This gives Claude a quick understanding of what the memory is about
     */
    createSemanticHint(row, content) {
        const parts = [];
        // Memory type in Chinese
        const typeMap = {
            'episodic': '情節記憶', // Episode/event memory
            'semantic': '語義記憶', // Factual/knowledge memory
            'procedural': '程序記憶', // How-to memory
            'working': '工作記憶', // Temporary/active memory
            'consolidated': '長期記憶' // Consolidated/important memory
        };
        const memType = typeMap[row.memory_type] || row.memory_type;
        parts.push(`類型:${memType}`);
        // Importance in Chinese
        const importanceMap = {
            'critical': '🔴關鍵',
            'high': '🟠重要',
            'medium': '🟡一般',
            'low': '🟢低',
            'trivial': '⚪微'
        };
        const imp = importanceMap[row.importance] || row.importance;
        parts.push(`重要:${imp}`);
        // Extract key topic from content (first sentence or 50 chars)
        const firstSentence = content.split(/[.!?。！？\n]/)[0]?.trim() || content;
        const topic = firstSentence.length > 50 ? firstSentence.substring(0, 47) + '...' : firstSentence;
        parts.push(`主題:${topic}`);
        // Tags if present (max 3)
        if (row.tags && row.tags.length > 0) {
            const tagStr = row.tags.slice(0, 3).join(',');
            parts.push(`標籤:${tagStr}`);
        }
        return parts.join(' | ');
    }
    /**
     * Extract keywords from query for related searches
     */
    extractKeywords(query) {
        // Remove stop words and get meaningful terms
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on',
            'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
            'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
            'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most',
            'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
            'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
            'about', 'what', 'which', 'who', 'this', 'that', 'these', 'those', 'it', 'its']);
        const words = query.toLowerCase().split(/\s+/);
        const keywords = words.filter(w => w.length > 2 && !stopWords.has(w));
        // Return unique keywords
        return [...new Set(keywords)];
    }
    static getStats() {
        return {
            searchCount: _searchCount,
            totalSearchTime: _totalSearchTime,
            averageSearchTime: _searchCount > 0 ? _totalSearchTime / _searchCount : 0
        };
    }
}
//# sourceMappingURL=findWhatISaid.js.map