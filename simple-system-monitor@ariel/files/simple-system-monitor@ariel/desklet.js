const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Cinnamon = imports.gi.Cinnamon;

let missingDependencies = false;

try {
    const NMClient = imports.gi.NMClient;
    const NetworkManager = imports.gi.NetworkManager;
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
libgtop, Network Manager and gir bindings \n\
\t    on Ubuntu: gir1.2-gtop-2.0, gir1.2-networkmanager-1.0 \n\
\t    on Fedora: libgtop2-devel, NetworkManager-glib-devel \n\
\t    on Arch: libgtop, networkmanager\n\
and restart Cinnamon.\n");

CPU = function () {
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

	    this.used = Math.round((user + sys + iowait) * 100 / total);
		this.total = this.gtop.total;
		this.user = this.gtop.user;
		this.sys = this.gtop.sys;
		this.iowait = this.gtop.iowait;
	}	
}

Memory = function () {
    this._init.apply(this, arguments);
};

Memory.prototype = {
	_init: function() {
        this.gtop = new GTop.glibtop_mem();
	},
	
	refresh: function() {
        GTop.glibtop_get_mem(this.gtop);		
		this.used = Math.round(this.gtop.user / 1024 / 1024 / 1024 * 100) / 100;
		this.usedPercentaje = Math.round(this.gtop.user * 100 / this.gtop.total);
	}	
}

Thermal = function() {
    this._init.apply(this, arguments);
};

Thermal.prototype = {
    _init: function(sensorFile) {
		this.file = sensorFile;
	},

	refresh: function() {
        if(GLib.file_test(this.file, 1<<4)){
            let t_str = Cinnamon.get_file_contents_utf8_sync(this.file).split("\n")[0];
            this.temperature = parseInt(t_str) / 1000;
        }            
        else 
            global.logError("error reading: " + this.file);
    }
}

FanSpeed = function() {
    this._init.apply(this, arguments);
};

FanSpeed.prototype = {
    _init: function(sensorFile) {
		this.file = sensorFile;
	},

	refresh: function() {
        if(GLib.file_test(this.file, 1<<4)){
            let t_str = Cinnamon.get_file_contents_utf8_sync(this.file).split("\n")[0];
            this.rpm = parseInt(t_str);
        }            
        else 
            global.logError("error reading: " + this.file);
    }
}



Net = function () {
    this._init.apply(this, arguments);
};

Net.prototype = {
	_init: function() {
        this.connections = [];
        this.client = NMClient.Client.new();
		this.update_connections();

        if (!this.connections.length){
            let net_lines = Cinnamon.get_file_contents_utf8_sync('/proc/net/dev').split("\n");
            for (let i = 3; i < net_lines.length - 1 ; i++) {
                let connection = net_lines[i].replace(/^\s+/g, '').split(":")[0];
                if(Cinnamon.get_file_contents_utf8_sync('/sys/class/net/' + ifc + '/operstate')
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
            global.logError("Please install Network Manager GObject Introspection Bindings");
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
                if (connection_list[j].state == NetworkManager.DeviceState.ACTIVATED){
                   this.connections.push(connection_list[j].get_ip_iface());
                }
            }
        }
        catch(e) {
            global.logError("Please install Network Manager GObject Introspection Bindings");
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
		
		this.downloadSpeed = this.downloadSpeed < 1024 ? this.downloadSpeed + "KB" : 
			Math.round(this.downloadSpeed / 1024 * 100) / 100 + "MB"; 
		
		this.uploadSpeed = this.uploadSpeed < 1024 ? this.uploadSpeed + "KB" : 
			Math.round(this.uploadSpeed / 1024 * 100) / 100 + "MB"; 

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

		this.titleCPU = new St.Label({text: "CPU:", style_class: "title"});
		this.titleMemory = new St.Label({text: "Memory:", style_class: "title"});
		this.titleDownload = new St.Label({text: "Download:", style_class: "title"});
		this.titleUpload = new St.Label({text: "Upload:", style_class: "title"});
		this.titleTemperature = new St.Label({text: "Temperature:", style_class: "title"});
		this.titleFanSpeed = new St.Label({text: "Fan:", style_class: "title"});

		this.titles.add(this.titleCPU);
		this.titles.add(this.titleMemory);
		this.titles.add(this.titleDownload);
		this.titles.add(this.titleUpload);
		this.titles.add(this.titleTemperature);
		this.titles.add(this.titleFanSpeed);

		this.valueCPU = new St.Label({text: "0%", style_class: "value"});
		this.valueMemory = new St.Label({text: "0GB", style_class: "value"});
		this.valueDownload = new St.Label({text: "0B", style_class: "value"});
		this.valueUpload = new St.Label({text: "0B", style_class: "value"});
		this.valueTemperature = new St.Label({text: "0°C", style_class: "value"});
		this.valueFanSpeed = new St.Label({text: "0RPM", style_class: "value"});

		this.values.add(this.valueCPU);
		this.values.add(this.valueMemory);
		this.values.add(this.valueDownload);
		this.values.add(this.valueUpload);
		this.values.add(this.valueTemperature);
		this.values.add(this.valueFanSpeed);
		
		this.mainContainer.add(this.titles);
		this.mainContainer.add(this.values);
	
        this.setContent(this.mainContainer);

		this.cpu = new CPU();
		this.memory = new Memory();
		this.net = new Net();
		this.thermal = new Thermal(this.metadata["thermal-file"]);
		this.fanSpeed = new FanSpeed(this.metadata["fan-speed-file"]);
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
		this.fanSpeed.refresh();
		this.valueCPU.text = this.cpu.used + "%";
		this.valueMemory.text = this.memory.used + "GB";
		this.valueDownload.text = this.net.downloadSpeed;
		this.valueUpload.text = this.net.uploadSpeed;
		this.valueTemperature.text = this.thermal.temperature + "°C";
		this.valueFanSpeed.text = this.fanSpeed.rpm + "RPM";
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
