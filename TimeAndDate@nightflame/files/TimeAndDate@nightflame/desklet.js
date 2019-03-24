
// Time And Date Cinnamon Desklet v0.1 - 19 June 2013
//
// This is a simple desklet to display the time and date. The size and format of the date are configurable by changing the values in metadata.json.
// This can be launched from the Desklet itself by selecting Config from the menu.
//
// I'm sharing it in case it useful to anyone else especially as there do not seem to be many Cinammon Desklets yet.
//
// -Steve
// desklets [at] stargw [dot] eu

const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const St = imports.gi.St;

const Desklet = imports.ui.desklet;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const Gettext = imports.gettext;
const UUID = "TimeAndDate@nightflame";

// l10n/translation support

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(UUID, str);
}

const toLocaleFormat = function toLocaleFormat(date, format) {
	return Cinnamon.util_format_date(format, date.getTime());
};

function MyDesklet(metadata){
    this._init(metadata);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	_init: function(metadata){
		Desklet.Desklet.prototype._init.call(this, metadata);

		this.metadata = metadata
		this.dateFormat = this.metadata["dateFormat"];
		this.dateSize = this.metadata["dateSize"];
		this.timeFormat = this.metadata["timeFormat"];
		this.timeSize = this.metadata["timeSize"];


		this._clockContainer = new St.BoxLayout({vertical:true, style_class: 'clock-container'});

		this._dateContainer =  new St.BoxLayout({vertical:false, style_class: 'date-container'});
		this._timeContainer =  new St.BoxLayout({vertical:false, style_class: 'time-container'});

		this._date = new St.Label();
		this._time = new St.Label();


		this._dateContainer.add(this._date);
		this._timeContainer.add(this._time);

		this._clockContainer.add(this._timeContainer, {x_fill: false, x_align: St.Align.MIDDLE});
		this._clockContainer.add(this._dateContainer, {x_fill: false, x_align: St.Align.MIDDLE});

		this.setContent(this._clockContainer);
		this.setHeader(_("Time And Date"));

		// Set the font sizes from .json file

		this._date.style="font-size: " + this.dateSize;
		this._time.style="font-size: " + this.timeSize;

		// let dir_path = ;
		// this.save_path = dir_path.replace('~', GLib.get_home_dir());
		this.configFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/TimeAndDate@nightflame/metadata.json";
		this.helpFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/TimeAndDate@nightflame/README";

		global.log("Config file " + this.configFile);

		this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		this._menu.addAction(_("Edit Config"), Lang.bind(this, function() {
			Util.spawnCommandLine("xdg-open " + this.configFile);
		}));

		this._menu.addAction(_("Help"), Lang.bind(this, function() {
			Util.spawnCommandLine("xdg-open " + this.helpFile);
		}));


		this._updateDate();
	},

	on_desklet_removed: function() {
		Mainloop.source_remove(this.timeout);
	},

	_updateDate: function(){

		// let timeFormat = '%H:%M';
		// let dateFormat = '%A,%e %B';
		let displayDate = new Date();


		this._time.set_text(toLocaleFormat(displayDate, this.timeFormat));
		this._date.set_text(toLocaleFormat(displayDate, this.dateFormat));

		this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateDate));

	}
}

function main(metadata, desklet_id){
	let desklet = new MyDesklet(metadata, desklet_id);
	return desklet;
}
