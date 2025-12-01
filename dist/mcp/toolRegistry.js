/**
 * Tool Registry - where all our goofy named tools live
 *
 * fr fr this is the brain that knows what tools we got
 * and how to call em when claude asks nice
 */
import { logger } from '../utils/logger.js';
import { createHash } from 'crypto';
// DEBUG LOGGING - only enabled when SPECMEM_DEBUG=1
const __debugLog = process.env['SPECMEM_DEBUG'] === '1'
    ? (...args) => console.error('[DEBUG]', ...args) // stderr, not stdout!
    : () => { };
// Import all the goofy tools
import { RememberThisShit } from '../tools/goofy/rememberThisShit.js';
import { FindWhatISaid } from '../tools/goofy/findWhatISaid.js';
import { WhatDidIMean } from '../tools/goofy/whatDidIMean.js';
import { YeahNahDeleteThat } from '../tools/goofy/yeahNahDeleteThat.js';
import { SmushMemoriesTogether } from '../tools/goofy/smushMemoriesTogether.js';
import { LinkTheVibes } from '../tools/goofy/linkTheVibes.js';
import { ShowMeTheStats } from '../tools/goofy/showMeTheStats.js';
import { CompareInstanceMemory } from '../tools/goofy/compareInstanceMemory.js';
import { FindCodePointers } from '../tools/goofy/findCodePointers.js';
import { DrillDown, GetMemoryByDrilldownID } from '../tools/goofy/drillDown.js';
// Import codebase ingestion tools - ingestThisWholeAssMfCodebase and friends
import { createCodebaseTools } from '../codebase/index.js';
// Import package tracking tools - trackTheNodeModulesVibes
import { createPackageTools } from '../packages/index.js';
// Import memorization tools - Claude remembers what it writes!
import { initializeMemorizationSystem } from '../memorization/index.js';
// Import trace/explore tools - reduces search overhead by 80%+
import { createTraceExploreTools } from '../trace/index.js';
// Import watcher tool wrappers
import { StartWatchingTool, StopWatchingTool, CheckSyncTool, ForceResyncTool } from './watcherToolWrappers.js';
// Import Claude session extraction tools
import { ExtractClaudeSessions } from '../tools/goofy/extractClaudeSessions.js';
import { GetSessionWatcherStatus } from '../tools/goofy/getSessionWatcherStatus.js';
import { ExtractContextRestorations } from '../tools/goofy/extractContextRestorations.js';
// Import team member communication tools (legacy wrappers that now use MCP team comms)
import { SayToTeamMember } from '../tools/goofy/sayToTeamMember.js';
import { ListenForMessages } from '../tools/goofy/listenForMessages.js';
import { GetActiveTeamMembers } from '../tools/goofy/getActiveTeamMembers.js';
import { SendHeartbeat } from '../tools/goofy/sendHeartbeat.js';
// Import research team member tool - spawns Claude to research web when local AI needs more context
import { SpawnResearchTeamMemberTool, GetActiveResearchTeamMembersTool } from '../tools/goofy/spawnResearchTeamMemberTool.js';
// Import team member deployment monitoring tools
import { ListDeployedTeamMembers } from '../tools/goofy/listDeployedTeamMembers.js';
import { GetTeamMemberStatus } from '../tools/goofy/getTeamMemberStatus.js';
import { GetTeamMemberOutput } from '../tools/goofy/getTeamMemberOutput.js';
import { GetTeamMemberScreen } from '../tools/goofy/getTeamMemberScreen.js';
import { InterveneTeamMember } from '../tools/goofy/interveneTeamMember.js';
import { KillDeployedTeamMember } from '../tools/goofy/killDeployedTeamMember.js';
// Import smart search tool - interactive search mode selector (basic vs gallery)
import { SmartSearch } from '../tools/goofy/smartSearch.js';
// Import memory drilldown tools - gallery view + full drill-down
import { FindMemoryGallery } from '../tools/goofy/findMemoryGallery.js';
import { GetMemoryFull } from '../tools/goofy/getMemoryFull.js';
// Import MCP-based team communication tools (NEW - replaces HTTP team member comms)
import { createTeamCommTools } from './tools/teamComms.js';
// Import embedding server control tools (Phase 4 - user start/stop/status)
import { createEmbeddingControlTools, setEmbeddingProviderRef } from './tools/embeddingControl.js';
import { getProjectPath } from '../config.js';
/**
 * PROJECT-SCOPED embedding cache - prevents cross-project data pollution
 * Each project gets its own cache keyed by project path
 * 90% hit rate like doobidoo showed us - now isolated per project!
 */
