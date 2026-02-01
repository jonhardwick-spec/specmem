/**
 * password.ts - Centralized Password Management for SpecMem
 *
 * This module provides unified password management across all SpecMem components:
 * - Dashboard login authentication
 * - TeamMember HTTP API authentication
 * - MCP server authentication
 *
 * Environment Variable Priority (highest to lowest):
 * 1. SPECMEM_PASSWORD (unified, recommended)
 * 2. SPECMEM_DASHBOARD_PASSWORD (legacy, for dashboard)
 * 3. SPECMEM_API_PASSWORD (legacy, for API)
 * 4. Default: "specmem_westayunprofessional"
 *
 * @author hardwicksoftwareservices
 */
/**
 * Password validation result
 */
export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Password configuration options
 */
export interface PasswordConfig {
    /** The current password value */
    password: string;
    /** Source of the password (env var name or 'runtime' or 'default') */
    source: string;
    /** Whether password can be changed at runtime */
    allowRuntimeChange: boolean;
}
/**
 * Get the current password from environment or runtime state
 *
 * Priority order:
 * 1. Runtime password (if set via setPassword())
 * 2. SPECMEM_PASSWORD env var (unified)
 * 3. SPECMEM_DASHBOARD_PASSWORD env var (legacy)
 * 4. SPECMEM_API_PASSWORD env var (legacy)
 * 5. Default password
 *
 * @returns The current password string
 */
export declare function getPassword(): string;
/**
 * Get full password configuration including source information
 *
 * @returns PasswordConfig object with password and metadata
 */
export declare function getPasswordConfig(): PasswordConfig;
/**
 * Validate a password against security requirements
 *
 * Requirements:
 * - Minimum 8 characters
 * - Not empty or whitespace only
 *
 * @param password - The password to validate
 * @returns PasswordValidationResult with valid flag and error messages
 */
export declare function validatePassword(password: string): PasswordValidationResult;
/**
 * Set the password at runtime (in-memory only)
 *
 * This updates the password in memory but does NOT persist to env file.
 * Use persistPasswordToEnv() to also save to disk.
 *
 * @param newPassword - The new password to set
 * @returns PasswordValidationResult indicating success or validation errors
 */
export declare function setPassword(newPassword: string): PasswordValidationResult;
/**
 * Clear runtime password override, reverting to env var or default
 */
export declare function clearRuntimePassword(): void;
/**
 * Check if a given password matches the current password
 *
 * @param password - The password to check
 * @returns true if password matches, false otherwise
 */
export declare function checkPassword(password: string): boolean;
/**
 * Persist password change to environment file
 *
 * Searches for .env or specmem.env files and updates SPECMEM_PASSWORD
 * (or SPECMEM_DASHBOARD_PASSWORD for backwards compatibility)
 *
 * @param newPassword - The new password to persist
 * @param envFilePath - Optional specific env file path to update
 * @returns true if successfully persisted, false otherwise
 */
export declare function persistPasswordToEnv(newPassword: string, envFilePath?: string): Promise<boolean>;
/**
 * Change password with full validation, runtime update, and optional persistence
 *
 * @param currentPassword - The current password (for verification)
 * @param newPassword - The new password to set
 * @param persist - Whether to persist to env file (default: true)
 * @returns Object with success status and message
 */
export declare function changePassword(currentPassword: string, newPassword: string, persist?: boolean): Promise<{
    success: boolean;
    message: string;
    persisted?: boolean;
}>;
/**
 * Get the default password value
 * Useful for documentation and testing
 */
export declare function getDefaultPassword(): string;
/**
 * Check if the current password is the default
 * Useful for security warnings
 */
export declare function isUsingDefaultPassword(): boolean;
/**
 * Get minimum password length requirement
 */
export declare function getMinPasswordLength(): number;
/**
 * Update team member injection hook file with new password
 * This ensures newly spawned team members get the correct password
 */
export declare function updateTeamMemberHook(newPassword: string): Promise<boolean>;
/**
 * Notify active team members about password change via HTTP messaging API
 * TeamMembers should re-authenticate with the new password
 */
export declare function notifyTeamMembersOfPasswordChange(): Promise<number>;
/**
 * Full password change with team member notification and hook update
 * This is the recommended method for password changes from the dashboard
 */
export declare function changePasswordWithTeamMemberNotification(currentPassword: string, newPassword: string, persist?: boolean): Promise<{
    success: boolean;
    message: string;
    persisted?: boolean;
    hookUpdated?: boolean;
    teamMembersNotified?: number;
}>;
//# sourceMappingURL=password.d.ts.map