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
import { compactIfEnabled } from '../utils/tokenCompressor.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
//  context limits (approximate tokens)
const CONTEXT_LIMITS = {
    opus: 200000,
    sonnet: 200000,
    haiku: 200000,
    default: 200000
};
// Thresholds for compaction triggers
const THRESHOLDS = {
    warning: 0.10, // 10% remaining - suggest compaction
    critical: 0.05, // 5% remaining - force compaction
    premium: 0.03 // 3% remaining - maximum compression
};
// Estimated tokens per character (rough approximation)
const TOKENS_PER_CHAR = 0.25;
/**
 * Get default config from environment
 */
function getDefaultConfig() {
    const modelType = process.env.CLAUDE_MODEL || 'default';
    const limit = CONTEXT_LIMITS[modelType] || CONTEXT_LIMITS.default;
    return {
        contextLimit: parseInt(process.env.SPECMEM_CONTEXT_LIMIT || '') || limit,
        warningThreshold: parseFloat(process.env.SPECMEM_WARNING_THRESHOLD || '') || THRESHOLDS.warning,
        criticalThreshold: parseFloat(process.env.SPECMEM_CRITICAL_THRESHOLD || '') || THRESHOLDS.critical,
        premiumThreshold: parseFloat(process.env.SPECMEM_PREMIUM_THRESHOLD || '') || THRESHOLDS.premium,
        enabled: process.env.SPECMEM_LOW_CONTEXT_HOOK !== 'false',
        autoCompact: process.env.SPECMEM_AUTO_COMPACT !== 'false',
        stateFile: process.env.SPECMEM_STATE_FILE ||
            path.join(process.env.HOME || '~', '.specmem', 'context-state.json')
    };
}
// State tracking
let contextState = {
    totalTokensUsed: 0,
    totalTokensLimit: CONTEXT_LIMITS.default,
    percentRemaining: 1.0,
    compactionLevel: 'none',
    compactionCount: 0
};
/**
 * Load state from file
 */
function loadState(config) {
    try {
        if (config.stateFile && existsSync(config.stateFile)) {
            const data = readFileSync(config.stateFile, 'utf8');
            return { ...contextState, ...JSON.parse(data) };
        }
    }
    catch {
        // State file optional
    }
    return contextState;
}
/**
 * Save state to file
 */
function saveState(config, state) {
    try {
        if (config.stateFile) {
            const dir = path.dirname(config.stateFile);
            if (!existsSync(dir)) {
                require('fs').mkdirSync(dir, { recursive: true });
            }
            writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
        }
    }
    catch (error) {
        logger.error({ error }, '[LowContext] Failed to save state');
    }
}
/**
 * Estimate tokens from text
 */
function estimateTokens(text) {
    return Math.ceil(text.length * TOKENS_PER_CHAR);
}
/**
 * Determine compaction level based on remaining context
 */
function determineCompactionLevel(percentRemaining, config) {
    if (percentRemaining <= config.premiumThreshold)
        return 'premium';
    if (percentRemaining <= config.criticalThreshold)
        return 'critical';
    if (percentRemaining <= config.warningThreshold)
        return 'warning';
    return 'none';
}
/**
 * Compact text using Chinese Compactor
 */
function compactText(text, level) {
    // Skip compaction for non-critical levels
    if (level === 'none') {
        return { result: text, saved: 0 };
    }
    // Use different modes based on urgency (maps to tokenCompressor contexts)
    let mode = 'hook';
    switch (level) {
        case 'premium':
            mode = 'system'; // Maximum compression (system output)
            break;
        case 'critical':
            mode = 'hook'; // Balanced compression (hook context)
            break;
        case 'warning':
            mode = 'search'; // Light compression (search results)
            break;
    }
    const originalLength = text.length;
    const { result, ratio } = compactIfEnabled(text, mode);
    const savedChars = originalLength - result.length;
    const savedTokens = Math.floor(savedChars * TOKENS_PER_CHAR);
    logger.info({
        level,
        mode,
        originalLength,
        compactedLength: result.length,
        savedTokens,
        ratio
    }, '[LowContext] Compacted text');
    return { result, saved: savedTokens };
}
/**
 * Generate context warning message
 */
