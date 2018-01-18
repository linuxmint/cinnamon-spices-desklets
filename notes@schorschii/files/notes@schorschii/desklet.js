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

const UUID = "notes@schorschii";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

// translation support
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
		this.settings.bindProperty(Settings.BindingDirection.IN, "font", "font", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "size-font", "size_font", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "size-width", "size_width", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "size-height", "size_height", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "bg-img", "bg_img", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "file", "file", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "edit-cmd", "edit_cmd", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// defaults and initial values
		this.default_notepad_label_top = 23;
		this.default_notepad_label_left = 21;
		this.default_notepad_label_right = 15;
		this.default_notepad_label_bottom = 10;
		this.notecontent = "";

		// load images and set initial sizes
		this.refreshSize(true);

		// set root eleent
		this.setContent(this.notepad);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
		this.refresh();
	},

	refresh: function() {
		try {
			// read notes text file
			this.final_path = this.file.replace("file://", "");
			if (this.final_path == "") this.final_path = "note.txt"; // in home dir

			this.notecontent = Cinnamon.get_file_contents_utf8_sync(this.final_path);
		} catch(ex) {
			// error reading file - maybe the file does not exist
			this.notecontent = _("Can't read text file.\nSelect a file in settings.\n\nClick here to edit.");
		}

		// set object sizes without recalc
		this.refreshSize(false);

		// refresh again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this.refresh));
	},

	refreshSize: function(reloadGraphics = false) {
		if (reloadGraphics == true) {

			// calc new sizes based on scale factor
			this.desklet_width = this.size_width * this.scale_size;
			this.desklet_height = this.size_height * this.scale_size;
			this.label_top = this.default_notepad_label_top * this.scale_size;
			this.label_left = this.default_notepad_label_left * this.scale_size;
			this.label_right = this.default_notepad_label_right * this.scale_size;
			this.label_bottom = this.default_notepad_label_bottom * this.scale_size;

			// set images
			if (this.bg_img == "")
				this.bg_img = "bg_yellow.svg";

			// create elements
			this.notepad = getImageAtScale(DESKLET_ROOT + "/img/" + this.bg_img, this.desklet_width, this.desklet_height); // background

			this.container = new St.Group(); // container for labels

			this.notetext = new St.Label({style_class:"notetext"}); // day of week string (on top of day of month)
			this.notetext.set_position(this.label_left, this.label_top);
			this.notetext.style = "width: " + (this.desklet_width - this.label_left - this.label_right) + "px;"
			                    + "height: " + (this.desklet_height - this.label_top - this.label_bottom) + "px;"
			                    + "font-family: '" + this.font + "';"
			                    + "font-size: " + this.size_font + "px;"
			                    + "color:" + this.text_color + ";";

			// add actor
			this.notepad.remove_all_children();
			this.notepad.add_actor(this.container);
			this.container.add_actor(this.notetext);
			this.setContent(this.notepad);

			// remember last notification amount
			this.last_notecontent = this.notecontent;

			// debug
			//Main.notifyError("Complete Refresh Done", " ");
		}

		// refresh text
		this.notetext.set_text(this.notecontent);

		// debug
		//Main.notifyError("Text Refresh Done", " ");
	},

	refreshDecoration: function() {
		// desklet label (header)
		if (this.use_custom_label == true)
			this.setHeader(this.custom_label)
		else
			this.setHeader(_("Notepad"));

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
		if (this.edit_cmd != "") {
			Util.spawnCommandLine(this.edit_cmd.replace("%f", this.final_path));
		}
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
