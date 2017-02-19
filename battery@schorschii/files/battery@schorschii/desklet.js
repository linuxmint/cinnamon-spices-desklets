const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;

function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
	return new MyDesklet(metadata, desklet_id);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata);

		// initialize settings
		this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
		this.settings.bind("devfile_capacity", "devfile_capacity", this.on_setting_changed);
		this.settings.bind("devfile_status", "devfile_status", this.on_setting_changed);
		this.settings.bind("showpercent", "showpercent", this.on_setting_changed);
		this.settings.bind("showplug", "showplug", this.on_setting_changed);
		this.settings.bind("hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bind("use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bind("custom-label", "custom_label", this.on_setting_changed);
		this.settings.bind("scale-size", "scale_size", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// set default sizes
		this.default_size_font = 24;
		this.default_size_battery_width = 140;
		this.default_size_battery_height = 66;
		this.default_size_symbol = 36;
		this.default_segment_offset = 14;

		// create elements
		this.battery = new St.Bin({style_class: 'battery green'}); // background
		this.segment = new St.Bin({style_class: 'segment'}); // variable width bar (indicates capacity)
		this.container = new St.Group({style_class: 'container'}); // container for icon and label
		this.plug = new St.Bin({style_class: 'plug'}); // plug/warn icon
		this.text = new St.Label({style_class: 'text'}); // displays capacity in precent

		// add actor
		this.battery.add_actor(this.segment);
		this.segment.add_actor(this.container);
		this.container.add_actor(this.plug);
		this.container.add_actor(this.text);

		// set root eleent
		this.setContent(this.battery);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
		this.is_first_refresh = true;
		this.refresh();
	},

	refresh: function() {
		// default device files
		var default_devfiles_capacity = ['/sys/class/power_supply/CMB0/capacity',
		                                 '/sys/class/power_supply/CMB1/capacity',
		                                 '/sys/class/power_supply/BAT0/capacity',
		                                 '/sys/class/power_supply/BAT1/capacity',
		                                 '/sys/class/power_supply/BAT2/capacity'];
		var default_devfiles_status = ['/sys/class/power_supply/CMB0/status',
		                               '/sys/class/power_supply/CMB1/status',
		                               '/sys/class/power_supply/BAT0/status',
		                               '/sys/class/power_supply/BAT1/status',
		                               '/sys/class/power_supply/BAT2/status'];

		// get device files from settings
		// remove "file://" because it's not supported by Cinnamon.get_file_contents_utf8_sync()
		var result_devfile_capacity = this.devfile_capacity.replace("file://", "");
		var result_devfile_status = this.devfile_status.replace("file://", "");

		// auto detect device files if settings were not set
		if (result_devfile_capacity == "") {
			// iterate trough default devfiles ...
			for (var i in default_devfiles_capacity) {
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
			for (var i in default_devfiles_status) {
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
		var currentCapacity = 0;
		var currentState = "";
		var currentError = 0;
		try {
			// read device files
			currentCapacity = parseInt(Cinnamon.get_file_contents_utf8_sync(result_devfile_capacity));
			currentState = Cinnamon.get_file_contents_utf8_sync(result_devfile_status).trim();
		} catch(ex) {
			// maybe the file does not exist because the battery was removed
			currentError = 1;
		}

		// set label text to current capacity
		this.text.set_text(currentCapacity.toString() + "%");

		// background image decision
		if (currentCapacity > 95) {
			// 95%-100%: show fixed full background and hide bar
			this.battery.style_class = "battery full";
			this.segment_visible = false;
		} else if (currentCapacity > 20) {
			// greater than 20%: show green background and a bar with variable length

			// calc bar width
			this.batterySegmentMaxLength = 115;
			this.batterySegmentLength = (this.batterySegmentMaxLength * currentCapacity / 100) * this.scale_size;

			// set background and bar width
			this.battery.style_class = "battery green";
			this.segment_visible = true;
		} else if (currentCapacity > 10) {
			// greater than 10% but lower than 21%: show fixed red background and hide bar
			this.battery.style_class = "battery red";
			this.segment_visible = false;
		} else if (currentCapacity > 0) {
			// greater than 0% but lower than 11%: show fixed low red background and hide bar
			this.battery.style_class = "battery red-low";
			this.segment_visible = false;
		} else if (currentCapacity == 0) {
			// exactly 0%: show fixed empty background and hide bar
			this.battery.style_class = "battery empty";
			this.segment_visible = false;
		}

		// icon or label visibility decision
		if (currentError == 1) {
			// error: warning icon and no label
			this.plug.style_class = "symbol warn";
			this.symbol_visible = true;
			this.text_visible = false;
		} else {
			if (currentState == "Charging" && this.showplug == true) {
				// power supply online, charging and icon should be shown
				this.plug.style_class = "symbol flash";
				this.symbol_visible = true;
				this.text_visible = false;
			} else if ((currentState == "Not charging" || currentState == "Full" || currentState == "Unknown") && this.showplug == true) {
				// power supply online, not charging (full) and icon should be shown
				this.plug.style_class = "symbol plug";
				this.symbol_visible = true;
				this.text_visible = false;
			} else if (this.showpercent == true) {
				// power supply offline (= discharging) and capacity should be shown
				this.plug.style_class = "symbol";
				this.symbol_visible = false;
				this.text_visible = true;
			} else if (this.showpercent == false) {
				// power supply offline (= discharging) and capacity should not be shown
				this.plug.style_class = "symbol";
				this.symbol_visible = false;
				this.text_visible = false;
			} else {
				// Unknown state
				this.plug.style_class = "symbol warn";
				this.symbol_visible = true;
				this.text_visible = false;
			}
		}

		// set object sizes without recalc
		this.refreshSize(this.is_first_refresh);
		this.is_first_refresh = false;

		// refresh again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this.refresh));
	},

	refreshSize: function(recalc = true) {
		if (recalc == true) {
			// calc new sizes based on scale factor
			this.new_size_font = this.default_size_font * this.scale_size;
			this.new_size_battery_width = this.default_size_battery_width * this.scale_size;
			this.new_size_battery_height = this.default_size_battery_height * this.scale_size;
			this.new_size_symbol = this.default_size_symbol * this.scale_size;
			this.new_segment_offset = this.default_segment_offset * this.scale_size;
			if (this.new_segment_offset != this.default_segment_offset)
				this.new_segment_offset --;

			// set new sizes
			this.battery.style = "background-size: " + this.new_size_battery_width.toString() + "px " + this.new_size_battery_height.toString() + "px;" +
			                     "width: " + this.new_size_battery_width.toString() + "px; height: " + this.new_size_battery_height.toString() + "px;";
		}

		// set (new) sizes
		if (this.segment_visible == true) {
			this.segment.style = "background-size: " + this.batterySegmentLength.toString() + "px " + this.new_size_battery_height.toString() + "px;" +
			                     "width: " + this.new_size_battery_width.toString() + "px; height: " + this.new_size_battery_height.toString() + "px;" +
			                     "background-position: " + this.new_segment_offset.toString() + "px 0px;";
		} else {
			this.segment.style = "background-size: 0px 0px;";
		}
		if (this.symbol_visible == true) {
			this.plug.style = "background-size: " + this.new_size_symbol.toString() + "px " + this.new_size_symbol.toString() + "px;" +
			                  "width: " + this.new_size_symbol.toString() + "px; height: " + this.new_size_symbol.toString() + "px;";
		} else {
			this.plug.style = "width: 0px; height: 0px;";
		}
		if (this.text_visible == true) {
			this.text.style = "font-size: " + this.new_size_font.toString() + "px;" + "width: auto; height: auto;";
		} else {
			this.text.style = "width: 0px; height: 0px;";
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
		this.refreshSize();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
