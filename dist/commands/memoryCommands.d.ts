/**
 * MemoryCommands - memory-related slash commands for 
 *
 * yo these are the commands for working with memories fr
 * - /memory store <content> - store a memory
 * - /memory search <query> - semantic search
 * - /memory recall <id> - get specific memory
 * - /memory delete <id> - delete memory
 * - /memory stats - show statistics
 *
 * PROJECT ISOLATED: All operations are scoped to current project
 */
import { CommandCategory, CommandAction, CommandResult } from './commandHandler.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * MemoryCommands - handle all memory-related commands
 *
 * rememberThisShit but as slash commands
 */
export declare class MemoryCommands implements CommandCategory {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    actions: Map<string, CommandAction>;
    private dimensionService;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    private getDimService;
    private prepareEmbedding;
    /**
     * Register all available actions
     */
    private registerActions;
    /**
     * Handle a memory action
     */
    handleAction(action: string, args: string[]): Promise<CommandResult>;
    /**
     * Handle /memory store
     */
    private handleStore;
    /**
     * Handle /memory search
     */
    private handleSearch;
    /**
     * Handle /memory recall
     */
    private handleRecall;
    /**
     * Handle /memory delete
     * PROJECT ISOLATED: Only deletes from current project
     */
    private handleDelete;
    /**
     * Handle /memory stats
     * PROJECT ISOLATED: Stats are scoped to current project
     */
    private handleStats;
    /**
     * Handle /memory update
     */
    private handleUpdate;
    /**
     * Parse args with flags
     */
    private parseArgs;
    /**
     * Get help text for this category
     */
    getHelp(): string;
}
//# sourceMappingURL=memoryCommands.d.ts.map