const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const UUID = "memload@spekks";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;

// Translation support
function _(str) {
    return Gettext.dgettext(UUID, str);
}

function MemloadDesklet(metadata, deskletId) {
    // Initialize translations
    if (!DESKLET_ROOT.startsWith("/usr/share/")) {
        Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
    }
    this._init(metadata, deskletId);
}

function main(metadata, deskletId) {
    return new MemloadDesklet(metadata, deskletId);
}

MemloadDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        // Initialize state
        this.timeout = null;
        this.isDestroyed = false;

        // Bind settings
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "type", "type", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "design", "design", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "text-view", "textView", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-color", "fontColor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-color", "useCustomColor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circleColor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-background", "showBackground", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "onclick-action", "onclickAction", this.onSettingChanged);

        // Persistent random color (stored in settings)
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-color-r", "randomColorR", null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-color-g", "randomColorG", null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-color-b", "randomColorB", null);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "random-color-generated", "randomColorGenerated", null);

        // Generate random color once and persist it
        if (!this.randomColorGenerated) {
            this.randomColorR = Math.random();
            this.randomColorG = Math.random();
            this.randomColorB = Math.random();
            this.randomColorGenerated = true;
        }

        // Base sizes
        this.baseSize = 150;
        this.baseFontSize = 22;
        this.baseSubFontSize = 13;

        this.setupUI();
    },

    setupUI: function() {
        this.canvas = new Clutter.Actor();
        this.textPercent = new St.Label({style_class: "memload-text"});
        this.textSub1 = new St.Label({style_class: "memload-text"});
        this.textSub2 = new St.Label({style_class: "memload-text"});

        this.canvas.add_actor(this.textPercent);
        this.canvas.add_actor(this.textSub1);
        this.canvas.add_actor(this.textSub2);
        this.setContent(this.canvas);

        this.refreshDecoration();
        this.update();
    },

    update: function() {
        if (this.isDestroyed) return;

        this.refreshMemory();
        this.timeout = Mainloop.timeout_add_seconds(this.refreshInterval, Lang.bind(this, this.update));
    },

    refreshMemory: function() {
        if (this.isDestroyed) return;

        let file = Gio.file_new_for_path("/proc/meminfo");
        file.load_contents_async(null, Lang.bind(this, function(file, response) {
            // Guard against callback firing after desklet is destroyed
            if (this.isDestroyed) return;

            try {
                let [success, contents, tag] = file.load_contents_finish(response);
                if (success) {
                    let mem = contents.toString();
                    let used = 0, total = 0, free = 0;

                    if (this.type === "swap") {
                        let totalMatch = mem.match(/SwapTotal:\s*(\d+)/);
                        let freeMatch = mem.match(/SwapFree:\s*(\d+)/);

                        if (totalMatch && freeMatch) {
                            total = parseInt(totalMatch[1]) * 1024;
                            free = parseInt(freeMatch[1]) * 1024;
                        }
                    } else {
                        let totalMatch = mem.match(/MemTotal:\s*(\d+)/);
                        let availMatch = mem.match(/MemAvailable:\s*(\d+)/);

                        if (totalMatch && availMatch) {
                            total = parseInt(totalMatch[1]) * 1024;
                            free = parseInt(availMatch[1]) * 1024;
                        }
                    }

                    used = total - free;
                    let percent = total > 0 ? Math.round(used * 100 / total) : 0;
                    this.redraw(percent, used, free, total);
                }
            } catch (e) {
                global.logError(UUID + ": Error reading memory info: " + e.toString());
            }
        }));
    },

    redraw: function(percent, used, free, total) {
        if (this.isDestroyed) return;

        let size = this.baseSize * this.scaleSize;
        let fontSize = Math.round(this.baseFontSize * this.scaleSize);
        let subFontSize = Math.round(this.baseSubFontSize * this.scaleSize);

        // Get circle color
        let color = this.getCircleColor();

        // Draw the circle
        let canvas = new Clutter.Canvas();
        canvas.set_size(size * global.ui_scale, size * global.ui_scale);
        canvas.connect("draw", Lang.bind(this, function(canvas, cr, width, height) {
            cr.save();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();
            cr.setOperator(Cairo.Operator.OVER);
            cr.scale(width, height);
            cr.translate(0.5, 0.5);

            let offset = Math.PI * 0.5;
            let start = 0 - offset;
            let end = ((percent * Math.PI * 2) / 100) - offset;

            if (this.design === "thin") {
                this.drawThin(cr, start, end, color);
            } else if (this.design === "compact") {
                this.drawCompact(cr, start, end, color);
            } else {
                this.drawThick(cr, start, end, color);
            }

            return true;
        }));
        canvas.invalidate();
        this.canvas.set_content(canvas);
        this.canvas.set_size(size * global.ui_scale, size * global.ui_scale);

        // Update text
        let sub1Text, sub2Text;
        let name = this.type === "swap" ? _("Swap") : _("RAM");

        switch (this.textView) {
            case "free-total":
                sub1Text = this.formatBytes(free);
                sub2Text = this.formatBytes(total);
                break;
            case "name-used":
                sub1Text = name;
                sub2Text = this.formatBytes(used);
                break;
            case "name-free":
                sub1Text = name;
                sub2Text = this.formatBytes(free);
                break;
            default: // used-total
                sub1Text = this.formatBytes(used);
                sub2Text = this.formatBytes(total);
        }

        let textY = Math.round((size * global.ui_scale) / 2 - fontSize * 1.26 * global.ui_scale);
        this.textPercent.set_position(0, textY);
        this.textPercent.set_text(percent + "%");
        this.textPercent.style = this.getTextStyle(fontSize, size);

        let sub1Y = Math.round(textY + fontSize * 1.25 * global.ui_scale);
        this.textSub1.set_position(0, sub1Y);
        this.textSub1.set_text(sub1Text);
        this.textSub1.style = this.getTextStyle(subFontSize, size);

        let sub2Y = Math.round(sub1Y + subFontSize * 1.25 * global.ui_scale);
        this.textSub2.set_position(0, sub2Y);
        this.textSub2.set_text(sub2Text);
        this.textSub2.style = this.getTextStyle(subFontSize, size);
    },

    drawThin: function(cr, start, end, color) {
        if (this.showBackground) {
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.045);
            cr.arc(0, 0, 0.45, 0, Math.PI * 2);
            cr.stroke();
        }
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(color.r, color.g, color.b, 1);
        cr.setLineWidth(0.045);
        cr.arc(0, 0, 0.45, start, end);
        cr.stroke();
    },

    drawCompact: function(cr, start, end, color) {
        if (this.showBackground) {
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.4);
            cr.arc(0, 0, 0.2, 0, Math.PI * 2);
            cr.stroke();
        }
        cr.setSourceRGBA(color.r, color.g, color.b, 1);
        cr.setLineWidth(0.4);
        cr.arc(0, 0, 0.2, start, end);
        cr.stroke();
    },

    drawThick: function(cr, start, end, color) {
        if (this.showBackground) {
            cr.setSourceRGBA(1, 1, 1, 0.2);
            cr.setLineWidth(0.19);
            cr.arc(0, 0, 0.4, 0, Math.PI * 2);
            cr.stroke();
        }
        cr.setSourceRGBA(color.r, color.g, color.b, 1);
        cr.setLineWidth(0.19);
        cr.arc(0, 0, 0.4, start, end);
        cr.stroke();
        cr.setSourceRGBA(0, 0, 0, 0.1446);
        cr.setLineWidth(0.048);
        cr.arc(0, 0, 0.329, start, end);
        cr.stroke();
    },

    getCircleColor: function() {
        if (this.useCustomColor) {
            try {
                let match = this.circleColor.match(/\((.*?)\)/);
                if (match && match[1]) {
                    let colors = match[1].split(",");
                    return {
                        r: parseInt(colors[0]) / 255,
                        g: parseInt(colors[1]) / 255,
                        b: parseInt(colors[2]) / 255
                    };
                }
            } catch (e) {
                global.logError(UUID + ": Error parsing color: " + e.toString());
            }
        }
        // Return persistent random color
        return {
            r: this.randomColorR,
            g: this.randomColorG,
            b: this.randomColorB
        };
    },

    getTextStyle: function(fontSize, width) {
        return "font-size: " + fontSize + "px; " +
               "width: " + width + "px; " +
               "color: " + this.fontColor + ";";
    },

    formatBytes: function(bytes) {
        if (bytes <= 0) return "0 B";
        const units = ["B", "K", "M", "G", "T"];
        const k = 1024;
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + units[i];
    },

    refreshDecoration: function() {
        let header = this.type === "swap" ? _("Swap") : _("Memory");
        this.setHeader(header);
        this.metadata["prevent-decorations"] = this.hideDecorations;
        this._updateDecoration();
    },

    onSettingChanged: function() {
        this.refreshDecoration();
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
            this.timeout = null;
        }
        this.update();
    },

    on_desklet_clicked: function() {
        if (this.onclickAction === "sysmonitor") {
            Util.spawnCommandLine("gnome-system-monitor -r");
        }
    },

    on_desklet_removed: function() {
        this.isDestroyed = true;
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
            this.timeout = null;
        }
    }
};
