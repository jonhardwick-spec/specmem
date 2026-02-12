/**
 * SpecMem Startup Validation
 *
 * Pre-flight checks to catch issues early before MCP transport connects.
 * Validates:
 * - Socket directories exist and are writable
 * - Database connection works
 * - Required environment variables are set
 *
 * CRITICAL: These checks must be FAST (< 100ms total) to not delay MCP connection.
 * Heavy validation (like DB schema checks) is deferred to after transport connects.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
// ============================================================================
// EXIT CODES - Standard Unix conventions with SpecMem-specific meanings
// ============================================================================
export const EXIT_CODES = {
    SUCCESS: 0,
    GENERAL_ERROR: 1,
    ENV_VAR_MISSING: 2,
    SOCKET_DIR_ERROR: 3,
    SOCKET_DIR_NOT_WRITABLE: 4,
    DATABASE_CONNECTION_ERROR: 5,
    DATABASE_EXTENSION_ERROR: 6,
    CONFIG_ERROR: 7,
    PERMISSION_ERROR: 8,
};
const DEFAULT_OPTIONS = {
    checkSocketDirs: true,
    checkEnvVars: true,
    checkDatabase: false, // Deferred by default for fast startup
    checkDatabaseExtensions: false, // Deferred by default
    dbTimeoutMs: 5000,
    logProgress: true,
};
// ============================================================================
// STARTUP LOGGING (matches index.ts pattern)
// ============================================================================
// MULTI-PROJECT ISOLATION: SPECMEM_PROJECT_PATH is set at startup and NEVER changes
// REMOVED: Marker file - caused race condition with simultaneous projects!
function _getValidationProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
}
const _projectPath = _getValidationProjectPath();
const _projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] ||
    path.basename(_projectPath)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'default';
const _projectTmpDir = `/tmp/specmem-${_projectDirName}`;
// Ensure project tmp directory exists for logging
try {
    if (!existsSync(_projectTmpDir)) {
        mkdirSync(_projectTmpDir, { recursive: true, mode: 0o755 });
    }
}
catch {
    // Will be created on first log write
}
const STARTUP_LOG_PATH = `${_projectTmpDir}/mcp-startup.log`;
function validationLog(msg) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    const logLine = `${timestamp} [PID:${pid}] [validation.ts] ${msg}\n`;
    try {
        const { appendFileSync } = require('fs');
        appendFileSync(STARTUP_LOG_PATH, logLine);
    }
    catch {
        // Ignore - logging should never break validation
    }
}
// ============================================================================
// ENVIRONMENT VARIABLE VALIDATION
// ============================================================================
/**
 * Required environment variables for SpecMem to function.
 * These are checked during validation - all have defaults in config.ts
 * but we warn if critical ones are using defaults.
 */
const RECOMMENDED_ENV_VARS = [
    'SPECMEM_PASSWORD',
    'SPECMEM_DB_HOST',
    'SPECMEM_DB_PORT',
];
const OPTIONAL_ENV_VARS = [
    'SPECMEM_PROJECT_PATH',
    'SPECMEM_PROJECT_HASH',
    'SPECMEM_EMBEDDING_SOCKET',
    'SPECMEM_DASHBOARD_PORT',
    'SPECMEM_COORDINATION_PORT',
];
/**
 * Validate database credentials format and existence.
 * Fail fast with clear error if credentials are invalid format.
 *
 * TASK #21 FIX: Early validation of DB creds before connection attempt.
 * Exported for use by DatabaseManager and other modules that need early validation.
 */
