const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Cinnamon = imports.gi.Cinnamon;
const Soup = imports.gi.Soup;

let session;
if (Soup.get_major_version() == "2") {
    session = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(session, new Soup.ProxyResolverDefault());
} else {
    //Soup 3
    session = new Soup.Session();
}

const Gettext = imports.gettext;
const UUID = "xkcd@rjanja";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata, deskletID) {
    this._init(metadata, deskletID);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    download_file(url, localFilename, callback) {
        let outFile = Gio.file_new_for_path(localFilename);
        var outStream = new Gio.DataOutputStream({
            base_stream: outFile.replace(null, false, Gio.FileCreateFlags.NONE, null),
        });

        var message = Soup.Message.new("GET", url);

        if (Soup.get_major_version() == "2") {
            session.queue_message(message, function (session, response) {
                if (response.status_code !== Soup.KnownStatusCode.OK) {
                    global.log(
                        `Error during download: response code ${response.status_code}:
                        ${response.reason_phrase} - ${response.response_body.data}`,
                    );
                    callback(false, null);
                    return true;
                }

                try {
                    let contents = message.response_body.flatten().get_as_bytes(); // For Soup 2.4
                    outStream.write_bytes(contents, null);
                    outStream.close(null);
                } catch (e) {
                    global.logError("Site seems to be down. Error was:");
                    global.logError(e);
                    callback(false, null);
                    return true;
                }

                callback(true, localFilename);
                return false;
            });
        } else {
            //Soup 3
            session.send_and_read_async(message, Soup.MessagePriority.NORMAL, null,
                (session, response) => {
                    if (message.status_code !== Soup.Status.OK) {
                        global.log(`Error during download: response code ${message.status_code}: ${message.reason_phrase}`);
                        callback(false, null);
                        return true;
                    }
                    try {
                        const bytes = session.send_and_read_finish(response);
                        outStream.write_bytes(bytes, null);
                        outStream.close(null);
                    } catch (e) {
                        global.logError("Site seems to be down. Error was:");
                        global.logError(e);
                        callback(false, null);
                        return true;
                    }

                    callback(true, localFilename);
                    return false;
                },
            );
        }
    },

    refresh(xkcdId) {
        if (this.updateInProgress) return true;
        this.updateInProgress = true;

        let url, filename;

        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            delete this._timeoutId;
        }

        if (xkcdId === null || xkcdId === undefined) {
            url = "http://www.xkcd.com/info.0.json";
            filename = `${this.save_path}/temp.json`;
            this.download_file(url, filename, this.on_json_downloaded.bind(this));
        } else {
            url = `http://www.xkcd.com/${xkcdId}/info.0.json`;
            filename = `${this.save_path}/${xkcdId}.json`;
            let jsonFile = Gio.file_new_for_path(filename);
            if (jsonFile.query_exists(null)) {
                this.on_json_downloaded(true, filename, true);
            } else {
                this.download_file(url, filename, this.on_json_downloaded.bind(this));
            }
        }

        return true;
    },

    on_json_downloaded(success, filename, cached) {
        if (success) {
            this.curXkcd = JSON.parse(
                Cinnamon.get_file_contents_utf8_sync(filename),
            );

            this.altText.set_text(this.curXkcd.alt);
            this.label.set_text("#" + this.curXkcd.num.toString());

            if (this.mostRecentComic < this.curXkcd.num) {
                this.mostRecentComic = this.curXkcd.num;
            }

            if (this.currentXkcd == this.curXkcd.num) {
                this.updateInProgress = false;
                return true;
            }

            this.currentXkcd = this.curXkcd.num;

            let tempFile, jsonFile;
            let finalFilename = `${this.save_path}/${this.curXkcd.num}.json`;

            if (cached !== true && filename != finalFilename) {
                tempFile = Gio.file_new_for_path(filename);

                try {
                    jsonFile = Gio.file_new_for_path(finalFilename);
                    jsonFile.trash(null);
                } catch (e) {}

                try {
                    tempFile.set_display_name(`${this.curXkcd.num}.json`, null);
                } catch (e) {}
            }

            let imgFilename = `${this.save_path}/${this.curXkcd.num}.png`;
            let imgFile = Gio.file_new_for_path(imgFilename);
            if (imgFile.query_exists(null)) {
                this.on_xkcd_downloaded(true, imgFilename, true);
            } else {
                this.download_file(this.curXkcd.img, imgFilename, this.on_xkcd_downloaded.bind(this));
            }
        } else {
            //global.log('No joy, no json');
        }
        return true;
    },

    on_xkcd_downloaded(success, file, cached) {
        this.updateInProgress = false;
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file(file);
        if (pixbuf != null) {
            this.image.set_data(
                pixbuf.get_pixels(),
                pixbuf.get_has_alpha()
                    ? Cogl.PixelFormat.RGBA_8888
                    : Cogl.PixelFormat.RGB_888,
                pixbuf.get_width(),
                pixbuf.get_height(),
                pixbuf.get_rowstride(),
            );
            this.imageFrame.set_width(pixbuf.get_width());
            this.imageFrame.set_height(pixbuf.get_height());
            this.altText.set_width(pixbuf.get_width());
        } else {
            global.logError("Error reading file : " + file);
        }
    },

    on_settings_changed() {
        this.window.style =
            `border-radius: ${this.cornerRadius}px;
            background-color: ${this.bgColor
                .replace(")", `,${this.transparency})`)
                .replace("rgb", "rgba")};
            color: ${this.textColor}`;

        this.altText.style =
            `text-align: ${this.altTextAlign};
            font-size: ${this.altTextFontSize}px;
            padding: ${this.altTextPadding}px`;

        this.label.style =
            `text-align: center;
            font-size: ${this.altTextFontSize * this.labelScale}px;
            padding: ${this.altTextPadding * this.labelScale}px`;
    },

    _init(metadata, deskletID) {
        try {
            Desklet.Desklet.prototype._init.call(this, metadata, deskletID);
            this.metadata = metadata;
            this.updateInProgress = false;
            this.cachedXkcds = [];
            this.currentXkcd = null;
            this.mostRecentComic = 1;

            this.setHeader(_("xkcd"));

            // bind properties
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletID);

            const bindProperties = (properties, func) => { // doing my future self a favor
                for (let i = 0; i < properties.length; i++) {
                    this.settings.bind(properties[i], properties[i], func);
                }
            }

            bindProperties(
                ["altTextFontSize",
                "altTextPadding",
                "cornerRadius",
                "bgColor",
                "transparency",
                "textColor",
                "labelScale",
                "altTextAlign"],
                this.on_settings_changed,
            );

            // create window and actors
            this.window = new St.BoxLayout({ vertical: true });
            this.altText = new St.Label({ text: "" });
            this.label = new St.Label({ text: "" });
            this.image = new Clutter.Image();
            this.imageFrame = new Clutter.Actor({ width: 0, height: 0 });
            this.imageFrame.set_content(this.image);

            // set window and text specific styling
            this.on_settings_changed();
            this.altText.clutter_text.set_line_wrap(true);
            this.altText.clutter_text.set_line_wrap_mode(0);
            this.altText.clutter_text.set_ellipsize(0);

            // add actors to window
            this.window.add_actor(this.label);
            this.window.add_actor(this.imageFrame);
            this.window.add_actor(this.altText);
            this.setContent(this.window);

            // popup menu items
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._menu.addAction(_("View latest xkcd"), () => {
                this.refresh(null);
            });

            this._menu.addAction(_("Random xkcd"), () => {
                const randomComicID = Math.max(1, Math.floor(Math.random() * this.mostRecentComic));
                this.refresh(randomComicID);
            });

            this._menu.addAction(_("Open save folder"), () => {
                Util.spawnCommandLine(`xdg-open ${this.save_path}`);
            });

            this._menu.addAction(_("View in browser"), () => {
                Util.spawnCommandLine(`xdg-open https://www.xkcd.com/${this.curXkcd.num}`);
            });

            let dir_path = this.metadata["directory"];

            // Replace special directory name if any, e.g. DIRECTORY_PICTURES/xkcd replaced by /home/username/Pictures/xkcd.
            let special_dir_name = dir_path.substring(
                dir_path.indexOf("<") + 1,
                dir_path.indexOf(">"),
            );
            if (dir_path.indexOf("<") == 0 && special_dir_name != "") {
                let special_dir_enumvalue = eval(
                    `GLib.UserDirectory.${special_dir_name}`,
                );

                // If invalid speciale dir name, get_user_special_dir falls back to desktop folder. Here we default to ~/Pictures
                if (special_dir_enumvalue != undefined) {
                    let special_dir_path = GLib.get_user_special_dir(special_dir_enumvalue);
                    dir_path = dir_path.replace(
                        "<" + special_dir_name + ">",
                        special_dir_path,
                    );
                } else {
                    dir_path = dir_path.replace(/\<.*\>/g, "~/Pictures"); // Regex capture all between "< >"
                }
            }

            this.save_path = dir_path.replace("~", GLib.get_home_dir());
            let saveFolder = Gio.file_new_for_path(this.save_path);
            if (!saveFolder.query_exists(null)) {
                saveFolder.make_directory_with_parents(null);
            }

            let dir = Gio.file_new_for_path(this.save_path);
            if (dir.query_exists(null)) {
                let fileEnum = dir.enumerate_children("standard::*", Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = fileEnum.next_file(null)) != null) {
                    let fileType = info.get_file_type();
                    if (fileType != Gio.FileType.DIRECTORY && info.get_content_type() == "image/png") {
                        let filename = info.get_name();
                        let xkcdId = filename.substr(0, filename.indexOf("."));
                        this.cachedXkcds.push(xkcdId);
                    }
                }
                fileEnum.close(null);
            }
            this.cachedXkcds.sort();

            this.updateInProgress = false;

            if (this.cachedXkcds.length == 0) {
                this.refresh(null);
            } else {
                this.refresh(this.cachedXkcds[this.cachedXkcds.length - 1]);
                this._timeoutId = Mainloop.timeout_add_seconds(5, this.refresh.bind(this, null));
            }
        } catch (e) {
            global.logError(e);
        }
        return true;
    },

    on_desklet_clicked(event) {
        try {
            if (event.get_button() == 1) {
                let idx = this.cachedXkcds.indexOf(this.currentXkcd);
                let nextId = idx > 0 ? this.cachedXkcds[idx - 1] : this.currentXkcd - 1;
                if (nextId < 0) {
                    nextId = null;
                }
                this.refresh(nextId);
            }
        } catch (e) {
            global.logError(e);
        }
    },
};

function main(metadata, deskletID) {
    let desklet = new MyDesklet(metadata, deskletID);
    return desklet;
}
