import { pino, Logger } from 'pino';
declare function serializeError(err: unknown): Record<string, unknown>;
export declare const logger: Logger;
export declare function createChildLogger(context: Record<string, unknown>): pino.Logger<never>;
export { serializeError };
//# sourceMappingURL=logger.d.ts.map