/**
 * Native Claude Agent Definitions for SpecMem
 *
 * These agent types can be spawned using Claude's native --agent flag.
 * Each agent has a description and system prompt that defines its behavior.
 *
 * Usage: claude --agents '${JSON.stringify(SPECMEM_AGENTS)}' --agent bug-hunter
 */
export interface AgentDefinition {
    description: string;
    prompt: string;
}
export declare const SPECMEM_AGENTS: Record<string, AgentDefinition>;
/**
 * Get agent definitions as JSON string for --agents flag
 */
export declare function getAgentsJson(): string;
/**
 * Get list of available agent types
 */
export declare function getAgentTypes(): string[];
/**
 * Check if an agent type is valid
 */
export declare function isValidAgentType(type: string): boolean;
/**
 * Get agent definition by type
 */
export declare function getAgentDefinition(type: string): AgentDefinition | undefined;
//# sourceMappingURL=agentDefinitions.d.ts.map