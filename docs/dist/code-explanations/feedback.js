/**
 * provide_explanation_feedback - Improve explanations through feedback
 *
 * Allows Claude to provide feedback on explanations to improve
 * quality scores over time. Good explanations get reused more often.
 */
import { logger } from '../utils/logger.js';
import { ProvideFeedbackInput } from './types.js';
/**
 * ProvideFeedback - Improve explanations through feedback
 *
 * Features:
 * - Positive/negative feedback tracking
 * - Automatic quality score adjustment
 * - Learning from usage patterns
 */
export class ProvideFeedback {
    db;
    name = 'provide_explanation_feedback';
    description = `Provide feedback on a code explanation to help improve it over time.
Positive feedback increases the quality score, making it more likely to be reused.
Negative feedback decreases the score, potentially triggering regeneration.`;
    inputSchema = {
        type: 'object',
        properties: {
            explanationId: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the explanation to provide feedback for'
            },
            positive: {
                type: 'boolean',
                description: 'True for positive feedback, false for negative'
            }
        },
        required: ['explanationId', 'positive']
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        const validatedParams = ProvideFeedbackInput.parse(params);
        logger.debug({
            explanationId: validatedParams.explanationId,
            positive: validatedParams.positive
        }, 'Processing explanation feedback');
        try {
            // Update feedback count
            const column = validatedParams.positive ? 'feedback_positive' : 'feedback_negative';
            const result = await this.db.query(`UPDATE code_explanations
         SET ${column} = ${column} + 1
         WHERE id = $1
         RETURNING quality_score, feedback_positive, feedback_negative`, [validatedParams.explanationId]);
            if (result.rows.length === 0) {
                return {
                    success: false,
                    newQualityScore: 0,
                    message: `Explanation ${validatedParams.explanationId} not found`
                };
            }
            const row = result.rows[0];
            logger.info({
                explanationId: validatedParams.explanationId,
                positive: validatedParams.positive,
                newQualityScore: row.quality_score,
                totalPositive: row.feedback_positive,
                totalNegative: row.feedback_negative
            }, 'Feedback recorded');
            return {
                success: true,
                newQualityScore: row.quality_score,
                message: `Feedback recorded. Quality score: ${row.quality_score.toFixed(2)} ` +
                    `(${row.feedback_positive}+ / ${row.feedback_negative}-)`
            };
        }
        catch (error) {
            logger.error({ error, explanationId: validatedParams.explanationId }, 'Feedback failed');
            return {
                success: false,
                newQualityScore: 0,
                message: error instanceof Error ? error.message : 'Failed to record feedback'
            };
        }
    }
}
/**
 * Learning system for improving explanations over time
 *
 * Tracks:
 * - Common queries that lead to code
 * - Access patterns (time of day, day of week)
 * - Explanation effectiveness (use count vs feedback ratio)
 */
export class ExplanationLearningSystem {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Get insights about code access patterns
     */
    async getAccessInsights(codeId) {
        const result = await this.db.query(`SELECT * FROM code_access_patterns WHERE code_id = $1`, [codeId]);
        if (result.rows.length === 0) {
            return {
                accessCount: 0,
                commonQueries: [],
                peakHours: [],
                peakDays: [],
                averageQuality: 0
            };
        }
        const row = result.rows[0];
        // Find peak hours (top 3)
        const hourlyPattern = row.hourly_access_pattern || Array(24).fill(0);
        const peakHours = hourlyPattern
            .map((count, hour) => ({ hour, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .filter((h) => h.count > 0)
            .map((h) => h.hour);
        // Find peak days
        const dailyPattern = row.daily_access_pattern || Array(7).fill(0);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const peakDays = dailyPattern
            .map((count, day) => ({ day: dayNames[day], count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .filter((d) => d.count > 0)
            .map((d) => d.day);
        // Get average quality of explanations for this code
        const qualityResult = await this.db.query(`SELECT AVG(quality_score) as avg_quality
       FROM code_explanations
       WHERE code_id = $1`, [codeId]);
        return {
            accessCount: row.access_count,
            commonQueries: (row.common_queries || []).slice(-10),
            peakHours,
            peakDays,
            averageQuality: qualityResult.rows[0]?.avg_quality ?? 0
        };
    }
    /**
     * Identify explanations that need improvement
     */
    async findExplanationsNeedingImprovement(limit = 10) {
        // Find explanations with low quality but high use count
        const result = await this.db.query(`SELECT id, file_path, explanation_type, quality_score, use_count,
              feedback_negative, feedback_positive
       FROM code_explanations
       WHERE quality_score < 0.5
       AND (use_count > 5 OR feedback_negative > feedback_positive)
       ORDER BY use_count DESC, quality_score ASC
       LIMIT $1`, [limit]);
        return result.rows.map((row) => ({
            id: row.id,
            filePath: row.file_path,
            explanationType: row.explanation_type,
            qualityScore: row.quality_score,
            useCount: row.use_count,
            reason: row.feedback_negative > row.feedback_positive
                ? 'More negative than positive feedback'
                : `Low quality (${row.quality_score.toFixed(2)}) but frequently used (${row.use_count}x)`
        }));
    }
    /**
     * Get learning statistics
     */
    async getLearningStats() {
        const [totalResult, feedbackResult, accessResult, typeResult] = await Promise.all([
            this.db.query(`
        SELECT COUNT(*) as count, AVG(quality_score) as avg_quality
        FROM code_explanations
      `),
            this.db.query(`
        SELECT
          SUM(feedback_positive + feedback_negative) as total,
          SUM(feedback_positive) as positive
        FROM code_explanations
      `),
            this.db.query(`
        SELECT cf.file_path, SUM(cap.access_count) as total_access
        FROM code_access_patterns cap
        JOIN codebase_files cf ON cap.code_id = cf.id
        GROUP BY cf.file_path
        ORDER BY total_access DESC
        LIMIT 10
      `),
            this.db.query(`
        SELECT explanation_type, COUNT(*) as count
        FROM code_explanations
        GROUP BY explanation_type
      `)
        ]);
        const totalRow = totalResult.rows[0];
        const feedbackRow = feedbackResult.rows[0];
        return {
            totalExplanations: parseInt(totalRow?.count ?? '0', 10),
            averageQuality: totalRow?.avg_quality ?? 0,
            totalFeedback: feedbackRow?.total ?? 0,
            positiveFeedbackRate: feedbackRow?.total
                ? (feedbackRow.positive ?? 0) / feedbackRow.total
                : 0,
            mostAccessedFiles: accessResult.rows.map((r) => ({
                filePath: r.file_path,
                accessCount: r.total_access
            })),
            explanationTypeDistribution: Object.fromEntries(typeResult.rows.map((r) => [r.explanation_type, r.count]))
        };
    }
}
//# sourceMappingURL=feedback.js.map