#!/usr/bin/env npx ts-node
/**
 * Quick codebase indexer script
 * Runs the indexer to populate code_definitions table
 */

import { getCodebaseIndexer, resetCodebaseIndexer } from '../src/codebase/codebaseIndexer.js';

async function main() {
  console.log('=== SpecMem Codebase Indexer ===');
  console.log(`Codebase: ${process.env.SPECMEM_CODEBASE_PATH || process.cwd()}`);
  console.log('');

  // Get indexer instance with full config
  const indexer = getCodebaseIndexer({
    codebasePath: process.env.SPECMEM_CODEBASE_PATH || process.cwd(),
    extractDefinitions: true,
    trackDependencies: true,
    calculateComplexity: false,  // Skip complexity for speed
    chunkCode: false,            // Skip chunking for speed
    generateEmbeddings: false,   // We'll generate embeddings separately with fast embedder
    watchForChanges: false,
    batchSize: 100,
  });

  console.log('Starting full scan...');
  const startTime = Date.now();

  try {
    await indexer.initialize();
    const stats = indexer.getStats();

    console.log('');
    console.log('=== Scan Complete ===');
    console.log(`Files indexed: ${stats.totalFiles}`);
    console.log(`Definitions extracted: ${stats.totalDefinitions}`);
    console.log(`Dependencies tracked: ${stats.totalDependencies}`);
    console.log(`Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log('');
    console.log('Language breakdown:');
    Object.entries(stats.languageBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([lang, count]) => {
        console.log(`  ${lang}: ${count} files`);
      });

    if (stats.definitionBreakdown) {
      console.log('');
      console.log('Definition types:');
      Object.entries(stats.definitionBreakdown)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          console.log(`  ${type}: ${count}`);
        });
    }

    await indexer.shutdown();
    resetCodebaseIndexer();

    console.log('');
    console.log('Done! Now run fast-batch-embedder.js to generate embeddings.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