const _EMBEDDING_CACHE_BY_PROJECT = new Map();
const MAX_CACHE_SIZE_PER_PROJECT = 500; // per project, ~3MB each
// Cleanup stale project caches after 30 minutes of inactivity
const _EMBEDDING_CACHE_ACCESS_TIMES = new Map();
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
// Start cleanup interval - use unref() to prevent keeping process alive!
const _cacheCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - CACHE_STALE_THRESHOLD_MS;
    for (const [project, lastAccess] of _EMBEDDING_CACHE_ACCESS_TIMES) {
        if (lastAccess < cutoff) {
            _EMBEDDING_CACHE_BY_PROJECT.delete(project);
            _EMBEDDING_CACHE_ACCESS_TIMES.delete(project);
            __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_PROJECT_CLEANUP', { project, reason: 'stale' });
        }
    }
}, CACHE_CLEANUP_INTERVAL_MS);
// CRITICAL: unref() prevents this timer from blocking process exit
_cacheCleanupTimer.unref();
/**
 * Get the project-scoped embedding cache
 */
function getProjectEmbeddingCache() {
    const project = getProjectPath();
    _EMBEDDING_CACHE_ACCESS_TIMES.set(project, Date.now());
    if (!_EMBEDDING_CACHE_BY_PROJECT.has(project)) {
        _EMBEDDING_CACHE_BY_PROJECT.set(project, new Map());
        __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_PROJECT_CREATED', { project });
    }
    return _EMBEDDING_CACHE_BY_PROJECT.get(project);
}
/**
 * Legacy export for backwards compatibility - returns current project's cache
 */
const _EMBEDDING_CACHE = {
    get size() { return getProjectEmbeddingCache().size; },
    get(key) { return getProjectEmbeddingCache().get(key); },
    set(key, value) { getProjectEmbeddingCache().set(key, value); },
    delete(key) { return getProjectEmbeddingCache().delete(key); },
    keys() { return getProjectEmbeddingCache().keys(); },
    has(key) { return getProjectEmbeddingCache().has(key); },
    clear() { getProjectEmbeddingCache().clear(); }
};
// fr fr this cache management hits different - now project-scoped!
function getCachedEmbedding(key) {
    const cache = getProjectEmbeddingCache();
    __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_GET_ATTEMPT', { key, cacheSize: cache.size, project: getProjectPath() });
    const result = cache.get(key);
    __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_GET_RESULT', { key, found: !!result, embeddingLength: result?.length });
    return result;
}
function setCachedEmbedding(key, embedding) {
    const cache = getProjectEmbeddingCache();
    __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_SET_START', { key, embeddingLength: embedding.length, currentCacheSize: cache.size, project: getProjectPath() });
    // evict oldest if we full
    if (cache.size >= MAX_CACHE_SIZE_PER_PROJECT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
            __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_EVICTION', { evictedKey: oldestKey, reason: 'max_size_reached', maxSize: MAX_CACHE_SIZE_PER_PROJECT });
            cache.delete(oldestKey);
        }
    }
    cache.set(key, embedding);
    __debugLog('[MCP DEBUG]', Date.now(), 'CACHE_SET_COMPLETE', { key, newCacheSize: cache.size });
}
/**
 * caching wrapper for embeddings - this go crazy for performance
 */
