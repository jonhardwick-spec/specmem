/**
 * MCP Resources for Commands
 *
 * exposes command information as MCP resources
 * so claude can discover and learn about available commands
 */
/**
 * Get all commands as an MCP resource
 *
 * Returns a structured view of all available commands
 * that  can use to understand what's available
 */
export function getCommandsResource(handler) {
    const commandData = handler.getCommandsResource();
    const categories = [];
    // memory commands
    categories.push({
        name: 'memory',
        description: 'Store, search, and manage memories',
        commands: [
            {
                name: 'store',
                description: 'Store a new memory',
                usage: '/memory store <content> [--tags tag1,tag2] [--importance high]',
                examples: ['/memory store "API key is XYZ" --tags api,security']
            },
            {
                name: 'search',
                description: 'Semantic search through memories',
                usage: '/memory search <query> [--limit 10]',
                examples: ['/memory search "authentication flow"']
            },
            {
                name: 'recall',
                description: 'Get a specific memory by ID',
                usage: '/memory recall <id>',
                examples: ['/memory recall abc-123-def']
            },
            {
                name: 'delete',
                description: 'Delete a memory',
                usage: '/memory delete <id>',
                examples: ['/memory delete abc-123']
            },
            {
                name: 'stats',
                description: 'Show memory statistics',
                usage: '/memory stats',
                examples: ['/memory stats']
            }
        ]
    });
    // codebase commands
    categories.push({
        name: 'codebase',
        description: 'Index and search code repositories',
        commands: [
            {
                name: 'ingest',
                description: 'Index a codebase or directory',
                usage: '/codebase ingest <path> [--extensions ts,js]',
                examples: ['/codebase ingest ./src']
            },
            {
                name: 'search',
                description: 'Search indexed code semantically',
                usage: '/codebase search <query> [--file-type ts]',
                examples: ['/codebase search "database connection"']
            },
            {
                name: 'file',
                description: 'Get a specific indexed file',
                usage: '/codebase file <path>',
                examples: ['/codebase file src/index.ts']
            },
            {
                name: 'update',
                description: 'Refresh index for changed files',
                usage: '/codebase update [path]',
                examples: ['/codebase update']
            },
            {
                name: 'stats',
                description: 'Show codebase statistics',
                usage: '/codebase stats',
                examples: ['/codebase stats --by-extension']
            }
        ]
    });
    // context commands
    categories.push({
        name: 'context',
        description: 'Save and manage conversation contexts',
        commands: [
            {
                name: 'save',
                description: 'Save current conversation context',
                usage: '/context save [name]',
                examples: ['/context save "debugging session"']
            },
            {
                name: 'load',
                description: 'Load a saved context',
                usage: '/context load <id|name>',
                examples: ['/context load "debugging session"']
            },
            {
                name: 'list',
                description: 'List all saved contexts',
                usage: '/context list',
                examples: ['/context list --limit 10']
            },
            {
                name: 'clear',
                description: 'Clear current context',
                usage: '/context clear',
                examples: ['/context clear --confirm']
            }
        ]
    });
    // prompt commands
    categories.push({
        name: 'prompt',
        description: 'Save and manage reusable prompts',
        commands: [
            {
                name: 'save',
                description: 'Save a prompt to the library',
                usage: '/prompt save <name> <content> [--category type]',
                examples: ['/prompt save "code review" "Review this code..."']
            },
            {
                name: 'load',
                description: 'Load a saved prompt',
                usage: '/prompt load <name> [--vars key=value]',
                examples: ['/prompt load "code review"']
            },
            {
                name: 'list',
                description: 'List all saved prompts',
                usage: '/prompt list [--category name]',
                examples: ['/prompt list']
            },
            {
                name: 'search',
                description: 'Search prompts semantically',
                usage: '/prompt search <query>',
                examples: ['/prompt search "code analysis"']
            }
        ]
    });
    // team member commands
    categories.push({
        name: 'team-member',
        description: 'Deploy and manage multi-team-member swarms',
        commands: [
            {
                name: 'deploy',
                description: 'Deploy a multi-team-member team (overseer + workers + helpers)',
                usage: '/team-member deploy "<mission prompt>"',
                examples: [
                    '/team-member deploy "Fix WebSocket disconnect loop"',
                    '/team-member deploy "Optimize database queries and add caching"'
                ]
            },
            {
                name: 'list',
                description: 'List all active team members',
                usage: '/team-member list',
                examples: ['/team-member list']
            },
            {
                name: 'help',
                description: 'Show help for team member commands',
                usage: '/team-member help',
                examples: ['/team-member help']
            }
        ]
    });
    // docs commands (alias)
    categories.push({
        name: 'docs',
        description: 'Index and search documentation (alias for codebase)',
        commands: [
            {
                name: 'index',
                description: 'Index documentation files',
                usage: '/docs index <path>',
                examples: ['/docs index ./docs']
            },
            {
                name: 'search',
                description: 'Search documentation',
                usage: '/docs search <query>',
                examples: ['/docs search "authentication"']
            },
            {
                name: 'get',
                description: 'Get documentation on a topic',
                usage: '/docs get <topic>',
                examples: ['/docs get "getting started"']
            }
        ]
    });
    const contents = JSON.stringify({
        categories,
        totalCommands: categories.reduce((sum, cat) => sum + cat.commands.length, 0),
        version: '1.0.0',
        lastUpdated: new Date().toISOString()
    }, null, 2);
    return {
        uri: 'specmem://commands/list',
        name: 'Available Commands',
        description: 'List of all available slash commands for ',
        mimeType: 'application/json',
        contents
    };
}
/**
 * Get command help as an MCP resource
 *
 * Returns detailed help for a specific command or all commands
 */
