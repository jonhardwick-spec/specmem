/**
 * MCP Protocol Handler - the traffic cop for tool calls
 *
 * handles parsing, validation, and routing of MCP messages
 * makes sure everything flows smooth like butter fr fr
 *
 * Now integrated with LWJEB event bus for tool:execution events
 */
import { ToolRegistry } from './toolRegistry.js';
/**
 * natural language time parser - doobidoo showed us the way
 *
 * supports stuff like "yesterday", "last week", "this month"
 * makes searching by time way more natural fr
 */
export declare function parseTimeExpression(expression: string): {
    start: Date;
    end: Date;
} | null;
/**
 * auto-splits long content into chunks - doobidoo feature we copied
 *
 * handles unlimited length content by splitting at natural boundaries
 * preserves context with overlap between chunks
 */
export declare function splitContent(content: string, maxLength?: number, overlap?: number): string[];
/**
 * MCP Protocol Handler
 *
 * handles the nitty gritty of MCP message parsing and routing
 * makes sure tools get the right params and errors are handled nice
 */
export declare class MCPProtocolHandler {
    private toolRegistry;
    private callCount;
    private errorCount;
    private coordinator;
    constructor(toolRegistry: ToolRegistry);
    /**
     * handle a tool call - the main event
     * Now emits LWJEB events for tool:execution:start and tool:execution:complete
     */
    handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown>;
    /**
     * batch handle multiple tool calls - for efficiency
     */
    handleBatchToolCalls(calls: Array<{
        name: string;
        args: Record<string, unknown>;
    }>): Promise<Array<{
        name: string;
        result?: unknown;
        error?: string;
    }>>;
    /**
     * get handler stats
     */
    getStats(): {
        callCount: number;
        errorCount: number;
        successRate: number;
    };
}
//# sourceMappingURL=mcpProtocolHandler.d.ts.map