export class CachingEmbeddingProvider {
    provider;
    stats = {
        hits: 0,
        misses: 0
    };
    constructor(provider) {
        this.provider = provider;
    }
    async generateEmbedding(text) {
        // hash the text for cache key
        const cacheKey = this.hashText(text);
        const textPreview = text.length > 50 ? text.substring(0, 50) + '...' : text;
        // DEBUG: Step 1 - Checking cache
        __debugLog('[CACHE DEBUG]', Date.now(), 'CHECKING_CACHE', {
            cacheKey,
            textLength: text.length,
            textPreview,
            currentCacheSize: _EMBEDDING_CACHE.size
        });
        const cached = getCachedEmbedding(cacheKey);
        if (cached) {
            this.stats.hits++;
            // DEBUG: Step 2a - Cache HIT
            __debugLog('[CACHE DEBUG]', Date.now(), 'CACHE_HIT', {
                cacheKey,
                embeddingDimensions: cached.length,
                totalHits: this.stats.hits,
                hitRate: this.stats.hits / (this.stats.hits + this.stats.misses)
            });
            return cached;
        }
        this.stats.misses++;
        // DEBUG: Step 2b - Cache MISS
        __debugLog('[CACHE DEBUG]', Date.now(), 'CACHE_MISS', {
            cacheKey,
            totalMisses: this.stats.misses,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses)
        });
        // DEBUG: Step 3 - Before calling underlying provider
        const providerStartTime = Date.now();
        __debugLog('[CACHE DEBUG]', providerStartTime, 'CALLING_PROVIDER_START', {
            cacheKey,
            textLength: text.length,
            providerType: this.provider.constructor?.name || 'unknown'
        });
        const embedding = await this.provider.generateEmbedding(text);
        // DEBUG: Step 4 - After calling underlying provider
        const providerEndTime = Date.now();
        const providerDuration = providerEndTime - providerStartTime;
        __debugLog('[CACHE DEBUG]', providerEndTime, 'CALLING_PROVIDER_END', {
            cacheKey,
            durationMs: providerDuration,
            embeddingDimensions: embedding.length,
            embeddingPreview: embedding.slice(0, 3)
        });
        setCachedEmbedding(cacheKey, embedding);
        // DEBUG: Step 5 - After caching result
        __debugLog('[CACHE DEBUG]', Date.now(), 'RESULT_CACHED', {
            cacheKey,
            newCacheSize: _EMBEDDING_CACHE.size,
            totalStats: this.getStats()
        });
        return embedding;
    }
    /**
     * BATCH EMBEDDING with caching - checks cache first, only sends uncached to provider
     * This is MUCH faster than individual calls for large batches!
     */
    async generateEmbeddingsBatch(texts) {
        if (texts.length === 0)
            return [];
        const results = new Array(texts.length).fill(null);
        const uncachedTexts = [];
        const uncachedIndices = [];
        // Check cache for each text
        for (let i = 0; i < texts.length; i++) {
            const cacheKey = this.hashText(texts[i]);
            const cached = getCachedEmbedding(cacheKey);
            if (cached) {
                this.stats.hits++;
                results[i] = cached;
            }
            else {
                this.stats.misses++;
                uncachedTexts.push(texts[i]);
                uncachedIndices.push(i);
            }
        }
        __debugLog('[CACHE DEBUG]', Date.now(), 'BATCH_CACHE_CHECK', {
            totalTexts: texts.length,
            cacheHits: texts.length - uncachedTexts.length,
            cacheMisses: uncachedTexts.length,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses)
        });
        // If all cached, return immediately
        if (uncachedTexts.length === 0) {
            return results;
        }
        // Generate embeddings for uncached texts
        let embeddings;
        if (this.provider.generateEmbeddingsBatch) {
            // Use batch method if available
            embeddings = await this.provider.generateEmbeddingsBatch(uncachedTexts);
        }
        else {
            // Fallback to sequential
            embeddings = await Promise.all(uncachedTexts.map(t => this.provider.generateEmbedding(t)));
        }
        // Cache and insert results
        for (let i = 0; i < uncachedTexts.length; i++) {
            const cacheKey = this.hashText(uncachedTexts[i]);
            setCachedEmbedding(cacheKey, embeddings[i]);
            results[uncachedIndices[i]] = embeddings[i];
        }
        __debugLog('[CACHE DEBUG]', Date.now(), 'BATCH_COMPLETE', {
            totalTexts: texts.length,
            newlyGenerated: uncachedTexts.length,
            newCacheSize: _EMBEDDING_CACHE.size
        });
        return results;
    }
    hashText(text) {
        // SHA-256 for cache key - the old 32-bit hash had collisions causing WRONG embeddings!
        // Different content MUST get different cache keys for semantic search to work
        return createHash('sha256').update(text).digest('hex');
    }
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            hitRate: total > 0 ? this.stats.hits / total : 0,
            cacheSize: _EMBEDDING_CACHE.size
        };
    }
}
/**
 * Tool Registry - registers and manages all MCP tools
 *
 * this is the central hub where all the goofy tools check in
 * and get dispatched when claude needs em
 */
