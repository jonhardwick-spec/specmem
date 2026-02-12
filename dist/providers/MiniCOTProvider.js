/**
 * Mini COT Provider
 *
 * Connects to Mini COT Decision Model service via Unix socket
 * Converts search results into semantic gallery view with COT reasoning
 */
import { createConnection } from 'net';
import { existsSync } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { getRunDir } from '../config.js';
export class MiniCOTProvider {
    socketPath;
    timeout;
    constructor(socketPath = path.join(getRunDir(), '..', 'specmem', 'sockets', 'minicot.sock'), timeout = parseInt(process.env['SPECMEM_MINI_COT_TIMEOUT_MS'] || '30000', 10)) {
        this.socketPath = socketPath;
        this.timeout = timeout;
    }
    /**
     * Create gallery view from search results
     *
     * Sends memories to Mini COT model which:
     * 1. Analyzes relevance with COT reasoning
     * 2. Researches unknown terms
     * 3. Creates compacted thumbnails
     * 4. Sorts by relevance
     */
    async createGallery(query, memories) {
        // Fast-fail if socket doesn't exist (service not running)
        if (!existsSync(this.socketPath)) {
            throw new Error(`Mini COT service not running (no socket at ${this.socketPath})`);
        }
        return new Promise((resolve, reject) => {
            const socket = createConnection(this.socketPath);
            const timeoutId = setTimeout(() => {
                socket.destroy();
                reject(new Error(`Mini COT timeout after ${this.timeout}ms`));
            }, this.timeout);
            let responseData = '';
            socket.on('connect', () => {
                logger.debug({ query, memoryCount: memories.length }, 'sending to Mini COT');
                const request = {
                    query,
                    memories
                };
                socket.write(JSON.stringify(request) + '\n');
            });
            socket.on('data', (chunk) => {
                responseData += chunk.toString();
                // Check if we have complete response (ends with newline)
                if (responseData.includes('\n')) {
                    clearTimeout(timeoutId);
                    try {
                        const gallery = JSON.parse(responseData.trim());
                        if (gallery.error) {
                            reject(new Error(`Mini COT error: ${gallery.error}`));
                        }
                        else {
                            logger.info({
                                query,
                                galleryItems: gallery.gallery.length,
                                researchedTerms: gallery.total_researched_terms
                            }, 'Mini COT gallery created');
                            resolve(gallery);
                        }
                    }
                    catch (err) {
                        reject(new Error(`Mini COT response parse error: ${err}`));
                    }
                    socket.end();
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeoutId);
                logger.error({ error: err }, 'Mini COT socket error');
                reject(new Error(`Mini COT connection failed: ${err.message}`));
            });
            socket.on('timeout', () => {
                clearTimeout(timeoutId);
                socket.destroy();
                reject(new Error('Mini COT socket timeout'));
            });
        });
    }
    /**
     * Check if Mini COT service is available
     */
    async isAvailable() {
        try {
            const testMemories = [{
                    id: 'test',
                    keywords: '測試',
                    snippet: 'Test'
                }];
            await this.createGallery('test', testMemories);
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=MiniCOTProvider.js.map