#!/usr/bin/env node
/**
 * Test TeamMember Worker - Simple worker for testing API endpoints
 *
 * Usage: node testWorker.js <config-json>
 * RAM Limited: Spawned with --max-old-space-size flag
 */
import { BaseWorker } from './baseWorker.js';
class TestWorker extends BaseWorker {
    testsRun = 0;
    testsPassed = 0;
    testsFailed = 0;
    async initialize() {
        this.log('Test Worker initialized and ready for tasks');
    }
    async handleCommand(command) {
        if (command.type === 'LIMIT_WARNING') {
            const warning = command.warning;
            this.logError(`⚠️ Limit Warning: ${warning.message}`);
            this.logError(`   Suggestion: ${warning.suggestion}`);
            // Acknowledge and adapt
            if (warning.type === 'token') {
                this.acknowledgeLimitWarning('token', 'reducing_verbosity');
            }
            else if (warning.type === 'memory') {
                this.acknowledgeLimitWarning('memory', 'clearing_cache');
                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }
            }
        }
        else if (command.type === 'RUN_TEST') {
            await this.executeTask(command.task);
        }
        else if (command.type === 'SHUTDOWN') {
            await this.shutdown();
            process.exit(0);
        }
    }
    async executeTask(task) {
        this.testsRun++;
        this.reportTask({
            name: `Testing ${task.method} ${task.endpoint}`,
            progress: 0
        });
        try {
            const startTime = Date.now();
            // Simulate API call (in real implementation, use fetch)
            this.log(`Testing endpoint: ${task.method} ${task.endpoint}`);
            this.reportProgress(50);
            // Simulate response time
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
            const duration = Date.now() - startTime;
            this.testsPassed++;
            this.log(`✓ Test passed in ${duration}ms`);
            this.reportProgress(100);
            // Report token usage (simulated)
            this.reportTokens(50);
            // Share test results as code
            this.shareCode({
                title: `Test Result: ${task.endpoint}`,
                code: JSON.stringify({
                    endpoint: task.endpoint,
                    method: task.method,
                    status: 'passed',
                    duration: `${duration}ms`
                }, null, 2),
                description: `API test result for ${task.endpoint}`,
                language: 'json',
                tags: ['test', 'api', task.method.toLowerCase()]
            });
            this.reportMemoryUsage();
        }
        catch (error) {
            this.testsFailed++;
            this.logError(`✗ Test failed: ${error.message}`);
            this.reportProgress(100);
        }
    }
    async cleanup() {
        this.log(`Test Worker shutting down. Stats: ${this.testsRun} run, ${this.testsPassed} passed, ${this.testsFailed} failed`);
    }
}
// Parse config from command line
const configArg = process.argv[2];
if (!configArg) {
    console.error('Usage: node testWorker.js <config-json>');
    process.exit(1);
}
const config = JSON.parse(configArg);
const worker = new TestWorker(config);
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
//# sourceMappingURL=testWorker.js.map