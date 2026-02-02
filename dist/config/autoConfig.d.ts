import { ServerConfig } from '../types/index.js';
interface AutoConfigResult {
    isFirstRun: boolean;
    configPath: string;
    envPath: string;
    config: ServerConfig;
    wasGenerated: boolean;
}
interface PostgresDetectionResult {
    host: string;
    port: number;
    available: boolean;
    version?: string;
}
/**
 * isThisTheFirstRodeo - checks if this is the first time running SpecMem
 *
 * looks for config files in:
 * 1. ~/.specmem/config.json
 * 2. .env file in project root
 * 3. existing database connection
 */
export declare function isThisTheFirstRodeo(): Promise<boolean>;
/**
 * detectThePostgresVibes - auto-detect PostgreSQL connection details
 *
 * checks common locations:
 * 1. DATABASE_URL (if set, takes priority)
 * 2. Environment variables (PGHOST, PGPORT, etc)
 * 3. localhost:5432 (standard port)
 * 4. Unix socket connection
 * 5. Common Docker/Podman ports
 */
export declare function detectThePostgresVibes(): Promise<PostgresDetectionResult>;
/**
 * generateSecretSauce - creates secure random keys and passwords
 *
 * uses crypto.randomBytes for cryptographically secure randomness
 * generates URL-safe base64 strings for maximum compatibility
 */
export declare function generateSecretSauce(length?: number): string;
/**
 * autoMagicSetup - generates complete server configuration
 *
 * creates a production-ready config with:
 * - secure random passwords
 * - auto-detected postgres settings
 * - per-project isolation via project hash
 * - sensible defaults for all options
 */
export declare function autoMagicSetup(): Promise<ServerConfig>;
/**
 * getConfigDirectory - returns the user's config directory
 * creates it if it doesn't exist
 */
export declare function getConfigDirectory(): Promise<string>;
/**
 * getProjectRoot - returns the project root directory
 */
export declare function getProjectRoot(): string;
/**
 * saveConfigToFile - saves config to ~/.specmem/config.json
 */
export declare function saveConfigToFile(config: ServerConfig): Promise<string>;
/**
 * createEnvFile - creates .env file in project root
 */
export declare function createEnvFile(config: ServerConfig): Promise<string>;
/**
 * runAutoConfig - main entry point for auto-configuration
 *
 * orchestrates the entire auto-config process:
 * 1. Check if first run
 * 2. Detect postgres
 * 3. Generate config
 * 4. Save to files
 */
export declare function runAutoConfig(): Promise<AutoConfigResult>;
/**
 * syncConfigToUserFile - ALWAYS syncs current running config to ~/.specmem/config.json
 *
 * This ensures the hook ALWAYS has the latest config, even if .env changed
 * Called on EVERY startup - makes SpecMem deployable anywhere
 */
export declare function syncConfigToUserFile(config: ServerConfig): Promise<void>;
/**
 * ConfigPersistenceResult - Result of a config persistence operation
 */
export interface ConfigPersistenceResult {
    success: boolean;
    message: string;
    backupPath?: string;
    requiresRestart?: boolean;
    changedFields?: string[];
}
/**
 * DashboardModeConfig - Configuration for dashboard access mode
 */
export interface DashboardModeConfig {
    mode: 'private' | 'public';
    host?: string;
    port?: number;
    password?: string;
}
/**
 * InstanceConfig - Configuration stored in .specmem/instance.json
 * Extends the basic instance state with runtime config
 * Per-project isolation via project hash
 */
export interface InstanceConfig {
    pid?: number;
    projectPath: string;
    projectHash: string;
    startTime?: string;
    status?: string;
    stopReason?: string;
    dashboardMode?: 'private' | 'public';
    dashboardPort?: number;
    dashboardHost?: string;
    coordinationPort?: number;
    databaseName?: string;
    databasePort?: number;
    lastConfigUpdate?: string;
    configVersion?: number;
}
/**
 * Get the .specmem directory path for current project
 */
export declare function getLocalSpecMemDir(): string;
/**
 * Get the instance.json path for current project
 */
export declare function getInstanceConfigPath(): string;
/**
 * createAtomicBackup - Create a backup of a file before modifying
 *
 * Uses timestamp-based naming for multiple backup versions
 * Returns the backup path for potential rollback
 */
export declare function createAtomicBackup(filePath: string): Promise<string | null>;
/**
 * atomicWriteFile - Write a file atomically using temp file + rename
 *
 * Prevents file corruption by writing to a temp file first,
 * then atomically renaming (which is atomic on most filesystems)
 */
export declare function atomicWriteFile(filePath: string, content: string): Promise<void>;
/**
 * rollbackFromBackup - Restore a file from its backup
 *
 * Used when a config update fails and we need to revert
 */
export declare function rollbackFromBackup(originalPath: string, backupPath: string): Promise<boolean>;
/**
 * loadInstanceConfig - Load the current instance.json configuration
 */
export declare function loadInstanceConfig(): Promise<InstanceConfig | null>;
/**
 * saveInstanceConfig - Save instance configuration atomically
 *
 * Creates backup before updating, supports rollback on error
 * Uses project hash for per-project isolation
 */
export declare function saveInstanceConfig(config: Partial<InstanceConfig>): Promise<ConfigPersistenceResult>;
/**
 * updateEnvFile - Update a specific variable in specmem.env or .env
 *
 * Handles atomic updates with backup and rollback
 */
export declare function updateEnvFile(varName: string, value: string, envFilePath?: string): Promise<ConfigPersistenceResult>;
/**
 * persistDashboardMode - Persist dashboard mode changes to both instance.json and specmem.env
 *
 * Updates:
 * - .specmem/instance.json with mode/host/port
 * - specmem.env with SPECMEM_DASHBOARD_MODE and related vars
 *
 * Returns whether a restart is required (mode change requires rebinding)
 */
export declare function persistDashboardMode(config: DashboardModeConfig): Promise<ConfigPersistenceResult>;
/**
 * cleanupOldBackups - Remove backup files older than specified age
 *
 * Keeps the filesystem clean while maintaining recent backups
 */
export declare function cleanupOldBackups(directory: string, maxAgeMs?: number): Promise<number>;
export type { AutoConfigResult, PostgresDetectionResult };
//# sourceMappingURL=autoConfig.d.ts.map