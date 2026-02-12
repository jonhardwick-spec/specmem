/**
 * packageTools - MCP tools for tracking package history
 *
 * yooo these tools let you track node_modules without indexing them
 * fr fr the big brain move
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DependencyHistoryManager, PackageHistoryQuery, DependencyHistoryRecord, CurrentDependency } from './dependencyHistory.js';
import { ConnectionPoolGoBrrr } from '../db/connectionPoolGoBrrr.js';
/**
 * GetPackageHistory - get history for a specific package
 */
export declare class GetPackageHistory implements MCPTool<{
    packageName: string;
    limit?: number;
}, {
    history: DependencyHistoryRecord[];
}> {
    private historyManager;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            packageName: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
        };
        required: "packageName"[];
    };
    constructor(historyManager: DependencyHistoryManager);
    execute(params: {
        packageName: string;
        limit?: number;
    }): Promise<{
        history: DependencyHistoryRecord[];
    }>;
}
/**
 * GetRecentPackageChanges - get recent package changes across all projects
 */
export declare class GetRecentPackageChanges implements MCPTool<{
    days?: number;
    limit?: number;
}, {
    changes: DependencyHistoryRecord[];
}> {
    private historyManager;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            days: {
                type: string;
                default: number;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
        };
    };
    constructor(historyManager: DependencyHistoryManager);
    execute(params: {
        days?: number;
        limit?: number;
    }): Promise<{
        changes: DependencyHistoryRecord[];
    }>;
}
/**
 * GetCurrentDependencies - get all currently installed packages
 */
export declare class GetCurrentDependencies implements MCPTool<{
    packageJsonPath?: string;
}, {
    dependencies: CurrentDependency[];
}> {
    private historyManager;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            packageJsonPath: {
                type: string;
                description: string;
            };
        };
    };
    constructor(historyManager: DependencyHistoryManager);
    execute(params: {
        packageJsonPath?: string;
    }): Promise<{
        dependencies: CurrentDependency[];
    }>;
}
/**
 * WhenWasPackageAdded - find when a package was first added
 */
export declare class WhenWasPackageAdded implements MCPTool<{
    packageName: string;
    packageJsonPath?: string;
}, {
    addedAt: Date | null;
    found: boolean;
}> {
    private historyManager;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            packageName: {
                type: string;
                description: string;
            };
            packageJsonPath: {
                type: string;
                description: string;
            };
        };
        required: "packageName"[];
    };
    constructor(historyManager: DependencyHistoryManager);
    execute(params: {
        packageName: string;
        packageJsonPath?: string;
    }): Promise<{
        addedAt: Date | null;
        found: boolean;
    }>;
}
/**
 * QueryPackageHistory - flexible query for package history
 */
export declare class QueryPackageHistory implements MCPTool<PackageHistoryQuery, {
    results: DependencyHistoryRecord[];
}> {
    private historyManager;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            packageName: {
                type: string;
                description: string;
            };
            eventType: {
                type: string;
                enum: string[];
                description: string;
            };
            packageType: {
                type: string;
                enum: string[];
                description: string;
            };
            packageJsonPath: {
                type: string;
                description: string;
            };
            projectName: {
                type: string;
                description: string;
            };
            fromDate: {
                type: string;
                description: string;
            };
            toDate: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
        };
    };
    constructor(historyManager: DependencyHistoryManager);
    execute(params: PackageHistoryQuery & {
        fromDate?: string;
        toDate?: string;
    }): Promise<{
        results: DependencyHistoryRecord[];
    }>;
}
/**
 * GetPackageStats - get aggregated statistics about package usage
 */
export declare class GetPackageStats implements MCPTool<Record<string, never>, {
    totalPackages: number;
    totalChanges: number;
    mostChangedPackages: Array<{
        packageName: string;
        changeCount: number;
    }>;
    recentlyAdded: Array<{
        packageName: string;
        addedAt: Date;
    }>;
}> {
    private historyManager;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
    };
    constructor(historyManager: DependencyHistoryManager);
    execute(): Promise<{
        totalPackages: number;
        totalChanges: number;
        mostChangedPackages: Array<{
            packageName: string;
            changeCount: number;
        }>;
        recentlyAdded: Array<{
            packageName: string;
            addedAt: Date;
        }>;
    }>;
}
export declare const PACKAGE_TOOLS: {
    GetPackageHistory: typeof GetPackageHistory;
    GetRecentPackageChanges: typeof GetRecentPackageChanges;
    GetCurrentDependencies: typeof GetCurrentDependencies;
    WhenWasPackageAdded: typeof WhenWasPackageAdded;
    QueryPackageHistory: typeof QueryPackageHistory;
    GetPackageStats: typeof GetPackageStats;
};
/**
 * createPackageTools - creates all package tracking tools
 */
export declare function createPackageTools(pool?: ConnectionPoolGoBrrr): {
    getPackageHistory: GetPackageHistory;
    getRecentPackageChanges: GetRecentPackageChanges;
    getCurrentDependencies: GetCurrentDependencies;
    whenWasPackageAdded: WhenWasPackageAdded;
    queryPackageHistory: QueryPackageHistory;
    getPackageStats: GetPackageStats;
};
//# sourceMappingURL=packageTools.d.ts.map