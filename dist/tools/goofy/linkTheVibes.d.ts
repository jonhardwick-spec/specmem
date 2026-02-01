/**
 * linkTheVibes - create memory relationships
 *
 * connects memories together for graph-based traversal
 * creates those associations that make retrieval smarter
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { LinkMemoriesParams, Memory } from '../../types/index.js';
interface LinkResult {
    success: boolean;
    linksCreated: number;
    message: string;
    links?: Array<{
        sourceId: string;
        targetId: string;
        bidirectional: boolean;
    }>;
}
interface RelatedMemory {
    memory: Memory;
    relationType: string;
    strength: number;
    depth: number;
}
/**
 * LinkTheVibes - memory relationship tool
 *
 * creates connections between memories for smarter retrieval
 * supports bidirectional links and different relationship types
 */
export declare class LinkTheVibes implements MCPTool<LinkMemoriesParams, LinkResult> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            sourceId: {
                type: string;
                format: string;
                description: string;
            };
            targetIds: {
                type: string;
                items: {
                    type: string;
                    format: string;
                };
                minItems: number;
                description: string;
            };
            bidirectional: {
                type: string;
                default: boolean;
                description: string;
            };
            relationType: {
                type: string;
                default: string;
                description: string;
            };
            strength: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager);
    execute(params: LinkMemoriesParams & {
        relationType?: string;
        strength?: number;
    }): Promise<LinkResult>;
    /**
     * create links between memories
     */
    private createLinks;
    /**
     * get related memories through the relationship graph
     *
     * traverses the graph up to specified depth
     */
    getRelatedMemories(memoryId: string, depth?: number): Promise<RelatedMemory[]>;
    /**
     * unlink memories - remove a relationship
     */
    unlinkMemories(sourceId: string, targetId: string, bidirectional?: boolean): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * find memories that could be linked based on similarity
     *
     * suggests potential relationships for auto-linking
     */
    findLinkableMemories(memoryId: string, threshold?: number): Promise<Array<{
        targetId: string;
        similarity: number;
        alreadyLinked: boolean;
    }>>;
    /**
     * auto-link memories based on similarity
     *
     * automatically creates links between similar memories
     */
    autoLinkSimilar(memoryId: string, threshold?: number, maxLinks?: number): Promise<LinkResult>;
    /**
     * get link statistics for a memory
     */
    getLinkStats(memoryId: string): Promise<{
        outgoingLinks: number;
        incomingLinks: number;
        totalConnections: number;
        relationTypes: Record<string, number>;
    }>;
    private memoryExists;
    private rowToMemory;
    private parseEmbedding;
}
export {};
//# sourceMappingURL=linkTheVibes.d.ts.map