export function validateDatabaseCredentials() {
    const errors = [];
    const warnings = [];
    // Get unified credential (SPECMEM_PASSWORD or default)
    const password = process.env['SPECMEM_PASSWORD'] || 'specmem';
    const dbUser = process.env['SPECMEM_DB_USER'] || password;
    const dbHost = process.env['SPECMEM_DB_HOST'] || 'localhost';
    const dbName = process.env['SPECMEM_DB_NAME'];
    // Validate password format - must not be empty or whitespace only
    if (!password || password.trim().length === 0) {
        errors.push({
            code: EXIT_CODES.CONFIG_ERROR,
            message: 'Database password is empty or whitespace only',
            details: 'SPECMEM_PASSWORD cannot be empty',
            suggestion: 'Set SPECMEM_PASSWORD to a valid password string',
        });
    }
    // Validate password doesn't contain problematic characters for PostgreSQL
    if (password && /[\x00-\x1f]/.test(password)) {
        errors.push({
            code: EXIT_CODES.CONFIG_ERROR,
            message: 'Database password contains control characters',
            details: 'SPECMEM_PASSWORD cannot contain control characters (ASCII 0-31)',
            suggestion: 'Remove control characters from SPECMEM_PASSWORD',
        });
    }
    // Validate user format - PostgreSQL usernames must be valid identifiers
    if (dbUser) {
        // PostgreSQL usernames: max 63 chars, start with letter/underscore, alphanumeric + underscore
        if (dbUser.length > 63) {
            errors.push({
                code: EXIT_CODES.CONFIG_ERROR,
                message: 'Database username too long',
                details: 'SPECMEM_DB_USER must be 63 characters or less',
                suggestion: 'Shorten SPECMEM_DB_USER to 63 characters or less',
            });
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbUser)) {
            warnings.push('Database username contains special characters - may cause connection issues');
        }
    }
    // Validate host format
    if (dbHost) {
        // Basic hostname/IP validation
        const isValidHostname = /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(dbHost);
        const isValidIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(dbHost);
        const isLocalhost = dbHost === 'localhost' || dbHost === '127.0.0.1';
        if (!isValidHostname && !isValidIP && !isLocalhost) {
            errors.push({
                code: EXIT_CODES.CONFIG_ERROR,
                message: 'Invalid database host format',
                details: 'SPECMEM_DB_HOST=' + dbHost + ' is not a valid hostname or IP',
                suggestion: 'Set SPECMEM_DB_HOST to a valid hostname (e.g., localhost) or IP address',
            });
        }
    }
    // Validate database name format if explicitly set
    if (dbName) {
        // PostgreSQL database names: max 63 chars
        if (dbName.length > 63) {
            errors.push({
                code: EXIT_CODES.CONFIG_ERROR,
                message: 'Database name too long',
                details: 'SPECMEM_DB_NAME must be 63 characters or less',
                suggestion: 'Shorten SPECMEM_DB_NAME to 63 characters or less',
            });
        }
        // Warn if contains characters that might cause issues
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
            warnings.push('Database name contains special characters - ensure it is properly quoted');
        }
    }
    return { errors, warnings };
}
function validateEnvVars() {
    const errors = [];
    const warnings = [];
    // Check for recommended environment variables
    for (const envVar of RECOMMENDED_ENV_VARS) {
        if (!process.env[envVar]) {
            // Not an error, but warn - defaults will be used
            warnings.push(envVar + ' not set - using default value');
        }
    }
    // Check if using default password (security concern)
    const password = process.env['SPECMEM_PASSWORD'];
    if (!password || password === 'specmem_westayunprofessional') {
        warnings.push('Using default password - consider setting SPECMEM_PASSWORD for production');
    }
    // TASK #21 FIX: Validate database credentials early - fail fast with clear error
    const credValidation = validateDatabaseCredentials();
    errors.push(...credValidation.errors);
    warnings.push(...credValidation.warnings);
    // Validate port numbers if set
    const portVars = [
        'SPECMEM_DB_PORT',
        'SPECMEM_DASHBOARD_PORT',
        'SPECMEM_COORDINATION_PORT',
        'SPECMEM_EMBEDDED_PG_PORT',
        'SPECMEM_EMBEDDED_PG_PORT_START',
        'SPECMEM_EMBEDDED_PG_PORT_END',
    ];
    for (const portVar of portVars) {
        const portValue = process.env[portVar];
        if (portValue) {
            const port = parseInt(portValue, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                errors.push({
                    code: EXIT_CODES.CONFIG_ERROR,
                    message: 'Invalid ' + portVar + ': "' + portValue + '"',
                    details: 'Port must be a number between 1 and 65535',
                    suggestion: 'Set ' + portVar + ' to a valid port number (e.g., ' + portVar + '=5432)',
                });
            }
        }
    }
    // Validate log level if set
    const logLevel = process.env['SPECMEM_LOG_LEVEL'];
    if (logLevel) {
        const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
        if (!validLevels.includes(logLevel.toLowerCase())) {
            errors.push({
                code: EXIT_CODES.CONFIG_ERROR,
                message: 'Invalid SPECMEM_LOG_LEVEL: "' + logLevel + '"',
                details: 'Must be one of: ' + validLevels.join(', '),
                suggestion: 'Set SPECMEM_LOG_LEVEL to a valid level (e.g., SPECMEM_LOG_LEVEL=info)',
            });
        }
    }
    return { errors, warnings };
}
// ============================================================================
// SOCKET DIRECTORY VALIDATION
// ============================================================================
/**
 * Get all socket directories that SpecMem might use.
 * These need to exist and be writable for Unix sockets.
 */
