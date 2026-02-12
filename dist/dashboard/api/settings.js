/**
 * settings.ts - Dashboard Settings API
 *
 * Handles dashboard configuration including password management
 * and dashboard mode/binding configuration with persistence.
 */
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getPasswordConfig, validatePassword, changePasswordWithTeamMemberNotification, getMinPasswordLength, isUsingDefaultPassword, getDefaultPassword, checkPassword } from '../../config/password.js';
import { persistDashboardMode, loadInstanceConfig, cleanupOldBackups, getLocalSpecMemDir } from '../../config/autoConfig.js';
import { getDashboardServer } from '../webServer.js';
// ============================================================================
// Validation Schemas
// ============================================================================
const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
    message: "New password and confirmation don't match",
    path: ['confirmPassword']
});
const DashboardModeSchema = z.object({
    mode: z.enum(['private', 'public']),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    password: z.string().min(8).optional(),
    autoRebind: z.boolean().optional().default(false),
    rebindDelayMs: z.number().int().min(0).max(30000).optional().default(2000)
});
// ============================================================================
// Router Factory
// ============================================================================
export function createSettingsRouter(requireAuth) {
    const router = Router();
    /**
     * GET /api/settings/password/status
     * Get current password configuration status (not the actual password!)
     */
    router.get('/password/status', requireAuth, async (req, res) => {
        try {
            const config = getPasswordConfig();
            res.json({
                success: true,
                passwordStatus: {
                    source: config.source,
                    isDefault: isUsingDefaultPassword(),
                    minLength: getMinPasswordLength(),
                    allowRuntimeChange: config.allowRuntimeChange
                },
                message: isUsingDefaultPassword()
                    ? 'WARNING: Using default password - please change it!'
                    : 'Password configured from ' + config.source
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching password status');
            res.status(500).json({ success: false, error: 'Failed to fetch password status' });
        }
    });
    /**
     * POST /api/settings/password/change
     * Change the dashboard password
     */
    router.post('/password/change', requireAuth, async (req, res) => {
        try {
            // Validate request body
            const parseResult = ChangePasswordSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: parseResult.error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
                return;
            }
            const { currentPassword, newPassword } = parseResult.data;
            // Additional validation
            const passwordValidation = validatePassword(newPassword);
            if (!passwordValidation.valid) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid new password',
                    details: passwordValidation.errors
                });
                return;
            }
            // Perform password change with team member notification
            const result = await changePasswordWithTeamMemberNotification(currentPassword, newPassword, true // persist to env file
            );
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: result.message
                });
                return;
            }
            logger.info({
                persisted: result.persisted,
                hookUpdated: result.hookUpdated,
                teamMembersNotified: result.teamMembersNotified
            }, 'Password changed via dashboard API');
            res.json({
                success: true,
                message: 'Password changed successfully',
                details: {
                    envFileUpdated: result.persisted || false,
                    teamMemberHookUpdated: result.hookUpdated || false,
                    teamMembersNotified: result.teamMembersNotified || 0
                },
                note: 'Existing sessions remain valid. New logins will require the new password.'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error changing password via API');
            res.status(500).json({ success: false, error: 'Failed to change password' });
        }
    });
    /**
     * POST /api/settings/password/validate
     * Validate a potential new password (without changing it)
     */
    router.post('/password/validate', requireAuth, async (req, res) => {
        try {
            const { password } = req.body;
            if (!password) {
                res.status(400).json({
                    success: false,
                    error: 'Password is required for validation'
                });
                return;
            }
            const validation = validatePassword(password);
            // Calculate strength
            let strength = 'weak';
            const hasLowercase = /[a-z]/.test(password);
            const hasUppercase = /[A-Z]/.test(password);
            const hasNumbers = /[0-9]/.test(password);
            const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
            const typesCount = [hasLowercase, hasUppercase, hasNumbers, hasSpecial].filter(Boolean).length;
            if (password.length >= 16 && typesCount >= 3) {
                strength = 'strong';
            }
            else if (password.length >= 12 && typesCount >= 2) {
                strength = 'medium';
            }
            res.json({
                success: true,
                validation: {
                    valid: validation.valid,
                    errors: validation.errors,
                    strength,
                    length: password.length,
                    requirements: {
                        minLength: getMinPasswordLength(),
                        hasLowercase,
                        hasUppercase,
                        hasNumbers,
                        hasSpecial
                    }
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error validating password');
            res.status(500).json({ success: false, error: 'Failed to validate password' });
        }
    });
    /**
     * POST /api/settings/password/reset-to-default
     * Reset password to the default value
     *
     * WARNING: This should only be used for troubleshooting.
     * The default password is publicly known and insecure.
     */
    router.post('/password/reset-to-default', requireAuth, async (req, res) => {
        try {
            const { currentPassword } = req.body;
            if (!currentPassword) {
                res.status(400).json({
                    success: false,
                    error: 'Current password is required'
                });
                return;
            }
            // Verify current password
            if (!checkPassword(currentPassword)) {
                res.status(401).json({
                    success: false,
                    error: 'Current password is incorrect'
                });
                return;
            }
            // Get the default password
            const defaultPassword = getDefaultPassword();
            // Check if already using default
            if (isUsingDefaultPassword()) {
                res.status(400).json({
                    success: false,
                    error: 'Already using the default password'
                });
                return;
            }
            // Perform password change to default
            const result = await changePasswordWithTeamMemberNotification(currentPassword, defaultPassword, true // persist to env file
            );
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: result.message
                });
                return;
            }
            logger.warn({
                persisted: result.persisted,
                hookUpdated: result.hookUpdated,
                teamMembersNotified: result.teamMembersNotified
            }, 'Password reset to default via dashboard API - SECURITY WARNING');
            res.json({
                success: true,
                message: 'Password reset to default successfully',
                warning: 'The default password is publicly known. Please change it for security.',
                details: {
                    envFileUpdated: result.persisted || false,
                    teamMemberHookUpdated: result.hookUpdated || false,
                    teamMembersNotified: result.teamMembersNotified || 0
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error resetting password to default');
            res.status(500).json({ success: false, error: 'Failed to reset password' });
        }
    });
    // ============================================================================
    // Dashboard Configuration Endpoints
    // ============================================================================
    /**
     * GET /api/settings/dashboard/config
     * Get current dashboard configuration
     */
    router.get('/dashboard/config', requireAuth, async (req, res) => {
        try {
            const dashboard = getDashboardServer();
            const status = dashboard.getStatus();
            const instanceConfig = await loadInstanceConfig();
            res.json({
                success: true,
                config: {
                    mode: dashboard.getMode(),
                    host: dashboard.getHost(),
                    port: status.port,
                    configuredPort: status.configuredPort,
                    running: status.running,
                    uptime: status.uptime
                },
                persisted: {
                    dashboardMode: instanceConfig?.dashboardMode,
                    dashboardHost: instanceConfig?.dashboardHost,
                    dashboardPort: instanceConfig?.dashboardPort,
                    lastConfigUpdate: instanceConfig?.lastConfigUpdate,
                    configVersion: instanceConfig?.configVersion
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching dashboard config');
            res.status(500).json({ success: false, error: 'Failed to fetch dashboard config' });
        }
    });
    /**
     * POST /api/settings/dashboard/mode
     * Change dashboard mode (private/public) with persistence
     *
     * This updates:
     * - .specmem/instance.json
     * - specmem.env
     * - process.env (for immediate effect where possible)
     *
     * Mode changes require server rebind (different host binding)
     */
    router.post('/dashboard/mode', requireAuth, async (req, res) => {
        try {
            // Validate request body
            const parseResult = DashboardModeSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: parseResult.error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
                return;
            }
            const { mode, host, port, password, autoRebind, rebindDelayMs } = parseResult.data;
            // Validate public mode requirements
            if (mode === 'public') {
                // Warn if using default password in public mode
                if (isUsingDefaultPassword() && !password) {
                    res.status(400).json({
                        success: false,
                        error: 'Cannot enable public mode with default password',
                        details: ['Please set a strong password before enabling public mode']
                    });
                    return;
                }
            }
            // Build config for persistence
            const modeConfig = {
                mode,
                host: mode === 'public' ? (host || '0.0.0.0') : undefined,
                port,
                password
            };
            // Persist to files
            const persistResult = await persistDashboardMode(modeConfig);
            if (!persistResult.success) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to persist configuration',
                    details: persistResult.message
                });
                return;
            }
            // Update the running server config
            const dashboard = getDashboardServer();
            const updateResult = await dashboard.updateConfig({
                mode,
                host: mode === 'public' ? (host || '0.0.0.0') : '127.0.0.1',
                port,
                password
            });
            logger.info({
                mode,
                host,
                port,
                persistResult,
                updateResult,
                autoRebind
            }, 'Dashboard mode change requested');
            // Auto-rebind if requested and required
            if (autoRebind && updateResult.requiresRebind) {
                // Respond before rebind (connection will be lost during rebind)
                res.json({
                    success: true,
                    message: 'Configuration saved. Server is restarting...',
                    persisted: persistResult.changedFields,
                    requiresRebind: true,
                    rebindScheduled: true,
                    rebindDelayMs,
                    note: 'Connection will be briefly interrupted during rebind'
                });
                // Schedule rebind after response is sent
                setImmediate(async () => {
                    try {
                        await dashboard.scheduleRebind(rebindDelayMs);
                    }
                    catch (err) {
                        logger.error({ err }, 'Auto-rebind failed');
                    }
                });
                return;
            }
            res.json({
                success: true,
                message: persistResult.message,
                persisted: persistResult.changedFields,
                requiresRebind: updateResult.requiresRebind,
                appliedChanges: updateResult.appliedChanges,
                note: updateResult.requiresRebind
                    ? 'Server restart required to apply binding changes. Use POST /api/settings/dashboard/rebind'
                    : 'Changes applied immediately'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error changing dashboard mode');
            res.status(500).json({ success: false, error: 'Failed to change dashboard mode' });
        }
    });
    /**
     * POST /api/settings/dashboard/rebind
     * Trigger a graceful server rebind
     *
     * This restarts the HTTP server to apply new host/port bindings
     */
    router.post('/dashboard/rebind', requireAuth, async (req, res) => {
        try {
            const { delayMs } = req.body;
            const delay = typeof delayMs === 'number' ? Math.min(delayMs, 30000) : 2000;
            const dashboard = getDashboardServer();
            const oldStatus = dashboard.getStatus();
            logger.info({
                oldPort: oldStatus.port,
                delay
            }, 'Dashboard rebind requested via API');
            // Respond before rebind
            res.json({
                success: true,
                message: `Server rebind scheduled in ${delay}ms`,
                currentBinding: {
                    host: dashboard.getHost(),
                    port: oldStatus.port
                },
                note: 'Connection will be interrupted. Reconnect after rebind completes.'
            });
            // Schedule rebind after response
            setImmediate(async () => {
                try {
                    const result = await dashboard.scheduleRebind(delay);
                    logger.info({ result }, 'Rebind completed');
                }
                catch (err) {
                    logger.error({ err }, 'Rebind failed');
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error triggering rebind');
            res.status(500).json({ success: false, error: 'Failed to trigger rebind' });
        }
    });
    /**
     * POST /api/settings/dashboard/reload
     * Hot-reload configuration from files
     *
     * Reloads what can be reloaded without restart,
     * reports what requires restart
     */
    router.post('/dashboard/reload', requireAuth, async (req, res) => {
        try {
            const dashboard = getDashboardServer();
            const result = await dashboard.reloadConfig();
            res.json({
                success: true,
                message: result.requiresRestart.length > 0
                    ? 'Some changes require server restart'
                    : 'Configuration reloaded',
                hotReloaded: result.hotReloaded,
                requiresRestart: result.requiresRestart
            });
        }
        catch (error) {
            logger.error({ error }, 'Error reloading config');
            res.status(500).json({ success: false, error: 'Failed to reload config' });
        }
    });
    /**
     * GET /api/settings/instance
     * Get the current instance configuration from .specmem/instance.json
     */
    router.get('/instance', requireAuth, async (req, res) => {
        try {
            const config = await loadInstanceConfig();
            if (!config) {
                res.json({
                    success: true,
                    config: null,
                    message: 'No instance configuration found'
                });
                return;
            }
            res.json({
                success: true,
                config
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching instance config');
            res.status(500).json({ success: false, error: 'Failed to fetch instance config' });
        }
    });
    /**
     * POST /api/settings/cleanup-backups
     * Clean up old backup files to save disk space
     */
    router.post('/cleanup-backups', requireAuth, async (req, res) => {
        try {
            const { maxAgeHours } = req.body;
            const maxAgeMs = (typeof maxAgeHours === 'number' ? maxAgeHours : 24) * 60 * 60 * 1000;
            const specmemDir = getLocalSpecMemDir();
            const cleaned = await cleanupOldBackups(specmemDir, maxAgeMs);
            // Also cleanup in cwd
            const cwdCleaned = await cleanupOldBackups(process.cwd(), maxAgeMs);
            res.json({
                success: true,
                message: `Cleaned up ${cleaned + cwdCleaned} backup files`,
                details: {
                    specmemDir: cleaned,
                    projectDir: cwdCleaned
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error cleaning up backups');
            res.status(500).json({ success: false, error: 'Failed to cleanup backups' });
        }
    });
    // ============================================================================
    // Simplified Access Mode Endpoints (for Setup UI)
    // ============================================================================
    /**
     * GET /api/settings/access-mode
     * Get current access mode (simplified endpoint for Setup UI)
     *
     * Returns: { mode: 'private' | 'lan' | 'public' }
     */
    router.get('/access-mode', async (req, res) => {
        try {
            // Read current mode from environment or config
            const envMode = process.env['SPECMEM_DASHBOARD_MODE'] || 'private';
            // Map internal modes to UI modes
            // 'private' stays as 'private'
            // 'public' with LAN-only host becomes 'lan'
            // 'public' with 0.0.0.0 becomes 'public'
            let accessMode = 'private';
            if (envMode === 'public') {
                const host = process.env['SPECMEM_DASHBOARD_HOST'] || '0.0.0.0';
                // Check if it's LAN-only (specific local IP) or full public (0.0.0.0)
                if (host === '0.0.0.0') {
                    accessMode = 'public';
                }
                else if (host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
                    accessMode = 'lan';
                }
                else if (host !== '127.0.0.1' && host !== 'localhost') {
                    accessMode = 'public';
                }
            }
            res.json({
                success: true,
                mode: accessMode,
                details: {
                    envMode,
                    host: process.env['SPECMEM_DASHBOARD_HOST'] || '127.0.0.1',
                    port: parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '8585', 10)
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching access mode');
            res.status(500).json({ success: false, error: 'Failed to fetch access mode' });
        }
    });
    /**
     * POST /api/settings/access-mode
     * Change access mode (simplified endpoint for Setup UI)
     *
     * Body: { mode: 'private' | 'lan' | 'public' }
     *
     * Mode mappings:
     * - private: SPECMEM_DASHBOARD_MODE=private, host=127.0.0.1
     * - lan: SPECMEM_DASHBOARD_MODE=public, host=0.0.0.0 (but firewall/network restricts to LAN)
     * - public: SPECMEM_DASHBOARD_MODE=public, host=0.0.0.0
     */
    router.post('/access-mode', requireAuth, async (req, res) => {
        try {
            const { mode } = req.body;
            // Validate mode
            if (!mode || !['private', 'lan', 'public'].includes(mode)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid mode. Must be "private", "lan", or "public"'
                });
                return;
            }
            // For public/lan modes, warn about default password
            if ((mode === 'public' || mode === 'lan') && isUsingDefaultPassword()) {
                res.status(400).json({
                    success: false,
                    error: 'Cannot enable public/LAN access with default password. Please change your password first.'
                });
                return;
            }
            // Map UI modes to internal config
            let internalMode;
            let host;
            switch (mode) {
                case 'private':
                    internalMode = 'private';
                    host = '127.0.0.1';
                    break;
                case 'lan':
                    internalMode = 'public';
                    host = '0.0.0.0'; // Listen on all interfaces, network config restricts to LAN
                    break;
                case 'public':
                    internalMode = 'public';
                    host = '0.0.0.0'; // Listen on all interfaces
                    break;
                default:
                    internalMode = 'private';
                    host = '127.0.0.1';
            }
            // Persist to config files
            const modeConfig = {
                mode: internalMode,
                host
            };
            const persistResult = await persistDashboardMode(modeConfig);
            if (!persistResult.success) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to save configuration',
                    details: persistResult.message
                });
                return;
            }
            logger.info({
                uiMode: mode,
                internalMode,
                host,
                persistResult
            }, 'Access mode changed via Setup UI');
            // Respond with success - server will need restart
            res.json({
                success: true,
                message: `Access mode changed to ${mode.toUpperCase()}`,
                mode,
                details: {
                    internalMode,
                    host,
                    requiresRestart: true
                },
                note: 'Server restart required for changes to take effect. The page will reload automatically.'
            });
            // Schedule server restart after a short delay
            setImmediate(async () => {
                try {
                    // Give time for response to be sent
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    // Try to trigger a graceful restart
                    const dashboard = getDashboardServer();
                    await dashboard.scheduleRebind(500);
                }
                catch (err) {
                    logger.error({ err }, 'Failed to trigger server restart after mode change');
                    // If rebind fails, exit to let process manager restart
                    process.exit(0);
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error changing access mode');
            res.status(500).json({ success: false, error: 'Failed to change access mode' });
        }
    });
    return router;
}
export default createSettingsRouter;
//# sourceMappingURL=settings.js.map