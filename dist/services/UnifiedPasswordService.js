/**
 * UnifiedPasswordService.ts - Centralized Password Management Service for SpecMem
 *
 * Unified password service with secure hashing
 *
 * This service provides:
 * - Single password for ALL SpecMem authentication
 * - Secure password hashing using scrypt (Node.js crypto)
 * - Password storage in .specmem/config.json
 * - Password strength validation
 * - Default password initialization
 *
 * Default password: "specmem_westayunprofessional"
 *
 * @created 2025-12-29
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { getSpecmemRoot } from '../config.js';
// Helper for async scrypt with options
function scryptAsync(password, salt, keylen, options) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
            if (err)
                reject(err);
            else
                resolve(derivedKey);
        });
    });
}
// Constants
const DEFAULT_PASSWORD = 'specmem_westayunprofessional';
const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384; // N parameter (2^14)
const SCRYPT_BLOCK_SIZE = 8; // r parameter
const SCRYPT_PARALLELIZATION = 1; // p parameter
const MIN_PASSWORD_LENGTH = 8;
const STRONG_PASSWORD_LENGTH = 12;
/**
 * Password strength levels
 */
export var PasswordStrength;
(function (PasswordStrength) {
    PasswordStrength["WEAK"] = "weak";
    PasswordStrength["MODERATE"] = "moderate";
    PasswordStrength["STRONG"] = "strong";
    PasswordStrength["VERY_STRONG"] = "very_strong";
})(PasswordStrength || (PasswordStrength = {}));
/**
 * UnifiedPasswordService - Singleton service for password management
 */
