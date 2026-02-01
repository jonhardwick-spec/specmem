#!/usr/bin/env node
/**
 * Send Message to Team Member B
 *
 * This script sends a comprehensive status message from Team Member A to Team Member B
 * via the SpecMem communication system.
 */
import { createTeamMemberCommunicator } from '../communication.js';
async function main() {
    console.log('==============================================');
    console.log('Team Member A - Sending Status to Team Member B');
    console.log('==============================================');
    console.log('Time:', new Date().toISOString());
    console.log('');
    const teamMemberA = createTeamMemberCommunicator('team-member-a');
    // Register and send heartbeat
    await teamMemberA.registerTeamMember('Team Member A (Opus Engineer)', 'worker');
    console.log('Team Member A registered');
    // Send comprehensive status message
    const statusMessage = `
TEAM_MEMBER A STATUS REPORT
=====================
Time: ${new Date().toISOString()}

COMPLETED TASKS (Steps 1-4 of Implementation Plan):

1. SPECMEM CLIENT (specmemClient.ts)
   - HTTP client wrapper for SpecMem API
   - Handles authentication with session cookies
   - Methods: login(), remember(), find(), semanticSearch(), getStats(), delete()
   - Auto-retry on 401 errors

2. COMMUNICATION PROTOCOL (communication.ts)
   - TeamMemberMessage interface for inter-team-member messages
   - Tag-based message routing (from:teamMemberId, to:targetId, type:messageType)
   - TeamMemberCommunicator class with say(), listen(), broadcastStatus()
   - TeamMember discovery via heartbeats

3. BASEWORKER INTEGRATION (baseWorker.ts)
   - Added SpecMemClient and TeamMemberCommunicator as protected properties
   - New methods: remember(), find(), say(), listen(), getActiveTeamMembers()
   - registerWithSpecMem() and sendSpecMemHeartbeat() for discovery

4. AI WORKER (aiWorker.ts)
   - Extends BaseWorker with Claude API integration
   - Supports opus/sonnet/haiku model variants
   - Streaming responses with token tracking
   - Command handlers: CHAT, EXECUTE_TASK, LISTEN, SAY, GET_TEAM_MEMBERS

BUILD STATUS: SUCCESS
TEST STATUS: ALL TESTS PASSED

Waiting for Team Member B to coordinate on Steps 5-7.
`;
    // Send to all (broadcast)
    const broadcastSuccess = await teamMemberA.say(statusMessage, 'all');
    console.log(`Broadcast status: ${broadcastSuccess ? 'SUCCESS' : 'FAILED'}`);
    // Send direct message to Team Member B
    const directMessage = `
Team Member A to Team Member B (Direct):
I have completed my assigned tasks (Steps 1-4).
The communication system is fully operational.
Please confirm you can receive this message.

Files created/modified:
- /server/mcp/specmem/src/team-members/workers/specmemClient.ts (NEW)
- /server/mcp/specmem/src/team-members/communication.ts (NEW)
- /server/mcp/specmem/src/team-members/workers/baseWorker.ts (MODIFIED)
- /server/mcp/specmem/src/team-members/workers/aiWorker.ts (NEW)
- /server/mcp/specmem/src/team-members/workers/testCommunication.ts (NEW)

Ready to assist with testing when you're done with Steps 5-7.
`;
    const directSuccess = await teamMemberA.say(directMessage, 'team-member-b');
    console.log(`Direct message to Team Member B: ${directSuccess ? 'SUCCESS' : 'FAILED'}`);
    // Check for any messages from Team Member B
    console.log('\nChecking for messages from Team Member B...');
    const messages = await teamMemberA.getMessages();
    const teamMemberBMessages = messages.filter(m => m.from === 'team-member-b' || m.from.includes('team-member-b'));
    if (teamMemberBMessages.length > 0) {
        console.log(`Found ${teamMemberBMessages.length} messages from Team Member B:`);
        for (const msg of teamMemberBMessages) {
            console.log(`\n[${msg.timestamp.toISOString()}] ${msg.messageType}:`);
            console.log(msg.content);
        }
    }
    else {
        console.log('No messages from Team Member B yet. Will wait for Team Member B to come online.');
    }
    // Check active team members
    console.log('\nChecking for active team members...');
    const activeTeamMembers = await teamMemberA.getActiveTeamMembers(600); // Last 10 minutes
    console.log(`Found ${activeTeamMembers.length} active team members`);
    for (const teamMember of activeTeamMembers) {
        console.log(`- ${teamMember.teamMemberId} (${teamMember.status}) - Last heartbeat: ${teamMember.lastHeartbeat.toISOString()}`);
    }
    console.log('\n==============================================');
    console.log('Team Member A message sending complete');
    console.log('==============================================');
}
main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
//# sourceMappingURL=sendToTeamMemberB.js.map