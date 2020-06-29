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
const Gio = imports.gi.Gio;

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
		this.currentState = "";
		this.currentError = -1;
		this.lastCapacity = -1;
		this.lastState = "";
		this.lastError = -1;

		// load images and set initial sizes
		this.refreshDesklet(true);

		// set root element
		this.setContent(this.battery);

		// set decoration settings
		this.refreshDecoration();

		// start update cycle
		this.update();
	},

	update: function() {
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
		// remove "file://" from path
		let result_devfile_capacity = decodeURIComponent(this.devfile_capacity.replace("file://", ""));
		let result_devfile_status = decodeURIComponent(this.devfile_status.replace("file://", ""));

		// auto detect device files if settings were not set
		if(result_devfile_capacity == "") {
			// iterate trough default devfiles ...
			for(let i in default_devfiles_capacity) {
				// ... and check if it exists
				if(GLib.file_test(default_devfiles_capacity[i], GLib.FileTest.EXISTS)
				&&(!GLib.file_test(default_devfiles_capacity[i], GLib.FileTest.IS_DIR))) {
					result_devfile_capacity = default_devfiles_capacity[i];
					break;
				}
			}
		}
		if(result_devfile_status == "") {
			// iterate trough default devfiles ...
			for(let i in default_devfiles_status) {
				// ... and check if it exists
				if(GLib.file_test(default_devfiles_status[i], GLib.FileTest.EXISTS)
				&&(!GLib.file_test(default_devfiles_status[i], GLib.FileTest.IS_DIR))) {
					result_devfile_status = default_devfiles_status[i];
					break;
				}
			}
		}

		//Main.notifyError(result_devfile_capacity, result_devfile_status); // debug

		// get current battery/power supply values
		this.currentError = 0;
		try {
			// read capacity file async
			let file_capacity = Gio.file_new_for_path(result_devfile_capacity);
			file_capacity.load_contents_async(null, (file, response) => {
				try {
					let [success, contents, tag] = file.load_contents_finish(response);
					if(success) {
						this.currentCapacity = parseInt(contents.toString());
						// fix for some batteries reporting values higher than 100
						if(this.currentCapacity > 100) this.currentCapacity = 100;
					}
					GLib.free(contents);
				} catch(err) {
					this.currentError = 1;
				}
				this.refreshDesklet();
			});
			// read status file async
			let file_status = Gio.file_new_for_path(result_devfile_status);
			file_status.load_contents_async(null, (file, response) => {
				try {
					let [success, contents, tag] = file.load_contents_finish(response);
					if(success) {
						this.currentState = contents.toString().trim();
					}
					GLib.free(contents);
				} catch(err) {
					this.currentError = 1;
				}
				this.refreshDesklet();
			});
		} catch(ex) {
			// maybe the file does not exist because the battery was removed
			this.currentError = 1;
			this.refreshDesklet();
		}

		// update again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this.update));
	},

	refreshDesklet: function(forceRefresh = false) {
		// only execute refresh if ...
		if(this.lastCapacity != this.currentCapacity // ... capacity has changed
			|| this.lastState != this.currentState // ... state has changed
			|| this.lastError != this.currentError // ... error has changed
			|| forceRefresh // ... it is a forced refresh
		) {

			// set label text to current capacity
			let currentCapacityText = this.currentCapacity.toString() + "%";

			// icon or label visibility decision
			let symbol = "warn";
			let showText = false;
			if(this.currentError == 1) {
				// error: warning icon and no label
				symbol = "warn";
				showText = false;
				this.currentCapacity = 0;
				this.currentState = "";
			} else {
				if(this.currentState == "Charging" && this.showplug) {
					// power supply online, charging and icon should be shown
					symbol = "flash";
					showText = false;
				} else if((this.currentState == "Not charging" || this.currentState == "Full" || this.currentState == "Unknown") && this.showplug) {
					// power supply online, not charging (full) and icon should be shown
					symbol = "plug";
					showText = false;
				} else if(this.showpercent) {
					// power supply offline (= discharging) and capacity should be shown
					symbol = "";
					showText = true; // text visible
				} else if(!this.showpercent) {
					// power supply offline (= discharging) and capacity should not be shown
					symbol = "";
					showText = false;
				} else {
					// Unknown state
					symbol = "warn";
					showText = false;
				}
			}

			// calc new sizes based on scale factor
			let scale = this.scale_size * global.ui_scale;
			let newFontSizeRounded = Math.round(this.default_size_font * this.scale_size);
			let newFontSize = this.default_size_font * this.scale_size;
			let batteryWidth = this.default_size_battery_width * scale;
			let batteryHeight = this.default_size_battery_height * scale;
			let segmentHeight = batteryHeight * this.segment_size_factor;
			let segmentWidth = batteryWidth * this.segment_size_factor;
			let segmentTop = 5 * scale;
			let segmentLeft = 10 * scale;
			let symbolSize = this.default_size_symbol * scale;
			let segmentWidthMax = segmentWidth * 0.95;
			let segmentWidthCalced = segmentWidthMax * (this.currentCapacity / 100);

			// set images
			let bar_img = "green.svg";
			if(this.currentCapacity == 0) bar_img = "none.svg";
			else if(this.currentCapacity <= 20) bar_img = "red.svg";

			let symbol_img = "";
			if(symbol == "warn") symbol_img = "warn.svg";
			else if(symbol == "plug") symbol_img = "plug.svg";
			else if(symbol == "flash") symbol_img = "flash.svg";

			if(this.bg_img == "")
				this.bg_img = "bg_transparent.svg";

			// create battery background
			this.battery = getImageAtScale(DESKLET_ROOT + "/img/" + this.bg_img, batteryWidth, batteryHeight);

			// create segment = variable width bar (indicates capacity)
			this.segment = getImageAtScale(DESKLET_ROOT + "/img/" + bar_img, segmentWidth, segmentHeight, segmentWidthCalced, segmentHeight);
			this.segment.set_position(segmentLeft, segmentTop);

			// container for subelements (icon, label)
			this.container = new St.Group();

			// plug/warn/flash icon
			if(symbol_img != "") {
				this.imageIcon = getImageAtScale(DESKLET_ROOT + "/img/" + symbol_img, symbolSize, symbolSize);
				this.imageIcon.set_position((segmentWidth / 2) - (symbolSize / 2), (segmentHeight / 2) - (symbolSize / 2));
			}

			// label for percent string
			this.labelText = new St.Label({style_class:"text"});
			this.labelText.set_position((segmentWidth / 2) - ((newFontSize * global.ui_scale * currentCapacityText.length / 1.25) / 2), (segmentHeight / 2) - (newFontSize * global.ui_scale / 1.7));
			this.labelText.style = "font-size: " + newFontSizeRounded.toString() + "px;";
			if(showText)
				this.labelText.set_text(currentCapacityText);
			else
				this.labelText.set_text("");

			// add actor
			this.battery.remove_all_children();
			this.battery.add_actor(this.segment);
			this.segment.add_actor(this.container);
			if(symbol_img != "")
				this.container.add_actor(this.imageIcon);
			this.container.add_actor(this.labelText);
			this.setContent(this.battery);

			// set last states
			this.lastCapacity = this.currentCapacity;
			this.lastState = this.currentState;
			this.lastError = this.currentError;
		}
	},

	refreshDecoration: function() {
		// desklet label (header)
		if(this.use_custom_label)
			this.setHeader(this.custom_label)
		else
			this.setHeader(_("Battery"));

		// prevent decorations?
		this.metadata["prevent-decorations"] = this.hide_decorations;
		this._updateDecoration();
	},

	on_setting_changed: function() {
		// update decoration settings and refresh desklet content
		this.refreshDecoration();
		this.refreshDesklet(true);
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
