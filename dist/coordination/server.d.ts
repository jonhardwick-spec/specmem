/**
 * server.ts - TeamMember Coordination HTTP/WebSocket Server
 *
 * Production-ready coordination server using Express + ws for
 * inter-team member communication. Integrates with LWJEB event bus
 * for sub-10ms event propagation.
 *
 * Features:
 * - WebSocket endpoint for real-time team member communication
 * - REST API for team member registration and events
 * - Heartbeat monitoring with automatic cleanup
 * - Event broadcast to all connected team members
 * - LWJEB event bus integration
 *
 * @author hardwicksoftwareservices
 */
import { CoordinationEvent } from './events.js';
import { TeamMemberRegistry } from './TeamMemberRegistry.js';
import { CoordinationEventDispatcher } from './handlers.js';
/**
 * Server configuration
 */
export interface CoordinationServerConfig {
    /** Port to listen on (default: 8588) */
    port: number;
    /** Host to bind to (default: '0.0.0.0') */
    host: string;
    /** Heartbeat interval in ms (default: 10000) */
    heartbeatIntervalMs: number;
    /** Heartbeat timeout in ms (default: 30000) */
    heartbeatTimeoutMs: number;
    /** Maximum message size in bytes (default: 1MB) */
    maxMessageSize: number;
    /** Enable CORS (default: true) */
    enableCors: boolean;
    /** Allowed origins for CORS */
    allowedOrigins: string[];
    /** Maximum number of ports to try if base port is in use (default: 10) */
    maxPortAttempts: number;
    /** Maximum startup retries per port (default: 3) */
    maxStartupRetries: number;
    /** Delay between startup retries in ms (default: 1000) */
    retryDelayMs: number;
}
/**
 * CoordinationServer - HTTP/WebSocket server for team member coordination
 *
 * Provides:
 * - WebSocket endpoint: ws://host:port/teamMembers
 * - REST endpoints: POST /team-members/register, POST /team-members/event
 * - Real-time event broadcast to connected team members
 * - Integration with LWJEB event bus
 */
export declare class CoordinationServer {
    private config;
    private server;
    private wss;
    private registry;
    private dispatcher;
    private connections;
    private teamMemberToConnection;
    private heartbeatInterval;
    private isRunning;
    private startTime;
    private actualPort;
    constructor(config?: Partial<CoordinationServerConfig>);
    /**
     * Start the server with port retry logic
     * Will try multiple ports if the base port is in use
     */
    start(): Promise<void>;
    /**
     * Internal method to start server on a specific port
     */
    private startOnPort;
    /**
     * Stop the server
     */
    stop(): Promise<void>;
    /**
     * Handle HTTP requests (REST API)
     */
    private handleHttpRequest;
    /**
     * Handle health check endpoint
     */
    private handleHealthCheck;
    /**
     * Handle team member registration via REST API
     */
    private handleRegisterTeamMember;
    /**
     * Handle event posting via REST API
     */
    private handleEventPost;
    /**
     * Handle get team members endpoint
     */
    private handleGetTeamMembers;
    /**
     * Handle get metrics endpoint
     */
    private handleGetMetrics;
    /**
     * Handle WebSocket upgrade
     */
    private handleUpgrade;
    /**
     * Handle new WebSocket connection
     */
    private handleConnection;
    /**
     * Handle WebSocket message
     */
    private handleWebSocketMessage;
    /**
     * Handle WebSocket registration
     */
    private handleWsRegister;
    /**
     * Handle WebSocket heartbeat
     */
    private handleWsHeartbeat;
    /**
     * Handle WebSocket sync request
     */
    private handleWsSync;
    /**
     * Handle WebSocket coordination event
     */
    private handleWsEvent;
    /**
     * Handle WebSocket close
     */
    private handleWebSocketClose;
    /**
     * Setup registry event listeners
     */
    private setupRegistryListeners;
    /**
     * Broadcast event to all connected team members
     */
    broadcast(event: CoordinationEvent, excludeTeamMemberId?: string): void;
    /**
     * Send event to specific teamMember
     */
    sendToTeamMember(teamMemberId: string, event: CoordinationEvent): boolean;
    /**
     * Send message to connection
     */
    private sendToConnection;
    /**
     * Start heartbeat checking interval
     */
    private startHeartbeatInterval;
    /**
     * Emit server status event
     */
    private emitServerStatus;
    /**
     * Get server status
     */
    getStatus(): {
        running: boolean;
        port: number;
        configuredPort: number;
        uptime: number;
        connections: number;
        teamMembers: number;
    };
    /**
     * Get the actual port the server is bound to
     */
    getActualPort(): number;
    /**
     * Get the team member registry
     */
    getRegistry(): TeamMemberRegistry;
    /**
     * Get the event dispatcher
     */
    getDispatcher(): CoordinationEventDispatcher;
}
/**
 * Create and optionally start a coordination server
 */
export declare function createCoordinationServer(config?: Partial<CoordinationServerConfig>, autoStart?: boolean): Promise<CoordinationServer>;
/**
 * Get the global coordination server
 * @deprecated Use getLazyCoordinationServer() instead for on-demand initialization
 */
export declare function getCoordinationServer(config?: Partial<CoordinationServerConfig>): CoordinationServer;
/**
 * Reset the global server (for testing)
 * @deprecated Use resetLazyCoordinationServer() instead
 */
export declare function resetCoordinationServer(): Promise<void>;
/**
 * Shutdown handler function type
 */
type ShutdownHandler = () => Promise<void>;
/**
 * Configure the lazy coordination server
 * Call this during MCP initialization to set port and other config
 * The server won't start until first team feature is used
 *
 * @param config Server configuration (port, host, etc.)
 */
export declare function configureLazyCoordinationServer(config: Partial<CoordinationServerConfig>): void;
/**
 * Disable the lazy coordination server
 * Call this if SPECMEM_COORDINATION_ENABLED=false
 */
export declare function disableLazyCoordinationServer(): void;
/**
 * Check if the coordination server is running
 */
export declare function isCoordinationServerRunning(): boolean;
/**
 * Check if the coordination server is available (running or can be started)
 */
export declare function isCoordinationServerAvailable(): boolean;
/**
 * Get the lazy coordination server, starting it if necessary
 * This is the main entry point for team member features
 *
 * @returns The coordination server instance, or null if disabled
 * @throws Error if server startup fails
 */
export declare function getLazyCoordinationServer(): Promise<CoordinationServer | null>;
/**
 * Register a shutdown handler to be called when the MCP server exits
 * This ensures clean shutdown of the coordination server
 */
export declare function registerLazyShutdownHandler(handler: ShutdownHandler): void;
/**
 * Execute all shutdown handlers
 * Call this from the MCP server's graceful shutdown
 */
export declare function executeLazyShutdownHandlers(): Promise<void>;
/**
 * Reset the lazy coordination server (for testing)
 */
export declare function resetLazyCoordinationServer(): Promise<void>;
/**
 * Get status of the lazy coordination server
 */
export declare function getLazyCoordinationServerStatus(): {
    configured: boolean;
    disabled: boolean;
    running: boolean;
    starting: boolean;
    port: number | null;
    lastError: string | null;
};
/**
 * Require the coordination server to be running
 * Throws a user-friendly error if it's disabled
 *
 * @param featureName Name of the feature requiring the server (for error message)
 * @returns The running coordination server
 * @throws Error if server is disabled or fails to start
 */
export declare function requireCoordinationServer(featureName: string): Promise<CoordinationServer>;
export {};
//# sourceMappingURL=server.d.ts.map