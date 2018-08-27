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
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "useCustomLabel", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "customLabel", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font", "font", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-bold", "fontBold", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "font-italic", "fontItalic", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "size-font", "sizeFont", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "style", "style", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "customTextColor", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "file", "file", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "edit-cmd", "editCmd", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// defaults and initial values
		this.notecontent = "";

		// load image index
		this.imageIndex = new Array();
		this.imageIndexRaw = Cinnamon.get_file_contents_utf8_sync(DESKLET_ROOT + '/img/index.csv');
		let lines = this.imageIndexRaw.split('\n');
		for(var i = 0;i < lines.length;i++) {
			let fields = lines[i].split(',');
			if(fields.length == 9) {
				let style = new Array();
				style['name'] = fields[0];
				style['imagePath'] = fields[1];
				style['marginTop'] = fields[2];
				style['marginRight'] = fields[3];
				style['marginBottom'] = fields[4];
				style['marginLeft'] = fields[5];
				style['sizeWidth'] = fields[6];
				style['sizeHeight'] = fields[7];
				style['defaultTextColor'] = fields[8];
				this.imageIndex.push(style);
			}
		}

		// load images and set initial sizes
		this.refreshSize(true);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
		this.refresh();
	},

	refresh: function() {
		try {
			// read notes text file
			this.finalPath = decodeURIComponent(this.file.replace("file://", ""));
			if(this.finalPath == "") this.finalPath = "note.txt"; // in home dir

			this.notecontent = Cinnamon.get_file_contents_utf8_sync(this.finalPath);
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

			// set default image
			this.bgImg = "none";

			// set appropriate text padding according to background image
			this.default_notepad_label_top = 0;
			this.default_notepad_label_left = 0;
			this.default_notepad_label_right = 0;
			this.default_notepad_label_bottom = 0;
			this.size_width = 130;
			this.size_height = 130;

			for(var i = 0;i < this.imageIndex.length;i++) {
				if(this.imageIndex[i]['name'] == this.style) {
					this.default_notepad_label_top = this.imageIndex[i]['marginTop'];
					this.default_notepad_label_right = this.imageIndex[i]['marginRight'];
					this.default_notepad_label_bottom = this.imageIndex[i]['marginBottom'];
					this.default_notepad_label_left = this.imageIndex[i]['marginLeft'];
					this.size_width = this.imageIndex[i]['sizeWidth'];
					this.size_height = this.imageIndex[i]['sizeHeight'];
					this.bgImg = this.imageIndex[i]['imagePath'];
					this.textColor =
						this.customTextColor === "rgba(0,0,0,0)"
						? this.imageIndex[i]['defaultTextColor']
						: this.customTextColor;
					break;
				}
			}

			// calc new sizes based on scale factor
			this.desklet_width = this.size_width * this.scaleSize;
			this.desklet_height = this.size_height * this.scaleSize;
			this.label_top = this.default_notepad_label_top * this.scaleSize;
			this.label_left = this.default_notepad_label_left * this.scaleSize;
			this.label_right = this.default_notepad_label_right * this.scaleSize;
			this.label_bottom = this.default_notepad_label_bottom * this.scaleSize;

			// create elements
			this.notepad =
				this.bgImg === "none"
				? new Clutter.Actor()
				: getImageAtScale(DESKLET_ROOT + this.bgImg, this.desklet_width, this.desklet_height); // background

			this.container = new St.Group(); // container for labels

			this.notetext = new St.Label({style_class:"notetext"});
			this.notetext.set_position(Math.round(this.label_left), Math.round(this.label_top));
			this.notetext.set_size(this.desklet_width - this.label_left - this.label_right, this.desklet_height - this.label_top - this.label_bottom);
			this.notetext.style = "font-family: '" + this.font + "';"
			                    + "font-size: " + this.sizeFont + "px;"
			                    + "color:" + this.textColor + ";"
			                    + "font-weight:" + (this.fontBold ? "bold" : "normal") + ";"
			                    + "font-style:" + (this.fontItalic ? "italic" : "normal") + ";";

			// add actor
			this.notepad.remove_all_children();
			this.notepad.add_actor(this.container);
			this.container.add_actor(this.notetext);
			this.setContent(this.notepad); // set root element

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
		if (this.useCustomLabel == true)
			this.setHeader(this.customLabel)
		else
			this.setHeader(_("Notepad"));

		// prevent decorations?
		this.metadata["prevent-decorations"] = this.hideDecorations;
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
		if (this.editCmd != "") {
			Util.spawnCommandLine(this.editCmd.replace("%f", '"'+this.finalPath+'"'));
		}
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
