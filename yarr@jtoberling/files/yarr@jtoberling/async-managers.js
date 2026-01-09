const Logger = require('./logger');

// Import GLib and Gio with error handling
let GLib, Gio;
try {
    GLib = imports.gi.GLib;
    Gio = imports.gi.Gio;
    Logger.debug('GLib and Gio imported successfully');
} catch (e) {
    Logger.error('Failed to import GLib/Gio:', e);
    throw e;
}

// Async Operation Manager for cancellation and cleanup
class AsyncOperationManager {
    constructor() {
        this.activeOperations = new Map();
        this.operationCounter = 0;
        this.isShuttingDown = false;
        this.cancellationTokens = new Set();
    }

    // Create a new cancellation token
    createCancellationToken() {
        const token = `token_${++this.operationCounter}`;
        this.cancellationTokens.add(token);
        return token;
    }

    // Check if operation should be cancelled
    isCancelled(token) {
        return this.isShuttingDown || !this.cancellationTokens.has(token);
    }

    // Register an async operation
    registerOperation(operationId, operationType, cancellationToken) {
        if (this.isShuttingDown) {
            Logger.warn(`Operation ${operationId} rejected - system shutting down`);
            return false;
        }

        this.activeOperations.set(operationId, {
            type: operationType,
            token: cancellationToken,
            startTime: Date.now(),
            status: 'active'
        });

        Logger.debug(`Registered async operation: ${operationId} (${operationType})`);
        return true;
    }

    // Unregister a completed operation
    unregisterOperation(operationId) {
        const operation = this.activeOperations.get(operationId);
        if (operation) {
            operation.status = 'completed';
            operation.endTime = Date.now();
            this.activeOperations.delete(operationId);
            Logger.debug(`Unregistered async operation: ${operationId}`);
        }
    }

    // Cancel all operations
    cancelAllOperations() {
        Logger.info('Cancelling all async operations...');
        this.isShuttingDown = true;

        const operationCount = this.activeOperations.size;
        this.activeOperations.clear();
        this.cancellationTokens.clear();

        Logger.info(`Cancelled ${operationCount} async operations`);
    }

    // Get operation status
    getOperationStatus() {
        return {
            total: this.activeOperations.size,
            shuttingDown: this.isShuttingDown,
            operations: Array.from(this.activeOperations.entries()).map(([id, op]) => ({
                id,
                type: op.type,
                status: op.status,
                duration: op.startTime ? Date.now() - op.startTime : 0
            }))
        };
    }

    // Cleanup method
    cleanup() {
        try {
            Logger.info('Cleaning up AsyncOperationManager');
            this.cancelAllOperations();
            Logger.info('AsyncOperationManager cleanup completed');
        } catch (e) {
            Logger.error('Error in AsyncOperationManager cleanup: ' + e);
        }
    }
}

// Enhanced Timer Manager to prevent overlapping operations and memory leaks
class TimerManager {
    constructor() {
        this.activeTimers = new Map();
        this.timerCounter = 0;
        this.glibTimers = new Map(); // Track GLib timers
        this.setTimeoutTimers = new Map(); // Track setTimeout timers
        this.mainloopTimers = new Map(); // Track Mainloop timers
    }

