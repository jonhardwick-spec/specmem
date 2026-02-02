import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
interface MigrationRecord {
    version: number;
    name: string;
    executedAt: Date;
    durationMs: number;
    checksum: string;
}
interface Migration {
    version: number;
    name: string;
    up: string;
    down: string;
    checksum: string;
}
/**
 * BigBrainMigrations - handles schema evolution like a BOSS
 *
 * features that absolutely SLAP:
 * - version tracking with checksums
 * - up/down migrations
 * - partitioning for massive tables
 * - proper index management
 * - pgvector setup for semantic search
 * - transaction-safe migrations
 */
export declare class BigBrainMigrations {
    private pool;
    constructor(pool: ConnectionPoolGoBrrr);
    runAllMigrations(): Promise<void>;
    private ensureMigrationTable;
    private getAppliedMigrations;
    private runMigration;
    rollbackLast(): Promise<void>;
    private generateChecksum;
    private getMigrations;
    validateMigrations(): Promise<{
        valid: boolean;
        issues: string[];
    }>;
    getStatus(): Promise<{
        applied: MigrationRecord[];
        pending: Migration[];
        lastApplied: MigrationRecord | null;
    }>;
}
export type { Migration, MigrationRecord };
//# sourceMappingURL=bigBrainMigrations.d.ts.map