/**
 * setup.ts - Dashboard Setup Backend API
 *
 * Provides endpoints for dashboard mode switching and password management
 * as part of the setup wizard flow.
 *
 * Endpoints:
 * - GET  /api/setup/status   - Get current setup (public, no auth)
 * - POST /api/setup/mode     - Change dashboard mode (auth for public mode)
 * - POST /api/setup/password - Change password (always requires current password)
 *
 * Security Model:
 * - Mode switch to public: Requires authentication
 * - Mode switch to private/lan: No auth required (relaxing security)
 * - Password change: Always requires current password verification
 * - Public mode: Validates password strength
 */
import { Router } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import { getPassword, checkPassword, validatePassword, changePassword, isUsingDefaultPassword, getMinPasswordLength } from '../../config/password.js';
import { loadDashboardConfig, getSpecmemRoot } from '../../config.js';
import { getDashboardServer } from '../webServer.js';
// ============================================================================
// Validation Schemas
// ============================================================================
/**
 * Schema for mode change requests
 * - mode: Required target mode (private, lan, or public)
 * - currentPassword: Required ONLY when switching TO public mode
 */
const ChangeModeSchema = z.object({
    mode: z.enum(['private', 'lan', 'public'], {
        errorMap: () => ({ message: 'Mode must be one of: private, lan, public' })
    }),
    currentPassword: z.string().optional(),
    // If true, trigger hot-reload immediately; if false, just update config (requiresRestart)
    hotReload: z.boolean().optional().default(true)
});
/**
 * Schema for password change requests
 * Both current and new passwords are required
 */
const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters')
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Get the path to the env file for configuration updates
 */
function getEnvFilePath() {
    const envPaths = [
        path.join(process.cwd(), 'specmem.env'),
        path.join(process.cwd(), '.env'),
        path.join(getSpecmemRoot(), 'specmem.env'),
        path.join(getSpecmemRoot(), '.env')
    ];
    for (const envPath of envPaths) {
        if (fs.existsSync(envPath)) {
            return envPath;
        }
    }
    return null;
}
/**
 * Update environment variable in the env file
 */
function updateEnvFile(key, value) {
    const envPath = getEnvFilePath();
    if (!envPath) {
        logger.warn('No env file found for configuration update');
        return false;
    }
    try {
        let content = fs.readFileSync(envPath, 'utf-8');
        const pattern = new RegExp(`^${key}=.*$`, 'm');
        if (pattern.test(content)) {
            // Update existing key
            content = content.replace(pattern, `${key}=${value}`);
        }
        else {
            // Add new key at the end
            content = content.trimEnd() + `\n${key}=${value}\n`;
        }
        fs.writeFileSync(envPath, content, 'utf-8');
        logger.info({ key, envPath }, 'Updated env file configuration');
        return true;
    }
    catch (error) {
        logger.error({ error, key, envPath }, 'Failed to update env file');
        return false;
    }
}
/**
 * Get host binding for a given mode
 */
function getHostForMode(mode) {
    switch (mode) {
        case 'private':
            return '127.0.0.1';
        case 'lan':
            // LAN mode: bind to all interfaces but conceptually for local network
            return '0.0.0.0';
        case 'public':
            return '0.0.0.0';
        default:
            return '127.0.0.1';
    }
}
/**
 * Validate password strength for public mode
 * Public mode requires a stronger password than private mode
 */
