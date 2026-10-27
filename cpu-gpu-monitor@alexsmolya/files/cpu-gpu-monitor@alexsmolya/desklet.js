// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Alex Smolya

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const cairo = imports.cairo;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Format = imports.format;

const UUID = "cpu-gpu-monitor@alexsmolya";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

let ByteArray;
try {
    ByteArray = imports.byteArray;
} catch (e) {
    ByteArray = null;
}

function CpuGpuMonitorDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

CpuGpuMonitorDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.historyLength = 60;

        // CPU histories
        this.cpuHistory = new Array(this.historyLength).fill(null);
        this.ramHistory = new Array(this.historyLength).fill(null);
        this.cpuTempHistory = new Array(this.historyLength).fill(null);

        // GPU histories
        this.gpuUtilHistory = new Array(this.historyLength).fill(null);
        this.vramUtilHistory = new Array(this.historyLength).fill(null);
        this.gpuTempHistory = new Array(this.historyLength).fill(null);

        this.prevIdleTime = null;
        this.prevTotalTime = null;
        this._totalRamGb = null;
        this._cpuTemperatureSensor = null;
        this.cpuModel = "CPU";
        this._cpuModelLoaded = false;
        this.timerId = null;
        this._destroyed = false;
        this._systemSampleInFlight = false;
        this._systemSampleGeneration = 0;
        this._systemCancellable = null;
        this._temperatureDiscoveryInFlight = false;
        this._temperatureDiscoveryGeneration = 0;
        this._temperatureDiscoveryCancellable = null;
        this._nextTemperatureDiscoveryTime = 0;
        this._temperatureRediscoveryCooldownSeconds = 10;
        this._gpuPollInFlight = false;
        this._gpuPollGeneration = 0;
        this._gpuProcess = null;
        this._gpuCancellable = null;
        this._gpuTimeoutId = null;
        this._gpuTimeoutSeconds = 5;
        this._hasValidGpuData = false;
        this._lastGpuErrorLogTime = 0;
        this._gpuErrorLogIntervalSeconds = 60;
        this._lastRuntimeErrorLogTime = 0;
        this._runtimeErrorLogIntervalSeconds = 60;

        // Base defaults (Unified standard: Green = Load, Blue = Memory, Red = Temp)
        this.updateInterval = 1.0;
        this.uiScale = 1.0;
        this.showLegend = true;

        this.cpuColor = "rgba(34, 197, 94, 1.0)";        // Green (#22c55e)
        this.cpuRamColor = "rgba(59, 130, 246, 1.0)";     // Blue (#3b82f6)
        this.cpuTempColor = "rgba(239, 68, 68, 1.0)";     // Red (#ef4444)

        this.gpuComputeColor = "rgba(34, 197, 94, 1.0)";  // Green (#22c55e)
        this.gpuMemColor = "rgba(59, 130, 246, 1.0)";     // Blue (#3b82f6)
        this.gpuTempColor = "rgba(239, 68, 68, 1.0)";     // Red (#ef4444)

        // Bind Settings
        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
            this.settings.bindProperty(Settings.BindingDirection.IN, "update-interval", "updateInterval", this._onUpdateIntervalChanged.bind(this));
            this.settings.bindProperty(Settings.BindingDirection.IN, "ui-scale", "uiScale", this._onScaleChanged.bind(this));
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-legend", "showLegend", this._onPresentationChanged.bind(this));

            this.settings.bindProperty(Settings.BindingDirection.IN, "cpu-color", "cpuColor", this._onPresentationChanged.bind(this));
            this.settings.bindProperty(Settings.BindingDirection.IN, "cpu-ram-color", "cpuRamColor", this._onPresentationChanged.bind(this));
            this.settings.bindProperty(Settings.BindingDirection.IN, "cpu-temp-color", "cpuTempColor", this._onPresentationChanged.bind(this));

            this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-compute-color", "gpuComputeColor", this._onPresentationChanged.bind(this));
            this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-mem-color", "gpuMemColor", this._onPresentationChanged.bind(this));
            this.settings.bindProperty(Settings.BindingDirection.IN, "gpu-temp-color", "gpuTempColor", this._onPresentationChanged.bind(this));
        } catch (e) {
            this._logRuntimeFailure("settings initialization", e);
        }

        this.setupUI();
        this._onScaleChanged();
        this._updateLoop();
        this._resetTimer();
    },

    _onScaleChanged: function() {
        let scale = this.uiScale || 1.0;
        if (this.actor && this.actor.set_scale) {
            this.actor.set_scale(scale, scale);
        }
        this._onPresentationChanged();
    },

    _onPresentationChanged: function() {
        if (this.window) this.applyDynamicStyles();
        if (this.cpuCanvas) this.cpuCanvas.invalidate();
        if (this.gpuCanvas) this.gpuCanvas.invalidate();
    },

    _onUpdateIntervalChanged: function() {
        if (this.window && !this._destroyed) this._resetTimer();
    },

    _resetTimer: function() {
        this._removeTimer();
        let interval = this.updateInterval || 1.0;
        let intervalMs = Math.max(1, Math.round(interval * 1000));
        this.timerId = Mainloop.timeout_add(intervalMs, this._updateLoop.bind(this));
    },

    _removeTimer: function() {
        if (this.timerId && this.timerId > 0) {
            try {
                Mainloop.source_remove(this.timerId);
            } catch (e) {}
            this.timerId = null;
        }
    },

    _updateLoop: function() {
        if (this._destroyed) return GLib.SOURCE_REMOVE;

        try {
            this._startSystemSampleAsync();
            this._fetchGpuStatsAsync();
        } catch (e) {
            this._logRuntimeFailure("update loop", e);
        }

        return GLib.SOURCE_CONTINUE;
    },

    _startSystemSampleAsync: function() {
        if (this._destroyed || this._systemSampleInFlight) return false;

        let generation = ++this._systemSampleGeneration;
        let cancellable = new Gio.Cancellable();
        this._systemSampleInFlight = true;
        this._systemCancellable = cancellable;

        let sample = {
            cpuCounters: null,
            ram: { usage: null, totalGb: null },
            cpuTemp: null,
            cpuModel: null,
            cpuModelAttempted: !this._cpuModelLoaded
        };
        let errors = [];
        let pending = sample.cpuModelAttempted ? 4 : 3;
        let completePart = () => {
            pending--;
            if (pending === 0) {
                this._completeSystemSample(generation, cancellable, sample, errors);
            }
        };

        this._loadFileAsync('/proc/stat', cancellable, (content, error) => {
            if (error) errors.push(error);
            sample.cpuCounters = this._parseCpuCounters(content);
            completePart();
        });
        this._loadFileAsync('/proc/meminfo', cancellable, (content, error) => {
            if (error) errors.push(error);
            sample.ram = this._parseRamSample(content);
            completePart();
        });
        this._readCpuTemperatureAsync(cancellable, (value, error) => {
            if (error) errors.push(error);
            sample.cpuTemp = value;
            completePart();
        });
        if (sample.cpuModelAttempted) {
            this._loadFileAsync('/proc/cpuinfo', cancellable, (content, error) => {
                if (error) errors.push(error);
                sample.cpuModel = this._parseCpuModel(content);
                completePart();
            });
        }
        return true;
    },

    _isCurrentSystemSample: function(generation, cancellable) {
        return !this._destroyed &&
            generation === this._systemSampleGeneration &&
            cancellable === this._systemCancellable;
    },

    _completeSystemSample: function(generation, cancellable, sample, errors) {
        if (!this._isCurrentSystemSample(generation, cancellable)) return false;

        this._systemSampleInFlight = false;
        this._systemCancellable = null;
        if (errors.length > 0) this._logRuntimeFailure("asynchronous system sample", errors[0]);
        return this._applySystemSample(generation, sample);
    },

    _applySystemSample: function(generation, sample) {
        if (this._destroyed || generation !== this._systemSampleGeneration) return false;

        let cpu = this._calculateCpuUsage(sample.cpuCounters);
        let ram = sample.ram ? sample.ram.usage : null;
        let cpuTemp = sample.cpuTemp;
        if (sample.ram && sample.ram.totalGb !== null) this._totalRamGb = sample.ram.totalGb;
        if (sample.cpuModelAttempted) {
            this.cpuModel = sample.cpuModel || "CPU";
            this._cpuModelLoaded = true;
        }

        this._appendHistory(this.cpuHistory, cpu);
        this._appendHistory(this.ramHistory, ram);
        this._appendHistory(this.cpuTempHistory, cpuTemp);

        let cpuText = cpu === null ? "N/A" : `${cpu}%`;
        let ramText = ram === null ? "N/A" : `${ram}%`;
        let tempText = cpuTemp === null ? "N/A" : `${cpuTemp}°C`;
        this.cpuHeaderLabel.set_text(
            _("%s: %s CPU | %s RAM | %s").format(this.cpuModel, cpuText, ramText, tempText)
        );
        if (this.cpuCanvas) this.cpuCanvas.invalidate();
        return true;
    },

    _fetchGpuStatsAsync: function() {
        if (this._destroyed || this._gpuPollInFlight) return;

        let generation = ++this._gpuPollGeneration;
        this._gpuPollInFlight = true;
        try {
            let proc = new Gio.Subprocess({
                argv: ['nvidia-smi', '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name', '--format=csv,noheader,nounits'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            let cancellable = new Gio.Cancellable();
            this._gpuProcess = proc;
            this._gpuCancellable = cancellable;
            proc.init(null);
            this._gpuTimeoutId = Mainloop.timeout_add_seconds(this._gpuTimeoutSeconds, () => {
                return this._handleGpuTimeout(generation, proc, cancellable);
            });
            proc.communicate_utf8_async(null, cancellable, (proc, res) => {
                try {
                    let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (!this._isCurrentGpuPoll(generation, proc)) return;

                    if (!ok || !proc.get_successful()) {
                        this._setGpuUnavailable(stderr || "nvidia-smi returned an error");
                        return;
                    }

                    let parsed = this._parseNvidiaSmiOutput(stdout);
                    if (!parsed.data) {
                        this._setGpuUnavailable(parsed.error);
                        return;
                    }
                    let data = parsed.data;
                    this._lastGpuData = data;
                    this._hasValidGpuData = true;

                    this._appendHistory(this.gpuUtilHistory, data.util);
                    this._appendHistory(this.vramUtilHistory, data.vramUtil);
                    this._appendHistory(this.gpuTempHistory, data.temp);

                    let gpuShortName = data.name.replace("NVIDIA GeForce ", "").replace(" Laptop GPU", "");
                    this.gpuHeaderLabel.set_text(
                        _("%s: %s GPU | %s VRAM (%s MB) | %s").format(
                            gpuShortName,
                            `${data.util}%`,
                            `${data.vramUtil}%`,
                            data.vramUsedMb,
                            `${data.temp}°C`
                        )
                    );

                    if (this.gpuCanvas) this.gpuCanvas.invalidate();
                } catch (e) {
                    if (this._isCurrentGpuPoll(generation, proc)) {
                        this._setGpuUnavailable(e.message || String(e));
                    }
                } finally {
                    this._releaseGpuPollState(generation, proc);
                }
            });
        } catch (e) {
            if (this._gpuCancellable) {
                try { this._gpuCancellable.cancel(); } catch (cancelError) {}
            }
            if (this._gpuProcess) {
                try { this._gpuProcess.force_exit(); } catch (exitError) {}
            }
            this._releaseGpuPollState(generation, this._gpuProcess);
            this._setGpuUnavailable(e.message || String(e));
        }
    },

    _isCurrentGpuPoll: function(generation, proc) {
        return !this._destroyed &&
            generation === this._gpuPollGeneration &&
            proc === this._gpuProcess;
    },

    _clearGpuTimeout: function() {
        if (this._gpuTimeoutId && this._gpuTimeoutId > 0) {
            try { Mainloop.source_remove(this._gpuTimeoutId); } catch (e) {}
            this._gpuTimeoutId = null;
        }
    },

    _releaseGpuPollState: function(generation, proc) {
        if (generation !== this._gpuPollGeneration || proc !== this._gpuProcess) return false;
        this._clearGpuTimeout();
        this._gpuPollInFlight = false;
        this._gpuProcess = null;
        this._gpuCancellable = null;
        return true;
    },

    _handleGpuTimeout: function(generation, proc, cancellable) {
        if (!this._isCurrentGpuPoll(generation, proc)) return GLib.SOURCE_REMOVE;

        // The source is already dispatching, so do not try to remove it again.
        this._gpuTimeoutId = null;
        try { cancellable.cancel(); } catch (e) {}
        try { proc.force_exit(); } catch (e) {}
        this._releaseGpuPollState(generation, proc);
        this._setGpuUnavailable(`nvidia-smi timed out after ${this._gpuTimeoutSeconds} seconds`);
        return GLib.SOURCE_REMOVE;
    },

    _parseNvidiaSmiOutput: function(stdout) {
        let output = String(stdout || "").trim();
        let rows = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let parts = rows.length > 0 ? rows[0].split(',').map(s => s.trim()) : [];
        if (!output || parts.length !== 5) {
            return { data: null, error: "nvidia-smi returned malformed output" };
        }

        let numberPattern = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
        if (!parts.slice(0, 4).every(value => numberPattern.test(value))) {
            return { data: null, error: "nvidia-smi returned invalid values" };
        }

        let gpuUtil = Number(parts[0]);
        let vramUsed = Number(parts[1]);
        let vramTotal = Number(parts[2]);
        let gpuTemp = Number(parts[3]);
        let name = parts[4];
        if (!isFinite(gpuUtil) || gpuUtil < 0 || gpuUtil > 100 ||
            !isFinite(vramUsed) || vramUsed < 0 ||
            !isFinite(vramTotal) || vramTotal <= 0 || vramUsed > vramTotal ||
            !isFinite(gpuTemp) || gpuTemp < 0 || gpuTemp > 150 || !name) {
            return { data: null, error: "nvidia-smi returned invalid values" };
        }

        let vramUtil = Math.round((vramUsed / vramTotal) * 100);
        return { data: {
            util: Math.round(gpuUtil),
            vramUtil: vramUtil,
            vramUsedMb: Math.round(vramUsed),
            vramTotalMb: Math.round(vramTotal),
            vramTotalGb: (vramTotal / 1024).toFixed(1),
            temp: Math.round(gpuTemp),
            name: name
        }, error: null };
    },

    _setGpuUnavailable: function(reason) {
        if (this._destroyed) return;

        if (this.gpuHeaderLabel) {
            this.gpuHeaderLabel.set_text(this._hasValidGpuData ?
                _("GPU unavailable | last samples shown") : _("GPU unavailable"));
        }
        this._logGpuFailure(reason);
    },

    _logGpuFailure: function(reason) {
        let now = GLib.get_monotonic_time() / 1000000;
        if (this._lastGpuErrorLogTime !== 0 &&
            now - this._lastGpuErrorLogTime < this._gpuErrorLogIntervalSeconds) {
            return;
        }

        this._lastGpuErrorLogTime = now;
        let detail = String(reason || "unknown error").trim().replace(/\s+/g, " ");
        if (detail.length > 300) detail = detail.substring(0, 300);
        let logId = this.metadata && this.metadata.uuid ? this.metadata.uuid : "cinnamon-hardware-monitor";
        global.logError(`[${logId}] GPU unavailable: ${detail}`);
    },

    _logRuntimeFailure: function(context, error) {
        let now = GLib.get_monotonic_time() / 1000000;
        if (this._lastRuntimeErrorLogTime !== 0 &&
            now - this._lastRuntimeErrorLogTime < this._runtimeErrorLogIntervalSeconds) {
            return;
        }

        this._lastRuntimeErrorLogTime = now;
        let detail = String(error && error.message ? error.message : error || "unknown error")
            .trim().replace(/\s+/g, " ");
        if (detail.length > 300) detail = detail.substring(0, 300);
        let logId = this.metadata && this.metadata.uuid ? this.metadata.uuid : "cinnamon-hardware-monitor";
        global.logError(`[${logId}] ${context} failed: ${detail}`);
    },

    _appendHistory: function(history, value) {
        history.shift();
        history.push(value);
    },

    applyDynamicStyles: function() {
        const baseWidth = 450;
        let bgCss = "rgba(15, 23, 42, 0.88)";
        this.window.style = `background-color: ${bgCss}; border-radius: 12px; padding: 14px 16px; width: ${baseWidth}px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);`;

        let canvasW = baseWidth - 28;
        let canvasH = 110;

        this.canvasWidth = canvasW;
        this.canvasHeight = canvasH;

        if (this.cpuCanvas) this.cpuCanvas.set_size(canvasW, canvasH);
        if (this.cpuDrawingArea) this.cpuDrawingArea.set_size(canvasW, canvasH);

        if (this.gpuCanvas) this.gpuCanvas.set_size(canvasW, canvasH);
        if (this.gpuDrawingArea) this.gpuDrawingArea.set_size(canvasW, canvasH);

        if (this.cpuLegendBox) this.cpuLegendBox.visible = this.showLegend;
        if (this.gpuLegendBox) this.gpuLegendBox.visible = this.showLegend;

        if (this.cpuDot) this.cpuDot.style = `color: ${this.cpuColor || '#22c55e'}; font-size: 11px;`;
        if (this.cpuTempDot) this.cpuTempDot.style = `color: ${this.cpuTempColor || '#ef4444'}; font-size: 11px;`;
        if (this.cpuRamDot) this.cpuRamDot.style = `color: ${this.cpuRamColor || '#3b82f6'}; font-size: 11px;`;

        if (this.gpuComputeDot) this.gpuComputeDot.style = `color: ${this.gpuComputeColor || '#22c55e'}; font-size: 11px;`;
        if (this.gpuTempDot) this.gpuTempDot.style = `color: ${this.gpuTempColor || '#ef4444'}; font-size: 11px;`;
        if (this.gpuMemDot) this.gpuMemDot.style = `color: ${this.gpuMemColor || '#3b82f6'}; font-size: 11px;`;
    },

    setupUI: function() {
        this.window = new St.BoxLayout({ vertical: true });
        this.canvasWidth = 422;
        this.canvasHeight = 110;

        // ================= SECTION 1: CPU MONITOR =================
        this.cpuHeaderLabel = new St.Label({
            text: _("%s: loading...").format(this.cpuModel),
            style: "color: #f8fafc; font-size: 12px; font-weight: bold; margin-bottom: 4px;"
        });
        this.window.add_actor(this.cpuHeaderLabel);

        this.cpuCanvas = new Clutter.Canvas();
        this.cpuCanvas.set_size(this.canvasWidth, this.canvasHeight);
        this.cpuCanvas.connect('draw', this._onDrawCpu.bind(this));

        this.cpuDrawingArea = new Clutter.Actor({
            width: this.canvasWidth,
            height: this.canvasHeight
        });
        this.cpuDrawingArea.set_content(this.cpuCanvas);
        this.window.add_actor(this.cpuDrawingArea);

        // CPU Legend Box
        this.cpuLegendBox = new St.BoxLayout({
            vertical: false,
            style: "margin-top: 4px; padding: 4px 8px; background-color: rgba(30, 41, 59, 0.6); border-radius: 6px;"
        });

        let leftCpuLegend = new St.BoxLayout({ vertical: false, x_expand: true, x_align: St.Align.START });
        let cpuItem = new St.BoxLayout({ vertical: false, style: "margin-right: 12px;" });
        this.cpuDot = new St.Label({ text: "■ ", style: "color: #22c55e; font-size: 11px;" });
        let cpuText = new St.Label({ text: _("CPU Usage"), style: "color: #cbd5e1; font-size: 11px; font-weight: 500;" });
        cpuItem.add_actor(this.cpuDot);
        cpuItem.add_actor(cpuText);

        let cpuTempItem = new St.BoxLayout({ vertical: false });
        this.cpuTempDot = new St.Label({ text: "■ ", style: "color: #ef4444; font-size: 11px;" });
        let cpuTempText = new St.Label({ text: _("CPU Temperature"), style: "color: #cbd5e1; font-size: 11px; font-weight: 500;" });
        cpuTempItem.add_actor(this.cpuTempDot);
        cpuTempItem.add_actor(cpuTempText);

        leftCpuLegend.add_actor(cpuItem);
        leftCpuLegend.add_actor(cpuTempItem);

        let rightCpuLegend = new St.BoxLayout({ vertical: false, x_align: St.Align.END });
        let cpuRamItem = new St.BoxLayout({ vertical: false });
        this.cpuRamDot = new St.Label({ text: "■ ", style: "color: #3b82f6; font-size: 11px;" });
        let cpuRamText = new St.Label({ text: _("RAM Usage"), style: "color: #cbd5e1; font-size: 11px; font-weight: 500;" });
        cpuRamItem.add_actor(this.cpuRamDot);
        cpuRamItem.add_actor(cpuRamText);

        rightCpuLegend.add_actor(cpuRamItem);

        this.cpuLegendBox.add_actor(leftCpuLegend);
        this.cpuLegendBox.add_actor(rightCpuLegend);
        this.window.add_actor(this.cpuLegendBox);


        // ================= DIVIDER =================
        let divider = new St.BoxLayout({
            style: "margin-top: 10px; margin-bottom: 10px; height: 1px; background-color: rgba(255,255,255,0.1);"
        });
        this.window.add_actor(divider);


        // ================= SECTION 2: GPU MONITOR =================
        this.gpuHeaderLabel = new St.Label({
            text: _("NVIDIA GPU: loading..."),
            style: "color: #f8fafc; font-size: 12px; font-weight: bold; margin-bottom: 4px;"
        });
        this.window.add_actor(this.gpuHeaderLabel);

        this.gpuCanvas = new Clutter.Canvas();
        this.gpuCanvas.set_size(this.canvasWidth, this.canvasHeight);
        this.gpuCanvas.connect('draw', this._onDrawGpu.bind(this));

        this.gpuDrawingArea = new Clutter.Actor({
            width: this.canvasWidth,
            height: this.canvasHeight
        });
        this.gpuDrawingArea.set_content(this.gpuCanvas);
        this.window.add_actor(this.gpuDrawingArea);

        // GPU Legend Box
        this.gpuLegendBox = new St.BoxLayout({
            vertical: false,
            style: "margin-top: 4px; padding: 4px 8px; background-color: rgba(30, 41, 59, 0.6); border-radius: 6px;"
        });

        let leftGpuLegend = new St.BoxLayout({ vertical: false, x_expand: true, x_align: St.Align.START });
        let gpuComputeItem = new St.BoxLayout({ vertical: false, style: "margin-right: 12px;" });
        this.gpuComputeDot = new St.Label({ text: "■ ", style: "color: #22c55e; font-size: 11px;" });
        let gpuComputeText = new St.Label({ text: _("GPU Utilization"), style: "color: #cbd5e1; font-size: 11px; font-weight: 500;" });
        gpuComputeItem.add_actor(this.gpuComputeDot);
        gpuComputeItem.add_actor(gpuComputeText);

        let gpuTempItem = new St.BoxLayout({ vertical: false });
        this.gpuTempDot = new St.Label({ text: "■ ", style: "color: #ef4444; font-size: 11px;" });
        let gpuTempText = new St.Label({ text: _("GPU Temperature"), style: "color: #cbd5e1; font-size: 11px; font-weight: 500;" });
        gpuTempItem.add_actor(this.gpuTempDot);
        gpuTempItem.add_actor(gpuTempText);

        leftGpuLegend.add_actor(gpuComputeItem);
        leftGpuLegend.add_actor(gpuTempItem);

        let rightGpuLegend = new St.BoxLayout({ vertical: false, x_align: St.Align.END });
        let gpuMemItem = new St.BoxLayout({ vertical: false });
        this.gpuMemDot = new St.Label({ text: "■ ", style: "color: #3b82f6; font-size: 11px;" });
        let gpuMemText = new St.Label({ text: _("VRAM Usage"), style: "color: #cbd5e1; font-size: 11px; font-weight: 500;" });
        gpuMemItem.add_actor(this.gpuMemDot);
        gpuMemItem.add_actor(gpuMemText);

        rightGpuLegend.add_actor(gpuMemItem);

        this.gpuLegendBox.add_actor(leftGpuLegend);
        this.gpuLegendBox.add_actor(rightGpuLegend);
        this.window.add_actor(this.gpuLegendBox);

        this.applyDynamicStyles();
        this.setContent(this.window);
        this.cpuCanvas.invalidate();
        this.gpuCanvas.invalidate();
    },

    _parseColor: function(colorStr, defaultR, defaultG, defaultB, defaultA) {
        try {
            if (!colorStr) return { r: defaultR, g: defaultG, b: defaultB, a: defaultA };
            colorStr = colorStr.trim();
            if (colorStr.startsWith('#')) {
                let hex = colorStr.substring(1);
                if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
                let r = parseInt(hex.substring(0, 2), 16) / 255.0;
                let g = parseInt(hex.substring(2, 4), 16) / 255.0;
                let b = parseInt(hex.substring(4, 6), 16) / 255.0;
                return { r: r, g: g, b: b, a: defaultA };
            } else if (colorStr.startsWith('rgb')) {
                let matches = colorStr.match(/[\d\.]+/g);
                if (matches && matches.length >= 3) {
                    let r = parseFloat(matches[0]) / 255.0;
                    let g = parseFloat(matches[1]) / 255.0;
                    let b = parseFloat(matches[2]) / 255.0;
                    let a = matches.length >= 4 ? parseFloat(matches[3]) : defaultA;
                    return { r: r, g: g, b: b, a: a };
                }
            }
        } catch (e) {}
        return { r: defaultR, g: defaultG, b: defaultB, a: defaultA };
    },

    _onDrawCpu: function(canvas, cr, width, height) {
        cr.save();
        cr.setOperator(cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        const paddingLeft = 58;
        const paddingRight = 78;
        const paddingTop = 8;
        const paddingBottom = 12;

        const graphWidth = width - paddingLeft - paddingRight;
        const graphHeight = height - paddingTop - paddingBottom;
        if (graphWidth <= 0 || graphHeight <= 0) return true;

        let totalRamGb = this._totalRamGb;
        let ramLabel = ratio => totalRamGb === null ? "N/A" : (totalRamGb * ratio).toFixed(1) + " GB / " + Math.round(ratio * 100) + "%";
        let cpuRGB = this._parseColor(this.cpuColor, 0.133, 0.773, 0.369, 1.0);       // Green (#22c55e)
        let ramRGB = this._parseColor(this.cpuRamColor, 0.231, 0.510, 0.965, 1.0);    // Blue (#3b82f6)
        let tempRGB = this._parseColor(this.cpuTempColor, 0.937, 0.267, 0.267, 1.0);   // Red (#ef4444)

        const gridLevels = [
            { ratio: 1.0,  pct: "100%", temp: "90°C", ramGb: ramLabel(1.0) },
            { ratio: 0.75, pct: "75%",  temp: "68°C", ramGb: ramLabel(0.75) },
            { ratio: 0.50, pct: "50%",  temp: "45°C", ramGb: ramLabel(0.50) },
            { ratio: 0.25, pct: "25%",  temp: "23°C", ramGb: ramLabel(0.25) },
            { ratio: 0.0,  pct: "0%",   temp: "0°C",  ramGb: ramLabel(0.0) }
        ];

        cr.selectFontFace("Sans", cairo.FontSlant.NORMAL, cairo.FontWeight.NORMAL);
        cr.setFontSize(9);

        gridLevels.forEach(level => {
            const y = paddingTop + (1.0 - level.ratio) * graphHeight;
            const textY = y + 3;

            cr.setSourceRGBA(1, 1, 1, 0.08);
            cr.setLineWidth(1.0);
            try { cr.setDash([3, 3], 0); } catch (e) {}
            cr.moveTo(paddingLeft, Math.round(y) + 0.5);
            cr.lineTo(width - paddingRight, Math.round(y) + 0.5);
            cr.stroke();
            try { cr.setDash([], 0); } catch (e) {}

            let x = 4;
            // CPU Usage (Green)
            cr.setSourceRGBA(cpuRGB.r, cpuRGB.g, cpuRGB.b, 0.9);
            cr.moveTo(x, textY);
            cr.showText(level.pct);
            let extPct = cr.textExtents(level.pct);

            // Slash /
            cr.setSourceRGBA(0.58, 0.64, 0.72, 0.7);
            cr.moveTo(x + extPct.width + 1, textY);
            cr.showText("/");
            let extSlash = cr.textExtents("/");

            // CPU Temp (Red)
            cr.setSourceRGBA(tempRGB.r, tempRGB.g, tempRGB.b, 0.9);
            cr.moveTo(x + extPct.width + 1 + extSlash.width + 1, textY);
            cr.showText(level.temp);

            // RAM Usage (Blue)
            cr.setSourceRGBA(ramRGB.r, ramRGB.g, ramRGB.b, 0.9);
            let rightX = width - paddingRight + 6;
            cr.moveTo(rightX, textY);
            cr.showText(level.ramGb);
        });

        const drawSeries = (data, rgb, maxValue) => {
            cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 0.95);
            cr.setLineWidth(2.0);
            const step = graphWidth / (this.historyLength - 1);
            let drawing = false;
            for (let i = 0; i < data.length; i++) {
                if (data[i] === null || !isFinite(data[i])) {
                    drawing = false;
                    continue;
                }
                const val = Math.min(Math.max(data[i], 0), maxValue);
                const x = paddingLeft + i * step;
                const y = paddingTop + graphHeight - (val / maxValue) * graphHeight;
                if (!drawing) {
                    cr.moveTo(x, y);
                    drawing = true;
                } else {
                    cr.lineTo(x, y);
                }
            }
            cr.stroke();
        };

        drawSeries(this.cpuHistory, cpuRGB, 100);
        drawSeries(this.ramHistory, ramRGB, 100);
        drawSeries(this.cpuTempHistory, tempRGB, 90);

        return true;
    },

    _onDrawGpu: function(canvas, cr, width, height) {
        cr.save();
        cr.setOperator(cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        const paddingLeft = 58;
        const paddingRight = 78;
        const paddingTop = 8;
        const paddingBottom = 12;

        const graphWidth = width - paddingLeft - paddingRight;
        const graphHeight = height - paddingTop - paddingBottom;
        if (graphWidth <= 0 || graphHeight <= 0) return true;

        let totalVramGb = this._lastGpuData ? parseFloat(this._lastGpuData.vramTotalGb) : null;
        let vramLabel = ratio => totalVramGb === null ? "N/A" : (totalVramGb * ratio).toFixed(1) + " GB / " + Math.round(ratio * 100) + "%";
        let computeRGB = this._parseColor(this.gpuComputeColor, 0.133, 0.773, 0.369, 1.0);  // Green (#22c55e - GPU Compute)
        let memRGB = this._parseColor(this.gpuMemColor, 0.231, 0.510, 0.965, 1.0);        // Blue (#3b82f6 - VRAM Usage)
        let tempRGB = this._parseColor(this.gpuTempColor, 0.937, 0.267, 0.267, 1.0);       // Red (#ef4444 - GPU Temp)

        const gridLevels = [
            { ratio: 1.0,  pct: "100%", temp: "90°C", vramGb: vramLabel(1.0) },
            { ratio: 0.75, pct: "75%",  temp: "68°C", vramGb: vramLabel(0.75) },
            { ratio: 0.50, pct: "50%",  temp: "45°C", vramGb: vramLabel(0.50) },
            { ratio: 0.25, pct: "25%",  temp: "23°C", vramGb: vramLabel(0.25) },
            { ratio: 0.0,  pct: "0%",   temp: "0°C",  vramGb: vramLabel(0.0) }
        ];

        cr.selectFontFace("Sans", cairo.FontSlant.NORMAL, cairo.FontWeight.NORMAL);
        cr.setFontSize(9);

        gridLevels.forEach(level => {
            const y = paddingTop + (1.0 - level.ratio) * graphHeight;
            const textY = y + 3;

            cr.setSourceRGBA(1, 1, 1, 0.08);
            cr.setLineWidth(1.0);
            try { cr.setDash([3, 3], 0); } catch (e) {}
            cr.moveTo(paddingLeft, Math.round(y) + 0.5);
            cr.lineTo(width - paddingRight, Math.round(y) + 0.5);
            cr.stroke();
            try { cr.setDash([], 0); } catch (e) {}

            let x = 4;
            // GPU Compute (Green)
            cr.setSourceRGBA(computeRGB.r, computeRGB.g, computeRGB.b, 0.9);
            cr.moveTo(x, textY);
            cr.showText(level.pct);
            let extPct = cr.textExtents(level.pct);

            // Slash /
            cr.setSourceRGBA(0.58, 0.64, 0.72, 0.7);
            cr.moveTo(x + extPct.width + 1, textY);
            cr.showText("/");
            let extSlash = cr.textExtents("/");

            // GPU Temp (Red)
            cr.setSourceRGBA(tempRGB.r, tempRGB.g, tempRGB.b, 0.9);
            cr.moveTo(x + extPct.width + 1 + extSlash.width + 1, textY);
            cr.showText(level.temp);

            // VRAM Usage (Blue)
            cr.setSourceRGBA(memRGB.r, memRGB.g, memRGB.b, 0.9);
            let rightX = width - paddingRight + 6;
            cr.moveTo(rightX, textY);
            cr.showText(level.vramGb);
        });

        const drawSeries = (data, rgb, maxValue) => {
            cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 0.95);
            cr.setLineWidth(2.0);
            const step = graphWidth / (this.historyLength - 1);
            let drawing = false;
            for (let i = 0; i < data.length; i++) {
                if (data[i] === null || !isFinite(data[i])) {
                    drawing = false;
                    continue;
                }
                const val = Math.min(Math.max(data[i], 0), maxValue);
                const x = paddingLeft + i * step;
                const y = paddingTop + graphHeight - (val / maxValue) * graphHeight;
                if (!drawing) {
                    cr.moveTo(x, y);
                    drawing = true;
                } else {
                    cr.lineTo(x, y);
                }
            }
            cr.stroke();
        };

        drawSeries(this.gpuUtilHistory, computeRGB, 100);
        drawSeries(this.vramUtilHistory, memRGB, 100);
        drawSeries(this.gpuTempHistory, tempRGB, 90);

        return true;
    },

    _bytesToString: function(data) {
        if (typeof data === 'string') return data;
        if (ByteArray && ByteArray.toString) return ByteArray.toString(data);
        return String.fromCharCode.apply(null, data);
    },

    _loadFileAsync: function(path, cancellable, callback) {
        try {
            let file = Gio.File.new_for_path(path);
            file.load_contents_async(cancellable, (file, result) => {
                try {
                    let [success, contents] = file.load_contents_finish(result);
                    if (!success) {
                        callback("", new Error(`Could not read ${path}`));
                        return;
                    }
                    callback(this._bytesToString(contents), null);
                } catch (e) {
                    callback("", e);
                }
            });
        } catch (e) {
            callback("", e);
        }
    },

    _listDirectoryNamesAsync: function(path, cancellable, callback) {
        try {
            let directory = Gio.File.new_for_path(path);
            directory.enumerate_children_async(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW,
                cancellable,
                (directory, result) => {
                let enumerator;
                try {
                    enumerator = directory.enumerate_children_finish(result);
                } catch (e) {
                    callback([], e);
                    return;
                }

                let names = [];
                let finished = false;
                let finish = error => {
                    if (finished) return;
                    finished = true;
                    let deliver = () => callback(names.sort(), error || null);
                    try {
                        enumerator.close_async(GLib.PRIORITY_LOW, null, (enumerator, closeResult) => {
                            try { enumerator.close_finish(closeResult); } catch (e) {}
                            deliver();
                        });
                    } catch (e) {
                        deliver();
                    }
                };
                let readNext = () => {
                    if (this._isAsyncCancelled(cancellable)) {
                        finish(new Error(`Directory read cancelled for ${path}`));
                        return;
                    }
                    enumerator.next_files_async(64, GLib.PRIORITY_LOW, cancellable, (enumerator, nextResult) => {
                        let infos;
                        try {
                            infos = enumerator.next_files_finish(nextResult);
                        } catch (e) {
                            finish(e);
                            return;
                        }
                        if (infos.length === 0) {
                            finish(null);
                            return;
                        }
                        for (let info of infos) names.push(info.get_name());
                        readNext();
                    });
                };
                readNext();
                }
            );
        } catch (e) {
            callback([], e);
        }
    },

    _isAsyncCancelled: function(cancellable) {
        return this._destroyed || (cancellable && cancellable.is_cancelled());
    },

    _runAsyncTasks: function(items, worker, callback) {
        if (items.length === 0) {
            callback([]);
            return;
        }
        let results = new Array(items.length);
        let remaining = items.length;
        items.forEach((item, index) => {
            let completed = false;
            let done = result => {
                if (completed) return;
                completed = true;
                results[index] = result;
                remaining--;
                if (remaining === 0) callback(results);
            };
            try {
                worker(item, done);
            } catch (e) {
                done(null);
            }
        });
    },

    _parseCpuModel: function(content) {
        content = String(content || "");
        let modelMatch = content.match(/^model name\s*:\s*(.+)$/m);
        if (modelMatch) return modelMatch[1].trim().replace(/\s+/g, ' ');
        if (/^vendor_id\s*:\s*AuthenticAMD$/m.test(content)) return "AMD CPU";
        return "CPU";
    },

    _parseCpuCounters: function(content) {
        let cpuLine = String(content || "").split('\n')[0] || "";
        let fields = cpuLine.trim().split(/\s+/);
        if (fields[0] !== 'cpu' || fields.length < 5) return null;
        let parts = fields.slice(1).map(Number);
        if (parts.some(value => !isFinite(value) || value < 0)) return null;
        return {
            idle: parts[3] + (parts[4] || 0),
            // guest and guest_nice are already included in user and nice.
            total: parts.slice(0, 8).reduce((a, b) => a + b, 0)
        };
    },

    _calculateCpuUsage: function(counters) {
        if (!counters) return null;
        let idle = counters.idle;
        let total = counters.total;
        if (this.prevTotalTime === null || total < this.prevTotalTime || idle < this.prevIdleTime) {
            this.prevIdleTime = idle;
            this.prevTotalTime = total;
            return null;
        }

        let diffIdle = idle - this.prevIdleTime;
        let diffTotal = total - this.prevTotalTime;
        this.prevIdleTime = idle;
        this.prevTotalTime = total;
        if (diffTotal <= 0) return null;
        let usage = Math.round(((diffTotal - diffIdle) / diffTotal) * 100);
        return Math.min(Math.max(usage, 0), 100);
    },

    _parseRamSample: function(content) {
        content = String(content || "");
        let totalMatch = content.match(/^MemTotal:\s+(\d+)\s+kB$/m);
        let availableMatch = content.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
        let total = totalMatch ? Number(totalMatch[1]) : NaN;
        let available = availableMatch ? Number(availableMatch[1]) : NaN;
        let totalGb = isFinite(total) && total > 0 ? total / 1024 / 1024 : null;
        if (!isFinite(total) || !isFinite(available) || total <= 0 || available < 0 || available > total) {
            return { usage: null, totalGb: totalGb };
        }
        let usage = Math.round(((total - available) / total) * 100);
        return { usage: Math.min(Math.max(usage, 0), 100), totalGb: totalGb };
    },

    _parseTemperatureCelsius: function(raw) {
        raw = String(raw || "").trim();
        if (!/^-?\d+$/.test(raw)) return null;
        let value = Number(raw) / 1000;
        if (!isFinite(value) || value < -20 || value > 150) return null;
        return Math.round(value);
    },

    _temperatureLabelPriority: function(label) {
        let normalized = String(label || "").trim().toLowerCase();
        if (normalized === 'tctl') return 500;
        if (normalized === 'tdie') return 450;
        if (/^package(?: id)?(?: \d+)?$/.test(normalized)) return 400;
        if (normalized.includes('cpu')) return 350;
        if (normalized.includes('ccd')) return 200;
        return normalized ? 150 : 100;
    },

    _makeTemperatureCandidate: function(path, label, raw) {
        label = String(label || "").trim();
        return {
            path: path,
            label: label,
            priority: this._temperatureLabelPriority(label),
            value: this._parseTemperatureCelsius(raw)
        };
    },

    _selectTemperatureCandidate: function(candidates) {
        let valid = candidates.filter(candidate => candidate && candidate.value !== null);
        valid.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));
        if (valid.length === 0) return null;
        let selected = valid[0];
        return { path: selected.path, label: selected.label, value: selected.value };
    },

    _isCpuThermalZoneType: function(type) {
        return /(cpu|pkg|package|k10|zen)/i.test(String(type || "").trim());
    },

    _readCpuTemperatureAsync: function(cancellable, callback) {
        let sensor = this._cpuTemperatureSensor;
        if (!sensor) {
            this._startTemperatureDiscoveryAsync();
            callback(null, null);
            return;
        }

        this._loadFileAsync(sensor.path, cancellable, (raw, error) => {
            if (this._isAsyncCancelled(cancellable)) {
                callback(null, error);
                return;
            }
            let value = error ? null : this._parseTemperatureCelsius(raw);
            if (value !== null) {
                callback(value, null);
                return;
            }

            this._cpuTemperatureSensor = null;
            if (!this._destroyed) this._startTemperatureDiscoveryAsync();
            callback(null, error || new Error(`Invalid CPU temperature from ${sensor.path}`));
        });
    },

    _startTemperatureDiscoveryAsync: function() {
        if (this._destroyed || this._temperatureDiscoveryInFlight) return false;
        let now = GLib.get_monotonic_time() / 1000000;
        if (now < this._nextTemperatureDiscoveryTime) return false;

        let generation = ++this._temperatureDiscoveryGeneration;
        let cancellable = new Gio.Cancellable();
        this._temperatureDiscoveryInFlight = true;
        this._temperatureDiscoveryCancellable = cancellable;
        this._nextTemperatureDiscoveryTime = now + this._temperatureRediscoveryCooldownSeconds;
        try {
            this._discoverCpuTemperatureSensorAsync(cancellable, (sensor, error) => {
                if (!this._isCurrentTemperatureDiscovery(generation, cancellable)) return;
                this._temperatureDiscoveryInFlight = false;
                this._temperatureDiscoveryCancellable = null;
                this._cpuTemperatureSensor = sensor;
                if (error && !sensor && !cancellable.is_cancelled()) {
                    this._logRuntimeFailure("CPU temperature discovery", error);
                }
            });
        } catch (e) {
            if (this._isCurrentTemperatureDiscovery(generation, cancellable)) {
                this._temperatureDiscoveryInFlight = false;
                this._temperatureDiscoveryCancellable = null;
                this._logRuntimeFailure("CPU temperature discovery", e);
            }
            return false;
        }
        return true;
    },

    _isCurrentTemperatureDiscovery: function(generation, cancellable) {
        return !this._destroyed &&
            generation === this._temperatureDiscoveryGeneration &&
            cancellable === this._temperatureDiscoveryCancellable;
    },

    _discoverCpuTemperatureSensorAsync: function(cancellable, callback) {
        this._discoverAmdTemperatureCandidatesAsync(cancellable, (candidates, amdError) => {
            if (this._isAsyncCancelled(cancellable)) {
                callback(null, amdError);
                return;
            }
            let selected = this._selectTemperatureCandidate(candidates);
            if (selected) {
                callback(selected, amdError);
                return;
            }
            this._discoverThermalZoneSensorAsync(cancellable, (thermalSensor, thermalError) => {
                callback(thermalSensor, amdError || thermalError);
            });
        });
    },

    _discoverAmdTemperatureCandidatesAsync: function(cancellable, callback) {
        this._listDirectoryNamesAsync('/sys/class/hwmon', cancellable, (names, listError) => {
            if (this._isAsyncCancelled(cancellable)) {
                callback([], listError);
                return;
            }
            let firstError = listError || null;
            let hwmonNames = names.filter(name => /^hwmon\d+$/.test(name));
            this._runAsyncTasks(hwmonNames, (hwmonName, doneHwmon) => {
                let basePath = `/sys/class/hwmon/${hwmonName}`;
                this._loadFileAsync(`${basePath}/name`, cancellable, (driverRaw, driverError) => {
                    if (this._isAsyncCancelled(cancellable)) {
                        doneHwmon([]);
                        return;
                    }
                    let driverName = String(driverRaw || "").trim().toLowerCase();
                    if (driverError && !firstError) firstError = driverError;
                    if (driverError || (driverName !== 'k10temp' && driverName !== 'zenpower')) {
                        doneHwmon([]);
                        return;
                    }
                    this._listDirectoryNamesAsync(basePath, cancellable, (fileNames, directoryError) => {
                        if (this._isAsyncCancelled(cancellable)) {
                            doneHwmon([]);
                            return;
                        }
                        if (directoryError && !firstError) firstError = directoryError;
                        if (directoryError) {
                            doneHwmon([]);
                            return;
                        }
                        let inputs = fileNames.filter(name => /^temp\d+_input$/.test(name));
                        this._runAsyncTasks(inputs, (fileName, doneInput) => {
                            let match = fileName.match(/^temp(\d+)_input$/);
                            let path = `${basePath}/${fileName}`;
                            let label = "";
                            let raw = "";
                            let remaining = 2;
                            let complete = () => {
                                remaining--;
                                if (remaining === 0) doneInput(this._makeTemperatureCandidate(path, label, raw));
                            };
                            this._loadFileAsync(`${basePath}/temp${match[1]}_label`, cancellable, (value) => {
                                label = value || "";
                                complete();
                            });
                            this._loadFileAsync(path, cancellable, (value, inputError) => {
                                if (inputError && !firstError) firstError = inputError;
                                raw = value || "";
                                complete();
                            });
                        }, doneHwmon);
                    });
                });
            }, groups => {
                let candidates = [];
                for (let group of groups) {
                    if (group) candidates = candidates.concat(group.filter(Boolean));
                }
                callback(candidates, firstError);
            });
        });
    },

    _discoverThermalZoneSensorAsync: function(cancellable, callback) {
        this._listDirectoryNamesAsync('/sys/class/thermal', cancellable, (names, listError) => {
            if (this._isAsyncCancelled(cancellable)) {
                callback(null, listError);
                return;
            }
            let firstError = listError || null;
            let zoneNames = names.filter(name => /^thermal_zone\d+$/.test(name));
            this._runAsyncTasks(zoneNames, (zoneName, doneZone) => {
                let basePath = `/sys/class/thermal/${zoneName}`;
                this._loadFileAsync(`${basePath}/type`, cancellable, (typeRaw, typeError) => {
                    if (this._isAsyncCancelled(cancellable)) {
                        doneZone(null);
                        return;
                    }
                    let type = String(typeRaw || "").trim();
                    if (typeError && !firstError) firstError = typeError;
                    if (typeError || !this._isCpuThermalZoneType(type)) {
                        doneZone(null);
                        return;
                    }
                    this._loadFileAsync(`${basePath}/temp`, cancellable, (raw, tempError) => {
                        if (tempError && !firstError) firstError = tempError;
                        let value = tempError ? null : this._parseTemperatureCelsius(raw);
                        doneZone(value === null ? null : {
                            path: `${basePath}/temp`,
                            label: type,
                            value: value
                        });
                    });
                });
            }, sensors => {
                let selected = sensors.find(sensor => sensor !== null) || null;
                callback(selected, firstError);
            });
        });
    },

    on_desklet_removed: function() {
        this._destroyed = true;
        this._removeTimer();
        this._systemSampleGeneration++;
        if (this._systemCancellable) {
            try { this._systemCancellable.cancel(); } catch (e) {}
        }
        this._systemCancellable = null;
        this._systemSampleInFlight = false;
        this._temperatureDiscoveryGeneration++;
        if (this._temperatureDiscoveryCancellable) {
            try { this._temperatureDiscoveryCancellable.cancel(); } catch (e) {}
        }
        this._temperatureDiscoveryCancellable = null;
        this._temperatureDiscoveryInFlight = false;
        this._gpuPollGeneration++;
        this._clearGpuTimeout();
        if (this._gpuCancellable) {
            try { this._gpuCancellable.cancel(); } catch (e) {}
        }
        if (this._gpuProcess) {
            try { this._gpuProcess.force_exit(); } catch (e) {}
        }
        this._gpuCancellable = null;
        this._gpuProcess = null;
        this._gpuPollInFlight = false;
        this._hasValidGpuData = false;
        this._lastGpuData = null;
        if (this.settings) {
            try { this.settings.finalize(); } catch (e) {}
        }
    }
};

function main(metadata, desklet_id) {
    return new CpuGpuMonitorDesklet(metadata, desklet_id);
}
