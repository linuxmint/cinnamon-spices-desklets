const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Cairo = imports.cairo;

const UUID = "desktop-clock@burnt1983";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

function _(str) {
    return str;
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}

function imageActor(path, width, height) {
    let pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(path, width, height);
    let image = new Clutter.Image();
    image.set_data(
        pixBuf.get_pixels(),
        pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
        width,
        height,
        pixBuf.get_rowstride()
    );
    let actor = new Clutter.Actor({ width: width, height: height });
    actor.set_content(image);
    return actor;
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bind("size", "size", this._rebuild);
        this.settings.bind("show-seconds", "show_seconds", this._rebuild);
        this.settings.bind("show-digital", "show_digital", this._rebuild);
        this.settings.bind("hour24", "hour24", this._rebuild);
        this.settings.bind("show-ticks", "show_ticks", this._rebuild);
        this.settings.bind("hide-decorations", "hide_decorations", this._rebuild);
        this.settings.bind("face-image", "face_image", this._rebuild);
        this._timeout = 0;
        this._build();
        this._tick();
    },

    _rebuild: function() {
        this._build();
        this._tick();
    },

    _build: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = 0;
        }
        this.setHeader(_("Desktop Clock"));
        this.metadata["prevent-decorations"] = !!this.hide_decorations;
        this._updateDecoration();

        let size = this.size || 180;
        this.box = new St.BoxLayout({ vertical: true, style_class: "desktop-clock-box" });
        this.stage = new St.Widget({ width: size, height: size });

        let facePath = this.face_image;
        if (!facePath || !GLib.file_test(facePath, GLib.FileTest.IS_REGULAR)) {
            facePath = DESKLET_ROOT + "/face.png";
        }
        try {
            this.face = imageActor(facePath, size, size);
            this.stage.add_child(this.face);
        } catch (e) {
            global.log(UUID + " face: " + e);
        }

        this.canvasActor = new Clutter.Actor({ width: size, height: size });
        this.canvas = new Clutter.Canvas();
        this.canvas.set_size(size, size);
        this.canvas.connect("draw", (canvas, cr, w, h) => {
            this._drawHands(cr, w, h);
            return true;
        });
        this.canvasActor.set_content(this.canvas);
        this.stage.add_child(this.canvasActor);

        this.digital = new St.Label({ text: "", style_class: "desktop-clock-digital" });
        this.box.add_actor(this.stage);
        this.box.add_actor(this.digital);
        this.setContent(this.box);
        this.canvas.invalidate();
    },

    _drawHands: function(cr, w, h) {
        let size = Math.min(w, h);
        let cx = w / 2;
        let cy = h / 2;
        let r = size / 2 - 2;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        if (this.show_ticks) {
            cr.setSourceRGBA(1, 1, 1, 0.7);
            for (let i = 0; i < 60; i++) {
                let ang = (i * 6 - 90) * Math.PI / 180;
                let inner = r * (i % 5 === 0 ? 0.88 : 0.93);
                let outer = r * 0.97;
                cr.setLineWidth(i % 5 === 0 ? 2.2 : 1.0);
                cr.moveTo(cx + inner * Math.cos(ang), cy + inner * Math.sin(ang));
                cr.lineTo(cx + outer * Math.cos(ang), cy + outer * Math.sin(ang));
                cr.stroke();
            }
        }

        let now = GLib.DateTime.new_now_local();
        let sec = now.get_second() + now.get_microsecond() / 1000000.0;
        let minute = now.get_minute() + sec / 60.0;
        let hour = (now.get_hour() % 12) + minute / 60.0;

        let hand = function(frac, length, width, col) {
            let ang = (frac * 360 - 90) * Math.PI / 180;
            cr.setSourceRGBA(col[0], col[1], col[2], col[3]);
            cr.setLineWidth(width);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.moveTo(cx, cy);
            cr.lineTo(cx + length * Math.cos(ang), cy + length * Math.sin(ang));
            cr.stroke();
        };
        hand(hour / 12.0, r * 0.52, Math.max(3.5, r * 0.045), [1, 1, 1, 0.95]);
        hand(minute / 60.0, r * 0.78, Math.max(2.4, r * 0.03), [1, 1, 1, 0.95]);
        if (this.show_seconds) {
            hand(sec / 60.0, r * 0.86, Math.max(1.2, r * 0.015), [0.95, 0.25, 0.22, 0.95]);
        }
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.arc(cx, cy, Math.max(3, r * 0.04), 0, Math.PI * 2);
        cr.fill();
    },

    _tick: function() {
        let now = GLib.DateTime.new_now_local();
        let fmt = this.hour24
            ? (this.show_seconds ? "%H:%M:%S" : "%H:%M")
            : (this.show_seconds ? "%I:%M:%S %p" : "%I:%M %p");
        let text = now.format(fmt);
        if (!this.hour24 && text.charAt(0) === "0") {
            text = text.substring(1);
        }
        if (this.digital) {
            this.digital.set_text(text);
            this.digital.visible = !!this.show_digital;
        }
        if (this.canvas) {
            this.canvas.invalidate();
        }
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
        }
        this._timeout = Mainloop.timeout_add(this.show_seconds ? 200 : 1000, () => {
            this._tick();
            return false;
        });
    },

    on_desklet_removed: function() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = 0;
        }
    }
};
