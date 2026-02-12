/**
 * exploreDependencies.ts - MCP Tool for Dependency Exploration
 *
 * yo this tool shows the CODE GRAPH fr fr
 * give it a file and it shows you:
 * - what it imports
 * - what imports it
 * - the whole dependency chain
 *
 * way faster than grepping through everything
 */
import { getTraceExploreSystem } from '../traceExploreSystem.js';
import { logger } from '../../utils/logger.js';
/**
 * ExploreDependencies MCP Tool
 *
 * Shows what a file depends on and what depends on it
 * Much faster than manually tracing imports
 *
 * Use this when you need to understand:
 * - How files are connected
 * - What might break if you change something
 * - The dependency tree for a module
 */
export class ExploreDependencies {
    name = 'explore_dependencies';
    description = `Shows the dependency graph for a file - what it imports and what imports it.

Use this to understand code relationships without manually tracing imports.
Shows:
- Direct imports (what this file uses)
- Reverse dependencies (what uses this file)
- Full dependency chain (up to specified depth)

Much faster than grepping for imports manually.`;
    inputSchema = {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'The file path to explore dependencies for'
            },
            depth: {
                type: 'number',
                description: 'How deep to trace the dependency chain (default: 2)',
                default: 2,
                minimum: 1,
                maximum: 10
            },
            includeReverse: {
                type: 'boolean',
                description: 'Include files that depend on this file (default: true)',
                default: true
            }
        },
        required: ['filePath']
    };
    async execute(params) {
        const startTime = Date.now();
        const depth = params.depth ?? 2;
        try {
            const traceSystem = getTraceExploreSystem();
            await traceSystem.initialize();
            const result = await traceSystem.exploreDependencies(params.filePath, depth);
            const duration = Date.now() - startTime;
            // Build ASCII visualization
            const visualization = this.buildVisualization(result.file, result.imports, result.importedBy, result.dependencyChain);
            logger.info({
                file: params.filePath,
                imports: result.imports.length,
                importedBy: result.importedBy.length,
                totalDeps: result.totalDependencies,
                depth,
                duration
            }, 'dependency exploration completed');
            return {
                success: true,
                file: result.file,
                imports: result.imports,
                importedBy: params.includeReverse !== false ? result.importedBy : [],
                dependencyChain: result.dependencyChain,
                totalDependencies: result.totalDependencies,
                visualization,
                message: `Found ${result.imports.length} imports and ${result.importedBy.length} reverse dependencies. Total: ${result.totalDependencies} connected files.`
            };
        }
        catch (error) {
            logger.error({ error, filePath: params.filePath }, 'explore_dependencies failed');
            return {
                success: false,
                file: params.filePath,
                imports: [],
                importedBy: [],
                dependencyChain: [],
                totalDependencies: 0,
                message: `Dependency exploration failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Build ASCII visualization of dependency tree
     */
    buildVisualization(file, imports, importedBy, dependencyChain) {
        const lines = [];
        lines.push('=== DEPENDENCY GRAPH ===');
        lines.push('');
        // Files that import this file (reverse deps)
        if (importedBy.length > 0) {
            lines.push('IMPORTED BY (what uses this file):');
            for (const dep of importedBy.slice(0, 10)) {
                lines.push(`  <- ${this.shortenPath(dep)}`);
            }
            if (importedBy.length > 10) {
                lines.push(`  ... and ${importedBy.length - 10} more`);
            }
            lines.push('');
        }
        // Target file
        lines.push(`[${this.shortenPath(file)}]`);
        lines.push('');
        // Direct imports
        if (imports.length > 0) {
            lines.push('IMPORTS (what this file uses):');
            for (const dep of imports.slice(0, 10)) {
                lines.push(`  -> ${this.shortenPath(dep)}`);
            }
            if (imports.length > 10) {
                lines.push(`  ... and ${imports.length - 10} more`);
            }
            lines.push('');
        }
        // Dependency chain
        if (dependencyChain.length > 1) {
            lines.push('DEPENDENCY CHAIN:');
            for (let i = 0; i < dependencyChain.length; i++) {
                const level = dependencyChain[i];
                const prefix = '  '.repeat(i);
                const arrow = i === 0 ? '' : '-> ';
                lines.push(`${prefix}${arrow}Level ${i}: ${level.length} files`);
                for (const f of level.slice(0, 5)) {
                    lines.push(`${prefix}   ${this.shortenPath(f)}`);
                }
                if (level.length > 5) {
                    lines.push(`${prefix}   ... and ${level.length - 5} more`);
                }
            }
        }
        return lines.join('\n');
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
export default ExploreDependencies;
//# sourceMappingURL=exploreDependencies.js.map