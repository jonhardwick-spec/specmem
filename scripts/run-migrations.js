#!/usr/bin/env node
/**
 * Run database migrations
 */

process.env.SPECMEM_DB_HOST = process.env.SPECMEM_DB_HOST || 'localhost';
process.env.SPECMEM_DB_PORT = process.env.SPECMEM_DB_PORT || '5433';
process.env.SPECMEM_DB_NAME = process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional';
process.env.SPECMEM_DB_USER = process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional';
process.env.SPECMEM_DB_PASSWORD = process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional';

async function main() {
  console.log('=== Running Database Migrations ===');
  console.log(`Database: ${process.env.SPECMEM_DB_NAME}`);
  console.log(`Host: ${process.env.SPECMEM_DB_HOST}:${process.env.SPECMEM_DB_PORT}`);
  console.log('');

  const { ConnectionPoolGoBrrr } = await import('../dist/db/connectionPoolGoBrrr.js');
  const { BigBrainMigrations } = await import('../dist/db/bigBrainMigrations.js');

  const dbConfig = {
    host: process.env.SPECMEM_DB_HOST || 'localhost',
    port: parseInt(process.env.SPECMEM_DB_PORT || '5433'),
    database: process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional',
    user: process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional',
    password: process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  };

  const pool = new ConnectionPoolGoBrrr(dbConfig);
  const migrations = new BigBrainMigrations(pool);

  try {
    await migrations.runAllMigrations();
    console.log('');
    console.log('=== Migrations Complete ===');
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    await pool.drainThePool();
  }
}

main();
