const ByteArray = imports.byteArray;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const GTop = imports.gi.GTop;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const NM = imports.gi.NM;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const UUID = "simple-system-monitor@ariel";

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

const ST_ALIGNMENT = {
    "left": St.Align.START,
    "right": St.Align.END
};

// Used when the refresh interval setting is missing or out of range.
const DEFAULT_REFRESH_INTERVAL_MS = 1000;
const MIN_REFRESH_INTERVAL_MS = 200;
const MAX_REFRESH_INTERVAL_MS = 30000;
// The GPU is read through nvidia-smi, which costs a subprocess, so it is polled
// no more often than this regardless of the refresh interval. Temperature has
// enough thermal inertia that nothing visible is lost.
const GPU_MIN_REFRESH_MS = 2000;

let missingDependencies = false;

function readTextFile(path) {
    try {
        let [ok, contents] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return ByteArray.toString(contents);
    } catch (e) {
        return null;
    }
}

// Locate a sysfs hwmon input by driver name, optionally matching a sensor label.
// hwmon numbering is not stable across boots, so it must be resolved by name.
function findHwmonInput(driverName, sensorLabel) {
    for (let i = 0; i < 32; i++) {
        let base = `/sys/class/hwmon/hwmon${i}`;
        let name = readTextFile(base + "/name");
        if (name === null || name.trim() !== driverName)
            continue;
        for (let j = 1; j <= 16; j++) {
            let input = `${base}/temp${j}_input`;
            if (!GLib.file_test(input, GLib.FileTest.EXISTS))
                continue;
            if (!sensorLabel)
                return input;
            let label = readTextFile(`${base}/temp${j}_label`);
            if (label !== null && label.trim() === sensorLabel)
                return input;
        }
    }
    return null;
}

// Locate a thermal zone by its reported type, e.g. "x86_pkg_temp".
function findThermalZone(zoneType) {
    for (let i = 0; i < 32; i++) {
        let base = `/sys/class/thermal/thermal_zone${i}`;
        let type = readTextFile(base + "/type");
        if (type !== null && type.trim() === zoneType)
            return base + "/temp";
    }
    return null;
}

// Earlier versions wrote this path into the saved settings as a default for both
// the CPU and the GPU, so almost every existing install has it stored even though
// the user never picked it. It is the motherboard sensor, and it is certainly not
// a GPU, so it is treated as "detect automatically" rather than as a choice.
const LEGACY_SENSOR_PATH = "/sys/class/thermal/thermal_zone0";

// Turn a user-chosen directory into a readable temperature file. Accepts both
// thermal zone directories (temp) and hwmon directories (temp1_input).
function tempFileInDirectory(path) {
    if (!path || path == LEGACY_SENSOR_PATH)
        return null;
    let dir = path.substring(path.lastIndexOf("//") + 1);
    if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
        return null;
    for (let candidate of [dir + "/temp", dir + "/temp1_input"]) {
        if (GLib.file_test(candidate, GLib.FileTest.EXISTS))
            return candidate;
    }
    return null;
}

function formatTemperature(milliDegrees, units) {
    let degrees = milliDegrees / 1000;
    if (units == "fahrenheit")
        return ((degrees * 1.8) + 32).toFixed(1) + "°F";
    return degrees.toFixed(1) + "°C";
}

try {
    const NM = imports.gi.NM;
} catch (e) {
    global.logError(e);
    missingDependencies = true;
}

try {
    const GTop = imports.gi.GTop;
} catch (e) {
    global.logError(e);
    missingDependencies = true;
}

const MISSING_DEPENDENCIES = _("Dependencies missing. Please install \n\
libgtop \n\
\t    on Ubuntu: gir1.2-gtop-2.0 \n\
\t    on Fedora: libgtop2-devel \n\
\t    on Arch: libgtop \n\
and restart Cinnamon.\n");

const CPU = function () {
    this._init.apply(this, arguments);
};

