/**
 * SPECMEM DRILLDOWN HOOK
 * ======================
 *
 * Interactive drilldown hook that lets users control:
 *   - Search depth (how many memories)
 *   - Memory relevance filtering
 *   - Web research triggering
 *
 * This is the USER CONTROL layer - every drilldown decision
 * goes through the user via Claude's AskUserQuestion tool.
 *
 * Flow:
 *   1. Initial search returns memories
 *   2. User decides: enough context? drill deeper?
 *   3. If drill: user picks depth (20/50/100 memories)
 *   4. User filters: which memories are relevant?
 *   5. User decides: need web research?
 *   6. Final curated context delivered
 */
import { searchRelatedMemories, formatContextInjection } from './contextInjectionHook.js';
import { logger } from '../utils/logger.js';
// Drilldown depth levels
export const DRILLDOWN_DEPTHS = {
    light: { limit: 10, threshold: 0.4, ram: '50MB' },
    standard: { limit: 20, threshold: 0.3, ram: '100MB' },
    deep: { limit: 50, threshold: 0.2, ram: '150MB' },
    exhaustive: { limit: 100, threshold: 0.1, ram: '150MB' }
};
// In-memory state store (per-session)
const drilldownStates = new Map();
/**
 * Start a new drilldown session
 */
export async function startDrilldown(sessionId, query, depth = 'standard') {
    const depthConfig = DRILLDOWN_DEPTHS[depth];
    logger.info({ sessionId, query, depth }, '[Drilldown] Starting new session');
    // Search with configured depth
    const memories = await searchRelatedMemories(query, {
        searchLimit: depthConfig.limit,
        threshold: depthConfig.threshold
    });
    const state = {
        query,
        depth,
        allMemories: memories,
        selectedMemories: memories, // Initially all selected
        webResearchDone: false
    };
    drilldownStates.set(sessionId, state);
    logger.info({
        sessionId,
        memoriesFound: memories.length,
        topSimilarity: memories[0]?.similarity
    }, '[Drilldown] Initial search complete');
    return state;
}
/**
 * Change drilldown depth (triggers new search)
 */
export async function changeDrilldownDepth(sessionId, newDepth) {
    const state = drilldownStates.get(sessionId);
    if (!state)
        return null;
    return startDrilldown(sessionId, state.query, newDepth);
}
/**
 * Filter memories in current session
 */
export function filterMemories(sessionId, selectedIds) {
    const state = drilldownStates.get(sessionId);
    if (!state)
        return null;
    state.selectedMemories = state.allMemories.filter(m => selectedIds.includes(m.id));
    logger.info({
        sessionId,
        totalMemories: state.allMemories.length,
        selectedCount: state.selectedMemories.length
    }, '[Drilldown] Memories filtered');
    return state;
}
/**
 * Add web research results to drilldown
 */
export function addWebResearch(sessionId, researchResults) {
    const state = drilldownStates.get(sessionId);
    if (!state)
        return null;
    state.webResearchDone = true;
    state.webResearchResults = researchResults;
    logger.info({ sessionId }, '[Drilldown] Web research added');
    return state;
}
/**
 * Get final curated context
 */
export function getFinalContext(sessionId) {
    const state = drilldownStates.get(sessionId);
    if (!state)
        return '';
    let output = formatContextInjection(state.selectedMemories);
    if (state.webResearchDone && state.webResearchResults) {
        output += '\n<specmem-web-research>\n';
        output += state.webResearchResults;
        output += '\n</specmem-web-research>\n';
    }
    return output;
}
/**
 * Get drilldown state
 */
export function getDrilldownState(sessionId) {
    return drilldownStates.get(sessionId) || null;
}
/**
 * Clear drilldown session
 */
export function clearDrilldown(sessionId) {
    drilldownStates.delete(sessionId);
}
/**
 * Generate drilldown prompt for Claude's AskUserQuestion
 *
 * This creates the question structure for user interaction
 */
export function generateDrilldownQuestion(state, questionType) {
    switch (questionType) {
        case 'depth':
            return {
                question: `Found ${state.allMemories.length} memories. How deep should we search?`,
                header: 'Search Depth',
                options: [
                    { label: 'Light (10 memories)', description: '50MB RAM - quick surface search' },
                    { label: 'Standard (20 memories)', description: '100MB RAM - balanced depth' },
                    { label: 'Deep (50 memories)', description: '150MB RAM - thorough search' },
                    { label: 'Exhaustive (100 memories)', description: '150MB RAM - everything related' }
                ],
                multiSelect: false
            };
        case 'filter':
            const topMemories = state.allMemories.slice(0, 4);
            return {
                question: 'Which memories are relevant? (showing top 4)',
                header: 'Filter',
                options: topMemories.map((m, i) => ({
                    label: `Memory ${i + 1}`,
                    description: m.content.slice(0, 50) + '...'
                })),
                multiSelect: true
            };
        case 'research':
            return {
                question: 'Do you need current web information?',
                header: 'Research',
                options: [
                    { label: 'No', description: 'Local context is sufficient' },
                    { label: 'Quick (1-2 sources)', description: 'Fast web lookup' },
                    { label: 'Medium (3-5 sources)', description: 'Balanced research' },
                    { label: 'Thorough (5-10 sources)', description: 'Deep web research' }
                ],
                multiSelect: false
            };
        default:
            return {};
    }
}
/**
 * Export for MCP tool integration
 */
export const drilldownTools = {
    startDrilldown,
    changeDrilldownDepth,
    filterMemories,
    addWebResearch,
    getFinalContext,
    getDrilldownState,
    clearDrilldown,
    generateDrilldownQuestion,
    DRILLDOWN_DEPTHS
};
//# sourceMappingURL=drilldownHook.js.map