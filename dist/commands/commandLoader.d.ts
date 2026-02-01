/**
 * CommandLoader - Load command .md files as MCP prompts
 *
 * This loads specmem command files from the commands/ directory
 * and registers them as MCP prompts so  can use them anywhere
 * the MCP server is deployed.
 *
 * Commands become prompts like:
 * - specmem-remember
 * - specmem-find
 * - specmem-code
 * - specmem-stats
 * - etc.
 */
/**
 * Command definition loaded from .md file
 */
export interface LoadedCommand {
    name: string;
    fileName: string;
    content: string;
    description: string;
    usage?: string;
}
/**
 * MCP Prompt definition for a command
 */
export interface CommandPrompt {
    name: string;
    description: string;
    arguments?: Array<{
        name: string;
        description: string;
        required: boolean;
    }>;
}
/**
 * Prompt message for MCP
 */
export interface CommandPromptMessage {
    role: 'user' | 'assistant';
    content: {
        type: 'text';
        text: string;
    };
}
/**
 * CommandLoader - scans commands/ dir and loads as MCP prompts
 */
export declare class CommandLoader {
    private commands;
    private commandsDir;
    constructor(commandsDir?: string);
    /**
     * Load all command .md files from the commands directory
     */
    private loadCommands;
    /**
     * Extract description from command file (first non-empty line after title)
     */
    private extractDescription;
    /**
     * Extract usage section from command file
     */
    private extractUsage;
    /**
     * Get all commands as MCP prompts
     */
    getPrompts(): CommandPrompt[];
    /**
     * Get prompt messages for a specific command
     */
    getPromptMessages(promptName: string, args?: Record<string, string>): CommandPromptMessage[];
    /**
     * Get help messages listing all commands
     */
    private getHelpMessages;
    /**
     * Get simple command list
     */
    private getCommandList;
    /**
     * Get a specific command by name
     */
    getCommand(name: string): LoadedCommand | undefined;
    /**
     * Get all loaded commands
     */
    getAllCommands(): LoadedCommand[];
    /**
     * Reload commands from disk
     */
    reload(): void;
}
/**
 * Get the command loader singleton
 */
export declare function getCommandLoader(commandsDir?: string): CommandLoader;
/**
 * Reset the command loader (for testing)
 */
export declare function resetCommandLoader(): void;
//# sourceMappingURL=commandLoader.d.ts.map