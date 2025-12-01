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
import { logger } from '../utils/logger.js';
/**
 * ANSI color codes for terminal output
 */
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
};
/**
 * CLI Notifier - sends notifications to Claude Code CLI via MCP protocol
 *
 * Primary method: MCP SDK's sendLoggingMessage
 * Fallback: stderr for banner-style output
 */
export class CLINotifier {
    server;
    defaultOptions;
    constructor(server, defaultOptions) {
        this.server = server;
        this.defaultOptions = {
            level: 'notice',
            loggerName: 'specmem',
            retryCount: 3,
            retryDelayMs: 1000,
            fallbackToStderr: true,
            ...defaultOptions,
        };
    }
    /**
     * Send a notification to Claude Code CLI
     *
     * Uses MCP's sendLoggingMessage with retry logic and stderr fallback
     */
    async notify(message, options) {
        const opts = { ...this.defaultOptions, ...options };
        return this.sendWithRetry(message, opts, 1);
    }
    /**
     * Send notification with retry logic and exponential backoff
     */
    async sendWithRetry(message, options, attempt) {
        const maxRetries = options.retryCount ?? 3;
        const delayMs = options.retryDelayMs ?? 1000;
        try {
            await this.server.sendLoggingMessage({
                level: (options.level ?? 'notice'),
                logger: options.loggerName ?? 'specmem',
                data: message,
            });
            logger.debug({ attempt }, 'CLI notification sent successfully');
            return true;
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (attempt < maxRetries) {
                const nextDelay = delayMs * Math.pow(2, attempt - 1);
                logger.debug({
                    attempt,
                    maxRetries,
                    nextDelay,
                    error: error.message,
                }, 'notification send failed, scheduling retry');
                await new Promise(resolve => setTimeout(resolve, nextDelay));
                return this.sendWithRetry(message, options, attempt + 1);
            }
            // All retries exhausted - try stderr fallback
            if (options.fallbackToStderr) {
                logger.debug('all retries exhausted, falling back to stderr');
                this.writeToStderr(message);
                return true;
            }
            logger.warn({
                attempts: maxRetries,
                error: error.message,
            }, 'could not send notification after all retries');
            return false;
        }
    }
    /**
     * Write message to stderr (fallback method)
     */
    writeToStderr(message) {
        process.stderr.write(message + '\n');
    }
    /**
     * Display a formatted banner in the terminal
     *
     * This writes directly to stderr for immediate visual feedback
     * in the Claude Code CLI terminal.
     */
    displayBanner(options) {
        const c = COLORS;
        const hooksCount = options.hooksCount ?? 0;
        const commandsCount = options.commandsCount ?? 0;
        const dashboardUrl = options.dashboardUrl;
        const skillsCount = options.skillsCount ?? 0;
        const toolsCount = options.toolsCount ?? 0;
        // Format status indicators
        const hooksStatus = hooksCount > 0
            ? `${c.green}${hooksCount} registered${c.reset}`
            : `${c.dim}already up-to-date${c.reset}`;
        const commandsStatus = commandsCount > 0
            ? `${c.green}${commandsCount} registered${c.reset}`
            : `${c.dim}already up-to-date${c.reset}`;
        const dashboardStatus = dashboardUrl
            ? `${c.magenta}${dashboardUrl}${c.reset}`
            : `${c.dim}disabled${c.reset}`;
        // Build the banner
        const banner = `
${c.yellow}+==================================================================+${c.reset}
${c.yellow}|${c.reset}  ${c.bright}${c.green}SpecMem Loaded${c.reset}                                               ${c.yellow}|${c.reset}
${c.yellow}+==================================================================+${c.reset}
${c.yellow}|${c.reset}  ${c.cyan}Hooks:${c.reset}     ${hooksStatus.padEnd(45)}${c.yellow}|${c.reset}
${c.yellow}|${c.reset}  ${c.cyan}Commands:${c.reset}  ${commandsStatus.padEnd(45)}${c.yellow}|${c.reset}
${c.yellow}|${c.reset}  ${c.cyan}Dashboard:${c.reset} ${dashboardStatus.padEnd(45)}${c.yellow}|${c.reset}
${c.yellow}+==================================================================+${c.reset}
${c.yellow}|${c.reset}  ${c.dim}Type /specmem for commands | /specmem-find to search memories${c.reset}   ${c.yellow}|${c.reset}
${c.yellow}+==================================================================+${c.reset}
`;
        // Write to stderr so it appears in Claude Code CLI terminal
        process.stderr.write(banner);
    }
}
/**
 * Create the startup announcement message for MCP logging
 */
