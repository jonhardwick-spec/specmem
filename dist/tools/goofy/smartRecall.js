/**
 * smartRecall.ts - INTELLIGENT MEMORY RETRIEVAL
 *
 * This tool provides advanced memory recall with:
 * - Adaptive context windows (grows based on relevance)
 * - Associative memory spreading (related memories surface)
 * - Memory chain awareness (reasoning paths preserved)
 * - Quadrant-optimized search (spatial partitioning)
 * - Forgetting curve consideration (strength-aware)
 *
 * Unlike basic search, this tool understands memory relationships
 * and builds a contextually rich response.
 */
import { HumanLikeMemorySystem } from '../../memory/humanLikeMemory.js';
import { QuadrantSearchSystem } from '../../memory/quadrantSearch.js';
import { logger } from '../../utils/logger.js';
import { compactResponse } from '../../services/ResponseCompactor.js';
import { getEmbeddingTimeout } from '../../config/embeddingTimeouts.js';
/**
 * UNIFIED TIMEOUT CONFIGURATION
 * Set SPECMEM_EMBEDDING_TIMEOUT (seconds) to control ALL embedding timeouts
 * See src/config/embeddingTimeouts.ts for full documentation
 */
const EMBEDDING_TIMEOUT_MS = getEmbeddingTimeout('search');
const CONTEXT_WINDOW_TIMEOUT_MS = getEmbeddingTimeout('search');
const QUADRANT_SEARCH_TIMEOUT_MS = getEmbeddingTimeout('search');
/**
 * SmartRecall - Intelligent Memory Retrieval Tool
 *
 * This is the evolved version of basic memory search.
 * It understands context, relationships, and memory health.
 */