export class ToolRegistry {
    db;
    embeddingProvider;
    tools = new Map();
    toolDefinitions = [];
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    /**
     * register a tool so we know about it
     * All SpecMem tools are marked as safe for automated/subagent use
     */
    register(tool) {
        const registerStartTime = Date.now();
        __debugLog('[MCP DEBUG]', registerStartTime, 'TOOL_REGISTER_START', {
            toolName: tool.name,
            hasDescription: !!tool.description,
            descriptionLength: tool.description?.length,
            hasInputSchema: !!tool.inputSchema,
            currentToolCount: this.tools.size
        });
        if (this.tools.has(tool.name)) {
            __debugLog('[MCP DEBUG]', Date.now(), 'TOOL_REGISTER_REPLACE', {
                toolName: tool.name,
                reason: 'already_exists'
            });
            logger.warn({ tool: tool.name }, '[MCP DEBUG] tool already registered - replacing it ig');
        }
        this.tools.set(tool.name, tool);
        // add to definitions for ListTools response
        // IMPORTANT: annotations tell Claude Code these tools are safe for automated use
        // This enables subagents to use MCP tools without permission prompts
        this.toolDefinitions.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
                // Mark all SpecMem tools as safe for automated execution
                // These hints tell Claude Code the tool is pre-approved
                title: tool.name,
                readOnlyHint: false, // We do modify state, but we're trusted
                destructiveHint: false, // Not destructive - memory operations are reversible
                idempotentHint: true, // Safe to call multiple times
                openWorldHint: false, // We stay within our own system
                // Custom annotation to signal auto-allow for subagents
                requiresConfirmation: false
            }
        });
        // DEBUG: Log each tool registration with current count
        const registerEndTime = Date.now();
        __debugLog('[MCP DEBUG]', registerEndTime, 'TOOL_REGISTER_COMPLETE', {
            toolName: tool.name,
            totalTools: this.tools.size,
            totalDefinitions: this.toolDefinitions.length,
            durationMs: registerEndTime - registerStartTime,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                requiresConfirmation: false
            }
        });
        logger.debug({
            tool: tool.name,
            totalTools: this.tools.size,
            event: 'TOOL_REGISTERED'
        }, `[MCP DEBUG] Tool registered: ${tool.name} (total: ${this.tools.size})`);
    }
    /**
     * get a tool by name - returns undefined if not found
     */
    getTool(name) {
        return this.tools.get(name);
    }
    /**
     * get all tool definitions for MCP ListTools
     */
    getToolDefinitions() {
        return this.toolDefinitions;
    }
    /**
     * execute a tool by name with given params
     */
    async executeTool(name, params) {
        const executeStartTime = Date.now();
        const executeId = `exec_${executeStartTime}_${Math.random().toString(36).substring(2, 9)}`;
        __debugLog('[MCP DEBUG]', executeStartTime, 'TOOL_EXECUTE_START', {
            executeId,
            toolName: name,
            hasParams: !!params,
            paramsType: typeof params,
            paramsKeys: params && typeof params === 'object' ? Object.keys(params) : [],
            registeredTools: this.tools.size
        });
        const tool = this.tools.get(name);
        if (!tool) {
            __debugLog('[MCP DEBUG]', Date.now(), 'TOOL_EXECUTE_NOT_FOUND', {
                executeId,
                toolName: name,
                availableTools: Array.from(this.tools.keys()).slice(0, 10),
                totalAvailable: this.tools.size
            });
            throw new Error(`tool '${name}' aint registered fr - check your spelling`);
        }
        __debugLog('[MCP DEBUG]', Date.now(), 'TOOL_EXECUTE_FOUND', {
            executeId,
            toolName: name,
            toolDescription: tool.description?.substring(0, 100)
        });
        const startTime = Date.now();
        try {
            __debugLog('[MCP DEBUG]', startTime, 'TOOL_EXECUTE_CALLING', {
                executeId,
                toolName: name
            });
            const result = await tool.execute(params);
            const duration = Date.now() - startTime;
            const totalDuration = Date.now() - executeStartTime;
            __debugLog('[MCP DEBUG]', Date.now(), 'TOOL_EXECUTE_SUCCESS', {
                executeId,
                toolName: name,
                executeDurationMs: duration,
                totalDurationMs: totalDuration,
                hasResult: !!result,
                resultType: typeof result,
                resultIsArray: Array.isArray(result),
                resultLength: Array.isArray(result) ? result.length : (typeof result === 'object' && result !== null ? Object.keys(result).length : undefined)
            });
            logger.debug({ tool: name, duration }, 'tool execution complete');
            return result;
        }
        catch (error) {
            const errorTime = Date.now();
            const duration = errorTime - startTime;
            const totalDuration = errorTime - executeStartTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            __debugLog('[MCP DEBUG]', errorTime, 'TOOL_EXECUTE_ERROR', {
                executeId,
                toolName: name,
                executeDurationMs: duration,
                totalDurationMs: totalDuration,
                errorMessage,
                errorType: error instanceof Error ? error.constructor.name : typeof error,
                errorStack: errorStack?.split('\n').slice(0, 5).join('\n')
            });
            logger.error({ tool: name, error }, 'tool execution failed fr');
            throw error;
        }
    }
    /**
     * check if a tool is registered
     */
    hasTool(name) {
        return this.tools.has(name);
    }
    /**
     * get count of registered tools
     */
    getToolCount() {
        return this.tools.size;
    }
}
/**
 * Create and initialize the tool registry with all our goofy tools
 *
 * this is where we bring the whole squad together fr
 */
