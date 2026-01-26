import { pino } from 'pino';
import { config } from '../config.js';
function serializeError(err) {
    if (err === null || err === undefined) {
        return { message: 'Unknown error (null/undefined)' };
    }
    if (err instanceof Error) {
        const extErr = err;
        return {
            message: err.message,
            name: err.name,
            stack: err.stack,
            ...(extErr.code !== undefined && { code: extErr.code }),
            ...(extErr.errno !== undefined && { errno: extErr.errno }),
            ...(extErr.syscall !== undefined && { syscall: extErr.syscall }),
            ...(extErr.detail !== undefined && { detail: extErr.detail }),
            ...(extErr.hint !== undefined && { hint: extErr.hint }),
            ...(extErr.constraint !== undefined && { constraint: extErr.constraint })
        };
    }
    if (typeof err === 'object') {
        const obj = err;
        if (Object.keys(obj).length === 0) {
            return { message: 'Empty error object', raw: String(err) };
        }
        return { ...obj, raw: String(err) };
    }
    return { message: String(err) };
}
const loggerOptions = {
    level: config.logging.level,
    transport: config.logging.prettyPrint
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    base: { service: 'specmem' },
    serializers: {
        err: serializeError,
        error: serializeError
    }
};
// CRITICAL: For MCP stdio protocol, ALL logs MUST go to stderr, not stdout!
// stdout is reserved exclusively for JSON-RPC messages between  and the MCP server
// Outputting logs to stdout will break the MCP protocol and cause "Failed to connect" errors
export const logger = pino(loggerOptions, pino.destination({ dest: 2 })); // 2 = stderr
export function createChildLogger(context) {
    return logger.child(context);
}
export { serializeError };
//# sourceMappingURL=logger.js.map