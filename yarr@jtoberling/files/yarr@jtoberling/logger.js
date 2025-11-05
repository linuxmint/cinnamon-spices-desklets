// Central logger for Yarr desklet
// - Errors are always logged
// - Info and debug logs are emitted only when enabled via settings

// Add diagnostic logging to see what's happening
try {
    global.log("=== LOGGER MODULE LOADING ===");
    global.log("global object type: " + typeof global);
    global.log("global.yarrDebugEnabled exists: " + (typeof global.yarrDebugEnabled !== 'undefined'));
    global.log("global.yarrDebugVerbosity exists: " + (typeof global.yarrDebugVerbosity !== 'undefined'));
} catch (e) {
    // Ignore errors here
}

// Store debug flag and verbosity on global to share across modules
if (typeof global.yarrDebugEnabled === 'undefined') {
    global.yarrDebugEnabled = false;
}

if (typeof global.yarrDebugVerbosity === 'undefined') {
    global.yarrDebugVerbosity = 'minimal';
}

function setDebugEnabled(enabled) {
    global.yarrDebugEnabled = !!enabled;
    // Add diagnostic logging to help debug
    try {
        global.log(`[Yarr Logger] setDebugEnabled called with: ${enabled}, global.yarrDebugEnabled now: ${global.yarrDebugEnabled}`);
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

function setDebugVerbosity(verbosity) {
    global.yarrDebugVerbosity = verbosity || 'minimal';
    // Add diagnostic logging to help debug
    try {
        global.log(`[Yarr Logger] setDebugVerbosity called with: ${verbosity}, global.yarrDebugVerbosity now: ${global.yarrDebugVerbosity}`);
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

function isDebugEnabled() {
    return !!global.yarrDebugEnabled;
}

function getDebugVerbosity() {
    return global.yarrDebugVerbosity || 'minimal';
}

// Helper function to format multiple arguments
function formatMessage(args) {
    try {
        return args.map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    } catch (_ignored) {
        return 'Error formatting message';
    }
}

// Simple logging - always shows
function log(...args) {
    try {
        global.log(formatMessage(args));
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

// Error logging - always shows
function error(...args) {
    try {
        global.log(`[Yarr Error] ${formatMessage(args)}`);
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

// Info logging - shows when debug is enabled and verbosity is basic or verbose
function info(...args) {
    try {
        if (!global.yarrDebugEnabled) return;

        const verbosityLevels = {
            'minimal': 0,
            'Minimal (errors only)': 0,
            'basic': 1,
            'Basic (errors + key operations)': 1,
            'verbose': 2,
            'Verbose (all debug info)': 2
        };
        const currentLevel = verbosityLevels[global.yarrDebugVerbosity] || 0;

        if (currentLevel >= 1) { // basic or verbose
            global.log(`[Yarr Info] ${formatMessage(args)}`);
        }
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

// Debug logging - shows only when debug is enabled and verbosity is verbose
function debug(...args) {
    try {
        if (!global.yarrDebugEnabled) return;

        const verbosityLevels = {
            'minimal': 0,
            'Minimal (errors only)': 0,
            'basic': 1,
            'Basic (errors + key operations)': 1,
            'verbose': 2,
            'Verbose (all debug info)': 2
        };
        const currentLevel = verbosityLevels[global.yarrDebugVerbosity] || 0;

        if (currentLevel >= 2) { // verbose only
            global.log(`[Yarr Debug] ${formatMessage(args)}`);
        }
    } catch (_ignored) {
        // Swallow logging errors to avoid cascading failures
    }
}

// Async Error Handler with retry mechanisms
class AsyncErrorHandler {
    static async withRetry(operation, maxRetries = 3, backoffMs = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (attempt === maxRetries) {
                    throw new Error(`Operation failed after ${maxRetries} attempts: ${error.message}`);
                }

                // Exponential backoff
                const delay = backoffMs * Math.pow(2, attempt - 1);
                await this._delay(delay);
            }
        }
    }

    static async withTimeout(operation, timeoutMs = 30000) {
        return Promise.race([
            operation(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
            )
        ]);
    }

    static _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Performance monitoring system
class PerformanceMonitor {
    constructor() {
        this.operations = new Map();
        this.slowThreshold = 100; // Operations taking >100ms are considered slow
        this.blockingThreshold = 500; // Operations taking >500ms are considered blocking
    }

    // Start timing an operation
    startOperation(name) {
        const startTime = performance.now();
        this.operations.set(name, { startTime, name });
        return name;
    }

    // End timing an operation and log performance data
    endOperation(name) {
        const operation = this.operations.get(name);
        if (!operation) {
            Logger.error(`Performance monitor: Operation '${name}' not found`);
            return;
        }

        const duration = performance.now() - operation.startTime;
        this.operations.delete(name);

        // Log performance data
        if (duration > this.blockingThreshold) {
            Logger.error(`[PERFORMANCE BLOCKING] Operation '${name}' took ${duration.toFixed(2)}ms - THIS IS BLOCKING CINNAMON!`);
        } else if (duration > this.slowThreshold) {
            Logger.error(`[PERFORMANCE SLOW] Operation '${name}' took ${duration.toFixed(2)}ms`);
        } else {
            Logger.debug(`[PERFORMANCE] Operation '${name}' took ${duration.toFixed(2)}ms`);
        }

        return duration;
    }

    // Check if any operations are taking too long
    checkForBlockingOperations() {
        const now = performance.now();
        for (const [name, operation] of this.operations) {
            const duration = now - operation.startTime;
            if (duration > this.blockingThreshold) {
                Logger.error(`[PERFORMANCE WARNING] Operation '${name}' has been running for ${duration.toFixed(2)}ms - may be blocking Cinnamon`);
            }
        }
    }

    // Get performance summary
    getPerformanceSummary() {
        return {
            activeOperations: this.operations.size,
            slowThreshold: this.slowThreshold,
            blockingThreshold: this.blockingThreshold
        };
    }
}

// Global performance monitor instance
const performanceMonitor = new PerformanceMonitor();

// Performance monitoring wrapper functions
function monitorOperation(name, operation) {
    const opName = performanceMonitor.startOperation(name);
    try {
        const result = operation();
        if (result && typeof result.then === 'function') {
            // Async operation
            return result.finally(() => performanceMonitor.endOperation(opName));
        } else {
            // Sync operation
            performanceMonitor.endOperation(opName);
            return result;
        }
    } catch (error) {
        performanceMonitor.endOperation(opName);
        throw error;
    }
}

function monitorAsyncOperation(name, operation) {
    const opName = performanceMonitor.startOperation(name);
    return operation().finally(() => performanceMonitor.endOperation(opName));
}


module.exports = {
    log,                    // Always shows
    error,                  // Always shows  
    info,                   // Shows when basic/verbose
    debug,                  // Shows only when verbose
    setDebugEnabled,
    setDebugVerbosity,
    isDebugEnabled,
    getDebugVerbosity,
    AsyncErrorHandler,
    PerformanceMonitor,
    performanceMonitor,
    monitorOperation,
    monitorAsyncOperation
};


