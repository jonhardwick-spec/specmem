#!/usr/bin/env node
/**
 * SpecMem - Speculative Memory MCP Server
 *
 * yo shoutout to doobidoo/mcp-memory-service for the inspo
 * we took their SQLite version and made it POSTGRESQL BEAST MODE
 * - hardwicksoftwareservices
 *
 * A high-performance memory management system with:
 * - Semantic search using pgvector (cosine similarity)
 * - Dream-inspired consolidation (DBSCAN clustering)
 * - Auto-splitting for unlimited content length
 * - Natural language time queries ("yesterday", "last week")
 * - Embedding caching (90% hit rate target)
 * - Image storage (base64 in BYTEA)
 * - Memory relationships (graph traversal)
 * - SKILLS SYSTEM - drag & drop .md files for instant capabilities
 * - CODEBASE INDEXING - knows your entire project
 *
 * Scale Requirements:
 * - Millions of lines of code
 * - Thousands of prompts
 * - Hundreds of images
 * - <100ms semantic search
 */
export { SpecMemServer } from './mcp/specMemServer.js';
export { ToolRegistry, createToolRegistry, MCPTool, CachingEmbeddingProvider } from './mcp/toolRegistry.js';
export { MCPProtocolHandler, parseTimeExpression, splitContent } from './mcp/mcpProtocolHandler.js';
export { DatabaseManager, getDatabase, resetDatabase } from './database.js';
export { EmbeddingProvider } from './tools/index.js';
export { RememberThisShit, FindWhatISaid, WhatDidIMean, YeahNahDeleteThat, SmushMemoriesTogether, LinkTheVibes, ShowMeTheStats, FindCodePointers } from './tools/goofy/index.js';
export { CommandHandler, createCommandHandler, CommandResult, ParsedCommand, CommandCategory, CommandAction, MemoryCommands, CodebaseCommands, ContextCommands, PromptCommands, getCommandsResource, getCommandHelpResource } from './commands/index.js';
export { SkillScanner, Skill, SkillScannerConfig, SkillScanResult, getSkillScanner, resetSkillScanner } from './skills/skillScanner.js';
export { SkillResourceProvider, getSkillResourceProvider } from './skills/skillsResource.js';
export { CodebaseIndexer, IndexedFile, CodebaseIndexerConfig, IndexStats, getCodebaseIndexer, resetCodebaseIndexer } from './codebase/codebaseIndexer.js';
export { SkillReminder, SkillReminderConfig, MCPPrompt, PromptMessage, getSkillReminder, resetSkillReminder } from './reminders/skillReminder.js';
export { DashboardWebServer, DashboardConfig, DashboardStats, getDashboardServer, resetDashboardServer } from './dashboard/index.js';
export { MemoryManager, MemoryConfig, MemoryStats, LRUCache, getMemoryManager, resetMemoryManager, getInstanceRegistry, InstanceMemorySnapshot, GlobalInstanceStats } from './utils/memoryManager.js';
export { EmbeddingOverflowHandler, createEmbeddingOverflowHandler } from './db/embeddingOverflow.js';
export { InstanceManager, InstanceInfo, InstanceRegistry, getInstanceManager, resetInstanceManager, hasInstanceManager, listInstances, killInstance, killAllInstances, cleanupSameProjectInstances, hashProjectPath, migrateFromOldStructure, } from './utils/instanceManager.js';
export { runStartupValidation, quickValidation, fullValidation, formatValidationErrors, validateOrExit, ValidationResult, ValidationError, ValidationOptions, ExitCode, EXIT_CODES, } from './startup/index.js';
//# sourceMappingURL=index.d.ts.map