export class UnifiedPasswordService {
    static instance = null;
    configPath;
    config = null;
    runtimePassword = null; // In-memory override
    constructor() {
        // Determine config directory
        const specmemDir = process.env['SPECMEM_CONFIG_DIR'] ||
            path.join(process.cwd(), '.specmem');
        this.configPath = path.join(specmemDir, 'config.json');
    }
    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!UnifiedPasswordService.instance) {
            UnifiedPasswordService.instance = new UnifiedPasswordService();
        }
        return UnifiedPasswordService.instance;
    }
    /**
     * Initialize the service - loads config and sets up default password if needed
     */
    async initialize() {
        await this.loadConfig();
        // If no password is configured, set up the default
        if (!this.config?.password) {
            logger.info('No password configured, initializing with default password');
            await this.initializeDefaultPassword();
        }
    }
    /**
     * Load configuration from config.json
     */
    async loadConfig() {
        try {
            // Ensure directory exists
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            // Load existing config or create new
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf-8');
                this.config = JSON.parse(content);
            }
            else {
                this.config = { version: '1.0.0' };
            }
        }
        catch (error) {
            logger.error({ error }, 'Failed to load password config');
            this.config = { version: '1.0.0' };
        }
    }
    /**
     * Save configuration to config.json
     */
    async saveConfig() {
        try {
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
            logger.debug('Password config saved successfully');
        }
        catch (error) {
            logger.error({ error }, 'Failed to save password config');
            throw new Error('Failed to save password configuration');
        }
    }
    /**
     * Initialize with default password
     */
    async initializeDefaultPassword() {
        const { hash, salt } = await this.hashPassword(DEFAULT_PASSWORD);
        if (!this.config) {
            this.config = { version: '1.0.0' };
        }
        this.config.password = {
            passwordHash: hash,
            salt: salt,
            algorithm: 'scrypt',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isDefault: true
        };
        await this.saveConfig();
        logger.info('Default password initialized');
    }
    /**
     * Hash a password using scrypt
     */
    async hashPassword(password) {
        const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
        const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION });
        return {
            hash: derivedKey.toString('hex'),
            salt: salt
        };
    }
    /**
     * Verify a password against a stored hash
     */
    async verifyHash(password, storedHash, salt) {
        const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION });
        return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), derivedKey);
    }
    // ============================================================================
    // PUBLIC API
    // ============================================================================
    /**
     * Get the current password (plaintext for runtime use)
     * Priority: runtime override > stored password falls back to default
     *
     * NOTE: For security, this returns the DEFAULT_PASSWORD if using hashed storage.
     * Use validatePassword() for authentication instead.
     */
    getPassword() {
        // Runtime override takes precedence
        if (this.runtimePassword !== null) {
            return this.runtimePassword;
        }
        // Check environment variables (backward compatibility)
        const envPassword = process.env['SPECMEM_PASSWORD'] ||
            process.env['SPECMEM_DASHBOARD_PASSWORD'] ||
            process.env['SPECMEM_API_PASSWORD'];
        if (envPassword) {
            return envPassword;
        }
        // Return default (actual password is hashed in config)
        return DEFAULT_PASSWORD;
    }
    /**
     * Set a new password
     * Hashes the password and stores it in config.json
     */
    async setPassword(newPassword) {
        // Validate password strength
        const validation = this.validatePasswordStrength(newPassword);
        if (!validation.valid) {
            throw new Error(`Invalid password: ${validation.errors.join(', ')}`);
        }
        // Hash the new password
        const { hash, salt } = await this.hashPassword(newPassword);
        // Update config
        if (!this.config) {
            await this.loadConfig();
        }
        this.config.password = {
            passwordHash: hash,
            salt: salt,
            algorithm: 'scrypt',
            createdAt: this.config?.password?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isDefault: newPassword === DEFAULT_PASSWORD
        };
        await this.saveConfig();
        // Clear runtime override
        this.runtimePassword = null;
        // Also update environment file for backward compatibility
        await this.updateEnvFile(newPassword);
        logger.info('Password updated successfully');
    }
    /**
     * Validate an input password against the stored password
     * Returns true if password matches, false otherwise
     */
    async validatePassword(inputPassword) {
        // Check runtime override first
        if (this.runtimePassword !== null) {
            return inputPassword === this.runtimePassword;
        }
        // Check environment variables (backward compatibility)
        const envPassword = process.env['SPECMEM_PASSWORD'] ||
            process.env['SPECMEM_DASHBOARD_PASSWORD'] ||
            process.env['SPECMEM_API_PASSWORD'];
        if (envPassword) {
            return inputPassword === envPassword;
        }
        // Load config if needed
        if (!this.config) {
            await this.loadConfig();
        }
        // If no stored password, check against default
        if (!this.config?.password) {
            return inputPassword === DEFAULT_PASSWORD;
        }
        // Verify against stored hash
        try {
            return await this.verifyHash(inputPassword, this.config.password.passwordHash, this.config.password.salt);
        }
        catch (error) {
            logger.error({ error }, 'Password verification failed');
            return false;
        }
    }
    /**
     * Synchronous password validation (for backward compatibility)
     * Uses simple comparison against runtime/env/default password
     */
    validatePasswordSync(inputPassword) {
        // Check runtime override first
        if (this.runtimePassword !== null) {
            return inputPassword === this.runtimePassword;
        }
        // Check environment variables
        const envPassword = process.env['SPECMEM_PASSWORD'] ||
            process.env['SPECMEM_DASHBOARD_PASSWORD'] ||
            process.env['SPECMEM_API_PASSWORD'];
        if (envPassword) {
            return inputPassword === envPassword;
        }
        // Fall back to default
        return inputPassword === DEFAULT_PASSWORD;
    }
    /**
     * Reset password to default value
     */
    async resetToDefault() {
        await this.setPassword(DEFAULT_PASSWORD);
        logger.info('Password reset to default');
    }
    // ============================================================================
    // PASSWORD STRENGTH VALIDATION
    // ============================================================================
    /**
     * Validate password strength with detailed feedback
     */
    validatePasswordStrength(password) {
        const errors = [];
        const suggestions = [];
        let score = 0;
        // Check for empty password
        if (!password) {
            return {
                valid: false,
                strength: PasswordStrength.WEAK,
                score: 0,
                errors: ['Password cannot be empty'],
                suggestions: ['Enter a password']
            };
        }
        // Check minimum length
        if (password.length < MIN_PASSWORD_LENGTH) {
            errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
        }
        else {
            score += 20;
        }
        // Check for whitespace
        if (password.trim() !== password) {
            errors.push('Password cannot have leading or trailing whitespace');
        }
        // Check for character types
        const hasLowercase = /[a-z]/.test(password);
        const hasUppercase = /[A-Z]/.test(password);
        const hasDigit = /\d/.test(password);
        const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
        let charTypes = 0;
        if (hasLowercase) {
            charTypes++;
            score += 10;
        }
        if (hasUppercase) {
            charTypes++;
            score += 10;
        }
        if (hasDigit) {
            charTypes++;
            score += 10;
        }
        if (hasSpecial) {
            charTypes++;
            score += 15;
        }
        // Length bonuses
        if (password.length >= STRONG_PASSWORD_LENGTH) {
            score += 15;
        }
        if (password.length >= 16) {
            score += 10;
        }
        if (password.length >= 20) {
            score += 10;
        }
        // Suggestions based on missing character types
        if (!hasLowercase)
            suggestions.push('Add lowercase letters');
        if (!hasUppercase)
            suggestions.push('Add uppercase letters');
        if (!hasDigit)
            suggestions.push('Add numbers');
        if (!hasSpecial)
            suggestions.push('Add special characters (!@#$%^&*)');
        if (password.length < STRONG_PASSWORD_LENGTH) {
            suggestions.push(`Increase length to at least ${STRONG_PASSWORD_LENGTH} characters`);
        }
        // Check for common weak patterns
        const weakPatterns = [
            /^password/i,
            /^123456/,
            /^qwerty/i,
            /^admin/i,
            /^letmein/i,
            /^welcome/i,
            /^monkey/i,
            /^dragon/i,
            /^master/i,
            /^1234567890/,
            /^abcdef/i,
            /(.)\1{3,}/ // 4+ repeated characters
        ];
        for (const pattern of weakPatterns) {
            if (pattern.test(password)) {
                errors.push('Password contains a common weak pattern');
                score = Math.max(0, score - 30);
                break;
            }
        }
        // Determine strength level
        let strength;
        if (score < 30) {
            strength = PasswordStrength.WEAK;
        }
        else if (score < 50) {
            strength = PasswordStrength.MODERATE;
        }
        else if (score < 70) {
            strength = PasswordStrength.STRONG;
        }
        else {
            strength = PasswordStrength.VERY_STRONG;
        }
        // Cap score at 100
        score = Math.min(100, score);
        return {
            valid: errors.length === 0,
            strength,
            score,
            errors,
            suggestions
        };
    }
    // ============================================================================
    // UTILITY METHODS
    // ============================================================================
    /**
     * Check if using default password
     */
    async isUsingDefaultPassword() {
        if (!this.config) {
            await this.loadConfig();
        }
        // Check environment override
        const envPassword = process.env['SPECMEM_PASSWORD'] ||
            process.env['SPECMEM_DASHBOARD_PASSWORD'] ||
            process.env['SPECMEM_API_PASSWORD'];
        if (envPassword) {
            return envPassword === DEFAULT_PASSWORD;
        }
        return this.config?.password?.isDefault ?? true;
    }
    /**
     * Get default password value
     */
    getDefaultPassword() {
        return DEFAULT_PASSWORD;
    }
    /**
     * Get minimum password length requirement
     */
    getMinPasswordLength() {
        return MIN_PASSWORD_LENGTH;
    }
    /**
     * Set runtime password override (in-memory only, not persisted)
     */
    setRuntimePassword(password) {
        this.runtimePassword = password;
        logger.info('Runtime password override set');
    }
    /**
     * Clear runtime password override
     */
    clearRuntimePassword() {
        this.runtimePassword = null;
        logger.info('Runtime password override cleared');
    }
    /**
     * Get password configuration status (for API responses)
     */
    async getPasswordStatus() {
        if (!this.config) {
            await this.loadConfig();
        }
        // Determine source
        let source = 'default';
        if (this.runtimePassword !== null) {
            source = 'runtime';
        }
        else if (process.env['SPECMEM_PASSWORD'] || process.env['SPECMEM_DASHBOARD_PASSWORD']) {
            source = 'environment';
        }
        else if (this.config?.password) {
            source = 'config';
        }
        return {
            isDefault: await this.isUsingDefaultPassword(),
            hasCustomPassword: source !== 'default',
            lastUpdated: this.config?.password?.updatedAt || null,
            source
        };
    }
    /**
     * Update environment file with new password (backward compatibility)
     */
    async updateEnvFile(newPassword) {
        const envPaths = [
            path.join(process.cwd(), '.env'),
            path.join(process.cwd(), 'specmem.env'),
            path.join(getSpecmemRoot(), '.env'),
            path.join(getSpecmemRoot(), 'specmem.env')
        ];
        for (const envPath of envPaths) {
            try {
                if (!fs.existsSync(envPath)) {
                    continue;
                }
                let content = fs.readFileSync(envPath, 'utf-8');
                let updated = false;
                // Update all password variables
                const patterns = [
                    { regex: /SPECMEM_PASSWORD=.*/g, replacement: `SPECMEM_PASSWORD=${newPassword}` },
                    { regex: /SPECMEM_DASHBOARD_PASSWORD=.*/g, replacement: `SPECMEM_DASHBOARD_PASSWORD=${newPassword}` },
                    { regex: /SPECMEM_API_PASSWORD=.*/g, replacement: `SPECMEM_API_PASSWORD=${newPassword}` }
                ];
                for (const { regex, replacement } of patterns) {
                    if (regex.test(content)) {
                        content = content.replace(regex, replacement);
                        updated = true;
                    }
                }
                if (updated) {
                    fs.writeFileSync(envPath, content, 'utf-8');
                    logger.info({ envPath }, 'Environment file updated with new password');
                    return true;
                }
            }
            catch (error) {
                logger.debug({ error, envPath }, 'Could not update env file');
            }
        }
        return false;
    }
    /**
     * Change password with current password verification
     */
    async changePassword(currentPassword, newPassword) {
        // Verify current password
        const isValid = await this.validatePassword(currentPassword);
        if (!isValid) {
            return {
                success: false,
                message: 'Current password is incorrect'
            };
        }
        // Validate new password strength
        const validation = this.validatePasswordStrength(newPassword);
        if (!validation.valid) {
            return {
                success: false,
                message: validation.errors.join('; ')
            };
        }
        // Set new password
        try {
            await this.setPassword(newPassword);
            return {
                success: true,
                message: 'Password changed successfully'
            };
        }
        catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to change password'
            };
        }
    }
}
// ============================================================================
// CONVENIENCE FUNCTIONS (for backward compatibility with existing code)
// ============================================================================
let serviceInstance = null;
/**
 * Get or create the UnifiedPasswordService instance
 */
export function getUnifiedPasswordService() {
    if (!serviceInstance) {
        serviceInstance = UnifiedPasswordService.getInstance();
    }
    return serviceInstance;
}
/**
 * Initialize the unified password service
 */
export async function initializeUnifiedPasswordService() {
    const service = getUnifiedPasswordService();
    await service.initialize();
    return service;
}
/**
 * Quick password check (synchronous, for middleware)
 */
export function checkPasswordSync(password) {
    return getUnifiedPasswordService().validatePasswordSync(password);
}
/**
 * Quick password check (async, for full validation)
 */
export async function checkPassword(password) {
    return getUnifiedPasswordService().validatePassword(password);
}
/**
 * Get default password
 */
export function getDefaultPassword() {
    return DEFAULT_PASSWORD;
}
export default UnifiedPasswordService;
//# sourceMappingURL=UnifiedPasswordService.js.map