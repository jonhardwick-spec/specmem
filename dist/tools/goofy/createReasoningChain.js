/**
 * createReasoningChain.ts - CREATE AND MANAGE REASONING CHAINS
 *
 * Reasoning chains preserve sequential thought processes:
 * - Multi-step problem solving
 * - Code implementation sequences
 * - Debugging trails
 * - Decision trees
 *
 * Unlike flat memory storage, chains maintain ORDER and CAUSALITY,
 * making it easy to follow a train of thought or retrace steps.
 */
import { HumanLikeMemorySystem } from '../../memory/humanLikeMemory.js';
import { logger } from '../../utils/logger.js';
/**
 * CreateReasoningChain - Memory Chain Management Tool
 *
 * Use this to:
 * 1. Create new chains linking related memories in sequence
 * 2. Extend existing chains with new memories
 * 3. Find chains containing specific memories
 */
export class CreateReasoningChain {
    db;
    embeddingProvider;
    name = 'manage_reasoning_chain';
    description = 'Create, extend, and find memory chains that preserve sequential reasoning and implementation paths';
    inputSchema = {
        type: 'object',
        properties: {
            // For creating new chains
            name: {
                type: 'string',
                description: 'Name for the new chain (for create operation)'
            },
            description: {
                type: 'string',
                description: 'Description of what this chain represents (for create operation)'
            },
            memoryIds: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description: 'Ordered list of memory IDs to include (for create operation)'
            },
            chainType: {
                type: 'string',
                enum: ['reasoning', 'implementation', 'debugging', 'exploration', 'conversation'],
                description: 'Type of reasoning chain'
            },
            importance: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low', 'trivial'],
                default: 'medium',
                description: 'Importance level of this chain'
            },
            // For extending chains
            chainId: {
                type: 'string',
                format: 'uuid',
                description: 'ID of chain to extend (for extend operation)'
            },
            newMemoryIds: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description: 'New memory IDs to add to the chain (for extend operation)'
            },
            // For finding chains
            memoryId: {
                type: 'string',
                format: 'uuid',
                description: 'Find chains containing this memory ID (for find operation)'
            },
            keyword: {
                type: 'string',
                description: 'Search chains by name/description keyword (for find operation)'
            },
            limit: {
                type: 'number',
                default: 10,
                description: 'Maximum chains to return (for find operation)'
            }
        }
    };
    memorySystem;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.memorySystem = new HumanLikeMemorySystem(db, embeddingProvider);
    }
    async execute(params) {
        // Determine operation type based on provided parameters
        if ('name' in params && params.name && 'memoryIds' in params) {
            return this.createChain(params);
        }
        else if ('chainId' in params && params.chainId && 'newMemoryIds' in params) {
            return this.extendChain(params);
        }
        else {
            return this.findChains(params);
        }
    }
    /**
     * Create a new reasoning chain
     */
    async createChain(params) {
        logger.debug({ name: params.name, memoryCount: params.memoryIds.length }, 'creating reasoning chain');
        try {
            // Validate memory IDs exist
            const validIds = await this.validateMemoryIds(params.memoryIds);
            if (validIds.length === 0) {
                return {
                    success: false,
                    message: 'No valid memory IDs provided'
                };
            }
            if (validIds.length < params.memoryIds.length) {
                logger.warn({
                    requested: params.memoryIds.length,
                    valid: validIds.length
                }, 'some memory IDs were invalid');
            }
            const chain = await this.memorySystem.createChain(params.name, params.description, validIds, params.chainType, params.importance ?? 'medium');
            logger.info({ chainId: chain.id, memoryCount: validIds.length }, 'reasoning chain created');
            return {
                success: true,
                chain,
                message: `Created chain "${params.name}" with ${validIds.length} memories`
            };
        }
        catch (error) {
            logger.error({ error }, 'failed to create chain');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Chain creation failed'
            };
        }
    }
    /**
     * Extend an existing chain with new memories
     */
    async extendChain(params) {
        logger.debug({ chainId: params.chainId, newCount: params.newMemoryIds.length }, 'extending chain');
        try {
            const validIds = await this.validateMemoryIds(params.newMemoryIds);
            if (validIds.length === 0) {
                return {
                    success: false,
                    message: 'No valid memory IDs to add'
                };
            }
            const chain = await this.memorySystem.extendChain(params.chainId, validIds);
            logger.info({ chainId: chain.id, totalMemories: chain.memoryIds.length }, 'chain extended');
            return {
                success: true,
                chain,
                message: `Extended chain with ${validIds.length} new memories (total: ${chain.memoryIds.length})`
            };
        }
        catch (error) {
            logger.error({ error }, 'failed to extend chain');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Chain extension failed'
            };
        }
    }
    /**
     * Find chains by memory ID or keyword
     */
    async findChains(params) {
        logger.debug({ params }, 'finding chains');
        try {
            let chains = [];
            if (params.memoryId) {
                // Find chains containing a specific memory
                chains = await this.memorySystem.findChainsContaining(params.memoryId);
            }
            else if (params.keyword) {
                // Search by keyword
                const query = `
          SELECT * FROM memory_chains
          WHERE
            name ILIKE $1
            OR description ILIKE $1
          ORDER BY last_accessed_at DESC
          LIMIT $2
        `;
                const result = await this.db.query(query, [`%${params.keyword}%`, params.limit ?? 10]);
                chains = result.rows.map((row) => this.rowToChain(row));
            }
            else if (params.chainType) {
                // Find by type
                const query = `
          SELECT * FROM memory_chains
          WHERE chain_type = $1
          ORDER BY last_accessed_at DESC
          LIMIT $2
        `;
                const result = await this.db.query(query, [params.chainType, params.limit ?? 10]);
                chains = result.rows.map((row) => this.rowToChain(row));
            }
            else {
                // List recent chains
                const query = `
          SELECT * FROM memory_chains
          ORDER BY last_accessed_at DESC
          LIMIT $1
        `;
                const result = await this.db.query(query, [params.limit ?? 10]);
                chains = result.rows.map((row) => this.rowToChain(row));
            }
            return {
                success: true,
                chains,
                message: `Found ${chains.length} chain(s)`
            };
        }
        catch (error) {
            logger.error({ error }, 'failed to find chains');
            return {
                success: false,
                chains: [],
                message: error instanceof Error ? error.message : 'Chain search failed'
            };
        }
    }
    /**
     * Validate that memory IDs exist in the database
     */
    async validateMemoryIds(ids) {
        if (ids.length === 0)
            return [];
        const query = `
      SELECT id FROM memories
      WHERE id = ANY($1)
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
        const result = await this.db.query(query, [ids]);
        return result.rows.map((row) => row.id);
    }
    rowToChain(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            memoryIds: row.memory_ids || [],
            chainType: row.chain_type,
            importance: row.importance,
            createdAt: row.created_at,
            lastAccessedAt: row.last_accessed_at,
            accessCount: row.access_count,
            metadata: row.metadata || {}
        };
    }
}
export default CreateReasoningChain;
//# sourceMappingURL=createReasoningChain.js.map