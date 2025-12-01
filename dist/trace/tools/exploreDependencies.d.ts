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
import { MCPTool } from '../../mcp/toolRegistry.js';
/**
 * Input parameters for explore_dependencies tool
 */
interface ExploreDependenciesInput {
    filePath: string;
    depth?: number;
    includeReverse?: boolean;
}
/**
 * Output from explore_dependencies tool
 */
interface ExploreDependenciesOutput {
    success: boolean;
    file: string;
    imports: string[];
    importedBy: string[];
    dependencyChain: string[][];
    totalDependencies: number;
    visualization?: string;
    message: string;
}
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
export declare class ExploreDependencies implements MCPTool<ExploreDependenciesInput, ExploreDependenciesOutput> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                description: string;
                default: number;
                minimum: number;
                maximum: number;
            };
            includeReverse: {
                type: string;
                description: string;
                default: boolean;
            };
        };
        required: string[];
    };
    execute(params: ExploreDependenciesInput): Promise<ExploreDependenciesOutput>;
    /**
     * Build ASCII visualization of dependency tree
     */
    private buildVisualization;
    /**
     * Shorten file path for display
     */
    private shortenPath;
}
export default ExploreDependencies;
//# sourceMappingURL=exploreDependencies.d.ts.map