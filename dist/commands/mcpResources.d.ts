/**
 * MCP Resources for Commands
 *
 * exposes command information as MCP resources
 * so claude can discover and learn about available commands
 */
import { CommandHandler } from './commandHandler.js';
/**
 * Get all commands as an MCP resource
 *
 * Returns a structured view of all available commands
 * that  can use to understand what's available
 */
export declare function getCommandsResource(handler: CommandHandler): {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    contents: string;
};
/**
 * Get command help as an MCP resource
 *
 * Returns detailed help for a specific command or all commands
 */
export declare function getCommandHelpResource(handler: CommandHandler, category?: string, action?: string): {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    contents: string;
};
/**
 * Generate MCP tool definition for command execution
 */
export declare function getCommandExecutorToolDefinition(): {
    name: string;
    description: string;
    inputSchema: object;
};
/**
 * Generate MCP resource templates for dynamic command help
 */
export declare function getResourceTemplates(): Array<{
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
}>;
//# sourceMappingURL=mcpResources.d.ts.map