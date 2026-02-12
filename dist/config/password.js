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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { getSpecmemRoot } from '../config.js';
// Default password - maintaining backwards compatibility
const DEFAULT_PASSWORD = 'specmem_westayunprofessional';
// Minimum password requirements
const MIN_PASSWORD_LENGTH = 8;
/**
 * Runtime password state - allows dynamic updates without restart
 */
let runtimePassword = null;
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
export function getPassword() {
    // Runtime override takes precedence
    if (runtimePassword !== null) {
        return runtimePassword;
    }
    // Check unified env var first (recommended)
    const unified = process.env['SPECMEM_PASSWORD'];
    if (unified) {
        return unified;
    }
    // Fall back to legacy dashboard password
    const dashboard = process.env['SPECMEM_DASHBOARD_PASSWORD'];
    if (dashboard) {
        return dashboard;
    }
    // Fall back to legacy API password
    const api = process.env['SPECMEM_API_PASSWORD'];
    if (api) {
        return api;
    }
    // Use default
    return DEFAULT_PASSWORD;
}
/**
 * Get full password configuration including source information
 *
 * @returns PasswordConfig object with password and metadata
 */
export function getPasswordConfig() {
    // Runtime override takes precedence
    if (runtimePassword !== null) {
        return {
            password: runtimePassword,
            source: 'runtime',
            allowRuntimeChange: true
        };
    }
    // Check unified env var first (recommended)
    const unified = process.env['SPECMEM_PASSWORD'];
    if (unified) {
        return {
            password: unified,
            source: 'SPECMEM_PASSWORD',
            allowRuntimeChange: true
        };
    }
    // Fall back to legacy dashboard password
    const dashboard = process.env['SPECMEM_DASHBOARD_PASSWORD'];
    if (dashboard) {
        return {
            password: dashboard,
            source: 'SPECMEM_DASHBOARD_PASSWORD',
            allowRuntimeChange: true
        };
    }
    // Fall back to legacy API password
    const api = process.env['SPECMEM_API_PASSWORD'];
    if (api) {
        return {
            password: api,
            source: 'SPECMEM_API_PASSWORD',
            allowRuntimeChange: true
        };
    }
    // Use default
    return {
        password: DEFAULT_PASSWORD,
        source: 'default',
        allowRuntimeChange: true
    };
}
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
export function validatePassword(password) {
    const errors = [];
    if (!password) {
        errors.push('Password cannot be empty');
        return { valid: false, errors };
    }
    if (password.trim() !== password) {
        errors.push('Password cannot have leading or trailing whitespace');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
/**
 * Set the password at runtime (in-memory only)
 *
 * This updates the password in memory but does NOT persist to env file.
 * Use persistPasswordToEnv() to also save to disk.
 *
 * @param newPassword - The new password to set
 * @returns PasswordValidationResult indicating success or validation errors
 */
export function setPassword(newPassword) {
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
        return validation;
    }
    runtimePassword = newPassword;
    logger.info('Password updated in runtime memory');
    return { valid: true, errors: [] };
}
/**
 * Clear runtime password override, reverting to env var or default
 */
export function clearRuntimePassword() {
    runtimePassword = null;
    logger.info('Runtime password cleared, reverting to env/default');
}
/**
 * Check if a given password matches the current password
 *
 * @param password - The password to check
 * @returns true if password matches, false otherwise
 */
export function checkPassword(password) {
    return password === getPassword();
}
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
export async function persistPasswordToEnv(newPassword, envFilePath) {
    // Validate first
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
        logger.warn({ errors: validation.errors }, 'Cannot persist invalid password');
        return false;
    }
    // Try common env file locations - include specmem directory explicitly
    const envPaths = [
        envFilePath,
        path.join(getSpecmemRoot(), '.env'),
        path.join(getSpecmemRoot(), 'specmem.env'),
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), 'specmem.env'),
    ].filter(Boolean);
    for (const envPath of envPaths) {
        try {
            if (!fs.existsSync(envPath)) {
                continue;
            }
            let content = fs.readFileSync(envPath, 'utf-8');
            let updated = false;
            // Update ALL password variables found in the file
            // SPECMEM_PASSWORD (unified, preferred)
            if (content.includes('SPECMEM_PASSWORD=')) {
                content = content.replace(/SPECMEM_PASSWORD=.*/g, `SPECMEM_PASSWORD=${newPassword}`);
                updated = true;
            }
            // SPECMEM_DASHBOARD_PASSWORD (legacy, common)
            if (content.includes('SPECMEM_DASHBOARD_PASSWORD=')) {
                content = content.replace(/SPECMEM_DASHBOARD_PASSWORD=.*/g, `SPECMEM_DASHBOARD_PASSWORD=${newPassword}`);
                updated = true;
            }
            // SPECMEM_API_PASSWORD (legacy, API-specific)
            if (content.includes('SPECMEM_API_PASSWORD=')) {
                content = content.replace(/SPECMEM_API_PASSWORD=.*/g, `SPECMEM_API_PASSWORD=${newPassword}`);
                updated = true;
            }
            if (updated) {
                fs.writeFileSync(envPath, content, 'utf-8');
                logger.info({ envPath }, 'Password persisted to env file');
                return true;
            }
        }
        catch (error) {
            logger.debug({ error, envPath }, 'Could not update env file');
        }
    }
    logger.warn('No suitable env file found for password persistence');
    return false;
}
/**
 * Change password with full validation, runtime update, and optional persistence
 *
 * @param currentPassword - The current password (for verification)
 * @param newPassword - The new password to set
 * @param persist - Whether to persist to env file (default: true)
 * @returns Object with success status and message
 */
