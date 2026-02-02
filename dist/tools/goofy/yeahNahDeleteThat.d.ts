/**
 * yeahNahDeleteThat - yeet memories we dont need
 *
 * delete memories by ID, criteria, or expired status
 * handles cascading deletes for relations too
 *
 * Now integrated with LWJEB event bus for memory:deleted events
 * NOW WITH PROJECT ISOLATION - won't accidentally nuke other projects' data
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { DeleteMemoryParams } from '../../types/index.js';
interface DeleteResult {
    success: boolean;
    deletedCount: number;
    message: string;
    deletedIds?: string[];
}
/**
 * YeahNahDeleteThat - memory deletion tool
 *
 * nice try lmao - but fr we validate everything
 * supports batch deletes and cleanup operations
 *
 * Emits LWJEB events: memory:deleted
 */
export declare class YeahNahDeleteThat implements MCPTool<DeleteMemoryParams, DeleteResult> {
    private db;
    name: string;
    description: string;
    private coordinator;
    inputSchema: {
        type: "object";
        properties: {
            id: {
                type: string;
                format: string;
                description: string;
            };
            ids: {
                type: string;
                items: {
                    type: string;
                    format: string;
                };
                description: string;
            };
            olderThan: {
                type: string;
                format: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            expiredOnly: {
                type: string;
                default: boolean;
                description: string;
            };
        };
    };
    constructor(db: DatabaseManager);
    execute(params: DeleteMemoryParams): Promise<DeleteResult>;
    /**
     * delete a single memory by ID
     * PROJECT ISOLATED: Only deletes from current project
     */
    private deleteById;
    /**
     * delete multiple memories by IDs
     * PROJECT ISOLATED: Only deletes from current project
     *
     * uses batch delete for efficiency
     */
    private deleteByIds;
    /**
     * delete by criteria (tags, age, expired status)
     * PROJECT ISOLATED: Only deletes from current project
     */
    private deleteByCriteria;
    /**
     * cleanup expired memories - scheduled task style
     * PROJECT ISOLATED: Only cleans up current project's expired memories
     *
     * call this periodically to keep the db clean
     */
    cleanupExpired(): Promise<DeleteResult>;
    /**
     * delete orphaned relations
     *
     * cleanup relations where source or target no longer exists
     */
    cleanupOrphanedRelations(): Promise<number>;
    /**
     * delete consolidated source memories
     * PROJECT ISOLATED: Only deletes from current project
     *
     * after consolidation, we can optionally remove the originals
     */
    deleteConsolidatedSources(consolidatedId: string): Promise<DeleteResult>;
    private isValidUuid;
}
export {};
//# sourceMappingURL=yeahNahDeleteThat.d.ts.map