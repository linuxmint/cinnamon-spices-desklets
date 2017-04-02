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
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-seconds-hand", "show_seconds_hand", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "smooth-seconds-hand", "smooth_seconds_hand", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-tz", "use_custom_tz", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-tz", "custom_tz", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-bg", "img_bg", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-s", "img_s", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-m", "img_m", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-h", "img_h", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// set default sizes
		this.default_size_clock_width = 130;
		this.default_size_clock_height = 130;
		this.calced_size_clock_width = 0;
		this.calced_size_clock_height = 0;

		// create elements
		this.clock = new St.Bin({style_class: 'clock'});
		this.clock_container = new St.Group({style_class: 'clock_container'}); // container for pointers with background image
		this.second_hand = new St.Bin({style_class: 'hand second_hand'}); // pointers
		this.minute_hand = new St.Bin({style_class: 'hand minute_hand'});
		this.hour_hand = new St.Bin({style_class: 'hand hour_hand'});

		// add actors
		this.clock_container.add_actor(this.second_hand);
		this.clock_container.add_actor(this.minute_hand);
		this.clock_container.add_actor(this.hour_hand);
		this.clock.add_actor(this.clock_container);

		// set pivot points for pointers
		this.second_hand.set_pivot_point(0.5,0.5);
		this.minute_hand.set_pivot_point(0.5,0.5);
		this.hour_hand.set_pivot_point(0.5,0.5);

		// set root element
		this.setContent(this.clock);

		// set initial size and decoration settings
		this.refreshSize();
		this.refreshDecoration();

		// set initial values
		this.is_first_refresh = true;
		this.refresh();
	},

	refresh: function() {
		// get current time
		this._displayTime = new GLib.DateTime();

		// get timezone info
		if (this.use_custom_tz && this.custom_tz != "") {
			let tz = GLib.TimeZone.new(this.custom_tz);
			this._displayTime = this._displayTime.to_timezone(tz);
		}

		// get current hour, minute and second
		let hours = this._displayTime.get_hour();
		let minutes = this._displayTime.get_minute();
		let seconds = this._displayTime.get_second();
		let mseconds = this._displayTime.get_microsecond();

		// calc pointer rotation angles
		let hours_deg = 0;
		let minutes_deg = 0;
		let hours_deg = 0;
		if (this.smooth_seconds_hand == true) {
			hours_deg = ((hours+(minutes/60))*360/12);
			minutes_deg = ((minutes+(seconds/60))*360/60);
			seconds_deg = ((seconds+(mseconds/1000000))*360/60);
		} else {
			hours_deg = (hours*360/12);
			minutes_deg = (minutes*360/60);
			seconds_deg = (seconds*360/60);
		}

		// rotate pointer graphics
		this.second_hand.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, seconds_deg);
		this.minute_hand.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, minutes_deg);
		this.hour_hand.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, hours_deg);

		// refresh again in 100 milliseconds
		this.timeout = Mainloop.timeout_add(100, Lang.bind(this, this.refresh));
	},

	refreshSize: function(recalc = true) {
		// calc sizes
		if (recalc == true) {
			this.calced_size_clock_width = this.default_size_clock_width * this.scale_size;
			this.calced_size_clock_height = this.default_size_clock_height * this.scale_size;
		}

		// set images
		if (this.img_bg != "")
			this.img_bg_style = "background-image: url('" + this.img_bg.replace("file://", "") + "');";
		else
			this.img_bg_style = "";
		if (this.img_s != "")
			this.img_s_style = "background-image: url('" + this.img_s.replace("file://", "") + "');";
		else
			this.img_s_style = "";
		if (this.img_m != "")
			this.img_m_style = "background-image: url('" + this.img_m.replace("file://", "") + "');";
		else
			this.img_m_style = "";
		if (this.img_h != "")
			this.img_h_style = "background-image: url('" + this.img_h.replace("file://", "") + "');";
		else
			this.img_h_style = "";

		// set sizes
		this.size_style = "width: " + this.calced_size_clock_width.toString() + "px;" +
		                  "height: " + this.calced_size_clock_height.toString() + "px;" +
		                  "background-size: " + this.calced_size_clock_width.toString() + "px " + this.calced_size_clock_height.toString() + "px;";
		this.clock.style = this.size_style;
		this.clock_container.style = this.size_style + this.img_bg_style;
		this.minute_hand.style = this.size_style + this.img_m_style;
		this.hour_hand.style = this.size_style + this.img_h_style;

		if (this.show_seconds_hand == true) {
			this.second_hand.style = this.size_style + this.img_s_style;
		} else {
			this.second_hand.style = "background-size: 0px 0px;" + this.img_s_style;
		}
	},

	refreshDecoration: function() {
		// desklet label (header)
		if (this.use_custom_label == true)
			this.setHeader(this.custom_label)
		else
			this.setHeader(_("Clock"));

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
