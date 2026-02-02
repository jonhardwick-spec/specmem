#!/usr/bin/env node
/**
 * MCP Socket Client - CLI to MCP Communication
 *
 * Connects to SpecMem MCP server via Unix socket
 * Handles JSON-RPC 2.0 requests/responses with queueing and timeouts
 *
 * Socket location: {projectPath}/.specmem/specmem.sock
 *
 * @author hardwicksoftwareservices
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

/**
 * MCPSocketClient - Production-ready socket client for MCP tool invocation
 *
 * Features:
 * - JSON-RPC 2.0 protocol
 * - Request queueing when disconnected
 * - Automatic reconnection with exponential backoff
 * - Request timeouts
 * - Command history for display
 * - Malformed response handling
 */
class MCPSocketClient {
  constructor(projectPath) {
    this.projectPath = projectPath;
    // Socket in project .specmem directory
    this.socketPath = path.join(projectPath, '.specmem', 'specmem.sock');
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.requestId = 0;
    this.pendingRequests = new Map(); // id -> { resolve, reject, timeout }
    this.requestQueue = [];           // Queued requests while disconnected
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;       // ms between reconnect attempts
    this.requestTimeout = 30000;      // 30s default timeout
    this.responseBuffer = '';         // Buffer for partial JSON responses
    this.commandHistory = [];         // History of commands for display
    this.maxHistory = 50;
  }

  /**
   * Check if socket file exists
   */
  socketExists() {
    return fs.existsSync(this.socketPath);
  }