function getSocketDirectories() {
    const dirs = [];
    // Project-isolated tmp directory (primary)
    dirs.push(_projectTmpDir);
    dirs.push(path.join(_projectTmpDir, 'sockets'));
    // Instance directory for per-project isolation
    const instanceDir = path.join(os.homedir(), '.specmem', 'instances', _projectDirName);
    dirs.push(instanceDir);
    dirs.push(path.join(instanceDir, 'sockets'));
    // Run directory (legacy)
    const specmemRoot = process.env['SPECMEM_ROOT'] || process.cwd();
    dirs.push(path.join(specmemRoot, 'run'));
    // Home run directory
    const specmemHome = process.env['SPECMEM_HOME'] || path.join(os.homedir(), '.claude');
    dirs.push(path.join(specmemHome, 'run'));
    return dirs;
}
function validateSocketDirs() {
    const errors = [];
    const warnings = [];
    const socketDirs = getSocketDirectories();
    let atLeastOneWritable = false;
    for (const dir of socketDirs) {
        try {
            // Create directory if it doesn't exist
            if (!existsSync(dir)) {
                try {
                    mkdirSync(dir, { recursive: true, mode: 0o755 });
                    validationLog(`Created socket directory: ${dir}`);
                }
                catch (mkdirErr) {
                    // Can't create - not fatal, try next
                    warnings.push(`Cannot create directory ${dir}: ${mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)}`);
                    continue;
                }
            }
            // Check if writable by attempting to create a test file
            const testFile = path.join(dir, `.specmem-write-test-${process.pid}`);
            try {
                writeFileSync(testFile, 'test');
                unlinkSync(testFile);
                atLeastOneWritable = true;
                validationLog(`Socket directory writable: ${dir}`);
            }
            catch (writeErr) {
                warnings.push(`Directory not writable: ${dir}`);
            }
        }
        catch (err) {
            warnings.push(`Cannot access directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // At least one socket directory must be writable
    if (!atLeastOneWritable) {
        errors.push({
            code: EXIT_CODES.SOCKET_DIR_NOT_WRITABLE,
            message: 'No writable socket directory found',
            details: `Checked directories: ${socketDirs.slice(0, 3).join(', ')}...`,
            suggestion: 'Ensure the process has write permissions to /tmp or ~/.specmem/instances/',
        });
    }
    return { errors, warnings };
}
function getDatabaseConfigFromEnv() {
    // Compute project-specific values (matches config.ts logic)
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    const projectHash = process.env['SPECMEM_PROJECT_HASH'] ||
        createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 12);
    const defaultPassword = 'specmem_westayunprofessional';
    const password = process.env['SPECMEM_PASSWORD'] || defaultPassword;
    // Project-specific database name
    const dbName = process.env['SPECMEM_DB_NAME'] || `specmem_${projectHash}`;
    // Project-specific port (for embedded postgres)
    let port = parseInt(process.env['SPECMEM_DB_PORT'] || '5432', 10);
    if (process.env['SPECMEM_EMBEDDED_PG_ACTIVE'] === 'true') {
        const hashNum = parseInt(projectHash.slice(0, 4), 16);
        port = 5500 + (hashNum % 100);
    }
    return {
        host: process.env['SPECMEM_DB_HOST'] || 'localhost',
        port,
        database: dbName,
        user: password, // Uses unified credential
        password: password,
    };
}
async function validateDatabase(timeoutMs) {
    const errors = [];
    const warnings = [];
    const dbConfig = getDatabaseConfigFromEnv();
    validationLog(`Testing database connection: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
    try {
        // Dynamic import to avoid loading pg until needed
        const pg = await import('pg');
        const { Pool } = pg.default || pg;
        const pool = new Pool({
            host: dbConfig.host,
            port: dbConfig.port,
            database: dbConfig.database,
            user: dbConfig.user,
            password: dbConfig.password,
            connectionTimeoutMillis: timeoutMs,
            max: 1, // Single connection for validation
        });
        // MED-30 FIX: Track timeout handle to properly clear it and prevent promise leak
        let timeoutHandle = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let client = null;
        try {
            // Create a timeout promise with clearable handle
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`Database connection timeout (${timeoutMs}ms)`));
                }, timeoutMs);
            });
            // Race between connection and timeout
            client = await Promise.race([
                pool.connect(),
                timeoutPromise,
            ]);
            // MED-30 FIX: Clear timeout immediately after connection succeeds
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            // Basic connectivity test
            await client.query('SELECT 1');
            validationLog('Database connection successful');
            // Check if pgvector extension exists (important for SpecMem)
            const extResult = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
            if (extResult.rows.length === 0) {
                warnings.push('pgvector extension not installed - will be created on first use');
            }
        }
        finally {
            // MED-30 FIX: Always clear the timeout in finally block to prevent leak
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            if (client) {
                client.release();
            }
            await pool.end();
        }
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Categorize the error
        if (errMsg.includes('ECONNREFUSED')) {
            errors.push({
                code: EXIT_CODES.DATABASE_CONNECTION_ERROR,
                message: `Cannot connect to PostgreSQL at ${dbConfig.host}:${dbConfig.port}`,
                details: errMsg,
                suggestion: `Ensure PostgreSQL is running: sudo systemctl start postgresql or docker start specmem-postgres`,
            });
        }
        else if (errMsg.includes('authentication failed') || errMsg.includes('password')) {
            errors.push({
                code: EXIT_CODES.DATABASE_CONNECTION_ERROR,
                message: `PostgreSQL authentication failed for user "${dbConfig.user}"`,
                details: errMsg,
                suggestion: `Check SPECMEM_PASSWORD or SPECMEM_DB_USER/SPECMEM_DB_PASSWORD environment variables`,
            });
        }
        else if (errMsg.includes('does not exist')) {
            // Database doesn't exist - this is OK, will be created
            warnings.push(`Database "${dbConfig.database}" does not exist - will be created on first use`);
        }
        else if (errMsg.includes('timeout')) {
            errors.push({
                code: EXIT_CODES.DATABASE_CONNECTION_ERROR,
                message: `Database connection timeout after ${timeoutMs}ms`,
                details: `Host: ${dbConfig.host}:${dbConfig.port}, Database: ${dbConfig.database}`,
                suggestion: `Check if PostgreSQL is running and accessible, or increase timeout`,
            });
        }
        else {
            errors.push({
                code: EXIT_CODES.DATABASE_CONNECTION_ERROR,
                message: `Database connection error`,
                details: errMsg,
                suggestion: `Check database configuration: host=${dbConfig.host}, port=${dbConfig.port}, database=${dbConfig.database}`,
            });
        }
    }
    return { errors, warnings };
}
// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================
/**
 * Run pre-flight validation checks before MCP transport connects.
 *
 * @param options Validation options
 * @returns Validation result with any errors and warnings
 */
