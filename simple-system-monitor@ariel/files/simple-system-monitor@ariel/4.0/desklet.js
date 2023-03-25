const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Cinnamon = imports.gi.Cinnamon;
const Gettext = imports.gettext;
const UUID = "simple-system-monitor@ariel";
const GTop = imports.gi.GTop;
const NM = imports.gi.NM;

// l10n/translation support
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

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
	_init: function() {
        this.gtop = new GTop.glibtop_cpu();
		this.total = this.gtop.total;
		this.user = this.gtop.user;
		this.sys = this.gtop.sys;
		this.iowait = this.gtop.iowait;
	},

	refresh: function() {
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
	_init: function() {
        this.gtop = new GTop.glibtop_mem();
	},

	refresh: function() {
        GTop.glibtop_get_mem(this.gtop);
		this.used = (Math.round(this.gtop.user / 1024 / 1024 / 1024 * 100) / 100).toFixed(2);
		/* this.usedPercentaje = Math.round(this.gtop.user * 100 / this.gtop.total); */
	}
}

const Thermal = function() {
    this._init.apply(this, arguments);
};

Thermal.prototype = {
    _init: function(sensorFile) {
		this.file = sensorFile;
        this.degrees = 0;
        this.info = "N/A";

	},

	refresh: function() {
        if(GLib.file_test(this.file, 1<<4)){
            let t_str = Cinnamon.get_file_contents_utf8_sync(this.file).split("\n")[0];
            this.degrees = parseInt(t_str) / 1000;
            this.info = (this.degrees).toFixed(1) + " °C";
        }
        else
            global.logError("error reading: " + this.file);
    }
}

const ThermalGPU = function() {
    this._init.apply(this, arguments);
};

ThermalGPU.prototype = {
    _init: function(sensorFileGPU) {
		this.file = sensorFileGPU;
        this.degrees = 0;
        this.info = "N/A";

	},

	refresh: function() {
        if(GLib.file_test(this.file, 1<<4)){
            let t_str = Cinnamon.get_file_contents_utf8_sync(this.file).split("\n")[0];
            this.degrees = parseInt(t_str) / 1000;
            this.info = (this.degrees).toFixed(1) + " °C";
        }
        else
            global.logError("error reading: " + this.file);
    }
}

const Net = function () {
    this._init.apply(this, arguments);
};

Net.prototype = {
	_init: function() {
        this.connections = [];
        this.client = NM.Client.new(null);
		this.update_connections();

        if (!this.connections.length){
            let net_lines = Cinnamon.get_file_contents_utf8_sync('/proc/net/dev').split("\n");
            for (let i = 3; i < net_lines.length - 1 ; i++) {
                let connection = net_lines[i].replace(/^\s+/g, '').split(":")[0];
                if(Cinnamon.get_file_contents_utf8_sync('/sys/class/net/' + connection + '/operstate')
                .replace(/\s/g, "") == "up" &&
                connection.indexOf("br") < 0 &&
                connection.indexOf("lo") < 0) {
                	this.connections.push(connection);
                }
            }
        }

        this.gtop = new GTop.glibtop_netload();

		try {
            let connection_list = this.client.get_devices();
            this.NMsigID = []
            for (let j = 0; j < connection_list.length; j++){
                this.NMsigID[j] = connection_list[j].connect('state-changed', Lang.bind(this, this.update_connections));
            }
        }
        catch(e) {
            global.logError("Please install Missing Dependencies");
        }

        this.totalDownloaded = 0;
        this.totalUploaded = 0;
        this.lastRefresh = 0;
	},

	update_connections: function() {
        try {
            this.connections = []
            let connection_list = this.client.get_devices();
            for (let j = 0; j < connection_list.length; j++){
                if (connection_list[j].state == NM.DeviceState.ACTIVATED){
                   this.connections.push(connection_list[j].get_ip_iface());
                }
            }
        }
        catch(e) {
            global.logError("Please install Missing Dependencies");
        }
    },

	refresh: function() {
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

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
		this.metadata = metadata;
        this.setupUI();
    },

    setupUI: function() {
		this.mainContainer = new St.BoxLayout({style_class: "mainContainer"});

		this.titles = new St.BoxLayout({vertical: true});
		this.values = new St.BoxLayout({vertical: true});

		this.titleCPU = new St.Label({text: _("CPU:"), style_class: "title"});
		this.titleMemory = new St.Label({text: _("Memory:"), style_class: "title"});
		this.titleDownload = new St.Label({text: _("Download:"), style_class: "title"});
		this.titleUpload = new St.Label({text: _("Upload:"), style_class: "title"});
		this.titleTemperature = new St.Label({text: _("Temperature:"), style_class: "title"});
		this.titleTemperatureGPU = new St.Label({text: _("GPU:"), style_class: "title"});

		this.titles.add(this.titleCPU);
		this.titles.add(this.titleMemory);
		this.titles.add(this.titleDownload);
		this.titles.add(this.titleUpload);
		this.titles.add(this.titleTemperature);
		this.titles.add(this.titleTemperatureGPU);

		this.valueCPU = new St.Label({text: "0 %", style_class: "value"});
		this.valueMemory = new St.Label({text: "0 GB", style_class: "value"});
		this.valueDownload = new St.Label({text: "0 B", style_class: "value"});
		this.valueUpload = new St.Label({text: "0 B", style_class: "value"});
		this.valueTemperature = new St.Label({text: "0 °C", style_class: "value"});
		this.valueTemperatureGPU = new St.Label({text: "0 °C", style_class: "value"});

		this.values.add(this.valueCPU);
		this.values.add(this.valueMemory);
		this.values.add(this.valueDownload);
		this.values.add(this.valueUpload);
		this.values.add(this.valueTemperature);
		this.values.add(this.valueTemperatureGPU);

		this.mainContainer.add(this.titles);
		this.mainContainer.add(this.values);

        this.setContent(this.mainContainer);

		this.cpu = new CPU();
		this.memory = new Memory();
		this.net = new Net();
		this.thermal = new Thermal(this.metadata["thermal-file"]);
		this.thermalGPU = new ThermalGPU(this.metadata["thermal-file-gpu"]);
		this._updateWidget();
    },

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	},

	_updateWidget: function(){
        this._updateValues();
		this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateWidget));
	},

	_updateValues: function(){
		this.cpu.refresh();
		this.memory.refresh();
		this.thermal.refresh();
		this.net.refresh();
		this.thermalGPU.refresh();
		this.valueCPU.text = this.cpu.used + " %";
		this.valueMemory.text = this.memory.used + " GB";
		this.valueDownload.text = this.net.downloadSpeed;
		this.valueUpload.text = this.net.uploadSpeed;
		this.valueTemperature.text = this.thermal.info;
		this.valueTemperatureGPU.text = this.thermalGPU.info;
	}
}

function ErrorDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

ErrorDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.mainContainer = new St.BoxLayout();
		this.errorMessage = new St.Label({text: MISSING_DEPENDENCIES});
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
/*
# Changelog 
## Version 1.0.0
  * Institute changelog - currently only in desklet.js
  * Changes for Cinnamon 4.0 and higher to avoid segfaults when old Network Manager Library is no longer available by using multiversion with folder 4.0
    * Comment out or delete all references to NetworkManager
    * Replace calls to NetworkManager with equivalent calls to NM
    * Change logError messages to not reference NetworkManager  
*/
