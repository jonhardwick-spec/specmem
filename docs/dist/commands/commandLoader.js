/**
 * CommandLoader - Load command .md files as MCP prompts
 *
 * This loads specmem command files from the commands/ directory
 * and registers them as MCP prompts so Claude can use them anywhere
 * the MCP server is deployed.
 *
 * Commands become prompts like:
 * - specmem-remember
 * - specmem-find
 * - specmem-code
 * - specmem-stats
 * - etc.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * CommandLoader - scans commands/ dir and loads as MCP prompts
 */
export class CommandLoader {
    commands = new Map();
    commandsDir;
    constructor(commandsDir) {
        // Default to commands/ directory relative to project root
        // Go up from src/commands to project root, then into commands/
        this.commandsDir = commandsDir || join(__dirname, '..', '..', 'commands');
        this.loadCommands();
    }
    /**
     * Load all command .md files from the commands directory
     */
    loadCommands() {
        if (!existsSync(this.commandsDir)) {
            logger.warn({ dir: this.commandsDir }, 'commands directory not found');
            return;
        }
        try {
            const files = readdirSync(this.commandsDir)
                .filter(f => f.endsWith('.md') && f.startsWith('specmem'));
            for (const file of files) {
                try {
                    const filePath = join(this.commandsDir, file);
                    const content = readFileSync(filePath, 'utf-8');
                    const name = basename(file, '.md');
                    const description = this.extractDescription(content);
                    const command = {
                        name,
                        fileName: file,
                        content,
                        description,
                        usage: this.extractUsage(content)
                    };
                    this.commands.set(name, command);
                    logger.debug({ name, file }, 'loaded command');
                }
                catch (err) {
                    logger.error({ file, error: err }, 'failed to load command file');
                }
            }
            logger.info({ count: this.commands.size, dir: this.commandsDir }, 'commands loaded');
        }
        catch (err) {
            logger.error({ error: err, dir: this.commandsDir }, 'failed to read commands directory');
        }
    }
    /**
     * Extract description from command file (first non-empty line after title)
     */
    extractDescription(content) {
        const lines = content.split('\n');
        let foundTitle = false;
        for (const line of lines) {
            if (line.startsWith('# ')) {
                foundTitle = true;
                // Check if there's a subtitle on same line
                const parts = line.split(' - ');
                if (parts.length > 1) {
                    return parts[1]?.trim() || 'SpecMem command';
                }
                continue;
            }
            if (foundTitle && line.trim() && !line.startsWith('#')) {
                return line.trim();
            }
        }
        return 'SpecMem command';
    }
    /**
     * Extract usage section from command file
     */
    extractUsage(content) {
        const usageMatch = content.match(/## Usage\s*\n```[^\n]*\n([\s\S]*?)```/);
        return usageMatch?.[1]?.trim();
    }
    /**
     * Get all commands as MCP prompts
     */
    getPrompts() {
        const prompts = [];
        for (const [name, command] of this.commands) {
            prompts.push({
                name,
                description: command.description,
                arguments: [
                    {
                        name: 'args',
                        description: 'Optional arguments for the command',
                        required: false
                    }
                ]
            });
        }
        // Add master prompt that lists all commands
        prompts.push({
            name: 'specmem-help',
            description: 'List all available SpecMem commands',
            arguments: []
        });
        return prompts;
    }
    /**
     * Get prompt messages for a specific command
     */
    getPromptMessages(promptName, args) {
        // Handle help prompt
        if (promptName === 'specmem-help') {
            return this.getHelpMessages();
        }
        const command = this.commands.get(promptName);
        if (!command) {
            return [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Command not found: ${promptName}\n\nAvailable commands:\n${this.getCommandList()}`
                    }
                }];
        }
        // Return the full command content with any args appended
        let text = command.content;
        if (args?.args) {
            text += `\n\n---\n\n**User Arguments:** ${args.args}`;
        }
        return [{
                role: 'user',
                content: {
                    type: 'text',
                    text
                }
            }];
    }
    /**
     * Get help messages listing all commands
     */
    getHelpMessages() {
        let text = '# SpecMem Commands\n\n';
        text += 'Available commands that can be used as MCP prompts:\n\n';
        for (const [name, command] of this.commands) {
            text += `## ${name}\n`;
            text += `${command.description}\n`;
            if (command.usage) {
                text += `\n\`\`\`\n${command.usage}\n\`\`\`\n`;
            }
            text += '\n';
        }
        text += '---\n\n';
        text += 'Use any command by name (e.g., `specmem-remember`) to get detailed instructions.\n';
        return [{
                role: 'user',
                content: {
                    type: 'text',
                    text
                }
            }];
    }
    /**
     * Get simple command list
     */
    getCommandList() {
        return Array.from(this.commands.keys()).map(n => `- ${n}`).join('\n');
    }
    /**
     * Get a specific command by name
     */
    getCommand(name) {
        return this.commands.get(name);
    }
    /**
     * Get all loaded commands
     */
    getAllCommands() {
        return Array.from(this.commands.values());
    }
    /**
     * Reload commands from disk
     */
    reload() {
        this.commands.clear();
        this.loadCommands();
    }
}
// Singleton instance
let loaderInstance = null;
/**
 * Get the command loader singleton
 */
export function getCommandLoader(commandsDir) {
    if (!loaderInstance) {
        loaderInstance = new CommandLoader(commandsDir);
    }
    return loaderInstance;
}
/**
 * Reset the command loader (for testing)
 */
export function resetCommandLoader() {
    loaderInstance = null;
}
//# sourceMappingURL=commandLoader.js.map