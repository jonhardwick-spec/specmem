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
    // last night - evening window
    if (lowered.includes('last night')) {
        const lastNight = new Date(now);
        lastNight.setDate(lastNight.getDate() - (now.getHours() < 6 ? 1 : 1));
        lastNight.setHours(18, 0, 0, 0);
        const endNight = new Date(lastNight);
        endNight.setHours(23, 59, 59, 999);
        // if its before 6am, "last night" means tonight's early hours
        if (now.getHours() < 6) {
            lastNight.setDate(lastNight.getDate());
            endNight.setDate(endNight.getDate() + 1);
            endNight.setHours(5, 59, 59, 999);
        }
        return { start: lastNight, end: endNight };
    }
    // earlier today - from midnight to now
    if (lowered.includes('earlier today') || lowered.includes('earlier this morning') || lowered.includes('this morning')) {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        return { start: startOfDay, end: now };
    }
    // the other day - colloquial ~2-4 days ago
    if (lowered.includes('the other day') || lowered.includes('other day')) {
        const start = new Date(now);
        start.setDate(start.getDate() - 4);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }
    // a while ago / a while back - ~2-4 weeks
    if (lowered.includes('a while ago') || lowered.includes('a while back') || lowered.includes('while back')) {
        const start = new Date(now);
        start.setDate(start.getDate() - 28);
        return { start, end: now };
    }
    // recently / recent - last 3 days
    if (/\brecently\b|\brecent\b/.test(lowered)) {
        const start = new Date(now);
        start.setDate(start.getDate() - 3);
        return { start, end: now };
    }
    // last <day of week> - e.g. "last friday", "last monday"
    const dayOfWeekMatch = lowered.match(/last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (dayOfWeekMatch) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = dayNames.indexOf(dayOfWeekMatch[1]);
        const currentDay = now.getDay();
        let daysBack = currentDay - targetDay;
        if (daysBack <= 0) daysBack += 7;
        // "last friday" when its currently monday means the friday before, not 3 days ago
        // if the target day is within the current week, go back a full week
        if (daysBack < 7 && lowered.startsWith('last')) daysBack += 0; // keep as-is for "last X"
        const target = new Date(now);
        target.setDate(target.getDate() - daysBack);
        target.setHours(0, 0, 0, 0);
        const endOfTarget = new Date(target);
        endOfTarget.setHours(23, 59, 59, 999);
        return { start: target, end: endOfTarget };
    }
    // on <day of week> - same as last <day> but without "last"
    const onDayMatch = lowered.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (onDayMatch) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = dayNames.indexOf(onDayMatch[1]);
        const currentDay = now.getDay();
        let daysBack = currentDay - targetDay;
        if (daysBack <= 0) daysBack += 7;
        const target = new Date(now);
        target.setDate(target.getDate() - daysBack);
        target.setHours(0, 0, 0, 0);
        const endOfTarget = new Date(target);
        endOfTarget.setHours(23, 59, 59, 999);
        return { start: target, end: endOfTarget };
    }
    // N days/hours/weeks ago - "3 days ago", "2 hours ago", "a week ago"
    const agoMatch = lowered.match(/(\d+|a|an)\s+(day|hour|minute|week|month)s?\s+ago/);
    if (agoMatch) {
        const amount = (agoMatch[1] === 'a' || agoMatch[1] === 'an') ? 1 : parseInt(agoMatch[1], 10);
        const unit = agoMatch[2];
        const start = new Date(now);
        const end = new Date(now);
        switch (unit) {
            case 'minute':
                start.setMinutes(start.getMinutes() - amount - 30);
                end.setMinutes(end.getMinutes() - amount + 30);
                break;
            case 'hour':
                start.setHours(start.getHours() - amount - 1);
                end.setHours(end.getHours() - amount + 1);
                break;
            case 'day':
                start.setDate(start.getDate() - amount);
                start.setHours(0, 0, 0, 0);
                end.setDate(end.getDate() - amount);
                end.setHours(23, 59, 59, 999);
                break;
            case 'week':
                start.setDate(start.getDate() - (amount * 7) - 3);
                end.setDate(end.getDate() - (amount * 7) + 3);
                break;
            case 'month':
                start.setMonth(start.getMonth() - amount);
                start.setDate(1);
                end.setMonth(end.getMonth() - amount + 1);
                end.setDate(0);
                break;
        }
        return { start, end };
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
    // couple days / few days - informal ranges
    if (/couple\s+(of\s+)?days/.test(lowered)) {
        const start = new Date(now);
        start.setDate(start.getDate() - 2);
        return { start, end: now };
    }
    if (/few\s+days/.test(lowered)) {
        const start = new Date(now);
        start.setDate(start.getDate() - 4);
        return { start, end: now };
    }
    if (/couple\s+(of\s+)?weeks/.test(lowered)) {
        const start = new Date(now);
        start.setDate(start.getDate() - 14);
        return { start, end: now };
    }
    // last year / this year
    if (lowered.includes('last year')) {
        const start = new Date(now.getFullYear() - 1, 0, 1);
        const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
        return { start, end };
    }
    if (lowered.includes('this year')) {
        const start = new Date(now.getFullYear(), 0, 1);
        return { start, end: now };
    }
    // N years ago
    const yearsAgoMatch = lowered.match(/(\d+|a|an)\s+years?\s+ago/);
    if (yearsAgoMatch) {
        const amount = (yearsAgoMatch[1] === 'a' || yearsAgoMatch[1] === 'an') ? 1 : parseInt(yearsAgoMatch[1], 10);
        const start = new Date(now.getFullYear() - amount, 0, 1);
        const end = new Date(now.getFullYear() - amount, 11, 31, 23, 59, 59, 999);
        return { start, end };
    }
    // specific month names - "in january", "in march", "back in february"
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthMatch = lowered.match(new RegExp(`(?:in|back in|from|during)\\s+(${monthNames.join('|')})`));
    if (monthMatch) {
        const monthIdx = monthNames.indexOf(monthMatch[1]);
        // if the month is in the future this year, assume last year
        let year = now.getFullYear();
        if (monthIdx > now.getMonth()) year -= 1;
        const start = new Date(year, monthIdx, 1);
        const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
        return { start, end };
    }
    // just month name alone in the query - "january auth bug"
    const bareMonthMatch = lowered.match(new RegExp(`\\b(${monthNames.join('|')})\\b`));
    if (bareMonthMatch) {
        const monthIdx = monthNames.indexOf(bareMonthMatch[1]);
        let year = now.getFullYear();
        if (monthIdx > now.getMonth()) year -= 1;
        const start = new Date(year, monthIdx, 1);
        const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
        return { start, end };
    }
    // short month names - "in jan", "feb", "dec"
    const shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const shortMonthMatch = lowered.match(new RegExp(`\\b(${shortMonths.join('|')})\\b`));
    if (shortMonthMatch) {
        const monthIdx = shortMonths.indexOf(shortMonthMatch[1]);
        let year = now.getFullYear();
        if (monthIdx > now.getMonth()) year -= 1;
        const start = new Date(year, monthIdx, 1);
        const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
        return { start, end };
    }
    // specific date patterns - "feb 5", "march 12", "january 1st"
    const datePattern = new RegExp(`(${monthNames.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?`);
    const specificDateMatch = lowered.match(datePattern);
    if (specificDateMatch) {
        const monthIdx = monthNames.indexOf(specificDateMatch[1]);
        const day = parseInt(specificDateMatch[2], 10);
        let year = now.getFullYear();
        const candidate = new Date(year, monthIdx, day);
        if (candidate > now) year -= 1;
        const start = new Date(year, monthIdx, day, 0, 0, 0, 0);
        const end = new Date(year, monthIdx, day, 23, 59, 59, 999);
        return { start, end };
    }
    // "2025", "2024" - bare year
    const bareYearMatch = lowered.match(/\b(20\d{2})\b/);
    if (bareYearMatch) {
        const year = parseInt(bareYearMatch[1], 10);
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31, 23, 59, 59, 999);
        return { start, end };
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