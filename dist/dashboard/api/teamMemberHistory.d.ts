/**
 * teamMemberHistory.ts - Team Member History & Communications API Endpoints
 *
 * Phase 2: Team Member History & Communications Viewer Backend APIs
 *
 * Endpoints:
 * - GET /api/team-members/history - All team member sessions with pagination
 * - GET /api/team-members/history/:id - Specific session details
 * - GET /api/team-members/communications/:id - Conversation for a session
 * - POST /api/team-members/sessions - Create a new session (for tracking)
 * - PATCH /api/team-members/sessions/:id - Update session status
 * - GET /api/team-members/communications/search - Search across communications
 * - POST /api/team-members/communications/:sessionId - Add a communication to session
 */
import { Router } from 'express';
import { DatabaseManager } from '../../database.js';
export interface TeamMemberSession {
    id: string;
    teamMemberType: 'worker' | 'overseer' | 'qa';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
    task: string | null;
    config: Record<string, unknown>;
    startTime: Date;
    endTime: Date | null;
    createdAt: Date;
}
export interface TeamMemberCommunication {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolCalls: Record<string, unknown>[] | null;
    timestamp: Date;
    createdAt: Date;
}
export declare function ensureTeamMemberCommunicationsSchema(db: DatabaseManager): Promise<void>;
export declare function createTeamMemberHistoryRouter(db: DatabaseManager): Router;
//# sourceMappingURL=teamMemberHistory.d.ts.map