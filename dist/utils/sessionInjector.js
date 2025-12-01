/**
 * Session Injector - Inject text into the current Claude screen session
 *
 * Uses the STY environment variable to reliably identify the current screen session.
 * Supports text injection + Enter key submission.
 *
 * This WORKS because:
 * - STY env var is set by screen and inherited by all child processes
 * - screen -X stuff injects into the terminal input buffer
 * - $'\r' sends actual carriage return which triggers Enter in ink UI
 */
import { execSync } from 'child_process';
import { logger } from './logger.js';
/**
 * Get the current screen session name from STY environment variable
 * Returns null if not running inside a screen session
 */
export function getCurrentScreenSession() {
    const sty = process.env.STY;
    if (!sty) {
        logger.debug({ env: 'STY' }, 'Not running in screen session');
        return null;
    }
    return sty;
}
/**
 * Inject text into the current Claude session's terminal input
 *
 * @param text - Text to inject
 * @param pressEnter - Whether to send Enter key after text (default: false)
 * @returns true if injection succeeded
 *
 * @example
 * // Type text without submitting
 * injectToCurrentSession("Hello world");
 *
 * // Type text and submit
 * injectToCurrentSession("Hello world", true);
 */
export function injectToCurrentSession(text, pressEnter = false) {
    const session = getCurrentScreenSession();
    if (!session) {
        logger.warn({}, 'Cannot inject - not running in screen session');
        return false;
    }
    return injectToSession(session, text, pressEnter);
}
/**
 * Inject text into a specific screen session
 *
 * @param sessionName - Screen session name (e.g., "4184682.pts-7.srv815833")
 * @param text - Text to inject
 * @param pressEnter - Whether to send Enter key after text
 * @returns true if injection succeeded
 */
export function injectToSession(sessionName, text, pressEnter = false) {
    try {
        // Escape special characters for screen stuff command
        // Note: screen -X stuff uses different escaping than shell
        const escapedText = text
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');
        // Send the text
        execSync(`screen -S "${sessionName}" -p 0 -X stuff "${escapedText}"`, {
            encoding: 'utf-8',
            timeout: 5000
        });
        // Send Enter key if requested
        // CRITICAL: Use $'\r' syntax for actual carriage return byte
        if (pressEnter) {
            // Small delay to ensure text is in buffer
            execSync('sleep 0.05');
            execSync(`screen -S "${sessionName}" -p 0 -X stuff $'\\r'`, {
                encoding: 'utf-8',
                timeout: 5000
            });
        }
        logger.info({
            session: sessionName,
            textLength: text.length,
            pressEnter
        }, 'Injected text to screen session');
        return true;
    }
    catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : 'Unknown error',
            session: sessionName
        }, 'Failed to inject to screen session');
        return false;
    }
}
/**
 * Send a special key to the current session
 *
 * @param key - Special key name
 * @returns true if sent successfully
 */
export function sendSpecialKey(key) {
    const session = getCurrentScreenSession();
    if (!session)
        return false;
    const keyMap = {
        'enter': '\\r',
        'tab': '\\t',
        'escape': '\\e',
        'backspace': '\\b',
        'ctrl-c': '\\x03',
        'ctrl-d': '\\x04',
    };
    const sequence = keyMap[key];
    if (!sequence) {
        logger.warn({ key }, 'Unknown special key');
        return false;
    }
    try {
        execSync(`screen -S "${session}" -p 0 -X stuff $'${sequence}'`, {
            encoding: 'utf-8',
            timeout: 5000
        });
        return true;
    }
    catch (error) {
        logger.error({ error, key, session }, 'Failed to send special key');
        return false;
    }
}
/**
 * Self-message: inject a message as user input and submit it
 * This allows a Claude subprocess to "send itself" a message
 *
 * @param message - Message to inject as user input
 * @returns true if injection and submission succeeded
 */
export function selfMessage(message) {
    // Clear any existing input first (Ctrl+U clears line in most terminals)
    const session = getCurrentScreenSession();
    if (!session)
        return false;
    try {
        // Send Ctrl+U to clear input line
        execSync(`screen -S "${session}" -p 0 -X stuff $'\\x15'`, {
            encoding: 'utf-8',
            timeout: 5000
        });
        // Small delay
        execSync('sleep 0.05');
        // Now inject the message and submit
        return injectToCurrentSession(message, true);
    }
    catch (error) {
        logger.error({ error }, 'Failed to self-message');
        return false;
    }
}
/**
 * Check if we're running inside a screen session
 */
export function isInScreenSession() {
    return !!process.env.STY;
}
/**
 * Get info about all available screen sessions
 */
export function listScreenSessions() {
    try {
        const output = execSync('screen -ls 2>&1', { encoding: 'utf-8' });
        const sessions = [];
        const lines = output.split('\n');
        for (const line of lines) {
            // Match: "4184682.pts-7.srv815833	(01/03/26 18:03:05)	(Attached)"
            const match = line.match(/(\d+)\.([^\s]+)\s+.*\((Attached|Detached)\)/i);
            if (match) {
                sessions.push({
                    name: `${match[1]}.${match[2]}`,
                    pid: parseInt(match[1], 10),
                    attached: match[3].toLowerCase() === 'attached'
                });
            }
        }
        return sessions;
    }
    catch (error) {
        return [];
    }
}
//# sourceMappingURL=sessionInjector.js.map