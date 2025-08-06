// Async managers for Yarr desklet - prevents compositor blocking

// Defer imports to avoid issues with require()
let GLib, Gio;

function getGLib() {
    if (!GLib) GLib = imports.gi.GLib;
    return GLib;
}

function getGio() {
    if (!Gio) Gio = imports.gi.Gio;
    return Gio;
}

// Async Command Executor to prevent compositor blocking
class AsyncCommandExecutor {
    static executeCommand(command, callback) {
        try {
            const glib = getGLib();
            let [success, argv] = glib.shell_parse_argv(command);
            if (!success) {
                callback(false, null, "Failed to parse command");
                return;
            }

            let [exit, pid, stdin, stdout, stderr] = glib.spawn_async_with_pipes(
                null, argv, null,
                glib.SpawnFlags.SEARCH_PATH | glib.SpawnFlags.DO_NOT_REAP_CHILD,
                null
            );

            if (!exit) {
                callback(false, null, "Failed to spawn process");
                return;
            }

            // Set up async reading
            this._setupAsyncReading(stdout, stderr, pid, callback);

        } catch (error) {
            callback(false, null, error.message);
        }
    }

    static _setupAsyncReading(stdout, stderr, pid, callback) {
        const gio = getGio();
        const stdoutStream = new gio.UnixInputStream({ fd: stdout, close_fd: true });
        const stderrStream = new gio.UnixInputStream({ fd: stderr, close_fd: true });

        const stdoutData = new gio.DataInputStream({ base_stream: stdoutStream });
        const stderrData = new gio.DataInputStream({ base_stream: stderrStream });

        let stdoutResult = '';
        let stderrResult = '';
        let stdoutDone = false;
        let stderrDone = false;

        const checkComplete = () => {
            if (stdoutDone && stderrDone) {
                // Clean up child process
                getGLib().spawn_close_pid(pid);
                callback(true, stdoutResult, stderrResult);
            }
        };

        // Read stdout asynchronously
        stdoutData.fill_async(-1, getGLib().PRIORITY_DEFAULT, null, (stream, result) => {
            try {
                const bytes = stdoutData.fill_finish(result);
                if (bytes > 0) {
                    stdoutResult += stream.peek_buffer().toString();
                    stdoutData.fill_async(-1, getGLib().PRIORITY_DEFAULT, null, arguments.callee);
                } else {
                    stdoutDone = true;
                    checkComplete();
                }
            } catch (e) {
                stdoutDone = true;
                checkComplete();
            }
        });

        // Read stderr asynchronously
        stderrData.fill_async(-1, getGLib().PRIORITY_DEFAULT, null, (stream, result) => {
            try {
                const bytes = stderrData.fill_finish(result);
                if (bytes > 0) {
                    stderrResult += stream.peek_buffer().toString();
                    stderrData.fill_async(-1, getGLib().PRIORITY_DEFAULT, null, arguments.callee);
                } else {
                    stderrDone = true;
                    checkComplete();
                }
            } catch (e) {
                stderrDone = true;
                checkComplete();
            }
        });
    }
}

