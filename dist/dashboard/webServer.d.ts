/**
 * webServer.ts - CSGO-Themed SpecMem Web Dashboard
 *
 * A badass web dashboard with CS:GO vibes for managing the SpecMem MCP Server.
 * Yellow (#FFD700) and Black (#000000) color scheme with modal-based UI.
 *
 * Features:
 * - Login system with password protection
 * - Memory management (view/search/delete)
 * - Session management ( sessions)
 * - Codebase browser
 * - Skills manager
 * - Team member coordination viewer
 * - Statistics dashboard
 * - Configuration panel
 *
 * @author hardwicksoftwareservices
 */
import { DatabaseManager } from '../database.js';
import { SkillScanner } from '../skills/skillScanner.js';
import { CodebaseIndexer } from '../codebase/codebaseIndexer.js';
import { EmbeddingProvider } from '../tools/index.js';
import { MemoryManager } from '../utils/memoryManager.js';
import { EmbeddingOverflowHandler } from '../db/embeddingOverflow.js';
/** Dashboard access mode: private (localhost only) or public (network accessible) */
export type DashboardMode = 'private' | 'public';
export interface DashboardConfig {
    /** Port to listen on (default: 8585) */
    port: number;
    /** Host to bind to (127.0.0.1 in private mode, 0.0.0.0 in public mode) */
    host: string;
    /** Dashboard access mode: 'private' (localhost only) or 'public' (network accessible) */
    mode: DashboardMode;
    /** Session secret for express-session */
    sessionSecret: string;
    /** Login password */
    password: string;
    /** Coordination server port for WebSocket connection */
    coordinationPort: number;
    /** Maximum number of ports to try if base port is in use (default: 10) */
    maxPortAttempts: number;
    /** Maximum startup retries per port (default: 3) */
    maxStartupRetries: number;
    /** Delay between startup retries in ms (default: 1000) */
    retryDelayMs: number;
}
export interface DashboardStats {
    totalMemories: number;
    totalSessions: number;
    totalFiles: number;
    totalSkills: number;
    activeTeamMembers: number;
    uptime: number;
    memory?: {
        heapUsedMB: number;
        heapTotalMB: number;
        maxHeapMB: number;
        usagePercent: number;
        pressureLevel: string;
        embeddingCacheSize: number;
        totalEvictions: number;
        totalOverflowed: number;
    };
}
export declare class DashboardWebServer {
    private config;
    private app;
    private server;
    private wss;
    private isRunning;
    private startTime;
    private actualPort;
    private db;
    private sessionStore;
    private skillScanner;
    private codebaseIndexer;
    private embeddingProvider;
    private memoryManager;
    private embeddingOverflowHandler;
    private connectedClients;
    private envFilePath;
    private teamMemberTracker;
    private teamMemberDeployment;
    private teamMemberHistoryManager;
    private terminalStreamManager;
    private teamMemberStreamManager;
    private dashboardCommunicator;
    private dashboardDiscovery;
    constructor(config?: Partial<DashboardConfig>);
    /**
     * Setup Express middleware
     */
    private setupMiddleware;
    /**
     * Authentication middleware
     */
    private requireAuth;
    /**
     * Setup Express routes
     */
    private setupRoutes;
    /**
     * Setup WebSocket for real-time updates
     */
    private setupWebSocket;
    /**
     * TeamMember-specific WebSocket clients for live message streaming
     */
    private teamMemberWsClients;
    private teamMemberMessageSubscriptions;
    private setupTeamMemberEventForwarding;
    /**
     * Setup WebSocket connection for team member message streaming
     */
    private setupTeamMemberWebSocket;
    /**
     * Setup WebSocket connection for terminal output streaming (Phase 5)
     * Uses PTY streaming with full ANSI support for colors, formatting, etc.
     */
    private setupTerminalWebSocket;
    /**
     * Handle incoming WebSocket messages for team member streaming
     */
    private handleTeamMemberWsMessage;
    /**
     * Broadcast team member message to subscribed WebSocket clients
     */
    broadcastTeamMemberMessage(sessionId: string, message: unknown): void;
    /**
     * Broadcast team member status update to all team member WebSocket clients
     */
    broadcastTeamMemberStatusUpdate(sessionId: string, status: string, teamMember: unknown): void;
    /**
     * Broadcast message to all connected WebSocket clients
     */
    broadcastUpdate(type: string, data: unknown): void;
    /**
     * Get dashboard statistics
     */
    private getStats;
    /**
     * Persist password change to environment file
     */
    private persistPasswordToEnv;
    /**
     * Memory configuration state
     */
    private memoryConfig;
    /**
     * Cache statistics tracking
     */
    private cacheStats;
    /**
     * Get memory configuration
     */
    private getMemoryConfig;
    /**
     * Persist memory configuration to env file
     */
    private persistMemoryConfig;
    /**
     * Get memory statistics for the dashboard
     * Integrates with the MemoryManager for real heap stats
     */
    private getMemoryStats;
    /**
     * Trigger overflow cleanup based on configuration
     * PROJECT ISOLATED: Only cleans up current project's memories
     */
    private triggerOverflowCleanup;
    /**
     * Emergency memory purge - deletes ALL memories
     * PROJECT ISOLATED: Only purges current project's memories
     */
    private emergencyMemoryPurge;
    /**
     * Clear specific cache type
     */
    private clearCache;
    private getFileExtension;
    /**
     * Get memories with optional search (supports text and semantic search)
     */
    private getMemories;
    /**
     * Get memories for Camera Roll mode with zoom-based similarity threshold
     * Returns results with similarity scores for drilldown functionality
     */
    private getCameraRollMemories;
    /**
     * Get a single memory by ID with full details
     */
    private getMemoryById;
    /**
     * Delete a memory by ID
     * PROJECT ISOLATED: Only deletes from current project
     */
    private deleteMemory;
    /**
     * Bulk delete memories based on criteria
     * PROJECT ISOLATED: Only deletes from current project
     */
    private bulkDeleteMemories;
    /**
     * Get  sessions with detailed information
     */
    private getSessions;
    /**
     * Get codebase files with content search support
     */
    private getCodebaseFiles;
    /**
     * Get file content from the codebase indexer
     */
    private getFileContent;
    /**
     * Get skills
     */
    private getSkills;
    /**
     * Reload skills
     */
    private reloadSkills;
    /**
     * Get active team members from discovery service (SpecMem-based)
     */
    private getTeamMembers;
    /**
     * Get all currently active team member sessions from database
     */
    private getActiveTeamMemberSessions;
    /**
     * Get team member session history with pagination and filtering
     */
    private getTeamMemberSessionHistory;
    /**
     * Get detailed information about a specific team member session
     */
    private getTeamMemberSessionDetails;
    /**
     * Get messages for a specific session with pagination
     */
    private getTeamMemberSessionMessages;
    /**
     * Get team member deployments with pagination and filtering
     */
    private getTeamMemberDeployments;
    /**
     * Get aggregate statistics for team members
     */
    private getTeamMemberStats;
    /**
     * Set database manager
     */
    setDatabase(db: DatabaseManager): void;
    /**
     * Set skill scanner
     */
    setSkillScanner(scanner: SkillScanner): void;
    /**
     * Set codebase indexer
     */
    setCodebaseIndexer(indexer: CodebaseIndexer): void;
    /**
     * Set embedding provider for semantic search
     */
    setEmbeddingProvider(provider: EmbeddingProvider): void;
    /**
     * Set memory manager for heap monitoring
     */
    setMemoryManager(manager: MemoryManager): void;
    /**
     * Set embedding overflow handler
     */
    setEmbeddingOverflowHandler(handler: EmbeddingOverflowHandler): void;
    /**
     * Set path to env file for password persistence
     */
    setEnvFilePath(envPath: string): void;
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
     * Get server status
     */
    getStatus(): {
        running: boolean;
        port: number;
        configuredPort: number;
        uptime: number;
    };
    /**
     * Get the actual port the server is bound to
     */
    getActualPort(): number;
    /**
     * Get current dashboard mode
     */
    getMode(): DashboardMode;
    /**
     * Get current host binding
     */
    getHost(): string;
    /**
     * RebindResult - Result of a server rebind operation
     */
    private pendingRebind;
    /**
     * updateConfig - Update server configuration with optional rebind
     *
     * Some changes (mode, host, port) require rebinding the server.
     * Password changes can be applied without restart (hot reload).
     *
     * @param newConfig - Partial config to update
     * @returns Object indicating success and whether restart is needed
     */
    updateConfig(newConfig: Partial<DashboardConfig>): Promise<{
        success: boolean;
        message: string;
        requiresRebind: boolean;
        appliedChanges: string[];
    }>;
    /**
     * rebind - Gracefully rebind the server to a new host/port
     *
     * This performs a graceful restart:
     * 1. Mark server as stopping
     * 2. Stop accepting new connections
     * 3. Close existing WebSocket connections with notice
     * 4. Close HTTP server
     * 5. Restart with new configuration
     *
     * @param notifyClients - Whether to notify WebSocket clients before restart
     * @returns Promise<boolean> - true if rebind successful
     */
    rebind(notifyClients?: boolean): Promise<{
        success: boolean;
        message: string;
        oldBinding: {
            host: string;
            port: number;
        };
        newBinding: {
            host: string;
            port: number;
        };
    }>;
    /**
     * scheduleRebind - Schedule a rebind after a delay
     *
     * Useful for giving clients time to prepare for restart
     *
     * @param delayMs - Delay before rebind in milliseconds
     * @returns Promise resolving when rebind is complete
     */
    scheduleRebind(delayMs?: number): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * reloadConfig - Reload configuration from environment/files
     *
     * Hot-reloads what can be reloaded without restart,
     * flags what requires restart
     */
    reloadConfig(): Promise<{
        success: boolean;
        hotReloaded: string[];
        requiresRestart: string[];
    }>;
}
/**
 * Get the global dashboard server
 */
export declare function getDashboardServer(config?: Partial<DashboardConfig>): DashboardWebServer;
/**
 * Reset the global dashboard server (for testing)
 */
export declare function resetDashboardServer(): Promise<void>;
//# sourceMappingURL=webServer.d.ts.map