/**
 * CLI Notifications - MCP to Claude Code CLI notification system
 *
 * This module provides a centralized way to send notifications from the MCP server
 * to the Claude Code CLI. It uses the MCP SDK's sendLoggingMessage API as the primary
 * method, with stderr fallback for banner display.
 *
 * Usage:
 *   import { CLINotifier, sendStartupNotification } from './cliNotifications.js';
 *
 *   // Quick startup notification
 *   sendStartupNotification(server, { dashboardUrl: 'http://localhost:8595' });
 *
 *   // Or use the full notifier for custom messages
 *   const notifier = new CLINotifier(server);
 *   await notifier.notify('Custom message here');
 *
 * @module cliNotifications
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
/**
 * Notification priority levels
 */
export type NotificationLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical';
/**
 * Options for sending notifications
 */
export interface NotificationOptions {
    level?: NotificationLevel;
    loggerName?: string;
    retryCount?: number;
    retryDelayMs?: number;
    fallbackToStderr?: boolean;
}
/**
 * Startup notification options
 */
export interface StartupNotificationOptions {
    dashboardUrl?: string | null;
    dashboardHost?: string;
    coordinationPort?: number | null;
    hooksCount?: number;
    commandsCount?: number;
    skillsCount?: number;
    toolsCount?: number;
}
/**
 * CLI Notifier - sends notifications to Claude Code CLI via MCP protocol
 *
 * Primary method: MCP SDK's sendLoggingMessage
 * Fallback: stderr for banner-style output
 */
export declare class CLINotifier {
    private server;
    private defaultOptions;
    constructor(server: Server, defaultOptions?: NotificationOptions);
    /**
     * Send a notification to Claude Code CLI
     *
     * Uses MCP's sendLoggingMessage with retry logic and stderr fallback
     */
    notify(message: string, options?: NotificationOptions): Promise<boolean>;
    /**
     * Send notification with retry logic and exponential backoff
     */
    private sendWithRetry;
    /**
     * Write message to stderr (fallback method)
     */
    private writeToStderr;
    /**
     * Display a formatted banner in the terminal
     *
     * This writes directly to stderr for immediate visual feedback
     * in the Claude Code CLI terminal.
     */
    displayBanner(options: StartupNotificationOptions): void;
}
/**
 * Send startup notification to Claude Code CLI
 *
 * This is the main entry point for sending the "SpecMem Loaded" message
 * when the MCP server starts up. It:
 * 1. Sends MCP logging message (appears in Claude's logs)
 * 2. Displays a banner in stderr (appears in terminal)
 *
 * @param server - The MCP Server instance
 * @param options - Startup notification options
 */
export declare function sendStartupNotification(server: Server, options: StartupNotificationOptions): Promise<void>;
/**
 * Get the appropriate dashboard URL based on host configuration
 *
 * @param host - The configured host (e.g., '127.0.0.1' or '0.0.0.0')
 * @param port - The dashboard port
 * @returns The dashboard URL with appropriate host
 */
export declare function getDashboardUrl(host: string, port: number): string;
/**
 * Create a simple notification message
 */
export declare function createNotificationMessage(title: string, details?: Record<string, string | number | boolean | null>): string;
/**
 * Tool categories for organized display
 */
export interface ToolCategory {
    name: string;
    tools: Array<{
        name: string;
        description: string;
    }>;
}
/**
 * Create a formatted tool list for announcement
 *
 * Groups tools by category for better readability in the startup message.
 * This helps Claude (and users) understand what capabilities are available.
 */
export declare function formatToolList(tools: Array<{
    name: string;
    description?: string;
}>, options?: {
    maxTools?: number;
    groupByPrefix?: boolean;
    showDescriptions?: boolean;
}): string;
/**
 * Create a tool discovery hint message
 *
 * Helps Claude understand how to discover and use tools.
 */
export declare function createToolDiscoveryHint(toolCount: number): string;
//# sourceMappingURL=cliNotifications.d.ts.map