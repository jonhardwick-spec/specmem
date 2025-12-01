/**
 * FAIL-FAST SOCKET CONNECTION HELPER
 *
 * Provides robust socket connection with aggressive timeouts
 * to prevent hooks from freezing on dead embedding servers.
 */

const net = require('net');

/**
 * Connect to a socket with fail-fast behavior
 *
 * @param {string} socketPath - Path to Unix socket
 * @param {number} timeoutMs - Timeout in milliseconds (default 2000)
 * @returns {Promise<net.Socket>} - Connected socket
 */
function connectWithFailFast(socketPath, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    // Set socket timeout BEFORE connecting
    socket.setTimeout(timeoutMs);

    // Global abort timer as backup
    const abortTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`Socket connect timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs + 500);

    const cleanup = () => {
      clearTimeout(abortTimer);
      if (!settled) {
        socket.destroy();
      }
    };

    // Handle connection success
    socket.on('connect', () => {
      if (!settled) {
        settled = true;
        clearTimeout(abortTimer);
        resolve(socket);
      }
    });

    // Handle all error conditions
    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    socket.on('timeout', () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Socket timeout after ${timeoutMs}ms`));
      }
    });

    // Handle unexpected close during connect
    socket.on('close', () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Socket closed during connect'));
      }
    });

    // Attempt connection
    try {
      socket.connect(socketPath);
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    }
  });
}

/**
 * Send a message to socket and get response with fail-fast behavior
 *
 * @param {string} socketPath - Path to Unix socket
 * @param {object} message - Message object to send (will be JSON.stringify'd)
 * @param {number} timeoutMs - Timeout in milliseconds (default 2000)
 * @returns {Promise<object>} - Parsed JSON response
 */
async function sendMessage(socketPath, message, timeoutMs = 2000) {
  let socket = null;
  let settled = false;
  let buffer = '';

  try {
    // Connect with fail-fast
    socket = await connectWithFailFast(socketPath, timeoutMs);

    return new Promise((resolve, reject) => {
      const abortTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error(`Response timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(abortTimer);
        if (socket && !socket.destroyed) {
          socket.destroy();
        }
      };

      socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            // Check for completion (embedding response or error)
            if ((response.embedding || response.error || response.status === 'healthy') && !settled) {
              settled = true;
              cleanup();
              resolve(response);
              return;
            }
          } catch (e) {
            // Partial JSON, keep buffering
          }
        }
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });

      socket.on('close', () => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Socket closed before response received'));
        }
      });

      // Send the message
      try {
        socket.write(JSON.stringify(message) + '\n');
      } catch (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    });
  } catch (err) {
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
    throw err;
  }
}

/**
 * Check if socket is healthy with fail-fast behavior
 *
 * @param {string} socketPath - Path to Unix socket
 * @param {number} timeoutMs - Timeout in milliseconds (default 1000)
 * @returns {Promise<boolean>} - True if healthy, false otherwise
 */
async function isSocketHealthy(socketPath, timeoutMs = 1000) {
  const fs = require('fs');

  // Quick check if file exists
  if (!fs.existsSync(socketPath)) {
    return false;
  }

  try {
    const response = await sendMessage(
      socketPath,
      { type: 'health' },
      timeoutMs
    );
    return response.status === 'healthy' || !!response.embedding;
  } catch (err) {
    return false;
  }
}

/**
 * Generate embedding with fail-fast behavior
 *
 * @param {string} socketPath - Path to Unix socket
 * @param {string} text - Text to embed
 * @param {number} timeoutMs - Timeout in milliseconds (default 3000)
 * @returns {Promise<Array<number>>} - Embedding vector
 */
async function generateEmbedding(socketPath, text, timeoutMs = 3000) {
  const response = await sendMessage(
    socketPath,
    { type: 'embed', text },
    timeoutMs
  );

  if (response.error) {
    throw new Error(response.error);
  }

  if (!response.embedding) {
    throw new Error('No embedding in response');
  }

  return response.embedding;
}

module.exports = {
  connectWithFailFast,
  sendMessage,
  isSocketHealthy,
  generateEmbedding
};
