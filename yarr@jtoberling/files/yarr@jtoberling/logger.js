// Central logger for Yarr desklet
// - Errors are always logged
// - Debug logs are emitted only when enabled via settings

// Store debug flag on globalThis to share across modules without tight coupling
if (typeof globalThis.yarrDebugEnabled === 'undefined') {
    globalThis.yarrDebugEnabled = false;
}

function setDebugEnabled(enabled) {
    globalThis.yarrDebugEnabled = !!enabled;
}

function isDebugEnabled() {
    return !!globalThis.yarrDebugEnabled;
}

function log(message, isError = false) {
    try {
        const text = String(message);
        const hasPrefix = /^\[Yarr\s+(Error|Warning|Debug)\]/.test(text);

        if (isError) {
            // Always log errors
            global.log(hasPrefix ? text : '[Yarr Error] ' + text);
            return;
        }

        // If message already has a prefix, decide based on its type
        if (hasPrefix) {
            if (/^\[Yarr\s+Error\]/.test(text)) {
                global.log(text);
                return;
            }
            // Warnings and Debug are gated by the debug flag
            if (globalThis.yarrDebugEnabled) {
                global.log(text);
            }
            return;
        }

        // Default: treat as debug
        if (globalThis.yarrDebugEnabled) {
            global.log('[Yarr Debug] ' + text);
        }
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

module.exports = {
    log,
    setDebugEnabled,
    isDebugEnabled,
};


