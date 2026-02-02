/**
 * Auto-Install System
 *
 * yo this handles runtime dependency checking and auto-installation
 * if something is missing, we detect it and fix it fr fr
 */
export interface InstallCheckResult {
    installed: boolean;
    missing: string[];
    needsBuild: boolean;
    databaseReady: boolean;
}
/**
 * Check if all required dependencies are installed
 * yo checking if we got everything we need
 */
export declare function areDepsInstalled(): boolean;
/**
 * Check if TypeScript has been compiled
 * nah bruh checking if we built this thing
 */
export declare function isTypeScriptBuilt(): boolean;
/**
 * Perform full installation check
 * yo running the full diagnostic fr fr
 */
export declare function checkInstallation(): Promise<InstallCheckResult>;
/**
 * Install npm dependencies
 * yeet them deps in yo
 */
export declare function installDependencies(): Promise<void>;
/**
 * Build TypeScript
 * compile that typescript fr fr
 */
export declare function buildTypeScript(): Promise<void>;
/**
 * Run database migrations
 * yo migrate that database
 */
export declare function runDatabaseMigrations(): Promise<void>;
/**
 * Deploy hooks to ~/.claude/hooks/ directory
 * god mode - copy all hook files to user's hooks dir
 */
export declare function deployHooksToUserDir(): Promise<string>;
/**
 * Configure  Code hooks for team member communication
 * GOD MODE - full hook configuration + permissions + everything
 */
export declare function configureHooks(): Promise<void>;
/**
 * Register SpecMem as MCP server with 
 * runs: claude mcp add specmem ...
 */
export declare function registerMcpServer(): Promise<void>;
/**
 * Auto-install everything needed
 * GOD MODE - one shot install that makes everything work
 */
export declare function autoInstallEverything(): Promise<void>;
/**
 * Run config health check and auto-fix any mismatches
 * Called on every SpecMem startup to ensure configs stay in sync
 */
export declare function ensureConfigSync(): Promise<boolean>;
/**
 * Create launcher script that bypasses sandbox check
 */
export declare function createGodModeLauncher(): Promise<void>;
//# sourceMappingURL=autoInstall.d.ts.map