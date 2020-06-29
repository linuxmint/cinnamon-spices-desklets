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

const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["clock@schorschii"].path;


function MyDesklet(metadata, desklet_id) {
	this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
	return new MyDesklet(metadata, desklet_id);
}

function getImageAtScale(imageFileName, width, height) {
	let pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, width, height);
	let image = new Clutter.Image();
	image.set_data(
		pixBuf.get_pixels(),
		pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
		width, height,
		pixBuf.get_rowstride()
	);

	let actor = new Clutter.Actor({width: width, height: height});
	actor.set_content(image);

	return actor;
}


MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata);

		// initialize settings
		this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-size", "desklet_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-seconds-hand", "show_seconds_hand", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "smooth-seconds-hand", "smooth_seconds_hand", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "smooth-minutes-hand", "smooth_minutes_hand", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-tz", "use_custom_tz", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-tz", "custom_tz", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "style", "style", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-bg", "img_bg", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-s", "img_s", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-m", "img_m", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "img-h", "img_h", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// load images and add actors
		this.refreshSize();

		// set initial size and decoration settings
		this.refreshDecoration();

		// set initial values
		this.refresh();
	},

	refresh: function() {
		// get current time
		this._displayTime = new GLib.DateTime();

		// get timezone info
		if(this.use_custom_tz && this.custom_tz != "") {
			let tz = GLib.TimeZone.new(this.custom_tz);
			this._displayTime = this._displayTime.to_timezone(tz);
		}

		// get current hour, minute and second
		let hours = this._displayTime.get_hour();
		let minutes = this._displayTime.get_minute();
		let seconds = this._displayTime.get_second();
		let mseconds = this._displayTime.get_microsecond();

		// calc pointer rotation angles
		let hours_deg = ((hours+(minutes/60))*360/12);
		let minutes_deg = 0;
		let seconds_deg = 0;
		if(this.smooth_seconds_hand == true) {
			seconds_deg = ((seconds+(mseconds/1000000))*360/60);
		} else {
			seconds_deg = (seconds*360/60);
		}
		if(this.smooth_minutes_hand == true) {
			minutes_deg = ((minutes+(seconds/60))*360/60);
		} else {
			minutes_deg = (minutes*360/60);
		}

		// rotate pointer graphics
		this.second_hand.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, seconds_deg);
		this.minute_hand.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, minutes_deg);
		this.hour_hand.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, hours_deg);

		// refresh again in 100 milliseconds, or when the second next changes
		let timeoutval = 100;
		if(this.show_seconds_hand == false)
			timeoutval = Math.ceil(3000 - (1000*seconds + mseconds/1000) % 3000);
		else if(this.smooth_seconds_hand == false)
			timeoutval = Math.ceil(1000 - mseconds/1000);
		this.timeout = Mainloop.timeout_add(timeoutval, Lang.bind(this, this.refresh));
	},

	refreshSize: function() {
		// create elements
		this.clock = new St.Bin({style_class: 'clock'});
		this.clock_container = new St.Group({style_class: 'clock_container'}); // container for pointers with background image

		// defaults
		let default_style = "light";
		let img_bg_final = DESKLET_ROOT + "/img/" + default_style + "/bg.svg";
		let img_h_final = DESKLET_ROOT + "/img/" + default_style + "/h.svg";
		let img_m_final = DESKLET_ROOT + "/img/" + default_style + "/m.svg";
		let img_s_final = DESKLET_ROOT + "/img/" + default_style + "/s.svg";

		// override paths by default designs
		if(this.style != "custom-images") {
			img_bg_final = DESKLET_ROOT + "/img/" + this.style + "/bg.svg";
			img_h_final = DESKLET_ROOT + "/img/" + this.style + "/h.svg";
			img_m_final = DESKLET_ROOT + "/img/" + this.style + "/m.svg";
			img_s_final = DESKLET_ROOT + "/img/" + this.style + "/s.svg";
		}

		// override defaults if images are set
		if(this.desklet_size < 10)
			this.desklet_size = 10;
		if(this.style == "custom-images" && this.img_bg != "")
			img_bg_final = decodeURIComponent(this.img_bg.replace("file://", ""));
		if(this.style == "custom-images" && this.img_s != "")
			img_s_final = decodeURIComponent(this.img_s.replace("file://", ""));
		if(this.style == "custom-images" && this.img_m != "")
			img_m_final = decodeURIComponent(this.img_m.replace("file://", ""));
		if(this.style == "custom-images" && this.img_h != "")
			img_h_final = decodeURIComponent(this.img_h.replace("file://", ""));

		// set sizes
		let scale = global.ui_scale;
		this.clock.set_size(this.desklet_size*scale, this.desklet_size*scale);

		// load images in given size
		this.clock_bg = getImageAtScale(img_bg_final, this.desklet_size*scale, this.desklet_size*scale); // background
		this.second_hand = getImageAtScale(img_s_final, this.desklet_size*scale, this.desklet_size*scale); // pointers
		this.minute_hand = getImageAtScale(img_m_final, this.desklet_size*scale, this.desklet_size*scale);
		this.hour_hand = getImageAtScale(img_h_final, this.desklet_size*scale, this.desklet_size*scale);

		// set pivot points for pointer images
		this.second_hand.set_pivot_point(0.5,0.5);
		this.minute_hand.set_pivot_point(0.5,0.5);
		this.hour_hand.set_pivot_point(0.5,0.5);

		// add actors
		this.clock.remove_all_children();
		this.clock_container.add_actor(this.clock_bg);
		this.clock_container.add_actor(this.hour_hand);
		this.clock_container.add_actor(this.minute_hand);
		if(this.show_seconds_hand == true)
			this.clock_container.add_actor(this.second_hand);

		// set root element
		this.clock.add_actor(this.clock_container);
		this.setContent(this.clock);
	},

	refreshDecoration: function() {
		// desklet label (header)
		if(this.use_custom_label == true)
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

		// update size and graphics
		this.refreshSize();

		// settings changed; instant refresh
		Mainloop.source_remove(this.timeout);
		this.refresh();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
