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

let missingDependencies = false;

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
        this.total = this.gtop.total;
        this.user = this.gtop.user;
        this.sys = this.gtop.sys;
        this.iowait = this.gtop.iowait;
    },

    refresh: function () {
        GTop.glibtop_get_cpu(this.gtop);

        let total = this.gtop.total - this.total;
        let user = this.gtop.user - this.user;
        let sys = this.gtop.sys - this.sys;
        let iowait = this.gtop.iowait - this.iowait;

        this.used = ((user + sys + iowait) * 100 / total).toFixed(2);
        this.total = this.gtop.total;
        this.user = this.gtop.user;
        this.sys = this.gtop.sys;
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
        this.cpuPath = cpuPath.substring(cpuPath.lastIndexOf('//') + 1);
        this.tempUnits = cpuUnits;
        this.cpuDegrees = 0;
        this.info = "N/A";
    },

    refresh: function () {
        if (GLib.file_test(this.cpuPath, GLib.FileTest.EXISTS)
            && GLib.file_test(this.cpuPath, GLib.FileTest.IS_DIR)) {
            if (GLib.file_test(this.cpuPath + '/temp', GLib.FileTest.EXISTS))
                this.cpuFile = this.cpuPath + '/temp';
            else {
                global.log(_("No temp file detected at CPU path. Resetting to default."));
                this.cpuFile = '/sys/class/thermal/thermal_zone0/temp';
            }
        } else {
            global.log(_("Invalid CPU path detected. Resetting to default."));
            this.cpuFile = '/sys/class/thermal/thermal_zone0/temp';
        }
        if (GLib.file_test(this.cpuFile, GLib.FileTest.EXISTS)) {
            let tempValue = GLib.file_get_contents(this.cpuFile)[1];
            let tempString = ByteArray.toString(tempValue);
            this.cpuDegrees = parseInt(tempString) / 1000;
            this.temp_string = "\u00b0C";
            if (this.tempUnits == "fahrenheit") {
                this.temp_string = "\u00b0F";
                this.cpuDegrees = (this.cpuDegrees * 1.8) + 32;
            }
            this.info = (this.cpuDegrees).toFixed(1) + this.temp_string;
        }
        else
            global.logError(_("error reading:") + ` ${this.cpuFile}`);
    }
}

const ThermalGPU = function () {
    this._init.apply(this, arguments);
};

ThermalGPU.prototype = {
    _init: function (gpuPath, gpuUnits) {
        this.gpuPath = gpuPath.substring(gpuPath.lastIndexOf('//') + 1);
        this.tempUnits = gpuUnits;
        this.gpuDegrees = 0;
        this.info = "N/A";
    },

    refresh: function () {
        if (GLib.file_test(this.gpuPath, GLib.FileTest.EXISTS)
            && GLib.file_test(this.gpuPath, GLib.FileTest.IS_DIR)) {
            if (GLib.file_test(this.gpuPath + '/temp', GLib.FileTest.EXISTS))
                this.gpuFile = this.gpuPath + '/temp';
            else {
                global.log(_("No temp file detected at GPU path. Resetting to default."));
                this.gpuFile = '/sys/class/thermal/thermal_zone0/temp';
            }
        } else {
            global.log(_("Invalid GPU path detected. Resetting to default."));
            this.gpuFile = '/sys/class/thermal/thermal_zone0/temp';
        }
        if (GLib.file_test(this.gpuFile, GLib.FileTest.EXISTS)) {
            let tempValue = GLib.file_get_contents(this.gpuFile)[1];
            let tempString = ByteArray.toString(tempValue);
            this.gpuDegrees = parseInt(tempString) / 1000;
            this.temp_string = "\u00b0C";
            if (this.tempUnits == "fahrenheit") {
                this.temp_string = "\u00b0F";
                this.gpuDegrees = (this.gpuDegrees * 1.8) + 32;
            }
            this.info = (this.gpuDegrees).toFixed(1) + this.temp_string;
        }
        else
            global.logError(_("error reading:") + ` ${this.gpuFile}`);
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
            let net_file = GLib.file_get_contents('/proc/net/dev')[1];
            let net_lines = ByteArray.toString(net_file).split("\n");
            for (let i = 3; i < net_lines.length - 1; i++) {
                let connection = net_lines[i].replace(/^\s+/g, '').split(":")[0];
                let operstate = GLib.file_get_contents(`/sys/class/net/${connection}/operstate`)[1];
                if (ByteArray.toString(operstate).replace(/\s/g, "") == "up" &&
                    connection.indexOf("br") < 0 &&
                    connection.indexOf("lo") < 0) {
                    this.connections.push(connection);
                }
            }
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
            this.connections = [];
            let connection_list = this.client.get_devices();
            for (let j = 0; j < connection_list.length; j++) {
                if (connection_list[j].state == NM.DeviceState.ACTIVATED)
                    this.connections.push(connection_list[j].get_ip_iface());
            }
        }
        catch (e) {
            global.logError(_("Please install missing dependencies."));
        }
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
        let delta = time - this.lastRefresh;

        this.downloadSpeed = delta > 0 ? Math.round((totalDownloaded - this.totalDownloaded) / delta) : 0;
        this.uploadSpeed = delta > 0 ? Math.round((totalUploaded - this.totalUploaded) / delta) : 0;

        this.downloadSpeed = this.downloadSpeed < 1024 ? this.downloadSpeed + " KB" :
            (Math.round(this.downloadSpeed / 1024 * 100) / 100).toFixed(1) + " MB";

        this.uploadSpeed = this.uploadSpeed < 1024 ? this.uploadSpeed + " KB" :
            (Math.round(this.uploadSpeed / 1024 * 100) / 100).toFixed(1) + " MB";

        this.totalDownloaded = totalDownloaded;
        this.totalUploaded = totalUploaded;
        this.lastRefresh = time;
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
        this.setupUI();
    },

    setupUI: function () {
        this.settings = new Settings.DeskletSettings(this, UUID, this.desklet_id);
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
        // refresh style on change of global desklet setting for decorations
        global.settings.connect('changed::desklet-decorations', Lang.bind(this, this.setupUI));

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

        if (!this.customCPUPath)
            this.customCPUPath = '/sys/class/thermal/thermal_zone0';
        if (!this.customGPUPath)
            this.customGPUPath = '/sys/class/thermal/thermal_zone0';

        this.cpu = new CPU();
        this.memory = new Memory();
        this.net = new Net();
        this.thermal = new Thermal(this.customCPUPath, this.temp_units);
        if (this.display_gpu)
            this.thermalGPU = new ThermalGPU(this.customGPUPath, this.temp_units);
        this._updateWidget();
    },

    on_desklet_removed: function () {
        Mainloop.source_remove(this.timeout);
    },

    _updateWidget: function () {
        this._updateValues();
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateWidget));
    },

    _updateValues: function () {
        this.cpu.refresh();
        this.memory.refresh();
        this.thermal.refresh();
        this.net.refresh();
        if (this.display_gpu) {
            this.thermalGPU.refresh();
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