// Async Database Manager to replace synchronous SQLite operations
class AsyncDatabaseManager {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.operationQueue = [];
        this.isProcessing = false;
    }

    async executeQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.operationQueue.push({ sql, params, resolve, reject });
            this._processQueue();
        });
    }

    _processQueue() {
        if (this.isProcessing || this.operationQueue.length === 0) return;

        this.isProcessing = true;
        const operation = this.operationQueue.shift();

        this._executeAsync(operation);
    }

    _executeAsync(operation) {
        try {
            // Escape SQL and parameters
            const escapedSql = this._escapeSql(operation.sql, operation.params);

            // Add JSON output for SELECT queries
            const isSelectQuery = operation.sql.trim().toUpperCase().startsWith('SELECT');
            const command = isSelectQuery
                ? ['sqlite3', this.dbPath, escapedSql, '-json']
                : ['sqlite3', this.dbPath, escapedSql];

            // Log the command for debugging
            global.log('[Yarr Debug] SQLite command: ' + command.join(' '));
            global.log('[Yarr Debug] Escaped SQL: ' + escapedSql);
            global.log('[Yarr Debug] Parameters: ' + JSON.stringify(operation.params));

            const glib = getGLib();
            let [success, pid, stdin, stdout, stderr] = glib.spawn_async_with_pipes(
                null, command, null,
                glib.SpawnFlags.SEARCH_PATH | glib.SpawnFlags.DO_NOT_REAP_CHILD,
                null
            );

            if (!success) {
                operation.reject(new Error('Failed to spawn sqlite3 process'));
                this.isProcessing = false;
                this._processQueue();
                return;
            }

            // Set up async result handling
            this._handleAsyncResult(stdout, stderr, pid, operation);

        } catch (error) {
            operation.reject(error);
            this.isProcessing = false;
            this._processQueue();
        }
    }

    _handleAsyncResult(stdout, stderr, pid, operation) {
        const gio = getGio();
        const stdoutStream = new gio.UnixInputStream({ fd: stdout, close_fd: true });
        const stderrStream = new gio.UnixInputStream({ fd: stderr, close_fd: true });

        const stdoutData = new gio.DataInputStream({ base_stream: stdoutStream });
        const stderrData = new gio.DataInputStream({ base_stream: stderrStream });

        let stdoutResult = '';
        let stderrResult = '';
        let stdoutDone = false;
        let stderrDone = false;

        const checkComplete = () => {
            if (stdoutDone && stderrDone) {
                getGLib().spawn_close_pid(pid);

                if (stderrResult.trim()) {
                    operation.reject(new Error(`SQLite error: ${stderrResult}`));
                } else {
                    operation.resolve(stdoutResult.trim());
                }

                this.isProcessing = false;
                this._processQueue();
            }
        };

        const glib = getGLib();

        // Read stdout
        stdoutData.fill_async(-1, glib.PRIORITY_DEFAULT, null, (stream, result) => {
            try {
                const bytes = stdoutData.fill_finish(result);
                if (bytes > 0) {
                    stdoutResult += stream.peek_buffer().toString();
                    stdoutData.fill_async(-1, glib.PRIORITY_DEFAULT, null, arguments.callee);
                } else {
                    stdoutDone = true;
                    checkComplete();
                }
            } catch (e) {
                stdoutDone = true;
                checkComplete();
            }
        });

        // Read stderr
        stderrData.fill_async(-1, glib.PRIORITY_DEFAULT, null, (stream, result) => {
            try {
                const bytes = stderrData.fill_finish(result);
                if (bytes > 0) {
                    stderrResult += stream.peek_buffer().toString();
                    stderrData.fill_async(-1, glib.PRIORITY_DEFAULT, null, arguments.callee);
                } else {
                    stderrDone = true;
                    checkComplete();
                }
            } catch (e) {
                stderrDone = true;
                checkComplete();
            }
        });
    }

    _escapeSql(sql, params) {
        // SQLite uses ? placeholders - replace them one by one
        let escapedSql = sql;
        global.log('[Yarr Debug] Original SQL: ' + sql);
        global.log('[Yarr Debug] Parameters: ' + JSON.stringify(params));

        params.forEach((param, index) => {
            const placeholderIndex = escapedSql.indexOf('?');
            if (placeholderIndex !== -1) {
                const replacement = typeof param === 'number' ? param.toString() : `'${this._escapeString(param)}'`;
                escapedSql = escapedSql.substring(0, placeholderIndex) + replacement + escapedSql.substring(placeholderIndex + 1);
                global.log(`[Yarr Debug] Replaced ?${index + 1} with: ${replacement}`);
            }
        });

        global.log('[Yarr Debug] Final escaped SQL: ' + escapedSql);
        return escapedSql;
    }

    _escapeString(str) {
        if (typeof str !== 'string') {
            global.log('[Yarr Warning] Non-string value passed to _escapeString');
            return '';
        }
        // Escape single quotes by doubling them, and also escape backslashes
        return str.replace(/\\/g, '\\\\').replace(/'/g, "''");
    }
}

// Timer Manager to prevent overlapping operations and memory leaks
class TimerManager {
    constructor() {
        this.activeTimers = new Map();
        this.timerCounter = 0;
    }

    addTimer(interval, callback, isSeconds = false) {
        const timerId = `timer_${++this.timerCounter}`;
        const glib = getGLib();

        const glibTimerId = isSeconds
            ? glib.timeout_add_seconds(glib.PRIORITY_DEFAULT, interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.activeTimers.delete(timerId);
                }
                return shouldContinue;
            })
            : glib.timeout_add(glib.PRIORITY_DEFAULT, interval, () => {
                const shouldContinue = callback();
                if (!shouldContinue) {
                    this.activeTimers.delete(timerId);
                }
                return shouldContinue;
            });

        this.activeTimers.set(timerId, glibTimerId);
        return timerId;
    }

    removeTimer(timerId) {
        const glibTimerId = this.activeTimers.get(timerId);
        if (glibTimerId) {
            getGLib().source_remove(glibTimerId);
            this.activeTimers.delete(timerId);
        }
    }

    clearAllTimers() {
        const glib = getGLib();
        this.activeTimers.forEach(glibTimerId => glib.source_remove(glibTimerId));
        this.activeTimers.clear();
    }
}

// UI Update Manager for batching and throttling
class UIUpdateManager {
    constructor() {
        this.pendingUpdate = false;
        this.updateScheduled = false;
        this.BATCH_SIZE = 10; // Items per frame
        this.RAF_INTERVAL = 16; // ~60fps
    }

    scheduleUpdate() {
        if (this.updateScheduled) return;

        this.updateScheduled = true;
        const glib = getGLib();
        glib.timeout_add(glib.PRIORITY_DEFAULT, this.RAF_INTERVAL, () => {
            this.updateScheduled = false;
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

module.exports = {
    AsyncCommandExecutor,
    AsyncDatabaseManager,
    TimerManager,
    UIUpdateManager,
    AsyncErrorHandler
};
