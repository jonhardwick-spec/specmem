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
 * goes through the user via 's AskUserQuestion tool.
 *
 * Flow:
 *   1. Initial search returns memories
 *   2. User decides: enough context? drill deeper?
 *   3. If drill: user picks depth (20/50/100 memories)
 *   4. User filters: which memories are relevant?
 *   5. User decides: need web research?
 *   6. Final curated context delivered
 */
import { MemoryResult } from './contextInjectionHook.js';
export declare const DRILLDOWN_DEPTHS: {
    readonly light: {
        readonly limit: 10;
        readonly threshold: 0.4;
        readonly ram: "50MB";
    };
    readonly standard: {
        readonly limit: 20;
        readonly threshold: 0.3;
        readonly ram: "100MB";
    };
    readonly deep: {
        readonly limit: 50;
        readonly threshold: 0.2;
        readonly ram: "150MB";
    };
    readonly exhaustive: {
        readonly limit: 100;
        readonly threshold: 0.1;
        readonly ram: "150MB";
    };
};
export type DrilldownDepth = keyof typeof DRILLDOWN_DEPTHS;
/**
 * Drilldown state - tracks the current drilldown session
 */
export interface DrilldownState {
    query: string;
    depth: DrilldownDepth;
    allMemories: MemoryResult[];
    selectedMemories: MemoryResult[];
    webResearchDone: boolean;
    webResearchResults?: string;
}
/**
 * Start a new drilldown session
 */
export declare function startDrilldown(sessionId: string, query: string, depth?: DrilldownDepth): Promise<DrilldownState>;
/**
 * Change drilldown depth (triggers new search)
 */
export declare function changeDrilldownDepth(sessionId: string, newDepth: DrilldownDepth): Promise<DrilldownState | null>;
/**
 * Filter memories in current session
 */
export declare function filterMemories(sessionId: string, selectedIds: string[]): DrilldownState | null;
/**
 * Add web research results to drilldown
 */
export declare function addWebResearch(sessionId: string, researchResults: string): DrilldownState | null;
/**
 * Get final curated context
 */
export declare function getFinalContext(sessionId: string): string;
/**
 * Get drilldown state
 */
export declare function getDrilldownState(sessionId: string): DrilldownState | null;
/**
 * Clear drilldown session
 */
export declare function clearDrilldown(sessionId: string): void;
/**
 * Generate drilldown prompt for 's AskUserQuestion
 *
 * This creates the question structure for user interaction
 */
export declare function generateDrilldownQuestion(state: DrilldownState, questionType: 'depth' | 'filter' | 'research'): object;
/**
 * Export for MCP tool integration
 */
export declare const drilldownTools: {
    startDrilldown: typeof startDrilldown;
    changeDrilldownDepth: typeof changeDrilldownDepth;
    filterMemories: typeof filterMemories;
    addWebResearch: typeof addWebResearch;
    getFinalContext: typeof getFinalContext;
    getDrilldownState: typeof getDrilldownState;
    clearDrilldown: typeof clearDrilldown;
    generateDrilldownQuestion: typeof generateDrilldownQuestion;
    DRILLDOWN_DEPTHS: {
        readonly light: {
            readonly limit: 10;
            readonly threshold: 0.4;
            readonly ram: "50MB";
        };
        readonly standard: {
            readonly limit: 20;
            readonly threshold: 0.3;
            readonly ram: "100MB";
        };
        readonly deep: {
            readonly limit: 50;
            readonly threshold: 0.2;
            readonly ram: "150MB";
        };
        readonly exhaustive: {
            readonly limit: 100;
            readonly threshold: 0.1;
            readonly ram: "150MB";
        };
    };
};
//# sourceMappingURL=drilldownHook.d.ts.map