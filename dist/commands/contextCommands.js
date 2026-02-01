/**
 * ContextCommands - conversation context management for 
 *
 * save and load conversation contexts fr
 * - /context save - save current conversation
 * - /context load <id> - load previous conversation
 * - /context list - list all saved contexts
 * - /context clear - clear current context
 *
 * this is how claude remembers what yall were talking about
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
/**
 * ContextCommands - manage conversation contexts
 *
 * save your convos and pick up where you left off
 */
export class ContextCommands {
    db;
    name = 'context';
    description = 'Save, load, and manage conversation contexts - pick up where you left off';
    actions = new Map();
    // in-memory current context (would be session-based in production)
    currentContext = [];
    currentContextId = null;
    currentContextName = null;
    constructor(db) {
        this.db = db;
        this.registerActions();
        this.ensureContextTable();
    }
    registerActions() {
        this.actions.set('save', {
            name: 'save',
            description: 'Save the current conversation context',
            usage: '/context save [name] [--summary "brief description"]',
            examples: [
                '/context save',
                '/context save "debugging session"',
                '/context save "api work" --summary "Working on authentication API"'
            ]
        });
        this.actions.set('load', {
            name: 'load',
            description: 'Load a previously saved conversation context',
            usage: '/context load <id|name>',
            examples: [
                '/context load abc-123',
                '/context load "debugging session"'
            ]
        });
        this.actions.set('list', {
            name: 'list',
            description: 'List all saved conversation contexts',
            usage: '/context list [--limit 20] [--search keyword]',
            examples: [
                '/context list',
                '/context list --limit 10',
                '/context list --search api'
            ]
        });
        this.actions.set('clear', {
            name: 'clear',
            description: 'Clear the current conversation context',
            usage: '/context clear [--confirm]',
            examples: [
                '/context clear',
                '/context clear --confirm'
            ]
        });
        this.actions.set('current', {
            name: 'current',
            description: 'Show information about the current context',
            usage: '/context current',
            examples: ['/context current']
        });
        this.actions.set('delete', {
            name: 'delete',
            description: 'Delete a saved context',
            usage: '/context delete <id>',
            examples: ['/context delete abc-123']
        });
        this.actions.set('add', {
            name: 'add',
            description: 'Add a message to the current context',
            usage: '/context add <role> <content>',
            examples: [
                '/context add user "What is the database schema?"',
                '/context add assistant "The schema has..."'
            ]
        });
        this.actions.set('help', {
            name: 'help',
            description: 'Show help for context commands',
            usage: '/context help',
            examples: ['/context help']
        });
    }
    /**
     * Ensure the contexts table exists
     */
    async ensureContextTable() {
        try {
            await this.db.query(`
        CREATE TABLE IF NOT EXISTS conversation_contexts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255),
          summary TEXT,
          messages JSONB NOT NULL DEFAULT '[]',
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_contexts_name ON conversation_contexts(name)
      `);
            await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_contexts_created ON conversation_contexts(created_at DESC)
      `);
            logger.debug('conversation_contexts table ensured');
        }
        catch (error) {
            logger.error({ error }, 'failed to create contexts table');
        }
    }
    async handleAction(action, args) {
        switch (action) {
            case 'save':
                return this.handleSave(args);
            case 'load':
                return this.handleLoad(args);
            case 'list':
                return this.handleList(args);
            case 'clear':
                return this.handleClear(args);
            case 'current':
                return this.handleCurrent();
            case 'delete':
                return this.handleDelete(args);
            case 'add':
                return this.handleAdd(args);
            case 'help':
                return { success: true, message: this.getHelp() };
            default:
                return {
                    success: false,
                    message: `Unknown action '${action}' - try /context help`,
                    suggestions: ['/context help', '/context save', '/context load']
                };
        }
    }
    /**
     * Handle /context save
     */
    async handleSave(args) {
        const parsed = this.parseArgs(args);
        if (this.currentContext.length === 0) {
            return {
                success: false,
                message: 'No context to save - start a conversation first or use /context add',
                suggestions: ['/context add user "Hello"']
            };
        }
        const name = parsed.content ?? `Context ${new Date().toISOString().slice(0, 10)}`;
        const summary = parsed.flags.get('summary') ?? this.generateSummary();
        try {
            // update existing or create new
            if (this.currentContextId) {
                await this.db.query(`UPDATE conversation_contexts
           SET name = $1, summary = $2, messages = $3, updated_at = NOW()
           WHERE id = $4`, [name, summary, JSON.stringify(this.currentContext), this.currentContextId]);
                return {
                    success: true,
                    message: `Context updated: ${name}`,
                    data: {
                        id: this.currentContextId,
                        name,
                        messageCount: this.currentContext.length
                    }
                };
            }
            // create new context
            const id = uuidv4();
            await this.db.query(`INSERT INTO conversation_contexts (id, name, summary, messages, metadata)
         VALUES ($1, $2, $3, $4, $5)`, [
                id,
                name,
                summary,
                JSON.stringify(this.currentContext),
                { source: 'command' }
            ]);
            this.currentContextId = id;
            this.currentContextName = name;
            return {
                success: true,
                message: `Context saved: ${name}`,
                data: {
                    id,
                    name,
                    messageCount: this.currentContext.length,
                    summary
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'context save failed');
            return {
                success: false,
                message: `Failed to save context: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /context load
     */
    async handleLoad(args) {
        const identifier = args.join(' ');
        if (!identifier) {
            return {
                success: false,
                message: 'No context ID or name provided',
                suggestions: ['/context list', '/context load "my context"']
            };
        }
        try {
            // try by ID first
            let result = await this.db.query(`SELECT * FROM conversation_contexts WHERE id = $1`, [identifier]);
            // try by name if not found
            if (result.rows.length === 0) {
                result = await this.db.query(`SELECT * FROM conversation_contexts WHERE name ILIKE $1 ORDER BY updated_at DESC LIMIT 1`, [`%${identifier}%`]);
            }
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Context not found: ${identifier}`,
                    suggestions: ['/context list']
                };
            }
            const context = result.rows[0];
            this.currentContext = context.messages;
            this.currentContextId = context.id;
            this.currentContextName = context.name;
            return {
                success: true,
                message: `Context loaded: ${context.name}`,
                data: {
                    id: context.id,
                    name: context.name,
                    summary: context.summary,
                    messageCount: context.messages.length,
                    createdAt: context.created_at,
                    updatedAt: context.updated_at
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'context load failed');
            return {
                success: false,
                message: `Failed to load context: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /context list
     */
    async handleList(args) {
        const parsed = this.parseArgs(args);
        const limit = parseInt(parsed.flags.get('limit') ?? '20', 10);
        const search = parsed.flags.get('search');
        try {
            let query = `
        SELECT id, name, summary, jsonb_array_length(messages) as message_count,
               created_at, updated_at
        FROM conversation_contexts
      `;
            const params = [];
            let paramIndex = 1;
            if (search) {
                query += ` WHERE name ILIKE $${paramIndex} OR summary ILIKE $${paramIndex}`;
                params.push(`%${search}%`);
                paramIndex++;
            }
            query += ` ORDER BY updated_at DESC LIMIT $${paramIndex}`;
            params.push(limit);
            const result = await this.db.query(query, params);
            return {
                success: true,
                message: `Found ${result.rows.length} saved contexts`,
                data: {
                    contexts: result.rows.map((row) => ({
                        id: row.id,
                        name: row.name,
                        summary: row.summary?.slice(0, 100),
                        messageCount: row.message_count,
                        createdAt: row.created_at,
                        updatedAt: row.updated_at,
                        isCurrent: row.id === this.currentContextId
                    }))
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'context list failed');
            return {
                success: false,
                message: `Failed to list contexts: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /context clear
     */
    async handleClear(args) {
        const parsed = this.parseArgs(args);
        if (this.currentContext.length > 0 && !parsed.flags.has('confirm')) {
            return {
                success: false,
                message: `Current context has ${this.currentContext.length} messages. Use --confirm to clear.`,
                suggestions: ['/context clear --confirm', '/context save "backup"']
            };
        }
        const messageCount = this.currentContext.length;
        this.currentContext = [];
        this.currentContextId = null;
        this.currentContextName = null;
        return {
            success: true,
            message: `Context cleared (${messageCount} messages removed)`,
            data: {
                clearedMessages: messageCount
            }
        };
    }
    /**
     * Handle /context current
     */
    handleCurrent() {
        if (this.currentContext.length === 0) {
            return {
                success: true,
                message: 'No active context',
                data: {
                    hasContext: false,
                    messageCount: 0
                }
            };
        }
        return {
            success: true,
            message: `Current context: ${this.currentContextName ?? 'unnamed'}`,
            data: {
                id: this.currentContextId,
                name: this.currentContextName,
                messageCount: this.currentContext.length,
                messages: this.currentContext.slice(-5).map(m => ({
                    role: m.role,
                    preview: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : ''),
                    timestamp: m.timestamp
                }))
            }
        };
    }
    /**
     * Handle /context delete
     */
    async handleDelete(args) {
        const id = args[0];
        if (!id) {
            return {
                success: false,
                message: 'No context ID provided',
                suggestions: ['/context list']
            };
        }
        try {
            const result = await this.db.query(`DELETE FROM conversation_contexts WHERE id = $1 RETURNING name`, [id]);
            if (result.rows.length === 0) {
                return {
                    success: false,
                    message: `Context not found: ${id}`
                };
            }
            // clear current if we deleted it
            if (this.currentContextId === id) {
                this.currentContext = [];
                this.currentContextId = null;
                this.currentContextName = null;
            }
            return {
                success: true,
                message: `Context deleted: ${result.rows[0].name}`,
                data: { deletedId: id }
            };
        }
        catch (error) {
            logger.error({ error }, 'context delete failed');
            return {
                success: false,
                message: `Failed to delete context: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }
    }
    /**
     * Handle /context add - add a message to current context
     */
    handleAdd(args) {
        if (args.length < 2) {
            return {
                success: false,
                message: 'Need role and content',
                suggestions: ['/context add user "Hello"']
            };
        }
        const role = args[0].toLowerCase();
        const content = args.slice(1).join(' ');
        if (role !== 'user' && role !== 'assistant') {
            return {
                success: false,
                message: 'Role must be "user" or "assistant"',
                suggestions: ['/context add user "Hello"']
            };
        }
        this.currentContext.push({
            role: role,
            content,
            timestamp: new Date()
        });
        return {
            success: true,
            message: `Added ${role} message to context`,
            data: {
                messageCount: this.currentContext.length,
                addedMessage: {
                    role,
                    preview: content.slice(0, 100)
                }
            }
        };
    }
    /**
     * Generate a summary of the current context
     */
    generateSummary() {
        if (this.currentContext.length === 0) {
            return 'Empty context';
        }
        const firstMessage = this.currentContext[0];
        const preview = firstMessage.content.slice(0, 100);
        return `${this.currentContext.length} messages - "${preview}${firstMessage.content.length > 100 ? '...' : ''}"`;
    }
    /**
     * Public method to add messages (for integration with chat handlers)
     */
    addMessage(role, content) {
        this.currentContext.push({
            role,
            content,
            timestamp: new Date()
        });
    }
    /**
     * Get current context messages
     */
    getContext() {
        return [...this.currentContext];
    }
    parseArgs(args) {
        const flags = new Map();
        const contentParts = [];
        let i = 0;
        while (i < args.length) {
            const arg = args[i];
            if (arg.startsWith('--')) {
                const flagName = arg.slice(2);
                const nextArg = args[i + 1];
                if (nextArg && !nextArg.startsWith('--')) {
                    flags.set(flagName, nextArg);
                    i += 2;
                }
                else {
                    flags.set(flagName, 'true');
                    i++;
                }
            }
            else {
                contentParts.push(arg);
                i++;
            }
        }
        return {
            content: contentParts.length > 0 ? contentParts.join(' ') : null,
            flags
        };
    }
    getHelp() {
        const lines = [
            '### Context Commands',
            ''
        ];
        for (const [name, action] of this.actions) {
            if (name === 'help')
                continue;
            lines.push(`- **/${this.name} ${name}** - ${action.description}`);
            lines.push(`  Usage: \`${action.usage}\``);
        }
        return lines.join('\n');
    }
}
//# sourceMappingURL=contextCommands.js.map