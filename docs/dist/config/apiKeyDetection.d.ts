/**
 * SpecMem API Key Detection
 *
 * Auto-detects Claude/Anthropic API keys from common locations.
 * Used for orchestrating Claude instances via SpecMem CLI.
 */
export interface APIKeyResult {
    key: string | null;
    source: string;
    isValid: boolean;
}
/**
 * Detect Claude/Anthropic API key from all known locations.
 * Returns the first valid key found.
 */
export declare function detectApiKey(): Promise<APIKeyResult>;
export declare function getApiKey(forceRefresh?: boolean): Promise<APIKeyResult>;
/**
 * Set API key manually (overrides detection).
 * Useful for CLI commands that take --api-key argument.
 */
export declare function setApiKey(key: string, source?: string): void;
/**
 * Clear cached API key
 */
export declare function clearApiKeyCache(): void;
/**
 * Save API key to a persistent location.
 * Stores in ~/.specmem/credentials.json
 */
export declare function saveApiKey(key: string): Promise<boolean>;
/**
 * Extract API key from Claude Code's OAuth token.
 * This is what you stored at ~/.claude/.credentials.json
 */
export declare function getClaudeCodeApiKey(): Promise<string | null>;
/**
 * Check if we have a usable API key from any source.
 */
export declare function hasValidApiKey(): Promise<boolean>;
//# sourceMappingURL=apiKeyDetection.d.ts.map