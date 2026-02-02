/**
 * Code Explanation System - Type Definitions
 */
import { z } from 'zod';
// ============================================================================
// Enums and Constants
// ============================================================================
export const ExplanationTypeEnum = z.enum([
    'general', // General explanation of what the code does
    'architectural', // How it fits into the larger system
    'algorithmic', // Detailed algorithm explanation
    'usage', // How to use this code
    'gotchas', // Common pitfalls and edge cases
    'performance', // Performance considerations
    'security', // Security implications
    'debugging', // How to debug this code
    'history', // Why this code exists (historical context)
    'todo' // Things that need attention
]);
export const RelationshipTypeEnum = z.enum([
    'referenced', // Code was referenced in prompt
    'explained', // Code was explained to user
    'modified', // User asked to modify this code
    'debugged', // Code was debugged in conversation
    'created', // Code was created in conversation
    'related', // Code is related to the conversation topic
    'imported', // Code imports from this file
    'depends_on', // Code depends on this file
    'tested' // Code was tested or tests were written
]);
// ============================================================================
// Zod Schemas
// ============================================================================
export const CodeExplanationSchema = z.object({
    id: z.string().uuid(),
    codeId: z.string().uuid().optional(),
    filePath: z.string(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    codeSnippet: z.string().optional(),
    explanationText: z.string().min(1),
    explanationType: ExplanationTypeEnum.default('general'),
    embedding: z.array(z.number()).optional(),
    qualityScore: z.number().min(0).max(1).default(0.5),
    useCount: z.number().int().nonnegative().default(0),
    feedbackPositive: z.number().int().nonnegative().default(0),
    feedbackNegative: z.number().int().nonnegative().default(0),
    createdAt: z.date(),
    updatedAt: z.date(),
    createdBy: z.string().default('assistant'),
    metadata: z.record(z.unknown()).optional()
});
export const CodePromptLinkSchema = z.object({
    id: z.string().uuid(),
    codeId: z.string().uuid().optional(),
    memoryId: z.string().uuid(),
    explanationId: z.string().uuid().optional(),
    relationshipType: RelationshipTypeEnum.default('referenced'),
    context: z.string().optional(),
    strength: z.number().min(0).max(1).default(1),
    createdAt: z.date(),
    metadata: z.record(z.unknown()).optional()
});
export const CodeAccessPatternSchema = z.object({
    id: z.string().uuid(),
    codeId: z.string().uuid(),
    accessCount: z.number().int().positive().default(1),
    lastAccessed: z.date(),
    commonQueries: z.array(z.string()).default([]),
    queryEmbeddings: z.array(z.array(z.number())).default([]),
    accessContexts: z.array(z.string()).default([]),
    hourlyAccessPattern: z.array(z.number()).length(24).default(Array(24).fill(0)),
    dailyAccessPattern: z.array(z.number()).length(7).default(Array(7).fill(0)),
    firstAccessed: z.date(),
    metadata: z.record(z.unknown()).optional()
});
// ============================================================================
// Input Schemas for Tools
// ============================================================================
export const ExplainCodeInput = z.object({
    filePath: z.string().min(1),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    explanationType: ExplanationTypeEnum.default('general'),
    context: z.string().optional(),
    forceRegenerate: z.boolean().default(false)
});
export const RecallExplanationInput = z.object({
    codeId: z.string().uuid().optional(),
    filePath: z.string().optional(),
    query: z.string().optional(),
    explanationType: ExplanationTypeEnum.optional(),
    minQuality: z.number().min(0).max(1).default(0),
    limit: z.number().int().min(1).max(100).default(10)
});
export const LinkCodeToPromptInput = z.object({
    codeId: z.string().uuid().optional(),
    filePath: z.string().optional(),
    memoryId: z.string().uuid(),
    relationshipType: RelationshipTypeEnum.default('referenced'),
    context: z.string().optional(),
    strength: z.number().min(0).max(1).default(1)
}).refine(data => data.codeId || data.filePath, { message: 'Either codeId or filePath is required' });
export const GetRelatedCodeInput = z.object({
    memoryId: z.string().uuid().optional(),
    query: z.string().optional(),
    relationshipTypes: z.array(RelationshipTypeEnum).optional(),
    minStrength: z.number().min(0).max(1).default(0.5),
    limit: z.number().int().min(1).max(100).default(10)
}).refine(data => data.memoryId || data.query, { message: 'Either memoryId or query is required' });
export const ProvideFeedbackInput = z.object({
    explanationId: z.string().uuid(),
    positive: z.boolean()
});
export const SemanticSearchInput = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
    threshold: z.number().min(0).max(1).default(0.7),
    explanationTypes: z.array(ExplanationTypeEnum).optional(),
    minQuality: z.number().min(0).max(1).default(0)
});
//# sourceMappingURL=types.js.map