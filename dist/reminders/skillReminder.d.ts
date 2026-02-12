/**
 * skillReminder.ts - Auto-Reminder System for  Skills
 *
 * yo this system makes it IMPOSSIBLE for  to forget skills fr fr
 * provides constant context about available skills through MCP prompts
 *
 * Features:
 * - Auto-generates skill reminders on startup
 * - Creates MCP prompts for skill awareness
 * - Periodic skill refresh notifications
 * - Category-based skill summaries
 * - Integration with skill scanner for live updates
 */
import { SkillScanner } from '../skills/skillScanner.js';
import { CodebaseIndexer } from '../codebase/codebaseIndexer.js';
/**
 * SkillReminderConfig - configuration options
 */
export interface SkillReminderConfig {
    enabled: boolean;
    includeFullSkillContent: boolean;
    maxSkillsInPrompt: number;
    includeCodebaseOverview: boolean;
    refreshIntervalMinutes: number;
}
/**
 * MCPPrompt - represents an MCP prompt
 */
export interface MCPPrompt {
    name: string;
    description: string;
    arguments?: Array<{
        name: string;
        description: string;
        required: boolean;
    }>;
}
/**
 * PromptMessage - message content for a prompt
 */
export interface PromptMessage {
    role: 'user' | 'assistant';
    content: {
        type: 'text';
        text: string;
    };
}
/**
 * SkillReminder - the brain's memory system for skills
 *
 * ensures  ALWAYS knows what skills are available
 * like having sticky notes everywhere fr fr
 */
export declare class SkillReminder {
    private config;
    private scanner;
    private resourceProvider;
    private codebaseIndexer;
    private lastRefresh;
    private refreshTimer;
    constructor(config?: Partial<SkillReminderConfig>, scanner?: SkillScanner, codebaseIndexer?: CodebaseIndexer);
    /**
     * initialize - starts the reminder system
     */
    initialize(): Promise<void>;
    /**
     * refreshReminders - refreshes the skill reminders
     */
    private refreshReminders;
    /**
     * getPrompts - returns all MCP prompts for skill awareness
     */
    getPrompts(): MCPPrompt[];
    /**
     * getPromptMessages - returns messages for a specific prompt
     */
    getPromptMessages(promptName: string, args?: Record<string, string>): PromptMessage[];
    /**
     * getSkillAwarenessMessages - complete skill overview
     */
    private getSkillAwarenessMessages;
    /**
     * getQuickSkillsMessages - compact skill reference
     */
    private getQuickSkillsMessages;
    /**
     * getSkillsByCategoryMessages - skills for a specific category
     */
    private getSkillsByCategoryMessages;
    /**
     * getSkillDetailMessages - single skill details
     */
    private getSkillDetailMessages;
    /**
     * getCodebaseContextMessages - codebase overview
     */
    private getCodebaseContextMessages;
    /**
     * getFullContextMessages - complete context
     */
    private getFullContextMessages;
    /**
     * getStartupReminder - returns reminder content for startup
     */
    getStartupReminder(): string;
    /**
     * getSystemPromptAddition - returns text to add to system prompt
     */
    getSystemPromptAddition(): string;
    /**
     * capitalize - capitalizes first letter
     */
    private capitalize;
    /**
     * setCodebaseIndexer - sets the codebase indexer reference
     */
    setCodebaseIndexer(indexer: CodebaseIndexer): void;
    /**
     * shutdown - cleanup resources
     */
    shutdown(): Promise<void>;
}
/**
 * getSkillReminder - returns singleton reminder instance
 */
export declare function getSkillReminder(config?: Partial<SkillReminderConfig>, scanner?: SkillScanner, codebaseIndexer?: CodebaseIndexer): SkillReminder;
/**
 * resetSkillReminder - resets the singleton (for testing)
 */
export declare function resetSkillReminder(): void;
//# sourceMappingURL=skillReminder.d.ts.map