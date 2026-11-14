const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Util = imports.misc.util;

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
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-gpu-power", "showGpuPower", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-cpu-power", "showCpuPower", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-fan-speed", "showFanSpeed", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-fan-controls", "showFanControls", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "update-interval", "updateInterval", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "cpu-sensor-path", "cpuSensorPath", this._onSettingsChanged, null);
        
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-gpu-temp", "labelGpuTemp", this._updateLabels, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-cpu-temp", "labelCpuTemp", this._updateLabels, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-gpu-power", "labelGpuPower", this._updateLabels, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-cpu-power", "labelCpuPower", this._updateLabels, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-fan-speed", "labelFanSpeed", this._updateLabels, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-btn-auto", "labelBtnAuto", this._updateLabels, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "label-btn-max", "labelBtnMax", this._updateLabels, null);

        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-height", "deskletHeight", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "dynamic-colors", "dynamicColors", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color", "bgColor", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "bg-opacity", "bgOpacity", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "textColor", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this._applyStyle, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "border-radius", "borderRadius", this._applyStyle, null);

        this._detectedCpuPath = null;
        this._detectedRaplPath = null;
        this._lastRaplEnergy = null;
        this._lastRaplTime = null;
        this._detectingCpu = false;
        this._buildUI();
        this._updateLabels();
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

        // GPU Power Row
        this.gpuPowerRow = new St.BoxLayout({ vertical: false, style_class: "gpu-desklet-row" });
        this.gpuPowerLabel = new St.Label({ text: _("GPU Power:") });
        this.gpuPowerVal = new St.Label({ text: "-- W", style_class: "gpu-desklet-value" });
        this.gpuPowerRow.add(this.gpuPowerLabel, { expand: true, x_fill: false, x_align: St.Align.START });
        this.gpuPowerRow.add(this.gpuPowerVal, { x_fill: false, x_align: St.Align.END });

        // CPU Power Row
        this.cpuPowerRow = new St.BoxLayout({ vertical: false, style_class: "gpu-desklet-row" });
        this.cpuPowerLabel = new St.Label({ text: _("CPU Power:") });
        this.cpuPowerVal = new St.Label({ text: "-- W", style_class: "gpu-desklet-value" });
        this.cpuPowerRow.add(this.cpuPowerLabel, { expand: true, x_fill: false, x_align: St.Align.START });
        this.cpuPowerRow.add(this.cpuPowerVal, { x_fill: false, x_align: St.Align.END });

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
        this.mainContainer.add(this.gpuPowerRow);
        this.mainContainer.add(this.cpuPowerRow);
        this.mainContainer.add(this.fanSpeedRow);
        this.mainContainer.add(this.btnBox);

        this.setContent(this.mainContainer);
        this._updateVisibility();
    },

    _resolveLabel: function(customVal, defaultEnglish) {
        if (customVal && customVal.trim() !== "" && customVal.trim().toLowerCase() !== "auto") {
            return customVal;
        }
        return _(defaultEnglish);
    },

    _updateLabels: function() {
        this.gpuTempLabel.set_text(this._resolveLabel(this.labelGpuTemp, "GPU Temp:"));
        this.cpuTempLabel.set_text(this._resolveLabel(this.labelCpuTemp, "CPU Temp:"));
        this.gpuPowerLabel.set_text(this._resolveLabel(this.labelGpuPower, "GPU Power:"));
        this.cpuPowerLabel.set_text(this._resolveLabel(this.labelCpuPower, "CPU Power:"));
        this.fanSpeedLabel.set_text(this._resolveLabel(this.labelFanSpeed, "GPU Fan:"));
        this.btnAuto.set_label(this._resolveLabel(this.labelBtnAuto, "Fan Auto"));
        this.btnMax.set_label(this._resolveLabel(this.labelBtnMax, "Fan 100%"));
    },

    _updateVisibility: function() {
        this.gpuTempRow.visible = this.showGpuTemp;
        this.cpuTempRow.visible = this.showCpuTemp;
        this.gpuPowerRow.visible = this.showGpuPower;
        this.cpuPowerRow.visible = this.showCpuPower;
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
        let widthPx = this.deskletWidth || 240;
        let heightStyle = (this.deskletHeight && this.deskletHeight > 0) ? `height: ${this.deskletHeight}px; ` : "";

        this.mainContainer.set_style(
            `width: ${widthPx}px; ` +
            heightStyle +
            `background-color: ${rgbaBg}; ` +
            `color: ${this.textColor}; ` +
            `font-size: ${this.fontSize}px; ` +
            `border-radius: ${this.borderRadius}px;`
        );
    },

    _onSettingsChanged: function() {
        this._detectedCpuPath = null;
        this._detectedRaplPath = null;
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

    _getTempColor: function(celsius) {
        if (!this.dynamicColors) {
            return this.textColor;
        }
        if (celsius >= 85) {
            return "#ff4444";
        } else if (celsius >= 75) {
            return "#f39c12";
        } else {
            return this.textColor;
        }
    },

    _readCpuFileAsync: function(path, onFallback) {
        let file = Gio.File.new_for_path(path);
        file.load_contents_async(null, (obj, res) => {
            try {
                let [ok, contents] = obj.load_contents_finish(res);
                if (ok) {
                    let textDec = new TextDecoder("utf-8");
                    let rawVal = parseInt(textDec.decode(contents).trim(), 10);
                    if (!isNaN(rawVal)) {
                        this._detectedCpuPath = path;
                        let celsius = Math.round(rawVal / 1000);
                        let color = this._getTempColor(celsius);
                        this.cpuTempVal.set_text(celsius + " °C");
                        this.cpuTempVal.set_style(`color: ${color}; font-weight: bold;`);
                        return;
                    }
                }
            } catch (e) {}
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
                } catch (e) {}
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
                    let textDec = new TextDecoder("utf-8");
                    let driverName = textDec.decode(contents).trim();
                    if (driverName === "coretemp" || driverName === "k10temp" || driverName === "zenpower") {
                        this._detectingCpu = false;
                        this._readCpuFileAsync(basePath + "/temp1_input", () => {
                            this._checkHwmonCandidates(candidates, index + 1);
                        });
                        return;
                    }
                }
            } catch (e) {}
            this._checkHwmonCandidates(candidates, index + 1);
        });
    },

    _readCpuPowerAsync: function() {
        let raplPaths = [
            this._detectedRaplPath,
            "/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj",
            "/sys/class/powercap/intel-rapl/intel-rapl:0:0/energy_uj"
        ];
        
        let tryPath = (paths, idx) => {
            if (idx >= paths.length || !paths[idx]) {
                this.cpuPowerVal.set_text("N/A");
                return;
            }
            let p = paths[idx];
            let file = Gio.File.new_for_path(p);
            let now = Date.now();

            file.load_contents_async(null, (obj, res) => {
                try {
                    let [ok, contents] = obj.load_contents_finish(res);
                    if (ok) {
                        let textDec = new TextDecoder("utf-8");
                        let currentEnergy = parseInt(textDec.decode(contents).trim(), 10);
                        if (!isNaN(currentEnergy)) {
                            this._detectedRaplPath = p;
                            if (this._lastRaplEnergy !== null && this._lastRaplTime !== null) {
                                let deltaEnergy = currentEnergy - this._lastRaplEnergy;
                                if (deltaEnergy < 0) deltaEnergy += 4294967296;
                                let deltaTime = (now - this._lastRaplTime) / 1000.0;
                                if (deltaTime > 0) {
                                    let watts = (deltaEnergy / 1000000.0) / deltaTime;
                                    if (!isNaN(watts) && watts >= 0 && watts < 500) {
                                        this.cpuPowerVal.set_text(watts.toFixed(1) + " W");
                                        this._lastRaplEnergy = currentEnergy;
                                        this._lastRaplTime = now;
                                        return;
                                    }
                                }
                            }
                            this._lastRaplEnergy = currentEnergy;
                            this._lastRaplTime = now;
                            this.cpuPowerVal.set_text("0.0 W");
                            return;
                        }
                    }
                } catch (e) {
                    tryPath(paths, idx + 1);
                    return;
                }
                tryPath(paths, idx + 1);
            });
        };

        tryPath(raplPaths, 0);
    },

    _refreshData: function() {
        if (this.showGpuTemp || this.showFanSpeed || this.showGpuPower) {
            try {
                let proc = Gio.Subprocess.new(
                    [
                        "env", "LC_ALL=C",
                        "nvidia-smi",
                        "--query-gpu=temperature.gpu,fan.speed,power.draw",
                        "--format=csv,noheader,nounits"
                    ],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (subproc, res) => {
                    try {
                        let [ok, stdout, stderr] = subproc.communicate_utf8_finish(res);
                        if (ok && subproc.get_successful() && stdout) {
                            let parts = stdout.trim().split(",");
                            if (parts.length >= 3) {
                                let gpuTempNum = parseInt(parts[0].trim(), 10);
                                let gpuTempStr = parts[0].trim();
                                let fanSpeed = parts[1].trim();
                                let powerParsed = parseFloat(parts[2].trim());
                                let gpuPower = !isNaN(powerParsed) ? powerParsed.toFixed(1) : "N/A";

                                if (!isNaN(gpuTempNum)) {
                                    let gpuColor = this._getTempColor(gpuTempNum);
                                    this.gpuTempVal.set_text(gpuTempStr + " °C");
                                    this.gpuTempVal.set_style(`color: ${gpuColor}; font-weight: bold;`);
                                }
                                this.fanSpeedVal.set_text(fanSpeed + " %");
                                this.gpuPowerVal.set_text(gpuPower + " W");
                                return;
                            }
                        }
                        this.gpuTempVal.set_text("N/A");
                        this.gpuPowerVal.set_text("N/A");
                    } catch (e) {
                        this.gpuTempVal.set_text("Err");
                        this.gpuPowerVal.set_text("Err");
                    }
                });
            } catch (e) {
                this.gpuTempVal.set_text("Err");
                this.gpuPowerVal.set_text("Err");
            }
        }

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

        if (this.showCpuPower) {
            this._readCpuPowerAsync();
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
