/**
 * System Dependency Detection and Auto-Installation
 *
 * yo this detects and installs system-level dependencies
 * handles PostgreSQL, pgvector, and other OS-level stuff
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { getSpawnEnv } from '../utils/index.js';
/**
 * Execute a shell command and return output
 */
function execCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        // bruh ALWAYS pass env for project isolation
        const proc = spawn(command, args, { shell: true, env: getSpawnEnv() });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (data) => { stdout += data.toString(); });
        proc.stderr?.on('data', (data) => { stderr += data.toString(); });
        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(`${command} failed: ${stderr || stdout}`));
            }
        });
        proc.on('error', reject);
    });
}
/**
 * Detect which package manager is available
 */
export async function detectPackageManager() {
    const managers = [
        { name: 'apt', cmd: 'apt-get', check: '--version' },
        { name: 'yum', cmd: 'yum', check: '--version' },
        { name: 'dnf', cmd: 'dnf', check: '--version' },
        { name: 'brew', cmd: 'brew', check: '--version' },
        { name: 'pacman', cmd: 'pacman', check: '--version' }
    ];
    for (const manager of managers) {
        try {
            await execCommand(manager.cmd, [manager.check]);
            logger.debug({ packageManager: manager.name }, 'detected package manager');
            return manager.name;
        }
        catch {
            // manager not available, try next
        }
    }
    return undefined;
}
/**
 * Check if PostgreSQL is installed
 */
export async function checkPostgresInstalled() {
    try {
        const version = await execCommand('psql', ['--version']);
        const match = version.match(/PostgreSQL (\d+\.\d+)/);
        return {
            installed: true,
            version: match ? match[1] : undefined
        };
    }
    catch {
        return { installed: false };
    }
}
/**
 * Check if pgvector is installed
 */
export async function checkPgvectorInstalled() {
    // check for common pgvector package locations
    const possiblePaths = [
        '/usr/lib/postgresql/16/lib/vector.so',
        '/usr/lib/postgresql/15/lib/vector.so',
        '/usr/lib/postgresql/14/lib/vector.so',
        '/usr/local/lib/postgresql/vector.so',
        '/opt/homebrew/lib/postgresql@16/vector.so',
        '/opt/homebrew/lib/postgresql@15/vector.so'
    ];
    for (const path of possiblePaths) {
        if (existsSync(path)) {
            logger.debug({ path }, 'found pgvector library');
            return true;
        }
    }
    // try to check via dpkg/rpm/brew
    try {
        await execCommand('dpkg', ['-l', 'postgresql-*-pgvector']);
        return true;
    }
    catch {
        // not found
    }
    try {
        await execCommand('rpm', ['-q', 'pgvector']);
        return true;
    }
    catch {
        // not found
    }
    try {
        await execCommand('brew', ['list', 'pgvector']);
        return true;
    }
    catch {
        // not found
    }
    return false;
}
/**
 * Check if we can install packages (have sudo/root)
 */
