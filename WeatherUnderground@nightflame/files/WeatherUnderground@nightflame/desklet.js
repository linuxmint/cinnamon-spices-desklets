
// Weather Under Ground Cinnamon Desklet v0.1 - 16 June 2013
//
// The Desklet is a little raw at the moment because its my first attempt. I wrote it because I wanted to see local weather on my desktop.
// I'm sharing it in case it useful to anyone else especially as there do not seem to be many Cinammon Desklets yet. Its based on xkcd@rjanja.
//
// -Steve
// desklets [at] stargw [dot] eu

const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const Dialog = imports.ui.modalDialog;

const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Cinnamon = imports.gi.Cinnamon;
const Soup = imports.gi.Soup;

let session = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(session, new Soup.ProxyResolverDefault());

function MyDesklet(metadata, desklet_id){
	this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
	__proto__: Desklet.Desklet.prototype,

	// Downloads and saves a file
	download_file: function(url, localFilename, callback) {
		let outFile = Gio.file_new_for_path(localFilename);
		var outStream = new Gio.DataOutputStream({
			base_stream:outFile.replace(null, false, Gio.FileCreateFlags.NONE, null)});

		global.log("Downloading " + url);

		var message = Soup.Message.new('GET', url);
		session.queue_message(message, function(session, response) {
			if (response.status_code !== Soup.KnownStatusCode.OK) {
			   global.logError("Error during download: response code " + response.status_code
				  + ": " + response.reason_phrase + " - " + response.response_body.data);
			   callback(false, null);
			   return true;
			}

			try {
				Cinnamon.write_soup_message_to_stream(outStream, message);
				outStream.close(null);
			}
			catch (e) {
			   global.logError("Site seems to be down. Error was:");
			   global.logError(e);
			   callback(false, null);
			   return true;
			}

			// global.log("Save to " + localFilename);
			callback(true, localFilename);
			return false;
		 });
	},

	refresh: function() {

		if (this._timeoutId) {
			Mainloop.source_remove(this._timeoutId);
		}

		// let dir_path = this.metadata["directory"];
		// this.save_path = dir_path.replace('~', GLib.get_home_dir());

		let weatherImg = GLib.get_home_dir() + "/.cache/weather.png";
		this.download_file("http://banners.wunderground.com/cgi-bin/banner/ban/wxBanner?bannertype=pws250" + this.units + "&weatherstationcount=" + this.stationID , weatherImg, Lang.bind(this, this.on_weather_downloaded));

		return true;
	},

	//
	// Callback
	//
	on_weather_downloaded: function(success, file, cached) {
		Tweener.addTween(this._clutterTexture, { opacity: 0,
			time: this.metadata["fade-delay"],
			transition: 'easeInSine',
			onComplete: Lang.bind(this, function() {
				if (this._clutterTexture.set_from_file(file)) {
					this._photoFrame.set_child(this._clutterBox);
				}
				Tweener.addTween(this._clutterTexture, { opacity: 255,
					time: this.metadata["fade-delay"],
					transition: 'easeInSine'
				});
			})
		});

		// let displayDate = new Date();
		// let text = displayDate.toLocaleFormat('%H:%M');
		// global.log("Weather Updated at " + text);
	},

	_init: function(metadata, desklet_id) {
		try {
			Desklet.Desklet.prototype._init.call(this, metadata);
			this.desklet_id = desklet_id
			this.units = metadata["units"];
			this.stationID = metadata["stationID"];
			this.period = metadata["period"];

			global.log("StationID = " + this.stationID);

			global.log("Initialise weather.");
			this.setHeader(_("Weather"));

			this._photoFrame = new St.Bin({style_class: 'weather-box', x_align: St.Align.START});
			this._binLayout = new Clutter.BinLayout();
			this._clutterBox = new Clutter.Box();
			this._clutterTexture = new Clutter.Texture({
				keep_aspect_ratio: true,
				filter_quality: metadata["quality"]});

			this._clutterTexture.set_load_async(true);
			this._clutterBox.set_layout_manager(this._binLayout);
			this._clutterBox.set_width(metadata["width"]);
			this._clutterBox.add_actor(this._clutterTexture);
			this._photoFrame.set_child(this._clutterBox);
			this.setContent(this._photoFrame);


			this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
			let helpFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" +
				metadata["uuid"] + "/HELP.md";
			this.helpMessage = String(GLib.file_get_contents(helpFile)[1]);
			this._menu.addAction(_("Help"), Lang.bind(this, function() {
				this.helpDialog = new Dialog.NotifyDialog(this.helpMessage);
				this.helpDialog.open();
			}));


			this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.desklet_id);
			this.settings.bindProperty(Settings.BindingDirection.IN, "stationID", "stationID", function() {	this._update(); });
			this.settings.bindProperty(Settings.BindingDirection.IN, "units", "units", function() {	this._update(); });
			this.settings.bindProperty(Settings.BindingDirection.IN, "period", "period", function() {	this._update(); });

			// Load for the first time
			this._update();

			global.w = this._photoFrame;

		}
		catch (e) {
			global.logError(e);
		}
		return true;
	},

	//
	// This handles updates
	//
	_update: function(){
		try {
			global.log("Refresh.");
			this.refresh();
			// requeue this as an update every 5 mins
			this._timeoutId = Mainloop.timeout_add_seconds(this.period, Lang.bind(this, this._update))
		}
		catch (e) {
			global.logError(e);
		}
	},

	//
	// Update weather when clicked
	//
	on_desklet_clicked: function(event){
		try {
			if (event.get_button() == 1) {
				this._update();
			}
		}
		catch (e) {
			global.logError(e);
		}
	},

	on_desklet_removed: function() {
		let weatherImg = GLib.get_home_dir() + "/.cache/weather.png";

		// Delete the old file
		try {
			var f = Gio.File.new_for_path(weatherImg);
			f.delete(null);
			global.log("Delete " + weatherImg);
		} catch (e) {
			global.log("Cannot delete " + weatherImg);
			global.logError(e);
		}
		Mainloop.source_remove(this.timeout);
	}
}

function main(metadata, desklet_id){
	let desklet = new MyDesklet(metadata, desklet_id);
	return desklet;
}
