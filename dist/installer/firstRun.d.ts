/**
 * First Run Detection and Setup
 *
 * yo this handles first-time setup and configuration
 * creates config files, runs initial migrations, etc.
 */
export interface FirstRunConfig {
    installedAt: string;
    version: string;
    dbConfigured: boolean;
    embeddingProvider: 'local';
    watcherEnabled: boolean;
}
/**
 * Check if this is the first run
 * is this the first rodeo fr fr
 */
export declare function isThisTheFirstRodeo(): boolean;
/**
 * Create initial configuration
 * yo setup that config file fr fr
 */
export declare function createInitialConfig(): FirstRunConfig;
/**
 * Load existing configuration
 * yo load that config
 */
export declare function loadConfig(): FirstRunConfig | null;
/**
 * Mark installation as complete
 * yo mark this as installed fr fr
 */
export declare function markAsInstalled(): void;
/**
 * Create default .env file if it doesn't exist
 * yo setup that .env file
 */
export declare function createDefaultEnvFile(): void;
/**
 * Show first-run welcome message
 * yo welcome the user fr fr
 */
export declare function showWelcomeMessage(config: FirstRunConfig): void;
/**
 * Run first-time setup
 * yo do all the first run stuff fr fr
 */
export declare function runFirstTimeSetup(): Promise<FirstRunConfig>;
//# sourceMappingURL=firstRun.d.ts.map