function createStartupMessage(options) {
    const parts = ['SpecMem Loaded'];
    if (options.toolsCount) {
        parts.push(`${options.toolsCount} tools available`);
    }
    if (options.skillsCount) {
        parts.push(`${options.skillsCount} skills loaded`);
    }
    if (options.dashboardUrl) {
        parts.push(`Dashboard: ${options.dashboardUrl}`);
    }
    if (options.coordinationPort) {
        parts.push(`Coordination port: ${options.coordinationPort}`);
    }
    return parts.join(' | ');
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
export async function sendStartupNotification(server, options) {
    const notifier = new CLINotifier(server);
    // Send MCP logging message
    const message = createStartupMessage(options);
    await notifier.notify(message, { level: 'notice' });
    // Also display the visual banner in stderr
    notifier.displayBanner(options);
    logger.info('startup notification sent to Claude Code CLI');
}
/**
 * Get the appropriate dashboard URL based on host configuration
 *
 * @param host - The configured host (e.g., '127.0.0.1' or '0.0.0.0')
 * @param port - The dashboard port
 * @returns The dashboard URL with appropriate host
 */
export function getDashboardUrl(host, port) {
    // If binding to all interfaces (0.0.0.0), use localhost for display
    // because 0.0.0.0 isn't a valid URL to visit in a browser
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    return `http://${displayHost}:${port}`;
}
/**
 * Create a simple notification message
 */
export function createNotificationMessage(title, details) {
    let message = title;
    if (details) {
        const detailParts = Object.entries(details)
            .filter(([_, value]) => value !== null && value !== undefined)
            .map(([key, value]) => `${key}: ${value}`);
        if (detailParts.length > 0) {
            message += ' | ' + detailParts.join(' | ');
        }
    }
    return message;
}
/**
 * Create a formatted tool list for announcement
 *
 * Groups tools by category for better readability in the startup message.
 * This helps Claude (and users) understand what capabilities are available.
 */
export function formatToolList(tools, options) {
    const opts = {
        maxTools: 50,
        groupByPrefix: true,
        showDescriptions: true,
        ...options,
    };
    // If too many tools, show summary instead
    if (tools.length > opts.maxTools) {
        const categories = new Set(tools.map(t => t.name.split('_')[0]));
        return `${tools.length} tools in ${categories.size} categories: ${Array.from(categories).join(', ')}`;
    }
    // Group tools by prefix if enabled
    if (opts.groupByPrefix) {
        const groups = {};
        for (const tool of tools) {
            const prefix = tool.name.split('_')[0];
            if (!groups[prefix]) {
                groups[prefix] = [];
            }
            groups[prefix].push(tool);
        }
        const lines = [];
        for (const [prefix, groupTools] of Object.entries(groups)) {
            if (groupTools.length > 3) {
                // Show category summary for large groups
                lines.push(`  ${prefix}: ${groupTools.length} tools (${groupTools.map(t => t.name.replace(prefix + '_', '')).join(', ')})`);
            }
            else {
                // Show individual tools for small groups
                for (const t of groupTools) {
                    const desc = opts.showDescriptions && t.description
                        ? `: ${t.description.split('.')[0]}`
                        : '';
                    lines.push(`  - ${t.name}${desc}`);
                }
            }
        }
        return lines.join('\n');
    }
    // Simple list format
    return tools
        .map(t => {
        const desc = opts.showDescriptions && t.description
            ? `: ${t.description.split('.')[0]}`
            : '';
        return `  - ${t.name}${desc}`;
    })
        .join('\n');
}
/**
 * Create a tool discovery hint message
 *
 * Helps Claude understand how to discover and use tools.
 */
export function createToolDiscoveryHint(toolCount) {
    return `SpecMem provides ${toolCount} tools for memory, codebase, and team operations.

Key tools:
- save_memory: Store important information for future recall
- find_memory: Search memories semantically
- ingestThisWholeAssMfCodebase: Index your codebase for AI-assisted development
- smartSearch: Interactive search mode selector

Use tools/list to see all available tools with descriptions.`;
}
//# sourceMappingURL=cliNotifications.js.map