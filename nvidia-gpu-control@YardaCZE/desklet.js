const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Util = imports.misc.util;

const UUID = "nvidia-gpu-control@YardaCZE";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

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
        // Parse rgb(r,g,b) or rgba(r,g,b,a) into rgba with custom opacity
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
        Util.spawnCommandLine('nvidia-settings -a "[gpu:0]/GPUFanControlState=1" -a "[fan:0]/GPUTargetFanSpeed=100"');
        Mainloop.timeout_add(500, () => {
            this._refreshData();
            return false;
        });
    },

    _setFanAuto: function() {
        Util.spawnCommandLine('nvidia-settings -a "[gpu:0]/GPUFanControlState=0"');
        Mainloop.timeout_add(500, () => {
            this._refreshData();
            return false;
        });
    },

    _findCpuSensor: function() {
        if (this.cpuSensorPath && this.cpuSensorPath !== "auto" && GLib.file_test(this.cpuSensorPath, GLib.FileTest.EXISTS)) {
            return this.cpuSensorPath;
        }
        if (this._detectedCpuPath && GLib.file_test(this._detectedCpuPath, GLib.FileTest.EXISTS)) {
            return this._detectedCpuPath;
        }

        // Auto-detect Intel (coretemp) or AMD (k10temp / zenpower) in hwmon
        try {
            let dir = Gio.File.new_for_path("/sys/class/hwmon");
            let enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                let hwmonPath = "/sys/class/hwmon/" + info.get_name();
                let nameFile = hwmonPath + "/name";
                if (GLib.file_test(nameFile, GLib.FileTest.EXISTS)) {
                    let [ok, contents] = GLib.file_get_contents(nameFile);
                    if (ok) {
                        let driverName = contents.toString().trim();
                        if (driverName === "coretemp" || driverName === "k10temp" || driverName === "zenpower") {
                            let tempFile = hwmonPath + "/temp1_input";
                            if (GLib.file_test(tempFile, GLib.FileTest.EXISTS)) {
                                this._detectedCpuPath = tempFile;
                                return tempFile;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // Fallback below
        }

        // Fallback to thermal_zone
        let fallbacks = [
            "/sys/class/thermal/thermal_zone2/temp",
            "/sys/class/thermal/thermal_zone0/temp"
        ];
        for (let path of fallbacks) {
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                this._detectedCpuPath = path;
                return path;
            }
        }
        return null;
    },

    _refreshData: function() {
        // 1. Read NVIDIA GPU Temp & Fan Speed (force LC_ALL=C for locale safety)
        if (this.showGpuTemp || this.showFanSpeed) {
            try {
                let [res, out, err, status] = GLib.spawn_command_line_sync(
                    "env LC_ALL=C nvidia-smi --query-gpu=temperature.gpu,fan.speed --format=csv,noheader,nounits"
                );
                if (res && status === 0) {
                    let output = out.toString().trim();
                    let parts = output.split(",");
                    if (parts.length >= 2) {
                        let gpuTemp = parts[0].trim();
                        let fanSpeed = parts[1].trim();
                        this.gpuTempVal.set_text(gpuTemp + " °C");
                        this.fanSpeedVal.set_text(fanSpeed + " %");
                    }
                } else {
                    this.gpuTempVal.set_text("N/A");
                    this.fanSpeedVal.set_text("N/A");
                }
            } catch (e) {
                this.gpuTempVal.set_text("Err");
                this.fanSpeedVal.set_text("Err");
            }
        }

        // 2. Read CPU Temperature
        if (this.showCpuTemp) {
            let cpuPath = this._findCpuSensor();
            if (cpuPath) {
                try {
                    let [ok, contents] = GLib.file_get_contents(cpuPath);
                    if (ok) {
                        let rawVal = parseInt(contents.toString().trim(), 10);
                        if (!isNaN(rawVal)) {
                            let celsius = Math.round(rawVal / 1000);
                            this.cpuTempVal.set_text(celsius + " °C");
                        }
                    }
                } catch (e) {
                    this.cpuTempVal.set_text("Err");
                }
            } else {
                this.cpuTempVal.set_text("N/A");
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
