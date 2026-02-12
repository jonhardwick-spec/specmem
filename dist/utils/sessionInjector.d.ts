/**
 * Session Injector - Inject text into the current  screen session
 *
 * Uses the STY environment variable to reliably identify the current screen session.
 * Supports text injection + Enter key submission.
 *
 * This WORKS because:
 * - STY env var is set by screen and inherited by all child processes
 * - screen -X stuff injects into the terminal input buffer
 * - $'\r' sends actual carriage return which triggers Enter in ink UI
 */
/**
 * Get the current screen session name from STY environment variable
 * Returns null if not running inside a screen session
 */
export declare function getCurrentScreenSession(): string | null;
/**
 * Inject text into the current  session's terminal input
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
export declare function injectToCurrentSession(text: string, pressEnter?: boolean): boolean;
/**
 * Inject text into a specific screen session
 *
 * @param sessionName - Screen session name (e.g., "4184682.pts-7.srv815833")
 * @param text - Text to inject
 * @param pressEnter - Whether to send Enter key after text
 * @returns true if injection succeeded
 */
export declare function injectToSession(sessionName: string, text: string, pressEnter?: boolean): boolean;
/**
 * Send a special key to the current session
 *
 * @param key - Special key name
 * @returns true if sent successfully
 */
export declare function sendSpecialKey(key: 'enter' | 'tab' | 'escape' | 'backspace' | 'ctrl-c' | 'ctrl-d'): boolean;
/**
 * Self-message: inject a message as user input and submit it
 * This allows a  subprocess to "send itself" a message
 *
 * @param message - Message to inject as user input
 * @returns true if injection and submission succeeded
 */
export declare function selfMessage(message: string): boolean;
/**
 * Check if we're running inside a screen session
 */
export declare function isInScreenSession(): boolean;
/**
 * Get info about all available screen sessions
 */
export declare function listScreenSessions(): Array<{
    name: string;
    pid: number;
    attached: boolean;
}>;
//# sourceMappingURL=sessionInjector.d.ts.map