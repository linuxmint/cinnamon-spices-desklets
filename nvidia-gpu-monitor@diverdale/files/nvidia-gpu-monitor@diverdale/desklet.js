const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const UUID = "nvidia-gpu-monitor@diverdale";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
imports.searchPath.unshift(DESKLET_DIR);

const Parsers = imports.parsers;
const NvSmi = imports.nvidia_smi;
const GpuRowMod = imports.gpu_row;

const REFRESH_SECONDS = 2;
const STALE_AFTER_FAILURES = 5;

class NvidiaGpuMonitor extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this._timer = null;
        this._inFlightGpu = false;
        this._inFlightProc = false;
        this._cancellables = [];
        this._failCount = 0;
        this._uuidToIndex = new Map();
        this._rows = [];

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "tempWarnC",       "tempWarnC",       this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "tempCritC",       "tempCritC",       this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "historySeconds",  "historySeconds",  this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "showProcessCount","showProcessCount",this._onSettingsChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "clickAction",     "clickAction",     () => {});

        this.setHeader("NVIDIA GPU Monitor");

        this._content = new St.BoxLayout({ vertical: true, style_class: "ngm-root" });
        this._headerNote = new St.Label({ text: "Initialising…", style_class: "ngm-note" });
        this._content.add(this._headerNote);
        this.setContent(this._content);
        this._content.reactive = true;
        this._content.connect("button-press-event", (actor, event) => {
            if (event.get_button() !== 1) return false;
            this._handleClick();
            return true;
        });

        this._discoverAndStart();
    }

    _onSettingsChanged() {
        const cap = Math.max(2, Math.round(this.historySeconds / REFRESH_SECONDS));
        for (const row of this._rows) {
            row.setHistoryCapacity(cap);
            row.setThresholds({ tempWarnC: this.tempWarnC, tempCritC: this.tempCritC });
            row.setProcsVisible(this.showProcessCount);
        }
    }

    _discoverAndStart() {
        // Step 1: confirm nvidia-smi is on PATH.
        if (!GLib.find_program_in_path("nvidia-smi")) {
            this._headerNote.set_text("nvidia-smi not found — install NVIDIA driver.");
            return;
        }

        // Step 2: query GPU list once.
        const args = ["--query-gpu=index,name,uuid,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,fan.speed",
                      "--format=csv,noheader,nounits"];
        const cancellable = NvSmi.runNvidiaSmi(args, 3000, (err, stdout) => {
            if (err) {
                this._headerNote.set_text("nvidia-smi failed: " + err.message);
                global.logError("[" + UUID + "] discovery: " + err.message);
                return;
            }
            const rows = Parsers.parseGpuCsv(stdout);
            if (rows.length === 0) {
                this._headerNote.set_text("No NVIDIA GPUs detected.");
                return;
            }
            this._buildRows(rows);
            this._startTimer();
        });
        this._cancellables.push(cancellable);
    }

    _buildRows(initialSamples) {
        this._content.remove_all_children();
        this._rows = [];
        this._uuidToIndex.clear();

        const cap = Math.max(2, Math.round(this.historySeconds / REFRESH_SECONDS));
        for (const sample of initialSamples) {
            const row = new GpuRowMod.GpuRow(sample.index, sample.name);
            row.setHistoryCapacity(cap);
            row.setThresholds({ tempWarnC: this.tempWarnC, tempCritC: this.tempCritC });
            row.setProcsVisible(this.showProcessCount);
            row.update(sample);
            row.setStatus(this._statusFor(sample));
            this._rows.push(row);
            this._uuidToIndex.set(sample.uuid, this._rows.length - 1);
            this._content.add(row.actor);
        }
    }

    _statusFor(sample) {
        if (sample.tempC != null && sample.tempC >= this.tempCritC) return "red";
        if (sample.tempC != null && sample.tempC < 60 && (sample.utilPct == null || sample.utilPct < 40)) return "green";
        return "amber";
    }

    _startTimer() {
        this._headerNote.hide();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _tick() {
        // Re-entrancy guard for the GPU query.
        if (!this._inFlightGpu) {
            this._inFlightGpu = true;
            const args = ["--query-gpu=index,name,uuid,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,fan.speed",
                          "--format=csv,noheader,nounits"];
            const c = NvSmi.runNvidiaSmi(args, 1500, (err, stdout) => {
                this._inFlightGpu = false;
                if (err) { this._handleQueryFailure(err); return; }
                this._failCount = 0;
                this.setHeader("NVIDIA GPU Monitor");
                const samples = Parsers.parseGpuCsv(stdout);
                for (const s of samples) {
                    const idx = this._uuidToIndex.get(s.uuid);
                    if (idx == null) continue;
                    const row = this._rows[idx];
                    row.update(s);
                    row.setStatus(this._statusFor(s));
                }
            });
            this._cancellables.push(c);
        }

        // Re-entrancy guard for the process-count query.
        if (!this._inFlightProc) {
            this._inFlightProc = true;
            const args2 = ["--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader"];
            const c2 = NvSmi.runNvidiaSmi(args2, 1500, (err, stdout) => {
                this._inFlightProc = false;
                if (err) { global.logError("[" + UUID + "] proc query: " + err.message); return; }
                const counts = Parsers.parseProcessCsv(stdout);
                // Set every row's count (default 0 if uuid not in map).
                for (const [uuid, idx] of this._uuidToIndex.entries()) {
                    this._rows[idx].setProcCount(counts.get(uuid) || 0);
                }
            });
            this._cancellables.push(c2);
        }
    }

    _handleQueryFailure(err) {
        this._failCount++;
        global.logError("[" + UUID + "] gpu query: " + err.message);
        if (this._failCount >= STALE_AFTER_FAILURES) {
            this.setHeader("NVIDIA GPU Monitor  ⚠ stale");
        }
    }

    _handleClick() {
        const action = this.clickAction;
        if (action === "none" || !action) return;
        if (action === "nvidia-smi-watch") {
            // Try a few common terminals.
            const cmds = [
                ["x-terminal-emulator", "-e", "watch", "-n", "1", "nvidia-smi"],
                ["gnome-terminal", "--", "watch", "-n", "1", "nvidia-smi"],
                ["xterm", "-e", "watch -n 1 nvidia-smi"],
            ];
            for (const argv of cmds) {
                if (GLib.find_program_in_path(argv[0])) {
                    try { GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null); return; }
                    catch (e) { global.logError("[" + UUID + "] spawn " + argv[0] + ": " + e.message); }
                }
            }
        } else if (action === "nvidia-settings") {
            if (GLib.find_program_in_path("nvidia-settings")) {
                try { GLib.spawn_async(null, ["nvidia-settings"], null, GLib.SpawnFlags.SEARCH_PATH, null); }
                catch (e) { global.logError("[" + UUID + "] spawn nvidia-settings: " + e.message); }
            }
        }
    }

    on_desklet_removed() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = null; }
        for (const c of this._cancellables) {
            try { c.cancel(); } catch (_) {}
        }
        this._cancellables = [];
    }
}

function main(metadata, deskletId) {
    return new NvidiaGpuMonitor(metadata, deskletId);
}
