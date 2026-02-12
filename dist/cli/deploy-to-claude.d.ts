/**
 * SpecMem Auto-Deploy to 
 *
 * Automatically deploys SpecMem hooks and slash commands to 's
 * configuration directories on startup.
 *
 * Source directories (in SpecMem):
 *   - claude-hooks/   -> ~/.claude/hooks/
 *   - commands/       -> ~/.claude/commands/
 *
 * Features:
 *   - Version checking (only deploy if version changed)
 *   - Automatic settings.json hook registration
 *   - Executable permissions for hooks
 *   - Backup of existing files
 *
 * This ensures SpecMem's  integration is always up-to-date
 * without manual file copying.
 */
interface VersionManifest {
    specmemVersion: string;
    deployedAt: string;
    files: {
        [path: string]: {
            hash: string;
            size: number;
            deployedAt: string;
        };
    };
}
/**
 * Get SpecMem version from package.json
 */
declare function getSpecMemVersion(): string;
/**
 * Load version manifest from target directory
 */
declare function loadManifest(targetDir: string): VersionManifest | null;
export interface DeployResult {
    success: boolean;
    hooksDeployed: string[];
    hooksSkipped: string[];
    commandsDeployed: string[];
    commandsSkipped: string[];
    settingsUpdated: boolean;
    errors: string[];
    version: string;
}
export declare function deployTo(): Promise<DeployResult>;
/**
 * Quick deploy function for use during MCP startup
 * Runs silently unless there are errors
 */
export declare function autoDeployHooks(): Promise<boolean>;
export { getSpecMemVersion, loadManifest };
//# sourceMappingURL=deploy-to-claude.d.ts.map