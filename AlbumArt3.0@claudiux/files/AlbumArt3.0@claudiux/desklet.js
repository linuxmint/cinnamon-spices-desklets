//"use strict";
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
//Mainloop:
const { timeout_add_seconds,
        timeout_add,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        source_exists,
        source_remove,
        remove_all_sources
} = require("./lib/mainloopTools");
const { to_string } = require("./lib/to-string");


const DESKLET_UUID = "AlbumArt3.0@claudiux";
const HOME_DIR = GLib.get_home_dir();
const DESKLET_DIR = HOME_DIR + "/.local/share/cinnamon/desklets/" + DESKLET_UUID;
const ENABLED_DESKLETS_KEY = 'enabled-desklets';
const XDG_RUNTIME_DIR = GLib.getenv("XDG_RUNTIME_DIR");
const TMP_ALBUMART_DIR = XDG_RUNTIME_DIR + "/AlbumArt";
const ALBUMART_ON = TMP_ALBUMART_DIR + "/ON";
const ALBUMART_PICS_DIR = TMP_ALBUMART_DIR + "/song-art";
const TRANSPARENT_PNG = DESKLET_DIR + "/transparent.png";
const ALBUMART_TITLE_FILE = TMP_ALBUMART_DIR + "/title.txt";

const DEL_SONG_ARTS_SCRIPT = DESKLET_DIR + "/scripts/del_song_arts.sh";
const GET_IMAGE_SIZE_SCRIPT = DESKLET_DIR + "/scripts/get-image-size.sh";


Gettext.bindtextdomain(DESKLET_UUID, HOME_DIR + "/.local/share/locale");
Gettext.bindtextdomain("cinnamon", "/usr/share/locale");

function _(str) {
    let customTrans = Gettext.dgettext(DESKLET_UUID, str);
    if (customTrans !== str && customTrans.length > 0)
        return customTrans;

    customTrans = Gettext.dgettext("cinnamon", str);
    if (customTrans !== str && customTrans.length > 0)
        return customTrans;

    return Gettext.gettext(str);
}


