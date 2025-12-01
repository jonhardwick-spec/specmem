/**
 * Embedding Server Control MCP Tools
 *
 * Phase 4 implementation: User-controllable embedding server lifecycle
 *
 * Tools:
 * - embedding_start: Start/restart embedding server (clears stopped flag)
 * - embedding_stop: Stop embedding server (sets stopped flag to prevent auto-restart)
 * - embedding_status: Get detailed server status including restart loop detection
 *
 * @author hardwicksoftwareservices
 */
import { MCPTool } from '../toolRegistry.js';
import type { EmbeddingProvider } from '../../types/index.js';
/**
 * Set the embedding provider reference for socket reset
 * Called from toolRegistry during initialization
 */
export declare function setEmbeddingProviderRef(provider: EmbeddingProvider): void;
/**
 * Start or restart the embedding server
 * Clears the stopped-by-user flag and does a hard restart
 */
export declare class EmbeddingStart implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            force: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: any[];
    };
    execute(params: {
        force?: boolean;
    }): Promise<{
        success: boolean;
        message: string;
        status?: unknown;
    }>;
}
/**
 * Stop the embedding server and prevent auto-restart
 * Sets the stopped-by-user flag so health monitoring won't restart it
 */
export declare class EmbeddingStop implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
        required: any[];
    };
    execute(): Promise<{
        success: boolean;
        message: string;
        status?: unknown;
    }>;
}
/**
 * Get detailed embedding server status
 * Includes running state, health, restart loop detection, and user stop flag
 */
export declare class EmbeddingStatus implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            healthCheck: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: any[];
    };
    execute(params: {
        healthCheck?: boolean;
    }): Promise<{
        success: boolean;
        status: {
            running: boolean;
            healthy: boolean;
            stoppedByUser: boolean;
            pid: number | null;
            uptime: string | null;
            restartCount: number;
            consecutiveFailures: number;
            restartLoop: {
                inLoop: boolean;
                recentRestarts: number;
                windowSeconds: number;
            };
            socketPath: string;
            socketExists: boolean;
            healthCheckResult?: {
                success: boolean;
                responseTimeMs: number;
                error?: string;
            };
        };
    }>;
}
/**
 * Create all embedding control tools
 * Call this from toolRegistry.ts to register the tools
 */
export declare function createEmbeddingControlTools(): MCPTool[];
//# sourceMappingURL=embeddingControl.d.ts.map