/**
 * selfMessage - Send a message to yourself via terminal injection
 *
 * This tool allows  (or any subprocess) to inject a prompt into
 * the current  session. The message appears as user input and
 * triggers a  response.
 *
 * Use cases:
 * - Hooks can send notifications that  will respond to
 * - Subagents can request follow-up from the main 
 * - Background processes can push status updates
 *
 * IMPORTANT: This uses the STY environment variable to find the correct
 * screen session. Only works when running inside a screen session.
 */
import { logger } from '../../utils/logger.js';
import { selfMessage as sendSelfMessage, injectToCurrentSession, isInScreenSession, getCurrentScreenSession } from '../../utils/sessionInjector.js';
export class SelfMessage {
    name = 'self_message';
    description = `Send a message to yourself by injecting text into the current  session.

This allows you to:
- Send status updates that appear as user messages
- Request follow-up actions from your main  instance
- Communicate from background processes or hooks

IMPORTANT:
- Only works when running inside a GNU Screen session
- The message will appear as if the USER typed it
- If autoSubmit=true, the message will be submitted automatically

Use this sparingly - it's a powerful tool that can create conversation loops!

Example:
  message: "Status update: Task X completed successfully"
  autoSubmit: true

This will inject the message and submit it, causing  to respond.`;
    inputSchema = {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The message to inject as user input'
            },
            autoSubmit: {
                type: 'boolean',
                description: 'Whether to automatically press Enter after injection (default: true)',
                default: true
            },
            clearFirst: {
                type: 'boolean',
                description: 'Clear any existing input before injecting (default: true)',
                default: true
            }
        },
        required: ['message']
    };
    async execute(args) {
        const { message, autoSubmit = true, clearFirst = true } = args;
        // Check if we're in a screen session
        if (!isInScreenSession()) {
            logger.warn({}, 'self_message called but not in screen session');
            return {
                success: false,
                message: 'Not running in a screen session - self_message requires screen',
                warning: 'STY environment variable not set'
            };
        }
        const session = getCurrentScreenSession();
        try {
            let success;
            if (clearFirst && autoSubmit) {
                // Use the full selfMessage function which clears input first
                success = sendSelfMessage(message);
            }
            else {
                // Use direct injection
                success = injectToCurrentSession(message, autoSubmit);
            }
            if (success) {
                logger.info({
                    session,
                    messageLength: message.length,
                    autoSubmit
                }, 'Self-message sent successfully');
                return {
                    success: true,
                    message: autoSubmit
                        ? 'Message injected and submitted'
                        : 'Message injected (user must press Enter)',
                    session: session || undefined
                };
            }
            else {
                return {
                    success: false,
                    message: 'Failed to inject message into session'
                };
            }
        }
        catch (error) {
            logger.error({ error, session }, 'self_message failed');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
//# sourceMappingURL=selfMessage.js.map