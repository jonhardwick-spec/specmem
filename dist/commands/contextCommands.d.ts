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
import { CommandCategory, CommandAction, CommandResult } from './commandHandler.js';
import { DatabaseManager } from '../database.js';
interface ContextMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}
/**
 * ContextCommands - manage conversation contexts
 *
 * save your convos and pick up where you left off
 */
export declare class ContextCommands implements CommandCategory {
    private db;
    name: string;
    description: string;
    actions: Map<string, CommandAction>;
    private currentContext;
    private currentContextId;
    private currentContextName;
    constructor(db: DatabaseManager);
    private registerActions;
    /**
     * Ensure the contexts table exists
     */
    private ensureContextTable;
    handleAction(action: string, args: string[]): Promise<CommandResult>;
    /**
     * Handle /context save
     */
    private handleSave;
    /**
     * Handle /context load
     */
    private handleLoad;
    /**
     * Handle /context list
     */
    private handleList;
    /**
     * Handle /context clear
     */
    private handleClear;
    /**
     * Handle /context current
     */
    private handleCurrent;
    /**
     * Handle /context delete
     */
    private handleDelete;
    /**
     * Handle /context add - add a message to current context
     */
    private handleAdd;
    /**
     * Generate a summary of the current context
     */
    private generateSummary;
    /**
     * Public method to add messages (for integration with chat handlers)
     */
    addMessage(role: 'user' | 'assistant', content: string): void;
    /**
     * Get current context messages
     */
    getContext(): ContextMessage[];
    private parseArgs;
    getHelp(): string;
}
export {};
//# sourceMappingURL=contextCommands.d.ts.map