/**
 * PromptCommands - prompt library management for Claude
 *
 * save and reuse prompts fr fr
 * - /prompt save <name> - save current prompt
 * - /prompt load <name> - load saved prompt
 * - /prompt list - list all saved prompts
 * - /prompt search <query> - find prompts semantically
 *
 * this is how you build up a library of reusable prompts
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import { CommandCategory, CommandAction, CommandResult } from './commandHandler.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * PromptCommands - manage a library of reusable prompts
 *
 * save your best prompts and never lose them again
 */
export declare class PromptCommands implements CommandCategory {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    actions: Map<string, CommandAction>;
    private dimensionService;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Prepare embedding for database storage
     */
    private prepareEmbeddingForStorage;
    private registerActions;
    /**
     * Ensure the prompts table exists
     */
    private ensurePromptTable;
    handleAction(action: string, args: string[]): Promise<CommandResult>;
    /**
     * Handle /prompt save
     */
    private handleSave;
    /**
     * Handle /prompt load
     */
    private handleLoad;
    /**
     * Handle /prompt list
     */
    private handleList;
    /**
     * Handle /prompt search
     */
    private handleSearch;
    /**
     * Handle /prompt delete
     */
    private handleDelete;
    /**
     * Handle /prompt update
     */
    private handleUpdate;
    /**
     * Handle /prompt export
     */
    private handleExport;
    /**
     * Handle /prompt import
     */
    private handleImport;
    /**
     * Handle /prompt categories
     */
    private handleCategories;
    /**
     * Extract template variables from prompt content
     * Variables are in the format {{variable_name}}
     */
    private extractVariables;
    private parseArgs;
    getHelp(): string;
}
//# sourceMappingURL=promptCommands.d.ts.map