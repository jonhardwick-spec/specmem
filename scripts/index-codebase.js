#!/usr/bin/env node
/**
 * Fast codebase indexer - populates code_definitions table
 * Run this before fast-batch-embedder.js
 */

// Set environment before importing
process.env.SPECMEM_CODEBASE_PATH = process.env.SPECMEM_CODEBASE_PATH || '/specmem';
process.env.SPECMEM_DB_HOST = process.env.SPECMEM_DB_HOST || 'localhost';
process.env.SPECMEM_DB_PORT = process.env.SPECMEM_DB_PORT || '5433';
process.env.SPECMEM_DB_NAME = process.env.SPECMEM_DB_NAME || 'specmem_westayunprofessional';
process.env.SPECMEM_DB_USER = process.env.SPECMEM_DB_USER || 'specmem_westayunprofessional';
process.env.SPECMEM_DB_PASSWORD = process.env.SPECMEM_DB_PASSWORD || 'specmem_westayunprofessional';

async function main() {
  console.log('=== SpecMem Codebase Indexer ===');
  console.log(`Codebase path: ${process.env.SPECMEM_CODEBASE_PATH}`);
  console.log('');

  // Import after env is set
  const { getCodebaseIndexer, resetCodebaseIndexer } = await import('../dist/codebase/codebaseIndexer.js');
  const { DatabaseManager } = await import('../dist/database.js');

  // Initialize database manager
  const db = new DatabaseManager({
    host: process.env.SPECMEM_DB_HOST,
    port: parseInt(process.env.SPECMEM_DB_PORT),
    database: process.env.SPECMEM_DB_NAME,
    user: process.env.SPECMEM_DB_USER,
    password: process.env.SPECMEM_DB_PASSWORD,
  });
  console.log('Database manager initialized');

  // Reset singleton first to use our db connection
  resetCodebaseIndexer();

  const indexer = getCodebaseIndexer({
    codebasePath: process.env.SPECMEM_CODEBASE_PATH,
    extractDefinitions: true,
    trackDependencies: true,
    calculateComplexity: false,
    chunkCode: false,
    generateEmbeddings: false,  // Embeddings handled separately
    watchForChanges: false,
    batchSize: 100,
  }, null, db);  // embeddingProvider=null, db=db

  console.log('Starting full scan...');
  const startTime = Date.now();

  try {
    await indexer.initialize();
    const stats = indexer.getStats();

    console.log('');
    console.log('=== Scan Complete ===');
    console.log(`Files: ${stats.totalFiles}`);
    console.log(`Definitions: ${stats.totalDefinitions}`);
    console.log(`Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    await indexer.shutdown();
    resetCodebaseIndexer();

    console.log('');
    console.log('Run fast-batch-embedder.js next to generate embeddings');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
