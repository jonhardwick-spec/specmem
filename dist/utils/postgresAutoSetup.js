/**
 * postgresAutoSetup.ts - Auto-install and configure PostgreSQL + pgvector
 *
 * Handles:
 * - Detecting if postgres is installed
 * - Installing postgres if missing (apt-get)
 * - Installing pgvector extension
 * - Creating specmem database and user
 * - Setting up required schemas
 *
 * @author hardwicksoftwareservices
 */
import { execSync, spawnSync } from 'child_process';
import { logger } from './logger.js';
// ============================================================================
// Detection Functions
// ============================================================================
/**
 * Check if a command exists
 */
function commandExists(cmd) {
    try {
        execSync(`which ${cmd}`, { stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if postgres is installed
 */
function isPostgresInstalled() {
    return commandExists('psql') && commandExists('pg_isready');
}
/**
 * Check if postgres service is running
 */
function isPostgresRunning() {
    try {
        const result = spawnSync('pg_isready', ['-h', 'localhost', '-p', '5432'], {
            stdio: 'pipe',
            timeout: 5000
        });
        return result.status === 0;
    }
    catch {
        return false;
    }
}
/**
 * Get postgres version
 */
function getPostgresVersion() {
    try {
        const output = execSync('psql --version', { encoding: 'utf-8', stdio: 'pipe' });
        const match = output.match(/PostgreSQL\s+([\d.]+)/);
        return match?.[1];
    }
    catch {
        return undefined;
    }
}
/**
 * Check if pgvector extension is available
 */
function isPgvectorInstalled() {
    try {
        // Check if pgvector package is installed
        const result = execSync('dpkg -l | grep postgresql.*pgvector || apt list --installed 2>/dev/null | grep pgvector', {
            encoding: 'utf-8',
            stdio: 'pipe'
        });
        return result.includes('pgvector');
    }
    catch {
        return false;
    }
}
/**
 * Check if specmem database exists
 */
function specmemDbExists(dbName = 'specmem_westayunprofessional') {
    try {
        execSync(`sudo -u postgres psql -lqt | grep -w ${dbName}`, {
            stdio: 'pipe',
            timeout: 5000
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if specmem user exists
 */
function specmemUserExists(userName = 'specmem_westayunprofessional') {
    try {
        execSync(`sudo -u postgres psql -c "SELECT 1 FROM pg_roles WHERE rolname='${userName}'" | grep -q 1`, {
            stdio: 'pipe',
            timeout: 5000
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get full postgres status
 */
export function getPostgresStatus() {
    return {
        installed: isPostgresInstalled(),
        running: isPostgresRunning(),
        version: getPostgresVersion(),
        pgvectorInstalled: isPgvectorInstalled(),
        specmemDbExists: specmemDbExists(),
        specmemUserExists: specmemUserExists()
    };
}
// ============================================================================
// Installation Functions
// ============================================================================
/**
 * Install PostgreSQL via apt
 */
function installPostgres() {
    logger.info('Installing PostgreSQL...');
    try {
        execSync('apt-get update && apt-get install -y postgresql postgresql-contrib', {
            stdio: 'inherit',
            timeout: 300000 // 5 min timeout
        });
        // Start the service
        execSync('systemctl start postgresql && systemctl enable postgresql', {
            stdio: 'inherit'
        });
        logger.info('PostgreSQL installed successfully');
        return true;
    }
    catch (err) {
        logger.error({ err }, 'Failed to install PostgreSQL');
        return false;
    }
}
/**
 * Install pgvector extension
 */
function installPgvector() {
    logger.info('Installing pgvector extension...');
    try {
        // Get postgres version for package name
        const version = getPostgresVersion()?.split('.')[0] || '16';
        // Try to install pgvector package
        try {
            execSync(`apt-get install -y postgresql-${version}-pgvector`, {
                stdio: 'inherit',
                timeout: 120000
            });
        }
        catch {
            // Fallback: try generic pgvector or build from source
            logger.warn('Package install failed, trying alternative methods...');
            try {
                execSync('apt-get install -y postgresql-pgvector', { stdio: 'inherit' });
            }
            catch {
                // Last resort: install from pgdg repo
                execSync(`
          sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' &&
          wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - &&
          apt-get update &&
          apt-get install -y postgresql-${version}-pgvector
        `, { stdio: 'inherit', timeout: 180000 });
            }
        }
        logger.info('pgvector installed successfully');
        return true;
    }
    catch (err) {
        logger.error({ err }, 'Failed to install pgvector');
        return false;
    }
}
/**
 * Create specmem database and user
 */
function createSpecmemDb(dbName = 'specmem_westayunprofessional', userName = 'specmem_westayunprofessional', password = 'specmem_westayunprofessional') {
    logger.info({ dbName, userName }, 'Creating specmem database and user...');
    try {
        // Create user if not exists
        execSync(`sudo -u postgres psql -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${userName}') THEN CREATE USER ${userName} WITH PASSWORD '${password}'; END IF; END \\$\\$;"`, {
            stdio: 'pipe'
        });
        // Create database if not exists
        execSync(`sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname = '${dbName}'" | grep -q 1 || sudo -u postgres createdb -O ${userName} ${dbName}`, {
            stdio: 'pipe'
        });
        // Grant privileges
        execSync(`sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${userName};"`, {
            stdio: 'pipe'
        });
        // Grant CREATEDB for multi-project schema isolation
        // Each project creates its own schema (specmem_xxx) which requires this permission
        execSync(`sudo -u postgres psql -c "ALTER USER ${userName} CREATEDB;"`, {
            stdio: 'pipe'
        });
        // Enable pgvector extension
        execSync(`sudo -u postgres psql -d ${dbName} -c "CREATE EXTENSION IF NOT EXISTS vector;"`, {
            stdio: 'pipe'
        });
        // Grant schema privileges - includes CREATE for schema creation
        execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT ALL ON SCHEMA public TO ${userName};"`, {
            stdio: 'pipe'
        });
        // Grant CREATE permission on database (needed for schema creation)
        execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT CREATE ON DATABASE ${dbName} TO ${userName};"`, {
            stdio: 'pipe'
        });
        // Grant ALL on ALL tables (for any pre-existing tables)
        execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO ${userName};"`, {
            stdio: 'pipe'
        });
        // Grant ALL on ALL sequences (needed for serial/identity columns)
        execSync(`sudo -u postgres psql -d ${dbName} -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${userName};"`, {
            stdio: 'pipe'
        });
        // Set default privileges for future tables created by postgres
        execSync(`sudo -u postgres psql -d ${dbName} -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${userName};"`, {
            stdio: 'pipe'
        });
        execSync(`sudo -u postgres psql -d ${dbName} -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${userName};"`, {
            stdio: 'pipe'
        });
        // Reassign ownership of ALL existing tables to specmem user
        // This ensures DDL operations (ALTER TABLE) work during schema migrations
        execSync(`sudo -u postgres psql -d ${dbName} -c "DO \\$\\$ DECLARE r RECORD; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO ${userName}'; END LOOP; END \\$\\$;"`, {
            stdio: 'pipe'
        });
        // Reassign ownership of ALL sequences
        execSync(`sudo -u postgres psql -d ${dbName} -c "DO \\$\\$ DECLARE r RECORD; BEGIN FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequencename) || ' OWNER TO ${userName}'; END LOOP; END \\$\\$;"`, {
            stdio: 'pipe'
        });
        // Set default privileges for objects created by postgres to be owned by specmem user
        execSync(`sudo -u postgres psql -d ${dbName} -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO ${userName};"`, {
            stdio: 'pipe'
        });
        logger.info('Database and user created successfully (with full table permissions AND ownership)');
        return true;
    }
    catch (err) {
        logger.error({ err }, 'Failed to create database/user');
        return false;
    }
}
/**
 * Configure pg_hba.conf for local connections
 */
function configurePgHba() {
    logger.info('Configuring PostgreSQL authentication...');
    try {
        // Find pg_hba.conf location
        const hbaPath = execSync("sudo -u postgres psql -t -c \"SHOW hba_file;\"", {
            encoding: 'utf-8',
            stdio: 'pipe'
        }).trim();
        // Check if specmem entry exists
        try {
            execSync(`grep -q "specmem_westayunprofessional" ${hbaPath}`, { stdio: 'pipe' });
            logger.info('pg_hba.conf already configured');
            return true;
        }
        catch {
            // Add entry for specmem user
            execSync(`echo "local   all   specmem_westayunprofessional   md5" | sudo tee -a ${hbaPath}`, {
                stdio: 'pipe'
            });
            execSync(`echo "host    all   specmem_westayunprofessional   127.0.0.1/32   md5" | sudo tee -a ${hbaPath}`, {
                stdio: 'pipe'
            });
            // Reload postgres
            execSync('systemctl reload postgresql', { stdio: 'pipe' });
            logger.info('pg_hba.conf configured successfully');
            return true;
        }
    }
    catch (err) {
        logger.error({ err }, 'Failed to configure pg_hba.conf');
        return false;
    }
}
// ============================================================================
// Main Setup Function
// ============================================================================
/**
 * Auto-setup PostgreSQL + pgvector + specmem database
 *
 * This function will:
 * 1. Check if postgres is installed, install if not
 * 2. Check if postgres is running, start if not
 * 3. Check if pgvector is installed, install if not
 * 4. Create specmem database and user if not exists
 * 5. Configure authentication
 */
export async function autoSetupPostgres(options) {
    const { dbName = 'specmem_westayunprofessional', userName = 'specmem_westayunprofessional', password = 'specmem_westayunprofessional', skipInstall = false } = options || {};
    logger.info('Starting PostgreSQL auto-setup...');
    let status = getPostgresStatus();
    // Step 1: Install postgres if needed
    if (!status.installed) {
        if (skipInstall) {
            return {
                success: false,
                message: 'PostgreSQL not installed and skipInstall=true',
                status
            };
        }
        logger.info('PostgreSQL not found, installing...');
        if (!installPostgres()) {
            return {
                success: false,
                message: 'Failed to install PostgreSQL',
                status: getPostgresStatus()
            };
        }
        status = getPostgresStatus();
    }
    // Step 2: Start postgres if not running
    if (!status.running) {
        logger.info('Starting PostgreSQL service...');
        try {
            execSync('systemctl start postgresql', { stdio: 'pipe' });
            // Wait for it to be ready
            for (let i = 0; i < 10; i++) {
                if (isPostgresRunning())
                    break;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        catch (err) {
            logger.error({ err }, 'Failed to start PostgreSQL');
        }
        status = getPostgresStatus();
        if (!status.running) {
            return {
                success: false,
                message: 'Failed to start PostgreSQL service',
                status
            };
        }
    }
    // Step 3: Install pgvector if needed
    if (!status.pgvectorInstalled) {
        if (skipInstall) {
            logger.warn('pgvector not installed and skipInstall=true');
        }
        else {
            logger.info('pgvector not found, installing...');
            installPgvector();
            status = getPostgresStatus();
        }
    }
    // Step 4: Create database and user
    if (!status.specmemDbExists || !status.specmemUserExists) {
        logger.info('Setting up specmem database...');
        if (!createSpecmemDb(dbName, userName, password)) {
            return {
                success: false,
                message: 'Failed to create specmem database/user',
                status: getPostgresStatus()
            };
        }
    }
    // Step 5: Configure authentication
    configurePgHba();
    // Final status check
    status = getPostgresStatus();
    const success = status.installed && status.running && status.specmemDbExists;
    return {
        success,
        message: success
            ? 'PostgreSQL setup complete'
            : 'PostgreSQL setup incomplete - check logs',
        status
    };
}
/**
 * Quick check if postgres is ready for specmem
 */
export function isPostgresReady() {
    const status = getPostgresStatus();
    return status.installed && status.running && status.specmemDbExists;
}
/**
 * Ensure postgres is ready, auto-setup if needed
 */
export async function ensurePostgresReady() {
    if (isPostgresReady()) {
        return true;
    }
    const result = await autoSetupPostgres();
    return result.success;
}
//# sourceMappingURL=postgresAutoSetup.js.map