const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Util = imports.misc.util;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;

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
		this.settings.bind("devfile_plug", "devfile_plug", this.on_setting_changed);
		this.settings.bind("showpercent", "showpercent", this.on_setting_changed);
		this.settings.bind("showplug", "showplug", this.on_setting_changed);

		// initialize desklet gui
		this.setHeader(_("Battery"));
		this.setupUI();
	},

	setupUI: function() {
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

		// set initial values
		this.refresh();
	},

	refresh: function() {
		// default device files
		var default_devfile_capacity = "/sys/class/power_supply/CMB1/capacity";
		var default_devfile_plug = "/sys/class/power_supply/AC/online";

		// get device files from settings
		// remove "file://" because it's not supported by Cinnamon.get_file_contents_utf8_sync()
		var result_devfile_capacity = this.devfile_capacity.replace("file://", "");
		var result_devfile_plug = this.devfile_plug.replace("file://", "");

		// fallback to defaults if settings were not present
		if (result_devfile_capacity == false) {
			result_devfile_capacity = default_devfile_capacity;
			result_devfile_plug = default_devfile_plug;
		}

		// get current battery/power supply values
		var currentCapacity = 0;
		var currentState = 1;
		var currentError = 0;
		try {
			// read device files
			currentCapacity = parseInt(Cinnamon.get_file_contents_utf8_sync(result_devfile_capacity));
			currentState = parseInt(Cinnamon.get_file_contents_utf8_sync(result_devfile_plug));
		} catch(ex) {
			// maybe the file does not exist because the battery was removed
			currentError = 1;
		}

		// set label text to current capacity
		this.text.set_text(currentCapacity.toString() + "%");

		if (currentCapacity > 20) {
			// greater than 20%: show green background and a bar with variable length

			// calc bar width
			this.batterySegmentMaxLength = 115;
			this.batterySegmentLength = this.batterySegmentMaxLength * currentCapacity / 100;

			// set background and bar width
			this.battery.style_class = "battery green";
			this.segment.style = "background-size: " + this.batterySegmentLength.toString() + "px 66px;"
		} else if (currentCapacity > 10) {
			// greater than 10% but lower than 21%: show fixed red background and hide bar
			this.battery.style_class = "battery red";
			this.segment.style = "background-size: 0px 0px;";
		} else if (currentCapacity > 0) {
			// greater than 0% but lower than 11%: show fixed low red background and hide bar
			this.battery.style_class = "battery red-low";
			this.segment.style = "background-size: 0px 0px;";
		} else if (currentCapacity == 0) {
			// exactly 0%: show fixed empty background and hide bar
			this.battery.style_class = "battery empty";
			this.segment.style = "background-size: 0px 0px;";
		}

		// icon or label visibility decision
		if (currentError == 1) {
			// error: warning icon and no label
			this.plug.style_class = "symbol warn";
			this.text.style = "color: transparent;"
		} else {
			if (currentState == 1 && this.showplug == true) {
				// power supply online and plug icon should be shown
				this.plug.style_class = "symbol plug plug-visible";
				this.text.style = "color: transparent;"
			} else if (this.showpercent == true) {
				// power supply offline and capacity should be shown
				this.plug.style_class = "symbol plug plug-hidden";
				this.text.style = "color: white;"
			} else {
				// power supply offline and capacity should not be shown
				this.plug.style_class = "symbol plug plug-hidden";
				this.text.style = "color: transparent;"
			}
		}

		// refresh again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this.refresh));
	},

	on_setting_changed: function() {
		// settings changed; instant refresh
		Mainloop.source_remove(this.timeout);
		this.refresh();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	},
}
