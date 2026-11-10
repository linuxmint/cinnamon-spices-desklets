const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Pango    = imports.gi.Pango;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext  = imports.gettext;

const UUID = "promesas-biblicas@largacha";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");
function _(str) { return Gettext.dgettext(UUID, str); }

let DESKLET_DIR = ".";
for (let key in imports.ui.deskletManager.deskletMeta) {
    if (key === UUID) { DESKLET_DIR = imports.ui.deskletManager.deskletMeta[key].path; break; }
}
imports.searchPath.unshift(DESKLET_DIR);

const PromesasModule = imports.promesas;

const ThemeColors = {
    "stained-glass": { bg: "rgba(15, 27, 61, 1.0)", text: "rgba(253, 246, 227, 1.0)", accent: "rgba(245, 215, 110, 1.0)" },
    "classic": { bg: "rgba(30, 30, 30, 1.0)", text: "rgba(255, 255, 255, 1.0)", accent: "rgba(100, 181, 246, 1.0)" },
    "sunset": { bg: "rgba(40, 15, 10, 1.0)", text: "rgba(255, 235, 220, 1.0)", accent: "rgba(255, 140, 80, 1.0)" },
    "neon": { bg: "rgba(5, 10, 20, 1.0)", text: "rgba(200, 240, 255, 1.0)", accent: "rgba(0, 255, 200, 1.0)" }
};

const PROMESA_FALLBACK = {
    text: _("No temas, porque yo estoy contigo..."),
    author: _("Isaías 41:10")
};

function _dateHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (((h << 5) >>> 0) + h + str.charCodeAt(i)) >>> 0;
    return h;
}

function _isDarkTheme() {
    try {
        let settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
        let theme = settings.get_string("gtk-theme") || "";
        return /dark/i.test(theme);
    } catch(e) { return false; }
}

function PromesasDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

PromesasDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.actor.set_style("background-color: transparent; border: none; box-shadow: none; border-image: none;");

        this._promesas = (Array.isArray(PromesasModule.PROMESAS) && PromesasModule.PROMESAS.length)
            ? PromesasModule.PROMESAS : [PROMESA_FALLBACK];

        this._refreshTimer = null;
        this._manualOffset = 0;
        
        this.themeMode = "custom";
        this.themeName = "stained-glass";
        this.bgOpacity = 0;
        this.fontFamily = "DejaVu Serif";
        this.fontSizeQuote = 14;
        this.fontSizeAuthor = 11;
        this.fontItalic = true;
        this.textAlign = "center";
        this.deskletWidth = 400;
        this.scale = 1.0;
        this.cornerRadius = 20;
        this.shadowEnabled = true;
        this.showOrnament = true;
        this.showDivider = true;
        this.showRefreshButton = true;
        this.refreshFrequency = "daily";

        this._loadSettings(desklet_id);
        this._buildUI();
        this._applyStyles();
        this._showPromesa();
        this._scheduleNextRefresh();
    },

    _loadSettings: function(desklet_id) {
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        let b = this._settings.bindProperty.bind(this._settings);
        let cb = () => { this._applyStyles(); };

        b(Settings.BindingDirection.IN, "themeMode", "themeMode", cb);
        b(Settings.BindingDirection.IN, "themeName", "themeName", cb);
        b(Settings.BindingDirection.IN, "bgOpacity", "bgOpacity", cb);
        b(Settings.BindingDirection.IN, "fontFamily", "fontFamily", cb);
        b(Settings.BindingDirection.IN, "fontSizeQuote", "fontSizeQuote", cb);
        b(Settings.BindingDirection.IN, "fontSizeAuthor", "fontSizeAuthor", cb);
        b(Settings.BindingDirection.IN, "fontItalic", "fontItalic", cb);
        b(Settings.BindingDirection.IN, "textAlign", "textAlign", cb);
        b(Settings.BindingDirection.IN, "deskletWidth", "deskletWidth", cb);
        b(Settings.BindingDirection.IN, "scale", "scale", cb);
        b(Settings.BindingDirection.IN, "cornerRadius", "cornerRadius", cb);
        b(Settings.BindingDirection.IN, "shadowEnabled", "shadowEnabled", cb);
        b(Settings.BindingDirection.IN, "showOrnament", "showOrnament", cb);
        b(Settings.BindingDirection.IN, "showDivider", "showDivider", cb);
        b(Settings.BindingDirection.IN, "showRefreshButton", "showRefreshButton", cb);
        b(Settings.BindingDirection.IN, "refreshFrequency", "refreshFrequency", cb);
    },

    _buildUI: function() {
        this._container = new St.BoxLayout({ vertical: true });
        this._card = new St.BoxLayout({ vertical: true, style_class: "promesas-card" });
        this._ornament = new St.Label({ text: "✦", style_class: "promesas-ornament" });
        
        this._quoteLabel = new St.Label({ text: "", x_expand: true });
        this._quoteLabel.clutter_text.line_wrap      = true;
        this._quoteLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._quoteLabel.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE; 
        
        this._divider = new St.Widget({ x_expand: true });
        this._authorLabel = new St.Label({ text: "" });
        
        this._refreshButton = new St.Button({ label: "↻", style_class: "promesas-refresh-button" });
        this._refreshButton.connect("clicked", () => {
            this._manualOffset++;
            this._showPromesa();
        });

        let footer = new St.BoxLayout({ vertical: false, style_class: "promesas-footer" });
        this._authorLabel.x_expand = true;
        footer.add_child(this._authorLabel);
        footer.add_child(this._refreshButton);

        this._card.add_child(this._ornament);
        this._card.add_child(this._quoteLabel);
        this._card.add_child(this._divider);
        this._card.add_child(footer);
        this._container.add_child(this._card);
        this.setContent(this._container);
    },

    _applyStyles: function() {
        let theme = ThemeColors[this.themeName] || ThemeColors["stained-glass"];
        
        let bgColor, textColor, accentColor;

        if (this.themeMode === "auto") {
            let isDark = _isDarkTheme();
            bgColor = isDark ? "rgba(20,20,20,1)" : "rgba(250,250,250,1)";
            textColor = isDark ? "rgba(255,255,255,1)" : "rgba(20,20,20,1)";
            accentColor = theme.accent;
        } else if (this.themeMode === "dark") {
            bgColor = "rgba(20,20,20,1)";
            textColor = "rgba(255,255,255,1)";
            accentColor = theme.accent;
        } else if (this.themeMode === "light") {
            bgColor = "rgba(250,250,250,1)";
            textColor = "rgba(20,20,20,1)";
            accentColor = theme.accent;
        } else {
            bgColor = theme.bg;
            textColor = theme.text;
            accentColor = theme.accent;
        }

        // Opacidad de 0 a 100
        let alpha = this.bgOpacity / 100;

        let finalBg = "transparent";
        if (alpha > 0.05) {
            let m = bgColor.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) finalBg = "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + alpha + ")";
        }

        let cardStyle = 
            "background-color: " + finalBg + ";" +
            "border-radius: " + (this.cornerRadius + 6) + "px;" +
            "padding: 24px 28px 18px 28px;" +
            "width: " + this.deskletWidth + "px;";

        if (alpha > 0.05) {
            cardStyle += "border: 1px solid " + accentColor + ";";
            if (this.shadowEnabled) {
                cardStyle += "box-shadow: 0px 10px 30px rgba(0,0,0,0.6);";
            }
        } else {
            cardStyle += "border: none; box-shadow: none;";
        }

        this._card.set_style(cardStyle);

        let textShadow = alpha <= 0.05 
            ? "0px 2px 4px rgba(0,0,0,1), 0px 0px 10px rgba(0,0,0,0.9), 0px 0px 20px rgba(0,0,0,0.7)" 
            : "0px 2px 5px rgba(0,0,0,0.8)";

        let italic = this.fontItalic ? "italic" : "normal";
        let align = this.textAlign || "center";

        this._quoteLabel.set_style(
            "color: " + textColor + ";" +
            "font-family: \"" + this.fontFamily + "\";" +
            "font-size: " + (this.fontSizeQuote * this.scale) + "pt;" +
            "font-style: " + italic + ";" +
            "line-height: 1.6;" +
            "text-align: " + align + ";" +
            "text-shadow: " + textShadow + ";" 
        );

        this._ornament.visible = this.showOrnament;
        this._ornament.set_style("color: " + accentColor + "; font-size: " + (18 * this.scale) + "pt; text-align: " + align + "; margin-bottom: 10px; text-shadow: " + textShadow + ";");
        
        this._divider.visible = this.showDivider;
        if (this.showDivider) {
            this._divider.set_style("background-image: linear-gradient(to right, transparent, " + accentColor + ", transparent); background-color: transparent; height: 2px; margin: 18px 0 12px 0; opacity: 0.6;");
        }

        this._authorLabel.set_style("color: " + accentColor + "; font-family: \"" + this.fontFamily + "\"; font-size: " + (this.fontSizeAuthor * this.scale) + "pt; font-weight: bold; text-shadow: " + textShadow + ";");
        this._refreshButton.visible = this.showRefreshButton;
        this._refreshButton.set_style("color: " + accentColor + "; background: transparent; border: none; font-size: " + (16 * this.scale) + "pt; text-shadow: " + textShadow + ";");
    },

    _showPromesa: function() {
        let d = new Date();
        let dateStr = d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate();
        let base = _dateHash(dateStr) % this._promesas.length;
        let idx = (base + this._manualOffset) % this._promesas.length;
        let q = this._promesas[idx] || PROMESA_FALLBACK;

        this._quoteLabel.set_text("“" + q.text + "”");
        this._authorLabel.set_text("— " + q.author);
    },

    _scheduleNextRefresh: function() {
        if (this._refreshTimer) Mainloop.source_remove(this._refreshTimer);
        this._refreshTimer = Mainloop.timeout_add_seconds(3600, () => {
            this._showPromesa();
            return true;
        });
    },

    on_desklet_removed: function() {
        if (this._refreshTimer) Mainloop.source_remove(this._refreshTimer);
    }
};

function main(metadata, desklet_id) {
    return new PromesasDesklet(metadata, desklet_id);
}