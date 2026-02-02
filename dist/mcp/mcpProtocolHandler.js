/**
 * MCP Protocol Handler - the traffic cop for tool calls
 *
 * handles parsing, validation, and routing of MCP messages
 * makes sure everything flows smooth like butter fr fr
 *
 * Now integrated with LWJEB event bus for tool:execution events
 */
import { logger } from '../utils/logger.js';
import { getCoordinator } from '../coordination/integration.js';
// import zod schemas for validation
import { StoreMemoryInput, SearchMemoryInput, RecallMemoryInput, ConsolidateMemoryInput, UpdateMemoryInput, DeleteMemoryInput, LinkMemoriesInput, GetStatsInput } from '../types/index.js';
/**
 * maps our goofy tool names to their input schemas
 * validation hits different when you know whats coming
 */
const TOOL_SCHEMAS = {
    'save_memory': StoreMemoryInput,
    'find_memory': SearchMemoryInput,
    'get_memory': RecallMemoryInput,
    'remove_memory': DeleteMemoryInput,
    'smush_memories_together': ConsolidateMemoryInput,
    'link_the_vibes': LinkMemoriesInput,
    'show_me_the_stats': GetStatsInput,
    'update_this_memory': UpdateMemoryInput
};
/**
 * natural language time parser - doobidoo showed us the way
 *
 * supports stuff like "yesterday", "last week", "this month"
 * makes searching by time way more natural fr
 */
export function parseTimeExpression(expression) {
    const now = new Date();
    const lowered = expression.toLowerCase().trim();
    // yesterday - the classic
    if (lowered.includes('yesterday')) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const endOfYesterday = new Date(yesterday);
        endOfYesterday.setHours(23, 59, 59, 999);
        return { start: yesterday, end: endOfYesterday };
    }
    // last week - for when you need context
    if (lowered.includes('last week')) {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { start: weekAgo, end: now };
    }
    // this week - current week vibes
    if (lowered.includes('this week')) {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        return { start: startOfWeek, end: now };
    }
    // last month - longer context window
    if (lowered.includes('last month')) {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return { start: monthAgo, end: now };
    }
    // this month - current month stuff
    if (lowered.includes('this month')) {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: startOfMonth, end: now };
    }
    // today - just today fam
    if (lowered.includes('today')) {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        return { start: startOfDay, end: now };
    }
    // last N days/hours/minutes pattern
    const lastNMatch = lowered.match(/last\s+(\d+)\s+(day|hour|minute|week|month)s?/);
    if (lastNMatch) {
        const amount = parseInt(lastNMatch[1], 10);
        const unit = lastNMatch[2];
        const start = new Date(now);
        switch (unit) {
            case 'minute':
                start.setMinutes(start.getMinutes() - amount);
                break;
            case 'hour':
                start.setHours(start.getHours() - amount);
                break;
            case 'day':
                start.setDate(start.getDate() - amount);
                break;
            case 'week':
                start.setDate(start.getDate() - (amount * 7));
                break;
            case 'month':
                start.setMonth(start.getMonth() - amount);
                break;
        }
        return { start, end: now };
    }
    // cant parse it - return null and let the caller handle it
    return null;
}
/**
 * auto-splits long content into chunks - doobidoo feature we copied
 *
 * handles unlimited length content by splitting at natural boundaries
 * preserves context with overlap between chunks
 */
