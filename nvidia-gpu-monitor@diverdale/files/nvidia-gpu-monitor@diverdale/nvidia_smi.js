const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// runNvidiaSmi(args, timeoutMs, callback)
//   args:       array of CLI args after `nvidia-smi`
//   timeoutMs:  cancel after this many ms (default 1500)
//   callback:   function(err, stdoutText)
//
// Returns the Gio.Cancellable so the caller can cancel on shutdown.
var runNvidiaSmi = function(args, timeoutMs, callback) {
    timeoutMs = timeoutMs || 1500;
    const cancellable = new Gio.Cancellable();
    let timedOut = false;

    const argv = ["nvidia-smi"].concat(args);
    let proc;
    try {
        proc = new Gio.Subprocess({
            argv: argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(cancellable);
    } catch (e) {
        callback(e, null);
        return cancellable;
    }

    const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        timedOut = true;
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });

    proc.communicate_utf8_async(null, cancellable, (p, res) => {
        GLib.source_remove(timeoutId);
        try {
            const [, stdout, stderr] = p.communicate_utf8_finish(res);
            if (!p.get_successful()) {
                callback(new Error("nvidia-smi failed: " + (stderr || "")), null);
                return;
            }
            callback(null, stdout);
        } catch (e) {
            if (timedOut) {
                callback(new Error("nvidia-smi timed out after " + timeoutMs + "ms"), null);
            } else {
                callback(e, null);
            }
        }
    });

    return cancellable;
};
