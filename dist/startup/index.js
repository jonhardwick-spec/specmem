/**
 * SpecMem Startup Module
 *
 * Pre-flight validation and initialization checks.
 * Automatic indexing on startup.
 */
export { 
// Main validation functions
runStartupValidation, validateOrExit, quickValidation, fullValidation, formatValidationErrors, EXIT_CODES, } from './validation.js';
// Startup indexing - auto-index codebase and extract sessions
export { runStartupIndexing, checkCodebaseIndexStatus, checkSessionExtractionStatus, triggerBackgroundIndexing, triggerBackgroundSessionExtraction, getIndexingStatus, } from './startupIndexing.js';
//# sourceMappingURL=index.js.map