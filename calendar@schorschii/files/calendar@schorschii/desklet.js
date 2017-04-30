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

const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta["calendar@schorschii"].path;

// Enable translation support

const UUID = "calendar@schorschii";
const Gettext = imports.gettext;

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
	return Gettext.dgettext(UUID, str);
}

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
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "bg-img", "bg_img", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "notification-color", "notification_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "notification-background-color", "notification_background_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "read-appointments", "read_appointments", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "ical-file", "ical_file", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "onclick-active", "onclick_active", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "onclick-command", "onclick_command", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// defaults and initial values
		this.default_size_font_month_big = 45;
		this.default_size_font_month_sub = 14;
		this.default_size_battery_width = 130;
		this.default_size_battery_height = 140;
		this.default_month_big_top = 50;
		this.default_month_sub_top = 105;
		this.default_month_top_top = 27;
		this.dayofmonth = 0; this.monthofyear = 0; this.dayofweek = 0; this.year = 0;
		this.dayofweek_string = ""; this.monthofyear_string = "";
		this.notification_amount = 0; this.last_notification_amount = 0;

		// load images and set initial sizes
		this.refreshSize(true);

		// set root eleent
		this.setContent(this.calendar);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
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
		this.dayofmonth = this._displayTime.get_day_of_month();
		this.monthofyear = this._displayTime.get_month();
		this.dayofweek = this._displayTime.get_day_of_week();
		this.year = this._displayTime.get_year();

		switch (this.dayofweek) {
			case 1: this.dayofweek_string = _("Monday"); break;
			case 2: this.dayofweek_string = _("Tuesday"); break;
			case 3: this.dayofweek_string = _("Wednesday"); break;
			case 4: this.dayofweek_string = _("Thursday"); break;
			case 5: this.dayofweek_string = _("Friday"); break;
			case 6: this.dayofweek_string = _("Saturday"); break;
			case 7: this.dayofweek_string = _("Sunday"); break;
		}
		switch (this.monthofyear) {
			case 1: this.monthofyear_string = _("January"); break;
			case 2: this.monthofyear_string = _("February"); break;
			case 3: this.monthofyear_string = _("March"); break;
			case 4: this.monthofyear_string = _("April"); break;
			case 5: this.monthofyear_string = _("May"); break;
			case 6: this.monthofyear_string = _("June"); break;
			case 7: this.monthofyear_string = _("July"); break;
			case 8: this.monthofyear_string = _("August"); break;
			case 9: this.monthofyear_string = _("September"); break;
			case 10: this.monthofyear_string = _("October"); break;
			case 11: this.monthofyear_string = _("November"); break;
			case 12: this.monthofyear_string = _("December"); break;
		}

		this.notification_amount = 0;
		if (this.read_appointments) {
			let ical_content = "";
			try {
				// read ical file
				ical_content = Cinnamon.get_file_contents_utf8_sync(this.ical_file.replace("file://", ""));
			} catch(ex) {
				// error reading file - maybe the file does not exist
				this.notification_amount = -1;
			}

			var lines = ical_content.split("\n");

			let ical_current_dtstart = "";
			let ical_current_dtend = "";
			let ical_current_text = "";
			let ical_current_desc = "";
			for(var i = 0;i < lines.length;i++){
				if (lines[i].startsWith("BEGIN:VEVENT")) {
					// calendar entry starts
				}
				if (lines[i].startsWith("END:VEVENT")) {
					// calendar entry ends

					// check date if it matches today's date
					if (ical_current_dtstart == this.year.toString() + ('0' + this.monthofyear.toString()).slice(-2) + ('0' + this.dayofmonth.toString()).slice(-2))
						this.notification_amount ++;

					// reset temporary variables
					ical_current_desc = ""; ical_current_text = ""; ical_current_dtstart = ""; ical_current_dtend = "";
				}
				if (lines[i].startsWith("DTSTART")) // read appointment start date and time
					ical_current_dtstart = lines[i].split(":")[1].split("T")[0].trim();
				if (lines[i].startsWith("DTEND")) // read appointment end date and time
					ical_current_dtend = lines[i].split(":")[1].split("T")[0].trim();
				if (lines[i].startsWith("SUMMARY")) // read appointment summary
					ical_current_text = lines[i].split(":")[1];
				if (lines[i].startsWith("DESCRIPTION")) // read appointment description
					ical_current_desc = lines[i].split(":")[1];
			}
		}

		// set object sizes without recalc
		this.refreshSize(false);

		// refresh again in five seconds
		this.timeout = Mainloop.timeout_add_seconds(5, Lang.bind(this, this.refresh));
	},

	refreshSize: function(reloadGraphics = false) {
		if (this.notification_amount != this.last_notification_amount || reloadGraphics == true) {

			// calc new sizes based on scale factor
			this.desklet_width = this.default_size_battery_width * this.scale_size;
			this.desklet_height = this.default_size_battery_height * this.scale_size;
			this.size_symbol = this.default_size_symbol * this.scale_size;
			this.size_font_month_big = this.default_size_font_month_big * this.scale_size;
			this.size_font_month_sub = this.default_size_font_month_sub * this.scale_size;
			this.month_big_top = this.default_month_big_top * this.scale_size;
			this.month_sub_top = this.default_month_sub_top * this.scale_size;
			this.month_top_top = this.default_month_top_top * this.scale_size;
			this.segment_width_max = this.segment_width * 0.95;
			this.segment_width_calced = this.segment_width_max * (this.currentCapacity / 100);

			// set images
			if (this.bg_img == "")
				this.bg_img = "calendar_orange.svg";

			let text_color_style = "color:" + this.text_color + ";";

			// create elements
			this.calendar = getImageAtScale(DESKLET_ROOT + "/img/" + this.bg_img, this.desklet_width, this.desklet_height); // background

			this.container = new St.Group(); // container for labels

			this.month_big = new St.Label({style_class:"month-big"}); // day of month
			this.month_big.set_position(0, this.month_big_top);
			this.month_big.style = "width: " + this.desklet_width + "px;" + "font-size: " + this.size_font_month_big.toString() + "px;" + text_color_style;

			this.month_sub = new St.Label({style_class:"month-sub"}); // month string and year (below day of month)
			this.month_sub.set_position(0, this.month_sub_top);
			this.month_sub.style = "width: " + this.desklet_width + "px;" + "font-size: " + this.size_font_month_sub.toString() + "px;" + text_color_style;

			this.month_top = new St.Label({style_class:"month-sub"}); // day of week string (on top of day of month)
			this.month_top.set_position(0, this.month_top_top);
			this.month_top.style = "width: " + this.desklet_width + "px;" + "font-size: " + this.size_font_month_sub.toString() + "px;" + text_color_style;

			this.notification = new St.Label({style_class:"notification-amount"}); // day of week string (on top of day of month)
			this.notification.set_position(0, this.month_top_top);
			this.notification.style = "font-size: " + (this.size_font_month_sub*1.15).toString() + "px;"
			                          + "padding: " + (2*this.scale_size) + "px " + (6*this.scale_size) + "px " + (1*this.scale_size) + "px " + (6*this.scale_size) + "px;"
			                          + "background-color: " + this.notification_background_color + ";"
			                          + "color: " + this.notification_color + ";";

			// add actor
			this.calendar.remove_all_children();
			this.calendar.add_actor(this.container);
			this.container.add_actor(this.month_big);
			this.container.add_actor(this.month_sub);
			this.container.add_actor(this.month_top);
			if (this.notification_amount > 0 || this.notification_amount == -1)
				this.container.add_actor(this.notification);
			this.setContent(this.calendar);

			// remember last notification amount
			this.last_notification_amount = this.notification_amount;

			// debug
			//Main.notifyError("Complete Refresh Done", text_color_style);
		}

		// refresh text
		let subtitle = this.monthofyear_string + " " + this.year.toString();
		this.month_big.set_text(this.dayofmonth.toString());
		this.month_sub.set_text(subtitle);
		this.month_top.set_text(this.dayofweek_string);
		if (this.notification_amount == -1)
			this.notification.set_text("!");
		else
			this.notification.set_text(this.notification_amount.toString());

		// debug
		//Main.notifyError("Text Refresh Done", " ");
	},

	refreshDecoration: function() {
		// desklet label (header)
		if (this.use_custom_label == true)
			this.setHeader(this.custom_label)
		else
			this.setHeader(_("Calendar"));

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

	on_desklet_clicked: function() {
		if (this.onclick_active == true && this.onclick_command != "")
			Util.spawnCommandLine(this.onclick_command);
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