export async function changePassword(currentPassword, newPassword, persist = true) {
    // Verify current password
    if (!checkPassword(currentPassword)) {
        return {
            success: false,
            message: 'Current password is incorrect'
        };
    }
    // Validate new password
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
        return {
            success: false,
            message: validation.errors.join('; ')
        };
    }
    // Set in runtime
    const setResult = setPassword(newPassword);
    if (!setResult.valid) {
        return {
            success: false,
            message: setResult.errors.join('; ')
        };
    }
    // Optionally persist to env file
    let persisted = false;
    if (persist) {
        persisted = await persistPasswordToEnv(newPassword);
    }
    logger.info({ persisted }, 'Password changed successfully');
    return {
        success: true,
        message: persisted
            ? 'Password changed and saved to config'
            : 'Password changed (in-memory only)',
        persisted
    };
}
/**
 * Get the default password value
 * Useful for documentation and testing
 */
export function getDefaultPassword() {
    return DEFAULT_PASSWORD;
}
/**
 * Check if the current password is the default
 * Useful for security warnings
 */
export function isUsingDefaultPassword() {
    return getPassword() === DEFAULT_PASSWORD;
}
/**
 * Get minimum password length requirement
 */
export function getMinPasswordLength() {
    return MIN_PASSWORD_LENGTH;
}
// ============================================================================
// TeamMember Notification System (Added by Opus-2 for credential rotation)
// ============================================================================
/**
 * Update team member injection hook file with new password
 * This ensures newly spawned team members get the correct password
 */
