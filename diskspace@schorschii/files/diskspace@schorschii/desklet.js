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

const UUID = "diskspace@schorschii";
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
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-color", "text_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "design", "design", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "draw-free-space", "draw_free_space", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circle_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-own-circle-color", "use_own_circle_color", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "filesystem", "filesystem", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "type", "type", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "text-view", "text_view", this.on_setting_changed);
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
		this.default_size = 160;
		this.default_size_font = 32;
		this.default_size_font_sub = 16;

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
			// calc new sizes based on scale factor
			let absolute_size = this.default_size * this.scale_size;
			let font_size = Math.round(this.default_size_font * this.scale_size);
			let font_size_sub = Math.round(this.default_size_font_sub * this.scale_size);

			// calc colors
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

			// get filesystem
			var type = this.type;
			var fs = this.filesystem.replace("file://", "").trim();
			if(fs == null || fs == "") fs = "/";

			let design = this.design;
			let draw_free_space = this.draw_free_space;
			let percent_string = "";
			let avail = 0;
			let use = 0;
			let size = 0;

			// create elements
			let canvas = new Clutter.Canvas();
			canvas.set_size(absolute_size * global.ui_scale, absolute_size * global.ui_scale);
			canvas.connect('draw', function (canvas, cr, width, height) {
				cr.save();
				cr.setOperator(Cairo.Operator.CLEAR);
				cr.paint();
				cr.restore();
				cr.setOperator(Cairo.Operator.OVER);
				cr.scale(width, height);
				cr.translate(0.5, 0.5);

				if(type == "ram") {
					let subprocess = new Gio.Subprocess({
						argv: ['/usr/bin/free'],
						flags: Gio.SubprocessFlags.STDOUT_PIPE,
					});
					subprocess.init(null);
					let [, out] = subprocess.communicate_utf8(null, null); // get full output from stdout
					let fsline = out.split(/\r?\n/)[1]; // get second line with fs information
					let fsvalues = fsline.split(/\s+/); // separate space-separated values from line
					avail = parseInt(fsvalues[3]);
					use = parseInt(fsvalues[2]);
					size = use + avail;
					percent_string = Math.round(use * 100 / size) + "%";
				} else {
					let subprocess = new Gio.Subprocess({
						argv: ['/bin/df', fs],
						flags: Gio.SubprocessFlags.STDOUT_PIPE,
					});
					subprocess.init(null);
					let [, out] = subprocess.communicate_utf8(null, null); // get full output from stdout
					let fsline = out.split(/\r?\n/)[1]; // get second line with fs information
					let fsvalues = fsline.split(/\s+/); // separate space-separated values from line
					avail = parseInt(fsvalues[3]);
					use = parseInt(fsvalues[2]);
					size = use + avail;
					percent_string = fsvalues[4];
				}

				let offset = Math.PI*0.5;
				let start = 0 - offset;
				let end = ((use*(Math.PI*2))/size) - offset;

				if(design == "thin") {
					if(draw_free_space) {
						cr.setSourceRGBA(1, 1, 1, 0.2);
						cr.setLineWidth(0.045);
						cr.arc(0, 0, 0.45, 0, Math.PI*2);
						cr.stroke();
					}
					/////
					cr.setLineCap(Cairo.LineCap.ROUND);
					cr.setSourceRGBA(circle_r, circle_g, circle_b, circle_a);
					cr.setLineWidth(0.045);
					cr.arc(0, 0, 0.45, start, end);
					cr.stroke();
				} else { // classic design
					if(draw_free_space) {
						cr.setSourceRGBA(1, 1, 1, 0.2);
						cr.setLineWidth(0.19);
						cr.arc(0, 0, 0.4, 0, Math.PI*2);
						cr.stroke();
					}
					/////
					cr.setSourceRGBA(circle_r, circle_g, circle_b, circle_a);
					cr.setLineWidth(0.19);
					cr.arc(0, 0, 0.4, start, end);
					cr.stroke();
					/////
					cr.setSourceRGBA(0, 0, 0, 0.1446);
					cr.setLineWidth(0.048);
					cr.arc(0, 0, 0.329, start, end);
					cr.stroke();
					/////
					font_size -= 2;
					font_size_sub -= 2;
				}

				return true;
			});
			canvas.invalidate();
			this.canvas.set_content(canvas);
			this.canvas.set_size(absolute_size * global.ui_scale, absolute_size * global.ui_scale);

			let sub_string = "";
			let sub_string2 = "";
			if(this.text_view == "name-size") {
				if(type == "ram") {
					sub_string = this.shortText(_("RAM"));
				} else if(fs == "/") {
					sub_string = this.shortText(_("Filesystem"));
				} else {
					let pathparts = fs.split("/");
					sub_string = this.shortText(pathparts[pathparts.length-1]);
				}
				sub_string2 = this.niceSize(size);
			} else if(this.text_view == "used-size") {
				sub_string = this.niceSize(use);
				sub_string2 = this.niceSize(size);
			} else if(this.text_view == "free-size") {
				sub_string = this.niceSize(avail);
				sub_string2 = this.niceSize(size);
			}

			// set label contents
			let textpercent_y = (absolute_size * global.ui_scale) / 2 - font_size * (1.42 * global.ui_scale);
			this.textpercent.set_position(null, textpercent_y);
			this.textpercent.set_text(percent_string);
			this.textpercent.style = "font-size: " + font_size + "px;"
			                  + "width: " + absolute_size + "px;"
			                  + "color: " + this.text_color + ";";

			let textsub_y = textpercent_y + font_size * (1.4 * global.ui_scale);
			this.textsub.set_position(null, textsub_y);
			this.textsub.set_text(sub_string);
			this.textsub.style = "font-size: " + font_size_sub + "px;"
			              + "width: " + absolute_size + "px;"
			              + "color: " + this.text_color + ";";

			let textsub2_y = textsub_y + font_size_sub * (1.25 * global.ui_scale);
			this.textsub2.set_position(null, textsub2_y);
			this.textsub2.set_text(sub_string2);
			this.textsub2.style = "font-size: " + font_size_sub + "px;"
			               + "width: " + absolute_size + "px;"
			               + "color: " + this.text_color + ";";

		//Main.notifyError("Refresh Done", " "); // debug
	},

	niceSize: function(value) {
		let use_binary = true;
		if(use_binary) {
			if(value < 1024) return value + "K";
			else if(value < 1024*1024) return Math.round(value / 1024 * 10) / 10 + "M";
			else if(value < 1024*1024*1024) return Math.round(value / 1024 / 1024 * 10) / 10 + "G";
			else return Math.round(value / 1024 / 1024 / 1024 * 10) / 10 + "T";
		} else {
			if(value < 1000) return value + "K";
			else if(value < 1000*1000) return Math.round(value / 1000 * 10) / 10 + "M";
			else if(value < 1000*1000*1000) return Math.round(value / 1000 / 1000 * 10) / 10 + "G";
			else return Math.round(value / 1000 / 1000 / 1000 * 10) / 10 + "T";
		}
	},

	shortText: function(value, max = 9) {
		return (value.length > max) ? value.substr(0, max-1) + '…' : value;
	},

	refreshDecoration: function() {
		// desklet label (header)
		let fs = this.filesystem.replace("file://", "").trim();
		if(this.use_custom_label == true)
			this.setHeader(this.custom_label)
		else if(this.type == "ram")
			this.setHeader(_("RAM"));
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
		Util.spawnCommandLine("gnome-disks");
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
