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
const Gettext = imports.gettext;

const UUID = "notes@schorschii";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

// translation support
function _(str) {
	return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata, desklet_id) {
	// translation init: if installed in user context, switch to translations in user's home dir
	if(!DESKLET_ROOT.startsWith("/usr/share/")) {
		Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
	}
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
		let file = Gio.file_new_for_path(DESKLET_ROOT + '/img/index.csv');
		file.load_contents_async(null, (file, response) => {
			try {
				let [success, contents, tag] = file.load_contents_finish(response);
				if(success) {
					let lines = contents.toString().split('\n');
					for(var i = 0;i < lines.length;i++) {
						let fields = lines[i].split(',');
						if(fields.length != 9) { continue; }
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
				GLib.free(contents);
			} catch(err) {
				global.log(err.message);
			}

			// set initial values
			this.loadText(true);
		});

		// set decoration settings
		this.refreshDecoration();
	},

	loadFileContent: function(file, reloadGraphics) {
		file.load_contents_async(null, (file, response) => {
			try {
				let [success, contents, tag] = file.load_contents_finish(response);
				if(success) {
					this.notecontent = contents.toString();
				} else {
					// error reading file - maybe the file does not exist
					this.notecontent = _("Can't read text file.\nSelect a file in settings.\n\nClick here to edit.");
				}
				GLib.free(contents);
			} catch(err) {
				this.notecontent = err.message;
			}

			// refresh desklet content
			this.refreshDesklet(reloadGraphics);
		});
	},

	loadText: function(reloadGraphics = false) {
		// get notes text file path
		this.finalPath = decodeURIComponent(this.file.replace("file://", ""));
		if(this.finalPath == "") this.finalPath = "note.txt"; // in home dir
		// read file async
		let file = Gio.file_new_for_path(this.finalPath);
		// create file monitor
		this.monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
		//this.monitor.set_rate_limit(1000);

		// listen for 'change' event
		this.monitor.connect('changed', Lang.bind(this, function(monitor, file, other_file, event_type) {
			if (event_type == Gio.FileMonitorEvent.CHANGES_DONE_HINT || event_type == Gio.FileMonitorEvent.DELETED) {
				this.loadFileContent(file, false);
			}
		}));

		this.loadFileContent(file, reloadGraphics);
	},

	cancelFileMonitor: function() {
		this.monitor = null;
	},

	refreshDesklet: function(reloadGraphics = false) {
		if(reloadGraphics) {

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
			let scale = this.scaleSize * global.ui_scale;
			this.desklet_width = this.size_width * scale;
			this.desklet_height = this.size_height * scale;
			this.label_top = this.default_notepad_label_top * scale;
			this.label_left = this.default_notepad_label_left * scale;
			this.label_right = this.default_notepad_label_right * scale;
			this.label_bottom = this.default_notepad_label_bottom * scale;

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

			//Main.notifyError("Complete Refresh Done", " "); // debug
		}

		// refresh text
		this.notetext.set_text(this.notecontent);

		//Main.notifyError("Text Refresh Done", " "); // debug
	},

	refreshDecoration: function() {
		// desklet label (header)
		if(this.useCustomLabel == true)
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
		this.cancelFileMonitor();
		this.loadText(true);
	},

	on_desklet_clicked: function() {
		if(this.editCmd != "") {
			Util.spawnCommandLine(this.editCmd.replace("%f", '"'+this.finalPath+'"'));
		}
	},

	on_desklet_removed: function() {
		this.cancelFileMonitor();
	}
}
