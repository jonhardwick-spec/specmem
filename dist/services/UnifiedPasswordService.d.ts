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
/**
 * Password strength levels
 */
export declare enum PasswordStrength {
    WEAK = "weak",
    MODERATE = "moderate",
    STRONG = "strong",
    VERY_STRONG = "very_strong"
}
/**
 * Password validation result
 */
export interface PasswordValidationResult {
    valid: boolean;
    strength: PasswordStrength;
    score: number;
    errors: string[];
    suggestions: string[];
}
/**
 * UnifiedPasswordService - Singleton service for password management
 */
export declare class UnifiedPasswordService {
    private static instance;
    private configPath;
    private config;
    private runtimePassword;
    private constructor();
    /**
     * Get singleton instance
     */
    static getInstance(): UnifiedPasswordService;
    /**
     * Initialize the service - loads config and sets up default password if needed
     */
    initialize(): Promise<void>;
    /**
     * Load configuration from config.json
     */
    private loadConfig;
    /**
     * Save configuration to config.json
     */
    private saveConfig;
    /**
     * Initialize with default password
     */
    private initializeDefaultPassword;
    /**
     * Hash a password using scrypt
     */
    private hashPassword;
    /**
     * Verify a password against a stored hash
     */
    private verifyHash;
    /**
     * Get the current password (plaintext for runtime use)
     * Priority: runtime override > stored password falls back to default
     *
     * NOTE: For security, this returns the DEFAULT_PASSWORD if using hashed storage.
     * Use validatePassword() for authentication instead.
     */
    getPassword(): string;
    /**
     * Set a new password
     * Hashes the password and stores it in config.json
     */
    setPassword(newPassword: string): Promise<void>;
    /**
     * Validate an input password against the stored password
     * Returns true if password matches, false otherwise
     */
    validatePassword(inputPassword: string): Promise<boolean>;
    /**
     * Synchronous password validation (for backward compatibility)
     * Uses simple comparison against runtime/env/default password
     */
    validatePasswordSync(inputPassword: string): boolean;
    /**
     * Reset password to default value
     */
    resetToDefault(): Promise<void>;
    /**
     * Validate password strength with detailed feedback
     */
    validatePasswordStrength(password: string): PasswordValidationResult;
    /**
     * Check if using default password
     */
    isUsingDefaultPassword(): Promise<boolean>;
    /**
     * Get default password value
     */
    getDefaultPassword(): string;
    /**
     * Get minimum password length requirement
     */
    getMinPasswordLength(): number;
    /**
     * Set runtime password override (in-memory only, not persisted)
     */
    setRuntimePassword(password: string): void;
    /**
     * Clear runtime password override
     */
    clearRuntimePassword(): void;
    /**
     * Get password configuration status (for API responses)
     */
    getPasswordStatus(): Promise<{
        isDefault: boolean;
        hasCustomPassword: boolean;
        lastUpdated: string | null;
        source: 'config' | 'environment' | 'runtime' | 'default';
    }>;
    /**
     * Update environment file with new password (backward compatibility)
     */
    private updateEnvFile;
    /**
     * Change password with current password verification
     */
    changePassword(currentPassword: string, newPassword: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
/**
 * Get or create the UnifiedPasswordService instance
 */
export declare function getUnifiedPasswordService(): UnifiedPasswordService;
/**
 * Initialize the unified password service
 */
export declare function initializeUnifiedPasswordService(): Promise<UnifiedPasswordService>;
/**
 * Quick password check (synchronous, for middleware)
 */
export declare function checkPasswordSync(password: string): boolean;
/**
 * Quick password check (async, for full validation)
 */
export declare function checkPassword(password: string): Promise<boolean>;
/**
 * Get default password
 */
export declare function getDefaultPassword(): string;
export default UnifiedPasswordService;
//# sourceMappingURL=UnifiedPasswordService.d.ts.map