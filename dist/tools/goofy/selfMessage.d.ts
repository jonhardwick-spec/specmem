/**
 * selfMessage - Send a message to yourself via terminal injection
 *
 * This tool allows  (or any subprocess) to inject a prompt into
 * the current  session. The message appears as user input and
 * triggers a  response.
 *
 * Use cases:
 * - Hooks can send notifications that  will respond to
 * - Subagents can request follow-up from the main 
 * - Background processes can push status updates
 *
 * IMPORTANT: This uses the STY environment variable to find the correct
 * screen session. Only works when running inside a screen session.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface SelfMessageInput {
    message: string;
    autoSubmit?: boolean;
    clearFirst?: boolean;
}
interface SelfMessageOutput {
    success: boolean;
    message: string;
    session?: string;
    warning?: string;
}
export declare class SelfMessage implements MCPTool<SelfMessageInput, SelfMessageOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            message: {
                type: string;
                description: string;
            };
            autoSubmit: {
                type: string;
                description: string;
                default: boolean;
            };
            clearFirst: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(args: SelfMessageInput): Promise<SelfMessageOutput>;
}
export {};
//# sourceMappingURL=selfMessage.d.ts.map