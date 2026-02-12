/**
 * hooks.ts - Hook Management API for SpecMem Dashboard
 *
 * Provides endpoints for managing custom hooks:
 * - List hooks
 * - Get hook with content
 * - Create/upload hook
 * - Update hook content
 * - Validate hook
 * - Enable/disable hook
 * - Deploy hooks
 * - Delete hook
 */
// @ts-ignore - express types
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getHookManager, formatValidationResult } from '../../hooks/hookManager.js';
const router = Router();
// ============================================================================
// Validation Schemas
// ============================================================================
const CreateHookSchema = z.object({
    name: z.string().min(1).max(100),
    content: z.string().min(1),
    type: z.enum(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'AssistantResponse']),
    description: z.string().optional().default(''),
    language: z.enum(['javascript', 'typescript', 'python', 'shell']).optional().default('javascript')
});
const UpdateHookSchema = z.object({
    content: z.string().min(1),
    description: z.string().optional()
});
const SetEnabledSchema = z.object({
    enabled: z.boolean()
});
// ============================================================================
// API Endpoints
// ============================================================================
/**
 * GET /api/hooks - List all hooks
 */
router.get('/', async (req, res) => {
    try {
        const hookManager = getHookManager();
        const hooks = hookManager.getHooks();
        const status = hookManager.getStatus();
        res.json({
            success: true,
            hooks,
            status
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to list hooks');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * GET /api/hooks/status - Get hook system status
 */
router.get('/status', async (req, res) => {
    try {
        const hookManager = getHookManager();
        const status = hookManager.getStatus();
        res.json({
            success: true,
            ...status
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to get hook status');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * GET /api/hooks/scan - Scan for new hooks in custom-hooks directory
 */
router.get('/scan', async (req, res) => {
    try {
        const hookManager = getHookManager();
        const result = hookManager.scanCustomHooks();
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to scan hooks');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * GET /api/hooks/:name - Get hook with content
 */
router.get('/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const hookManager = getHookManager();
        const hook = hookManager.getHookWithContent(name);
        if (!hook) {
            // LOW-38 FIX: Explicit return after response
            res.status(404).json({
                success: false,
                error: 'Hook not found'
            });
            return;
        }
        res.json({
            success: true,
            hook
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to get hook');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * POST /api/hooks - Create a new hook
 */
router.post('/', async (req, res) => {
    try {
        const parsed = CreateHookSchema.safeParse(req.body);
        if (!parsed.success) {
            // LOW-38 FIX: Explicit return after response
            res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: parsed.error.errors
            });
            return;
        }
        const { name, content, type, description, language } = parsed.data;
        const hookManager = getHookManager();
        const result = await hookManager.createHookFromContent(name, content, type, description || '', language);
        if (result.error) {
            // LOW-38 FIX: Explicit return after response
            res.status(400).json({
                success: false,
                error: result.error
            });
            return;
        }
        res.json({
            success: true,
            hook: result.hook
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to create hook');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * PUT /api/hooks/:name - Update hook content
 */
router.put('/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const parsed = UpdateHookSchema.safeParse(req.body);
        if (!parsed.success) {
            // LOW-38 FIX: Explicit return after response
            res.status(400).json({
                success: false,
                error: 'Invalid input',
                details: parsed.error.errors
            });
            return;
        }
        const { content, description } = parsed.data;
        const hookManager = getHookManager();
        const hook = await hookManager.updateHookContent(name, content, description);
        if (!hook) {
            // LOW-38 FIX: Explicit return after response
            res.status(404).json({
                success: false,
                error: 'Hook not found'
            });
            return;
        }
        res.json({
            success: true,
            hook
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to update hook');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * POST /api/hooks/:name/validate - Validate hook syntax
 */
router.post('/:name/validate', async (req, res) => {
    try {
        const { name } = req.params;
        const hookManager = getHookManager();
        const result = await hookManager.validateAndUpdateHook(name);
        res.json({
            success: true,
            validation: result,
            message: formatValidationResult(result)
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to validate hook');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * POST /api/hooks/:name/enable - Enable or disable hook
 */
router.post('/:name/enable', async (req, res) => {
    try {
        const { name } = req.params;
        const parsed = SetEnabledSchema.safeParse(req.body);
        if (!parsed.success) {
            // LOW-38 FIX: Explicit return after response
            res.status(400).json({
                success: false,
                error: 'Invalid input - expected { enabled: boolean }'
            });
            return;
        }
        const hookManager = getHookManager();
        const success = hookManager.setHookEnabled(name, parsed.data.enabled);
        if (!success) {
            // LOW-38 FIX: Explicit return after response
            res.status(404).json({
                success: false,
                error: 'Hook not found'
            });
            return;
        }
        res.json({
            success: true,
            enabled: parsed.data.enabled
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to update hook enabled status');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * POST /api/hooks/deploy - Deploy all enabled & validated hooks to 
 */
router.post('/deploy', async (req, res) => {
    try {
        const hookManager = getHookManager();
        const result = hookManager.deployHooks();
        res.json({
            success: true,
            ...result
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to deploy hooks');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * DELETE /api/hooks/:name - Delete a hook
 */
router.delete('/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const hookManager = getHookManager();
        const result = hookManager.deleteHook(name);
        if (!result.success) {
            // LOW-38 FIX: Explicit return after response
            res.status(404).json({
                success: false,
                error: result.error
            });
            return;
        }
        res.json({
            success: true
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to delete hook');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * POST /api/hooks/example - Create example hook
 */
router.post('/example', async (req, res) => {
    try {
        const hookManager = getHookManager();
        const path = hookManager.createExampleHook();
        // Also scan to register it
        hookManager.scanCustomHooks();
        res.json({
            success: true,
            path,
            message: 'Example hook created. Run validation before enabling.'
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to create example hook');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
export { router as hooksRouter };
//# sourceMappingURL=hooks.js.map