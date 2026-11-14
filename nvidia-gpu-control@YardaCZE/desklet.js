const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Util = imports.misc.util;
const ByteArray = imports.byteArray;

const UUID = "nvidia-gpu-control@YardaCZE";

Gettext.bindtextdomain(UUID, GLib.build_filenamev([GLib.get_user_data_dir(), "locale"]));

function _(str) {
    let translated = Gettext.dgettext(UUID, str);
    if (translated !== str) {
        return translated;
    }
    return str;
}

function NvidiaGpuDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

NvidiaGpuDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-gpu-temp", "showGpuTemp", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-cpu-temp", "showCpuTemp", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-fan-speed", "showFanSpeed", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-fan-controls", "showFanControls", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "update-interval", "updateInterval", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "cpu-sensor-path", "cpuSensorPath", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color", "bgColor", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "bg-opacity", "bgOpacity", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "textColor", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "border-radius", "borderRadius", this._applyStyle, null);

        this._detectedCpuPath = null;
        this._detectingCpu = false;
        this._buildUI();
        this._applyStyle();
        this._updateLoop();
    },

    _buildUI: function() {
        this.mainContainer = new St.BoxLayout({
            vertical: true,
            style_class: "gpu-desklet-container"
        });

        // GPU Temp Row
        this.gpuTempRow = new St.BoxLayout({ vertical: false, style_class: "gpu-desklet-row" });
        this.gpuTempLabel = new St.Label({ text: _("GPU Temp:") });
        this.gpuTempVal = new St.Label({ text: "-- °C", style_class: "gpu-desklet-value" });
        this.gpuTempRow.add(this.gpuTempLabel, { expand: true, x_fill: false, x_align: St.Align.START });
        this.gpuTempRow.add(this.gpuTempVal, { x_fill: false, x_align: St.Align.END });

        // CPU Temp Row
        this.cpuTempRow = new St.BoxLayout({ vertical: false, style_class: "gpu-desklet-row" });
        this.cpuTempLabel = new St.Label({ text: _("CPU Temp:") });
        this.cpuTempVal = new St.Label({ text: "-- °C", style_class: "gpu-desklet-value" });
        this.cpuTempRow.add(this.cpuTempLabel, { expand: true, x_fill: false, x_align: St.Align.START });
        this.cpuTempRow.add(this.cpuTempVal, { x_fill: false, x_align: St.Align.END });

        // Fan Speed Row
        this.fanSpeedRow = new St.BoxLayout({ vertical: false, style_class: "gpu-desklet-row" });
        this.fanSpeedLabel = new St.Label({ text: _("GPU Fan:") });
        this.fanSpeedVal = new St.Label({ text: "-- %", style_class: "gpu-desklet-value" });
        this.fanSpeedRow.add(this.fanSpeedLabel, { expand: true, x_fill: false, x_align: St.Align.START });
        this.fanSpeedRow.add(this.fanSpeedVal, { x_fill: false, x_align: St.Align.END });

        // Fan Control Buttons
        this.btnBox = new St.BoxLayout({ vertical: false, style_class: "gpu-btn-box" });
        
        this.btnAuto = new St.Button({
            label: _("Fan Auto"),
            style_class: "gpu-fan-btn",
            reactive: true,
            can_focus: true
        });
        this.btnAuto.connect("clicked", () => this._setFanAuto());

        this.btnMax = new St.Button({
            label: _("Fan 100%"),
            style_class: "gpu-fan-btn",
            reactive: true,
            can_focus: true
        });
        this.btnMax.connect("clicked", () => this._setFanMax());

        this.btnBox.add(this.btnAuto, { expand: true });
        this.btnBox.add(this.btnMax, { expand: true });

        this.mainContainer.add(this.gpuTempRow);
        this.mainContainer.add(this.cpuTempRow);
        this.mainContainer.add(this.fanSpeedRow);
        this.mainContainer.add(this.btnBox);

        this.setContent(this.mainContainer);
        this._updateVisibility();
    },

    _updateVisibility: function() {
        this.gpuTempRow.visible = this.showGpuTemp;
        this.cpuTempRow.visible = this.showCpuTemp;
        this.fanSpeedRow.visible = this.showFanSpeed;
        this.btnBox.visible = this.showFanControls;
    },

    _applyStyle: function() {
        let match = this.bgColor.match(/\d+/g);
        let r = 20, g = 20, b = 20;
        if (match && match.length >= 3) {
            r = match[0];
            g = match[1];
            b = match[2];
        }
        let rgbaBg = `rgba(${r}, ${g}, ${b}, ${this.bgOpacity})`;

        this.mainContainer.set_style(
            `background-color: ${rgbaBg}; ` +
            `color: ${this.textColor}; ` +
            `font-size: ${this.fontSize}px; ` +
            `border-radius: ${this.borderRadius}px;`
        );
    },

    _onSettingsChanged: function() {
        this._detectedCpuPath = null;
        this._updateVisibility();
        this._refreshData();
    },

    _setFanMax: function() {
        Util.spawn([
            "nvidia-settings",
            "-a", "[gpu:0]/GPUFanControlState=1",
            "-a", "[fan:0]/GPUTargetFanSpeed=100"
        ]);
        Mainloop.timeout_add(500, () => {
            this._refreshData();
            return false;
        });
    },

    _setFanAuto: function() {
        Util.spawn([
            "nvidia-settings",
            "-a", "[gpu:0]/GPUFanControlState=0"
        ]);
        Mainloop.timeout_add(500, () => {
            this._refreshData();
            return false;
        });
    },

    _readCpuFileAsync: function(path, onFallback) {
        let file = Gio.File.new_for_path(path);
        file.load_contents_async(null, (obj, res) => {
            try {
                let [ok, contents] = obj.load_contents_finish(res);
                if (ok) {
                    let rawVal = parseInt(ByteArray.toString(contents).trim(), 10);
                    if (!isNaN(rawVal)) {
                        this._detectedCpuPath = path;
                        let celsius = Math.round(rawVal / 1000);
                        this.cpuTempVal.set_text(celsius + " °C");
                        return;
                    }
                }
            } catch (e) {
                // File not found or unreadable
            }
            if (onFallback) {
                onFallback();
            } else {
                this._detectedCpuPath = null;
                this.cpuTempVal.set_text("N/A");
            }
        });
    },

    _detectAndReadCpuAsync: function() {
        if (this._detectingCpu) return;
        this._detectingCpu = true;

        let hwmonDir = Gio.File.new_for_path("/sys/class/hwmon");
        hwmonDir.enumerate_children_async(
            "standard::name",
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (dirObj, res) => {
                let candidates = [];
                try {
                    let enumerator = dirObj.enumerate_children_finish(res);
                    let info;
                    while ((info = enumerator.next_file(null)) !== null) {
                        candidates.push("/sys/class/hwmon/" + info.get_name());
                    }
                } catch (e) {
                    // hwmon unavailable
                }
                this._checkHwmonCandidates(candidates, 0);
            }
        );
    },

    _checkHwmonCandidates: function(candidates, index) {
        if (index >= candidates.length) {
            this._detectingCpu = false;
            this._readCpuFileAsync("/sys/class/thermal/thermal_zone2/temp", () => {
                this._readCpuFileAsync("/sys/class/thermal/thermal_zone0/temp", null);
            });
            return;
        }

        let basePath = candidates[index];
        let nameFile = Gio.File.new_for_path(basePath + "/name");
        nameFile.load_contents_async(null, (obj, res) => {
            try {
                let [ok, contents] = obj.load_contents_finish(res);
                if (ok) {
                    let driverName = ByteArray.toString(contents).trim();
                    if (driverName === "coretemp" || driverName === "k10temp" || driverName === "zenpower") {
                        this._detectingCpu = false;
                        this._readCpuFileAsync(basePath + "/temp1_input", () => {
                            this._checkHwmonCandidates(candidates, index + 1);
                        });
                        return;
                    }
                }
            } catch (e) {
                // Ignore and check next
            }
            this._checkHwmonCandidates(candidates, index + 1);
        });
    },

    _refreshData: function() {
        // 1. Read NVIDIA GPU Temp & Fan Speed asynchronously
        if (this.showGpuTemp || this.showFanSpeed) {
            try {
                let proc = Gio.Subprocess.new(
                    [
                        "env", "LC_ALL=C",
                        "nvidia-smi",
                        "--query-gpu=temperature.gpu,fan.speed",
                        "--format=csv,noheader,nounits"
                    ],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (subproc, res) => {
                    try {
                        let [ok, stdout, stderr] = subproc.communicate_utf8_finish(res);
                        if (ok && subproc.get_successful() && stdout) {
                            let parts = stdout.trim().split(",");
                            if (parts.length >= 2) {
                                this.gpuTempVal.set_text(parts[0].trim() + " °C");
                                this.fanSpeedVal.set_text(parts[1].trim() + " %");
                                return;
                            }
                        }
                        this.gpuTempVal.set_text("N/A");
                        this.fanSpeedVal.set_text("N/A");
                    } catch (e) {
                        this.gpuTempVal.set_text("Err");
                        this.fanSpeedVal.set_text("Err");
                    }
                });
            } catch (e) {
                this.gpuTempVal.set_text("Err");
                this.fanSpeedVal.set_text("Err");
            }
        }

        // 2. Read CPU Temperature asynchronously
        if (this.showCpuTemp) {
            if (this.cpuSensorPath && this.cpuSensorPath !== "auto") {
                this._readCpuFileAsync(this.cpuSensorPath, null);
            } else if (this._detectedCpuPath) {
                this._readCpuFileAsync(this._detectedCpuPath, () => {
                    this._detectedCpuPath = null;
                    this._detectAndReadCpuAsync();
                });
            } else {
                this._detectAndReadCpuAsync();
            }
        }
    },

    _updateLoop: function() {
        this._refreshData();
        let interval = Math.max(1, this.updateInterval || 2);
        this._timeout = Mainloop.timeout_add_seconds(interval, () => {
            this._updateLoop();
            return false;
        });
    },

    on_desklet_removed: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    }
};

function main(metadata, deskletId) {
    return new NvidiaGpuDesklet(metadata, deskletId);
}