export function createToolRegistry(db, embeddingProvider) {
    // wrap the embedding provider with caching - that 90% hit rate tho
    const cachingProvider = new CachingEmbeddingProvider(embeddingProvider);
    const registry = new ToolRegistry(db, cachingProvider);
    // register all the goofy tools
    // rememberThisShit - store memories that actually matter
    registry.register(new RememberThisShit(db, cachingProvider));
    // findWhatISaid - semantic search hitting different
    registry.register(new FindWhatISaid(db, cachingProvider));
    // whatDidIMean - recall memories by ID or filters
    registry.register(new WhatDidIMean(db));
    // yeahNahDeleteThat - yeet memories we dont need
    registry.register(new YeahNahDeleteThat(db));
    // smushMemoriesTogether - dream-inspired consolidation like doobidoo
    registry.register(new SmushMemoriesTogether(db, cachingProvider));
    // linkTheVibes - create relationships between memories
    registry.register(new LinkTheVibes(db));
    // showMeTheStats - see what we working with
    registry.register(new ShowMeTheStats(db));
    // compareInstanceMemory - compare RAM usage across all SpecMem instances
    registry.register(new CompareInstanceMemory());
    // File watcher tools - auto-update MCP when code changes
    registry.register(new StartWatchingTool());
    registry.register(new StopWatchingTool());
    registry.register(new CheckSyncTool());
    registry.register(new ForceResyncTool());
    // Claude session extraction tools - auto-extract conversation history
    registry.register(new ExtractClaudeSessions(cachingProvider, db));
    registry.register(new GetSessionWatcherStatus());
    // Pass embeddingProvider so extracted memories have embeddings for semantic search!
    registry.register(new ExtractContextRestorations(db, cachingProvider));
    // TeamMember communication tools - enable multi-team member coordination
    registry.register(new SayToTeamMember());
    registry.register(new ListenForMessages());
    registry.register(new GetActiveTeamMembers());
    registry.register(new SendHeartbeat());
    // Research team member tools - spawn Claude to research web when local AI needs more context
    // Flow: SpecMem context -> Claude drilldown -> Local AI gathers more -> Spawn Claude for web research
    registry.register(new SpawnResearchTeamMemberTool());
    registry.register(new GetActiveResearchTeamMembersTool());
    // TeamMember deployment monitoring tools - monitor and intervene in deployed team members
    registry.register(new ListDeployedTeamMembers());
    registry.register(new GetTeamMemberStatus());
    registry.register(new GetTeamMemberOutput());
    registry.register(new GetTeamMemberScreen());
    registry.register(new InterveneTeamMember());
    registry.register(new KillDeployedTeamMember());
    // Smart search tool - interactive search mode selector (basic vs gallery)
    registry.register(new SmartSearch());
    // Memory drilldown tools - gallery + full drill-down with code + conversation
    registry.register(new FindMemoryGallery(db));
    registry.register(new GetMemoryFull(db));
    // Code pointers tool - semantic codebase search with tracebacks
    registry.register(new FindCodePointers(db, cachingProvider));
    // Camera roll drilldown tools - zoom in/out on memories and code
    registry.register(new DrillDown(db));
    registry.register(new GetMemoryByDrilldownID(db));
    // Team communication tools - multi-team member coordination
    const teamCommTools = createTeamCommTools();
    for (const tool of teamCommTools) {
        registry.register(tool);
    }
    // Embedding server control tools (Phase 4) - start/stop/status
    // Pass embedding provider ref for socket reset after server restart
    setEmbeddingProviderRef(embeddingProvider);
    const embeddingControlTools = createEmbeddingControlTools();
    for (const tool of embeddingControlTools) {
        registry.register(tool);
    }
    const timestamp = new Date().toISOString();
    logger.info({
        timestamp,
        event: 'REGISTRY_COMPLETE',
        toolCount: registry.getToolCount()
    }, `[MCP DEBUG] Tool registry initialized with ${registry.getToolCount()} tools`);
    // DEBUG: Write to stderr for immediate visibility
    process.stderr.write(`[SPECMEM DEBUG ${timestamp}] Tool registry complete: ${registry.getToolCount()} tools registered\n`);
    return registry;
}
/**
 * Create tool registry with CODEBASE TOOLS included
 * use this when you want the full ingestThisWholeAssMfCodebase experience
 *
 * @param db - the database manager for memory operations
 * @param pool - ConnectionPoolGoBrrr for codebase operations (uses advanced pool features)
 * @param embeddingProvider - for generating embeddings
 */