  /**
   * Connect to the MCP socket
   * Returns a promise that resolves when connected or rejects on failure
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve(true);
        return;
      }

      if (this.connecting) {
        // Already connecting, queue this request
        this.requestQueue.push({ type: 'connect', resolve, reject });
        return;
      }

      if (!this.socketExists()) {
        reject(new Error('Socket not found: ' + this.socketPath + ' - Is SpecMem MCP server running?'));
        return;
      }

      this.connecting = true;
      this.socket = new net.Socket();

      // Connection timeout
      const connectTimeout = setTimeout(() => {
        this.socket.destroy();
        this.connecting = false;
        reject(new Error('Connection timeout - MCP server not responding'));
      }, 5000);

      this.socket.on('connect', () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        this.connecting = false;
        this.reconnectAttempts = 0;
        this._processQueue();
        resolve(true);
      });

      this.socket.on('data', (data) => {
        this._handleData(data);
      });

      this.socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        this.connected = false;
        this.connecting = false;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this._scheduleReconnect();
        } else {
          reject(new Error('Connection failed: ' + err.message));
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this._rejectPendingRequests('Connection closed');
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this._scheduleReconnect();
        }
      });

      this.socket.connect(this.socketPath);
    });
  }

  /**
   * Handle incoming data from socket
   * Buffers partial responses and parses complete JSON-RPC messages
   */
  _handleData(data) {
    this.responseBuffer += data.toString();

    // Try to parse complete JSON messages (newline delimited)
    const lines = this.responseBuffer.split('\n');
    this.responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line);
        this._handleResponse(response);
      } catch (e) {
        // Malformed JSON - log and continue
        this._addToHistory({
          type: 'error',
          message: 'Malformed response: ' + line.substring(0, 100),
          timestamp: new Date()
        });
      }
    }
  }

  /**
   * Handle a parsed JSON-RPC response
   */
  _handleResponse(response) {
    // JSON-RPC 2.0 response format: { jsonrpc: "2.0", id, result/error }
    if (response.id !== undefined) {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(response.error.message || 'RPC Error'));
        } else {
          pending.resolve(response.result);
        }
      }
    }

    // Also handle notifications (no id)
    if (response.method && !response.id) {
      this._handleNotification(response);
    }
  }

  /**
   * Handle JSON-RPC notifications (server-initiated messages)
   */
  _handleNotification(notification) {
    this._addToHistory({
      type: 'notification',
      method: notification.method,
      params: notification.params,
      timestamp: new Date()
    });
  }

  /**
   * Schedule a reconnection attempt
   */
  _scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect failed, will try again if under max attempts
      });
    }, Math.min(delay, 30000)); // Cap at 30s
  }

  /**
   * Process queued requests after connection established
   */
  _processQueue() {
    while (this.requestQueue.length > 0 && this.connected) {
      const queued = this.requestQueue.shift();
      if (queued.type === 'connect') {
        queued.resolve(true);
      } else if (queued.type === 'request') {
        this._sendRequest(queued.method, queued.params)
          .then(queued.resolve)
          .catch(queued.reject);
      }
    }
  }

  /**
   * Reject all pending requests (on disconnect/error)
   */
  _rejectPendingRequests(reason) {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /**
   * Send a JSON-RPC request to the MCP server
   *
   * @param {string} method - The MCP tool/method name
   * @param {object} params - Parameters for the method
   * @param {number} timeout - Request timeout in ms (default 30s)
   * @returns {Promise<any>} - Resolves with result or rejects with error
   */
  request(method, params = {}, timeout = this.requestTimeout) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        // Queue request and try to connect
        this.requestQueue.push({ type: 'request', method, params, resolve, reject });
        this.connect().catch(reject);
        return;
      }

      this._sendRequest(method, params, timeout).then(resolve).catch(reject);
    });
  }

  /**
   * Internal: Send request over socket
   */
  _sendRequest(method, params = {}, timeout = this.requestTimeout) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id: id,
        method: method,
        params: params
      };

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout: ' + method));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

      // Add to history
      this._addToHistory({
        type: 'request',
        method: method,
        params: params,
        id: id,
        timestamp: new Date()
      });

      // Send request (newline delimited JSON)
      try {
        this.socket.write(JSON.stringify(request) + '\n');
      } catch (e) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(id);
        reject(new Error('Failed to send request: ' + e.message));
      }
    });
  }

  /**
   * Add entry to command history for display
   */
  _addToHistory(entry) {
    this.commandHistory.unshift(entry);
    if (this.commandHistory.length > this.maxHistory) {
      this.commandHistory.pop();
    }
  }

  /**
   * Get formatted command history for bottom-left quadrant display
   *
   * @param {number} maxLines - Maximum number of lines to return
   * @param {number} maxWidth - Maximum width per line
   * @param {object} colors - ANSI color object with dim, cyan, green, red, yellow, reset
   * @param {object} icons - Icon object with success, error
   * @returns {string[]} - Array of formatted lines
   */
  getHistoryLines(maxLines = 10, maxWidth = 40, colors = {}, icons = {}) {
    const c = colors;
    const lines = [];

    for (const entry of this.commandHistory.slice(0, maxLines)) {
      const time = entry.timestamp.toLocaleTimeString().slice(0, 8);
      let line = '';

      switch (entry.type) {
        case 'request':
          line = (c.dim || '') + time + (c.reset || '') + ' ' + (c.cyan || '') + entry.method + (c.reset || '');
          break;
        case 'response':
          line = (c.dim || '') + time + (c.reset || '') + ' ' + (c.green || '') + (icons.success || 'OK') + (c.reset || '') + ' ' + (entry.preview || 'OK');
          break;
        case 'error':
          line = (c.dim || '') + time + (c.reset || '') + ' ' + (c.red || '') + (icons.error || 'ERR') + (c.reset || '') + ' ' + entry.message;
          break;
        case 'notification':
          line = (c.dim || '') + time + (c.reset || '') + ' ' + (c.yellow || '') + entry.method + (c.reset || '');
          break;
        default:
          line = (c.dim || '') + time + (c.reset || '') + ' ' + JSON.stringify(entry).substring(0, maxWidth - 10);
      }

      // Truncate to maxWidth (simple, no ANSI awareness for standalone module)
      if (line.length > maxWidth) {
        line = line.substring(0, maxWidth - 3) + '...';
      }
      lines.push(line);
    }

    return lines;
  }

  /**
   * Invoke an MCP tool by name
   *
   * @param {string} toolName - Tool name (e.g., 'find_memory', 'save_memory')
   * @param {object} params - Tool parameters
   * @returns {Promise<any>} - Tool result
   */
  async callTool(toolName, params = {}) {
    // MCP tools use tools/call method
    const result = await this.request('tools/call', {
      name: toolName,
      arguments: params
    });

    // Add result summary to history
    this._addToHistory({
      type: 'response',
      toolName: toolName,
      preview: this._summarizeResult(result),
      timestamp: new Date()
    });

    return result;
  }

  /**
   * Create a short preview of result for history display
   */
  _summarizeResult(result) {
    if (!result) return '(empty)';
    if (typeof result === 'string') {
      return result.substring(0, 50) + (result.length > 50 ? '...' : '');
    }
    if (Array.isArray(result)) {
      return '[' + result.length + ' items]';
    }
    if (typeof result === 'object') {
      const keys = Object.keys(result);
      if (result.content) {
        return String(result.content).substring(0, 40) + '...';
      }
      return '{' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '') + '}';
    }
    return String(result).substring(0, 50);
  }

  /**
   * Send a health check to the server
   * Uses simple protocol (not JSON-RPC) for compatibility with instanceManager
   */
  async healthCheck() {
    return new Promise((resolve, reject) => {
      if (!this.socketExists()) {
        reject(new Error('Socket not found'));
        return;
      }

      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Health check timeout'));
      }, 3000);

      socket.on('connect', () => {
        socket.write('health');
      });

      socket.on('data', (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          socket.destroy();
          resolve(response);
        } catch (e) {
          socket.destroy();
          reject(new Error('Invalid health response'));
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(err);
      });

      socket.connect(this.socketPath);
    });
  }

  /**
   * Get connection status info
   */
  getStatus() {
    return {
      connected: this.connected,
      socketPath: this.socketPath,
      socketExists: this.socketExists(),
      pendingRequests: this.pendingRequests.size,
      queuedRequests: this.requestQueue.length,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Close the connection
   */
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
    this._rejectPendingRequests('Disconnected');
  }
}

module.exports = { MCPSocketClient };