export async function runStartupValidation(options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    const allErrors = [];
    const allWarnings = [];
    if (opts.logProgress) {
        validationLog('Starting pre-flight validation checks...');
    }
    // 1. Environment variables (fast)
    if (opts.checkEnvVars) {
        const { errors, warnings } = validateEnvVars();
        allErrors.push(...errors);
        allWarnings.push(...warnings);
        if (opts.logProgress && errors.length > 0) {
            validationLog(`Environment validation: ${errors.length} errors`);
        }
    }
    // 2. Socket directories (fast)
    if (opts.checkSocketDirs) {
        const { errors, warnings } = validateSocketDirs();
        allErrors.push(...errors);
        allWarnings.push(...warnings);
        if (opts.logProgress && errors.length > 0) {
            validationLog(`Socket directory validation: ${errors.length} errors`);
        }
    }
    // 3. Database connection (slower - only if requested)
    if (opts.checkDatabase) {
        const { errors, warnings } = await validateDatabase(opts.dbTimeoutMs);
        allErrors.push(...errors);
        allWarnings.push(...warnings);
        if (opts.logProgress && errors.length > 0) {
            validationLog(`Database validation: ${errors.length} errors`);
        }
    }
    const duration = Date.now() - startTime;
    if (opts.logProgress) {
        validationLog(`Validation complete in ${duration}ms: ${allErrors.length} errors, ${allWarnings.length} warnings`);
    }
    return {
        valid: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings,
        duration,
    };
}
/**
 * Format validation errors for console output.
 * Uses colors and clear formatting for readability.
 */