export function getCommandHelpResource(handler, category, action) {
    let helpText;
    let uri;
    let name;
    let description;
    if (category && action) {
        // specific command help
        helpText = handler.getCommandHelp(category, action);
        uri = `specmem://commands/help/${category}/${action}`;
        name = `Help: /${category} ${action}`;
        description = `Detailed help for the /${category} ${action} command`;
    }
    else if (category) {
        // category help
        helpText = handler.getCommandHelp(category);
        uri = `specmem://commands/help/${category}`;
        name = `Help: /${category}`;
        description = `Help for all ${category} commands`;
    }
    else {
        // global help
        const result = handler.handleCommand('/help');
        // handleCommand is async but we need sync here - use cached help
        helpText = generateGlobalHelp();
        uri = 'specmem://commands/help';
        name = 'Command Help';
        description = 'Help for all available commands';
    }
    return {
        uri,
        name,
        description,
        mimeType: 'text/markdown',
        contents: helpText
    };
}
/**
 * Generate global help text
 */
function generateGlobalHelp() {
    return `#  Commands - SpecMem Command System

Use slash commands to interact with the memory system.

## Command Categories

### /memory - Memory Management
Store, search, and manage your persistent memories.
- \`/memory store <content>\` - Store a new memory
- \`/memory search <query>\` - Semantic search
- \`/memory recall <id>\` - Get specific memory
- \`/memory delete <id>\` - Delete memory
- \`/memory stats\` - Show statistics

### /codebase - Code Indexing
Index and search your codebase.
- \`/codebase ingest <path>\` - Index a directory
- \`/codebase search <query>\` - Search code
- \`/codebase file <path>\` - Get indexed file
- \`/codebase update\` - Refresh changed files
- \`/codebase stats\` - Show statistics

### /context - Context Management
Save and restore conversation contexts.
- \`/context save [name]\` - Save current context
- \`/context load <id>\` - Load saved context
- \`/context list\` - List all contexts
- \`/context clear\` - Clear current context

### /docs - Documentation
Index and search documentation (alias for codebase).
- \`/docs index <path>\` - Index documentation
- \`/docs search <query>\` - Search docs
- \`/docs get <topic>\` - Get documentation

### /prompt - Prompt Library
Save and manage reusable prompts.
- \`/prompt save <name> <content>\` - Save a prompt
- \`/prompt load <name>\` - Load a prompt
- \`/prompt list\` - List all prompts
- \`/prompt search <query>\` - Search prompts

### /team-member - Multi-Team-Member Swarms
Deploy and manage multi-team member teams.
- \`/team-member deploy "<mission>"\` - Deploy overseer + workers + helpers
- \`/team-member list\` - List all active team members
- \`/team-member help\` - Show team member command help

## Tips

- Use quotes for multi-word arguments: \`/memory store "This is content"\`
- Add flags with \`--flag value\`: \`/memory search "query" --limit 5\`
- Use \`/<category> help\` for detailed help on any category

---
SpecMem Command System v1.0.0
`;
}
/**
 * Generate MCP tool definition for command execution
 */
export function getCommandExecutorToolDefinition() {
    return {
        name: 'execute_command',
        description: 'Execute a SpecMem slash command. Use this to store memories, search code, manage contexts, and more.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The full slash command to execute (e.g., "/memory store Hello world")'
                }
            },
            required: ['command']
        }
    };
}
/**
 * Generate MCP resource templates for dynamic command help
 */
export function getResourceTemplates() {
    return [
        {
            uriTemplate: 'specmem://commands/list',
            name: 'Available Commands',
            description: 'List of all available slash commands',
            mimeType: 'application/json'
        },
        {
            uriTemplate: 'specmem://commands/help',
            name: 'Command Help',
            description: 'Global help for all commands',
            mimeType: 'text/markdown'
        },
        {
            uriTemplate: 'specmem://commands/help/{category}',
            name: 'Category Help',
            description: 'Help for a specific command category',
            mimeType: 'text/markdown'
        },
        {
            uriTemplate: 'specmem://commands/help/{category}/{action}',
            name: 'Command Help',
            description: 'Detailed help for a specific command',
            mimeType: 'text/markdown'
        }
    ];
}
//# sourceMappingURL=mcpResources.js.map