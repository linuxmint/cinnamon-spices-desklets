const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;

const UUID = "diskspace@schorschii";
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


MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata, desklet_id) {
		Desklet.Desklet.prototype._init.call(this, metadata);

		// initialize settings
		this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
		this.settings.bindProperty(Settings.BindingDirection.IN, "size-prefix", "size_prefix", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "reserved-blocks-as-used-space", "reserved_blocks_as_used_space", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "design", "design", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "draw-free-space", "draw_free_space", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circle_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-own-circle-color", "use_own_circle_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "filesystem", "filesystem", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "type", "type", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-view", "text_view", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "onclick-action", "onclick_action", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-circle-color-generated", "random_circle_color_generated", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-circle-color-r", "random_circle_color_r", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-circle-color-g", "random_circle_color_g", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-circle-color-b", "trandom_circle_color_b", this.on_setting_changed);
		if(!this.random_circle_color_generated) {
			this.random_circle_color_r = Math.random();
			this.random_circle_color_g = Math.random();
			this.random_circle_color_b = Math.random();
			this.random_circle_color_generated = true;
		}

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// defaults and initial values
		this.default_size = 150;
		this.default_size_font = 31;
		this.default_size_font_sub = 15;

		// create and set root element
		this.canvas = new Clutter.Actor();
		this.textpercent = new St.Label({style_class:"textpercent"});
		this.textsub = new St.Label({style_class:"textsub"});
		this.textsub2 = new St.Label({style_class:"textsub2"});
		this.canvas.remove_all_children();
		this.canvas.add_actor(this.textpercent);
		this.canvas.add_actor(this.textsub);
		this.canvas.add_actor(this.textsub2);
		this.setContent(this.canvas);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
		this.update();
	},

	update: function() {
		// set object sizes without recalc
		this.refreshDesklet();
		//global.log("update "+ this.filesystem); // debug

		// refresh again in two seconds
		this.timeout = Mainloop.timeout_add_seconds(5, Lang.bind(this, this.update));
	},

	refreshDesklet: function() {
		// get filesystem
		var type = this.type;
		var fs = decodeURIComponent(this.filesystem.replace("file://", "").trim());
		if(fs == null || fs == "") fs = "/";

		var percentString = "---";
		var avail = 0;
		var use = 0;
		var size = 0;

		// get values from command
		if(type == "ram" || type == "swap") {

			let file = Gio.file_new_for_path("/proc/meminfo");
			file.load_contents_async(null, (file, response) => {
				try {
					let [success, contents, tag] = file.load_contents_finish(response);
					if(success) {
						let mem = contents.toString();
						if(type == "ram") {
							size = parseInt(mem.match(/(MemTotal):\D+(\d+)/)[2]) * 1024;
							use = size - parseInt(mem.match(/(MemAvailable):\D+(\d+)/)[2]) * 1024;
						} else if(type == "swap") {
							size = parseInt(mem.match(/(SwapTotal):\D+(\d+)/)[2]) * 1024;
							use = size - parseInt(mem.match(/(SwapFree):\D+(\d+)/)[2]) * 1024;
						}
						avail = size - use;
						if(size > 0) {
							percentString = Math.round(use * 100 / size) + "%";
						}
						this.redraw(type, fs, avail, use, size, percentString);
						//global.log("avail:"+avail+" used:"+use); // debug
					}
				} catch(ex) {
					global.log("error getting RAM info: "+ex.toString());
				}
			});

		} else {

			// https://docs.gtk.org/gio/vfunc.File.query_filesystem_info_async.html
			let file = Gio.file_new_for_path(fs);
			file.query_filesystem_info_async(
				Gio.FILE_ATTRIBUTE_FILESYSTEM_USED
				+","+Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE
				+","+Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE,
				1, null, (source_object, response, data) => {
					try {
						let fileInfo = file.query_filesystem_info_finish(response);
						avail = fileInfo.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_FREE);
						size = fileInfo.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_SIZE);
						if(this.reserved_blocks_as_used_space) {
							use = size - avail;
						} else {
							use = fileInfo.get_attribute_uint64(Gio.FILE_ATTRIBUTE_FILESYSTEM_USED);
						}
						percentString = Math.round(use * 100 / size) + "%";
					} catch(err) {
						// e.g. file not found (= not mounted)
						//global.log("error getting filesystem info: "+fs);
					}
					this.redraw(type, fs, avail, use, size, percentString);
				}
			);

		}
	},

	redraw: function(type, fs, avail, use, size, percentString) {
		// calc new sizes based on scale factor
		let absoluteSize = this.default_size * this.scale_size;
		let fontSize = Math.round(this.default_size_font * this.scale_size);
		let fontSizeSub = Math.round(this.default_size_font_sub * this.scale_size);
		let design = this.design;
		let drawFreeSpace = this.draw_free_space;

		// determine colors
		var circle_r = 1;
		var circle_g = 1;
		var circle_b = 1;
		var circle_a = 1;
		if(this.use_own_circle_color) {
			let circle_colors = this.circle_color.match(/\((.*?)\)/)[1].split(","); // get contents inside brackets: "rgb(...)"
			circle_r = parseInt(circle_colors[0])/255;
			circle_g = parseInt(circle_colors[1])/255;
			circle_b = parseInt(circle_colors[2])/255;
			if(circle_colors.length >= 4) circle_a = parseFloat(circle_colors[3]);
		} else {
			circle_r = this.random_circle_color_r;
			circle_g = this.random_circle_color_g;
			circle_b = this.random_circle_color_b;
		}

		// canvas setup
		let canvas = new Clutter.Canvas();
		canvas.set_size(absoluteSize * global.ui_scale, absoluteSize * global.ui_scale);
		canvas.connect("draw", function (canvas, cr, width, height) {
			cr.save();
			cr.setOperator(Cairo.Operator.CLEAR);
			cr.paint();
			cr.restore();
			cr.setOperator(Cairo.Operator.OVER);
			cr.scale(width, height);
			cr.translate(0.5, 0.5);

			let offset = Math.PI*0.5;
			let start = 0 - offset;
			let end = ((use*(Math.PI*2))/size) - offset;

			if(design == "thin") {
				if(drawFreeSpace) {
					cr.setSourceRGBA(1, 1, 1, 0.2);
					cr.setLineWidth(0.045);
					cr.arc(0, 0, 0.45, 0, Math.PI*2);
					cr.stroke();
				}
				if(size > 0) {
					cr.setLineCap(Cairo.LineCap.ROUND);
					cr.setSourceRGBA(circle_r, circle_g, circle_b, circle_a);
					cr.setLineWidth(0.045);
					cr.arc(0, 0, 0.45, start, end);
					cr.stroke();
				}
			} else if(design == "compact") {
				if(drawFreeSpace) {
					cr.setSourceRGBA(1, 1, 1, 0.2);
					cr.setLineWidth(0.4);
					cr.arc(0, 0, 0.2, 0, Math.PI*2);
					cr.stroke();
				}
				if(size > 0) {
					cr.setSourceRGBA(circle_r, circle_g, circle_b, circle_a);
					cr.setLineWidth(0.4);
					cr.arc(0, 0, 0.2, start, end);
					cr.stroke();
				}
			} else { // classic design
				if(drawFreeSpace) {
					cr.setSourceRGBA(1, 1, 1, 0.2);
					cr.setLineWidth(0.19);
					cr.arc(0, 0, 0.4, 0, Math.PI*2);
					cr.stroke();
				}
				if(size > 0) {
					cr.setSourceRGBA(circle_r, circle_g, circle_b, circle_a);
					cr.setLineWidth(0.19);
					cr.arc(0, 0, 0.4, start, end);
					cr.stroke();
					/////
					cr.setSourceRGBA(0, 0, 0, 0.1446);
					cr.setLineWidth(0.048);
					cr.arc(0, 0, 0.329, start, end);
					cr.stroke();
				}
				fontSize -= 3;
				fontSizeSub -= 3;
			}

			return true;
		});
		canvas.invalidate();
		this.canvas.set_content(canvas);
		this.canvas.set_size(absoluteSize * global.ui_scale, absoluteSize * global.ui_scale);

		let textSub1 = "";
		let textSub2 = "";
		if(this.text_view == "name-size") {
			if(type == "ram") {
				textSub1 = this.shortText(_("RAM"));
			} else if(type == "swap") {
				textSub1 = this.shortText(_("Swap"));
			} else if(fs == "/") {
				textSub1 = this.shortText(_("Filesystem"));
			} else {
				let pathparts = fs.split("/");
				textSub1 = this.shortText(pathparts[pathparts.length-1]);
			}
			textSub2 = this.niceSize(size);
		} else if(this.text_view == "used-size") {
			textSub1 = this.niceSize(use);
			textSub2 = this.niceSize(size);
		} else if(this.text_view == "size-used") {
			textSub1 = this.niceSize(size);
			textSub2 = this.niceSize(use);
		} else if(this.text_view == "free-size") {
			textSub1 = this.niceSize(avail);
			textSub2 = this.niceSize(size);
		} else if(this.text_view == "size-free") {
			textSub1 = this.niceSize(size);
			textSub2 = this.niceSize(avail);
		} else {
			percentString = "";
		}
		if(size <= 0) {
			textSub1 = _("Not Found");
			textSub2 = "";
		}

		// set label contents
		let textpercent_y = Math.round((absoluteSize * global.ui_scale) / 2 - fontSize * (1.26 * global.ui_scale));
		this.textpercent.set_position(null, textpercent_y);
		this.textpercent.set_text(percentString);
		this.textpercent.style = "font-size: " + fontSize + "px;"
						  + "width: " + absoluteSize + "px;"
						  + "color: " + this.text_color + ";";

		let textsub_y = Math.round(textpercent_y + fontSize * (1.25 * global.ui_scale));
		this.textsub.set_position(null, textsub_y);
		this.textsub.set_text(textSub1);
		this.textsub.style = "font-size: " + fontSizeSub + "px;"
					  + "width: " + absoluteSize + "px;"
					  + "color: " + this.text_color + ";";

		let textsub2_y = Math.round(textsub_y + fontSizeSub * (1.25 * global.ui_scale));
		this.textsub2.set_position(null, textsub2_y);
		this.textsub2.set_text(textSub2);
		this.textsub2.style = "font-size: " + fontSizeSub + "px;"
					   + "width: " + absoluteSize + "px;"
					   + "color: " + this.text_color + ";";

		//global.log("Redraw Done"); // debug
	},

	niceSize: function(value) {
		if(this.size_prefix == "binary") {
			if(value < 1024) return value + " B";
			else if(value < 1024*1024) return Math.round(value / 1024 * 10) / 10 + " Ki";
			else if(value < 1024*1024*1024) return Math.round(value / 1024 / 1024 * 10) / 10 + " Mi";
			else if(value < 1024*1024*1024*1024) return Math.round(value / 1024 / 1024 /1024 * 10) / 10 + " Gi";
			else return Math.round(value / 1024 / 1024 / 1024 / 1024 * 10) / 10 + " Ti";
		} else {
			if(value < 1000) return value + " B";
			else if(value < 1000*1000) return Math.round(value / 1000 * 10) / 10 + " K";
			else if(value < 1000*1000*1000) return Math.round(value / 1000 / 1000 * 10) / 10 + " M";
			else if(value < 1000*1000*1000*1000) return Math.round(value / 1000 / 1000 / 1000 * 10) / 10 + " G";
			else return Math.round(value / 1000 / 1000 / 1000 / 1000 * 10) / 10 + " T";
		}
	},

	shortText: function(value, max = 9) {
		return (value.length > max) ? value.substr(0, max-1) + "…" : value;
	},

	refreshDecoration: function() {
		// desklet label (header)
		let fs = decodeURIComponent(this.filesystem.replace("file://", "").trim());
		if(this.use_custom_label == true)
			this.setHeader(this.custom_label)
		else if(this.type == "ram")
			this.setHeader(_("RAM"));
		else if(this.type == "swap")
			this.setHeader(_("Swap"));
		else if(fs == null || fs == "" || fs == "/")
			this.setHeader(_("Disk Space"));
		else {
			let pathparts = fs.split("/");
			this.setHeader(pathparts[pathparts.length-1]);
		}

		// prevent decorations?
		this.metadata["prevent-decorations"] = this.hide_decorations;
		this._updateDecoration();
	},

	on_setting_changed: function() {
		// update decoration settings
		this.refreshDecoration();

		// settings changed; instant refresh
		Mainloop.source_remove(this.timeout);
		this.update();
	},

	on_desklet_clicked: function() {
		if(this.onclick_action == "filemanager") {
			let fs = decodeURIComponent(this.filesystem.replace("file://", "").trim());
			Util.spawnCommandLine("xdg-open " + '"' + fs + '"');
		} else if(this.onclick_action == "partitionmanager") {
				Util.spawnCommandLine("gnome-disks");
		} else if(this.onclick_action == "sysmonitor") {
				Util.spawnCommandLine("gnome-system-monitor");
		}
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
