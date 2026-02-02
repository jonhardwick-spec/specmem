import { createRequire } from 'module';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
const require = createRequire(import.meta.url);
const msgpack5 = require('msgpack5');
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const msgpack = msgpack5();
const TOON_MAGIC = Buffer.from([0x54, 0x4F, 0x4F, 0x4E]); // "TOON"
const TOON_VERSION = 1;
const COMPRESSION_THRESHOLD = 256;
function computeChecksum(data) {
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
        checksum = ((checksum << 5) - checksum + data[i]) >>> 0;
    }
    return checksum;
}
function writeHeader(header) {
    const headerData = msgpack.encode(header);
    const headerSizeBuffer = Buffer.alloc(4);
    headerSizeBuffer.writeUInt32BE(headerData.length, 0);
    return Buffer.concat([headerSizeBuffer, headerData]);
}
function readHeader(buffer, offset) {
    const headerSize = buffer.readUInt32BE(offset);
    const headerData = buffer.subarray(offset + 4, offset + 4 + headerSize);
    const header = msgpack.decode(headerData);
    return { header, bytesRead: 4 + headerSize };
}
export class ToonFormat {
    static instance = null;
    constructor() { }
    static getInstance() {
        if (!ToonFormat.instance) {
            ToonFormat.instance = new ToonFormat();
        }
        return ToonFormat.instance;
    }
    async serialize(data, options = {}) {
        const startTime = Date.now();
        const { compress = true, compressionLevel = 6, metadata = {} } = options;
        const payloadBuffer = msgpack.encode(data);
        const originalSize = payloadBuffer.length;
        let finalPayload;
        let isCompressed = false;
        if (compress && originalSize > COMPRESSION_THRESHOLD) {
            try {
                const compressed = await gzipAsync(payloadBuffer, { level: compressionLevel });
                if (compressed.length < originalSize * 0.9) {
                    finalPayload = compressed;
                    isCompressed = true;
                }
                else {
                    finalPayload = payloadBuffer;
                }
            }
            catch (err) {
                logger.warn({ err }, 'compression failed, using raw data');
                finalPayload = payloadBuffer;
            }
        }
        else {
            finalPayload = payloadBuffer;
        }
        const header = {
            version: TOON_VERSION,
            compressed: isCompressed,
            originalSize,
            compressedSize: finalPayload.length,
            checksum: computeChecksum(finalPayload),
            createdAt: Date.now(),
            metadata
        };
        const headerBuffer = writeHeader(header);
        const fullBuffer = Buffer.concat([
            TOON_MAGIC,
            headerBuffer,
            finalPayload
        ]);
        const serializationTime = Date.now() - startTime;
        const stats = {
            originalSize,
            compressedSize: finalPayload.length,
            compressionRatio: isCompressed ? finalPayload.length / originalSize : 1,
            serializationTime
        };
        logger.debug({
            originalSize,
            compressedSize: finalPayload.length,
            ratio: stats.compressionRatio.toFixed(2),
            timeMs: serializationTime
        }, 'toon serialization complete');
        return { buffer: fullBuffer, stats };
    }
    async deserialize(buffer) {
        if (buffer.length < TOON_MAGIC.length) {
            throw new Error('buffer too small to be valid toon format');
        }
        const magic = buffer.subarray(0, TOON_MAGIC.length);
        if (!magic.equals(TOON_MAGIC)) {
            throw new Error('invalid toon magic bytes');
        }
        let offset = TOON_MAGIC.length;
        const { header, bytesRead } = readHeader(buffer, offset);
        offset += bytesRead;
        if (header.version > TOON_VERSION) {
            throw new Error(`unsupported toon version: ${header.version}`);
        }
        const payloadData = buffer.subarray(offset, offset + header.compressedSize);
        const checksum = computeChecksum(payloadData);
        if (checksum !== header.checksum) {
            throw new Error('toon checksum mismatch - data may be corrupted');
        }
        let decompressedData;
        if (header.compressed) {
            try {
                decompressedData = await gunzipAsync(payloadData);
            }
            catch (err) {
                throw new Error(`toon decompression failed: ${err.message}`);
            }
        }
        else {
            decompressedData = payloadData;
        }
        const payload = msgpack.decode(decompressedData);
        return { header, payload };
    }
    serializeSync(data, options = {}) {
        const startTime = Date.now();
        const { metadata = {} } = options;
        const payloadBuffer = msgpack.encode(data);
        const originalSize = payloadBuffer.length;
        const header = {
            version: TOON_VERSION,
            compressed: false,
            originalSize,
            compressedSize: originalSize,
            checksum: computeChecksum(payloadBuffer),
            createdAt: Date.now(),
            metadata
        };
        const headerBuffer = writeHeader(header);
        const fullBuffer = Buffer.concat([
            TOON_MAGIC,
            headerBuffer,
            payloadBuffer
        ]);
        const serializationTime = Date.now() - startTime;
        const stats = {
            originalSize,
            compressedSize: originalSize,
            compressionRatio: 1,
            serializationTime
        };
        return { buffer: fullBuffer, stats };
    }
    deserializeSync(buffer) {
        if (buffer.length < TOON_MAGIC.length) {
            throw new Error('buffer too small to be valid toon format');
        }
        const magic = buffer.subarray(0, TOON_MAGIC.length);
        if (!magic.equals(TOON_MAGIC)) {
            throw new Error('invalid toon magic bytes');
        }
        let offset = TOON_MAGIC.length;
        const { header, bytesRead } = readHeader(buffer, offset);
        offset += bytesRead;
        if (header.compressed) {
            throw new Error('sync deserialize does not support compressed data - use async deserialize');
        }
        const payloadData = buffer.subarray(offset, offset + header.compressedSize);
        const checksum = computeChecksum(payloadData);
        if (checksum !== header.checksum) {
            throw new Error('toon checksum mismatch - data may be corrupted');
        }
        const payload = msgpack.decode(payloadData);
        return { header, payload };
    }
    isToonFormat(buffer) {
        if (buffer.length < TOON_MAGIC.length) {
            return false;
        }
        const magic = buffer.subarray(0, TOON_MAGIC.length);
        return magic.equals(TOON_MAGIC);
    }
    getHeaderOnly(buffer) {
        try {
            if (!this.isToonFormat(buffer)) {
                return null;
            }
            const { header } = readHeader(buffer, TOON_MAGIC.length);
            return header;
        }
        catch (e) {
            // Not a valid TOON file format
            return null;
        }
    }
    estimateSize(data) {
        const encoded = msgpack.encode(data);
        return encoded.length;
    }
}
export const toonFormat = ToonFormat.getInstance();
export async function serializeToToon(data, options) {
    const { buffer } = await toonFormat.serialize(data, options);
    return buffer;
}
export async function deserializeFromToon(buffer) {
    const { payload } = await toonFormat.deserialize(buffer);
    return payload;
}
export function serializeToToonSync(data, options) {
    const { buffer } = toonFormat.serializeSync(data, options);
    return buffer;
}
export function deserializeFromToonSync(buffer) {
    const { payload } = toonFormat.deserializeSync(buffer);
    return payload;
}
//# sourceMappingURL=toonFormat.js.map