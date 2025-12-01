#!/usr/bin/env node
/**
 * Team Member Communication Test Suite
 *
 * Comprehensive tests for the AI team member communication system:
 * - Test Scenario 1: Single Team Member Communication
 * - Test Scenario 2: Two Team Member Communication (bidirectional)
 * - Test Scenario 3: Team Member Discovery
 */
import { createSpecMemClient } from './specmemClient.js';
import { createTeamMemberCommunicator, createMessageTags, parseMessageTags, memoryToMessage } from '../communication.js';
import { createTeamMemberDiscovery } from '../teamMemberDiscovery.js';
import { getPassword } from '../../config/password.js';
// ============================================================================
// Test Configuration
// ============================================================================
const TEST_CONFIG = {
    specmemUrl: process.env.SPECMEM_API_URL || 'http://127.0.0.1:8595',
    // Use centralized password module for consistent password resolution
    specmemPassword: getPassword(),
    testTimeout: 30000, // 30 seconds per test
};
class TestRunner {
    results = [];
    startTime = 0;
    async runTest(name, testFn) {
        console.log(`\n[TEST] Running: ${name}`);
        const start = Date.now();
        try {
            await Promise.race([
                testFn(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), TEST_CONFIG.testTimeout))
            ]);
            const duration = Date.now() - start;
            this.results.push({ name, passed: true, duration });
            console.log(`[PASS] ${name} (${duration}ms)`);
        }
        catch (error) {
            const duration = Date.now() - start;
            this.results.push({
                name,
                passed: false,
                duration,
                error: error.message || String(error)
            });
            console.error(`[FAIL] ${name} (${duration}ms)`);
            console.error(`  Error: ${error.message}`);
        }
    }
    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('TEST SUMMARY');
        console.log('='.repeat(60));
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.filter(r => !r.passed).length;
        const total = this.results.length;
        const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);
        console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);
        console.log(`Total Time: ${totalTime}ms\n`);
        if (failed > 0) {
            console.log('FAILED TESTS:');
            for (const result of this.results.filter(r => !r.passed)) {
                console.log(`  - ${result.name}: ${result.error}`);
            }
        }
        console.log('\n' + '='.repeat(60));
    }
    getResults() {
        return this.results;
    }
    allPassed() {
        return this.results.every(r => r.passed);
    }
}
// ============================================================================
// Test Scenarios
// ============================================================================
async function testScenario1_SingleTeamMemberCommunication(runner) {
    console.log('\n' + '='.repeat(60));
    console.log('SCENARIO 1: Single Team Member Communication');
    console.log('='.repeat(60));
    const teamMemberId = 'test-team-member-1';
    const client = createSpecMemClient({
        baseUrl: TEST_CONFIG.specmemUrl,
        password: TEST_CONFIG.specmemPassword,
        teamMemberId,
    });
    // Test 1.1: SpecMem Client Login
    await runner.runTest('1.1 SpecMem Client can authenticate', async () => {
        const success = await client.login();
        if (!success)
            throw new Error('Login failed');
        if (!client.isAuthenticated())
            throw new Error('Not authenticated after login');
    });
    // Test 1.2: TeamMember can store memory
    await runner.runTest('1.2 TeamMember can store memory via remember()', async () => {
        const memory = await client.remember('Test memory from Team Member 1', {
            memoryType: 'episodic',
            importance: 'medium',
            tags: ['test', 'team-member-1'],
        });
        if (!memory)
            throw new Error('Failed to store memory');
        if (!memory.id)
            throw new Error('Memory has no ID');
    });
    // Test 1.3: TeamMember can search memories
    await runner.runTest('1.3 TeamMember can search memories via find()', async () => {
        const memories = await client.find('Test memory', { limit: 5 });
        if (memories.length === 0)
            throw new Error('No memories found');
    });
    // Test 1.4: Communicator can send message
    const communicator = createTeamMemberCommunicator(teamMemberId, client);
    await runner.runTest('1.4 TeamMember can broadcast message via say()', async () => {
        const success = await communicator.say('Hello from test team member 1!');
        if (!success)
            throw new Error('Failed to send broadcast');
    });
    // Test 1.5: Communicator can send direct message
    await runner.runTest('1.5 TeamMember can send direct message', async () => {
        const success = await communicator.say('Direct message to team-member-2', 'test-team-member-2');
        if (!success)
            throw new Error('Failed to send direct message');
    });
    // Test 1.6: Communicator can receive messages
    await runner.runTest('1.6 TeamMember can receive messages via listen()', async () => {
        const messages = await communicator.listen();
        // Note: messages might be empty if this is a fresh run
        console.log(`  Received ${messages.length} messages`);
    });
    // Test 1.7: TeamMember can broadcast status
    await runner.runTest('1.7 TeamMember can broadcast status', async () => {
        const success = await communicator.broadcastStatus('Test status - running tests');
        if (!success)
            throw new Error('Failed to broadcast status');
    });
    // Test 1.8: TeamMember can send heartbeat
    await runner.runTest('1.8 TeamMember can send heartbeat', async () => {
        const success = await communicator.sendHeartbeat('active');
        if (!success)
            throw new Error('Failed to send heartbeat');
    });
    // Test 1.9: TeamMember can register
    await runner.runTest('1.9 TeamMember can register itself', async () => {
        const success = await communicator.registerTeamMember('Test Team Member 1', 'worker');
        if (!success)
            throw new Error('Failed to register team member');
    });
}
async function testScenario2_TwoTeamMemberCommunication(runner) {
    console.log('\n' + '='.repeat(60));
    console.log('SCENARIO 2: Two Team Member Communication');
    console.log('='.repeat(60));
    // Create two team member communicators
    const teamMemberAId = 'test-team-member-a-bidirectional';
    const teamMemberBId = 'test-team-member-b-bidirectional';
    const clientA = createSpecMemClient({
        baseUrl: TEST_CONFIG.specmemUrl,
        password: TEST_CONFIG.specmemPassword,
        teamMemberId: teamMemberAId,
    });
    const clientB = createSpecMemClient({
        baseUrl: TEST_CONFIG.specmemUrl,
        password: TEST_CONFIG.specmemPassword,
        teamMemberId: teamMemberBId,
    });
    const commA = createTeamMemberCommunicator(teamMemberAId, clientA);
    const commB = createTeamMemberCommunicator(teamMemberBId, clientB);
    // Test 2.1: Both team members can login
    await runner.runTest('2.1 Both team members can authenticate', async () => {
        const loginA = await clientA.login();
        const loginB = await clientB.login();
        if (!loginA || !loginB)
            throw new Error('One or both team members failed to login');
    });
    // Test 2.2: Team Member A broadcasts, Team Member B receives
    await runner.runTest('2.2 Team Member A broadcasts, Team Member B can receive', async () => {
        const testMessage = `Broadcast from A at ${Date.now()}`;
        const sent = await commA.say(testMessage);
        if (!sent)
            throw new Error('Team Member A failed to send broadcast');
        // Small delay for database write
        await new Promise(resolve => setTimeout(resolve, 500));
        // Team Member B listens for messages
        const messages = await commB.getMessages(new Date(Date.now() - 10000));
        const found = messages.find(m => m.content.includes('Broadcast from A'));
        if (!found) {
            console.log(`  Messages received by B: ${messages.length}`);
            throw new Error('Team Member B did not receive broadcast from Team Member A');
        }
        console.log(`  Team Member B received broadcast: "${found.content.substring(0, 50)}..."`);
    });
    // Test 2.3: Team Member B sends direct message to Team Member A
    await runner.runTest('2.3 Team Member B sends direct message to Team Member A', async () => {
        const testMessage = `Direct message from B to A at ${Date.now()}`;
        const sent = await commB.say(testMessage, teamMemberAId);
        if (!sent)
            throw new Error('Team Member B failed to send direct message');
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));
        // Team Member A listens
        const messages = await commA.getMessages(new Date(Date.now() - 10000));
        const found = messages.find(m => m.content.includes('Direct message from B to A') && m.to === teamMemberAId);
        if (!found) {
            throw new Error('Team Member A did not receive direct message from Team Member B');
        }
        console.log(`  Team Member A received direct message: "${found.content.substring(0, 50)}..."`);
    });
    // Test 2.4: Bidirectional exchange
    await runner.runTest('2.4 Bidirectional message exchange', async () => {
        // Team Member A sends to B
        await commA.say(`Reply test: A -> B at ${Date.now()}`, teamMemberBId);
        await new Promise(resolve => setTimeout(resolve, 500));
        // Team Member B sends to A
        await commB.say(`Reply test: B -> A at ${Date.now()}`, teamMemberAId);
        await new Promise(resolve => setTimeout(resolve, 500));
        // Verify both received
        const messagesA = await commA.getMessages(new Date(Date.now() - 10000));
        const messagesB = await commB.getMessages(new Date(Date.now() - 10000));
        const aReceivedFromB = messagesA.some(m => m.from === teamMemberBId);
        const bReceivedFromA = messagesB.some(m => m.from === teamMemberAId);
        if (!aReceivedFromB || !bReceivedFromA) {
            throw new Error('Bidirectional exchange incomplete');
        }
        console.log('  Bidirectional exchange successful');
    });
}
async function testScenario3_TeamMemberDiscovery(runner) {
    console.log('\n' + '='.repeat(60));
    console.log('SCENARIO 3: Team Member Discovery');
    console.log('='.repeat(60));
    const teamMemberId = 'test-discovery-team-member';
    // Test 3.1: Create discovery service
    let discovery = null;
    await runner.runTest('3.1 TeamMemberDiscovery can be created', async () => {
        discovery = createTeamMemberDiscovery(teamMemberId, 'Discovery Test Team Member', 'worker', {
            heartbeatIntervalMs: 5000, // 5 seconds for testing
            teamMemberExpiryMs: 30000, // 30 seconds for testing
        });
        if (!discovery)
            throw new Error('Failed to create discovery service');
    });
    // Test 3.2: Discovery service can start
    await runner.runTest('3.2 Discovery service can start', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        const started = await discovery.start();
        if (!started)
            throw new Error('Failed to start discovery service');
        if (!discovery.isActive())
            throw new Error('Discovery service not active');
    });
    // Test 3.3: Can send heartbeat
    await runner.runTest('3.3 Can send heartbeat', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        const sent = await discovery.sendHeartbeat();
        if (!sent)
            throw new Error('Failed to send heartbeat');
    });
    // Test 3.4: Can update status
    await runner.runTest('3.4 Can update team member status', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        await discovery.setStatus('busy', 'Running tests');
        const status = discovery.getStatus();
        if (status !== 'busy')
            throw new Error(`Expected 'busy', got '${status}'`);
    });
    // Test 3.5: Can discover team members (including self)
    await runner.runTest('3.5 Can discover active team members', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        // Wait a moment for heartbeat to be stored
        await new Promise(resolve => setTimeout(resolve, 1000));
        const teamMembers = await discovery.getActiveTeamMembers(60000); // Last 60 seconds
        console.log(`  Found ${teamMembers.length} active team members`);
        // Should find at least this team member
        const foundSelf = teamMembers.some(a => a.teamMemberId === teamMemberId);
        if (!foundSelf) {
            console.log('  Active teamMembers:', teamMembers.map(a => a.teamMemberId));
            throw new Error('Team Member did not find itself in active team members list');
        }
    });
    // Test 3.6: Can check if specific team member is online
    await runner.runTest('3.6 Can check if specific team member is online', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        const isOnline = await discovery.isTeamMemberOnline(teamMemberId);
        if (!isOnline)
            throw new Error('Team Member not detected as online');
    });
    // Test 3.7: Can get team member info
    await runner.runTest('3.7 Can get team member info', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        const info = await discovery.getTeamMemberInfo(teamMemberId);
        if (!info)
            throw new Error('Failed to get team member info');
        if (info.teamMemberId !== teamMemberId)
            throw new Error('Wrong team member ID in info');
        console.log(`  TeamMember info: ${info.teamMemberName} (${info.status})`);
    });
    // Test 3.8: Discovery service can stop
    await runner.runTest('3.8 Discovery service can stop', async () => {
        if (!discovery)
            throw new Error('Discovery not initialized');
        await discovery.stop();
        if (discovery.isActive())
            throw new Error('Discovery service still active after stop');
    });
}
async function testMessageTagHelpers(runner) {
    console.log('\n' + '='.repeat(60));
    console.log('ADDITIONAL: Message Tag Helper Tests');
    console.log('='.repeat(60));
    // Test tag creation
    await runner.runTest('Tag creation works correctly', async () => {
        const tags = createMessageTags('team-member-a', 'team-member-b', 'direct');
        if (!tags.includes('team-member-message'))
            throw new Error('Missing team-member-message tag');
        if (!tags.includes('from:team-member-a'))
            throw new Error('Missing from tag');
        if (!tags.includes('to:team-member-b'))
            throw new Error('Missing to tag');
        if (!tags.includes('type:direct'))
            throw new Error('Missing type tag');
    });
    // Test tag parsing
    await runner.runTest('Tag parsing works correctly', async () => {
        const tags = ['team-member-message', 'from:test-team-member', 'to:all', 'type:broadcast'];
        const parsed = parseMessageTags(tags);
        if (!parsed.isTeamMemberMessage)
            throw new Error('Not recognized as team member message');
        if (parsed.from !== 'test-team-member')
            throw new Error(`Wrong from: ${parsed.from}`);
        if (parsed.to !== 'all')
            throw new Error(`Wrong to: ${parsed.to}`);
        if (parsed.messageType !== 'broadcast')
            throw new Error(`Wrong type: ${parsed.messageType}`);
    });
    // Test memory to message conversion
    await runner.runTest('Memory to message conversion works', async () => {
        const mockMemory = {
            id: 'test-123',
            content: 'Test message content',
            memory_type: 'episodic',
            importance: 'medium',
            tags: ['team-member-message', 'from:sender', 'to:receiver', 'type:direct'],
            created_at: new Date().toISOString(),
        };
        const message = memoryToMessage(mockMemory);
        if (!message)
            throw new Error('Conversion returned null');
        if (message.from !== 'sender')
            throw new Error(`Wrong from: ${message.from}`);
        if (message.to !== 'receiver')
            throw new Error(`Wrong to: ${message.to}`);
        if (message.messageType !== 'direct')
            throw new Error(`Wrong type: ${message.messageType}`);
    });
}
// ============================================================================
// Main Test Runner
// ============================================================================
async function runAllTests() {
    console.log('\n');
    console.log('*'.repeat(60));
    console.log('*  TEAM_MEMBER COMMUNICATION TEST SUITE');
    console.log('*  Date: ' + new Date().toISOString());
    console.log('*'.repeat(60));
    const runner = new TestRunner();
    try {
        // Run all test scenarios
        await testMessageTagHelpers(runner);
        await testScenario1_SingleTeamMemberCommunication(runner);
        await testScenario2_TwoTeamMemberCommunication(runner);
        await testScenario3_TeamMemberDiscovery(runner);
    }
    catch (error) {
        console.error('\n[CRITICAL ERROR]', error.message);
    }
    // Print summary
    runner.printSummary();
    // Exit with appropriate code
    if (runner.allPassed()) {
        console.log('\n[SUCCESS] All tests passed!\n');
        // Store test results in SpecMem
        const client = createSpecMemClient({
            baseUrl: TEST_CONFIG.specmemUrl,
            password: TEST_CONFIG.specmemPassword,
        });
        await client.remember(`Team Member Communication Test Suite Results - ${new Date().toISOString()}\n\n` +
            `All ${runner.getResults().length} tests PASSED\n\n` +
            `Tests run:\n${runner.getResults().map(r => `- ${r.name}: ${r.passed ? 'PASS' : 'FAIL'} (${r.duration}ms)`).join('\n')}`, {
            memoryType: 'episodic',
            importance: 'high',
            tags: ['test-results', 'team-member-communication', 'from:team-member-b'],
        });
        process.exit(0);
    }
    else {
        console.log('\n[FAILURE] Some tests failed!\n');
        process.exit(1);
    }
}
// Run tests
runAllTests().catch(err => {
    console.error('Test suite crashed:', err);
    process.exit(1);
});
export { TestRunner };
//# sourceMappingURL=testCommunicationSuite.js.map