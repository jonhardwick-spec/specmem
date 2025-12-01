/**
 * compareInstanceMemory - Compare RAM usage across all SpecMem instances
 *
 * Shows memory usage breakdown per project/instance so you can see
 * which sessions are consuming the most resources.
 */
import { logger } from '../../utils/logger.js';
import { getMemoryManager } from '../../utils/memoryManager.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
/**
 * CompareInstanceMemory - Cross-instance memory comparison tool
 *
 * Compare RAM usage across all running SpecMem instances.
 * Useful for identifying memory hogs when multiple projects share resources.
 */
export class CompareInstanceMemory {
    name = 'compare_instance_memory';
    description = 'Compare RAM usage across all running SpecMem instances - shows per-project memory breakdown to identify resource hogs';
    inputSchema = {
        type: 'object',
        properties: {
            sortBy: {
                type: 'string',
                enum: ['heapUsed', 'rss', 'usagePercent', 'uptime'],
                default: 'heapUsed',
                description: 'Sort instances by: heapUsed, rss, usagePercent, or uptime'
            },
            sortDirection: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'desc',
                description: 'Sort direction: asc (lowest first) or desc (highest first)'
            },
            minUsagePercent: {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: 'Only show instances above this usage percent (0-100)'
            },
            warningsOnly: {
                type: 'boolean',
                default: false,
                description: 'Only show instances with active memory warnings'
            }
        }
    };
    async execute(params) {
        logger.debug({ params }, 'Comparing instance memory');
        try {
            const memoryManager = getMemoryManager();
            const currentInstanceId = memoryManager.getInstanceId();
            const globalStats = await memoryManager.getGlobalInstanceStats();
            // Process and filter instances
            let instances = globalStats.instances.map(inst => ({
                instanceId: inst.instanceId,
                projectPath: inst.projectPath,
                heapUsedMB: Math.round(inst.heapUsed / 1024 / 1024 * 100) / 100,
                heapTotalMB: Math.round(inst.heapTotal / 1024 / 1024 * 100) / 100,
                rssMB: Math.round(inst.rss / 1024 / 1024 * 100) / 100,
                usagePercent: Math.round(inst.usagePercent * 10000) / 100,
                pressureLevel: inst.pressureLevel,
                embeddingCacheSize: inst.embeddingCacheSize,
                uptimeFormatted: this.formatUptime(inst.uptime),
                autoGCCount: inst.autoGCCount,
                warningActive: inst.warningActive,
                isCurrentInstance: inst.instanceId === currentInstanceId
            }));
            // Apply filters
            if (params.minUsagePercent !== undefined) {
                instances = instances.filter(i => i.usagePercent >= params.minUsagePercent);
            }
            if (params.warningsOnly) {
                instances = instances.filter(i => i.warningActive);
            }
            // Sort instances
            const sortBy = params.sortBy ?? 'heapUsed';
            const sortDir = params.sortDirection ?? 'desc';
            const sortMultiplier = sortDir === 'desc' ? -1 : 1;
            instances.sort((a, b) => {
                let aVal, bVal;
                switch (sortBy) {
                    case 'rss':
                        aVal = a.rssMB;
                        bVal = b.rssMB;
                        break;
                    case 'usagePercent':
                        aVal = a.usagePercent;
                        bVal = b.usagePercent;
                        break;
                    case 'uptime':
                        // Parse uptime back to seconds for comparison
                        aVal = this.parseUptime(a.uptimeFormatted);
                        bVal = this.parseUptime(b.uptimeFormatted);
                        break;
                    default:
                        aVal = a.heapUsedMB;
                        bVal = b.heapUsedMB;
                }
                return (aVal - bVal) * sortMultiplier;
            });
            // Generate summary
            const summary = this.generateSummary(instances, globalStats, currentInstanceId);
            const result = {
                success: true,
                currentInstanceId,
                totalInstances: globalStats.totalInstances,
                totalHeapUsedMB: Math.round(globalStats.totalHeapUsed / 1024 / 1024 * 100) / 100,
                totalRssMB: Math.round(globalStats.totalRss / 1024 / 1024 * 100) / 100,
                averageUsagePercent: Math.round(globalStats.averageUsagePercent * 10000) / 100,
                instancesInWarning: globalStats.instancesInWarning,
                instancesInCritical: globalStats.instancesInCritical,
                instancesInEmergency: globalStats.instancesInEmergency,
                instances,
                summary
            };
            logger.info({
                totalInstances: result.totalInstances,
                totalHeapUsedMB: result.totalHeapUsedMB
            }, 'Instance memory comparison complete');
            // Build human-readable response with instance stats
            const humanReadableData = instances.map((inst, i) => ({
                id: inst.instanceId.substring(0, 8),
                similarity: inst.usagePercent ? inst.usagePercent / 100 : 0.5,
                content: `[INSTANCE] ${inst.projectPath || 'unknown'}: Heap ${inst.heapUsedMB}MB / RSS ${inst.rssMB}MB / ${inst.usagePercent}% / ${inst.pressureLevel}${inst.isCurrentInstance ? ' (CURRENT)' : ''}`,
            }));
            return formatHumanReadable('compare_instance_memory', humanReadableData, {
                grey: true,
                maxContentLength: 500
            });
        }
        catch (error) {
            logger.error({ error }, 'Failed to compare instance memory');
            return {
                success: false,
                currentInstanceId: 'unknown',
                totalInstances: 0,
                totalHeapUsedMB: 0,
                totalRssMB: 0,
                averageUsagePercent: 0,
                instancesInWarning: 0,
                instancesInCritical: 0,
                instancesInEmergency: 0,
                instances: [],
                summary: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Format uptime in human-readable format
     */
    formatUptime(uptimeMs) {
        const seconds = Math.floor(uptimeMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        }
        else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        else {
            return `${seconds}s`;
        }
    }
    /**
     * Parse formatted uptime back to seconds
     */
    parseUptime(formatted) {
        let total = 0;
        const dayMatch = formatted.match(/(\d+)d/);
        const hourMatch = formatted.match(/(\d+)h/);
        const minMatch = formatted.match(/(\d+)m/);
        const secMatch = formatted.match(/(\d+)s/);
        if (dayMatch)
            total += parseInt(dayMatch[1]) * 86400;
        if (hourMatch)
            total += parseInt(hourMatch[1]) * 3600;
        if (minMatch)
            total += parseInt(minMatch[1]) * 60;
        if (secMatch)
            total += parseInt(secMatch[1]);
        return total;
    }
    /**
     * Generate human-readable summary
     */
    generateSummary(instances, globalStats, currentInstanceId) {
        if (instances.length === 0) {
            return 'No SpecMem instances found matching your criteria.';
        }
        const lines = [];
        // Overall status
        const totalMB = Math.round(globalStats.totalHeapUsed / 1024 / 1024);
        lines.push(`${globalStats.totalInstances} SpecMem instance(s) using ${totalMB}MB total heap.`);
        // Warning status
        const warningCount = globalStats.instancesInWarning + globalStats.instancesInCritical + globalStats.instancesInEmergency;
        if (warningCount > 0) {
            lines.push(`WARNING: ${warningCount} instance(s) exceeding memory thresholds!`);
        }
        // Top consumer
        const topConsumer = instances[0];
        if (topConsumer && instances.length > 1) {
            const marker = topConsumer.isCurrentInstance ? ' (this instance)' : '';
            lines.push(`Top consumer: ${topConsumer.projectPath}${marker} at ${topConsumer.heapUsedMB}MB (${topConsumer.usagePercent}%)`);
        }
        // Current instance position
        const currentIdx = instances.findIndex(i => i.isCurrentInstance);
        if (currentIdx >= 0 && instances.length > 1) {
            lines.push(`This instance ranks #${currentIdx + 1} of ${instances.length} by memory usage.`);
        }
        return lines.join(' ');
    }
}
//# sourceMappingURL=compareInstanceMemory.js.map