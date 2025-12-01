/**
 * packageTools - MCP tools for tracking package history
 *
 * yooo these tools let you track node_modules without indexing them
 * fr fr the big brain move
 */
import { logger } from '../utils/logger.js';
import { DependencyHistoryManager } from './dependencyHistory.js';
import { getThePool } from '../db/connectionPoolGoBrrr.js';
/**
 * GetPackageHistory - get history for a specific package
 */
export class GetPackageHistory {
    historyManager;
    name = 'get_package_history';
    description = 'get the history of changes for a specific npm package - shows when it was added, updated, or removed';
    inputSchema = {
        type: 'object',
        properties: {
            packageName: {
                type: 'string',
                description: 'the name of the package to get history for (e.g., "express", "react")'
            },
            limit: {
                type: 'number',
                default: 100,
                description: 'maximum number of history entries to return'
            }
        },
        required: ['packageName']
    };
    constructor(historyManager) {
        this.historyManager = historyManager;
    }
    async execute(params) {
        logger.debug({ params }, 'getting package history - whenDidWeAddThisPackage');
        const history = await this.historyManager.getPackageHistory(params.packageName, params.limit ?? 100);
        logger.info({ packageName: params.packageName, entryCount: history.length }, 'package history retrieved');
        return { history };
    }
}
/**
 * GetRecentPackageChanges - get recent package changes across all projects
 */
export class GetRecentPackageChanges {
    historyManager;
    name = 'recent_package_changes';
    description = 'get recent dependency changes across all package.json files - shows what packages were added/updated/removed recently';
    inputSchema = {
        type: 'object',
        properties: {
            days: {
                type: 'number',
                default: 7,
                description: 'number of days to look back (default: 7)'
            },
            limit: {
                type: 'number',
                default: 50,
                description: 'maximum number of changes to return'
            }
        }
    };
    constructor(historyManager) {
        this.historyManager = historyManager;
    }
    async execute(params) {
        logger.debug({ params }, 'getting recent package changes');
        const changes = await this.historyManager.getRecentChanges(params.days ?? 7, params.limit ?? 50);
        logger.info({ changeCount: changes.length }, 'recent changes retrieved');
        return { changes };
    }
}
/**
 * GetCurrentDependencies - get all currently installed packages
 */
export class GetCurrentDependencies {
    historyManager;
    name = 'current_dependencies';
    description = 'get all currently installed packages from package.json files - shows what packages do we have';
    inputSchema = {
        type: 'object',
        properties: {
            packageJsonPath: {
                type: 'string',
                description: 'optional path to a specific package.json file (if not provided, returns all dependencies)'
            }
        }
    };
    constructor(historyManager) {
        this.historyManager = historyManager;
    }
    async execute(params) {
        logger.debug({ params }, 'getting current dependencies - whatPackagesDoWeHave');
        const dependencies = await this.historyManager.getCurrentDependencies(params.packageJsonPath);
        logger.info({ dependencyCount: dependencies.length }, 'current dependencies retrieved');
        return { dependencies };
    }
}
/**
 * WhenWasPackageAdded - find when a package was first added
 */
export class WhenWasPackageAdded {
    historyManager;
    name = 'when_package_added';
    description = 'find when a package was first added to the project - whenDidWeAddThisPackage fr';
    inputSchema = {
        type: 'object',
        properties: {
            packageName: {
                type: 'string',
                description: 'the name of the package to check (e.g., "express", "react")'
            },
            packageJsonPath: {
                type: 'string',
                description: 'optional path to a specific package.json file'
            }
        },
        required: ['packageName']
    };
    constructor(historyManager) {
        this.historyManager = historyManager;
    }
    async execute(params) {
        logger.debug({ params }, 'checking when package was added');
        const addedAt = await this.historyManager.whenWasPackageAdded(params.packageName, params.packageJsonPath);
        logger.info({ packageName: params.packageName, addedAt, found: !!addedAt }, 'package addition date checked');
        return {
            addedAt,
            found: !!addedAt
        };
    }
}
/**
 * QueryPackageHistory - flexible query for package history
 */
export class QueryPackageHistory {
    historyManager;
    name = 'query_package_history';
    description = 'flexible query for package history with filtering - search by name, event type, date range, etc';
    inputSchema = {
        type: 'object',
        properties: {
            packageName: {
                type: 'string',
                description: 'filter by package name'
            },
            eventType: {
                type: 'string',
                enum: ['added', 'updated', 'removed'],
                description: 'filter by event type'
            },
            packageType: {
                type: 'string',
                enum: ['dependency', 'devDependency', 'peerDependency', 'optionalDependency'],
                description: 'filter by dependency type'
            },
            packageJsonPath: {
                type: 'string',
                description: 'filter by package.json path'
            },
            projectName: {
                type: 'string',
                description: 'filter by project name'
            },
            fromDate: {
                type: 'string',
                description: 'filter events from this date (ISO 8601 format)'
            },
            toDate: {
                type: 'string',
                description: 'filter events until this date (ISO 8601 format)'
            },
            limit: {
                type: 'number',
                default: 100,
                description: 'maximum number of results to return'
            }
        }
    };
    constructor(historyManager) {
        this.historyManager = historyManager;
    }
    async execute(params) {
        logger.debug({ params }, 'querying package history');
        // convert string dates to Date objects
        const query = {
            ...params,
            fromDate: params.fromDate ? new Date(params.fromDate) : undefined,
            toDate: params.toDate ? new Date(params.toDate) : undefined
        };
        const results = await this.historyManager.queryHistory(query);
        logger.info({ resultCount: results.length }, 'package history query complete');
        return { results };
    }
}
/**
 * GetPackageStats - get aggregated statistics about package usage
 */
export class GetPackageStats {
    historyManager;
    name = 'get_package_stats';
    description = 'get statistics about package usage - total packages, most changed, recently added, etc';
    inputSchema = {
        type: 'object',
        properties: {}
    };
    constructor(historyManager) {
        this.historyManager = historyManager;
    }
    async execute() {
        logger.debug('getting package stats - packageHistoryGoCrazy');
        const stats = await this.historyManager.getPackageStats();
        logger.info({ totalPackages: stats.totalPackages, totalChanges: stats.totalChanges }, 'package stats retrieved');
        return stats;
    }
}
// export all tools
export const PACKAGE_TOOLS = {
    GetPackageHistory,
    GetRecentPackageChanges,
    GetCurrentDependencies,
    WhenWasPackageAdded,
    QueryPackageHistory,
    GetPackageStats
};
/**
 * createPackageTools - creates all package tracking tools
 */
export function createPackageTools(pool) {
    const actualPool = pool ?? getThePool();
    const historyManager = new DependencyHistoryManager(actualPool);
    return {
        getPackageHistory: new GetPackageHistory(historyManager),
        getRecentPackageChanges: new GetRecentPackageChanges(historyManager),
        getCurrentDependencies: new GetCurrentDependencies(historyManager),
        whenWasPackageAdded: new WhenWasPackageAdded(historyManager),
        queryPackageHistory: new QueryPackageHistory(historyManager),
        getPackageStats: new GetPackageStats(historyManager)
    };
}
//# sourceMappingURL=packageTools.js.map