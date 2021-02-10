const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;

const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Cinnamon = imports.gi.Cinnamon;
const Soup = imports.gi.Soup
let session = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(session, new Soup.ProxyResolverDefault());

const Gettext = imports.gettext;
const UUID = "xkcd@rjanja";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(UUID, str);
}

function XkcdDesklet(metadata, desklet_id){
    this._init(metadata, desklet_id);
}

XkcdDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    download_file: function(url, localFilename, callback) {
        let outFile = Gio.file_new_for_path(localFilename);
        var outStream = new Gio.DataOutputStream({
            base_stream:outFile.replace(null, false, Gio.FileCreateFlags.NONE, null)});

        var message = Soup.Message.new('GET', url);
        session.queue_message(message, function(session, response) {
            if (response.status_code !== Soup.KnownStatusCode.OK) {
               global.log("Error during download: response code " + response.status_code
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

            callback(true, localFilename);
            return false;
         });
    },

    _refresh: function(xkcdId) {
        // global.log("refreshing");
        if (this.updateInProgress) return true;
        this.updateInProgress = true;

        this.updateUI(xkcdId);
        this._removeTimeout();
        this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, Lang.bind(this, this._refresh));
        return true;
    },

    updateUI: function(xkcdId) {
        let url, filename;

        if (xkcdId === null || xkcdId === undefined) {
            url = 'http://www.xkcd.com/info.0.json';
            filename = this.save_path + '/temp.json'
            this.download_file(url, filename, Lang.bind(this, this.on_json_downloaded));
        }
        else {
            url = 'http://www.xkcd.com/' + xkcdId + '/info.0.json';
            filename = this.save_path + '/' + xkcdId + '.json';
            let jsonFile = Gio.file_new_for_path(filename);
            if (jsonFile.query_exists(null)) {
                this.on_json_downloaded(true, filename, true);
            }
            else {
                this.download_file(url, filename, Lang.bind(this, this.on_json_downloaded));
            }
        }
        return true;
    },

    _removeTimeout: function () {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    },

    query_tooltip: function(widget, x, y, keyboard_mode, tooltip, user_data) {
        global.log('query tooltip');
    },

    set_tooltip: function(tip) {
        //global.log('set_tooltip');
        if (tip !== null) {  
            this._photoFrame.tooltip_text = tip;
        }
        else {
            this._photoFrame.tooltip_text = null;
        }
    },

    on_json_downloaded: function(success, filename, cached) {
        if (success) {
            this.curXkcd = JSON.parse(Cinnamon.get_file_contents_utf8_sync(filename));

            if (this._currentXkcd == this.curXkcd.num) {
                this.updateInProgress = false;
                return true;
            }

            this._currentXkcd = this.curXkcd.num;

            let tempFile, jsonFile;
            let finalFilename = this.save_path + '/' + this.curXkcd.num + '.json';
            
            if (cached !== true && filename != finalFilename) {
                tempFile = Gio.file_new_for_path(filename);
                
                try {
                    jsonFile = Gio.file_new_for_path(finalFilename);
                    jsonFile.trash(null);
                }
                catch (e) {}

                try {
                    tempFile.set_display_name(this.curXkcd.num + '.json', null);
                }
                catch (e) {}
            }
            
            this.set_tooltip(null);
            
            let imgFilename = this.save_path + '/' + this.curXkcd.num + '.png';
            let imgFile = Gio.file_new_for_path(imgFilename);
            if (imgFile.query_exists(null)) {
                this.on_xkcd_downloaded(true, imgFilename, true);
            }
            else {
                this.download_file(this.curXkcd.img, imgFilename, Lang.bind(this, this.on_xkcd_downloaded));
            }
            
        }
        else {
            //global.log('No joy, no json');
        }
        return true;
    },

    on_xkcd_downloaded: function(success, file, cached) {
        Tweener.addTween(this._clutterTexture, { opacity: 0,
            time: this.metadata["fade-delay"],
            transition: 'easeInSine',
            onComplete: Lang.bind(this, function() {
                this.updateInProgress = false;
                if (this._clutterTexture.set_from_file(file)) {
                    this._photoFrame.set_child(this._clutterBox);
                }
                Tweener.addTween(this._clutterTexture, { opacity: 255,
                    time: this.metadata["fade-delay"],
                    transition: 'easeInSine'
                });
            })
        });
    },

    _init: function(metadata, desklet_id){
        try {            
            Desklet.Desklet.prototype._init.call(this, metadata);
            this.metadata = metadata
            this.updateInProgress = false;
            this._files = [];
            this._xkcds = [];
            this._currentXkcd = null;
            
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);
            this.settings.bind("max-height", "maxHeight", this._onSettingsChanged);
            this.settings.bind("max-width", "maxWidth", this._onSettingsChanged);
            this.settings.bind("refresh-interval", "refreshInterval", this._onSettingsChanged);
            this.settings.bind("keep-centered", "keepCentered", this._onSettingsChanged);

            this.setHeader(_("xkcd"));

            this._photoFrame = new St.Bin({style_class: 'xkcd-box', x_align: St.Align.START});
            this._binLayout = new Clutter.BinLayout();
            this._clutterBox = new Clutter.Box();
            this._clutterTexture = new Clutter.Texture({
                keep_aspect_ratio: true, 
                filter_quality: this.metadata["quality"]});
            this._clutterTexture.connect('load-finished', Lang.bind(this, function(e) {
                if (this.curXkcd && this.curXkcd['alt']) {
                    this.set_tooltip(this.curXkcd.alt);
                }
            }));
            this._clutterTexture.set_load_async(true);
            this._clutterBox.set_layout_manager(this._binLayout);
            this._clutterBox.set_width(this.metadata["width"]);
            this._clutterBox.add_actor(this._clutterTexture);
            this._photoFrame.set_child(this._clutterBox);            
            this.setContent(this._photoFrame);
        
            
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction(_("View latest xkcd"), Lang.bind(this, function() {
                this._refresh(null);
            }));
            this._menu.addAction(_("Open save folder"), Lang.bind(this, function() {
                Util.spawnCommandLine("xdg-open " + this.save_path);
            }));

            let dir_path = this.metadata["directory"];
            this.save_path = dir_path.replace('~', GLib.get_home_dir());
            let saveFolder = Gio.file_new_for_path(this.save_path);
            if (!saveFolder.query_exists(null)) {
                saveFolder.make_directory_with_parents(null);
            }

            this.set_tooltip(null);
            
            
            let dir = Gio.file_new_for_path(this.save_path);
            if (dir.query_exists(null)) {
                let fileEnum = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = fileEnum.next_file(null)) != null) {
                    let fileType = info.get_file_type();
                    if (fileType != Gio.FileType.DIRECTORY && info.get_content_type() == 'image/png') {
                        let filename = info.get_name();
                        let xkcdId = filename.substr(0, filename.indexOf('.'));
                        this._xkcds.push(xkcdId);
                    }
                }
                fileEnum.close(null);
            }
            this._xkcds.sort();
            
            this.updateInProgress = false;

            if (this._xkcds.length == 0)
            {
                this._refresh(null);
            }
            else
            {
                this._refresh(this._xkcds[this._xkcds.length - 1]);
            }
            
            global.w = this._photoFrame;
            }
        catch (e) {
            global.logError(e);
        }
        return true;
    },

    _update: function(){
        // Move to the next, older comic
        try {
            let idx = this._xkcds.indexOf(this._currentXkcd);
            let nextId = idx > 0 ? this._xkcds[idx - 1] : this._currentXkcd - 1;
            if (nextId < 0) {
                nextId = null;
            }

            this._refresh(nextId);
        }
        catch (e) {
            global.logError(e);
        }
    },

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

    _onSettingsChanged: function(event) {
        this._refresh();
    }
}

function main(metadata, desklet_id){
    let desklet = new XkcdDesklet(metadata, desklet_id);
    return desklet;
}
