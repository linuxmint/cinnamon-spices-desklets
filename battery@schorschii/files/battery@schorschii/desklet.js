const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["battery@schorschii"].path;


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


MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata);

		// initialize settings
		this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "devfile_capacity", "devfile_capacity", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "devfile_status", "devfile_status", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "showpercent", "showpercent", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "showplug", "showplug", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "bg-img", "bg_img", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// defaults and initial values
		this.default_size_font = 25;
		this.default_size_battery_width = 149;
		this.default_size_battery_height = 74;
		this.default_size_symbol = 36;
		this.default_segment_offset = 14;
		this.segment_size_factor = 0.875;
		this.currentCapacity = 0;
		this.currentCapacity_text = "";
		this.symbol = "";
		this.show_text = true;
		this.lastCapacity = this.currentCapacity;
		this.lastSymbol = this.symbol;

		// load images and set initial sizes
		this.refreshSize(true);

		// set root eleent
		this.setContent(this.battery);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
		this.refresh();
	},

	refresh: function() {
		// default device files
		let default_devfiles_capacity = ['/sys/class/power_supply/CMB0/capacity',
		                                 '/sys/class/power_supply/CMB1/capacity',
		                                 '/sys/class/power_supply/BAT0/capacity',
		                                 '/sys/class/power_supply/BAT1/capacity',
		                                 '/sys/class/power_supply/BAT2/capacity'];
		let default_devfiles_status = ['/sys/class/power_supply/CMB0/status',
		                               '/sys/class/power_supply/CMB1/status',
		                               '/sys/class/power_supply/BAT0/status',
		                               '/sys/class/power_supply/BAT1/status',
		                               '/sys/class/power_supply/BAT2/status'];

		// get device files from settings
		// remove "file://" because it's not supported by Cinnamon.get_file_contents_utf8_sync()
		let result_devfile_capacity = this.devfile_capacity.replace("file://", "");
		let result_devfile_status = this.devfile_status.replace("file://", "");

		// auto detect device files if settings were not set
		if (result_devfile_capacity == "") {
			// iterate trough default devfiles ...
			for (let i in default_devfiles_capacity) {
				// ... and check if it exists
				if (GLib.file_test(default_devfiles_capacity[i], GLib.FileTest.EXISTS) &&
				   (!GLib.file_test(default_devfiles_capacity[i], GLib.FileTest.IS_DIR))) {
					result_devfile_capacity = default_devfiles_capacity[i];
					break;
				}
			}
		}
		if (result_devfile_status == "") {
			// iterate trough default devfiles ...
			for (let i in default_devfiles_status) {
				// ... and check if it exists
				if (GLib.file_test(default_devfiles_status[i], GLib.FileTest.EXISTS) &&
				   (!GLib.file_test(default_devfiles_status[i], GLib.FileTest.IS_DIR))) {
					result_devfile_status = default_devfiles_status[i];
					break;
				}
			}
		}

		// debug
		//Main.notifyError(result_devfile_capacity, result_devfile_status);

		// get current battery/power supply values
		this.currentCapacity = 0;
		let currentState = "";
		let currentError = 0;
		try {
			// read device files
			this.currentCapacity = parseInt(Cinnamon.get_file_contents_utf8_sync(result_devfile_capacity));
			if (this.currentCapacity > 100) this.currentCapacity = 100; // fix for some batteries reporting values higher than 100
			currentState = Cinnamon.get_file_contents_utf8_sync(result_devfile_status).trim();
		} catch(ex) {
			// maybe the file does not exist because the battery was removed
			currentError = 1;
		}

		// set label text to current capacity
		this.currentCapacity_text = this.currentCapacity.toString() + "%";

		// icon or label visibility decision
		if (currentError == 1) {
			// error: warning icon and no label
			this.symbol = "warn";
			this.show_text = false;
		} else {
			if (currentState == "Charging" && this.showplug == true) {
				// power supply online, charging and icon should be shown
				this.symbol = "flash";
				this.show_text = false;
			} else if ((currentState == "Not charging" || currentState == "Full" || currentState == "Unknown") && this.showplug == true) {
				// power supply online, not charging (full) and icon should be shown
				this.symbol = "plug";
				this.show_text = false;
			} else if (this.showpercent == true) {
				// power supply offline (= discharging) and capacity should be shown
				this.symbol = "";
				this.show_text = true; // text visible
			} else if (this.showpercent == false) {
				// power supply offline (= discharging) and capacity should not be shown
				this.symbol = "";
				this.show_text = false;
			} else {
				// Unknown state
				this.symbol = "warn";
				this.show_text = false;
			}
		}

		// set object sizes without recalc
		this.refreshSize();

		// refresh again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this.refresh));
	},

	refreshSize: function(forceRefresh = false) {
		// only execute refresh if ...
		if (this.lastCapacity != this.currentCapacity // ... capacity has changed
			|| this.lastSymbol != this.symbol // ... symbol has changed
			|| forceRefresh == true // ... it is a forced refresh
		) {

			// calc new sizes based on scale factor
			this.new_size_font = this.default_size_font * this.scale_size;
			this.battery_width = this.default_size_battery_width * this.scale_size;
			this.battery_height = this.default_size_battery_height * this.scale_size;
			this.segment_height = this.battery_height * this.segment_size_factor;
			this.segment_width = this.battery_width * this.segment_size_factor;
			this.segment_top = 5 * this.scale_size;
			this.segment_left = 10 * this.scale_size;
			this.size_symbol = this.default_size_symbol * this.scale_size;
			this.size_font = this.default_size_font * this.scale_size;
			this.segment_width_max = this.segment_width * 0.95;
			this.segment_width_calced = this.segment_width_max * (this.currentCapacity / 100);

			// set images
			let bar_img = "green.svg";
			if (this.currentCapacity == 0) bar_img = "none.svg";
			else if (this.currentCapacity <= 20) bar_img = "red.svg";

			let symbol_img = "";
			if (this.symbol == "warn")
				symbol_img = "warn.svg";
			else if (this.symbol == "plug")
				symbol_img = "plug.svg";
			else if (this.symbol == "flash")
				symbol_img = "flash.svg";

			if (this.bg_img == "")
				this.bg_img = "bg_transparent.svg";

			// create elements
			this.battery = getImageAtScale(DESKLET_ROOT + "/img/" + this.bg_img, this.battery_width, this.battery_height); // background

			this.segment = getImageAtScale(DESKLET_ROOT + "/img/" + bar_img, this.segment_width, this.segment_height, this.segment_width_calced, this.segment_height); // variable width bar (indicates capacity)
			this.segment.set_position(this.segment_left, this.segment_top);

			this.container = new St.Group(); // container for icon and label

			if (symbol_img != "") {
				this.plug = getImageAtScale(DESKLET_ROOT + "/img/" + symbol_img, this.size_symbol, this.size_symbol); // plug/warn icon
				this.plug.set_position((this.segment_width / 2) - (this.size_symbol / 2), (this.segment_height / 2) - (this.size_symbol / 2));
			}

			this.text = new St.Label({style_class:"text"}); // displays capacity in precent
			this.text.set_position((this.segment_width / 2) - ((this.size_font*this.currentCapacity_text.length/1.5) / 2), (this.segment_height / 2) - ((this.size_font*1) / 2));
			this.text.style = "font-size: " + this.new_size_font.toString() + "px;";
			if (this.show_text == true)
				this.text.set_text(this.currentCapacity_text);
			else
				this.text.set_text("");

			// add actor
			this.battery.remove_all_children();
			this.battery.add_actor(this.segment);
			this.segment.add_actor(this.container);
			if (symbol_img != "")
				this.container.add_actor(this.plug);
			this.container.add_actor(this.text);
			this.setContent(this.battery);

			// set last states
			this.lastCapacity = this.currentCapacity;
			this.lastSymbol = this.symbol;

		}
	},

	refreshDecoration: function() {
		// desklet label (header)
		if (this.use_custom_label == true)
			this.setHeader(this.custom_label)
		else
			this.setHeader(_("Battery"));

		// prevent decorations?
		this.metadata["prevent-decorations"] = this.hide_decorations;
		this._updateDecoration();
	},

	on_setting_changed: function() {
		// update decoration settings
		this.refreshDecoration();

		// settings changed; instant refresh
		Mainloop.source_remove(this.timeout);
		this.refresh();

		// update size based on scale factor
		this.refreshSize(true);
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
