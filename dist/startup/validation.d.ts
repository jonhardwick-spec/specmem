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
export declare const EXIT_CODES: {
    readonly SUCCESS: 0;
    readonly GENERAL_ERROR: 1;
    readonly ENV_VAR_MISSING: 2;
    readonly SOCKET_DIR_ERROR: 3;
    readonly SOCKET_DIR_NOT_WRITABLE: 4;
    readonly DATABASE_CONNECTION_ERROR: 5;
    readonly DATABASE_EXTENSION_ERROR: 6;
    readonly CONFIG_ERROR: 7;
    readonly PERMISSION_ERROR: 8;
};
export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];
export interface ValidationError {
    code: ExitCode;
    message: string;
    details?: string;
    suggestion?: string;
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: string[];
    duration: number;
}
export interface ValidationOptions {
    /** Check socket directories (fast) */
    checkSocketDirs?: boolean;
    /** Check environment variables (fast) */
    checkEnvVars?: boolean;
    /** Check database connection (slower, ~1-3s) */
    checkDatabase?: boolean;
    /** Check database extensions (requires DB connection) */
    checkDatabaseExtensions?: boolean;
    /** Timeout for database connection check in ms */
    dbTimeoutMs?: number;
    /** Log validation progress to startup log */
    logProgress?: boolean;
}
/**
 * Validate database credentials format and existence.
 * Fail fast with clear error if credentials are invalid format.
 *
 * TASK #21 FIX: Early validation of DB creds before connection attempt.
 * Exported for use by DatabaseManager and other modules that need early validation.
 */
export declare function validateDatabaseCredentials(): {
    errors: ValidationError[];
    warnings: string[];
};
/**
 * Run pre-flight validation checks before MCP transport connects.
 *
 * @param options Validation options
 * @returns Validation result with any errors and warnings
 */
export declare function runStartupValidation(options?: ValidationOptions): Promise<ValidationResult>;
/**
 * Format validation errors for console output.
 * Uses colors and clear formatting for readability.
 */
export declare function formatValidationErrors(result: ValidationResult): string;
/**
 * Run validation and exit if errors are found.
 * Used for blocking validation before MCP connects.
 */
export declare function validateOrExit(options?: ValidationOptions): Promise<void>;
/**
 * Quick validation that doesn't block startup.
 * Returns result for logging/monitoring without exiting.
 */
export declare function quickValidation(): Promise<ValidationResult>;
/**
 * Full validation including database.
 * Use after MCP transport is connected.
 */
export declare function fullValidation(): Promise<ValidationResult>;
//# sourceMappingURL=validation.d.ts.map