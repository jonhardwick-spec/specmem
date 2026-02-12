#!/usr/bin/env node
/**
 * Team Member Communication Test Suite
 *
 * Comprehensive tests for the AI team member communication system:
 * - Test Scenario 1: Single Team Member Communication
 * - Test Scenario 2: Two Team Member Communication (bidirectional)
 * - Test Scenario 3: Team Member Discovery
 */
interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
    details?: string;
}
declare class TestRunner {
    private results;
    private startTime;
    runTest(name: string, testFn: () => Promise<void>): Promise<void>;
    printSummary(): void;
    getResults(): TestResult[];
    allPassed(): boolean;
}
export { TestRunner, TestResult };
//# sourceMappingURL=testCommunicationSuite.d.ts.map