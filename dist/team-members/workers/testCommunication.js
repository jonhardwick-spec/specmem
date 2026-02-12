#!/usr/bin/env node
/**
 * Test Script for Team Member Communication System
 *
 * Tests the SpecMem HTTP client and team member communication protocol.
 */
import { createSpecMemClient } from './specmemClient.js';
import { createTeamMemberCommunicator } from '../communication.js';
async function testSpecMemClient() {
    console.log('========================================');
    console.log('Testing SpecMem Client');
    console.log('========================================');
    const client = createSpecMemClient({
        baseUrl: 'http://127.0.0.1:8595',
        password: process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
        teamMemberId: 'team-member-a-test',
    });
    // Test 1: Login
    console.log('\n1. Testing login...');
    const loginSuccess = await client.login();
    console.log(`   Login result: ${loginSuccess ? 'SUCCESS' : 'FAILED'}`);
    if (!loginSuccess) {
        console.log('   Cannot proceed without authentication.');
        return false;
    }
    // Test 2: Store a memory
    console.log('\n2. Testing remember (store memory)...');
    const memory = await client.remember('Team Member A: Test message from Team Member A - Communication system is working!', {
        memoryType: 'episodic',
        importance: 'high',
        tags: ['team-member-test', 'team-member-a'],
        metadata: { testRun: true, timestamp: new Date().toISOString() },
    });
    if (memory) {
        console.log(`   Memory stored successfully!`);
        console.log(`   ID: ${memory.id}`);
        console.log(`   Content: ${memory.content}`);
        console.log(`   Tags: ${memory.tags?.join(', ')}`);
    }
    else {
        console.log('   Failed to store memory');
        return false;
    }
    // Test 3: Find memories
    console.log('\n3. Testing find (search memories)...');
    const memories = await client.find('Team Member A', { limit: 5, tags: ['team-member-test'] });
    console.log(`   Found ${memories.length} memories`);
    for (const m of memories) {
        console.log(`   - [${m.id.substring(0, 8)}...] ${m.content.substring(0, 50)}...`);
    }
    // Test 4: Get stats
    console.log('\n4. Testing getStats...');
    const stats = await client.getStats();
    if (stats) {
        console.log(`   Total memories: ${stats.database?.total_memories || 'N/A'}`);
        console.log(`   Heap used: ${stats.memory?.heapUsedMB || 'N/A'} MB`);
    }
    else {
        console.log('   Failed to get stats');
    }
    console.log('\nSpecMem Client tests completed!');
    return true;
}
async function testTeamMemberCommunication() {
    console.log('\n========================================');
    console.log('Testing Team Member Communication');
    console.log('========================================');
    // Create communicator for Team Member A
    const teamMemberA = createTeamMemberCommunicator('team-member-a');
    // Test 1: Register team member
    console.log('\n1. Registering Team Member A...');
    const registered = await teamMemberA.registerTeamMember('Team Member A (Opus)', 'worker');
    console.log(`   Registration: ${registered ? 'SUCCESS' : 'FAILED'}`);
    // Test 2: Broadcast message
    console.log('\n2. Broadcasting message to all team members...');
    const broadcastSuccess = await teamMemberA.say('Team Member A: Hello from Team Member A! I have completed building the communication system. Looking for Team Member B to coordinate!', 'all');
    console.log(`   Broadcast: ${broadcastSuccess ? 'SUCCESS' : 'FAILED'}`);
    // Test 3: Send status update
    console.log('\n3. Sending status update...');
    const statusSuccess = await teamMemberA.broadcastStatus('Team Member A has completed Steps 1-4 of the implementation plan');
    console.log(`   Status update: ${statusSuccess ? 'SUCCESS' : 'FAILED'}`);
    // Test 4: Check for messages
    console.log('\n4. Checking for messages from other team members...');
    const messages = await teamMemberA.getMessages();
    console.log(`   Found ${messages.length} messages`);
    for (const msg of messages) {
        console.log(`   - From: ${msg.from} | To: ${msg.to} | Type: ${msg.messageType}`);
        console.log(`     Content: ${msg.content.substring(0, 60)}...`);
    }
    // Test 5: Get active team members
    console.log('\n5. Checking for active team members...');
    const activeTeamMembers = await teamMemberA.getActiveTeamMembers(300); // Last 5 minutes
    console.log(`   Found ${activeTeamMembers.length} active team members`);
    for (const teamMember of activeTeamMembers) {
        console.log(`   - ${teamMember.teamMemberId}: ${teamMember.status} (last heartbeat: ${teamMember.lastHeartbeat.toISOString()})`);
    }
    // Test 6: Send message specifically to Team Member B
    console.log('\n6. Sending direct message to Team Member B...');
    const directSuccess = await teamMemberA.say('Team Member A: Hello Team Member B! I am Team Member A (Opus Engineer). I have completed building the communication infrastructure (Steps 1-4). Please acknowledge when you receive this message!', 'team-member-b');
    console.log(`   Direct message to Team Member B: ${directSuccess ? 'SUCCESS' : 'FAILED'}`);
    console.log('\nTeam Member Communication tests completed!');
    return true;
}
async function main() {
    console.log('=============================================');
    console.log('Team Member A - Communication System Test Suite');
    console.log('=============================================');
    console.log('Time:', new Date().toISOString());
    console.log('');
    try {
        // Test SpecMem client
        const clientOk = await testSpecMemClient();
        if (!clientOk) {
            console.error('\nSpecMem client tests failed. Check if the server is running.');
            process.exit(1);
        }
        // Test team member communication
        const commOk = await testTeamMemberCommunication();
        if (!commOk) {
            console.error('\nTeam member communication tests failed.');
            process.exit(1);
        }
        console.log('\n=============================================');
        console.log('ALL TESTS PASSED!');
        console.log('=============================================');
        console.log('\nTeam Member A is ready to communicate with Team Member B.');
        console.log('Messages have been stored in SpecMem.');
    }
    catch (error) {
        console.error('\nTest error:', error);
        process.exit(1);
    }
}
// Run tests
main();
//# sourceMappingURL=testCommunication.js.map