export async function canInstallPackages() {
    // check if running as root
    if (process.getuid && process.getuid() === 0) {
        return true;
    }
    // check if sudo is available
    try {
        await execCommand('sudo', ['-n', 'true']);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check all system dependencies
 */
export async function checkSystemDeps() {
    logger.info('checking system dependencies...');
    const platform = process.platform;
    const packageManager = await detectPackageManager();
    const postgresCheck = await checkPostgresInstalled();
    const pgvectorInstalled = await checkPgvectorInstalled();
    const canInstall = await canInstallPackages();
    const result = {
        postgresInstalled: postgresCheck.installed,
        postgresVersion: postgresCheck.version,
        pgvectorInstalled,
        canInstallPackages: canInstall,
        platform,
        packageManager
    };
    logger.info(result, 'system dependency check complete');
    return result;
}
/**
 * Install PostgreSQL using system package manager
 */
export async function installPostgres(packageManager) {
    if (!packageManager) {
        logger.error('no package manager detected, cannot auto-install PostgreSQL');
        return false;
    }
    logger.info({ packageManager }, 'installing PostgreSQL...');
    try {
        switch (packageManager) {
            case 'apt':
                await execCommand('sudo', ['apt-get', 'update']);
                await execCommand('sudo', ['apt-get', 'install', '-y', 'postgresql', 'postgresql-contrib']);
                break;
            case 'yum':
            case 'dnf':
                await execCommand('sudo', [packageManager, 'install', '-y', 'postgresql-server', 'postgresql-contrib']);
                await execCommand('sudo', ['postgresql-setup', '--initdb']);
                await execCommand('sudo', ['systemctl', 'enable', 'postgresql']);
                await execCommand('sudo', ['systemctl', 'start', 'postgresql']);
                break;
            case 'brew':
                await execCommand('brew', ['install', 'postgresql@16']);
                await execCommand('brew', ['services', 'start', 'postgresql@16']);
                break;
            case 'pacman':
                await execCommand('sudo', ['pacman', '-S', '--noconfirm', 'postgresql']);
                await execCommand('sudo', ['su', '-', 'postgres', '-c', 'initdb -D /var/lib/postgres/data']);
                await execCommand('sudo', ['systemctl', 'enable', 'postgresql']);
                await execCommand('sudo', ['systemctl', 'start', 'postgresql']);
                break;
            default:
                logger.error({ packageManager }, 'unsupported package manager');
                return false;
        }
        logger.info('PostgreSQL installed successfully');
        return true;
    }
    catch (err) {
        logger.error({ err }, 'failed to install PostgreSQL');
        return false;
    }
}
/**
 * Install pgvector extension using system package manager
 */
export async function installPgvector(packageManager, pgVersion) {
    if (!packageManager) {
        logger.error('no package manager detected, cannot auto-install pgvector');
        return false;
    }
    logger.info({ packageManager, pgVersion }, 'installing pgvector...');
    try {
        switch (packageManager) {
            case 'apt': {
                const version = pgVersion || '16';
                await execCommand('sudo', ['apt-get', 'update']);
                await execCommand('sudo', ['apt-get', 'install', '-y', `postgresql-${version}-pgvector`]);
                break;
            }
            case 'yum':
            case 'dnf':
                // pgvector might need to be compiled from source on RHEL/CentOS
                logger.warn('pgvector auto-install not fully supported on RHEL/CentOS, may need manual compilation');
                await execCommand('sudo', [packageManager, 'install', '-y', 'pgvector']);
                break;
            case 'brew':
                await execCommand('brew', ['install', 'pgvector']);
                break;
            case 'pacman':
                await execCommand('sudo', ['pacman', '-S', '--noconfirm', 'pgvector']);
                break;
            default:
                logger.error({ packageManager }, 'unsupported package manager');
                return false;
        }
        logger.info('pgvector installed successfully');
        return true;
    }
    catch (err) {
        logger.error({ err }, 'failed to install pgvector');
        return false;
    }
}
/**
 * Auto-install missing system dependencies
 */
export async function autoInstallSystemDeps() {
    const check = await checkSystemDeps();
    if (!check.canInstallPackages) {
        logger.warn('cannot install packages - no sudo access');
        logger.warn('you may need to manually install PostgreSQL and pgvector');
        return check;
    }
    // install PostgreSQL if missing
    if (!check.postgresInstalled) {
        logger.warn('PostgreSQL not installed, attempting auto-install...');
        const installed = await installPostgres(check.packageManager);
        if (installed) {
            // re-check to get version
            const postgresCheck = await checkPostgresInstalled();
            check.postgresInstalled = postgresCheck.installed;
            check.postgresVersion = postgresCheck.version;
        }
    }
    // install pgvector if missing
    if (!check.pgvectorInstalled && check.postgresInstalled) {
        logger.warn('pgvector not installed, attempting auto-install...');
        const installed = await installPgvector(check.packageManager, check.postgresVersion);
        if (installed) {
            check.pgvectorInstalled = true;
        }
    }
    return check;
}
/**
 * Show manual installation instructions
 */
export function showManualInstallInstructions(check) {
    logger.info('='.repeat(60));
    logger.info('MANUAL INSTALLATION REQUIRED');
    logger.info('='.repeat(60));
    if (!check.postgresInstalled) {
        logger.info('PostgreSQL is not installed.');
        logger.info('Please install PostgreSQL 14 or later:');
        if (check.platform === 'linux') {
            logger.info('Ubuntu/Debian:');
            logger.info('  sudo apt-get update');
            logger.info('  sudo apt-get install postgresql postgresql-contrib');
            logger.info('RHEL/CentOS:');
            logger.info('  sudo yum install postgresql-server postgresql-contrib');
            logger.info('  sudo postgresql-setup --initdb');
            logger.info('  sudo systemctl enable postgresql');
            logger.info('  sudo systemctl start postgresql');
        }
        else if (check.platform === 'darwin') {
            logger.info('macOS:');
            logger.info('  brew install postgresql@16');
            logger.info('  brew services start postgresql@16');
        }
    }
    if (!check.pgvectorInstalled) {
        logger.info('pgvector extension is not installed.');
        logger.info('Please install pgvector:');
        if (check.platform === 'linux') {
            logger.info('Ubuntu/Debian:');
            logger.info('  sudo apt-get install postgresql-16-pgvector');
            logger.info('RHEL/CentOS (compile from source):');
            logger.info('  git clone https://github.com/pgvector/pgvector.git');
            logger.info('  cd pgvector');
            logger.info('  make');
            logger.info('  sudo make install');
        }
        else if (check.platform === 'darwin') {
            logger.info('macOS:');
            logger.info('  brew install pgvector');
        }
    }
    logger.info('Alternative: Use Docker');
    logger.info('  docker run -d \\');
    logger.info('    --name specmem-db \\');
    logger.info('    -e POSTGRES_USER=specmem_westayunprofessional \\');
    logger.info('    -e POSTGRES_PASSWORD=${SPECMEM_PASSWORD:-specmem_westayunprofessional} \\');
    logger.info('    -e POSTGRES_DB=specmem_westayunprofessional \\');
    logger.info('    -p 5432:5432 \\');
    logger.info('    ankane/pgvector:latest');
    logger.info('='.repeat(60));
}
//# sourceMappingURL=systemDeps.js.map