    addTimer(interval, callback, isSeconds = false) {
        const timerId = `timer_${++this.timerCounter}`;

        const glibTimerId = isSeconds
            ? GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.activeTimers.delete(timerId);
                    this.glibTimers.delete(timerId);
                }
                return shouldContinue;
            })
            : GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.activeTimers.delete(timerId);
                    this.glibTimers.delete(timerId);
                }
                return shouldContinue;
            });

        this.activeTimers.set(timerId, glibTimerId);
        this.glibTimers.set(timerId, glibTimerId);
        return timerId;
    }

    // Add GLib timer with tracking
    addGLibTimer(interval, callback, priority = GLib.PRIORITY_DEFAULT, isSeconds = false) {
        const timerId = `glib_${++this.timerCounter}`;

        const glibTimerId = isSeconds
            ? GLib.timeout_add_seconds(priority, interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.glibTimers.delete(timerId);
                }
                return shouldContinue;
            })
            : GLib.timeout_add(priority, interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.glibTimers.delete(timerId);
                }
                return shouldContinue;
            });

        this.glibTimers.set(timerId, glibTimerId);
        return timerId;
    }

    // Add setTimeout timer with tracking
    addSetTimeoutTimer(callback, delay) {
        const timerId = `settimeout_${++this.timerCounter}`;

        const timeoutId = setTimeout(() => {
            callback();
            this.setTimeoutTimers.delete(timerId);
        }, delay);

        this.setTimeoutTimers.set(timerId, timeoutId);
        return timerId;
    }

    // Add Mainloop timer with tracking
    addMainloopTimer(interval, callback, isSeconds = false) {
        const timerId = `mainloop_${++this.timerCounter}`;

        const Mainloop = imports.mainloop;
        const mainloopTimerId = isSeconds
            ? Mainloop.timeout_add_seconds(interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.mainloopTimers.delete(timerId);
                }
                return shouldContinue;
            })
            : Mainloop.timeout_add(interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.mainloopTimers.delete(timerId);
                }
                return shouldContinue;
            });

        this.mainloopTimers.set(timerId, mainloopTimerId);
        return timerId;
    }

    removeTimer(timerId) {
        const glibTimerId = this.activeTimers.get(timerId);
        if (glibTimerId) {
            GLib.source_remove(glibTimerId);
            this.activeTimers.delete(timerId);
            this.glibTimers.delete(timerId);
        }
    }

    removeGLibTimer(timerId) {
        const glibTimerId = this.glibTimers.get(timerId);
        if (glibTimerId) {
            GLib.source_remove(glibTimerId);
            this.glibTimers.delete(timerId);
        }
    }

    removeSetTimeoutTimer(timerId) {
        const timeoutId = this.setTimeoutTimers.get(timerId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.setTimeoutTimers.delete(timerId);
        }
    }

    removeMainloopTimer(timerId) {
        const mainloopTimerId = this.mainloopTimers.get(timerId);
        if (mainloopTimerId) {
            const Mainloop = imports.mainloop;
            Mainloop.source_remove(mainloopTimerId);
            this.mainloopTimers.delete(timerId);
        }
    }

    clearAllTimers() {
        // Clear GLib timers
        this.glibTimers.forEach(glibTimerId => {
            try {
                GLib.source_remove(glibTimerId);
            } catch (e) {
                Logger.debug('Error removing GLib timer: ' + e);
            }
        });
        this.glibTimers.clear();

        // Clear setTimeout timers
        this.setTimeoutTimers.forEach(timeoutId => {
            try {
                clearTimeout(timeoutId);
            } catch (e) {
                Logger.debug('Error removing setTimeout timer: ' + e);
            }
        });
        this.setTimeoutTimers.clear();

        // Clear Mainloop timers
        this.mainloopTimers.forEach(mainloopTimerId => {
            try {
                const Mainloop = imports.mainloop;
                Mainloop.source_remove(mainloopTimerId);
            } catch (e) {
                Logger.debug('Error removing Mainloop timer: ' + e);
            }
        });
        this.mainloopTimers.clear();

        // Clear active timers
        this.activeTimers.clear();
    }

    // Get timer counts for debugging
    getTimerCounts() {
        return {
            total: this.activeTimers.size + this.glibTimers.size + this.setTimeoutTimers.size + this.mainloopTimers.size,
            active: this.activeTimers.size,
            glib: this.glibTimers.size,
            setTimeout: this.setTimeoutTimers.size,
            mainloop: this.mainloopTimers.size
        };
    }

    // Cleanup method to prevent memory leaks
    cleanup() {
        try {
            Logger.info('Cleaning up TimerManager');
            const counts = this.getTimerCounts();
            Logger.info(`Timer counts before cleanup: ${JSON.stringify(counts)}`);
            this.clearAllTimers();
            Logger.info('TimerManager cleanup completed');
        } catch (e) {
            Logger.error('Error in TimerManager cleanup: ' + e);
        }
    }
}

