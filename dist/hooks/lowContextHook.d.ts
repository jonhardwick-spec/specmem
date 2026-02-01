/**
 * SPECMEM LOW CONTEXT COMPACTION HOOK
 * ====================================
 *
 * Intelligent auto-compaction hook that:
 *   1. Detects when  is running low on context
 *   2. Triggers SpecMem's Chinese Compactor at 5% remaining
 *   3. Uses premium compaction for critical context
 *   4. Self-contained - works with any  Code session
 *
 * Flow:
 *   1. Hook monitors context usage via prompt size
 *   2. At 10% context: WARNING - suggest compaction
 *   3. At 5% context: CRITICAL - force compaction
 *   4. Chinese Compactor shrinks context 60-80%
 *   5. Premium mode at <3%: maximum compression
 */
declare const CONTEXT_LIMITS: {
    readonly opus: 200000;
    readonly sonnet: 200000;
    readonly haiku: 200000;
    readonly default: 200000;
};
declare const THRESHOLDS: {
    readonly warning: 0.1;
    readonly critical: 0.05;
    readonly premium: 0.03;
};
export interface LowContextConfig {
    contextLimit: number;
    warningThreshold: number;
    criticalThreshold: number;
    premiumThreshold: number;
    enabled: boolean;
    autoCompact: boolean;
    stateFile?: string;
}
export interface ContextState {
    totalTokensUsed: number;
    totalTokensLimit: number;
    percentRemaining: number;
    compactionLevel: 'none' | 'warning' | 'critical' | 'premium';
    lastCompactionAt?: number;
    compactionCount: number;
}
/**
 * Main hook - monitors and compacts context
 */
export declare function lowContextHook(prompt: string, conversationHistory?: string, config?: Partial<LowContextConfig>): Promise<{
    prompt: string;
    warning: string;
    state: ContextState;
}>;
/**
 * Force compaction at any level
 */
export declare function forceCompact(text: string, level?: ContextState['compactionLevel']): string;
/**
 * Get current context state
 */
export declare function getContextState(): ContextState;
/**
 * Reset context tracking (call on new conversation)
 */
export declare function resetContextTracking(config?: Partial<LowContextConfig>): void;
/**
 * Manually update token count (for accurate tracking)
 */
export declare function updateTokenCount(tokensUsed: number): ContextState;
export { CONTEXT_LIMITS, THRESHOLDS };
//# sourceMappingURL=lowContextHook.d.ts.map