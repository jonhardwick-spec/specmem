/**
 * teamMemberStream.ts - WebSocket Handler for Real-Time TeamMember Updates
 *
 * Phase 2: Real-time team member status updates and communications
 *
 * Features:
 * - /ws/team-members/live - Real-time team member session updates
 * - Broadcasts team member status changes
 * - Broadcasts new communications
 * - Client subscription management
 */
import { Server as HttpServer } from 'http';
export interface TeamMemberStreamMessage {
    type: 'teamMember_status' | 'communication' | 'session_created' | 'session_ended' | 'heartbeat' | 'error';
    sessionId?: string;
    teamMemberType?: string;
    data: unknown;
    timestamp: string;
}
export declare class TeamMemberStreamManager {
    private wss;
    private clients;
    private pingInterval;
    private messageQueue;
    private readonly maxQueueSize;
    private path;
    constructor(server: HttpServer, path?: string);
    private setupWebSocket;
    private handleClientMessage;
    private sendToClient;
    private flushQueueToClient;
    private shouldReceiveMessage;
    private startPingInterval;
    private generateClientId;
    /**
     * Broadcast a message to all subscribed clients
     */
    broadcast(message: TeamMemberStreamMessage): void;
    /**
     * Broadcast team member status change
     */
    broadcastTeamMemberStatus(sessionId: string, teamMemberType: string, status: string, data?: Record<string, unknown>): void;
    /**
     * Broadcast new communication
     */
    broadcastCommunication(sessionId: string, teamMemberType: string, communication: {
        id: string;
        role: string;
        content: string;
        toolCalls?: unknown[];
    }): void;
    /**
     * Broadcast session creation
     */
    broadcastSessionCreated(sessionId: string, teamMemberType: string, task?: string): void;
    /**
     * Broadcast session end
     */
    broadcastSessionEnded(sessionId: string, teamMemberType: string, finalStatus: string): void;
    /**
     * Get number of connected clients
     */
    getClientCount(): number;
    /**
     * Get client statistics
     */
    getStats(): {
        totalClients: number;
        clientsBySubscription: Record<string, number>;
    };
    /**
     * Shutdown the WebSocket server
     */
    shutdown(): Promise<void>;
}
export declare function initializeTeamMemberStream(server: HttpServer, path?: string, projectPath?: string): TeamMemberStreamManager;
export declare function getTeamMemberStreamManager(projectPath?: string): TeamMemberStreamManager | null;
/**
 * Shutdown and reset the TeamMemberStreamManager for a specific project
 * MUST be called during server shutdown to prevent memory leaks
 */
export declare function shutdownTeamMemberStream(projectPath?: string): Promise<void>;
/**
 * Shutdown all TeamMemberStreamManagers across all projects
 */
export declare function shutdownAllTeamMemberStreams(): Promise<void>;
//# sourceMappingURL=teamMemberStream.d.ts.map