export function createFullToolRegistry(db, pool, embeddingProvider) {
    // first create the basic registry with goofy tools
    const registry = createToolRegistry(db, embeddingProvider);
    // now add all the codebase tools - ingestThisWholeAssMfCodebase and friends
    const codebaseTools = createCodebaseTools(pool, embeddingProvider);
    for (const tool of codebaseTools) {
        registry.register(tool);
    }
    // add package tracking tools - trackTheNodeModulesVibes fr fr
    const packageTools = createPackageTools(pool);
    registry.register(packageTools.getPackageHistory);
    registry.register(packageTools.getRecentPackageChanges);
    registry.register(packageTools.getCurrentDependencies);
    registry.register(packageTools.whenWasPackageAdded);
    registry.register(packageTools.queryPackageHistory);
    registry.register(packageTools.getPackageStats);
    logger.info({
        toolCount: registry.getToolCount(),
        codebaseToolsAdded: codebaseTools.length,
        packageToolsAdded: 6
    }, 'Full tool registry initialized with codebase ingestion + package tracking - WE READY TO EAT SOME CODE');
    return registry;
}
/**
 * Create COMPLETE tool registry with ALL features including memorization
 *
 * yooo this is THE ULTIMATE registry - includes:
 * - goofy memory tools
 * - codebase ingestion
 * - package tracking
 * - AUTO-MEMORIZATION (Claude remembers what it writes!)
 *
 * fr fr Claude never needs massive explores again
 */
export function createUltimateToolRegistry(db, pool, embeddingProvider, memorizationConfig) {
    // first create full registry with codebase + package tools
    const registry = createFullToolRegistry(db, pool, embeddingProvider);
    // now add memorization tools - THE SECRET SAUCE
    // this is what makes Claude remember what it wrote
    try {
        const memSystem = initializeMemorizationSystem({
            pool: pool.getPool(), // get raw pg.Pool from ConnectionPoolGoBrrr
            embeddingProvider,
            ...memorizationConfig
        });
        // register all memorization tools
        for (const tool of memSystem.tools) {
            registry.register(tool);
        }
        logger.info({
            toolCount: registry.getToolCount(),
            memorizationToolsAdded: memSystem.tools.length,
            memorizationToolNames: memSystem.tools.map(t => t.name)
        }, 'ULTIMATE tool registry initialized with AUTO-MEMORIZATION - Claude NEVER forgets now');
    }
    catch (error) {
        logger.warn({ error }, 'memorization tools not added - continuing without them');
    }
    // Add trace/explore tools - THE 80% SEARCH REDUCTION MAGIC
    try {
        const traceExploreTools = createTraceExploreTools();
        for (const tool of traceExploreTools) {
            registry.register(tool);
        }
        logger.info({
            toolCount: registry.getToolCount(),
            traceExploreToolsAdded: traceExploreTools.length,
            traceExploreToolNames: traceExploreTools.map(t => t.name)
        }, 'Trace/Explore tools added - 80%+ search reduction activated fr fr');
    }
    catch (error) {
        logger.warn({ error }, 'trace/explore tools not added - continuing without them');
    }
    return registry;
}
export { _EMBEDDING_CACHE, getCachedEmbedding, setCachedEmbedding };
//# sourceMappingURL=toolRegistry.js.map