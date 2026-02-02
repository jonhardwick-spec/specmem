#!/usr/bin/env node
/**
 * Repair TeamMember Worker - Fixes issues reported by test workers
 *
 * Usage: node repairWorker.js <config-json>
 * RAM Limited: Spawned with --max-old-space-size flag
 */
import { BaseWorker } from './baseWorker.js';
class RepairWorker extends BaseWorker {
    fixesApplied = 0;
    filesModified = 0;
    async initialize() {
        this.log('Repair Worker initialized - ready to fix issues on the fly');
    }
    async handleCommand(command) {
        if (command.type === 'LIMIT_WARNING') {
            const warning = command.warning;
            this.logError(`⚠️ Limit Warning: ${warning.message}`);
            if (warning.type === 'memory') {
                this.acknowledgeLimitWarning('memory', 'flushing_buffers');
                if (global.gc)
                    global.gc();
            }
        }
        else if (command.type === 'FIX_ISSUE') {
            await this.executeTask(command.task);
        }
        else if (command.type === 'SHUTDOWN') {
            await this.shutdown();
            process.exit(0);
        }
    }
    async executeTask(task) {
        this.reportTask({
            name: `Fixing: ${task.issue}`,
            progress: 0
        });
        try {
            this.log(`🔧 Analyzing issue: ${task.issue}`);
            this.reportProgress(25);
            // Simulate analysis time
            await new Promise(resolve => setTimeout(resolve, 500));
            if (task.file) {
                this.log(`📝 Applying fix to ${task.file}`);
                this.filesModified++;
                this.reportFilesProcessed(this.filesModified);
            }
            this.reportProgress(75);
            // Simulate fix application
            await new Promise(resolve => setTimeout(resolve, 500));
            this.fixesApplied++;
            this.reportProgress(100);
            this.log(`✓ Fix applied successfully (${this.fixesApplied} total fixes)`);
            // Report token usage
            this.reportTokens(150);
            // Share the fix as code
            this.shareCode({
                title: `Fix: ${task.issue}`,
                code: `// Fixed: ${task.issue}\n// ${task.suggestion || 'Applied automated fix'}`,
                description: `Repair applied for: ${task.issue}`,
                language: 'javascript',
                tags: ['fix', 'repair', 'automated']
            });
            // Give positive feedback if this is fixing someone else's code
            if (task.suggestion) {
                // Simulate giving feedback to the test worker
                this.log('💬 Acknowledging issue report from test worker');
            }
            this.reportMemoryUsage();
        }
        catch (error) {
            this.logError(`✗ Fix failed: ${error.message}`);
            this.reportProgress(100);
        }
    }
    async cleanup() {
        this.log(`Repair Worker shutting down. Stats: ${this.fixesApplied} fixes applied, ${this.filesModified} files modified`);
    }
}
// Parse config from command line
const configArg = process.argv[2];
if (!configArg) {
    console.error('Usage: node repairWorker.js <config-json>');
    process.exit(1);
}
const config = JSON.parse(configArg);
const worker = new RepairWorker(config);
// Start worker
worker.start().catch(err => {
    console.error(`Worker failed to start: ${err.message}`);
    process.exit(1);
});
// Handle shutdown signals
process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
});
process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
});
//# sourceMappingURL=repairWorker.js.map