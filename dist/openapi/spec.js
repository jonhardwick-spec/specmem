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
export const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'SpecMem Dashboard API',
        description: `
# SpecMem Dashboard API

yo welcome to the MOST FIRE memory management API

## Features
- Memory CRUD operations
- Codebase indexing stats
- Skill management
- Team member coordination
- Real-time WebSocket updates

## Authentication
Dashboard requires password authentication. Include the password in requests:
- Cookie: \`specmem_auth=<password>\`
- Header: \`X-Specmem-Auth: <password>\`

## Rate Limiting
- HTTP: 100 requests/minute
- WebSocket: 100 messages/minute

## API Versioning
All endpoints are versioned. Use \`/api/v1/\` prefix.
Legacy \`/api/\` endpoints redirect to v1.
    `,
        version: '1.0.0',
        contact: {
            name: 'SpecMem Support',
            url: 'https://github.com/specmem/specmem'
        },
        license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT'
        }
    },
    servers: [
        {
            url: 'http://localhost:8589',
            description: 'Local development server'
        }
    ],
    tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Memories', description: 'Memory management operations' },
        { name: 'Stats', description: 'Statistics and metrics' },
        { name: 'Codebase', description: 'Codebase indexing operations' },
        { name: 'Skills', description: 'Skill management' },
        { name: 'Team Members', description: 'Team member coordination' },
        { name: 'WebSocket', description: 'Real-time updates' }
    ],
    paths: {
        '/api/v1/health': {
            get: {
                tags: ['Health'],
                summary: 'Health check',
                description: 'Returns server health status and version info',
                operationId: 'getHealth',
                responses: {
                    200: {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/HealthResponse'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/stats': {
            get: {
                tags: ['Stats'],
                summary: 'Get dashboard stats',
                description: 'Returns comprehensive dashboard statistics',
                operationId: 'getStats',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                responses: {
                    200: {
                        description: 'Statistics retrieved',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/StatsResponse'
                                }
                            }
                        }
                    },
                    401: {
                        description: 'Unauthorized',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/Error'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/memories': {
            get: {
                tags: ['Memories'],
                summary: 'List memories',
                description: 'Get a paginated list of memories with optional filtering',
                operationId: 'listMemories',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                parameters: [
                    {
                        name: 'limit',
                        in: 'query',
                        description: 'Number of memories to return',
                        schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 }
                    },
                    {
                        name: 'offset',
                        in: 'query',
                        description: 'Number of memories to skip',
                        schema: { type: 'integer', default: 0, minimum: 0 }
                    },
                    {
                        name: 'type',
                        in: 'query',
                        description: 'Filter by memory type',
                        schema: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'working', 'consolidated'] }
                    },
                    {
                        name: 'importance',
                        in: 'query',
                        description: 'Filter by importance level',
                        schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'trivial'] }
                    },
                    {
                        name: 'search',
                        in: 'query',
                        description: 'Full-text search query',
                        schema: { type: 'string' }
                    },
                    {
                        name: 'tags',
                        in: 'query',
                        description: 'Filter by tags (comma-separated)',
                        schema: { type: 'string' }
                    },
                    {
                        name: 'cursor',
                        in: 'query',
                        description: 'Cursor for cursor-based pagination',
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: {
                        description: 'List of memories',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/MemoriesListResponse'
                                }
                            }
                        }
                    },
                    401: {
                        description: 'Unauthorized'
                    }
                }
            },
            post: {
                tags: ['Memories'],
                summary: 'Create memory',
                description: 'Create a new memory entry',
                operationId: 'createMemory',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/CreateMemoryRequest'
                            }
                        }
                    }
                },
                responses: {
                    201: {
                        description: 'Memory created',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/Memory'
                                }
                            }
                        }
                    },
                    400: {
                        description: 'Invalid request'
                    },
                    401: {
                        description: 'Unauthorized'
                    }
                }
            }
        },
        '/api/v1/memories/{id}': {
            get: {
                tags: ['Memories'],
                summary: 'Get memory',
                description: 'Get a single memory by ID',
                operationId: 'getMemory',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        description: 'Memory UUID',
                        schema: { type: 'string', format: 'uuid' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Memory found',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/Memory'
                                }
                            }
                        }
                    },
                    404: {
                        description: 'Memory not found'
                    }
                }
            },
            put: {
                tags: ['Memories'],
                summary: 'Update memory',
                description: 'Update an existing memory',
                operationId: 'updateMemory',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', format: 'uuid' }
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/UpdateMemoryRequest'
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Memory updated'
                    },
                    404: {
                        description: 'Memory not found'
                    }
                }
            },
            delete: {
                tags: ['Memories'],
                summary: 'Delete memory',
                description: 'Delete a memory by ID',
                operationId: 'deleteMemory',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                parameters: [
                    {
                        name: 'id',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', format: 'uuid' }
                    }
                ],
                responses: {
                    204: {
                        description: 'Memory deleted'
                    },
                    404: {
                        description: 'Memory not found'
                    }
                }
            }
        },
        '/api/v1/memories/search': {
            post: {
                tags: ['Memories'],
                summary: 'Semantic search',
                description: 'Search memories using semantic similarity',
                operationId: 'searchMemories',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/SemanticSearchRequest'
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Search results',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/SearchResultsResponse'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/codebase/stats': {
            get: {
                tags: ['Codebase'],
                summary: 'Get codebase stats',
                description: 'Get codebase indexing statistics',
                operationId: 'getCodebaseStats',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                responses: {
                    200: {
                        description: 'Codebase statistics',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/CodebaseStatsResponse'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/codebase/files': {
            get: {
                tags: ['Codebase'],
                summary: 'List indexed files',
                description: 'Get a list of indexed codebase files',
                operationId: 'listCodebaseFiles',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                parameters: [
                    {
                        name: 'limit',
                        in: 'query',
                        schema: { type: 'integer', default: 100 }
                    },
                    {
                        name: 'offset',
                        in: 'query',
                        schema: { type: 'integer', default: 0 }
                    },
                    {
                        name: 'language',
                        in: 'query',
                        description: 'Filter by language',
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: {
                        description: 'List of files'
                    }
                }
            }
        },
        '/api/v1/skills': {
            get: {
                tags: ['Skills'],
                summary: 'List skills',
                description: 'Get all loaded skills',
                operationId: 'listSkills',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                responses: {
                    200: {
                        description: 'List of skills',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/SkillsListResponse'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/teamMembers': {
            get: {
                tags: ['Team Members'],
                summary: 'List team members',
                description: 'Get all connected team members',
                operationId: 'listTeamMembers',
                security: [{ cookieAuth: [] }, { headerAuth: [] }],
                responses: {
                    200: {
                        description: 'List of teamMembers',
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: '#/components/schemas/TeamMembersListResponse'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/metrics': {
            get: {
                tags: ['Stats'],
                summary: 'Prometheus metrics',
                description: 'Get metrics in Prometheus format',
                operationId: 'getMetrics',
                responses: {
                    200: {
                        description: 'Prometheus metrics',
                        content: {
                            'text/plain': {
                                schema: {
                                    type: 'string'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/ws': {
            get: {
                tags: ['WebSocket'],
                summary: 'WebSocket connection',
                description: `
Establish a WebSocket connection for real-time updates.

## Message Types
- \`subscribe\`: Subscribe to topics
- \`unsubscribe\`: Unsubscribe from topics
- \`ping\`: Heartbeat

## Topics
- \`memories\`: Memory updates
- \`stats\`: Stats updates
- \`teamMembers\`: Team member status updates
        `,
                operationId: 'websocket',
                responses: {
                    101: {
                        description: 'WebSocket upgrade'
                    }
                }
            }
        }
    },
    components: {
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    error: { type: 'string' },
                    code: { type: 'string' },
                    details: { type: 'object' }
                },
                required: ['error']
            },
            HealthResponse: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
                    version: { type: 'string' },
                    apiVersion: { type: 'string' },
                    uptime: { type: 'number' },
                    timestamp: { type: 'string', format: 'date-time' }
                }
            },
            StatsResponse: {
                type: 'object',
                properties: {
                    memories: {
                        type: 'object',
                        properties: {
                            total: { type: 'integer' },
                            byType: { type: 'object' },
                            byImportance: { type: 'object' },
                            withEmbeddings: { type: 'integer' }
                        }
                    },
                    codebase: {
                        type: 'object',
                        properties: {
                            totalFiles: { type: 'integer' },
                            totalLines: { type: 'integer' },
                            languages: { type: 'object' }
                        }
                    },
                    system: {
                        type: 'object',
                        properties: {
                            heapUsedMB: { type: 'number' },
                            heapTotalMB: { type: 'number' },
                            uptime: { type: 'number' }
                        }
                    }
                }
            },
            Memory: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    content: { type: 'string' },
                    memoryType: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'working', 'consolidated'] },
                    importance: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'trivial'] },
                    tags: { type: 'array', items: { type: 'string' } },
                    metadata: { type: 'object' },
                    hasEmbedding: { type: 'boolean' },
                    accessCount: { type: 'integer' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' }
                }
            },
            MemoriesListResponse: {
                type: 'object',
                properties: {
                    memories: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Memory' }
                    },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                    nextCursor: { type: 'string' }
                }
            },
            CreateMemoryRequest: {
                type: 'object',
                required: ['content'],
                properties: {
                    content: { type: 'string', minLength: 1 },
                    memoryType: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'working'] },
                    importance: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'trivial'] },
                    tags: { type: 'array', items: { type: 'string' } },
                    metadata: { type: 'object' },
                    generateEmbedding: { type: 'boolean', default: true }
                }
            },
            UpdateMemoryRequest: {
                type: 'object',
                properties: {
                    content: { type: 'string' },
                    memoryType: { type: 'string' },
                    importance: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                    metadata: { type: 'object' }
                }
            },
            SemanticSearchRequest: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' },
                    limit: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
                    threshold: { type: 'number', default: 0.7, minimum: 0, maximum: 1 },
                    types: { type: 'array', items: { type: 'string' } },
                    tags: { type: 'array', items: { type: 'string' } }
                }
            },
            SearchResultsResponse: {
                type: 'object',
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                memory: { $ref: '#/components/schemas/Memory' },
                                similarity: { type: 'number' }
                            }
                        }
                    },
                    total: { type: 'integer' },
                    queryTimeMs: { type: 'number' }
                }
            },
            CodebaseStatsResponse: {
                type: 'object',
                properties: {
                    totalFiles: { type: 'integer' },
                    totalLines: { type: 'integer' },
                    totalBytes: { type: 'integer' },
                    languages: {
                        type: 'object',
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                files: { type: 'integer' },
                                lines: { type: 'integer' }
                            }
                        }
                    },
                    lastIndexed: { type: 'string', format: 'date-time' },
                    isWatching: { type: 'boolean' }
                }
            },
            SkillsListResponse: {
                type: 'object',
                properties: {
                    skills: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                category: { type: 'string' },
                                description: { type: 'string' },
                                path: { type: 'string' }
                            }
                        }
                    },
                    total: { type: 'integer' },
                    categories: {
                        type: 'array',
                        items: { type: 'string' }
                    }
                }
            },
            TeamMembersListResponse: {
                type: 'object',
                properties: {
                    teamMembers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' },
                                status: { type: 'string', enum: ['active', 'idle', 'busy', 'disconnected'] },
                                connectedAt: { type: 'string', format: 'date-time' },
                                lastHeartbeat: { type: 'string', format: 'date-time' }
                            }
                        }
                    },
                    total: { type: 'integer' }
                }
            }
        },
        securitySchemes: {
            cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'specmem_auth'
            },
            headerAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-Specmem-Auth'
            }
        }
    }
};
/**
 * Swagger UI HTML page
 */
export function getSwaggerUiHtml(specUrl = '/api/v1/openapi.json') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpecMem API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.0/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { font-size: 2rem; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        deepLinking: true,
        showExtensions: true,
        showCommonExtensions: true
      });
    }
  </script>
</body>
</html>`;
}
/**
 * Get OpenAPI spec as JSON string
 */
export function getOpenApiSpecJson() {
    return JSON.stringify(openApiSpec, null, 2);
}
//# sourceMappingURL=spec.js.map