export class SmartRecall {
    db;
    embeddingProvider;
    name = 'smart_recall';
    description = 'Intelligent memory retrieval with adaptive context, associations, and reasoning chains - the evolved search';
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What you want to recall - can be a question, topic, or context description'
            },
            maxTokens: {
                type: 'number',
                default: 8000,
                minimum: 1000,
                maximum: 50000,
                description: 'Token budget for the context window'
            },
            minRelevance: {
                type: 'number',
                default: 0.6,
                minimum: 0,
                maximum: 1,
                description: 'Minimum similarity threshold for including memories'
            },
            includeAssociations: {
                type: 'boolean',
                default: true,
                description: 'Include memories associated with core results'
            },
            includeChains: {
                type: 'boolean',
                default: true,
                description: 'Include memories from reasoning chains'
            },
            useQuadrants: {
                type: 'boolean',
                default: true,
                description: 'Use quadrant optimization for faster search'
            },
            maxAssociationDepth: {
                type: 'number',
                default: 2,
                minimum: 1,
                maximum: 5,
                description: 'How many hops to follow in association graph'
            },
            boostRecentAccess: {
                type: 'boolean',
                default: false,
                description: 'Boost score of recently accessed memories'
            },
            boostHighImportance: {
                type: 'boolean',
                default: true,
                description: 'Boost score of high-importance memories'
            }
        },
        required: ['query']
    };
    memorySystem;
    quadrantSystem;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.memorySystem = new HumanLikeMemorySystem(db, embeddingProvider);
        this.quadrantSystem = new QuadrantSearchSystem(db, embeddingProvider);
    }
    async execute(params) {
        const startTime = Date.now();
        logger.debug({ query: params.query }, 'smart recall initiated');
        try {
            // Generate embedding for query with timeout protection
            const embeddingPromise = this.embeddingProvider.generateEmbedding(params.query);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    const timeoutError = new Error(`Embedding generation timeout after ${EMBEDDING_TIMEOUT_MS / 1000}s. ` +
                        `Increase SPECMEM_FIND_TIMEOUT_MS environment variable if needed.`);
                    timeoutError.code = 'EMBEDDING_TIMEOUT';
                    reject(timeoutError);
                }, EMBEDDING_TIMEOUT_MS);
            });
            const embedding = await Promise.race([embeddingPromise, timeoutPromise]);
            // Build adaptive context window with timeout protection
            const contextWindowPromise = this.memorySystem.buildContextWindow(params.query, embedding, {
                maxTokens: params.maxTokens ?? 8000,
                minRelevance: params.minRelevance ?? 0.6,
                includeAssociations: params.includeAssociations ?? true,
                includeChains: params.includeChains ?? true,
                maxAssociationDepth: params.maxAssociationDepth ?? 2
            });
            const contextWindowTimeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    const timeoutError = new Error(`Context window building timeout after ${CONTEXT_WINDOW_TIMEOUT_MS / 1000}s. ` +
                        `Increase SPECMEM_FIND_TIMEOUT_MS environment variable if needed.`);
                    timeoutError.code = 'CONTEXT_WINDOW_TIMEOUT';
                    reject(timeoutError);
                }, CONTEXT_WINDOW_TIMEOUT_MS);
            });
            const contextWindow = await Promise.race([contextWindowPromise, contextWindowTimeoutPromise]);
            // If quadrants enabled, use quadrant-optimized search for additional context with timeout protection
            let quadrantsSearched = 0;
            if (params.useQuadrants) {
                try {
                    // Initialize quadrants with timeout
                    const initPromise = this.quadrantSystem.initialize();
                    const initTimeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => {
                            const timeoutError = new Error(`Quadrant initialization timeout after ${QUADRANT_SEARCH_TIMEOUT_MS / 1000}s. ` +
                                `Increase SPECMEM_FIND_TIMEOUT_MS environment variable if needed.`);
                            timeoutError.code = 'QUADRANT_INIT_TIMEOUT';
                            reject(timeoutError);
                        }, QUADRANT_SEARCH_TIMEOUT_MS);
                    });
                    await Promise.race([initPromise, initTimeoutPromise]);
                    // Search quadrants with timeout
                    const searchPromise = this.quadrantSystem.searchQuadrants(embedding, {
                        maxQuadrants: 5,
                        minRelevance: 0.3
                    });
                    const searchTimeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => {
                            const timeoutError = new Error(`Quadrant search timeout after ${QUADRANT_SEARCH_TIMEOUT_MS / 1000}s. ` +
                                `Increase SPECMEM_FIND_TIMEOUT_MS environment variable if needed.`);
                            timeoutError.code = 'QUADRANT_SEARCH_TIMEOUT';
                            reject(timeoutError);
                        }, QUADRANT_SEARCH_TIMEOUT_MS);
                    });
                    const quadrantResults = await Promise.race([searchPromise, searchTimeoutPromise]);
                    quadrantsSearched = quadrantResults.length;
                }
                catch (error) {
                    logger.warn({ error }, 'quadrant search failed, using fallback');
                }
            }
            // Apply boosts if requested
            const boostedCore = this.applyBoosts(contextWindow.coreMemories, params.boostRecentAccess ?? false, params.boostHighImportance ?? true);
            // Update memory strength for accessed memories
            for (const memory of boostedCore.slice(0, 10)) {
                try {
                    await this.memorySystem.updateMemoryStrength(memory.id, true, // successful recall
                    memory.importance);
                }
                catch (error) {
                    // Non-critical, continue
                }
            }
            const duration = Date.now() - startTime;
            const result = {
                success: true,
                contextWindow: {
                    coreMemories: boostedCore.map(m => this.toSummary(m)),
                    associatedMemories: contextWindow.associatedMemories.map(m => this.toSummary(m)),
                    chainMemories: contextWindow.chainMemories.map(m => this.toSummary(m)),
                    contextualMemories: contextWindow.contextualMemories.map(m => this.toSummary(m)),
                    totalMemories: boostedCore.length +
                        contextWindow.associatedMemories.length +
                        contextWindow.chainMemories.length +
                        contextWindow.contextualMemories.length,
                    estimatedTokens: contextWindow.totalTokenEstimate
                },
                searchStats: {
                    quadrantsSearched,
                    associationsTraversed: contextWindow.associatedMemories.length,
                    chainsFound: await this.countChainsFound(contextWindow.chainMemories),
                    totalTimeMs: duration
                },
                message: `Found ${boostedCore.length} core memories with ${contextWindow.associatedMemories.length} associations in ${duration}ms`
            };
            logger.info({
                coreCount: boostedCore.length,
                associatedCount: contextWindow.associatedMemories.length,
                chainCount: contextWindow.chainMemories.length,
                duration
            }, 'smart recall complete');
            // Apply Chinese compactor for token efficiency
            return compactResponse(result, 'search');
        }
        catch (error) {
            logger.error({ error }, 'smart recall failed');
            // Apply Chinese compactor for token efficiency
            return compactResponse({
                success: false,
                contextWindow: {
                    coreMemories: [],
                    associatedMemories: [],
                    chainMemories: [],
                    contextualMemories: [],
                    totalMemories: 0,
                    estimatedTokens: 0
                },
                searchStats: {
                    associationsTraversed: 0,
                    chainsFound: 0,
                    totalTimeMs: Date.now() - startTime
                },
                message: error instanceof Error ? error.message : 'Smart recall failed'
            }, 'search');
        }
    }
    /**
     * Apply score boosts to memories based on recency and importance
     */
    applyBoosts(memories, boostRecentAccess, boostHighImportance) {
        if (!boostRecentAccess && !boostHighImportance)
            return memories;
        return [...memories].sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;
            if (boostHighImportance) {
                const importanceScore = {
                    critical: 5,
                    high: 3,
                    medium: 1,
                    low: 0,
                    trivial: -1
                };
                scoreA += importanceScore[a.importance] ?? 0;
                scoreB += importanceScore[b.importance] ?? 0;
            }
            if (boostRecentAccess && a.lastAccessedAt && b.lastAccessedAt) {
                // More recent = higher score
                scoreA += (a.lastAccessedAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30); // days ago (negative)
                scoreB += (b.lastAccessedAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30);
            }
            return scoreB - scoreA;
        });
    }
    async countChainsFound(chainMemories) {
        if (chainMemories.length === 0)
            return 0;
        // Count unique chains represented
        const uniqueChains = new Set();
        for (const memory of chainMemories) {
            const chains = await this.memorySystem.findChainsContaining(memory.id);
            chains.forEach(c => uniqueChains.add(c.id));
        }
        return uniqueChains.size;
    }
    toSummary(memory) {
        return {
            id: memory.id,
            content: memory.content.substring(0, 500) + (memory.content.length > 500 ? '...' : ''),
            memoryType: memory.memoryType,
            importance: memory.importance,
            tags: memory.tags,
            accessCount: memory.accessCount,
            createdAt: memory.createdAt.toISOString()
        };
    }
}
export default SmartRecall;
//# sourceMappingURL=smartRecall.js.map