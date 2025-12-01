/**
 * Code Explanation System - Type Definitions
 */
import { z } from 'zod';
export declare const ExplanationTypeEnum: z.ZodEnum<["general", "architectural", "algorithmic", "usage", "gotchas", "performance", "security", "debugging", "history", "todo"]>;
export declare const RelationshipTypeEnum: z.ZodEnum<["referenced", "explained", "modified", "debugged", "created", "related", "imported", "depends_on", "tested"]>;
export declare const CodeExplanationSchema: z.ZodObject<{
    id: z.ZodString;
    codeId: z.ZodOptional<z.ZodString>;
    filePath: z.ZodString;
    lineStart: z.ZodOptional<z.ZodNumber>;
    lineEnd: z.ZodOptional<z.ZodNumber>;
    codeSnippet: z.ZodOptional<z.ZodString>;
    explanationText: z.ZodString;
    explanationType: z.ZodDefault<z.ZodEnum<["general", "architectural", "algorithmic", "usage", "gotchas", "performance", "security", "debugging", "history", "todo"]>>;
    embedding: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    qualityScore: z.ZodDefault<z.ZodNumber>;
    useCount: z.ZodDefault<z.ZodNumber>;
    feedbackPositive: z.ZodDefault<z.ZodNumber>;
    feedbackNegative: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
    createdBy: z.ZodDefault<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    metadata?: Record<string, unknown>;
    embedding?: number[];
    createdAt?: Date;
    updatedAt?: Date;
    filePath?: string;
    codeId?: string;
    lineStart?: number;
    lineEnd?: number;
    codeSnippet?: string;
    explanationText?: string;
    explanationType?: "general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo";
    qualityScore?: number;
    useCount?: number;
    feedbackPositive?: number;
    feedbackNegative?: number;
    createdBy?: string;
}, {
    id?: string;
    metadata?: Record<string, unknown>;
    embedding?: number[];
    createdAt?: Date;
    updatedAt?: Date;
    filePath?: string;
    codeId?: string;
    lineStart?: number;
    lineEnd?: number;
    codeSnippet?: string;
    explanationText?: string;
    explanationType?: "general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo";
    qualityScore?: number;
    useCount?: number;
    feedbackPositive?: number;
    feedbackNegative?: number;
    createdBy?: string;
}>;
export declare const CodePromptLinkSchema: z.ZodObject<{
    id: z.ZodString;
    codeId: z.ZodOptional<z.ZodString>;
    memoryId: z.ZodString;
    explanationId: z.ZodOptional<z.ZodString>;
    relationshipType: z.ZodDefault<z.ZodEnum<["referenced", "explained", "modified", "debugged", "created", "related", "imported", "depends_on", "tested"]>>;
    context: z.ZodOptional<z.ZodString>;
    strength: z.ZodDefault<z.ZodNumber>;
    createdAt: z.ZodDate;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    memoryId?: string;
    context?: string;
    codeId?: string;
    strength?: number;
    explanationId?: string;
    relationshipType?: "created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested";
}, {
    id?: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    memoryId?: string;
    context?: string;
    codeId?: string;
    strength?: number;
    explanationId?: string;
    relationshipType?: "created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested";
}>;
export declare const CodeAccessPatternSchema: z.ZodObject<{
    id: z.ZodString;
    codeId: z.ZodString;
    accessCount: z.ZodDefault<z.ZodNumber>;
    lastAccessed: z.ZodDate;
    commonQueries: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    queryEmbeddings: z.ZodDefault<z.ZodArray<z.ZodArray<z.ZodNumber, "many">, "many">>;
    accessContexts: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    hourlyAccessPattern: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    dailyAccessPattern: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    firstAccessed: z.ZodDate;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id?: string;
    metadata?: Record<string, unknown>;
    accessCount?: number;
    codeId?: string;
    lastAccessed?: Date;
    commonQueries?: string[];
    queryEmbeddings?: number[][];
    accessContexts?: string[];
    hourlyAccessPattern?: number[];
    dailyAccessPattern?: number[];
    firstAccessed?: Date;
}, {
    id?: string;
    metadata?: Record<string, unknown>;
    accessCount?: number;
    codeId?: string;
    lastAccessed?: Date;
    commonQueries?: string[];
    queryEmbeddings?: number[][];
    accessContexts?: string[];
    hourlyAccessPattern?: number[];
    dailyAccessPattern?: number[];
    firstAccessed?: Date;
}>;
export declare const ExplainCodeInput: z.ZodObject<{
    filePath: z.ZodString;
    lineStart: z.ZodOptional<z.ZodNumber>;
    lineEnd: z.ZodOptional<z.ZodNumber>;
    explanationType: z.ZodDefault<z.ZodEnum<["general", "architectural", "algorithmic", "usage", "gotchas", "performance", "security", "debugging", "history", "todo"]>>;
    context: z.ZodOptional<z.ZodString>;
    forceRegenerate: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    filePath?: string;
    context?: string;
    lineStart?: number;
    lineEnd?: number;
    explanationType?: "general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo";
    forceRegenerate?: boolean;
}, {
    filePath?: string;
    context?: string;
    lineStart?: number;
    lineEnd?: number;
    explanationType?: "general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo";
    forceRegenerate?: boolean;
}>;
export declare const RecallExplanationInput: z.ZodObject<{
    codeId: z.ZodOptional<z.ZodString>;
    filePath: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    explanationType: z.ZodOptional<z.ZodEnum<["general", "architectural", "algorithmic", "usage", "gotchas", "performance", "security", "debugging", "history", "todo"]>>;
    minQuality: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query?: string;
    limit?: number;
    filePath?: string;
    codeId?: string;
    explanationType?: "general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo";
    minQuality?: number;
}, {
    query?: string;
    limit?: number;
    filePath?: string;
    codeId?: string;
    explanationType?: "general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo";
    minQuality?: number;
}>;
export declare const LinkCodeToPromptInput: z.ZodEffects<z.ZodObject<{
    codeId: z.ZodOptional<z.ZodString>;
    filePath: z.ZodOptional<z.ZodString>;
    memoryId: z.ZodString;
    relationshipType: z.ZodDefault<z.ZodEnum<["referenced", "explained", "modified", "debugged", "created", "related", "imported", "depends_on", "tested"]>>;
    context: z.ZodOptional<z.ZodString>;
    strength: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    filePath?: string;
    memoryId?: string;
    context?: string;
    codeId?: string;
    strength?: number;
    relationshipType?: "created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested";
}, {
    filePath?: string;
    memoryId?: string;
    context?: string;
    codeId?: string;
    strength?: number;
    relationshipType?: "created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested";
}>, {
    filePath?: string;
    memoryId?: string;
    context?: string;
    codeId?: string;
    strength?: number;
    relationshipType?: "created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested";
}, {
    filePath?: string;
    memoryId?: string;
    context?: string;
    codeId?: string;
    strength?: number;
    relationshipType?: "created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested";
}>;
export declare const GetRelatedCodeInput: z.ZodEffects<z.ZodObject<{
    memoryId: z.ZodOptional<z.ZodString>;
    query: z.ZodOptional<z.ZodString>;
    relationshipTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<["referenced", "explained", "modified", "debugged", "created", "related", "imported", "depends_on", "tested"]>, "many">>;
    minStrength: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query?: string;
    limit?: number;
    memoryId?: string;
    relationshipTypes?: ("created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested")[];
    minStrength?: number;
}, {
    query?: string;
    limit?: number;
    memoryId?: string;
    relationshipTypes?: ("created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested")[];
    minStrength?: number;
}>, {
    query?: string;
    limit?: number;
    memoryId?: string;
    relationshipTypes?: ("created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested")[];
    minStrength?: number;
}, {
    query?: string;
    limit?: number;
    memoryId?: string;
    relationshipTypes?: ("created" | "related" | "imported" | "modified" | "depends_on" | "referenced" | "explained" | "debugged" | "tested")[];
    minStrength?: number;
}>;
export declare const ProvideFeedbackInput: z.ZodObject<{
    explanationId: z.ZodString;
    positive: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    positive?: boolean;
    explanationId?: string;
}, {
    positive?: boolean;
    explanationId?: string;
}>;
export declare const SemanticSearchInput: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
    explanationTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<["general", "architectural", "algorithmic", "usage", "gotchas", "performance", "security", "debugging", "history", "todo"]>, "many">>;
    minQuality: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query?: string;
    limit?: number;
    threshold?: number;
    minQuality?: number;
    explanationTypes?: ("general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo")[];
}, {
    query?: string;
    limit?: number;
    threshold?: number;
    minQuality?: number;
    explanationTypes?: ("general" | "security" | "usage" | "history" | "architectural" | "algorithmic" | "gotchas" | "performance" | "debugging" | "todo")[];
}>;
export type ExplanationType = z.infer<typeof ExplanationTypeEnum>;
export type RelationshipType = z.infer<typeof RelationshipTypeEnum>;
export type CodeExplanation = z.infer<typeof CodeExplanationSchema>;
export type CodePromptLink = z.infer<typeof CodePromptLinkSchema>;
export type CodeAccessPattern = z.infer<typeof CodeAccessPatternSchema>;
export type ExplainCodeParams = z.infer<typeof ExplainCodeInput>;
export type RecallExplanationParams = z.infer<typeof RecallExplanationInput>;
export type LinkCodeToPromptParams = z.infer<typeof LinkCodeToPromptInput>;
export type GetRelatedCodeParams = z.infer<typeof GetRelatedCodeInput>;
export type ProvideFeedbackParams = z.infer<typeof ProvideFeedbackInput>;
export type SemanticSearchParams = z.infer<typeof SemanticSearchInput>;
export interface ExplainCodeResult {
    success: boolean;
    explanation?: CodeExplanation;
    wasReused: boolean;
    message: string;
}
export interface RecallExplanationResult {
    success: boolean;
    explanations: Array<CodeExplanation & {
        similarity?: number;
    }>;
    total: number;
    message: string;
}
export interface LinkCodeResult {
    success: boolean;
    link?: CodePromptLink;
    message: string;
}
export interface RelatedCodeResult {
    success: boolean;
    relatedCode: Array<{
        codeId: string;
        filePath: string;
        relationshipType: RelationshipType;
        strength: number;
        explanation?: string;
        context?: string;
    }>;
    total: number;
    message: string;
}
export interface SemanticSearchResult {
    success: boolean;
    results: Array<{
        explanation: CodeExplanation;
        similarity: number;
        codeSnippet?: string;
    }>;
    total: number;
    message: string;
}
export interface FeedbackResult {
    success: boolean;
    newQualityScore: number;
    message: string;
}
//# sourceMappingURL=types.d.ts.map