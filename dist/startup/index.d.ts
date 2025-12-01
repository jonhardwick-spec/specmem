/**
 * SpecMem Startup Module
 *
 * Pre-flight validation and initialization checks.
 * Automatic indexing on startup.
 */
export { runStartupValidation, validateOrExit, quickValidation, fullValidation, formatValidationErrors, ValidationResult, ValidationError, ValidationOptions, ExitCode, EXIT_CODES, } from './validation.js';
export { runStartupIndexing, checkCodebaseIndexStatus, checkSessionExtractionStatus, triggerBackgroundIndexing, triggerBackgroundSessionExtraction, getIndexingStatus, } from './startupIndexing.js';
//# sourceMappingURL=index.d.ts.map