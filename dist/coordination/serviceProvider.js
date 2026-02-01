/**
 * Service Provider - Handles service requests from team members
 *
 * TeamMembers can request services like:
 * - code_search: Search codebase semantically
 * - code_trace: Trace error to root cause
 * - code_explain: Get explanation for code
 * - memory_search: Search memory database
 * - dependencies: Get dependency graph
 *
 * @author hardwicksoftwareservices
 */
import { logger } from '../utils/logger.js';
/**
 * Service Provider - provides capabilities to team members
 */
export class ServiceProvider {
    db;
    embedding;
    constructor(db, embedding) {
        this.db = db;
        this.embedding = embedding;
    }
    /**
     * Handle a service request from a team member
     */
    async handleRequest(request) {
        logger.info({ service: request.service, teamMemberId: request.teamMemberId }, 'handling service request');
        try {
            switch (request.service) {
                case 'list_services':
                    return this.listServices(request);
                case 'code_search':
                    return await this.codeSearch(request);
                case 'code_trace':
                    return await this.codeTrace(request);
                case 'code_explain':
                    return await this.codeExplain(request);
                case 'memory_search':
                    return await this.memorySearch(request);
                case 'get_dependencies':
                    return await this.getDependencies(request);
                default:
                    return {
                        requestId: request.requestId,
                        success: false,
                        error: `Unknown service: ${request.service}`
                    };
            }
        }
        catch (error) {
            logger.error({ error, service: request.service }, 'service request failed');
            return {
                requestId: request.requestId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * List available services
     */
    listServices(request) {
        return {
            requestId: request.requestId,
            success: true,
            options: [
                {
                    id: 'code_search',
                    label: 'Search Codebase',
                    description: 'Search code semantically using embeddings',
                    params: { query: 'string', limit: 'number' }
                },
                {
                    id: 'code_trace',
                    label: 'Trace Error',
                    description: 'Find root cause of error from stack trace',
                    params: { error: 'string', stackTrace: 'string' }
                },
                {
                    id: 'code_explain',
                    label: 'Explain Code',
                    description: 'Get explanation for code at location',
                    params: { filePath: 'string', lineStart: 'number', lineEnd: 'number' }
                },
                {
                    id: 'memory_search',
                    label: 'Search Memory',
                    description: 'Search conversation memory semantically',
                    params: { query: 'string', limit: 'number' }
                },
                {
                    id: 'get_dependencies',
                    label: 'Get Dependencies',
                    description: 'Get dependency graph for file',
                    params: { filePath: 'string' }
                }
            ]
        };
    }
    /**
     * Code search service
     */
    async codeSearch(request) {
        const { query, limit = 10 } = request.params;
        if (!query || typeof query !== 'string') {
            return {
                requestId: request.requestId,
                success: false,
                error: 'query parameter required'
            };
        }
        // Search code chunks
        const result = await this.db.query(`
      SELECT
        file_path,
        content,
        start_line,
        end_line,
        chunk_type
      FROM code_chunks
      WHERE content_tsv @@ plainto_tsquery('english', $1)
      ORDER BY ts_rank(content_tsv, plainto_tsquery('english', $1)) DESC
      LIMIT $2
    `, [query, limit]);
        return {
            requestId: request.requestId,
            success: true,
            data: {
                results: result.rows,
                count: result.rows.length
            }
        };
    }
    /**
     * Code trace service
     */
    async codeTrace(request) {
        const { error, stackTrace } = request.params;
        if (!error || typeof error !== 'string') {
            return {
                requestId: request.requestId,
                success: false,
                error: 'error parameter required'
            };
        }
        // Check for existing traces
        const result = await this.db.query(`
      SELECT
        root_cause_files,
        solution_history,
        confidence_score
      FROM code_traces
      WHERE error_pattern ILIKE $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [`%${error}%`]);
        return {
            requestId: request.requestId,
            success: true,
            data: {
                traces: result.rows,
                hasHistory: result.rows.length > 0
            }
        };
    }
    /**
     * Code explain service
     */
    async codeExplain(request) {
        const { filePath, lineStart, lineEnd } = request.params;
        if (!filePath || typeof filePath !== 'string') {
            return {
                requestId: request.requestId,
                success: false,
                error: 'filePath parameter required'
            };
        }
        // Check for existing explanation
        const result = await this.db.query(`
      SELECT
        explanation_text,
        explanation_type,
        quality_score,
        use_count
      FROM code_explanations
      WHERE file_path = $1
        AND ($2::int IS NULL OR line_start <= $2)
        AND ($3::int IS NULL OR line_end >= $3)
      ORDER BY quality_score DESC, use_count DESC
      LIMIT 1
    `, [filePath, lineStart, lineEnd]);
        return {
            requestId: request.requestId,
            success: true,
            data: {
                explanation: result.rows[0] || null,
                hasExplanation: result.rows.length > 0
            }
        };
    }
    /**
     * Memory search service
     */
    async memorySearch(request) {
        const { query, limit = 10 } = request.params;
        if (!query || typeof query !== 'string') {
            return {
                requestId: request.requestId,
                success: false,
                error: 'query parameter required'
            };
        }
        // Search memories
        const result = await this.db.query(`
      SELECT
        id,
        content,
        memory_type,
        importance,
        tags,
        created_at
      FROM memories
      WHERE content_tsv @@ plainto_tsquery('english', $1)
      ORDER BY
        ts_rank(content_tsv, plainto_tsquery('english', $1)) DESC,
        importance DESC
      LIMIT $2
    `, [query, limit]);
        return {
            requestId: request.requestId,
            success: true,
            data: {
                memories: result.rows,
                count: result.rows.length
            }
        };
    }
    /**
     * Get dependencies service
     */
    async getDependencies(request) {
        const { filePath } = request.params;
        if (!filePath || typeof filePath !== 'string') {
            return {
                requestId: request.requestId,
                success: false,
                error: 'filePath parameter required'
            };
        }
        // Get dependencies
        const result = await this.db.query(`
      SELECT
        target_path,
        import_type,
        imported_names,
        is_external
      FROM code_dependencies cd
      JOIN codebase_files cf ON cd.source_file_id = cf.id
      WHERE cf.file_path = $1
      ORDER BY is_external, target_path
    `, [filePath]);
        return {
            requestId: request.requestId,
            success: true,
            data: {
                dependencies: result.rows,
                count: result.rows.length
            }
        };
    }
}
//# sourceMappingURL=serviceProvider.js.map