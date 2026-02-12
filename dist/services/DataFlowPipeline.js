/**
 * DATA FLOW PIPELINE
 *
 * Architecture:
 *   Raw Data → Embeddings → COT Drilldown → Compacted Content → Upchain
 *
 * Features:
 *   - Lightweight embeddings (pure keyword matching, no torch!)
 *   - COT drilldown for relevance analysis
 *   - Training absorption every 5m
 *   - Quick calls for on-demand processing
 *   - BackendPlus integration for violations/visitors
 */
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
export class DataFlowPipeline extends EventEmitter {
    db;
    trainingInterval = null;
    lastTrainingRun = new Date(0);
    processedHashes = new Set();
    constructor(db) {
        super();
        this.db = db;
    }
    /**
     * START PIPELINE
     * Initializes training absorption (every 5m)
     */
    async start() {
        console.log('🚀 Starting Data Flow Pipeline');
        console.log('   Raw Data → Embeddings → COT → Compacted → Upchain');
        console.log('   Training absorption: Every 5 minutes');
        // Run initial training absorption
        await this.runTrainingAbsorption();
        // Schedule training absorption every 5 minutes
        this.trainingInterval = setInterval(async () => {
            await this.runTrainingAbsorption();
        }, 5 * 60 * 1000); // 5 minutes
        console.log('✅ Pipeline started');
    }
    /**
     * STOP PIPELINE
     */
    stop() {
        if (this.trainingInterval) {
            clearInterval(this.trainingInterval);
            this.trainingInterval = null;
        }
        console.log('🛑 Pipeline stopped');
    }
    /**
     * QUICK CALL - On-demand processing
     * Used by BackendPlus for immediate violation/visitor analysis
     */
    async quickCall(data) {
        console.log(`⚡ Quick call: ${data.type} - "${data.content.substring(0, 50)}..."`);
        // Step 1: Generate embedding (lightweight)
        const embedded = await this.generateEmbedding(data);
        // Step 2: ACK check - skip if already processed
        if (this.processedHashes.has(embedded.dataHash)) {
            console.log('   ✓ ACK: Already processed (skipping)');
            // Return from cache/db
            return await this.getCachedAnalysis(embedded.dataHash);
        }
        // Step 3: COT drilldown
        const analysis = await this.cotDrilldown(embedded);
        // Step 4: Compact and prepare for upchain
        const processed = {
            ...embedded,
            analysis,
            processedAt: new Date()
        };
        // Step 5: Store and mark as processed
        await this.storeProcessed(processed);
        this.processedHashes.add(embedded.dataHash);
        // Step 6: Feed upchain if relevant
        if (analysis.needsUpchain) {
            this.emit('upchain', processed);
        }
        return processed;
    }
    /**
     * TRAINING ABSORPTION
     * Every 5m, absorb new violations/visitors that haven't been trained
     */
    async runTrainingAbsorption() {
        const startTime = Date.now();
        console.log('🧠 Training Absorption: Absorbing new data...');
        try {
            // Get unprocessed violations/visitors since last run
            const newData = await this.getUnprocessedData(this.lastTrainingRun);
            console.log(`   Found ${newData.length} new items to absorb`);
            let absorbed = 0;
            let skipped = 0;
            for (const data of newData) {
                try {
                    // Generate embedding
                    const embedded = await this.generateEmbedding(data);
                    // ACK check
                    if (this.processedHashes.has(embedded.dataHash)) {
                        skipped++;
                        continue;
                    }
                    // COT analysis
                    const analysis = await this.cotDrilldown(embedded);
                    // Store
                    await this.storeProcessed({
                        ...embedded,
                        analysis,
                        processedAt: new Date()
                    });
                    this.processedHashes.add(embedded.dataHash);
                    absorbed++;
                    // Feed upchain if relevant
                    if (analysis.needsUpchain) {
                        this.emit('upchain', { ...embedded, analysis });
                    }
                }
                catch (err) {
                    console.error(`   ⚠️ Failed to process item:`, err);
                }
            }
            this.lastTrainingRun = new Date();
            const elapsed = Date.now() - startTime;
            console.log(`✅ Training Absorption complete:`);
            console.log(`   Absorbed: ${absorbed}`);
            console.log(`   Skipped (ACK): ${skipped}`);
            console.log(`   Time: ${elapsed}ms`);
            this.emit('training-complete', { absorbed, skipped, elapsed });
        }
        catch (err) {
            console.error('❌ Training Absorption failed:', err);
            this.emit('training-error', err);
        }
    }
    /**
     * GENERATE EMBEDDING
     * Lightweight keyword-based embedding (NO torch model!)
     */
    async generateEmbedding(data) {
        const text = data.content;
        // Calculate hash for ACK checking
        const dataHash = crypto.createHash('sha256').update(text).digest('hex');
        // Extract keywords (lightweight!)
        const keywords = this.extractKeywords(text);
        // Generate simple embedding vector (keyword presence)
        // This is MUCH faster than torch models and uses <1% CPU!
        const embedding = this.keywordsToVector(keywords, text);
        return {
            ...data,
            embedding,
            keywords,
            dataHash
        };
    }
    /**
     * COT DRILLDOWN
     * Analyzes embedded data and determines relevance
     */
    async cotDrilldown(embedded) {
        const { content, keywords, type } = embedded;
        // Simple heuristic-based COT reasoning
        // TODO: Wire to mini-cot socket when available
        let relevance = 0.5;
        let reasoning = '';
        let needsUpchain = false;
        // Analyze based on type
        if (type === 'violation') {
            // High severity violations need upchain processing
            const severity = this.analyzeViolationSeverity(content, keywords);
            relevance = severity;
            needsUpchain = severity > 0.7;
            reasoning = `Violation severity: ${severity.toFixed(2)}`;
        }
        else if (type === 'visitor') {
            // Suspicious visitor patterns need upchain
            const suspicion = this.analyzeVisitorSuspicion(content, keywords);
            relevance = suspicion;
            needsUpchain = suspicion > 0.6;
            reasoning = `Visitor suspicion: ${suspicion.toFixed(2)}`;
        }
        else if (type === 'codebase') {
            // Technical content always relevant
            relevance = 0.8;
            needsUpchain = true;
            reasoning = 'Codebase content - always relevant';
        }
        else if (type === 'memory') {
            relevance = 0.7;
            needsUpchain = true;
            reasoning = 'Memory content - relevant';
        }
        // Compact content (extract key information)
        const compactedContent = this.compactContent(content, keywords);
        return {
            relevance,
            reasoning,
            compactedContent,
            needsUpchain
        };
    }
    /**
     * EXTRACT KEYWORDS
     * Lightweight keyword extraction (no NLP models!)
     */
    extractKeywords(text) {
        const words = text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3);
        // Count frequency
        const freq = {};
        words.forEach(w => freq[w] = (freq[w] || 0) + 1);
        // Return top keywords
        return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
    }
    /**
     * KEYWORDS TO VECTOR
     * Convert keywords to simple embedding vector
     */
    keywordsToVector(keywords, text) {
        // Simple 128-dim vector based on keyword hashing
        const vector = new Array(128).fill(0);
        keywords.forEach(keyword => {
            const hash = crypto.createHash('md5').update(keyword).digest();
            for (let i = 0; i < 16; i++) {
                vector[i * 8 + (hash[i] % 8)] += 1;
            }
        });
        // Normalize
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(val => magnitude > 0 ? val / magnitude : 0);
    }
    /**
     * ANALYZE VIOLATION SEVERITY
     */
    analyzeViolationSeverity(content, keywords) {
        const lower = content.toLowerCase();
        let severity = 0.3; // Base severity
        // High-risk patterns
        if (lower.includes('sql injection') || lower.includes('xss'))
            severity += 0.4;
        if (lower.includes('attack') || lower.includes('exploit'))
            severity += 0.3;
        if (lower.includes('ddos') || lower.includes('brute force'))
            severity += 0.2;
        if (keywords.includes('critical') || keywords.includes('severe'))
            severity += 0.2;
        return Math.min(severity, 1.0);
    }
    /**
     * ANALYZE VISITOR SUSPICION
     */
    analyzeVisitorSuspicion(content, keywords) {
        const lower = content.toLowerCase();
        let suspicion = 0.2; // Base suspicion
        // Suspicious patterns
        if (lower.includes('bot') || lower.includes('crawler'))
            suspicion += 0.3;
        if (lower.includes('scanner') || lower.includes('probe'))
            suspicion += 0.4;
        if (keywords.includes('automated') || keywords.includes('script'))
            suspicion += 0.2;
        if (lower.includes('multiple attempts'))
            suspicion += 0.3;
        return Math.min(suspicion, 1.0);
    }
    /**
     * COMPACT CONTENT
     * Extract and compress key information
     */
    compactContent(content, keywords) {
        // Take first 200 chars + keywords
        const preview = content.substring(0, 200);
        const keywordStr = keywords.slice(0, 5).join(', ');
        return `${preview}... [${keywordStr}]`;
    }
    /**
     * GET UNPROCESSED DATA
     * Fetch violations/visitors that haven't been trained since last run
     */
    async getUnprocessedData(since) {
        const data = [];
        try {
            // Get violations from BackendPlus
            const violations = await this.db.query(`
        SELECT id, ip, violation_type, details, timestamp
        FROM violations
        WHERE timestamp > $1
        AND NOT EXISTS (
          SELECT 1 FROM processed_training
          WHERE data_hash = encode(digest(violations.details::text, 'sha256'), 'hex')
        )
        ORDER BY timestamp DESC
        LIMIT 100
      `, [since]);
            violations.rows.forEach(row => {
                data.push({
                    id: row.id,
                    type: 'violation',
                    content: `${row.violation_type}: ${row.details} (IP: ${row.ip})`,
                    metadata: { ip: row.ip, timestamp: row.timestamp }
                });
            });
        }
        catch (err) {
            console.warn('⚠️ Could not fetch violations (table may not exist)');
        }
        // TODO: Add visitor data fetch when integrated
        return data;
    }
    /**
     * STORE PROCESSED DATA
     */
    async storeProcessed(data) {
        try {
            await this.db.query(`
        INSERT INTO processed_training (
          data_hash,
          data_type,
          content,
          keywords,
          embedding,
          relevance,
          reasoning,
          compacted_content,
          processed_at
        ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9)
        ON CONFLICT (data_hash) DO NOTHING
      `, [
                data.dataHash,
                data.type,
                data.content,
                data.keywords.join(','),
                `[${data.embedding.join(',')}]`,
                data.analysis.relevance,
                data.analysis.reasoning,
                data.analysis.compactedContent,
                data.processedAt
            ]);
        }
        catch (err) {
            console.error('⚠️ Failed to store processed data:', err);
            // Non-critical - continue
        }
    }
    /**
     * GET CACHED ANALYSIS
     */
    async getCachedAnalysis(dataHash) {
        const result = await this.db.query(`
      SELECT * FROM processed_training
      WHERE data_hash = $1
    `, [dataHash]);
        if (result.rows.length === 0) {
            throw new Error('Cache miss');
        }
        const row = result.rows[0];
        return {
            id: row.id,
            type: row.data_type,
            content: row.content,
            keywords: row.keywords.split(','),
            embedding: row.embedding,
            dataHash: row.data_hash,
            analysis: {
                relevance: row.relevance,
                reasoning: row.reasoning,
                compactedContent: row.compacted_content,
                needsUpchain: row.relevance > 0.6
            },
            processedAt: row.processed_at
        };
    }
}
//# sourceMappingURL=DataFlowPipeline.js.map