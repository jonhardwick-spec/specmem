/**
 * ClaudeCommandHandler - main command processor for Claude interaction
 *
 * yo this is where all the slash commands get parsed and dispatched
 * claude says /memory store and we make it happen fr
 *
 * Command syntax:
 * /<category> <action> [args...]
 *
 * Categories:
 * - memory: store, search, recall, delete, stats
 * - codebase: ingest, search, file, update, stats
 * - context: save, load, list, clear
 * - docs: index, search, get
 * - prompt: save, load, list, search
 * - teamMember: deploy, list, help
 */
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * Command result - what we return after executing a command
 */
export interface CommandResult {
    success: boolean;
    message: string;
    data?: unknown;
    suggestions?: string[];
}
/**
 * Parsed command structure
 */
export interface ParsedCommand {
    category: string;
    action: string;
    args: string[];
    rawInput: string;
}
/**
 * Command handler interface - all command categories implement this
 */
export interface CommandCategory {
    name: string;
    description: string;
    actions: Map<string, CommandAction>;
    handleAction(action: string, args: string[]): Promise<CommandResult>;
    getHelp(): string;
}
/**
 * Individual command action
 */
export interface CommandAction {
    name: string;
    description: string;
    usage: string;
    examples: string[];
}
/**
 * ClaudeCommandHandler - the brain that parses and routes commands
 *
 * yooo command parsing go crazy
 * this is where we take /memory store and make magic happen
 */
export declare class ClaudeCommandHandler {
    private db;
    private embeddingProvider;
    private categories;
    private commandHistory;
    private maxHistorySize;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    /**
     * Initialize all command categories
     */
    private initializeCategories;
    /**
     * Parse a raw command string into structured form
     *
     * /memory store "this is content" --tags important,work
     * becomes { category: 'memory', action: 'store', args: ['this is content', '--tags', 'important,work'] }
     */
    parseCommand(input: string): ParsedCommand | null;
    /**
     * Tokenize input respecting quoted strings
     */
    private tokenize;
    /**
     * Handle a command - main entry point
     *
     * fr fr this is where the magic happens
     */
    handleCommand(input: string): Promise<CommandResult>;
    /**
     * Handle batch commands - execute multiple commands in sequence
     */
    handleBatch(commands: string[]): Promise<CommandResult[]>;
    /**
     * Get global help - list all categories and their commands
     */
    private getGlobalHelp;
    /**
     * Get suggestions for a misspelled category
     */
    private getSuggestions;
    /**
     * Add command to history
     */
    private addToHistory;
    /**
     * Get command history
     */
    getHistory(): ParsedCommand[];
    /**
     * Get available commands as MCP resource
     */
    getCommandsResource(): {
        commands: Record<string, CommandAction[]>;
    };
    /**
     * Get help for a specific command as MCP resource
     */
    getCommandHelp(category: string, action?: string): string;
}
/**
 * Create a command handler instance
 */
export declare function createCommandHandler(db: DatabaseManager, embeddingProvider: EmbeddingProvider): ClaudeCommandHandler;
//# sourceMappingURL=commandHandler.d.ts.map