// UI Update Manager for batching and throttling
class UIUpdateManager {
    constructor() {
        this.pendingUpdate = false;
        this.updateScheduled = false;
        this.BATCH_SIZE = 10; // Items per frame
        this.RAF_INTERVAL = 16; // ~60fps
        this.scheduledTimerId = null; // Track scheduled timer
    }

    scheduleUpdate() {
        if (this.updateScheduled) return;

        this.updateScheduled = true;
        this.scheduledTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.RAF_INTERVAL, () => {
            this.updateScheduled = false;
            this.scheduledTimerId = null;
            this._performBatchedUpdate();
            return false;
        });
    }

    _performBatchedUpdate() {
        // This will be implemented when we refactor displayItems
        if (this.onUpdateCallback) {
            this.onUpdateCallback();
        }
    }

    setUpdateCallback(callback) {
        this.onUpdateCallback = callback;
    }

    // Cleanup method to prevent memory leaks
    cleanup() {
        try {
            Logger.info('Cleaning up UIUpdateManager');
            if (this.scheduledTimerId) {
                GLib.source_remove(this.scheduledTimerId);
                this.scheduledTimerId = null;
            }
        } catch (e) {
            Logger.error('Error in UIUpdateManager cleanup: ' + e);
        }
    }
}

// Async Command Executor using Gio.Subprocess for proper async execution
class AsyncCommandExecutor {
    static executeCommand(command, callback) {
        try {
            // Parse the command into argv array
            let [success, argv] = GLib.shell_parse_argv(command);
            if (!success) {
                callback(false, null, "Failed to parse command");
                return;
            }

            Logger.debug(`Executing command: ${command}`);
            Logger.debug(`Parsed argv: ${JSON.stringify(argv)}`);

            // Create subprocess with proper flags
            let process = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });

            process.init(null);

            // Set up timeout to prevent hanging
            const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
                Logger.debug('Command execution timed out, terminating process');
                try {
                    process.force_exit();
                } catch (e) {
                    Logger.debug('Error forcing process exit: ' + e.message);
                }
                callback(false, null, "Command timed out after 15 seconds");
                return false;
            });

            // Execute command asynchronously
            process.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    // Clean up timeout
                    try {
                        GLib.source_remove(timeoutId);
                    } catch (e) {
                        // Ignore cleanup errors
                    }

                    let [stdout, stderr] = proc.communicate_utf8_finish(res);
                    let exitStatus = proc.get_exit_status();

                    Logger.debug(`Command completed with exit status: ${exitStatus}`);
                    Logger.debug(`Stdout length: ${stdout ? stdout.length : 0}`);
                    Logger.debug(`Stderr length: ${stderr ? stderr.length : 0}`);

                    if (exitStatus === 0 || (stdout && stdout.length > 0)) {
                        // Success - we got output
                        callback(true, stdout || '', stderr || '');
                    } else if (stderr && stderr.length > 0) {
                        // Check if stderr contains feed content
                        if (stderr.includes('<rss') || stderr.includes('<feed') || stderr.includes('<channel')) {
                            Logger.debug('Found feed content in stderr');
                            callback(true, stderr, null);
                        } else {
                            Logger.debug('Command failed with stderr output');
                            callback(false, null, stderr);
                        }
                    } else {
                        Logger.debug('Command completed with no output');
                        callback(false, null, "No output received");
                    }

                } catch (e) {
                    Logger.debug('Error in command communication: ' + e.message);
                    callback(false, null, "Communication error: " + e.message);
                }
            });

        } catch (error) {
            Logger.debug('Error executing command: ' + error.message);
            callback(false, null, error.message);
        }
    }
}

module.exports = {
    TimerManager,
    UIUpdateManager,
    AsyncCommandExecutor,
    AsyncOperationManager
};
