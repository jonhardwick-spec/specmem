/**
 * SPECMEM Shared Client-Side Logger
 *
 * Provides serverLog() function to send browser errors and messages
 * to the server for proper logging. All dashboard pages should include
 * this script for consistent server-side logging.
 *
 * Usage:
 *   <script src="/shared-logger.js"></script>
 *
 *   // In catch blocks:
 *   serverLog('error', 'Operation failed', { error: error.message, context: 'someValue' });
 *
 *   // Info logging:
 *   serverLog('info', 'User performed action', { action: 'clicked_button' });
 */

// Global server logging function
window.serverLog = async function(level, message, data = {}) {
    try {
        await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                level: level,
                message: message,
                page: window.location.pathname,
                data: data
            })
        });
    } catch (e) {
        // Silent fail - we don't want logging failures to break the app
        // But log to console as a fallback during development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.debug('[serverLog failed]', level, message, data, e);
        }
    }
};

// Capture unhandled errors globally and send to server
window.addEventListener('error', function(event) {
    serverLog('error', 'Unhandled error: ' + event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
    });
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    serverLog('error', 'Unhandled promise rejection', {
        reason: reason?.message || String(reason),
        stack: reason?.stack
    });
});

// Log page load for debugging
document.addEventListener('DOMContentLoaded', function() {
    serverLog('debug', 'Page loaded', {
        url: window.location.href,
        referrer: document.referrer
    });
});
