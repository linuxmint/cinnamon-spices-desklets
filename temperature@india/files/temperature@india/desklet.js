const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;

const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["temperature@india"].path;


function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
	return new MyDesklet(metadata, desklet_id);
}

function getImageAtScale(imageFileName, width, height, width2 = 0, height2 = 0) {
	if (width2 == 0 || height2 == 0) {
		width2 = width;
		height2 = height;
	}

	let pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, width, height);
	let image = new Clutter.Image();
	image.set_data(
		pixBuf.get_pixels(),
		pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
		width, height,
		pixBuf.get_rowstride()
	);

	let actor = new Clutter.Actor({width: width2, height: height2});
	actor.set_content(image);

	return actor;
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
            this.info = this.degrees + "°C";
        }
        else
            global.logError("error reading: " + this.file);
    }
}


MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata);
		this.thermal = new Thermal("/sys/devices/virtual/thermal/thermal_zone0/temp");
		this.setupUI();
	},

	setupUI: function() {

		// load images and set initial sizes
		this.refreshDesklet(true);

		// set root element
		this.setContent(this.battery);
		this.setHeader("Thermometer");
		// start update cycle
		this.update();
	},

	update: function() {
		this.thermal.refresh();
		this.refreshDesklet();
		// update again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this.update));
	},

	refreshDesklet: function(forceRefresh = false) {

			// calc new sizes based on scale factor
			let batteryWidth = 50;
			let batteryHeight = 500;
			let segmentHeight = 360;
			let segmentWidth = 3;
			let segmentHeightCalc = segmentHeight * (20+parseInt(this.thermal.info))/120 ;

			// set images
			let bar_img = "mercury.svg";
			this.bg_img = "thermometer.svg";

			// create battery background
			this.battery = getImageAtScale(DESKLET_ROOT + "/img/" + this.bg_img, batteryWidth, batteryHeight);

			// create segment = variable width bar (indicates capacity)
			this.segment = getImageAtScale(DESKLET_ROOT + "/img/" + bar_img, segmentWidth, segmentHeight, segmentWidth, segmentHeightCalc);
			this.segment.set_position(23,40+segmentHeight - segmentHeightCalc);

			// container for subelements (icon, label)
			this.container = new St.Group();


			// label for percent string
			this.labelText = new St.Label({style_class:"text"});
			this.labelText.set_text(parseInt(this.thermal.info)+"°C");
			this.labelText.style = "font-size:10px;"
			this.labelText.set_position(10,510);

			// add actor
			this.battery.remove_all_children();
			this.battery.add_actor(this.segment);
			this.battery.add_actor(this.labelText);
			this.setContent(this.battery);


	},


	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
