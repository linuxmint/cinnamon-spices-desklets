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
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.desklet_id = desklet_id;
        this.DESKLET_ROOT = DESKLET_ROOT;
        this._currentActor = null;

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

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, Lang.bind(this, function() {
            let parent = this.actor.get_parent();
            if (parent) {
                parent.set_child_at_index(this.actor, 0);
                this._stageAddedId = parent.connect("actor-added", Lang.bind(this, function() {
                    let p = this.actor.get_parent();
                    if (p) p.set_child_at_index(this.actor, 0);
                }));
            }
            return false;
        }));

        this.connect("destroy", Lang.bind(this, this._cleanup));
    },

    on_setting_changed: function() {
        let monitor = Main.layoutManager.monitors[this._monitor] || Main.layoutManager.primaryMonitor;
        this.monitorWidth = monitor.width;
        this.monitorHeight = monitor.height;

        // If a wallpaper is set, validate the extension
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

    _getZoomScale: function() {
        return 1 + ((this.zoomLevel || 0) / 100);
    },

    runDesklet: function() {
        this._cleanup();

        let width  = this.useDefault ? this.monitorWidth  : this.widthCustom;
        let height = this.useDefault ? this.monitorHeight : this.heightCustom;

        this.actor.set_size(width, height);
        this.actor.set_clip(0, 0, width, height);

        let imagePath = (this.wallpaper && this.wallpaper !== "")
            ? this.wallpaper
            : DESKLET_ROOT + "/default.webp";

        this._showStaticImage(imagePath, width, height);
    },

    _showStaticImage: function(imagePath, width, height) {
        const GdkPixbuf = imports.gi.GdkPixbuf;
        const Cogl = imports.gi.Cogl;

        imagePath = this._resolvePath(imagePath);

        let zoom = this._getZoomScale();

        let original;
        try {
            original = GdkPixbuf.Pixbuf.new_from_file(imagePath);
        } catch(e) {
            global.logError("BetterWallpapers: Failed to load image: " + imagePath + " — " + e);
            return;
        }

        let scaleX = width  / original.get_width();
        let scaleY = height / original.get_height();
        let scale  = Math.max(scaleX, scaleY) * zoom;

        let renderW = Math.round(original.get_width()  * scale);
        let renderH = Math.round(original.get_height() * scale);

        let pixbuf;
        try {
            pixbuf = original.scale_simple(renderW, renderH, GdkPixbuf.InterpType.BILINEAR);
        } catch(e) {
            global.logError("BetterWallpapers: Failed to scale image: " + e);
            return;
        }

        let image = new Clutter.Image();
        try {
            image.set_data(
                pixbuf.get_pixels(),
                pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                pixbuf.get_width(),
                pixbuf.get_height(),
                pixbuf.get_rowstride()
            );
        } catch(e) {
            global.logError("BetterWallpapers: Failed to set image data: " + e);
            return;
        }

        let imageActor = new Clutter.Actor({ width: renderW, height: renderH });
        imageActor.set_content(image);
        this._positionInFrame(imageActor, renderW, renderH, width, height);

        global.log("BetterWallpapers DEBUG: actor.x=" + imageActor.x + " actor.y=" + imageActor.y + " renderW=" + renderW + " renderH=" + renderH + " frameW=" + width + " frameH=" + height + " alignment=" + this.alignment);

        this.actor.add_child(imageActor);
        this._currentActor = imageActor;
    },

    _positionInFrame: function(actor, renderW, renderH, frameW, frameH) {
        global.log("BetterWallpapers DEBUG: alignment setting = [" + this.alignment + "]");

        let scaleX = this.mirrored ? -1 : 1;
        let scaleY = this.flipped  ? -1 : 1;

        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(scaleX, scaleY);

        let x = (frameW - renderW) / 2;
        let y = (frameH - renderH) / 2;

        switch (this.alignment) {
            case "left":   x = 0; break;
            case "right":  x = frameW - renderW; break;
            case "top":    y = 0; break;
            case "bottom": y = frameH - renderH; break;
            default: break;
        }

        x = Math.round(x);
        y = Math.round(y);

        global.log("BetterWallpapers DEBUG: setting position to x=" + x + " y=" + y);
        actor.set_position(x, y);

        global.log("BetterWallpapers DEBUG: after set_position, actor.x=" + actor.x + " actor.y=" + actor.y);
    },

    _cleanup: function() {
        if (this._stageAddedId) {
            let parent = this.actor.get_parent();
            if (parent) parent.disconnect(this._stageAddedId);
            this._stageAddedId = null;
        }

        this._currentActor = null;
        this.actor.remove_all_children();
        this.actor.set_content(null);
    },

};