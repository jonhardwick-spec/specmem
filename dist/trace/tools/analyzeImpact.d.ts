/**
 * analyzeImpact.ts - MCP Tool for Change Impact Analysis
 *
 * yo this tool predicts the BLAST RADIUS fr fr
 * before you change something, know what might break
 *
 * prevents "i only changed one file" disasters
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
/**
 * Input parameters for analyze_impact tool
 */
interface AnalyzeImpactInput {
    filePath: string;
    changeType?: 'modification' | 'deletion' | 'rename';
    showTestScope?: boolean;
}
/**
 * Output from analyze_impact tool
 */
interface AnalyzeImpactOutput {
    success: boolean;
    targetFile: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    directDependents: string[];
    indirectDependents: string[];
    totalAffectedFiles: number;
    affectedModules: string[];
    testFilesAffected: string[];
    suggestedTestScope: string[];
    visualization?: string;
    recommendations: string[];
    message: string;
}
/**
 * AnalyzeImpact MCP Tool
 *
 * Shows what would be affected if you change a file
 * Essential for understanding the blast radius of changes
 *
 * Use this BEFORE making changes to:
 * - Know what might break
 * - Understand which tests to run
 * - Assess the risk level
 * - Plan your changes better
 */
export declare class AnalyzeImpact implements MCPTool<AnalyzeImpactInput, AnalyzeImpactOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            changeType: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            showTestScope: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: AnalyzeImpactInput): Promise<AnalyzeImpactOutput>;
    /**
     * Build ASCII visualization of impact
     */
    private buildVisualization;
    /**
     * Generate recommendations based on impact
     */
    private generateRecommendations;
    /**
     * Build summary message
     */
    private buildSummaryMessage;
    /**
     * Shorten file path for display
     */
    private shortenPath;
}
export default AnalyzeImpact;
//# sourceMappingURL=analyzeImpact.d.ts.map