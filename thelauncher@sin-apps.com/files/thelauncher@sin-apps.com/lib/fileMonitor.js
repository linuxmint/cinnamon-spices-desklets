const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const DEFAULT_DEBOUNCE_MS = 300;
const POLL_INTERVAL_SEC = 5;

function createDirectoryMonitor(directoryPath, callback, debounceMs) {
    const debounce = debounceMs || DEFAULT_DEBOUNCE_MS;
    let monitor = null;
    let pollId = 0;
    let debounceId = 0;
    let stopped = false;

    function scheduleRefresh() {
        if (stopped || debounceId) {
            return;
        }
        debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, debounce, () => {
            debounceId = 0;
            if (!stopped) {
                callback();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    function stop() {
        stopped = true;
        if (debounceId) {
            GLib.source_remove(debounceId);
            debounceId = 0;
        }
        if (pollId) {
            GLib.source_remove(pollId);
            pollId = 0;
        }
        if (monitor) {
            try {
                monitor.cancel();
            } catch (e) {
                // Ignore cancel errors during teardown.
            }
            monitor = null;
        }
    }

    if (!directoryPath || !GLib.file_test(directoryPath, GLib.FileTest.IS_DIR)) {
        return { stop: stop, path: directoryPath };
    }

    try {
        const file = Gio.File.new_for_path(directoryPath);
        monitor = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        monitor.connect("changed", () => scheduleRefresh());
    } catch (e) {
        global.logError(e, "TheLauncher: GFileMonitor failed for " + directoryPath);
        monitor = null;
    }

    if (!monitor) {
        pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_SEC, () => {
            if (stopped) {
                return GLib.SOURCE_REMOVE;
            }
            callback();
            return GLib.SOURCE_CONTINUE;
        });
    }

    return { stop: stop, path: directoryPath };
}

if (typeof module !== "undefined") {
    module.exports = {
        createDirectoryMonitor,
        DEFAULT_DEBOUNCE_MS
    };
}
