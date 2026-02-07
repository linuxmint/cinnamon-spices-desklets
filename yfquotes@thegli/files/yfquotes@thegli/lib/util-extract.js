/**
 * Extract of https://github.com/linuxmint/cinnamon/blob/6.6.6/js/misc/util.js
 */

const Gio = imports.gi.Gio;

/**
 * tryFn:
 * @callback (function): Function to wrap in a try-catch block.
 * @errCallback (function): The function to call on error.
 *
 * Try-catch can degrade performance in the function scope it is
 * called in. By using a wrapper for try-catch, the function scope is
 * reduced to the wrapper and not a potentially performance critical
 * function calling the wrapper. Use of try-catch in any form will
 * be slower than writing defensive code.
 *
 * Returns (any): The output of whichever callback gets called.
 */
function tryFn(callback, errCallback) {
    try {
        return callback();
    } catch (e) {
        if (typeof errCallback === 'function') {
            return errCallback(e);
        }
    }
}

/**
 * spawnCommandLineAsyncIO:
 * @command: a command
 * @callback (function): called on success or failure
 * @opts (object): options: argv, flags, input
 *
 * Runs @command in the background. Callback has three arguments -
 * stdout, stderr, and exitCode.
 *
 * Returns (object): a Gio.Subprocess instance
 */
function spawnCommandLineAsyncIO(command, callback, opts = {}) {
    let {argv, flags, input} = opts;
    if (!input) input = null;

    let subprocess = new Gio.Subprocess({
        argv: argv ? argv : ['bash', '-c', command],
        flags: flags ? flags
            : Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    subprocess.init(null);
    let cancellable = new Gio.Cancellable();

    subprocess.communicate_utf8_async(input, cancellable, (obj, res) => {
        let success, stdout, stderr, exitCode;
        // This will throw on cancel with "Gio.IOErrorEnum: Operation was cancelled"
        tryFn(() => [success, stdout, stderr] = obj.communicate_utf8_finish(res));
        if (typeof callback === 'function' && !cancellable.is_cancelled()) {
            if (stderr && stderr.indexOf('bash: ') > -1) {
                stderr = stderr.replace(/bash: /, '');
            }
            exitCode = success ? subprocess.get_exit_status() : -1;
            callback(stdout, stderr, exitCode);
        }
        subprocess.cancellable = null;
    });
    subprocess.cancellable = cancellable;

    return subprocess;
}