export function splitContent(content, maxLength = 800, overlap = 50) {
    // if its short enough just return it
    if (content.length <= maxLength) {
        return [content];
    }
    const chunks = [];
    let position = 0;
    while (position < content.length) {
        let endPosition = Math.min(position + maxLength, content.length);
        // try to split at natural boundaries
        if (endPosition < content.length) {
            // look for paragraph break first
            const paragraphBreak = content.lastIndexOf('\n\n', endPosition);
            if (paragraphBreak > position + maxLength / 2) {
                endPosition = paragraphBreak + 2;
            }
            else {
                // look for sentence break
                const sentenceBreak = content.substring(position, endPosition).lastIndexOf('. ');
                if (sentenceBreak > maxLength / 2) {
                    endPosition = position + sentenceBreak + 2;
                }
                else {
                    // look for word break
                    const wordBreak = content.lastIndexOf(' ', endPosition);
                    if (wordBreak > position + maxLength / 2) {
                        endPosition = wordBreak + 1;
                    }
                }
            }
        }
        chunks.push(content.substring(position, endPosition).trim());
        // move position with overlap for context preservation
        position = endPosition - overlap;
        if (position >= content.length - overlap)
            break;
    }
    return chunks.filter(chunk => chunk.length > 0);
}
/**
 * MCP Protocol Handler
 *
 * handles the nitty gritty of MCP message parsing and routing
 * makes sure tools get the right params and errors are handled nice
 */
export class MCPProtocolHandler {
    toolRegistry;
    callCount = 0;
    errorCount = 0;
    coordinator = getCoordinator();
    constructor(toolRegistry) {
        this.toolRegistry = toolRegistry;
    }
    /**
     * handle a tool call - the main event
     * Now emits LWJEB events for tool:execution:start and tool:execution:complete
     */
    async handleToolCall(toolName, args) {
        this.callCount++;
        const startTime = Date.now();
        // Emit tool execution start event via LWJEB
        this.coordinator.emitToolStart(toolName, args);
        try {
            // validate inputs if we have a schema
            const schema = TOOL_SCHEMAS[toolName];
            let validatedArgs = args;
            if (schema) {
                const result = schema.safeParse(args);
                if (!result.success) {
                    throw new Error(`validation failed fr: ${result.error.message}`);
                }
                validatedArgs = result.data;
            }
            // check for time expressions in search queries
            if (toolName === 'find_memory' && typeof validatedArgs === 'object' && validatedArgs !== null && 'query' in validatedArgs) {
                const query = validatedArgs.query;
                const timeRange = parseTimeExpression(query);
                if (timeRange && !('dateRange' in validatedArgs)) {
                    validatedArgs.dateRange = {
                        start: timeRange.start.toISOString(),
                        end: timeRange.end.toISOString()
                    };
                }
            }
            // execute the tool
            const result = await this.toolRegistry.executeTool(toolName, validatedArgs);
            const duration = Date.now() - startTime;
            logger.debug({ toolName, duration, callCount: this.callCount }, 'tool call handled');
            // Emit tool execution complete event via LWJEB
            this.coordinator.emitToolComplete(toolName, validatedArgs, result, duration, true);
            return result;
        }
        catch (error) {
            this.errorCount++;
            const duration = Date.now() - startTime;
            // Emit tool execution complete event with error via LWJEB
            this.coordinator.emitToolComplete(toolName, args, null, duration, false, error instanceof Error ? error : new Error(String(error)));
            logger.error({ toolName, error, callCount: this.callCount }, 'tool call failed');
            throw error;
        }
    }
    /**
     * batch handle multiple tool calls - for efficiency
     */
    async handleBatchToolCalls(calls) {
        const results = [];
        // process in parallel for speed
        const promises = calls.map(async (call) => {
            try {
                const result = await this.handleToolCall(call.name, call.args);
                return { name: call.name, result };
            }
            catch (error) {
                return {
                    name: call.name,
                    error: error instanceof Error ? error.message : 'unknown error'
                };
            }
        });
        const settled = await Promise.allSettled(promises);
        for (const result of settled) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            }
            else {
                results.push({
                    name: 'unknown',
                    error: result.reason instanceof Error ? result.reason.message : 'promise rejected'
                });
            }
        }
        return results;
    }
    /**
     * get handler stats
     */
    getStats() {
        return {
            callCount: this.callCount,
            errorCount: this.errorCount,
            successRate: this.callCount > 0 ? (this.callCount - this.errorCount) / this.callCount : 1
        };
    }
}
//# sourceMappingURL=mcpProtocolHandler.js.map