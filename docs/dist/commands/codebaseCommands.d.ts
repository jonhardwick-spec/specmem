/**
 * CodebaseCommands - codebase indexing and search commands for Claude
 *
 * yooo this is where we ingest whole ass codebases
 * - /codebase ingest - scan and index entire codebase
 * - /codebase search <query> - find code semantically
 * - /codebase file <path> - get specific file
 * - /codebase update - refresh changed files
 * - /codebase stats - codebase statistics
 *
 * also handles /docs commands since docs are just special code
 */
import { CommandCategory, CommandAction, CommandResult } from './commandHandler.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../tools/index.js';
/**
 * CodebaseCommands - ingest and search codebases
 *
 * ingestThisWholeAssMfCodebase but as slash commands
 */
export declare class CodebaseCommands implements CommandCategory {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    actions: Map<string, CommandAction>;
    private dimensionService;
    private codeExtensions;
    private readonly docExtensions;
    private readonly configExtensions;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    /**
     * Get the DimensionService (lazy initialization)
     */
    private getDimService;
    /**
     * Prepare embedding for database storage
     */
    private prepareEmbeddingForStorage;
    /**
     * Refresh code extensions from config file
     */
    private refreshCodeExtensions;
    private registerActions;
    handleAction(action: string, args: string[]): Promise<CommandResult>;
    /**
     * Handle /codebase ingest
     */
    private handleIngest;
    /**
     * Scan directory recursively
     */
    private scanDirectory;
    /**
     * Read a file
     */
    private readFile;
    /**
     * Index a file into the database
     */
    private indexFile;
    /**
     * Handle /codebase search
     */
    private handleSearch;
    /**
     * Handle /codebase file
     */
    private handleFile;
    /**
     * Handle /docs get - search for documentation
     */
    private handleGet;
    /**
     * Handle /codebase update
     */
    private handleUpdate;
    /**
     * Handle /codebase stats
     */
    private handleStats;
    /**
     * Handle /codebase languages - show all configured languages
     */
    private handleLanguages;
    /**
     * Handle /codebase lang-enable - enable a language
     */
    private handleLangEnable;
    /**
     * Handle /codebase lang-disable - disable a language
     */
    private handleLangDisable;
    /**
     * Handle /codebase lang-priority - set language priority
     */
    private handleLangPriority;
    private parseArgs;
    getHelp(): string;
}
//# sourceMappingURL=codebaseCommands.d.ts.map