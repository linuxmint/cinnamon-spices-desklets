const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const PopupMenu = imports.ui.popupMenu;
const Cinnamon = imports.gi.Cinnamon;
const Soup = imports.gi.Soup;

let session;
if (Soup.get_major_version() == "2") {
    session = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(session, new Soup.ProxyResolverDefault());
} else { //Soup 3
    session = new Soup.Session();
}

const Gettext = imports.gettext;
const UUID = "xkcd@rjanja";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata) {
    this._init(metadata);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata) {
        Desklet.Desklet.prototype._init.call(this, metadata);
        this.metadata = metadata;
        this.updateInProgress = false;
        this._currentXkcd = null;

        this.setHeader(_("xkcd"));

        // Create container for image and alt text
        this._mainBox = new St.BoxLayout({ vertical: true });

        // Image container
        this._image = new Clutter.Image();
        this._imageFrame = new Clutter.Actor({ width: 0, height: 0 });
        this._imageFrame.set_content(this._image);
        this._mainBox.add_actor(this._imageFrame);

        // Label for alt text
        this._altTextLabel = new St.Label({
            text: "",
            style_class: "xkcd-alt-text",
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL
        });
        this._mainBox.add_actor(this._altTextLabel);

        this.setContent(this._mainBox);

        // Menu options
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction(_("View latest xkcd"), () => this.refresh(null));
        this._menu.addAction(_("Random xkcd"), () => {
            let randomComicID = Math.max(1, Math.floor(Math.random() * this.mostRecentComic));
            this.refresh(randomComicID);
        });

        this.refresh(null);
    },

    refresh: function(xkcdId) {
        if (this.updateInProgress) return;
        this.updateInProgress = true;

        let url = xkcdId ? `http://www.xkcd.com/${xkcdId}/info.0.json` : 'http://www.xkcd.com/info.0.json';
        let filename = `${GLib.get_tmp_dir()}/xkcd.json`;

        this.download_file(url, filename, this.on_json_downloaded.bind(this));
    },

    download_file: function(url, localFilename, callback) {
        let file = Gio.file_new_for_path(localFilename);
        let message = Soup.Message.new('GET', url);

        session.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, response) => {
            if (message.status_code !== Soup.Status.OK) {
                global.log("Error downloading: " + message.status_code);
                callback(false, null);
                return;
            }

            try {
                let outStream = Gio.file_new_for_path(localFilename).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                let bytes = session.send_and_read_finish(response);
                outStream.write_bytes(bytes, null);
                outStream.close(null);
            } catch (e) {
                global.logError(e);
                callback(false, null);
                return;
            }

            callback(true, localFilename);
        });
    },

    on_json_downloaded: function(success, filename) {
        if (!success) return;

        try {
            let jsonData = Cinnamon.get_file_contents_utf8_sync(filename);
            this.curXkcd = JSON.parse(jsonData);
        } catch (e) {
            global.logError("Failed to parse JSON: " + e);
            return;
        }

        this._altTextLabel.set_text(this.curXkcd.alt); // Set alt text

        let imgFilename = `${GLib.get_tmp_dir()}/xkcd.png`;
        this.download_file(this.curXkcd.img, imgFilename, this.on_xkcd_downloaded.bind(this));
    },

    on_xkcd_downloaded: function(success, file) {
        if (!success) return;

        Tweener.addTween(this._image, {
            opacity: 0,
            time: 0.5,
            transition: 'easeOutSine',
            onComplete: () => {
                let pixbuf = GdkPixbuf.Pixbuf.new_from_file(file);
                if (pixbuf) {
                    this._image.set_data(pixbuf.get_pixels(),
                        pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                        pixbuf.get_width(),
                        pixbuf.get_height(),
                        pixbuf.get_rowstride());
                    this._imageFrame.set_width(pixbuf.get_width());
                    this._imageFrame.set_height(pixbuf.get_height());
                }
                Tweener.addTween(this._image, { opacity: 255, time: 0.5, transition: 'easeInSine' });
                this.updateInProgress = false;
            }
        });
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata);
}

