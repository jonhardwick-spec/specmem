/**
 * Service Provider - Handles service requests from team members
 *
 * TeamMembers can request services like:
 * - code_search: Search codebase semantically
 * - code_trace: Trace error to root cause
 * - code_explain: Get explanation for code
 * - memory_search: Search memory database
 * - dependencies: Get dependency graph
 *
 * @author hardwicksoftwareservices
 */
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../types/index.js';
export interface ServiceRequest {
    requestId: string;
    service: string;
    params: Record<string, unknown>;
    teamMemberId: string;
}
export interface ServiceResponse {
    requestId: string;
    success: boolean;
    data?: unknown;
    error?: string;
    options?: ServiceOption[];
}
export interface ServiceOption {
    id: string;
    label: string;
    description: string;
    params?: Record<string, unknown>;
}
/**
 * Service Provider - provides capabilities to team members
 */
export declare class ServiceProvider {
    private db;
    private embedding?;
    constructor(db: DatabaseManager, embedding?: EmbeddingProvider);
    /**
     * Handle a service request from a team member
     */
    handleRequest(request: ServiceRequest): Promise<ServiceResponse>;
    /**
     * List available services
     */
    private listServices;
    /**
     * Code search service
     */
    private codeSearch;
    /**
     * Code trace service
     */
    private codeTrace;
    /**
     * Code explain service
     */
    private codeExplain;
    /**
     * Memory search service
     */
    private memorySearch;
    /**
     * Get dependencies service
     */
    private getDependencies;
}
//# sourceMappingURL=serviceProvider.d.ts.map