function validatePasswordForPublicMode(password) {
    const errors = [];
    // Basic validation
    const basicValidation = validatePassword(password);
    if (!basicValidation.valid) {
        return basicValidation;
    }
    // Additional requirements for public mode
    if (password.length < 12) {
        errors.push('Public mode requires password of at least 12 characters');
    }
    // Check for character variety
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumbers = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const typesCount = [hasLowercase, hasUppercase, hasNumbers, hasSpecial].filter(Boolean).length;
    if (typesCount < 2) {
        errors.push('Public mode requires password with at least 2 character types (lowercase, uppercase, numbers, special)');
    }
    // Check for common weak passwords
    const weakPasswords = ['password', '12345678', 'specmem', 'admin', 'qwerty'];
    if (weakPasswords.some(weak => password.toLowerCase().includes(weak))) {
        errors.push('Password contains common weak patterns');
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
/**
 * Check if the current mode requires auth and the request is authenticated
 */
function isAuthenticated(req) {
    const session = req.session;
    return !!session?.authenticated;
}
// ============================================================================
// Router Factory
// ============================================================================
export function createSetupRouter(requireAuth) {
    const router = Router();
    /**
     * GET /api/setup/status
     * Get current setup configuration
     *
     * PUBLIC ENDPOINT - No authentication required
     * This allows the setup wizard to check current state before login
     */
    router.get('/status', async (req, res) => {
        try {
            const dashboardConfig = loadDashboardConfig();
            const passwordConfig = {
                isDefault: isUsingDefaultPassword(),
                minLength: getMinPasswordLength()
            };
            // Determine effective mode
            // The config only has 'private' and 'public', but we expose 'lan' as a UI concept
            // lan = public mode with host 0.0.0.0 (conceptually for LAN access)
            let effectiveMode = dashboardConfig.mode;
            // If mode is public but we want to distinguish LAN vs internet,
            // we treat it as the same technically (both bind to 0.0.0.0)
            // The distinction is mainly for user understanding
            res.json({
                success: true,
                setup: {
                    mode: effectiveMode,
                    host: dashboardConfig.host,
                    port: dashboardConfig.port,
                    enabled: dashboardConfig.enabled,
                    requiresAuth: true, // Always require auth for protected endpoints
                    passwordIsDefault: passwordConfig.isDefault,
                    minPasswordLength: passwordConfig.minLength
                },
                message: passwordConfig.isDefault
                    ? 'Using default password - please change for security'
                    : 'Dashboard configured'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching setup status');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch setup status'
            });
        }
    });
    /**
     * POST /api/setup/mode
     * Change dashboard access mode
     *
     * Security:
     * - Switching TO public mode: Requires authentication
     * - Switching to private/lan: No auth required (relaxing security is safe)
     *
     * Body:
     * - mode: 'private' | 'lan' | 'public'
     * - currentPassword: string (required only for public mode)
     */
    router.post('/mode', async (req, res) => {
        try {
            // Validate request body
            const parseResult = ChangeModeSchema.safeParse(req.body);
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
            const { mode, currentPassword, hotReload } = parseResult.data;
            const currentConfig = loadDashboardConfig();
            // Security check: Switching to public mode requires authentication
            if (mode === 'public') {
                // Must be authenticated OR provide correct password
                if (!isAuthenticated(req)) {
                    if (!currentPassword) {
                        res.status(401).json({
                            success: false,
                            error: 'Authentication required to switch to public mode',
                            requiresPassword: true
                        });
                        return;
                    }
                    if (!checkPassword(currentPassword)) {
                        res.status(401).json({
                            success: false,
                            error: 'Invalid password'
                        });
                        return;
                    }
                }
                // Validate password strength for public mode
                const currentPass = getPassword();
                const strengthCheck = validatePasswordForPublicMode(currentPass);
                if (!strengthCheck.valid) {
                    res.status(400).json({
                        success: false,
                        error: 'Password not strong enough for public mode',
                        details: strengthCheck.errors,
                        requiresPasswordChange: true
                    });
                    return;
                }
            }
            // Determine new host binding based on mode
            const newHost = getHostForMode(mode);
            // Map 'lan' to 'public' for storage (they use same binding)
            const storageMode = mode === 'lan' ? 'public' : mode;
            // Update environment file for persistence
            const modeUpdated = updateEnvFile('SPECMEM_DASHBOARD_MODE', storageMode);
            const hostUpdated = updateEnvFile('SPECMEM_DASHBOARD_HOST', newHost);
            if (!modeUpdated) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to update configuration file'
                });
                return;
            }
            // Update process.env for immediate effect
            process.env['SPECMEM_DASHBOARD_MODE'] = storageMode;
            process.env['SPECMEM_DASHBOARD_HOST'] = newHost;
            logger.info({
                previousMode: currentConfig.mode,
                newMode: mode,
                newHost,
                hotReload
            }, 'Dashboard mode change requested');
            // HOT-RELOAD: If hotReload is enabled, trigger server rebind
            if (hotReload) {
                try {
                    const dashboard = getDashboardServer();
                    // Update config in the dashboard server
                    const configResult = await dashboard.updateConfig({
                        mode: storageMode,
                        host: newHost
                    });
                    if (configResult.requiresRebind) {
                        // Send response BEFORE rebind (connection will be interrupted)
                        // Use scheduleRebind to give client time to receive response
                        res.json({
                            success: true,
                            message: `Dashboard mode changed to ${mode}. Hot-reloading server...`,
                            setup: {
                                mode,
                                host: newHost,
                                port: currentConfig.port,
                                previousMode: currentConfig.mode
                            },
                            hotReloading: true,
                            rebindScheduled: true,
                            reconnectIn: 3000,
                            note: 'Server is rebinding to new address. Reconnect in ~3 seconds.'
                        });
                        // Schedule rebind after response is sent (2 second delay)
                        // Don't await - let it happen after response
                        dashboard.scheduleRebind(2000).then(rebindResult => {
                            logger.info({
                                rebindResult,
                                newMode: mode,
                                newHost
                            }, 'Hot-reload rebind completed');
                        }).catch(err => {
                            logger.error({ error: err }, 'Hot-reload rebind failed');
                        });
                        return;
                    }
                    else {
                        // Config updated without rebind needed (shouldn't happen for mode/host)
                        res.json({
                            success: true,
                            message: `Dashboard mode changed to ${mode}`,
                            setup: {
                                mode,
                                host: newHost,
                                port: currentConfig.port,
                                previousMode: currentConfig.mode
                            },
                            hotReloaded: true,
                            appliedChanges: configResult.appliedChanges,
                            note: 'Configuration applied via hot-reload'
                        });
                        return;
                    }
                }
                catch (hotReloadError) {
                    // Hot-reload failed, but config is saved - user can restart manually
                    logger.error({ error: hotReloadError }, 'Hot-reload failed, config saved');
                    res.json({
                        success: true,
                        message: `Dashboard mode changed to ${mode}`,
                        setup: {
                            mode,
                            host: newHost,
                            port: currentConfig.port,
                            previousMode: currentConfig.mode
                        },
                        hotReloadFailed: true,
                        requiresRestart: true,
                        note: 'Hot-reload failed. Manual restart required for changes to take effect.'
                    });
                    return;
                }
            }
            // No hot-reload requested - traditional behavior
            res.json({
                success: true,
                message: `Dashboard mode changed to ${mode}`,
                setup: {
                    mode,
                    host: newHost,
                    port: currentConfig.port,
                    previousMode: currentConfig.mode
                },
                requiresRestart: true,
                note: 'Server restart required for changes to take full effect'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error changing dashboard mode');
            res.status(500).json({
                success: false,
                error: 'Failed to change dashboard mode'
            });
        }
    });
    /**
     * POST /api/setup/password
     * Change dashboard password
     *
     * Security:
     * - Always requires current password verification
     * - Validates new password strength
     * - For public mode, enforces stronger password requirements
     *
     * Body:
     * - currentPassword: string (required)
     * - newPassword: string (required, min 8 chars)
     */
    router.post('/password', async (req, res) => {
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
            // Verify current password
            if (!checkPassword(currentPassword)) {
                res.status(401).json({
                    success: false,
                    error: 'Current password is incorrect'
                });
                return;
            }
            // Basic password validation
            const basicValidation = validatePassword(newPassword);
            if (!basicValidation.valid) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid new password',
                    details: basicValidation.errors
                });
                return;
            }
            // Check if we're in public mode - require stronger password
            const dashboardConfig = loadDashboardConfig();
            if (dashboardConfig.mode === 'public') {
                const strengthCheck = validatePasswordForPublicMode(newPassword);
                if (!strengthCheck.valid) {
                    res.status(400).json({
                        success: false,
                        error: 'Password not strong enough for public mode',
                        details: strengthCheck.errors
                    });
                    return;
                }
            }
            // Perform password change
            const result = await changePassword(currentPassword, newPassword, true);
            if (!result.success) {
                res.status(400).json({
                    success: false,
                    error: result.message
                });
                return;
            }
            logger.info({ persisted: result.persisted }, 'Password changed via setup API');
            res.json({
                success: true,
                message: 'Password changed successfully',
                details: {
                    persisted: result.persisted || false
                },
                note: 'New password is effective immediately'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error changing password via setup API');
            res.status(500).json({
                success: false,
                error: 'Failed to change password'
            });
        }
    });
    /**
     * POST /api/setup/validate-password
     * Validate a password without changing it
     * Useful for real-time strength feedback in the UI
     *
     * PUBLIC ENDPOINT - No authentication required
     */
    router.post('/validate-password', async (req, res) => {
        try {
            const { password, forPublicMode } = req.body;
            if (!password || typeof password !== 'string') {
                res.status(400).json({
                    success: false,
                    error: 'Password is required for validation'
                });
                return;
            }
            // Basic validation
            const basicValidation = validatePassword(password);
            // Public mode validation if requested
            let publicModeValidation = { valid: true, errors: [] };
            if (forPublicMode) {
                publicModeValidation = validatePasswordForPublicMode(password);
            }
            // Calculate strength
            const hasLowercase = /[a-z]/.test(password);
            const hasUppercase = /[A-Z]/.test(password);
            const hasNumbers = /[0-9]/.test(password);
            const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
            const typesCount = [hasLowercase, hasUppercase, hasNumbers, hasSpecial].filter(Boolean).length;
            let strength = 'weak';
            if (password.length >= 16 && typesCount >= 3) {
                strength = 'strong';
            }
            else if (password.length >= 12 && typesCount >= 2) {
                strength = 'medium';
            }
            res.json({
                success: true,
                validation: {
                    valid: basicValidation.valid,
                    errors: basicValidation.errors,
                    strength,
                    length: password.length,
                    requirements: {
                        minLength: getMinPasswordLength(),
                        hasLowercase,
                        hasUppercase,
                        hasNumbers,
                        hasSpecial,
                        typesCount
                    },
                    publicModeReady: publicModeValidation.valid,
                    publicModeErrors: publicModeValidation.errors
                }
            });
        }
        catch (error) {
            logger.error({ error }, 'Error validating password');
            res.status(500).json({
                success: false,
                error: 'Failed to validate password'
            });
        }
    });
    /**
     * POST /api/setup/hot-reload
     * Manually trigger a hot-reload/rebind of the server
     *
     * PROTECTED ENDPOINT - Requires authentication
     *
     * Body (optional):
     * - delayMs: number (delay before rebind, default 2000)
     */
    router.post('/hot-reload', requireAuth, async (req, res) => {
        try {
            const delayMs = parseInt(req.body?.delayMs) || 2000;
            // Validate delay bounds (500ms to 30s)
            if (delayMs < 500 || delayMs > 30000) {
                res.status(400).json({
                    success: false,
                    error: 'delayMs must be between 500 and 30000 milliseconds'
                });
                return;
            }
            const dashboard = getDashboardServer();
            const currentStatus = dashboard.getStatus();
            if (!currentStatus.running) {
                res.status(503).json({
                    success: false,
                    error: 'Dashboard server is not running'
                });
                return;
            }
            logger.info({ delayMs }, 'Manual hot-reload triggered via API');
            // Send response before triggering rebind
            res.json({
                success: true,
                message: `Hot-reload scheduled in ${delayMs}ms`,
                currentBinding: {
                    host: dashboard.getHost(),
                    port: currentStatus.port,
                    mode: dashboard.getMode()
                },
                reconnectIn: delayMs + 1000,
                note: 'Server will rebind shortly. Reconnect after the delay.'
            });
            // Schedule rebind (fire and forget)
            dashboard.scheduleRebind(delayMs).then(result => {
                logger.info({ result }, 'Manual hot-reload completed');
            }).catch(err => {
                logger.error({ error: err }, 'Manual hot-reload failed');
            });
        }
        catch (error) {
            logger.error({ error }, 'Error triggering hot-reload');
            res.status(500).json({
                success: false,
                error: 'Failed to trigger hot-reload'
            });
        }
    });
    /**
     * GET /api/setup/server-status
     * Get current server binding status and configuration
     *
     * PROTECTED ENDPOINT - Requires authentication
     */
    router.get('/server-status', requireAuth, async (req, res) => {
        try {
            const dashboard = getDashboardServer();
            const status = dashboard.getStatus();
            const currentConfig = loadDashboardConfig();
            res.json({
                success: true,
                server: {
                    running: status.running,
                    uptime: status.uptime,
                    uptimeFormatted: formatUptime(status.uptime)
                },
                binding: {
                    host: dashboard.getHost(),
                    port: status.port,
                    configuredPort: status.configuredPort,
                    mode: dashboard.getMode()
                },
                config: {
                    mode: currentConfig.mode,
                    host: currentConfig.host,
                    port: currentConfig.port,
                    enabled: currentConfig.enabled
                },
                hotReloadAvailable: true
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching server status');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch server status'
            });
        }
    });
    return router;
}
/**
 * Format uptime in human-readable format
 */
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    else if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    else {
        return `${seconds}s`;
    }
}
export default createSetupRouter;
//# sourceMappingURL=setup.js.map