CPU.prototype = {
    _init: function () {
        this.gtop = new GTop.glibtop_cpu();
        GTop.glibtop_get_cpu(this.gtop);
        this.total = this.gtop.total;
        this.idle = this.gtop.idle;
        this.iowait = this.gtop.iowait;
        this.used = "0.00";
    },

    refresh: function () {
        GTop.glibtop_get_cpu(this.gtop);

        // Busy time is everything that is not idle and not waiting on I/O. Adding
        // up user + sys instead would silently drop nice, irq and softirq time,
        // and counting iowait as busy would report a stalled disk as a busy CPU.
        let total = this.gtop.total - this.total;
        let idle = (this.gtop.idle - this.idle) + (this.gtop.iowait - this.iowait);

        if (total > 0)
            this.used = Math.max(0, Math.min(100, (total - idle) * 100 / total)).toFixed(2);

        this.total = this.gtop.total;
        this.idle = this.gtop.idle;
        this.iowait = this.gtop.iowait;
    }
}

const Memory = function () {
    this._init.apply(this, arguments);
};

Memory.prototype = {
    _init: function () {
        this.gtop = new GTop.glibtop_mem();
    },

    refresh: function () {
        GTop.glibtop_get_mem(this.gtop);
        this.used = (Math.round(this.gtop.user / 1024 / 1024 / 1024 * 100) / 100).toFixed(2);
    }
}

const Thermal = function () {
    this._init.apply(this, arguments);
};

Thermal.prototype = {
    _init: function (cpuPath, cpuUnits) {
        this.tempUnits = cpuUnits;
        this.info = "N/A";
        this.cpuFile = tempFileInDirectory(cpuPath);

        // With no usable choice from the user, prefer the sensor on the CPU die
        // itself. thermal_zone0 is normally acpitz, a chassis sensor that lags
        // the processor and is only a last resort.
        if (!this.cpuFile) {
            this.cpuFile = findHwmonInput("coretemp", "Package id 0")
                || findHwmonInput("k10temp", "Tctl")
                || findThermalZone("x86_pkg_temp")
                || "/sys/class/thermal/thermal_zone0/temp";
        }
    },

    refresh: function () {
        let contents = readTextFile(this.cpuFile);
        let value = contents === null ? NaN : parseInt(contents);
        this.info = isNaN(value) ? "N/A" : formatTemperature(value, this.tempUnits);
    }
}

const ThermalGPU = function () {
    this._init.apply(this, arguments);
};

ThermalGPU.prototype = {
    _init: function (gpuPath, gpuUnits) {
        this.tempUnits = gpuUnits;
        this.info = "N/A";
        this.nvidiaSmi = null;
        this.pending = false;

        // A path chosen by the user wins, but only if it actually reads as a
        // temperature. The old default pointed at thermal_zone0, which is the
        // motherboard sensor, so the GPU row simply repeated the CPU row.
        this.gpuFile = tempFileInDirectory(gpuPath);

        if (!this.gpuFile) {
            // Discrete NVIDIA cards publish no hwmon entry under the proprietary
            // driver, so nvidia-smi is the only way to read them.
            this.nvidiaSmi = GLib.find_program_in_path("nvidia-smi");
            if (!this.nvidiaSmi) {
                this.gpuFile = findHwmonInput("amdgpu", null)
                    || findHwmonInput("nouveau", null)
                    || findHwmonInput("i915", null);
            }
        }
    },

    refresh: function () {
        if (this.gpuFile) {
            let contents = readTextFile(this.gpuFile);
            let value = contents === null ? NaN : parseInt(contents);
            this.info = isNaN(value) ? "N/A" : formatTemperature(value, this.tempUnits);
            return;
        }

        if (!this.nvidiaSmi || this.pending)
            return;

        // Asynchronous on purpose: a blocking subprocess on the refresh tick
        // would stall the whole Cinnamon shell.
        this.pending = true;
        try {
            let subprocess = Gio.Subprocess.new(
                [this.nvidiaSmi, "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            subprocess.communicate_utf8_async(null, null, (proc, result) => {
                try {
                    let [, stdout] = proc.communicate_utf8_finish(result);
                    let value = parseInt(stdout);
                    this.info = isNaN(value) ? "N/A" : formatTemperature(value * 1000, this.tempUnits);
                } catch (e) {
                    this.info = "N/A";
                } finally {
                    this.pending = false;
                }
            });
        } catch (e) {
            this.pending = false;
            this.info = "N/A";
        }
    }
}

const Net = function () {
    this._init.apply(this, arguments);
};