class AlbumArtRadio30 extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this.metadata = metadata;
        this._bin = null;
        this.update_id = null;
        this.old_image_path = null;
        this.isLooping = true;
        this.dir_monitor_loop_is_active = true;

        this.dir = "file://"+ALBUMART_PICS_DIR;
        GLib.mkdir_with_parents(ALBUMART_PICS_DIR, 0o755);
        this.realWidth = 1280;
        this.realHeight = 720;

        this.shuffle = false;
        this.delay = 3;
        this.effect = "";

        this._updateDecoration();

        this.settings = new Settings.DeskletSettings(this, DESKLET_UUID, this.instance_id);
        this.settings.bind('height', 'height', this.on_setting_changed);
        this.settings.bind('width', 'width', this.on_setting_changed);
        this.settings.bind('fade-delay', 'fade_delay', this.on_setting_changed);
        this.settings.bind('fade-effect', 'fade_effect', this.on_setting_changed);
        this.settings.bind("show-title", "show_title", this.on_setting_changed);
        this.settings.bind("style-font-weight", "font_weight", this.on_setting_changed);
        this.settings.bind("style-font-family", "font_family", this.on_setting_changed);
        this.settings.bind("style-font-size", "font_size", this.on_setting_changed);
        this.settings.bind("style-color", "color", this.on_setting_changed);
        this.settings.bind("style-background-color", "background_color", this.on_setting_changed);
        this.settings.bind("desklet-x", "desklet_x");
        this.desklet_x = Math.ceil(this.desklet_x);
        this.settings.bind("desklet-y", "desklet_y");
        this.desklet_y = Math.ceil(this.desklet_y);
        if (this.desklet_x < 0 || this.desklet_x >= global.screen_width) {
            this.desklet_x = global.screen_width - 600;
        }
        if (this.desklet_y < 0 || this.desklet_y >= global.screen_height) {
            this.desklet_y = global.screen_height - 500;
        }

        // enabledDesklets will contain all desklets:
        var enabledDesklets = global.settings.get_strv(ENABLED_DESKLETS_KEY);
        var modify_ENABLED_DESKLETS_KEY = false;
        for (let i = 0; i < enabledDesklets.length; i++) {
            let [name, dId, x, y] = enabledDesklets[i].split(":");
            if (name == DESKLET_UUID) {
                if (Math.ceil(x) != Math.ceil(this.desklet_x)) {
                    modify_ENABLED_DESKLETS_KEY = true;
                    x = "" + this.desklet_x;
                }
                if (Math.ceil(y) != Math.ceil(this.desklet_y)) {
                    modify_ENABLED_DESKLETS_KEY = true;
                    y = "" + this.desklet_y;
                }
                if (modify_ENABLED_DESKLETS_KEY) {
                    enabledDesklets[i] = [name, dId, x, y].join(":");
                }
            }
        }
        if (modify_ENABLED_DESKLETS_KEY) {
            global.settings.set_strv(ENABLED_DESKLETS_KEY, enabledDesklets);
        }

        this.dir_monitor_id = null;
        this.dir_monitor = null;
        this.dir_file = null;

        this.setHeader(_("Album Art"));
        this._setup_dir_monitor();
        this.setup_display();
        this._updateDecoration(); // once again?
    }

    on_setting_changed() {
        this.isLooping = false;

        this._setup_dir_monitor();
        if (this.currentPicture) {
            this.currentPicture.destroy();
        }
        if (this._photoFrame) {
            this._photoFrame.destroy();
        }
        this.isLooping = true;
        this.setup_display();
    }

    _setup_dir_monitor() {
        if (this.dir_monitor_id != null) return;

        this.dir_file = Gio.file_new_for_uri(this.dir);
        this.dir_monitor = this.dir_file.monitor_directory(0, new Gio.Cancellable());
        this.dir_monitor_id = this.dir_monitor.connect('changed', () => { this.dir_monitor_loop(); });
    }

    dir_monitor_loop() {
        if (!this.dir_monitor_loop_is_active) {
            if (this.dir_monitor_id != null) {
                this.dir_monitor.disconnect(this.dir_monitor_id);
                this.dir_monitor.cancel();
            }
            this.dir_monitor_id = null;
            this.dir_monitor = null;
            return false;
        }
        this.on_setting_changed();
        return true;
    }

    on_desklet_removed() {
        if (this.dir_monitor != null) {
            if (this.dir_monitor_id != null) {
                this.dir_monitor.disconnect(this.dir_monitor_id);
            }
            this.dir_monitor.cancel();
        }
        this.dir_monitor_id = null;
        this.dir_monitor = null;
        this.isLooping = false;
        this.dir_monitor_loop_is_active = false;

        if (this._bin != null) {
            if (Tweener.getTweenCount(this._bin) > 0)
                Tweener.removeTweens(this._bin);
            this._bin.destroy_all_children();
            this._bin.destroy();
            this._bin = null;
        }

        var enabledDesklets = global.settings.get_strv(ENABLED_DESKLETS_KEY);
        for (let i = 0; i < enabledDesklets.length; i++) {
            let [name, dId, x, y] = enabledDesklets[i].split(":");
            if (name == DESKLET_UUID) {
                this.desklet_x = Math.ceil(x);
                this.desklet_y = Math.ceil(y);
                break
            }
        }

        remove_all_sources();
    }

    _scan_dir(dir) {
        if (!this.isLooping) return;
        let dir_file = Gio.file_new_for_uri(dir);
        let fileEnum = dir_file.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);

        let info;
        while ((info = fileEnum.next_file(null)) != null) {
            if (info.get_is_hidden()) {
                continue;
            }

            let fileType = info.get_file_type();
            let fileName = dir + '/' + info.get_name();
            if (fileType != Gio.FileType.DIRECTORY) {
                this._images.push(fileName);
            } else {
                this._scan_dir(fileName);
            }
        }

        fileEnum.close(null);
    }

    setup_display() {
        if (!this.isLooping) return;

        this._photoFrame = new Clutter.Actor();
        this._photoFrame.remove_all_children();

        this._titleText = new St.Label({style_class:"albumart30-text", x_align: St.Align.MIDDLE, x_expand: true});
        this._titleText.set_text("");
        if (GLib.file_test(ALBUMART_TITLE_FILE, GLib.FileTest.EXISTS)) {
            this._titleText.set_text(to_string(GLib.file_get_contents(ALBUMART_TITLE_FILE)[1]));
        }
        this._titleText.hide();
        this._titleText.set_position(null, this.height);

        this._bin = new St.Bin();
        this._bin.set_size(this.width, this.height);

        this._images = [];
        if (this._photoFrame && (this._bin != null)) {
            this._photoFrame.add_actor(this._bin);
            this._photoFrame.add_actor(this._titleText);
            this.setContent(this._photoFrame);
        }

        if (this.dir_file != null && this.dir_file.query_exists(null)) {
            this._scan_dir(this.dir);

            this.updateInProgress = false;
            this.currentPicture = null;

            this.update_id = null;
            this._update_loop();
        }
    }

    _update_loop() {
        var enabledDesklets = global.settings.get_strv(ENABLED_DESKLETS_KEY);
        for (let i = 0; i < enabledDesklets.length; i++) {
            let [name, dId, x, y] = enabledDesklets[i].split(":");
            if (name == DESKLET_UUID) {
                if (Math.ceil(x) != Math.ceil(this.desklet_x) || Math.ceil(y) != Math.ceil(this.desklet_y)) {
                    this.desklet_x = Math.ceil(x);
                    this.desklet_y = Math.ceil(y);
                }
                break
            }
        }

        if (!this.isLooping) return false;
        this._update();
        if (this.isLooping)
            this.update_id = timeout_add_seconds(this.delay, () => { this._update_loop() });
        else
            return false;
    }

    _size_pic(image) {
        image.disconnect(image._notif_id);

        let height, width;
        let imageRatio = this.realWidth / this.realHeight;
        let frameRatio = this.width / this.height;

        if (imageRatio > frameRatio) {
            width = this.width;
            height = this.width / imageRatio;
        } else {
            height = this.height;
            width = this.height * imageRatio;
        }

        if (isNaN(height))
            height = -1;
        if (isNaN(width))
            width = -1;

        image.set_size(width, height);
        this._bin.set_size(width, height);
        this._titleText.set_position(null, height);

        image._notif_id = image.connect('notify::size', (image) => { this._size_pic(image); });
    }

    _update() {
        this.emit('notify::size');
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;

        // let image_path;
        // if (!this.shuffle) {
            // image_path = this._images.shift();
            // this._images.push(image_path);
        // } else {
            // image_path = this._images[Math.floor(Math.random() * this._images.length)];
        // }

        let image_path = this._images[0];

        if (this.currentPicture && this.old_image_path && this.old_image_path == image_path) {
            this.updateInProgress = false;
            return;
        }

        this.old_image_path = image_path;

        if (!image_path) {
            this.updateInProgress = false;
            return;
        }

        let image = this._loadImage(image_path);

        if (! GLib.file_test(ALBUMART_ON, GLib.FileTest.EXISTS)) {
            image = null;

            Util.spawnCommandLine("bash -c '%s'".format(DEL_SONG_ARTS_SCRIPT));
            image = this._loadImage(TRANSPARENT_PNG);
            this.realWidth = 1280;
            this.realHeight = 720;
        }

        if (image == null) {
            this.updateInProgress = false;
            return;
        }

        let old_pic = this.currentPicture;
        this.currentPicture = image;
        this.currentPicture.path = image_path;

        if (this.show_title) {
            this._titleText.set_style(null);
            this._titleText.set_style(
                `font-family: ${this.font_family}; font-weight: ${this.font_weight}; font-size: ${this.font_size}; color: ${this.color}; background-color: ${this.background_color};`
            );
            this._titleText.show();
        } else {
            this._titleText.hide();
        }

        if (this.fade_delay > 0) {
            let _transition = "easeNone";
            if (this.fade_effect != "None")
                _transition = "easeOut"+this.fade_effect;
            if (this._bin != null) {
                Tweener.addTween(this._bin, {
                    opacity: 255,
                    time: 0,
                    transition: _transition,
                    onComplete: () => {
                        if (this._bin != null) {
                            this._bin.set_child(this.currentPicture);
                            Tweener.addTween(this._bin, {
                                opacity: 0,
                                time: this.fade_delay,
                                transition: _transition,
                            });
                        }
                    }
                });

                Tweener.addTween(this._titleText, {
                    opacity: 255,
                    time: 0,
                    transition: _transition,
                    onComplete: () => {
                        Tweener.addTween(this._titleText, {
                            opacity: 0,
                            time: this.fade_delay,
                            transition: _transition,
                        });
                    }
                });
            }
        } else {
            if (this._bin != null) this._bin.set_child(this.currentPicture);
        }
        this.updateInProgress = false;
    }

    on_desklet_clicked(event) {
        try {
            if (event.get_button() == 1) {
                this.on_setting_changed();
            } else if (event.get_button() == 2) {
                if (this.currentPicture != null)
                    Util.spawn(['xdg-open', this.currentPicture.path]);
            }
        } catch (e) {
        }
    }

    /**
     * on_desklet_added_to_desktop:
     *
     * This function is called by deskletManager when the desklet is added to the desktop.
     */
     on_desklet_added_to_desktop(userEnabled) {
        if (this.settings.getValue("enable-at-startup"))
            Util.spawn(["touch", ALBUMART_ON]);
        // Set "Display Album Art at full size" menu item, in top position:
        let displayCoverArtInRealSize = new PopupMenu.PopupIconMenuItem(_("Display Album Art at full size"), "view-image-generic-symbolic", St.IconType.SYMBOLIC);
        displayCoverArtInRealSize.connect("activate", (event) => {
            if (this.currentPicture != null)
                GLib.spawn_command_line_async("xdg-open "+this.currentPicture.path);
        });
        this._menu.addMenuItem(displayCoverArtInRealSize, 0); // 0 for top position.

        let removeThisImage = new PopupMenu.PopupIconMenuItem(_("Don't display this image"), "dont-show-symbolic", St.IconType.SYMBOLIC);
        removeThisImage.connect("activate", (event) => {
            Util.spawnCommandLine("bash -c '%s'".format(DEL_SONG_ARTS_SCRIPT));
            this.image_path = TRANSPARENT_PNG;
            this.realWidth = 1280;
            this.realHeight = 720;
            this._update();
        });
        this._menu.addMenuItem(removeThisImage, 1);

        let stopDesklet = new PopupMenu.PopupIconMenuItem(_("Don't display any new image"), "dont-show-any-symbolic", St.IconType.SYMBOLIC);
        stopDesklet.connect("activate", (event) => {
            Util.spawnCommandLine("bash -c '%s'".format(DEL_SONG_ARTS_SCRIPT));
            GLib.spawn_command_line_async(`rm -f ${ALBUMART_ON}`);
            this.image_path = TRANSPARENT_PNG;
            this.realWidth = 1280;
            this.realHeight = 720;
            this._update();
        });
        this._menu.addMenuItem(stopDesklet, 2);
    }

    _loadImage(filePath) {
        let image;
        if (! GLib.file_test(ALBUMART_ON, GLib.FileTest.EXISTS)) {
            filePath = "file://" + TRANSPARENT_PNG;
            this.realWidth = 1280;
            this.realHeight = 720;
        }
        try {
            let command = GET_IMAGE_SIZE_SCRIPT + " " + filePath;
            Util.spawnCommandLineAsyncIO(command, (stdout, stderr, exitCode) => {
                if (exitCode === 0) {
                    [this.realWidth, this.realHeight] = stdout.split("x");
                } else {
                    this.realWidth = 1280;
                    this.realHeight = 720;
                }
            });
            image = St.TextureCache.get_default().load_uri_async(filePath, this.width, this.height);

            image._notif_id = image.connect('notify::size', (image) => { this._size_pic(image); });

            this._size_pic(image);

            return image;
        } catch (e) {
            // Probably a non-image is in the folder
            return null;
        }
    }
}

function main(metadata, desklet_id) {
    return new AlbumArtRadio30(metadata, desklet_id);
}
