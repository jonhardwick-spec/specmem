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
import { logger } from '../utils/logger.js';
import { MemoryCommands } from './memoryCommands.js';
import { CodebaseCommands } from './codebaseCommands.js';
import { ContextCommands } from './contextCommands.js';
import { PromptCommands } from './promptCommands.js';
import { TeamMemberCommands } from './teamMemberCommands.js';
/**
 * ClaudeCommandHandler - the brain that parses and routes commands
 *
 * yooo command parsing go crazy
 * this is where we take /memory store and make magic happen
 */
export class ClaudeCommandHandler {
    db;
    embeddingProvider;
    categories = new Map();
    commandHistory = [];
    maxHistorySize = 100;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
        this.initializeCategories();
    }
    /**
     * Initialize all command categories
     */
    initializeCategories() {
        // memory commands - remember, find, yeet
        const memoryCommands = new MemoryCommands(this.db, this.embeddingProvider);
        this.categories.set('memory', memoryCommands);
        // codebase commands - ingest and search code
        const codebaseCommands = new CodebaseCommands(this.db, this.embeddingProvider);
        this.categories.set('codebase', codebaseCommands);
        // context commands - save/load conversation context
        const contextCommands = new ContextCommands(this.db);
        this.categories.set('context', contextCommands);
        // prompt commands - save and manage prompts
        const promptCommands = new PromptCommands(this.db, this.embeddingProvider);
        this.categories.set('prompt', promptCommands);
        // team member commands - deploy and manage multi-team-member swarms
        const teamMemberCommands = new TeamMemberCommands(this.db);
        this.categories.set('team-member', teamMemberCommands);
        // alias "docs" to use codebase commands for documentation
        this.categories.set('docs', codebaseCommands);
        logger.info({ categoryCount: this.categories.size }, 'command categories initialized');
    }
    /**
     * Parse a raw command string into structured form
     *
     * /memory store "this is content" --tags important,work
     * becomes { category: 'memory', action: 'store', args: ['this is content', '--tags', 'important,work'] }
     */
    parseCommand(input) {
        const trimmed = input.trim();
        // must start with /
        if (!trimmed.startsWith('/')) {
            return null;
        }
        // remove leading /
        const withoutSlash = trimmed.slice(1);
        // parse respecting quotes
        const tokens = this.tokenize(withoutSlash);
        if (tokens.length < 1) {
            return null;
        }
        const category = tokens[0].toLowerCase();
        const action = tokens[1]?.toLowerCase() ?? 'help';
        const args = tokens.slice(2);
        return {
            category,
            action,
            args,
            rawInput: input
        };
    }
    /**
     * Tokenize input respecting quoted strings
     */
    tokenize(input) {
        const tokens = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            }
            else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            }
            else if (char === ' ' && !inQuotes) {
                if (current.length > 0) {
                    tokens.push(current);
                    current = '';
                }
            }
            else {
                current += char;
            }
        }
        if (current.length > 0) {
            tokens.push(current);
        }
        return tokens;
    }
    /**
     * Handle a command - main entry point
     *
     * fr fr this is where the magic happens
     */
    async handleCommand(input) {
        const startTime = Date.now();
        // parse the command
        const parsed = this.parseCommand(input);
        if (!parsed) {
            return {
                success: false,
                message: 'Invalid command format. Commands must start with / - try /help for available commands',
                suggestions: ['/help', '/memory help', '/codebase help']
            };
        }
        // add to history
        this.addToHistory(parsed);
        // special case: global help
        if (parsed.category === 'help') {
            return this.getGlobalHelp();
        }
        // find the category handler
        const category = this.categories.get(parsed.category);
        if (!category) {
            return {
                success: false,
                message: `Unknown command category '${parsed.category}' - nah bruh that aint it`,
                suggestions: this.getSuggestions(parsed.category)
            };
        }
        // delegate to category handler
        try {
            const result = await category.handleAction(parsed.action, parsed.args);
            const duration = Date.now() - startTime;
            logger.debug({
                category: parsed.category,
                action: parsed.action,
                duration,
                success: result.success
            }, 'command executed');
            return result;
        }
        catch (error) {
            logger.error({ error, command: parsed }, 'command execution failed fr');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'command failed for unknown reason'
            };
        }
    }
    /**
     * Handle batch commands - execute multiple commands in sequence
     */
    async handleBatch(commands) {
        const results = [];
        for (const cmd of commands) {
            const result = await this.handleCommand(cmd);
            results.push(result);
            // stop on first failure if its critical
            if (!result.success && result.message.includes('critical')) {
                break;
            }
        }
        return results;
    }
    /**
     * Get global help - list all categories and their commands
     */
    getGlobalHelp() {
        const helpLines = [
            '# Claude Commands - Available Categories',
            '',
            'Use /<category> <action> [args...] to execute commands',
            ''
        ];
        for (const [name, category] of this.categories) {
            if (name === 'docs')
                continue; // skip alias
            helpLines.push(`## /${name} - ${category.description}`);
            helpLines.push(category.getHelp());
            helpLines.push('');
        }
        helpLines.push('---');
        helpLines.push('Use /<category> help for detailed help on each category');
        return {
            success: true,
            message: helpLines.join('\n'),
            data: {
                categories: Array.from(this.categories.keys()).filter(k => k !== 'docs')
            }
        };
    }
    /**
     * Get suggestions for a misspelled category
     */
    getSuggestions(input) {
        const categories = Array.from(this.categories.keys());
        const suggestions = [];
        // simple levenshtein-ish matching
        for (const cat of categories) {
            if (cat.startsWith(input.slice(0, 2)) || input.startsWith(cat.slice(0, 2))) {
                suggestions.push(`/${cat}`);
            }
        }
        if (suggestions.length === 0) {
            suggestions.push('/help');
        }
        return suggestions;
    }
    /**
     * Add command to history
     */
    addToHistory(command) {
        this.commandHistory.push(command);
        if (this.commandHistory.length > this.maxHistorySize) {
            this.commandHistory.shift();
        }
    }
    /**
     * Get command history
     */
    getHistory() {
        return [...this.commandHistory];
    }
    /**
     * Get available commands as MCP resource
     */
    getCommandsResource() {
        const commands = {};
        for (const [name, category] of this.categories) {
            if (name === 'docs')
                continue; // skip alias
            commands[name] = Array.from(category.actions.values());
        }
        return { commands };
    }
    /**
     * Get help for a specific command as MCP resource
     */
    getCommandHelp(category, action) {
        const cat = this.categories.get(category);
        if (!cat) {
            return `Unknown category: ${category}`;
        }
        if (!action) {
            return cat.getHelp();
        }
        const actionDef = cat.actions.get(action);
        if (!actionDef) {
            return `Unknown action: ${action} in category ${category}`;
        }
        return [
            `# /${category} ${action}`,
            '',
            actionDef.description,
            '',
            `**Usage:** ${actionDef.usage}`,
            '',
            '**Examples:**',
            ...actionDef.examples.map(e => `- ${e}`)
        ].join('\n');
    }
}
/**
 * Create a command handler instance
 */
export function createCommandHandler(db, embeddingProvider) {
    return new ClaudeCommandHandler(db, embeddingProvider);
}
//# sourceMappingURL=commandHandler.js.map