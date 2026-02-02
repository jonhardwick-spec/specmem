/**
 * compareInstanceMemory - Compare RAM usage across all SpecMem instances
 *
 * Shows memory usage breakdown per project/instance so you can see
 * which sessions are consuming the most resources.
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
interface CompareInstanceMemoryParams {
    /** Sort by: 'heapUsed' | 'rss' | 'usagePercent' | 'uptime' */
    sortBy?: 'heapUsed' | 'rss' | 'usagePercent' | 'uptime';
    /** Sort direction */
    sortDirection?: 'asc' | 'desc';
    /** Only show instances above this usage percent (0-100) */
    minUsagePercent?: number;
    /** Only show instances with warnings active */
    warningsOnly?: boolean;
}
interface InstanceComparison {
    instanceId: string;
    projectPath: string;
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    usagePercent: number;
    pressureLevel: string;
    embeddingCacheSize: number;
    uptimeFormatted: string;
    autoGCCount: number;
    warningActive: boolean;
    isCurrentInstance: boolean;
}
interface CompareInstanceMemoryResult {
    success: boolean;
    currentInstanceId: string;
    totalInstances: number;
    totalHeapUsedMB: number;
    totalRssMB: number;
    averageUsagePercent: number;
    instancesInWarning: number;
    instancesInCritical: number;
    instancesInEmergency: number;
    instances: InstanceComparison[];
    summary: string;
}
/**
 * CompareInstanceMemory - Cross-instance memory comparison tool
 *
 * Compare RAM usage across all running SpecMem instances.
 * Useful for identifying memory hogs when multiple projects share resources.
 */
export declare class CompareInstanceMemory implements MCPTool<CompareInstanceMemoryParams, CompareInstanceMemoryResult> {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            sortBy: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            sortDirection: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            minUsagePercent: {
                type: string;
                minimum: number;
                maximum: number;
                description: string;
            };
            warningsOnly: {
                type: string;
                default: boolean;
                description: string;
            };
        };
    };
    execute(params: CompareInstanceMemoryParams): Promise<CompareInstanceMemoryResult>;
    /**
     * Format uptime in human-readable format
     */
    private formatUptime;
    /**
     * Parse formatted uptime back to seconds
     */
    private parseUptime;
    /**
     * Generate human-readable summary
     */
    private generateSummary;
}
export {};
//# sourceMappingURL=compareInstanceMemory.d.ts.map