export async function updateTeamMemberHook(newPassword) {
    const hookFilePath = path.join(os.homedir(), '.claude', 'hooks', 'specmem-team-member-inject.js');
    try {
        if (!fs.existsSync(hookFilePath)) {
            logger.debug({ hookFilePath }, 'Team Member hook file not found - skipping update');
            return false;
        }
        let hookContent = fs.readFileSync(hookFilePath, 'utf-8');
        // Replace the password in the CONFIG object
        // Pattern: specmemPassword: process.env.SPECMEM_DASHBOARD_PASSWORD || 'something'
        const updatedContent = hookContent.replace(/specmemPassword:\s*process\.env\.SPECMEM_DASHBOARD_PASSWORD\s*\|\|\s*'[^']*'/, `specmemPassword: process.env.SPECMEM_DASHBOARD_PASSWORD || '${newPassword}'`);
        if (updatedContent === hookContent) {
            // Try alternate pattern without env var
            const altUpdated = hookContent.replace(/specmemPassword:\s*'[^']*'/, `specmemPassword: process.env.SPECMEM_DASHBOARD_PASSWORD || '${newPassword}'`);
            if (altUpdated !== hookContent) {
                fs.writeFileSync(hookFilePath, altUpdated, 'utf-8');
                logger.info({ hookFilePath }, 'Updated team member hook with new password (alt pattern)');
                return true;
            }
            logger.warn('Team Member hook password pattern not found - hook may need manual update');
            return false;
        }
        fs.writeFileSync(hookFilePath, updatedContent, 'utf-8');
        logger.info({ hookFilePath }, 'Updated team member hook with new password');
        return true;
    }
    catch (error) {
        logger.warn({ error, hookFilePath }, 'Failed to update team member hook file');
        return false;
    }
}
/**
 * Notify active team members about password change via HTTP messaging API
 * TeamMembers should re-authenticate with the new password
 */
export async function notifyTeamMembersOfPasswordChange() {
    const port = process.env['SPECMEM_DASHBOARD_PORT'] || '8595';
    const host = process.env['SPECMEM_DASHBOARD_HOST'] || 'localhost';
    try {
        // Get list of active team members
        const activeResponse = await fetch(`http://${host}:${port}/api/specmem/team-member/active?withinSeconds=300`);
        if (!activeResponse.ok) {
            logger.debug('Could not fetch active team members for password notification');
            return 0;
        }
        const activeData = await activeResponse.json();
        const teamMembers = activeData.teamMembers || [];
        if (teamMembers.length === 0) {
            return 0;
        }
        // Broadcast password change notification to all team members
        let notified = 0;
        for (const teamMember of teamMembers) {
            try {
                const msgResponse = await fetch(`http://${host}:${port}/api/specmem/team-member/message`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'system-password-manager',
                        to: teamMember.teamMemberId,
                        message: JSON.stringify({
                            type: 'SYSTEM_PASSWORD_CHANGED',
                            timestamp: new Date().toISOString(),
                            action: 'RE_AUTHENTICATE',
                            instruction: 'Dashboard password has changed. Your existing session cookie may be invalid. Please re-login using the new password.',
                            priority: 'critical'
                        }),
                        priority: 'high'
                    })
                });
                if (msgResponse.ok) {
                    notified++;
                }
            }
            catch {
                // Individual team member notification failed, continue with others
            }
        }
        logger.info({ notified, total: teamMembers.length }, 'Notified team members of password change');
        return notified;
    }
    catch (err) {
        logger.debug({ err }, 'Could not notify team members via HTTP API');
        return 0;
    }
}
/**
 * Full password change with team member notification and hook update
 * This is the recommended method for password changes from the dashboard
 */
export async function changePasswordWithTeamMemberNotification(currentPassword, newPassword, persist = true) {
    // First perform the base password change
    const result = await changePassword(currentPassword, newPassword, persist);
    if (!result.success) {
        return result;
    }
    // Update team member injection hook
    let hookUpdated = false;
    try {
        hookUpdated = await updateTeamMemberHook(newPassword);
    }
    catch (err) {
        logger.warn({ err }, 'Failed to update team member hook');
    }
    // Notify active team members
    let teamMembersNotified = 0;
    try {
        teamMembersNotified = await notifyTeamMembersOfPasswordChange();
    }
    catch (err) {
        logger.warn({ err }, 'Failed to notify team members of password change');
    }
    return {
        ...result,
        hookUpdated,
        teamMembersNotified
    };
}
//# sourceMappingURL=password.js.map