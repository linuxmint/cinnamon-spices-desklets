const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;

const UUID = "hostcheck@schorschii";
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
		this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hide_decorations", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-label", "use_custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "custom-label", "custom_label", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "type", "type", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "host", "host", this.on_setting_changed);
		this.settings.bindProperty(Settings.BindingDirection.IN, "show-notifications", "show_notifications", this.on_setting_changed);

		// initialize desklet gui
		this.setupUI();
	},

	setupUI: function() {
		// defaults and initial values
		this.defaultWidth = 120;
		this.defaultHeight = 38;
		this.defaultInset = 8; // 2*Padding

		// create objects
		this.statusLabel = new St.Label({style_class:"statusbox"});
		this.container = new St.Group();
		this.container.add_actor(this.statusLabel);
		this.canvas = new Clutter.Actor();
		this.canvas.set_size(this.defaultWidth, this.defaultHeight);
		this.canvas.remove_all_children();
		this.canvas.add_actor(this.container);
		this.setContent(this.canvas);

		// set decoration settings
		this.refreshDecoration();

		// set initial values
		this.refresh();
	},

	refresh: function() {
		// query status by executing a shell command
		this.queryStatus();

		// refresh again in x seconds
		this.timeout = Mainloop.timeout_add_seconds(5, Lang.bind(this, this.refresh));
	},

	queryStatus: function() {
		// https://lazka.github.io/pgi-docs/Gio-2.0/classes/Subprocess.html#Gio.Subprocess.wait_async
		let subprocess = new Gio.Subprocess({
			argv: ['/bin/echo'], // dummy
			flags: Gio.SubprocessFlags.STDOUT_PIPE,
		});
		if(this.type == 'ping') {
			let subprocessl = new Gio.SubprocessLauncher({
				flags: Gio.SubprocessFlags.STDOUT_PIPE,
			});
			subprocessl.setenv("LANG", "en", true);
			subprocess = subprocessl.spawnv(['/bin/ping',this.host,'-c1','-w2']);
		}
		else if(this.type == 'http') {
			subprocess = new Gio.Subprocess({
				argv: ['/usr/bin/curl','-s','-o','/dev/null','-w','"%{http_code}"','-m','5',this.host],
				flags: Gio.SubprocessFlags.STDOUT_PIPE,
			});
			subprocess.init(null);
		}
		else {
			return;
		}
		subprocess.desklet = this;
		subprocess.wait_async(null, this.commandCallback);
	},

	commandCallback: function(source_object, res) {
		let [, out] = source_object.communicate_utf8(null, null);
		//global.log(out); //debug
		source_object.desklet.commandOut = out;

		if(out == "") {
			source_object.desklet.colorClass = '';
			source_object.desklet.statusTagString = _('UNKNOWN');
			source_object.desklet.commandOut = _('No ping output');
		}
		else if(source_object.desklet.type == 'ping') {
			if(out.includes(' 100% packet loss')) {
				source_object.desklet.colorClass = 'red';
				source_object.desklet.statusTagString = _('CRIT');
			}
			else if(out.includes(' 0% packet loss')) {
				source_object.desklet.colorClass = 'green';
				source_object.desklet.statusTagString = _('OK');
			}
			else {
				source_object.desklet.colorClass = 'yellow';
				source_object.desklet.statusTagString = _('WARN');
			}
		}
		else if(source_object.desklet.type == 'http') {
			source_object.desklet.commandOut = _('HTTP-Statuscode')+': '+out;
			if(out.includes('000')) {
				source_object.desklet.colorClass = 'red';
				source_object.desklet.statusTagString = _('CRIT');
			}
			else if(out.includes('200')) {
				source_object.desklet.colorClass = 'green';
				source_object.desklet.statusTagString = _('OK');
			}
			else {
				source_object.desklet.colorClass = 'yellow';
				source_object.desklet.statusTagString = _('WARN');
			}
		}

		source_object.desklet.showStatus();
	},

	showStatus: function() {
		// refresh desklet content
		// calc new sizes based on scale factor
		let absolute_size_x = (this.defaultWidth * this.scale_size * global.ui_scale) + (this.defaultInset * this.scale_size * global.ui_scale);
		let absolute_size_y = (this.defaultHeight * this.scale_size * global.ui_scale) + (this.defaultInset * this.scale_size * global.ui_scale);
		let label_size_x = this.defaultWidth * this.scale_size * global.ui_scale;
		let label_size_y = this.defaultHeight * this.scale_size * global.ui_scale
		// modify label
		let statusString = this.statusTagString + "\n" + this.host;
		this.statusLabel.set_text(statusString);
		this.statusLabel.style_class = "statusbox "+this.colorClass;
		this.statusLabel.style = "width:"+label_size_x+"px; height:"+label_size_y+"px;";
		// modify desklet canvas
		this.canvas.set_size(absolute_size_x, absolute_size_y);

		// desktop notification
		if(this.prevStatusTagString != "" && this.prevStatusTagString != this.statusTagString) {
			if(this.show_notifications) {
				Main.notifyError(this.statusTagString+": "+this.host, this.commandOut);
			}
			this.prevStatusTagString = this.statusTagString;
		}
	},

	shortText: function(value) {
		let max = 10;
		return (value.length > max) ? value.substr(0, max-1) + '…' : value;
	},

	refreshDecoration: function() {
		// desklet label (header)
		this.setHeader(this.use_custom_label ? this.custom_label : this.host);

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
	},

	on_desklet_clicked: function() {
		Main.notifyError(this.statusTagString+": "+this.host, this.commandOut);
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	}
}
