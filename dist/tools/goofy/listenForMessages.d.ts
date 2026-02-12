/**
 * listenForMessages - Receive messages from other team members via MCP
 *
 * DEPRECATED: This tool now wraps the new MCP-based team communication.
 * Prefer using read_team_messages directly for new implementations.
 *
 * Retrieves messages sent to this team member via the MCP-based
 * team communication system (NOT HTTP/REST).
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface ListenForMessagesInput {
    teamMemberId: string;
    includeExpired?: boolean;
    sortByPriority?: boolean;
}
interface ListenForMessagesOutput {
    success: boolean;
    messages: Array<{
        from: string;
        content: string;
        timestamp: string;
        messageType: string;
        priority: string;
        messageId?: string;
        expiresAt?: string;
    }>;
    count: number;
    hasUnread: boolean;
}
export declare class ListenForMessages implements MCPTool<ListenForMessagesInput, ListenForMessagesOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            teamMemberId: {
                type: string;
                description: string;
            };
            includeExpired: {
                type: string;
                description: string;
                default: boolean;
            };
            sortByPriority: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: ListenForMessagesInput): Promise<ListenForMessagesOutput>;
}
export {};
//# sourceMappingURL=listenForMessages.d.ts.map