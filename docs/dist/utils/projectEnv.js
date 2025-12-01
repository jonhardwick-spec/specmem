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
export function ensureProjectEnv() {
    if (!process.env['SPECMEM_PROJECT_PATH']) {
        process.env['SPECMEM_PROJECT_PATH'] = process.cwd();
        console.warn('[SpecMem] SPECMEM_PROJECT_PATH not set, defaulting to cwd:', process.cwd());
    }
    // Also ensure the hash is computed and stored
    if (!process.env['SPECMEM_PROJECT_HASH']) {
        process.env['SPECMEM_PROJECT_HASH'] = getProjectHashFull();
    }
}
/**
 * Get environment variables to pass to child processes
 * This ensures all project-related env vars are inherited
 *
 * Use this when spawning child processes:
 * ```typescript
 * spawn('node', ['script.js'], { env: getProjectEnv() });
 * ```
 */
export function getProjectEnv() {
    return {
        ...process.env,
        // Explicit project environment variables
        SPECMEM_PROJECT_PATH: getProjectPath(),
        SPECMEM_PROJECT_HASH: getProjectHashFull(),
        SPECMEM_INSTANCE_DIR: getInstanceDir(),
    };
}
/**
 * getSpawnEnv - get env vars for child processes
 *
 * yooo ALWAYS use this when spawning child processes!
 * ensures project isolation is maintained fr fr
 *
 * This is an alias for getProjectEnv() with clearer naming
 * to make it obvious this should be used for spawn/exec calls
 */
export function getSpawnEnv() {
    return getProjectEnv();
}
/**
 * Get only the project-specific environment variables (not full env)
 * Useful for MCP configs and team member configs
 */
export function getProjectEnvOnly() {
    return {
        SPECMEM_PROJECT_PATH: getProjectPath(),
        SPECMEM_PROJECT_HASH: getProjectHashFull(),
        SPECMEM_INSTANCE_DIR: getInstanceDir(),
    };
}
/**
 * Merge project environment with additional env vars
 * Use this when you need to add custom env vars while preserving project context
 */
export function mergeWithProjectEnv(additionalEnv) {
    return {
        ...getProjectEnv(),
        ...additionalEnv,
    };
}
/**
 * Log project info for debugging
 * Call this at startup to verify project path is set correctly
 */
export function logProjectInfo(logger) {
    const info = {
        projectPath: getProjectPath(),
        projectHash: getProjectHash(),
        projectHashFull: getProjectHashFull(),
        instanceDir: getInstanceDir(),
        envWasSet: !!process.env['SPECMEM_PROJECT_PATH'],
    };
    if (logger) {
        logger.info(info, 'Project environment configuration');
    }
    else {
        console.log('[SpecMem] Project environment:', JSON.stringify(info, null, 2));
    }
}
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
export function getPythonPath() {
    // Priority 1: Explicit SpecMem override
    if (process.env['SPECMEM_PYTHON_PATH']) {
        return process.env['SPECMEM_PYTHON_PATH'];
    }
    // Priority 2: Common PYTHON_PATH convention
    if (process.env['PYTHON_PATH']) {
        return process.env['PYTHON_PATH'];
    }
    // Priority 3: Check for activated virtualenv
    const virtualEnv = process.env['VIRTUAL_ENV'];
    if (virtualEnv) {
        // venv python is at VIRTUAL_ENV/bin/python on Unix, VIRTUAL_ENV/Scripts/python.exe on Windows
        const isWindows = process.platform === 'win32';
        const venvPython = isWindows
            ? virtualEnv + '/Scripts/python.exe'
            : virtualEnv + '/bin/python';
        return venvPython;
    }
    // Priority 4: Fallback to system python3
    return 'python3';
}
// Re-export config functions for convenience
export { getProjectPath, getProjectHash, getProjectHashFull, getInstanceDir };
//# sourceMappingURL=projectEnv.js.map