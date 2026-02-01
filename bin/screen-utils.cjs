/**
 * Utilities for robust screen session detection
 */

const { execSync } = require('child_process');

/**
 * Check if a screen session exists for the given agent ID
 * Handles multiple naming patterns and properly parses screen -ls output
 *
 * @param {string} agentId - The agent ID to check
 * @returns {boolean} - True if session exists, false otherwise
 */
function checkScreenSessionExists(agentId) {
  try {
    // Get all screen session lines (format: \t<pid>.<name>\t<date>\t<state>)
    // Use grep -E to match lines starting with whitespace followed by digits and a dot
    const output = execSync(`screen -ls 2>&1 | grep -E "^\\s+[0-9]+\\." || true`, { encoding: 'utf8' });

    // Parse screen session lines
    const sessionLines = output.split('\n').filter(line => line.trim().length > 0);

    // Define possible naming patterns for this agent
    const agentPatterns = [
      `team-member-${agentId}`,  // Standard team member naming
      agentId,                     // Direct agent ID
      `agent-${agentId}`,         // Agent prefix naming
      `research-${agentId}`       // Research agent naming
    ];

    // Check if any session matches this agentId
    const sessionExists = sessionLines.some(line => {
      // Extract session name from line (format: \t<pid>.<name>\t...)
      const match = line.match(/^\s+(\d+)\.(\S+)\s/);
      if (!match) return false;

      const sessionName = match[2];

      // Check if session name matches any of our agent patterns
      return agentPatterns.some(pattern => {
        return sessionName === pattern || sessionName.includes(agentId);
      });
    });

    return sessionExists;
  } catch (error) {
    // On error, assume session doesn't exist
    return false;
  }
}

/**
 * Get all active screen sessions with parsed information
 *
 * @returns {Array<{pid: string, name: string, date: string, state: string}>}
 */
function getAllScreenSessions() {
  try {
    const output = execSync(`screen -ls 2>&1 | grep -E "^\\s+[0-9]+\\." || true`, { encoding: 'utf8' });
    const sessionLines = output.split('\n').filter(line => line.trim().length > 0);

    return sessionLines.map(line => {
      // Parse format: \t<pid>.<name>\t<date>\t<state>
      const match = line.match(/^\s+(\d+)\.(\S+)\s+\(([^)]+)\)\s+\((\w+)\)/);
      if (!match) return null;

      return {
        pid: match[1],
        name: match[2],
        date: match[3],
        state: match[4]
      };
    }).filter(Boolean);
  } catch (error) {
    return [];
  }
}

/**
 * Find screen session by agent ID
 *
 * @param {string} agentId - The agent ID to find
 * @returns {Object|null} - Session info or null if not found
 */
function findScreenSession(agentId) {
  const sessions = getAllScreenSessions();

  const agentPatterns = [
    `team-member-${agentId}`,
    agentId,
    `agent-${agentId}`,
    `research-${agentId}`
  ];

  return sessions.find(session => {
    return agentPatterns.some(pattern => {
      return session.name === pattern || session.name.includes(agentId);
    });
  }) || null;
}

module.exports = {
  checkScreenSessionExists,
  getAllScreenSessions,
  findScreenSession
};
