/**
 * link_code_to_prompt - Associate code with conversation context
 *
 * Creates relationships between code files and memories/prompts
 * to enable active recall of relevant code during conversations.
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DatabaseManager } from '../database.js';
import { LinkCodeToPromptParams, LinkCodeResult } from './types.js';
/**
 * LinkCodeToPrompt - Create code-to-conversation links
 *
 * Features:
 * - Multiple relationship types
 * - Strength scoring
 * - Context preservation
 * - Duplicate prevention
 */
export declare class LinkCodeToPrompt implements MCPTool<LinkCodeToPromptParams, LinkCodeResult> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            codeId: {
                type: string;
                format: string;
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            memoryId: {
                type: string;
                format: string;
                description: string;
            };
            relationshipType: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            strength: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager);
    execute(params: LinkCodeToPromptParams): Promise<LinkCodeResult>;
    /**
     * Find code file by path
     */
    private findCodeFileByPath;
    /**
     * Verify memory exists
     */
    private verifyMemoryExists;
    /**
     * Find existing link
     */
    private findExistingLink;
    /**
     * Update existing link strength
     */
    private updateLinkStrength;
}
//# sourceMappingURL=linkCodeToPrompt.d.ts.map