/**
 * Project Environment Utilities
 *
 * Central place for managing project-specific environment variables.
 * Ensures SPECMEM_PROJECT_PATH flows through the entire system:
 * - Main process (set by bootstrap.cjs)
 * - Child processes (spawn, exec, fork)
 * - Team members (deployed via deployTeamMember)
 *
 * SPECMEM_PROJECT_PATH is set by Claude Code via MCP config env section:
 * - Claude Code expands ${PWD} at runtime to the project directory
 * - If not set, defaults to process.cwd()
 */
import { getProjectPath, getProjectHash, getProjectHashFull, getInstanceDir } from '../config.js';
/**
 * Ensure SPECMEM_PROJECT_PATH is set in the current process
 * Call this early in startup to guarantee the env var is available
 */
export declare function ensureProjectEnv(): void;
/**
 * Get environment variables to pass to child processes
 * This ensures all project-related env vars are inherited
 *
 * Use this when spawning child processes:
 * ```typescript
 * spawn('node', ['script.js'], { env: getProjectEnv() });
 * ```
 */
export declare function getProjectEnv(): Record<string, string | undefined>;
/**
 * getSpawnEnv - get env vars for child processes
 *
 * yooo ALWAYS use this when spawning child processes!
 * ensures project isolation is maintained fr fr
 *
 * This is an alias for getProjectEnv() with clearer naming
 * to make it obvious this should be used for spawn/exec calls
 */
export declare function getSpawnEnv(): Record<string, string | undefined>;
/**
 * Get only the project-specific environment variables (not full env)
 * Useful for MCP configs and team member configs
 */
export declare function getProjectEnvOnly(): Record<string, string>;
/**
 * Merge project environment with additional env vars
 * Use this when you need to add custom env vars while preserving project context
 */
export declare function mergeWithProjectEnv(additionalEnv: Record<string, string>): Record<string, string | undefined>;
/**
 * Log project info for debugging
 * Call this at startup to verify project path is set correctly
 */
export declare function logProjectInfo(logger?: {
    info: (obj: object, msg: string) => void;
}): void;
/**
 * Get the Python executable path for spawning Python processes
 *
 * Priority order:
 * 1. SPECMEM_PYTHON_PATH env var (explicit override)
 * 2. PYTHON_PATH env var (common convention)
 * 3. Virtual environment python (if VIRTUAL_ENV is set)
 * 4. Fallback to 'python3'
 *
 * Use this when spawning Python processes:
 * ```typescript
 * spawn(getPythonPath(), ['script.py'], { env: getSpawnEnv() });
 * ```
 */
export declare function getPythonPath(): string;
export { getProjectPath, getProjectHash, getProjectHashFull, getInstanceDir };
//# sourceMappingURL=projectEnv.d.ts.map