export function formatValidationErrors(result) {
    const lines = [];
    // Colors for terminal output
    const c = {
        reset: '\x1b[0m',
        red: '\x1b[31m',
        yellow: '\x1b[33m',
        green: '\x1b[32m',
        cyan: '\x1b[36m',
        dim: '\x1b[2m',
        bright: '\x1b[1m',
    };
    if (!result.valid) {
        lines.push('');
        lines.push(`${c.red}${c.bright}===== SPECMEM STARTUP VALIDATION FAILED =====${c.reset}`);
        lines.push('');
        for (const error of result.errors) {
            lines.push(`${c.red}ERROR [${error.code}]:${c.reset} ${error.message}`);
            if (error.details) {
                lines.push(`  ${c.dim}Details: ${error.details}${c.reset}`);
            }
            if (error.suggestion) {
                lines.push(`  ${c.cyan}Suggestion: ${error.suggestion}${c.reset}`);
            }
            lines.push('');
        }
        lines.push(`${c.red}Fix the above errors and restart SpecMem.${c.reset}`);
        lines.push('');
    }
    if (result.warnings.length > 0) {
        if (result.valid) {
            lines.push('');
        }
        lines.push(`${c.yellow}Warnings:${c.reset}`);
        for (const warning of result.warnings) {
            lines.push(`  ${c.yellow}- ${warning}${c.reset}`);
        }
        lines.push('');
    }
    if (result.valid && result.warnings.length === 0) {
        lines.push(`${c.green}Pre-flight checks passed${c.reset} ${c.dim}(${result.duration}ms)${c.reset}`);
    }
    return lines.join('\n');
}
/**
 * Run validation and exit if errors are found.
 * Used for blocking validation before MCP connects.
 */
export async function validateOrExit(options) {
    const result = await runStartupValidation(options);
    // Always log to startup log file
    validationLog(`Validation result: valid=${result.valid}, errors=${result.errors.length}, warnings=${result.warnings.length}`);
    if (!result.valid) {
        // Write formatted errors to stderr
        process.stderr.write(formatValidationErrors(result));
        // Get the first error code for the exit
        const exitCode = result.errors[0]?.code || EXIT_CODES.GENERAL_ERROR;
        validationLog(`Exiting with code ${exitCode} due to validation errors`);
        // LOW-31 FIX: Call cleanup before exit to prevent resource leaks
        // Import cleanup handler dynamically to avoid circular deps
        try {
            const { runAllCleanups } = await import('../utils/cleanupHandler.js');
            await runAllCleanups();
        }
        catch {
            // Cleanup module may not be available during early startup validation
        }
        process.exit(exitCode);
    }
    // Log warnings if any
    if (result.warnings.length > 0) {
        process.stderr.write(formatValidationErrors(result));
    }
}
/**
 * Quick validation that doesn't block startup.
 * Returns result for logging/monitoring without exiting.
 */
export async function quickValidation() {
    return runStartupValidation({
        checkSocketDirs: true,
        checkEnvVars: true,
        checkDatabase: false, // Skip DB for speed
        logProgress: true,
    });
}
/**
 * Full validation including database.
 * Use after MCP transport is connected.
 */
export async function fullValidation() {
    return runStartupValidation({
        checkSocketDirs: true,
        checkEnvVars: true,
        checkDatabase: true,
        checkDatabaseExtensions: true,
        dbTimeoutMs: 10000,
        logProgress: true,
    });
}
//# sourceMappingURL=validation.js.map