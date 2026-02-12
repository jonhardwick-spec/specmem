/**
 * System Dependency Detection and Auto-Installation
 *
 * yo this detects and installs system-level dependencies
 * handles PostgreSQL, pgvector, and other OS-level stuff
 */
export interface SystemDepsCheck {
    postgresInstalled: boolean;
    postgresVersion?: string;
    pgvectorInstalled: boolean;
    canInstallPackages: boolean;
    platform: string;
    packageManager?: 'apt' | 'yum' | 'dnf' | 'brew' | 'pacman';
}
/**
 * Detect which package manager is available
 */
export declare function detectPackageManager(): Promise<SystemDepsCheck['packageManager']>;
/**
 * Check if PostgreSQL is installed
 */
export declare function checkPostgresInstalled(): Promise<{
    installed: boolean;
    version?: string;
}>;
/**
 * Check if pgvector is installed
 */
export declare function checkPgvectorInstalled(): Promise<boolean>;
/**
 * Check if we can install packages (have sudo/root)
 */
export declare function canInstallPackages(): Promise<boolean>;
/**
 * Check all system dependencies
 */
export declare function checkSystemDeps(): Promise<SystemDepsCheck>;
/**
 * Install PostgreSQL using system package manager
 */
export declare function installPostgres(packageManager: SystemDepsCheck['packageManager']): Promise<boolean>;
/**
 * Install pgvector extension using system package manager
 */
export declare function installPgvector(packageManager: SystemDepsCheck['packageManager'], pgVersion?: string): Promise<boolean>;
/**
 * Auto-install missing system dependencies
 */
export declare function autoInstallSystemDeps(): Promise<SystemDepsCheck>;
/**
 * Show manual installation instructions
 */
export declare function showManualInstallInstructions(check: SystemDepsCheck): void;
//# sourceMappingURL=systemDeps.d.ts.map