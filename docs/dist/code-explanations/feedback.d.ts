/**
 * provide_explanation_feedback - Improve explanations through feedback
 *
 * Allows Claude to provide feedback on explanations to improve
 * quality scores over time. Good explanations get reused more often.
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DatabaseManager } from '../database.js';
import { ProvideFeedbackParams, FeedbackResult } from './types.js';
/**
 * ProvideFeedback - Improve explanations through feedback
 *
 * Features:
 * - Positive/negative feedback tracking
 * - Automatic quality score adjustment
 * - Learning from usage patterns
 */
export declare class ProvideFeedback implements MCPTool<ProvideFeedbackParams, FeedbackResult> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            explanationId: {
                type: string;
                format: string;
                description: string;
            };
            positive: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager);
    execute(params: ProvideFeedbackParams): Promise<FeedbackResult>;
}
/**
 * Learning system for improving explanations over time
 *
 * Tracks:
 * - Common queries that lead to code
 * - Access patterns (time of day, day of week)
 * - Explanation effectiveness (use count vs feedback ratio)
 */
export declare class ExplanationLearningSystem {
    private db;
    constructor(db: DatabaseManager);
    /**
     * Get insights about code access patterns
     */
    getAccessInsights(codeId: string): Promise<{
        accessCount: number;
        commonQueries: string[];
        peakHours: number[];
        peakDays: string[];
        averageQuality: number;
    }>;
    /**
     * Identify explanations that need improvement
     */
    findExplanationsNeedingImprovement(limit?: number): Promise<Array<{
        id: string;
        filePath: string;
        explanationType: string;
        qualityScore: number;
        useCount: number;
        reason: string;
    }>>;
    /**
     * Get learning statistics
     */
    getLearningStats(): Promise<{
        totalExplanations: number;
        averageQuality: number;
        totalFeedback: number;
        positiveFeedbackRate: number;
        mostAccessedFiles: Array<{
            filePath: string;
            accessCount: number;
        }>;
        explanationTypeDistribution: Record<string, number>;
    }>;
}
//# sourceMappingURL=feedback.d.ts.map