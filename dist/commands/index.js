/**
 * Commands Module - slash command system for 
 *
 * yo this is the central export for all command functionality
 * bringing that doobidoo-style command system to specmem
 *
 * Commands:
 * - /memory - store, search, recall, delete, stats
 * - /codebase - ingest, search, file, update, stats
 * - /context - save, load, list, clear
 * - /docs - index, search, get (alias for codebase)
 * - /prompt - save, load, list, search
 * - /team member - deploy, list, help
 * - /help - show all commands
 */
// Main handler
export { CommandHandler, createCommandHandler } from './commandHandler.js';
// Individual command categories
export { MemoryCommands } from './memoryCommands.js';
export { CodebaseCommands } from './codebaseCommands.js';
export { ContextCommands } from './contextCommands.js';
export { PromptCommands } from './promptCommands.js';
export { TeamMemberCommands } from './teamMemberCommands.js';
// MCP Resource definitions
export { getCommandsResource, getCommandHelpResource, getCommandExecutorToolDefinition, getResourceTemplates } from './mcpResources.js';
// Command loader - loads .md files as MCP prompts
export { CommandLoader, getCommandLoader, resetCommandLoader } from './commandLoader.js';
//# sourceMappingURL=index.js.map