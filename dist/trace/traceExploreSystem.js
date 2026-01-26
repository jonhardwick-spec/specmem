/**
 * traceExploreSystem.ts - Trace & Root Cause Analysis System
 *
 * yo this is the BIG BRAIN system for  Code fr fr
 * reduces full codebase searches by 80%+ through intelligent recall
 *
 * Features:
 * - Error pattern recognition and root cause mapping
 * - Bug pattern detection and solution history
 * - Code relationship graphs with impact analysis
 * - Smart dependency exploration
 * - Intelligent caching of search patterns
 * - Pre-computed dependency graphs
 *
 * EMBEDDING DIMENSION NOTE:
 * DEPRECATED: SPECMEM_EMBEDDING_DIMENSIONS is no longer used.
 * Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The system auto-migrates when dimension mismatch is detected at startup.
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
// === MAIN SYSTEM CLASS ===
/**
 * TraceExploreSystem - the brain for error tracing and dependency exploration
 *
 * reduces 's search overhead by:
 * 1. Mapping errors to known root causes
 * 2. Caching successful search patterns
 * 3. Pre-computing dependency graphs
 * 4. Learning from solution history
 */
export class TraceExploreSystem {
    db;
    embeddingProvider;
    isInitialized = false;
    // In-memory caches for fast lookups
    traceCache = new Map();
    bugPatternCache = new Map();
    searchPatternCache = new Map();
    dependencyGraph = new Map();
    // Performance metrics
    metrics = {
        traceLookups: 0,
        traceCacheHits: 0,
        bugPatternLookups: 0,
        bugPatternCacheHits: 0,
        searchCacheLookups: 0,
        searchCacheHits: 0,
        totalSearchesAvoided: 0
    };
    constructor(db, embeddingProvider = null) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    /**
     * Initialize the trace/explore system
     * Sets up tables and loads caches
     */
    async initialize() {
        if (this.isInitialized)
            return;
        logger.info('initializing trace/explore system...');
        try {
            // Create tables if they don't exist
            await this.ensureTables();
            // Load hot data into caches
            await this.loadCaches();
            this.isInitialized = true;
            logger.info({
                tracesLoaded: this.traceCache.size,
                bugPatternsLoaded: this.bugPatternCache.size,
                searchPatternsLoaded: this.searchPatternCache.size
            }, 'trace/explore system initialized - WE READY TO TRACE');
        }
        catch (error) {
            logger.error({ error }, 'failed to initialize trace/explore system');
            throw error;
        }
    }
    /**
     * Ensure all required tables exist
     */
    async ensureTables() {
        // Create code_traces table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS code_traces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        error_pattern TEXT NOT NULL,
        error_signature VARCHAR(255) NOT NULL,
        root_cause_code_ids UUID[] DEFAULT '{}',
        root_cause_files TEXT[] DEFAULT '{}',
        solution_history JSONB DEFAULT '[]',
        hit_count INTEGER DEFAULT 0,
        last_hit_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        -- NOTE: Dimension is auto-detected from memories table, unbounded initially
        embedding vector
      )
    `);
        // Create indexes for code_traces
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_traces_signature
        ON code_traces(error_signature)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_traces_hit_count
        ON code_traces(hit_count DESC)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_traces_embedding_hnsw
        ON code_traces USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
        // Create bug_patterns table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS bug_patterns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        error_signature VARCHAR(255) NOT NULL UNIQUE,
        error_type VARCHAR(100),
        common_files TEXT[] DEFAULT '{}',
        common_keywords TEXT[] DEFAULT '{}',
        resolution_stats JSONB DEFAULT '{}',
        occurrence_count INTEGER DEFAULT 1,
        last_occurrence_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        -- NOTE: Dimension is auto-detected from memories table, unbounded initially
        embedding vector
      )
    `);
        // Create indexes for bug_patterns
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_bug_patterns_signature
        ON bug_patterns(error_signature)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_bug_patterns_type
        ON bug_patterns(error_type)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_bug_patterns_embedding_hnsw
        ON bug_patterns USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
        // Create code_relationships table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS code_relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_code_id UUID NOT NULL,
        from_file_path TEXT NOT NULL,
        to_code_id UUID NOT NULL,
        to_file_path TEXT NOT NULL,
        relationship_type VARCHAR(50) NOT NULL,
        strength FLOAT DEFAULT 1.0 CHECK (strength >= 0 AND strength <= 1),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(from_code_id, to_code_id, relationship_type)
      )
    `);
        // Create indexes for code_relationships
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_from
        ON code_relationships(from_code_id)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_to
        ON code_relationships(to_code_id)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_type
        ON code_relationships(relationship_type)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_from_path
        ON code_relationships(from_file_path)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_to_path
        ON code_relationships(to_file_path)
    `);
        // Create search_pattern_cache table
        await this.db.query(`
      CREATE TABLE IF NOT EXISTS search_pattern_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        search_query TEXT NOT NULL,
        search_hash VARCHAR(64) NOT NULL UNIQUE,
        result_file_ids UUID[] DEFAULT '{}',
        result_file_paths TEXT[] DEFAULT '{}',
        hit_count INTEGER DEFAULT 1,
        last_hit_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        -- NOTE: Dimension is auto-detected from memories table, unbounded initially
        embedding vector
      )
    `);
        // Create indexes for search_pattern_cache
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_search_pattern_cache_hash
        ON search_pattern_cache(search_hash)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_search_pattern_cache_hits
        ON search_pattern_cache(hit_count DESC)
    `);
        await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_search_pattern_cache_embedding_hnsw
        ON search_pattern_cache USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
        logger.debug('trace/explore tables created');
    }
    /**
     * Load hot data into in-memory caches
     */
    async loadCaches() {
        // Load top traces by hit count
        const tracesResult = await this.db.query(`
      SELECT * FROM code_traces
      ORDER BY hit_count DESC
      LIMIT 1000
    `);
        for (const row of tracesResult.rows) {
            this.traceCache.set(row.error_signature, {
                id: row.id,
                errorPattern: row.error_pattern,
                errorSignature: row.error_signature,
                rootCauseCodeIds: row.root_cause_code_ids || [],
                rootCauseFiles: row.root_cause_files || [],
                solutionHistory: row.solution_history || [],
                hitCount: row.hit_count,
                lastHitAt: row.last_hit_at,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            });
        }
        // Load top bug patterns
        const patternsResult = await this.db.query(`
      SELECT * FROM bug_patterns
      ORDER BY occurrence_count DESC
      LIMIT 500
    `);
        for (const row of patternsResult.rows) {
            this.bugPatternCache.set(row.error_signature, {
                id: row.id,
                errorSignature: row.error_signature,
                errorType: row.error_type,
                commonFiles: row.common_files || [],
                commonKeywords: row.common_keywords || [],
                resolutionStats: row.resolution_stats || { totalResolved: 0, avgResolutionTimeMs: 0, commonSolutions: [], successfulPatterns: [] },
                occurrenceCount: row.occurrence_count,
                lastOccurrenceAt: row.last_occurrence_at,
                createdAt: row.created_at
            });
        }
        // Load top search patterns
        const searchResult = await this.db.query(`
      SELECT * FROM search_pattern_cache
      ORDER BY hit_count DESC
      LIMIT 2000
    `);
        for (const row of searchResult.rows) {
            this.searchPatternCache.set(row.search_hash, {
                id: row.id,
                searchQuery: row.search_query,
                searchHash: row.search_hash,
                resultFileIds: row.result_file_ids || [],
                resultFilePaths: row.result_file_paths || [],
                hitCount: row.hit_count,
                lastHitAt: row.last_hit_at,
                createdAt: row.created_at
            });
        }
    }
    // === CORE TRACE FUNCTIONALITY ===
    /**
     * Trace an error to find likely root causes
     * This is THE key method for reducing search overhead
     */
    async traceError(errorMessage, stackTrace) {
        this.metrics.traceLookups++;
        // Generate error signature
        const signature = this.generateErrorSignature(errorMessage, stackTrace);
        // Check cache first
        let cachedTrace = this.traceCache.get(signature);
        if (cachedTrace) {
            this.metrics.traceCacheHits++;
            this.metrics.totalSearchesAvoided++;
            // Update hit count in background
            this.updateTraceHit(cachedTrace.id).catch(e => logger.warn({ error: e }, 'failed to update trace hit'));
            return this.buildTraceResult(cachedTrace, signature);
        }
        // Search for similar traces using embeddings
        if (this.embeddingProvider) {
            const embedding = await this.embeddingProvider.generateEmbedding(`${errorMessage}\n${stackTrace || ''}`);
            const similarTraces = await this.findSimilarTraces(embedding, 0.85);
            if (similarTraces.length > 0) {
                this.metrics.totalSearchesAvoided++;
                return this.buildTraceResult(similarTraces[0], signature, similarTraces);
            }
        }
        // No cached trace found - return empty result with suggestions
        return {
            errorPattern: signature,
            matchingTraces: [],
            suggestedRootCauses: await this.inferRootCauses(errorMessage, stackTrace),
            similarBugs: await this.findSimilarBugPatterns(errorMessage),
            previousSolutions: [],
            searchReductionPercent: 0
        };
    }
    /**
     * Generate a normalized error signature for matching
     */
    generateErrorSignature(errorMessage, stackTrace) {
        // Extract error type
        const typeMatch = errorMessage.match(/^(\w+Error|\w+Exception):/);
        const errorType = typeMatch ? typeMatch[1] : 'UnknownError';
        // Extract key parts, removing line numbers and specific values
        let normalized = errorMessage
            .replace(/\d+/g, 'N') // Replace numbers with N
            .replace(/['"`][^'"`]+['"`]/g, 'S') // Replace strings with S
            .replace(/\s+/g, ' ') // Normalize whitespace
            .slice(0, 200); // Limit length
        // Add first stack frame if available
        if (stackTrace) {
            const firstFrame = stackTrace.split('\n')[0];
            if (firstFrame) {
                normalized += '|' + firstFrame.replace(/:\d+:\d+/g, ':N:N').slice(0, 100);
            }
        }
        // Generate hash
        return this.hashString(`${errorType}:${normalized}`);
    }
    /**
     * Build a trace result with all relevant information
     */
    async buildTraceResult(trace, signature, additionalTraces) {
        const searchReduction = Math.min(95, 70 + (trace.hitCount * 0.5));
        return {
            errorPattern: signature,
            matchingTraces: additionalTraces || [trace],
            suggestedRootCauses: trace.rootCauseFiles.map((file, i) => ({
                file,
                confidence: Math.max(0.5, 1 - (i * 0.1)),
                reason: `Previously identified as root cause (${trace.hitCount} occurrences)`
            })),
            similarBugs: await this.findSimilarBugPatterns(trace.errorPattern),
            previousSolutions: trace.solutionHistory,
            searchReductionPercent: searchReduction
        };
    }
    /**
     * Find similar traces using vector similarity
     */
    async findSimilarTraces(embedding, threshold) {
        const embeddingStr = `[${embedding.join(',')}]`;
        const result = await this.db.query(`
      SELECT *,
        1 - (embedding <=> $1::vector) as similarity
      FROM code_traces
      WHERE embedding IS NOT NULL
        AND (1 - (embedding <=> $1::vector)) > $2
      ORDER BY embedding <=> $1::vector
      LIMIT 5
    `, [embeddingStr, threshold]);
        return result.rows.map((row) => ({
            id: row.id,
            errorPattern: row.error_pattern,
            errorSignature: row.error_signature,
            rootCauseCodeIds: row.root_cause_code_ids || [],
            rootCauseFiles: row.root_cause_files || [],
            solutionHistory: row.solution_history || [],
            hitCount: row.hit_count,
            lastHitAt: row.last_hit_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }
    /**
     * Infer potential root causes from error message
     */
    async inferRootCauses(errorMessage, stackTrace) {
        const causes = [];
        // Extract file paths from stack trace
        if (stackTrace) {
            const fileRegex = /at\s+.+\s+\((.+):\d+:\d+\)/g;
            let fileMatch;
            while ((fileMatch = fileRegex.exec(stackTrace)) !== null) {
                const filePath = fileMatch[1];
                if (filePath && !filePath.includes('node_modules')) {
                    causes.push({
                        file: filePath,
                        confidence: 0.6,
                        reason: 'Mentioned in stack trace'
                    });
                }
            }
        }
        // Extract module references from error message
        const moduleRegex = /['"]([^'"]+\.(ts|js|tsx|jsx))['"]/g;
        let moduleMatch;
        while ((moduleMatch = moduleRegex.exec(errorMessage)) !== null) {
            causes.push({
                file: moduleMatch[1],
                confidence: 0.5,
                reason: 'Referenced in error message'
            });
        }
        return causes.slice(0, 10);
    }
    /**
     * Find similar bug patterns
     */
    async findSimilarBugPatterns(errorMessage) {
        this.metrics.bugPatternLookups++;
        // Check cache for exact match
        const cachedPatterns = Array.from(this.bugPatternCache.values());
        for (const pattern of cachedPatterns) {
            if (errorMessage.includes(pattern.errorType)) {
                this.metrics.bugPatternCacheHits++;
                return [pattern];
            }
        }
        // Search database for similar patterns
        const result = await this.db.query(`
      SELECT * FROM bug_patterns
      WHERE error_type = ANY($1::text[])
         OR error_signature LIKE $2
      ORDER BY occurrence_count DESC
      LIMIT 5
    `, [
            this.extractErrorTypes(errorMessage),
            '%' + errorMessage.slice(0, 50) + '%'
        ]);
        return result.rows.map((row) => ({
            id: row.id,
            errorSignature: row.error_signature,
            errorType: row.error_type,
            commonFiles: row.common_files || [],
            commonKeywords: row.common_keywords || [],
            resolutionStats: row.resolution_stats || { totalResolved: 0, avgResolutionTimeMs: 0, commonSolutions: [], successfulPatterns: [] },
            occurrenceCount: row.occurrence_count,
            lastOccurrenceAt: row.last_occurrence_at,
            createdAt: row.created_at
        }));
    }
    /**
     * Extract error types from message
     */
    extractErrorTypes(message) {
        const types = [];
        const patterns = [
            /(\w+Error)/g,
            /(\w+Exception)/g,
            /(\w+Failure)/g
        ];
        for (const pattern of patterns) {
            let match;
            // Clone regex to reset lastIndex
            const regex = new RegExp(pattern.source, pattern.flags);
            while ((match = regex.exec(message)) !== null) {
                types.push(match[1]);
            }
        }
        // Deduplicate using Array.filter
        return types.filter((type, index) => types.indexOf(type) === index);
    }
    /**
     * Update trace hit count
     */
    async updateTraceHit(traceId) {
        await this.db.query(`
      UPDATE code_traces
      SET hit_count = hit_count + 1,
          last_hit_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [traceId]);
    }
    // === DEPENDENCY EXPLORATION ===
    /**
     * Explore dependencies of a file
     * Shows what a file imports and what imports it
     */
    async exploreDependencies(filePath, depth = 2) {
        // Get direct relationships
        const importsResult = await this.db.query(`
      SELECT to_file_path FROM code_relationships
      WHERE from_file_path = $1
        AND relationship_type IN ('imports', 'depends_on')
    `, [filePath]);
        const importedByResult = await this.db.query(`
      SELECT from_file_path FROM code_relationships
      WHERE to_file_path = $1
        AND relationship_type IN ('imports', 'depends_on')
    `, [filePath]);
        const imports = importsResult.rows.map((r) => r.to_file_path);
        const importedBy = importedByResult.rows.map((r) => r.from_file_path);
        // Build dependency chain up to depth
        const dependencyChain = [[filePath]];
        const visited = new Set([filePath]);
        for (let d = 0; d < depth; d++) {
            const currentLevel = dependencyChain[d] || [];
            const nextLevel = [];
            for (const file of currentLevel) {
                const deps = await this.db.query(`
          SELECT to_file_path FROM code_relationships
          WHERE from_file_path = $1
            AND relationship_type IN ('imports', 'depends_on')
        `, [file]);
                for (const row of deps.rows) {
                    if (!visited.has(row.to_file_path)) {
                        visited.add(row.to_file_path);
                        nextLevel.push(row.to_file_path);
                    }
                }
            }
            if (nextLevel.length > 0) {
                dependencyChain.push(nextLevel);
            }
            else {
                break;
            }
        }
        return {
            file: filePath,
            imports,
            importedBy,
            dependencyChain,
            totalDependencies: visited.size - 1
        };
    }
    /**
     * Analyze impact of changes to a file
     * Shows what would be affected if the file changes
     */
    async analyzeImpact(filePath) {
        // Get direct dependents
        const directResult = await this.db.query(`
      SELECT DISTINCT from_file_path FROM code_relationships
      WHERE to_file_path = $1
        AND relationship_type IN ('imports', 'depends_on', 'calls')
    `, [filePath]);
        const directDependents = directResult.rows.map((r) => r.from_file_path);
        // Get indirect dependents (files that depend on direct dependents)
        const indirectDependents = [];
        const visited = new Set([filePath, ...directDependents]);
        for (const dep of directDependents) {
            const indirect = await this.db.query(`
        SELECT DISTINCT from_file_path FROM code_relationships
        WHERE to_file_path = $1
          AND relationship_type IN ('imports', 'depends_on', 'calls')
      `, [dep]);
            for (const row of indirect.rows) {
                if (!visited.has(row.from_file_path)) {
                    visited.add(row.from_file_path);
                    indirectDependents.push(row.from_file_path);
                }
            }
        }
        // Identify test files
        const allAffected = [...directDependents, ...indirectDependents];
        const testFilesAffected = allAffected.filter(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
        // Calculate risk level
        const totalAffected = allAffected.length;
        let riskLevel = 'low';
        if (totalAffected > 50)
            riskLevel = 'critical';
        else if (totalAffected > 20)
            riskLevel = 'high';
        else if (totalAffected > 5)
            riskLevel = 'medium';
        // Extract affected modules
        const affectedModules = [...new Set(allAffected.map(f => f.split('/')[0] || 'root'))];
        return {
            targetFile: filePath,
            directDependents,
            indirectDependents,
            totalAffectedFiles: totalAffected,
            riskLevel,
            affectedModules,
            testFilesAffected,
            suggestedTestScope: testFilesAffected.length > 0
                ? testFilesAffected.slice(0, 10)
                : [`Run full test suite - ${totalAffected} files affected`]
        };
    }
    // === CACHING AND RECORDING ===
    /**
     * Record a successful trace for future lookups
     */
    async recordTrace(errorMessage, stackTrace, rootCauseFiles, solution) {
        const signature = this.generateErrorSignature(errorMessage, stackTrace);
        const id = uuidv4();
        // Generate embedding if provider available
        let embeddingStr = null;
        if (this.embeddingProvider) {
            const embedding = await this.embeddingProvider.generateEmbedding(`${errorMessage}\n${stackTrace || ''}`);
            embeddingStr = `[${embedding.join(',')}]`;
        }
        const solutionHistory = solution ? [solution] : [];
        await this.db.query(`
      INSERT INTO code_traces (
        id, error_pattern, error_signature, root_cause_files,
        solution_history, hit_count, embedding
      ) VALUES ($1, $2, $3, $4, $5, 1, $6)
      ON CONFLICT (error_signature) DO UPDATE SET
        root_cause_files = ARRAY_CAT(code_traces.root_cause_files, $4),
        solution_history = code_traces.solution_history || $5::jsonb,
        hit_count = code_traces.hit_count + 1,
        updated_at = NOW()
    `, [id, errorMessage, signature, rootCauseFiles, JSON.stringify(solutionHistory), embeddingStr]);
        // Update cache
        this.traceCache.set(signature, {
            id,
            errorPattern: errorMessage,
            errorSignature: signature,
            rootCauseCodeIds: [],
            rootCauseFiles,
            solutionHistory,
            hitCount: 1,
            lastHitAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        });
        return id;
    }
    /**
     * Record a code relationship
     */
    async recordRelationship(fromFilePath, toFilePath, relationshipType, strength = 1.0) {
        const fromId = uuidv4();
        const toId = uuidv4();
        await this.db.query(`
      INSERT INTO code_relationships (
        id, from_code_id, from_file_path, to_code_id, to_file_path,
        relationship_type, strength
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (from_code_id, to_code_id, relationship_type) DO UPDATE SET
        strength = GREATEST(code_relationships.strength, $7),
        updated_at = NOW()
    `, [uuidv4(), fromId, fromFilePath, toId, toFilePath, relationshipType, strength]);
    }
    /**
     * Cache a search pattern for future use
     */
    async cacheSearchPattern(searchQuery, resultFilePaths) {
        const searchHash = this.hashString(searchQuery);
        // Generate embedding if provider available
        let embeddingStr = null;
        if (this.embeddingProvider) {
            const embedding = await this.embeddingProvider.generateEmbedding(searchQuery);
            embeddingStr = `[${embedding.join(',')}]`;
        }
        await this.db.query(`
      INSERT INTO search_pattern_cache (
        id, search_query, search_hash, result_file_paths, embedding
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (search_hash) DO UPDATE SET
        hit_count = search_pattern_cache.hit_count + 1,
        last_hit_at = NOW()
    `, [uuidv4(), searchQuery, searchHash, resultFilePaths, embeddingStr]);
        // Update cache
        this.searchPatternCache.set(searchHash, {
            id: uuidv4(),
            searchQuery,
            searchHash,
            resultFileIds: [],
            resultFilePaths,
            hitCount: 1,
            lastHitAt: new Date(),
            createdAt: new Date()
        });
    }
    /**
     * Look up cached search results
     */
    async getCachedSearchResults(searchQuery) {
        this.metrics.searchCacheLookups++;
        const searchHash = this.hashString(searchQuery);
        const cached = this.searchPatternCache.get(searchHash);
        if (cached) {
            this.metrics.searchCacheHits++;
            this.metrics.totalSearchesAvoided++;
            // Update hit count in background
            this.db.query(`
        UPDATE search_pattern_cache
        SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE search_hash = $1
      `, [searchHash]).catch(e => logger.warn({ error: e }, 'failed to update search cache hit'));
            return cached.resultFilePaths;
        }
        // Try semantic similarity search
        if (this.embeddingProvider) {
            const embedding = await this.embeddingProvider.generateEmbedding(searchQuery);
            const embeddingStr = `[${embedding.join(',')}]`;
            const result = await this.db.query(`
        SELECT result_file_paths,
          1 - (embedding <=> $1::vector) as similarity
        FROM search_pattern_cache
        WHERE embedding IS NOT NULL
          AND (1 - (embedding <=> $1::vector)) > 0.9
        ORDER BY embedding <=> $1::vector
        LIMIT 1
      `, [embeddingStr]);
            if (result.rows.length > 0) {
                this.metrics.searchCacheHits++;
                this.metrics.totalSearchesAvoided++;
                return result.rows[0].result_file_paths;
            }
        }
        return null;
    }
    // === UTILITY METHODS ===
    /**
     * Hash a string for cache keys
     */
    hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) + hash) ^ char;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }
    /**
     * Get system metrics
     */
    getMetrics() {
        const traceCacheHitRate = this.metrics.traceLookups > 0
            ? this.metrics.traceCacheHits / this.metrics.traceLookups
            : 0;
        const bugPatternCacheHitRate = this.metrics.bugPatternLookups > 0
            ? this.metrics.bugPatternCacheHits / this.metrics.bugPatternLookups
            : 0;
        const searchCacheHitRate = this.metrics.searchCacheLookups > 0
            ? this.metrics.searchCacheHits / this.metrics.searchCacheLookups
            : 0;
        const totalLookups = this.metrics.traceLookups +
            this.metrics.bugPatternLookups +
            this.metrics.searchCacheLookups;
        const estimatedSearchReduction = totalLookups > 0
            ? (this.metrics.totalSearchesAvoided / totalLookups) * 100
            : 0;
        return {
            ...this.metrics,
            traceCacheHitRate,
            bugPatternCacheHitRate,
            searchCacheHitRate,
            estimatedSearchReduction
        };
    }
    /**
     * Shutdown and cleanup
     */
    async shutdown() {
        this.traceCache.clear();
        this.bugPatternCache.clear();
        this.searchPatternCache.clear();
        this.dependencyGraph.clear();
        this.isInitialized = false;
        logger.info('trace/explore system shut down');
    }
}
// Singleton instance
let traceSystemInstance = null;
/**
 * Get the singleton trace/explore system instance
 */
export function getTraceExploreSystem(db, embeddingProvider) {
    if (!traceSystemInstance) {
        if (!db) {
            throw new Error('Database required for initial TraceExploreSystem creation');
        }
        traceSystemInstance = new TraceExploreSystem(db, embeddingProvider || null);
    }
    return traceSystemInstance;
}
/**
 * Reset the singleton (for testing)
 */
export function resetTraceExploreSystem() {
    if (traceSystemInstance) {
        traceSystemInstance.shutdown();
        traceSystemInstance = null;
    }
}
//# sourceMappingURL=traceExploreSystem.js.map