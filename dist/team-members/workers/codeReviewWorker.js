#!/usr/bin/env node
import { BaseWorker } from './baseWorker.js';
class CodeReviewWorker extends BaseWorker {
    reviewsCompleted = 0;
    issuesFound = 0;
    async initialize() {
        this.log('Code Review Worker initialized - ready to review shared code');
    }
    async handleCommand(command) {
        if (command.type === 'LIMIT_WARNING') {
            const warning = command.warning;
            this.logError(`Limit Warning: ${warning.message}`);
            if (warning.type === 'token') {
                this.acknowledgeLimitWarning('token', 'shortening_reviews');
            }
            else if (warning.type === 'memory') {
                this.acknowledgeLimitWarning('memory', 'clearing_review_cache');
                if (global.gc)
                    global.gc();
            }
        }
        else if (command.type === 'REVIEW_CODE') {
            await this.executeTask(command.task);
        }
        else if (command.type === 'GET_PENDING_REVIEWS') {
            this.requestPendingReviews();
        }
        else if (command.type === 'SHUTDOWN') {
            await this.shutdown();
            process.exit(0);
        }
    }
    async executeTask(task) {
        this.reportTask({
            name: `Reviewing: ${task.title}`,
            progress: 0
        });
        try {
            this.log(`Analyzing code: ${task.title} (${task.language})`);
            this.reportProgress(20);
            const result = await this.performCodeReview(task);
            this.reportProgress(80);
            this.reviewsCompleted++;
            this.issuesFound += result.issues.length;
            this.giveFeedback({
                code_id: task.codeId,
                type: result.feedbackType,
                message: this.formatReviewMessage(result)
            });
            if (result.approved) {
                this.sendMessage({
                    to: task.fromTeamMemberId,
                    message: `Code review approved: ${task.title}. ${result.summary}`
                });
            }
            else {
                this.sendMessage({
                    to: task.fromTeamMemberId,
                    message: `Code review needs changes: ${task.title}. Issues: ${result.issues.join(', ')}`
                });
            }
            this.reportProgress(100);
            this.log(`Review complete: ${result.approved ? 'APPROVED' : 'NEEDS_CHANGES'}`);
            this.reportTokens(200);
            this.reportMemoryUsage();
        }
        catch (error) {
            this.logError(`Review failed: ${error.message}`);
            this.reportProgress(100);
        }
    }
    async performCodeReview(task) {
        const issues = [];
        const suggestions = [];
        const codeLines = task.codePreview.split('\n');
        for (const line of codeLines) {
            if (line.includes('TODO') || line.includes('FIXME')) {
                issues.push('Contains unresolved TODO/FIXME comments');
            }
            if (line.includes('console.log') && task.language !== 'markdown') {
                suggestions.push('Consider removing debug console.log statements');
            }
            if (line.length > 120) {
                suggestions.push('Some lines exceed 120 characters');
            }
        }
        if (task.codePreview.includes('any')) {
            suggestions.push('Consider using specific types instead of any');
        }
        if (!task.codePreview.includes('try') && task.language === 'typescript') {
            suggestions.push('Consider adding error handling');
        }
        const approved = issues.length === 0;
        const feedbackType = approved
            ? (suggestions.length > 0 ? 'positive' : 'positive')
            : (issues.length > 2 ? 'negative' : 'critique');
        return {
            codeId: task.codeId,
            approved,
            feedbackType,
            issues,
            suggestions,
            summary: approved
                ? `Code looks good${suggestions.length > 0 ? ` with ${suggestions.length} minor suggestions` : ''}`
                : `Found ${issues.length} issues that need addressing`
        };
    }
    formatReviewMessage(result) {
        let message = result.summary;
        if (result.issues.length > 0) {
            message += '\n\nIssues:\n' + result.issues.map(i => `- ${i}`).join('\n');
        }
        if (result.suggestions.length > 0) {
            message += '\n\nSuggestions:\n' + result.suggestions.map(s => `- ${s}`).join('\n');
        }
        return message;
    }
    requestPendingReviews() {
        console.log('REQUEST_PENDING_REVIEWS:{}');
    }
    async cleanup() {
        this.log(`Code Review Worker shutting down. Stats: ${this.reviewsCompleted} reviews, ${this.issuesFound} issues found`);
    }
}
const configArg = process.argv[2];
if (!configArg) {
    console.error('Usage: node codeReviewWorker.js <config-json>');
    process.exit(1);
}
const config = JSON.parse(configArg);
const worker = new CodeReviewWorker(config);
worker.start().catch(err => {
    console.error(`Worker failed to start: ${err.message}`);
    process.exit(1);
});
process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
});
process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
});
//# sourceMappingURL=codeReviewWorker.js.map