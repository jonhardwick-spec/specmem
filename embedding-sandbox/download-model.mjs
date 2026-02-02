/**
 * MODEL DOWNLOADER
 *
 * Run this ONCE to download the model weights BEFORE deploying
 * the sandboxed container. This script DOES have network access.
 *
 * After running this, the model is cached locally and the
 * sandboxed container can run without any network access.
 *
 * Usage: node download-model.mjs
 */

import { pipeline, env } from '@huggingface/transformers';
import { existsSync, mkdirSync } from 'fs';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Set cache directory explicitly - this is where models will be stored
const CACHE_DIR = process.env.HF_HOME || '/home/embed/.cache/huggingface';
env.cacheDir = CACHE_DIR;

console.log('='.repeat(60));
console.log('SPECMEM MODEL DOWNLOADER');
console.log('='.repeat(60));
console.log('');
console.log('This downloads the embedding model (~23MB) for offline use.');
console.log('After download, the sandboxed container can run air-gapped.');
console.log('');
console.log('Model:', MODEL_NAME);
console.log('Cache Dir:', CACHE_DIR);
console.log('');

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

async function download() {
  console.log('Downloading model...');

  try {
    // This will download and cache the model
    const extractor = await pipeline('feature-extraction', MODEL_NAME, {
      device: 'cpu'
    });

    console.log('');
    console.log('Testing embedding generation...');

    // Test it works
    const testText = 'Hello, this is a test embedding.';
    const output = await extractor(testText, {
      pooling: 'mean',
      normalize: true
    });

    const embedding = Array.from(output.data);

    console.log('');
    console.log('SUCCESS!');
    console.log('');
    console.log('Model dimensions:', embedding.length);
    console.log('Sample embedding (first 5):', embedding.slice(0, 5));
    console.log('');
    console.log('='.repeat(60));
    console.log('Model is now cached locally.');
    console.log('The sandboxed container can now run without network access.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('DOWNLOAD FAILED:', error.message);
    console.error('');
    console.error('Make sure you have internet access and try again.');
    process.exit(1);
  }
}

download();
