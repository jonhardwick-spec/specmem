/**
 * SpecMem Auto-Deploy to 
 *
 * Automatically deploys SpecMem hooks and slash commands to 's
 * configuration directories on startup.
 *
 * Source directories (in SpecMem):
 *   - claude-hooks/   -> ~/.claude/hooks/
 *   - commands/       -> ~/.claude/commands/
 *
 * Features:
 *   - Version checking (only deploy if version changed)
 *   - Automatic settings.json hook registration
 *   - Executable permissions for hooks
 *   - Backup of existing files
 *
 * This ensures SpecMem's  integration is always up-to-date
 * without manual file copying.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Version manifest file for tracking deployed versions
const VERSION_MANIFEST_FILE = '.specmem-deploy-manifest.json';
// ============================================================================
// Configuration
// ============================================================================
// Determine SpecMem root directory (src/cli -> src -> specmem root)
const SPECMEM_ROOT = path.resolve(__dirname, '..', '..');
// Source directories in SpecMem
const HOOKS_SOURCE = path.join(SPECMEM_ROOT, 'claude-hooks');
const COMMANDS_SOURCE = path.join(SPECMEM_ROOT, 'commands');
// Target directories in 's config
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const HOOKS_TARGET = path.join(CLAUDE_HOME, 'hooks');
const COMMANDS_TARGET = path.join(CLAUDE_HOME, 'commands');
// Files to deploy (only SpecMem-related files)
// NOTE: .cjs extension required because package.json has "type": "module"
// No hardcoded fallback list — deployer scans claude-hooks/ directory directly
const HOOK_FILES = [];
const COMMAND_FILES = [
    'specmem.md',
    'specmem-team-member.md',
    'specmem-autoclaude.md',
    'specmem-changes.md',
    'specmem-code.md',
    'specmem-configteammembercomms.md',
    'specmem-drilldown.md',
    'specmem-find.md',
    'specmem-getdashboard.md',
    'specmem-pointers.md',
    'specmem-remember.md',
    'specmem-service.md',
    'specmem-stats.md',
];
// ============================================================================
// Utility Functions
// ============================================================================
function log(message) {
    const timestamp = new Date().toISOString();
    // CRITICAL: Use console.error for MCP mode - stdout is reserved for JSON-RPC
    console.error(`[SpecMem Deploy] ${timestamp} - ${message}`);
}
function ensureDir(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
            log(`Created directory: ${dirPath}`);
        }
        return true;
    }
    catch (error) {
        log(`Failed to create directory ${dirPath}: ${error}`);
        return false;
    }
}
/**
 * Calculate file hash for version checking
 */
function getFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    }
    catch {
        return '';
    }
}
/**
 * Get SpecMem version from package.json
 */