function generateWarningMessage(state) {
    const pct = (state.percentRemaining * 100).toFixed(1);
    switch (state.compactionLevel) {
        case 'premium':
            return `\n<specmem-context-alert level="CRITICAL">
Context at ${pct}% - MAXIMUM COMPRESSION ACTIVE
SpecMem Chinese Compactor engaged at premium level.
Consider summarizing conversation history.
</specmem-context-alert>\n`;
        case 'critical':
            return `\n<specmem-context-alert level="WARNING">
Context at ${pct}% - Auto-compaction engaged
SpecMem is compressing responses to save context.
</specmem-context-alert>\n`;
        case 'warning':
            return `\n<specmem-context-alert level="INFO">
Context usage: ${pct}% remaining
Consider using /compact or summarizing when convenient.
</specmem-context-alert>\n`;
        default:
            return '';
    }
}
/**
 * Main hook - monitors and compacts context
 */
export async function lowContextHook(prompt, conversationHistory, config = {}) {
    const cfg = { ...getDefaultConfig(), ...config };
    if (!cfg.enabled) {
        return { prompt, warning: '', state: contextState };
    }
    // Load existing state
    contextState = loadState(cfg);
    contextState.totalTokensLimit = cfg.contextLimit;
    // Calculate current usage
    const promptTokens = estimateTokens(prompt);
    const historyTokens = conversationHistory ? estimateTokens(conversationHistory) : contextState.totalTokensUsed;
    contextState.totalTokensUsed = historyTokens + promptTokens;
    contextState.percentRemaining = Math.max(0, 1 - (contextState.totalTokensUsed / contextState.totalTokensLimit));
    // Determine compaction level
    const newLevel = determineCompactionLevel(contextState.percentRemaining, cfg);
    // Only compact if level increased or in critical/premium
    let compactedPrompt = prompt;
    if (cfg.autoCompact && (newLevel === 'critical' || newLevel === 'premium')) {
        const { result, saved } = compactText(prompt, newLevel);
        compactedPrompt = result;
        contextState.totalTokensUsed -= saved;
        contextState.percentRemaining = Math.max(0, 1 - (contextState.totalTokensUsed / contextState.totalTokensLimit));
        if (saved > 0) {
            contextState.lastCompactionAt = Date.now();
            contextState.compactionCount++;
        }
    }
    contextState.compactionLevel = newLevel;
    // Generate warning message
    const warning = generateWarningMessage(contextState);
    // Save state
    saveState(cfg, contextState);
    logger.info({
        tokensUsed: contextState.totalTokensUsed,
        tokensLimit: contextState.totalTokensLimit,
        percentRemaining: contextState.percentRemaining,
        level: contextState.compactionLevel
    }, '[LowContext] Context check complete');
    return {
        prompt: compactedPrompt,
        warning,
        state: contextState
    };
}
/**
 * Force compaction at any level
 */
export function forceCompact(text, level = 'critical') {
    const { result } = compactText(text, level);
    return result;
}
/**
 * Get current context state
 */
export function getContextState() {
    return { ...contextState };
}
/**
 * Reset context tracking (call on new conversation)
 */
export function resetContextTracking(config = {}) {
    const cfg = { ...getDefaultConfig(), ...config };
    contextState = {
        totalTokensUsed: 0,
        totalTokensLimit: cfg.contextLimit,
        percentRemaining: 1.0,
        compactionLevel: 'none',
        compactionCount: 0
    };
    saveState(cfg, contextState);
}
/**
 * Manually update token count (for accurate tracking)
 */
export function updateTokenCount(tokensUsed) {
    contextState.totalTokensUsed = tokensUsed;
    contextState.percentRemaining = Math.max(0, 1 - (tokensUsed / contextState.totalTokensLimit));
    contextState.compactionLevel = determineCompactionLevel(contextState.percentRemaining, getDefaultConfig());
    return { ...contextState };
}
// Export constants for external use
export { CONTEXT_LIMITS, THRESHOLDS };
//# sourceMappingURL=lowContextHook.js.map