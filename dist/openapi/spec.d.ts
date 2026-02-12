/**
 * spec.ts - OpenAPI 3.0 Specification for SpecMem Dashboard API
 *
 * yo this documents ALL the API endpoints
 * Swagger UI ready, interactive docs fr fr
 * helps devs understand the API
 *
 * Issue #46 fix - API documentation with OpenAPI
 */
/**
 * OpenAPI 3.0 specification for SpecMem Dashboard
 */
export declare const openApiSpec: {
    openapi: string;
    info: {
        title: string;
        description: string;
        version: string;
        contact: {
            name: string;
            url: string;
        };
        license: {
            name: string;
            url: string;
        };
    };
    servers: {
        url: string;
        description: string;
    }[];
    tags: {
        name: string;
        description: string;
    }[];
    paths: {
        '/api/v1/health': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/api/v1/stats': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    401: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/api/v1/memories': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                parameters: ({
                    name: string;
                    in: string;
                    description: string;
                    schema: {
                        type: string;
                        default: number;
                        minimum: number;
                        maximum: number;
                        enum?: undefined;
                    };
                } | {
                    name: string;
                    in: string;
                    description: string;
                    schema: {
                        type: string;
                        default: number;
                        minimum: number;
                        maximum?: undefined;
                        enum?: undefined;
                    };
                } | {
                    name: string;
                    in: string;
                    description: string;
                    schema: {
                        type: string;
                        enum: string[];
                        default?: undefined;
                        minimum?: undefined;
                        maximum?: undefined;
                    };
                } | {
                    name: string;
                    in: string;
                    description: string;
                    schema: {
                        type: string;
                        default?: undefined;
                        minimum?: undefined;
                        maximum?: undefined;
                        enum?: undefined;
                    };
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    401: {
                        description: string;
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    201: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    400: {
                        description: string;
                    };
                    401: {
                        description: string;
                    };
                };
            };
        };
        '/api/v1/memories/{id}': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    description: string;
                    schema: {
                        type: string;
                        format: string;
                    };
                }[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    404: {
                        description: string;
                    };
                };
            };
            put: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                        format: string;
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
            delete: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                parameters: {
                    name: string;
                    in: string;
                    required: boolean;
                    schema: {
                        type: string;
                        format: string;
                    };
                }[];
                responses: {
                    204: {
                        description: string;
                    };
                    404: {
                        description: string;
                    };
                };
            };
        };
        '/api/v1/memories/search': {
            post: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/api/v1/codebase/stats': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/api/v1/codebase/files': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                parameters: ({
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                        default: number;
                    };
                    description?: undefined;
                } | {
                    name: string;
                    in: string;
                    description: string;
                    schema: {
                        type: string;
                        default?: undefined;
                    };
                })[];
                responses: {
                    200: {
                        description: string;
                    };
                };
            };
        };
        '/api/v1/skills': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/api/v1/teamMembers': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                security: ({
                    cookieAuth: any[];
                    headerAuth?: undefined;
                } | {
                    headerAuth: any[];
                    cookieAuth?: undefined;
                })[];
                responses: {
                    200: {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/api/v1/metrics': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                responses: {
                    200: {
                        description: string;
                        content: {
                            'text/plain': {
                                schema: {
                                    type: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        '/ws': {
            get: {
                tags: string[];
                summary: string;
                description: string;
                operationId: string;
                responses: {
                    101: {
                        description: string;
                    };
                };
            };
        };
    };
    components: {
        schemas: {
            Error: {
                type: string;
                properties: {
                    error: {
                        type: string;
                    };
                    code: {
                        type: string;
                    };
                    details: {
                        type: string;
                    };
                };
                required: string[];
            };
            HealthResponse: {
                type: string;
                properties: {
                    status: {
                        type: string;
                        enum: string[];
                    };
                    version: {
                        type: string;
                    };
                    apiVersion: {
                        type: string;
                    };
                    uptime: {
                        type: string;
                    };
                    timestamp: {
                        type: string;
                        format: string;
                    };
                };
            };
            StatsResponse: {
                type: string;
                properties: {
                    memories: {
                        type: string;
                        properties: {
                            total: {
                                type: string;
                            };
                            byType: {
                                type: string;
                            };
                            byImportance: {
                                type: string;
                            };
                            withEmbeddings: {
                                type: string;
                            };
                        };
                    };
                    codebase: {
                        type: string;
                        properties: {
                            totalFiles: {
                                type: string;
                            };
                            totalLines: {
                                type: string;
                            };
                            languages: {
                                type: string;
                            };
                        };
                    };
                    system: {
                        type: string;
                        properties: {
                            heapUsedMB: {
                                type: string;
                            };
                            heapTotalMB: {
                                type: string;
                            };
                            uptime: {
                                type: string;
                            };
                        };
                    };
                };
            };
            Memory: {
                type: string;
                properties: {
                    id: {
                        type: string;
                        format: string;
                    };
                    content: {
                        type: string;
                    };
                    memoryType: {
                        type: string;
                        enum: string[];
                    };
                    importance: {
                        type: string;
                        enum: string[];
                    };
                    tags: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    metadata: {
                        type: string;
                    };
                    hasEmbedding: {
                        type: string;
                    };
                    accessCount: {
                        type: string;
                    };
                    createdAt: {
                        type: string;
                        format: string;
                    };
                    updatedAt: {
                        type: string;
                        format: string;
                    };
                };
            };
            MemoriesListResponse: {
                type: string;
                properties: {
                    memories: {
                        type: string;
                        items: {
                            $ref: string;
                        };
                    };
                    total: {
                        type: string;
                    };
                    limit: {
                        type: string;
                    };
                    offset: {
                        type: string;
                    };
                    nextCursor: {
                        type: string;
                    };
                };
            };
            CreateMemoryRequest: {
                type: string;
                required: string[];
                properties: {
                    content: {
                        type: string;
                        minLength: number;
                    };
                    memoryType: {
                        type: string;
                        enum: string[];
                    };
                    importance: {
                        type: string;
                        enum: string[];
                    };
                    tags: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    metadata: {
                        type: string;
                    };
                    generateEmbedding: {
                        type: string;
                        default: boolean;
                    };
                };
            };
            UpdateMemoryRequest: {
                type: string;
                properties: {
                    content: {
                        type: string;
                    };
                    memoryType: {
                        type: string;
                    };
                    importance: {
                        type: string;
                    };
                    tags: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    metadata: {
                        type: string;
                    };
                };
            };
            SemanticSearchRequest: {
                type: string;
                required: string[];
                properties: {
                    query: {
                        type: string;
                    };
                    limit: {
                        type: string;
                        default: number;
                        minimum: number;
                        maximum: number;
                    };
                    threshold: {
                        type: string;
                        default: number;
                        minimum: number;
                        maximum: number;
                    };
                    types: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    tags: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                };
            };
            SearchResultsResponse: {
                type: string;
                properties: {
                    results: {
                        type: string;
                        items: {
                            type: string;
                            properties: {
                                memory: {
                                    $ref: string;
                                };
                                similarity: {
                                    type: string;
                                };
                            };
                        };
                    };
                    total: {
                        type: string;
                    };
                    queryTimeMs: {
                        type: string;
                    };
                };
            };
            CodebaseStatsResponse: {
                type: string;
                properties: {
                    totalFiles: {
                        type: string;
                    };
                    totalLines: {
                        type: string;
                    };
                    totalBytes: {
                        type: string;
                    };
                    languages: {
                        type: string;
                        additionalProperties: {
                            type: string;
                            properties: {
                                files: {
                                    type: string;
                                };
                                lines: {
                                    type: string;
                                };
                            };
                        };
                    };
                    lastIndexed: {
                        type: string;
                        format: string;
                    };
                    isWatching: {
                        type: string;
                    };
                };
            };
            SkillsListResponse: {
                type: string;
                properties: {
                    skills: {
                        type: string;
                        items: {
                            type: string;
                            properties: {
                                name: {
                                    type: string;
                                };
                                category: {
                                    type: string;
                                };
                                description: {
                                    type: string;
                                };
                                path: {
                                    type: string;
                                };
                            };
                        };
                    };
                    total: {
                        type: string;
                    };
                    categories: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                };
            };
            TeamMembersListResponse: {
                type: string;
                properties: {
                    teamMembers: {
                        type: string;
                        items: {
                            type: string;
                            properties: {
                                id: {
                                    type: string;
                                };
                                name: {
                                    type: string;
                                };
                                status: {
                                    type: string;
                                    enum: string[];
                                };
                                connectedAt: {
                                    type: string;
                                    format: string;
                                };
                                lastHeartbeat: {
                                    type: string;
                                    format: string;
                                };
                            };
                        };
                    };
                    total: {
                        type: string;
                    };
                };
            };
        };
        securitySchemes: {
            cookieAuth: {
                type: string;
                in: string;
                name: string;
            };
            headerAuth: {
                type: string;
                in: string;
                name: string;
            };
        };
    };
};
/**
 * Swagger UI HTML page
 */
export declare function getSwaggerUiHtml(specUrl?: string): string;
/**
 * Get OpenAPI spec as JSON string
 */
export declare function getOpenApiSpecJson(): string;
//# sourceMappingURL=spec.d.ts.map