function getSpecMemVersion() {
    try {
        const packagePath = path.join(SPECMEM_ROOT, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        return pkg.version || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Load version manifest from target directory
 */
function loadManifest(targetDir) {
    try {
        const manifestPath = path.join(targetDir, VERSION_MANIFEST_FILE);
        if (fs.existsSync(manifestPath)) {
            return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        }
    }
    catch {
        // Ignore parse errors
    }
    return null;
}
/**
 * Save version manifest to target directory
 */
function saveManifest(targetDir, manifest) {
    try {
        const manifestPath = path.join(targetDir, VERSION_MANIFEST_FILE);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
    catch (error) {
        log(`Failed to save manifest: ${error}`);
    }
}
/**
 * Check if file needs deployment based on hash comparison
 */
function needsDeployment(source, target, manifest) {
    // If target doesn't exist, definitely need to deploy
    if (!fs.existsSync(target)) {
        return true;
    }
    // Get source hash
    const sourceHash = getFileHash(source);
    if (!sourceHash) {
        return false; // Can't read source, skip
    }
    // Check manifest for cached hash
    const fileName = path.basename(target);
    if (manifest?.files[fileName]) {
        // Compare with manifest hash (faster than reading target)
        return manifest.files[fileName].hash !== sourceHash;
    }
    // Fall back to direct comparison
    const targetHash = getFileHash(target);
    return sourceHash !== targetHash;
}
function copyFile(source, target, manifest = null) {
    try {
        if (!fs.existsSync(source)) {
            // Source doesn't exist, skip silently
            return { copied: false };
        }
        // Check if deployment needed using version checking
        if (!needsDeployment(source, target, manifest)) {
            // Files are identical, no need to copy
            return { copied: false, hash: getFileHash(source) };
        }
        // Read source file
        const content = fs.readFileSync(source);
        const hash = crypto.createHash('md5').update(content).digest('hex');
        // Backup existing file if it exists
        if (fs.existsSync(target)) {
            const backupPath = `${target}.backup.${Date.now()}`;
            fs.copyFileSync(target, backupPath);
            // Clean up old backups (keep only last 2)
            cleanupBackups(target, 2);
        }
        // Copy file with executable permissions for scripts
        fs.writeFileSync(target, content);
        // Make executable if it's a script (but not data files)
        if (source.endsWith('.js') || source.endsWith('.py') || source.endsWith('.sh') || source.endsWith('.cjs')) {
            fs.chmodSync(target, 0o755);
        }
        log(`Deployed: ${path.basename(source)} -> ${target}`);
        return { copied: true, hash };
    }
    catch (error) {
        log(`Failed to copy ${source} to ${target}: ${error}`);
        return { copied: false };
    }
}
/**
 * Clean up old backup files, keeping only the most recent N
 */
function cleanupBackups(basePath, keepCount) {
    try {
        const dir = path.dirname(basePath);
        const baseName = path.basename(basePath);
        const files = fs.readdirSync(dir);
        const backups = files
            .filter(f => f.startsWith(`${baseName}.backup.`))
            .sort()
            .reverse();
        for (let i = keepCount; i < backups.length; i++) {
            fs.unlinkSync(path.join(dir, backups[i]));
        }
    }
    catch {
        // Ignore cleanup errors
    }
}
/**
 * Update 's settings.json — ONLY permissions and MCP config
 * Hook registration lives in hooks/settings.json (deployed as a file)
 * This prevents duplicate hooks between the two settings files
 */
function updateSettings() {
    const settingsPath = path.join(CLAUDE_HOME, 'settings.json');
    try {
        let settings = {};
        // Load existing settings
        if (fs.existsSync(settingsPath)) {
            try {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            }
            catch {
                log('Could not parse existing settings.json, creating new one');
            }
        }
        // IMPORTANT: Do NOT write hooks to main settings.json
        // All hook config lives in ~/.claude/hooks/settings.json (deployed as a file)
        // Writing hooks here would cause DOUBLE-FIRING of every hook
        // Clean up any leftover specmem hooks from old deploys
        if (settings.hooks && Object.keys(settings.hooks).length > 0) {
            let cleaned = false;
            for (const [event, entries] of Object.entries(settings.hooks)) {
                if (Array.isArray(entries)) {
                    const filtered = entries.filter((entry) => {
                        const str = JSON.stringify(entry);
                        // Remove specmem-related hooks (they live in hooks/settings.json now)
                        if (str.includes('specmem') || str.includes('smart-context') ||
                            str.includes('drilldown') || str.includes('input-aware') ||
                            str.includes('agent-loading') || str.includes('subagent-loading') ||
                            str.includes('task-progress') || str.includes('precompact')) {
                            cleaned = true;
                            return false;
                        }
                        return true;
                    });
                    settings.hooks[event] = filtered;
                }
            }
            // Remove empty hook arrays
            for (const [event, entries] of Object.entries(settings.hooks)) {
                if (Array.isArray(entries) && entries.length === 0) {
                    delete settings.hooks[event];
                }
            }
            if (cleaned) {
                log('Cleaned up duplicate specmem hooks from main settings.json');
            }
        }
        // Add permissions for SpecMem tools (this DOES belong in main settings.json)
        if (!settings.permissions) {
            settings.permissions = { allow: [] };
        }
        if (!settings.permissions.allow) {
            settings.permissions.allow = [];
        }
        const specmemPermissions = [
            'mcp__specmem__*'
        ];
        for (const perm of specmemPermissions) {
            if (!settings.permissions.allow.includes(perm)) {
                settings.permissions.allow.push(perm);
            }
        }
        // Write updated settings
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        log('Updated settings.json (permissions only — hooks in hooks/settings.json)');
        return true;
    }
    catch (error) {
        log(`Failed to update settings.json: ${error}`);
        return false;
    }
}
export async function deployTo() {
    const version = getSpecMemVersion();
    const result = {
        success: true,
        hooksDeployed: [],
        hooksSkipped: [],
        commandsDeployed: [],
        commandsSkipped: [],
        settingsUpdated: false,
        errors: [],
        version,
    };
    log('Starting SpecMem deployment to ...');
    log(`SpecMem version: ${version}`);
    log(`SpecMem root: ${SPECMEM_ROOT}`);
    log(` home: ${CLAUDE_HOME}`);
    // Load existing manifests for version checking
    const hooksManifest = loadManifest(HOOKS_TARGET);
    const commandsManifest = loadManifest(COMMANDS_TARGET);
    // Track new manifest entries
    const newHooksManifest = {
        specmemVersion: version,
        deployedAt: new Date().toISOString(),
        files: {}
    };
    const newCommandsManifest = {
        specmemVersion: version,
        deployedAt: new Date().toISOString(),
        files: {}
    };
    // Ensure target directories exist
    if (!ensureDir(HOOKS_TARGET)) {
        result.errors.push(`Failed to create hooks directory: ${HOOKS_TARGET}`);
        result.success = false;
    }
    if (!ensureDir(COMMANDS_TARGET)) {
        result.errors.push(`Failed to create commands directory: ${COMMANDS_TARGET}`);
        result.success = false;
    }
    // Deploy hooks
    if (fs.existsSync(HOOKS_SOURCE)) {
        // Get all hook files from source
        const allHookFiles = new Set(HOOK_FILES);
        try {
            const sourceFiles = fs.readdirSync(HOOKS_SOURCE);
            for (const file of sourceFiles) {
                if (file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.sh') || file.endsWith('.cjs') || file.endsWith('.json')) {
                    allHookFiles.add(file);
                }
            }
        }
        catch {
            // Use predefined list only
        }
        for (const file of allHookFiles) {
            const source = path.join(HOOKS_SOURCE, file);
            const target = path.join(HOOKS_TARGET, file);
            if (fs.existsSync(source)) {
                const { copied, hash } = copyFile(source, target, hooksManifest);
                if (copied) {
                    result.hooksDeployed.push(file);
                }
                else {
                    result.hooksSkipped.push(file);
                }
                // Track in manifest
                if (hash) {
                    newHooksManifest.files[file] = {
                        hash,
                        size: fs.statSync(source).size,
                        deployedAt: new Date().toISOString()
                    };
                }
            }
        }
        // Save hooks manifest
        saveManifest(HOOKS_TARGET, newHooksManifest);
    }
    else {
        log(`Hooks source directory not found: ${HOOKS_SOURCE}`);
        result.errors.push(`Hooks source directory not found: ${HOOKS_SOURCE}`);
    }
    // Deploy commands
    if (fs.existsSync(COMMANDS_SOURCE)) {
        // Get all command files from source
        const allCommandFiles = new Set(COMMAND_FILES);
        try {
            const sourceFiles = fs.readdirSync(COMMANDS_SOURCE);
            for (const file of sourceFiles) {
                if (file.endsWith('.md')) {
                    allCommandFiles.add(file);
                }
            }
        }
        catch {
            // Use predefined list only
        }
        for (const file of allCommandFiles) {
            const source = path.join(COMMANDS_SOURCE, file);
            const target = path.join(COMMANDS_TARGET, file);
            if (fs.existsSync(source)) {
                const { copied, hash } = copyFile(source, target, commandsManifest);
                if (copied) {
                    result.commandsDeployed.push(file);
                }
                else {
                    result.commandsSkipped.push(file);
                }
                // Track in manifest
                if (hash) {
                    newCommandsManifest.files[file] = {
                        hash,
                        size: fs.statSync(source).size,
                        deployedAt: new Date().toISOString()
                    };
                }
            }
        }
        // Save commands manifest
        saveManifest(COMMANDS_TARGET, newCommandsManifest);
    }
    else {
        log(`Commands source directory not found: ${COMMANDS_SOURCE}`);
        result.errors.push(`Commands source directory not found: ${COMMANDS_SOURCE}`);
    }
    // Update 's settings.json to register hooks
    result.settingsUpdated = updateSettings();
    // Summary
    const totalDeployed = result.hooksDeployed.length + result.commandsDeployed.length;
    const totalSkipped = result.hooksSkipped.length + result.commandsSkipped.length;
    if (totalDeployed > 0) {
        log(`Deployment complete! Version: ${version}`);
        log(`  Hooks deployed: ${result.hooksDeployed.length} (${result.hooksSkipped.length} unchanged)`);
        log(`  Commands deployed: ${result.commandsDeployed.length} (${result.commandsSkipped.length} unchanged)`);
        log(`  Settings updated: ${result.settingsUpdated}`);
    }
    else if (totalSkipped > 0) {
        log(`All files up-to-date (${totalSkipped} files checked)`);
    }
    else {
        log('No files found to deploy');
    }
    if (result.errors.length > 0) {
        log(`Errors: ${result.errors.length}`);
        result.success = false;
    }
    return result;
}
/**
 * Quick deploy function for use during MCP startup
 * Runs silently unless there are errors
 */
export async function autoDeployHooks() {
    try {
        const result = await deployTo();
        return result.success;
    }
    catch (error) {
        log(`Auto-deploy failed: ${error}`);
        return false;
    }
}
// Export for external use
export { getSpecMemVersion, loadManifest };
// ============================================================================
// CLI Entry Point
// ============================================================================
// Run directly if this is the main module
const isMainModule = process.argv[1]?.includes('deploy-to-claude');
if (isMainModule) {
    deployTo()
        .then((result) => {
        console.log('\n========================================');
        console.log('  SpecMem Hook Deployment Report');
        console.log('========================================\n');
        console.log(`Version: ${result.version}`);
        console.log(`Status: ${result.success ? 'SUCCESS' : 'COMPLETED WITH ERRORS'}\n`);
        if (result.hooksDeployed.length > 0) {
            console.log(`Hooks deployed to ${HOOKS_TARGET}:`);
            result.hooksDeployed.forEach(f => console.log(`  + ${f}`));
        }
        if (result.hooksSkipped.length > 0) {
            console.log(`\nHooks unchanged (same version):`);
            result.hooksSkipped.forEach(f => console.log(`  = ${f}`));
        }
        if (result.commandsDeployed.length > 0) {
            console.log(`\nCommands deployed to ${COMMANDS_TARGET}:`);
            result.commandsDeployed.forEach(f => console.log(`  + ${f}`));
        }
        if (result.commandsSkipped.length > 0) {
            console.log(`\nCommands unchanged (same version):`);
            result.commandsSkipped.forEach(f => console.log(`  = ${f}`));
        }
        console.log(`\nSettings.json: ${result.settingsUpdated ? 'Updated' : 'Already configured'}`);
        if (result.errors.length > 0) {
            console.error('\nErrors:');
            result.errors.forEach(e => console.error(`  ! ${e}`));
        }
        console.log('\n========================================\n');
        if (result.success) {
            console.log('SpecMem hooks are now ready. Restart  to activate.\n');
            process.exit(0);
        }
        else {
            process.exit(1);
        }
    })
        .catch((error) => {
        console.error('Deployment failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=deploy-to-claude.js.map