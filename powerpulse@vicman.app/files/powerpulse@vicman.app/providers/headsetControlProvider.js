/**
 * HeadsetControl provider — percentage from "Level" only (never from Voltage).
 */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const { BaseProvider } = require("./providers/baseProvider");
const { parseHeadsetControlOutput } = require("./utils/formatter");
const {
    createDevice,
    DeviceType,
    DeviceState,
    Transport,
    iconForType
} = require("./models/device");

class HeadsetControlProvider extends BaseProvider {
    constructor(options) {
        super(options);
        this._command = (options && options.command) || "headsetcontrol";
        this._timeoutSeconds = (options && options.timeoutSeconds) || 5;
        this._cancellable = null;
        this._timeoutId = 0;
        this._running = false;
        this._available = null;
        this._lastDevices = [];
    }

    get id() {
        return "headsetcontrol";
    }

    get label() {
        return "HeadsetControl";
    }

    setCommand(command) {
        this._command = command || "headsetcontrol";
        this._available = null;
    }

    setTimeoutSeconds(seconds) {
        this._timeoutSeconds = Math.max(2, Number(seconds) || 5);
    }

    isInstalled() {
        if (this._available !== null) {
            return this._available;
        }
        try {
            if (this._command.indexOf("/") === 0) {
                // Absolute paths are confirmed by spawn in fetch().
                this._available = true;
            } else {
                this._available = !!GLib.find_program_in_path(this._command);
            }
        } catch (e) {
            this._available = false;
        }
        return this._available;
    }

    cancel() {
        if (this._cancellable && !this._cancellable.is_cancelled()) {
            try { this._cancellable.cancel(); } catch (e) {}
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._running = false;
    }

    fetch(callback) {
        if (this._destroyed) {
            if (callback) callback([]);
            return;
        }
        if (this._running) {
            if (callback) callback(this._lastDevices.slice());
            return;
        }
        if (!this.isInstalled()) {
            this._lastDevices = [];
            if (callback) callback([]);
            return;
        }

        this._running = true;
        this._cancellable = new Gio.Cancellable();

        let argv;
        try {
            const [ok, parsed] = GLib.shell_parse_argv(this._command);
            if (!ok || !parsed || parsed.length === 0) {
                argv = [this._command, "-b"];
            } else {
                argv = parsed.slice();
                if (argv.indexOf("-b") === -1) {
                    argv.push("-b");
                }
            }
        } catch (e) {
            argv = [this._command, "-b"];
        }

        let subprocess;
        try {
            subprocess = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            subprocess.init(null);
        } catch (e) {
            this._running = false;
            this._available = false;
            if (!(e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))) {
                this._error("failed to spawn headsetcontrol", e);
            }
            if (callback) callback([]);
            return;
        }

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._timeoutSeconds, () => {
            this._timeoutId = 0;
            try {
                if (this._cancellable && !this._cancellable.is_cancelled()) {
                    this._cancellable.cancel();
                }
                subprocess.force_exit();
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });

        subprocess.communicate_utf8_async(null, this._cancellable, (proc, res) => {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }

            let stdout = "";
            let stderr = "";
            let cancelled = this._cancellable && this._cancellable.is_cancelled();
            try {
                const [, out, err] = proc.communicate_utf8_finish(res);
                stdout = out || "";
                stderr = err || "";
            } catch (e) {
                if (!cancelled) {
                    this._error("communicate failed", e);
                }
            }

            this._running = false;
            this._cancellable = null;

            if (this._destroyed) {
                if (callback) callback([]);
                return;
            }
            if (cancelled) {
                if (callback) callback(this._lastDevices.slice());
                return;
            }

            const parsed = parseHeadsetControlOutput((stdout || "") + "\n" + (stderr || ""));
            this._lastDevices = this._toDevices(parsed);
            if (callback) {
                callback(this._lastDevices.slice());
            }
        });
    }

    refresh() {
        // Next fetch will run; optional no-op to avoid overlapping processes.
    }

    _toDevices(parsed) {
        const list = [];
        if (!parsed || !parsed.devices) {
            return list;
        }
        parsed.devices.forEach((item, index) => {
            const connected = !!item.connected && item.percentage !== null && item.percentage !== undefined;
            const name = item.name || "Headset";
            const id = "headsetcontrol:" + name.toLowerCase().replace(/\s+/g, "_") + ":" + index;
            const timeToEmpty = item.timeToEmptyMinutes !== null && item.timeToEmptyMinutes !== undefined
                ? Number(item.timeToEmptyMinutes) * 60
                : null;

            list.push(createDevice({
                id: id,
                source: this.id,
                providerLabel: this.label,
                type: DeviceType.HEADSET,
                name: name,
                model: name,
                vendor: "",
                percentage: item.percentage, // Level field only
                state: connected ? DeviceState.AVAILABLE : DeviceState.DISCONNECTED,
                present: connected,
                rechargeable: true,
                connected: connected,
                voltage: item.voltageMv,
                timeToEmpty: timeToEmpty,
                updated: Date.now() / 1000,
                path: "headsetcontrol://" + encodeURIComponent(name),
                iconName: iconForType(DeviceType.HEADSET),
                transport: Transport.WIRELESS,
                raw: item
            }));
        });
        return list;
    }

    destroy() {
        this._destroyed = true;
        this.cancel();
        this._lastDevices = [];
        this._onChange = null;
    }
}

module.exports = { HeadsetControlProvider };
