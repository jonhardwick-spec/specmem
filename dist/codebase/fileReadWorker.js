/**
 * fileReadWorker.js - Worker thread for parallel file I/O
 *
 * Used by the ingestion pipeline to parallelize file reading across CPU cores.
 * Each worker reads files, detects if binary, computes hashes, and returns results.
 *
 * Protocol:
 * - Receives: { files: string[], maxFileSizeBytes: number }
 * - Returns: { results: FileReadResult[] }
 */
import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

async function isBinaryBuffer(buffer) {
    // Check first 512 bytes for null bytes
    const checkLength = Math.min(buffer.length, 512);
    for (let i = 0; i < checkLength; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

function hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

async function processFiles(files, rootPath, maxFileSizeBytes) {
    const results = [];

    for (const filePath of files) {
        try {
            const stats = await fs.stat(filePath);

            if (stats.size > maxFileSizeBytes) {
                results.push({ filePath, skipped: true, reason: 'too_large' });
                continue;
            }

            // Read raw buffer first for binary check
            const rawBuffer = await fs.readFile(filePath);
            if (await isBinaryBuffer(rawBuffer)) {
                results.push({ filePath, skipped: true, reason: 'binary' });
                continue;
            }

            const content = rawBuffer.toString('utf-8');
            const contentHash = hashContent(content);
            const relativePath = path.relative(rootPath, filePath);

            results.push({
                filePath,
                relativePath,
                skipped: false,
                content,
                contentHash,
                sizeBytes: stats.size,
                lineCount: content.split('\n').length,
                charCount: content.length,
                lastModified: stats.mtime.toISOString(),
                fileName: path.basename(filePath),
                extension: path.extname(filePath).toLowerCase()
            });
        } catch (err) {
            results.push({
                filePath,
                skipped: true,
                reason: 'error',
                error: err.message || String(err)
            });
        }
    }

    return results;
}

// Worker entry point
if (parentPort) {
    parentPort.on('message', async (msg) => {
        if (msg.type === 'process') {
            try {
                const results = await processFiles(msg.files, msg.rootPath, msg.maxFileSizeBytes);
                parentPort.postMessage({ type: 'results', results });
            } catch (err) {
                parentPort.postMessage({ type: 'error', error: err.message || String(err) });
            }
        }
    });
}
