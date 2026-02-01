/**
 * analyzeImpact.ts - MCP Tool for Change Impact Analysis
 *
 * yo this tool predicts the BLAST RADIUS fr fr
 * before you change something, know what might break
 *
 * prevents "i only changed one file" disasters
 */
import { getTraceExploreSystem } from '../traceExploreSystem.js';
import { logger } from '../../utils/logger.js';
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
export class AnalyzeImpact {
    name = 'analyze_impact';
    description = `Analyzes what would be affected if you change a file - the "blast radius" of changes.

Use this BEFORE making changes to understand:
- Direct dependents (files that import this file)
- Indirect dependents (files affected through the chain)
- Risk level (low/medium/high/critical)
- Which tests should be run
- Which modules are affected

This prevents "I only changed one file" disasters.`;
    inputSchema = {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'The file path to analyze impact for'
            },
            changeType: {
                type: 'string',
                enum: ['modification', 'deletion', 'rename'],
                description: 'Type of change being considered (default: modification)',
                default: 'modification'
            },
            showTestScope: {
                type: 'boolean',
                description: 'Include suggested test scope (default: true)',
                default: true
            }
        },
        required: ['filePath']
    };
    async execute(params) {
        const startTime = Date.now();
        const changeType = params.changeType ?? 'modification';
        try {
            const traceSystem = getTraceExploreSystem();
            await traceSystem.initialize();
            const impact = await traceSystem.analyzeImpact(params.filePath);
            const duration = Date.now() - startTime;
            // Build visualization
            const visualization = this.buildVisualization(impact, changeType);
            // Generate recommendations based on impact
            const recommendations = this.generateRecommendations(impact, changeType);
            logger.info({
                file: params.filePath,
                riskLevel: impact.riskLevel,
                totalAffected: impact.totalAffectedFiles,
                changeType,
                duration
            }, 'impact analysis completed');
            return {
                success: true,
                targetFile: impact.targetFile,
                riskLevel: impact.riskLevel,
                directDependents: impact.directDependents,
                indirectDependents: impact.indirectDependents,
                totalAffectedFiles: impact.totalAffectedFiles,
                affectedModules: impact.affectedModules,
                testFilesAffected: params.showTestScope !== false ? impact.testFilesAffected : [],
                suggestedTestScope: params.showTestScope !== false ? impact.suggestedTestScope : [],
                visualization,
                recommendations,
                message: this.buildSummaryMessage(impact, changeType)
            };
        }
        catch (error) {
            logger.error({ error, filePath: params.filePath }, 'analyze_impact failed');
            return {
                success: false,
                targetFile: params.filePath,
                riskLevel: 'low',
                directDependents: [],
                indirectDependents: [],
                totalAffectedFiles: 0,
                affectedModules: [],
                testFilesAffected: [],
                suggestedTestScope: [],
                recommendations: [],
                message: `Impact analysis failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Build ASCII visualization of impact
     */
    buildVisualization(impact, changeType) {
        const lines = [];
        // Risk level indicator
        const riskIndicators = {
            'low': '[LOW RISK]',
            'medium': '[MEDIUM RISK]',
            'high': '[HIGH RISK]',
            'critical': '[!! CRITICAL RISK !!]'
        };
        lines.push('=== IMPACT ANALYSIS ===');
        lines.push('');
        lines.push(`${riskIndicators[impact.riskLevel]} - ${changeType.toUpperCase()}`);
        lines.push('');
        // Target file
        lines.push(`Target: ${this.shortenPath(impact.targetFile)}`);
        lines.push(`Total affected: ${impact.totalAffectedFiles} files`);
        lines.push('');
        // Direct dependents
        lines.push(`DIRECT DEPENDENTS (${impact.directDependents.length}):`);
        if (impact.directDependents.length > 0) {
            for (const dep of impact.directDependents.slice(0, 10)) {
                lines.push(`  <- ${this.shortenPath(dep)}`);
            }
            if (impact.directDependents.length > 10) {
                lines.push(`  ... and ${impact.directDependents.length - 10} more`);
            }
        }
        else {
            lines.push('  (none)');
        }
        lines.push('');
        // Indirect dependents
        lines.push(`INDIRECT DEPENDENTS (${impact.indirectDependents.length}):`);
        if (impact.indirectDependents.length > 0) {
            for (const dep of impact.indirectDependents.slice(0, 5)) {
                lines.push(`  <-- ${this.shortenPath(dep)}`);
            }
            if (impact.indirectDependents.length > 5) {
                lines.push(`  ... and ${impact.indirectDependents.length - 5} more`);
            }
        }
        else {
            lines.push('  (none)');
        }
        lines.push('');
        // Affected modules
        if (impact.affectedModules.length > 0) {
            lines.push(`AFFECTED MODULES: ${impact.affectedModules.join(', ')}`);
            lines.push('');
        }
        // Test files
        if (impact.testFilesAffected.length > 0) {
            lines.push(`TEST FILES TO RUN (${impact.testFilesAffected.length}):`);
            for (const test of impact.testFilesAffected.slice(0, 5)) {
                lines.push(`  * ${this.shortenPath(test)}`);
            }
            if (impact.testFilesAffected.length > 5) {
                lines.push(`  ... and ${impact.testFilesAffected.length - 5} more`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Generate recommendations based on impact
     */
    generateRecommendations(impact, changeType) {
        const recommendations = [];
        // Risk-based recommendations
        if (impact.riskLevel === 'critical') {
            recommendations.push('HIGH CAUTION: This change affects 50+ files. Consider breaking it into smaller changes.');
            recommendations.push('Run full test suite before merging.');
            recommendations.push('Consider creating a feature flag for gradual rollout.');
        }
        else if (impact.riskLevel === 'high') {
            recommendations.push('This is a significant change. Run comprehensive tests.');
            recommendations.push('Review all direct dependents for potential issues.');
        }
        else if (impact.riskLevel === 'medium') {
            recommendations.push('Moderate impact. Focus testing on affected modules.');
        }
        // Change type specific
        if (changeType === 'deletion') {
            recommendations.push('Deletion: All dependents will break. Update or remove imports first.');
            if (impact.directDependents.length > 0) {
                recommendations.push(`Fix ${impact.directDependents.length} files that import this file before deleting.`);
            }
        }
        else if (changeType === 'rename') {
            recommendations.push('Rename: Update all import statements in dependents.');
            recommendations.push('Consider using IDE refactoring tools for safety.');
        }
        // Test recommendations
        if (impact.testFilesAffected.length > 0) {
            recommendations.push(`Run these ${impact.testFilesAffected.length} test files to verify changes.`);
        }
        else if (impact.totalAffectedFiles > 0) {
            recommendations.push('No direct test files found for dependents. Consider adding tests.');
        }
        // Module-specific
        if (impact.affectedModules.length > 3) {
            recommendations.push('Changes span multiple modules. Coordinate with team members working on those modules.');
        }
        return recommendations;
    }
    /**
     * Build summary message
     */
    buildSummaryMessage(impact, changeType) {
        const parts = [];
        parts.push(`${impact.riskLevel.toUpperCase()} RISK ${changeType}`);
        parts.push(`${impact.totalAffectedFiles} files affected`);
        if (impact.directDependents.length > 0) {
            parts.push(`${impact.directDependents.length} direct dependents`);
        }
        if (impact.testFilesAffected.length > 0) {
            parts.push(`${impact.testFilesAffected.length} test files to run`);
        }
        return parts.join(' | ');
    }
    /**
     * Shorten file path for display
     */
    shortenPath(filePath) {
        const parts = filePath.split('/');
        if (parts.length <= 3)
            return filePath;
        return '.../' + parts.slice(-3).join('/');
    }
}
export default AnalyzeImpact;
//# sourceMappingURL=analyzeImpact.js.map