Net.prototype = {
    _init: function () {
        this.connections = [];
        let newNM = true;
        let args = newNM ? [null] : [];
        this.client = NM.Client.new.apply(this, args);
        this.update_connections();

        if (!this.connections.length) {
            let found = [];
            let net_file = GLib.file_get_contents('/proc/net/dev')[1];
            let net_lines = ByteArray.toString(net_file).split("\n");
            for (let i = 3; i < net_lines.length - 1; i++) {
                let connection = net_lines[i].replace(/^\s+/g, '').split(":")[0];
                let operstate = readTextFile(`/sys/class/net/${connection}/operstate`);
                if (operstate !== null &&
                    operstate.replace(/\s/g, "") == "up" &&
                    connection.indexOf("br") < 0) {
                    found.push(connection);
                }
            }
            this.connections = this.filterPhysical(found);
        }

        this.gtop = new GTop.glibtop_netload();

        try {
            let connection_list = this.client.get_devices();
            this.NMsigID = [];
            for (let j = 0; j < connection_list.length; j++) {
                this.NMsigID[j] = connection_list[j].connect('state-changed', Lang.bind(this, this.update_connections));
            }
        }
        catch (e) {
            global.logError(_("Please install missing dependencies."));
        }

        this.totalDownloaded = 0;
        this.totalUploaded = 0;
        this.lastRefresh = 0;
    },

    update_connections: function () {
        try {
            let found = [];
            let connection_list = this.client.get_devices();
            for (let j = 0; j < connection_list.length; j++) {
                if (connection_list[j].state == NM.DeviceState.ACTIVATED)
                    found.push(connection_list[j].get_ip_iface());
            }
            this.connections = this.filterPhysical(found);
        }
        catch (e) {
            global.logError(_("Please install missing dependencies."));
        }
    },

    // Only real network hardware is counted. Loopback is not network traffic at
    // all, and a VPN or Tailscale interface carries the same bytes a second time
    // on its way to the physical card, so including them doubles the figures.
    // Virtual interfaces have no "device" entry in sysfs; physical ones do.
    filterPhysical: function (interfaces) {
        let physical = interfaces.filter(name =>
            name && name != "lo" && GLib.file_test(`/sys/class/net/${name}/device`, GLib.FileTest.EXISTS));
        // Rather than show nothing on an unusual setup, fall back to the full list.
        return physical.length ? physical : interfaces.filter(name => name && name != "lo");
    },

    refresh: function () {
        let totalDownloaded = 0;
        let totalUploaded = 0;

        for (let i in this.connections) {
            GTop.glibtop_get_netload(this.gtop, this.connections[i]);
            totalDownloaded += this.gtop.bytes_in;
            totalUploaded += this.gtop.bytes_out;
        }

        let time = GLib.get_monotonic_time() / 1000;
        let elapsedSeconds = (time - this.lastRefresh) / 1000;

        // The old maths divided bytes by milliseconds and labelled the answer
        // "KB", which is a 2.4 % overstatement, and dropped the "per second" so
        // a rate read as a total. Convert to bytes per second, then scale once.
        let downloadRate = 0;
        let uploadRate = 0;
        if (this.lastRefresh > 0 && elapsedSeconds > 0) {
            // Counters reset when an interface goes down, so a negative delta is
            // a restarted counter rather than negative traffic.
            downloadRate = Math.max(0, totalDownloaded - this.totalDownloaded) / elapsedSeconds;
            uploadRate = Math.max(0, totalUploaded - this.totalUploaded) / elapsedSeconds;
        }

        this.downloadSpeed = this.formatRate(downloadRate);
        this.uploadSpeed = this.formatRate(uploadRate);

        this.totalDownloaded = totalDownloaded;
        this.totalUploaded = totalUploaded;
        this.lastRefresh = time;
    },

    formatRate: function (bytesPerSecond) {
        if (bytesPerSecond < 1024)
            return Math.round(bytesPerSecond) + " B/s";
        if (bytesPerSecond < 1024 * 1024)
            return (bytesPerSecond / 1024).toFixed(1) + " KB/s";
        return (bytesPerSecond / 1024 / 1024).toFixed(2) + " MB/s";
    }
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this._timeoutId = null;
        this.setupUI();
    },

    setupUI: function () {
        // Every one of these bindings calls setupUI again when it fires, so the
        // settings object is built once. Rebuilding it here left the previous
        // set of bindings live, doubling the work on each settings change.
        if (!this.settings)
            this._bindSettings();

        this._buildContent();
    },

    _bindSettings: function () {
        this.settings = new Settings.DeskletSettings(this, UUID, this.desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh_interval", "refresh_interval", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "title_align", "title_align", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "value_align", "value_align", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "temp_units", "temp_units", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font_scale_size", "font_scale_size", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font_color", "font_color", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font_family", "font_family", this.on_font_setting_changed);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show_decorations", "show_decorations", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "background_color", "background_color", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "customCPUPath", "customCPUPath", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "display_gpu", "display_gpu", this.setupUI);
        this.settings.bindProperty(Settings.BindingDirection.IN, "customGPUPath", "customGPUPath", this.setupUI);
        // refresh style on change of global desklet setting for decorations.
        // setupUI runs again on every settings change, so this connects once or
        // the handlers stack up and each change costs another rebuild.
        this._decorationsSignalId = global.settings.connect(
            'changed::desklet-decorations', Lang.bind(this, this.setupUI));
    },

    _buildContent: function () {
        this.metadata['prevent-decorations'] = !this.show_decorations;
        this.mainContainer = new St.BoxLayout({ style_class: "mainContainer" });

        this.titles = new St.BoxLayout({ vertical: true });
        this.values = new St.BoxLayout({ vertical: true });

        this.titleCPU = new St.Label({ text: _("CPU:"), style_class: "title" });
        this.titleCPU.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.titleMemory = new St.Label({ text: _("Memory:"), style_class: "title" });
        this.titleMemory.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.titleDownload = new St.Label({ text: _("Download:"), style_class: "title" });
        this.titleDownload.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.titleUpload = new St.Label({ text: _("Upload:"), style_class: "title" });
        this.titleUpload.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.titleTemperature = new St.Label({ text: _("Temperature:"), style_class: "title" });
        this.titleTemperature.clutterText.ellipsize = Pango.EllipsizeMode.NONE;

        this.titles.add(this.titleCPU, { x_fill: false, x_align: ST_ALIGNMENT[this.title_align] });
        this.titles.add(this.titleMemory, { x_fill: false, x_align: ST_ALIGNMENT[this.title_align] });
        this.titles.add(this.titleDownload, { x_fill: false, x_align: ST_ALIGNMENT[this.title_align] });
        this.titles.add(this.titleUpload, { x_fill: false, x_align: ST_ALIGNMENT[this.title_align] });
        this.titles.add(this.titleTemperature, { x_fill: false, x_align: ST_ALIGNMENT[this.title_align] });

        this.valueCPU = new St.Label({ text: "0%", style_class: "value" });
        this.valueCPU.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.valueMemory = new St.Label({ text: "0 GB", style_class: "value" });
        this.valueMemory.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.valueDownload = new St.Label({ text: "0 B", style_class: "value" });
        this.valueDownload.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.valueUpload = new St.Label({ text: "0 B", style_class: "value" });
        this.valueUpload.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.valueTemperature = new St.Label({ text: "0°C", style_class: "value" });
        this.valueTemperature.clutterText.ellipsize = Pango.EllipsizeMode.NONE;

        this.values.add(this.valueCPU, { x_fill: false, x_align: ST_ALIGNMENT[this.value_align] });
        this.values.add(this.valueMemory, { x_fill: false, x_align: ST_ALIGNMENT[this.value_align] });
        this.values.add(this.valueDownload, { x_fill: false, x_align: ST_ALIGNMENT[this.value_align] });
        this.values.add(this.valueUpload, { x_fill: false, x_align: ST_ALIGNMENT[this.value_align] });
        this.values.add(this.valueTemperature, { x_fill: false, x_align: ST_ALIGNMENT[this.value_align] });

        if (this.display_gpu) {
            this.titleTemperatureGPU = new St.Label({ text: _("GPU:"), style_class: "title" });
            this.titleTemperatureGPU.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
            this.titles.add(this.titleTemperatureGPU, { x_fill: false, x_align: ST_ALIGNMENT[this.title_align] });
            this.valueTemperatureGPU = new St.Label({ text: "0°C", style_class: "value" });
            this.valueTemperatureGPU.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
            this.values.add(this.valueTemperatureGPU, { x_fill: false, x_align: ST_ALIGNMENT[this.value_align] });
        }

        this.font_family = this.font_family.replace(/['"`]/g, "");
        this.font = this.font_family !== "" ? `font-family: '${this.font_family}';` : "";
        this.titles.style = `color: ${this.font_color}; font-size: ${this.font_scale_size}em; ${this.font}`;
        this.values.style = `color: ${this.font_color}; font-size: ${this.font_scale_size}em; padding-left: 5px; ${this.font}`;
        this.mainContainer.add(this.titles);
        this.mainContainer.add(this.values);

        if (this.show_decorations)
            this.mainContainer.style = `background-color: ${this.background_color}; ${this.mainContainer.style}`;
        this.mainContainer.style = `width: ${this.width}px; ${this.mainContainer.style}`;
        this.setContent(this.mainContainer);

        // Left blank, each sensor is detected from the hardware. Hardcoding
        // thermal_zone0 here was what made the GPU row echo the CPU row.
        this._gpuTick = 0;
        this.cpu = new CPU();
        this.memory = new Memory();
        this.net = new Net();
        this.thermal = new Thermal(this.customCPUPath, this.temp_units);
        if (this.display_gpu)
            this.thermalGPU = new ThermalGPU(this.customGPUPath, this.temp_units);
        this._updateWidget();
    },

    on_desklet_removed: function () {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._decorationsSignalId) {
            global.settings.disconnect(this._decorationsSignalId);
            this._decorationsSignalId = null;
        }
    },

    _updateWidget: function () {
        this._updateValues();

        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
        }

        this._timeoutId = Mainloop.timeout_add(this._refreshIntervalMs(), () => this._updateWidget());
    },

    _refreshIntervalMs: function () {
        let interval = Math.round(this.refresh_interval * 1000);
        if (!isFinite(interval))
            return DEFAULT_REFRESH_INTERVAL_MS;
        return Math.max(MIN_REFRESH_INTERVAL_MS, Math.min(MAX_REFRESH_INTERVAL_MS, interval));
    },

    _updateValues: function () {
        this.cpu.refresh();
        this.memory.refresh();
        this.thermal.refresh();
        this.net.refresh();
        if (this.display_gpu) {
            if (this._gpuTick <= 0) {
                this.thermalGPU.refresh();
                this._gpuTick = Math.max(1, Math.round(GPU_MIN_REFRESH_MS / this._refreshIntervalMs()));
            }
            this._gpuTick--;
            this.valueTemperatureGPU.text = this.thermalGPU.info;
        }
        this.valueCPU.text = `${this.cpu.used}%`;
        this.valueMemory.text = `${this.memory.used} GB`;
        this.valueDownload.text = this.net.downloadSpeed;
        this.valueUpload.text = this.net.uploadSpeed;
        this.valueTemperature.text = this.thermal.info;
    },

    on_font_setting_changed: function () {
        this.font_family = this.font_family.replace(/['"`]/g, "");
        let argv = GLib.shell_parse_argv(`fc-list -q "${this.font_family}"`)[1];
        try {
            let subprocess = Gio.Subprocess.new(argv, Gio.SubprocessFlags.None);
            subprocess.communicate_utf8_async(null, null, (subprocess, result) => {
                try {
                    subprocess.communicate_utf8_finish(result);
                    let status = subprocess.get_exit_status();
                    if (status === 0) {
                        this.font = this.font_family !== "" ? `font-family: '${this.font_family}';` : "";
                    } else {
                        this.font_family = "";
                        this.font = "";
                    }
                } catch (e) {
                    global.logError(e);
                } finally {
                    this.titles.style = `color: ${this.font_color}; font-size: ${this.font_scale_size}em; ${this.font}`;
                    this.values.style = `color: ${this.font_color}; font-size: ${this.font_scale_size}em; padding-left: 5px; ${this.font}`;
                }
            });
        } catch (e) {
            global.logError(e);
        }
    }
}

function ErrorDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

ErrorDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.mainContainer = new St.BoxLayout();
        this.errorMessage = new St.Label({ text: MISSING_DEPENDENCIES });
        this.errorMessage.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.mainContainer.add(this.errorMessage);
        this.setContent(this.mainContainer);
    }
};

function main(metadata, desklet_id) {
    if (missingDependencies)
        return new ErrorDesklet(metadata, desklet_id);
    else
        return new MyDesklet(metadata, desklet_id);
}
