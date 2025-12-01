/**
 * Installer Module Exports
 *
 * yo exporting all the installer stuff fr fr
 */
export { areDepsInstalled, isTypeScriptBuilt, checkInstallation, installDependencies, buildTypeScript, runDatabaseMigrations, autoInstallEverything, type InstallCheckResult } from './autoInstall.js';
export { isThisTheFirstRodeo, createInitialConfig, loadConfig, markAsInstalled, createDefaultEnvFile, showWelcomeMessage, runFirstTimeSetup, type FirstRunConfig } from './firstRun.js';
export { checkSystemDeps, detectPackageManager, checkPostgresInstalled, checkPgvectorInstalled, canInstallPackages, installPostgres, installPgvector, autoInstallSystemDeps, showManualInstallInstructions, type SystemDepsCheck } from './systemDeps.js';
export { testPostgresConnection, detectAdminCredentials, checkDatabaseExists, checkUserExists, createDatabase, createUser, updateUserPassword, grantPrivileges, enablePgvector, grantSchemaPrivileges, autoSetupDatabase, quickSetupDatabase, type DbSetupConfig, type DbSetupResult } from './dbSetup.js';
//# sourceMappingURL=index.d.ts.map