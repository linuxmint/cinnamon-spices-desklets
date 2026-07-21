const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Cairo = imports.cairo;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const Main = imports.ui.main;
const Meta = imports.gi.Meta;

const UUID = "BetterWallpapers@pb103938";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

function MyDesklet(metadata, desklet_id) {
    if (!DESKLET_ROOT.startsWith("/usr/share/")) {
        Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/.local/share/locale");
    }
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.desklet_id = desklet_id;
        this.DESKLET_ROOT = DESKLET_ROOT;

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bindProperty(Settings.BindingDirection.IN, "use-default",      "useDefault",    this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width-choice",     "widthCustom",   this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height-choice",    "heightCustom",  this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "wallpaper-choice", "wallpaper",     this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "mirror-choice",    "mirrored",      this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "flip-choice",      "flipped",       this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "alignment",        "alignment",     this.on_setting_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "zoom-level",       "zoomLevel",     this.on_setting_changed, null);

        let monitor = Main.layoutManager.monitors[this._monitor] || Main.layoutManager.primaryMonitor;
        this.monitorWidth = monitor.width;
        this.monitorHeight = monitor.height;

        this.runDesklet();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, Function.prototype.bind(this, function() {
            let parent = this.actor.get_parent();
            if (parent) {
                parent.set_child_at_index(this.actor, 0);
                this._stageAddedId = parent.connect("actor-added", Function.prototype.bind(this, function() {
                    let p = this.actor.get_parent();
                    if (p) p.set_child_at_index(this.actor, 0);
                }));
            }
            return false;
        }));

        this.connect("destroy", Function.prototype.bind(this, this._cleanup));
    },

    on_setting_changed: function() {
        let monitor = Main.layoutManager.monitors[this._monitor] || Main.layoutManager.primaryMonitor;
        this.monitorWidth = monitor.width;
        this.monitorHeight = monitor.height;

        if (this.wallpaper && this.wallpaper !== "") {
            let resolved = this._resolvePath(this.wallpaper);
            let valid = [".png", ".jpg", ".jpeg", ".webp"].some(function(ext) {
                return resolved.toLowerCase().endsWith(ext);
            });

            if (!valid) {
                global.logError("BetterWallpapers: Unsupported file type: " + resolved);
                this.wallpaper = "";
                return;
            }
        }

        this.runDesklet();
    },

    _resolvePath: function(imagePath) {
        if (imagePath.startsWith("file://")) {
            return GLib.uri_unescape_string(imagePath.replace("file://", ""), null);
        }
        return imagePath;
    },

    runDesklet: function() {
        this._cleanup();

        let width  = this.useDefault ? this.monitorWidth  : this.widthCustom;
        let height = this.useDefault ? this.monitorHeight : this.heightCustom;

        this.actor.set_size(width, height);

        let imagePath = (this.wallpaper && this.wallpaper !== "")
            ? this._resolvePath(this.wallpaper)
            : DESKLET_ROOT + "/default.webp";

        let zoomPercent = (this.zoomLevel || 0);

        let bgSize = "cover";

        let positionMap = {
            "center": "center",
            "top":    "top",
            "bottom": "bottom",
            "left":   "left",
            "right":  "right"
        };
        let bgPosition = positionMap[this.alignment] || "center";

        let scaleX = this.mirrored ? -1 : 1;
        let scaleY = this.flipped  ? -1 : 1;

        let bin = new St.Bin({
            width: width,
            height: height,
            style: `background-image: url("${imagePath}");
                    background-size: ${bgSize};
                    background-position: ${bgPosition};
                    background-repeat: no-repeat;
                    overflow: hidden;
                    `
        });

        bin.set_pivot_point(0.5, 0.5);
        bin.set_scale(scaleX, scaleY);
        bin.set_clip(0, 0, width, height);

        this.actor.add_child(bin);
        this._currentActor = bin;
    },

    _cleanup: function() {
        if (this._stageAddedId) {
            let parent = this.actor.get_parent();
            if (parent) parent.disconnect(this._stageAddedId);
            this._stageAddedId = null;
        }

        this._currentActor = null;
        this.actor.remove_all_children();
    },

};

function isVertical(width, height) {

    if (height > width) {
        return true;
    }

    return false;

}
