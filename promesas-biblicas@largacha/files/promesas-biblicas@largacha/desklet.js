// Promesas Bíblicas Desklet — promesas-biblicas@largacha

const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Pango    = imports.gi.Pango;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext  = imports.gettext;

const UUID = "promesas-biblicas@largacha";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

let DESKLET_DIR = ".";
for (let key in imports.ui.deskletManager.deskletMeta) {
    if (key === UUID) {
        DESKLET_DIR = imports.ui.deskletManager.deskletMeta[key].path;
        break;
    }
}
imports.searchPath.unshift(DESKLET_DIR);
const PromesasModule = imports.promesas;

const PROMESA_FALLBACK = {
    text:   _("No temas, porque yo estoy contigo; no desmayes, porque yo soy tu Dios que te esfuerzo; siempre te ayudaré, siempre te sustentaré con la diestra de mi justicia."),
    author: _("Isaías 41:10"),
    source: _("Antiguo Testamento")
};

const PRESET_THEMES = {
    "parchment": {
        bg:      "rgba(244, 228, 193, 0.95)",
        text:    "rgba(58, 42, 24, 1.0)",
        accent:  "rgba(139, 111, 63, 1.0)",
        border:  "rgba(139, 111, 63, 0.8)",
        divider: "rgba(139, 111, 63, 0.7)",
        fontFamily: "DejaVu Serif",
        italic: true
    },
    "stained-glass": {
        bg:      "rgba(15, 27, 61, 0.95)",
        text:    "rgba(253, 246, 227, 1.0)",
        accent:  "rgba(245, 215, 110, 1.0)",
        border:  "rgba(184, 146, 58, 0.9)",
        divider: "rgba(245, 215, 110, 0.8)",
        fontFamily: "DejaVu Serif",
        italic: true
    },
    "modern": {
        bg:      "rgba(250, 250, 247, 0.98)",
        text:    "rgba(42, 42, 42, 1.0)",
        accent:  "rgba(201, 161, 74, 1.0)",
        border:  "rgba(224, 217, 200, 0.0)",
        divider: "rgba(224, 217, 200, 0.8)",
        fontFamily: "Cantarell",
        italic: false
    }
};

const AUTO_PALETTES = {
    light: {
        bg:      "rgba(250, 250, 247, 0.95)",
        text:    "rgba(42, 42, 42, 1.0)",
        accent:  "rgba(160, 124, 48, 1.0)",
        border:  "rgba(200, 190, 170, 0.7)",
        divider: "rgba(200, 190, 170, 0.8)"
    },
    dark: {
        bg:      "rgba(28, 28, 32, 0.92)",
        text:    "rgba(240, 232, 216, 1.0)",
        accent:  "rgba(212, 175, 90, 1.0)",
        border:  "rgba(80, 70, 50, 0.6)",
        divider: "rgba(212, 175, 90, 0.6)"
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getDateString() {
    let d = new Date();
    return d.getFullYear()
        + "-" + String(d.getMonth() + 1).padStart(2, "0")
        + "-" + String(d.getDate()).padStart(2, "0");
}

function _dateHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = (((h << 5) >>> 0) + h + str.charCodeAt(i)) >>> 0;
    }
    return h;
}

function _isDesktopDark() {
    try {
        let s = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
        let theme = s.get_string("gtk-theme") || "";
        let dark = /dark/i.test(theme);
        s.run_dispose();
        return dark;
    } catch (e) {
        return false;
    }
}

function _resolveThemeMode(mode) {
    if (mode === "auto") return _isDesktopDark() ? "dark" : "light";
    return mode;
}

// Convierte un color del colorchooser ([r,g,b,a] con 0..1) a string CSS.
// También acepta strings (#hex, rgb(), rgba()) y los devuelve tal cual.
function _colorToCss(color, fallback) {
    if (!color) return fallback || "rgba(0,0,0,1)";

    // Array [r, g, b, a]
    if (Array.isArray(color) && color.length >= 3) {
        let r = Math.round((color[0] || 0) * 255);
        let g = Math.round((color[1] || 0) * 255);
        let b = Math.round((color[2] || 0) * 255);
        let a = (color.length >= 4 && typeof color[3] === "number") ? color[3] : 1;
        return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    }

    // String
    if (typeof color === "string") {
        return color;
    }

    return fallback || "rgba(0,0,0,1)";
}

// Reemplaza el canal alfa de un rgba() por el valor indicado.
function _withOpacity(cssColor, opacity) {
    if (!cssColor) return "rgba(0,0,0," + opacity + ")";
    let m = cssColor.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
        return "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + opacity + ")";
    }
    if (cssColor.charAt(0) === "#") {
        let hex = cssColor.slice(1);
        if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
        let r = parseInt(hex.substr(0, 2), 16);
        let g = parseInt(hex.substr(2, 2), 16);
        let b = parseInt(hex.substr(4, 2), 16);
        return "rgba(" + r + "," + g + "," + b + "," + opacity + ")";
    }
    return cssColor;
}

// ── Desklet ───────────────────────────────────────────────────────────────────

function PromesasBiblicasDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

PromesasBiblicasDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._promesas = (Array.isArray(PromesasModule.PROMESAS) && PromesasModule.PROMESAS.length)
            ? PromesasModule.PROMESAS
            : [PROMESA_FALLBACK];
        this._refreshTimer = null;
        this._manualOffset = 0;
        this._lastDate     = null;
        this._themeSignal  = null;

        this.themeMode         = "auto";
        this.baseTheme         = "stained-glass";
        this.bgOpacity         = 92;
        this.cornerRadius      = 10;
        this.colorBg           = null;
        this.colorText         = null;
        this.colorAccent       = null;
        this.colorBorder       = null;
        this.colorDivider      = null;
        this.fontQuote         = "DejaVu Serif 13";
        this.fontSizeQuote     = 13;
        this.fontItalicQuote   = true;
        this.fontAuthor        = "DejaVu Serif 10";
        this.fontSizeAuthor    = 10;
        this.borderWidth       = 1;
        this.shadowEnabled     = true;
        this.showOrnament      = true;
        this.showDivider       = true;
        this.textAlign         = "left";
        this.deskletWidth      = 380;
        this.showSource        = true;
        this.showRefreshButton = true;
        this.refreshFrequency  = "daily";

        this._loadSettings(desklet_id);
        this._buildUI();
        this._applyAllStyles();
        this._showPromesa();
        this._scheduleNextRefresh();
        this._watchDesktopTheme();
    },

    _loadSettings: function(desklet_id) {
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        let b = this._settings.bindProperty.bind(this._settings);
        let cb = () => this._onSettingChanged();

        b(Settings.BindingDirection.IN, "theme-mode",          "themeMode",         cb);
        b(Settings.BindingDirection.IN, "base-theme",          "baseTheme",         cb);
        b(Settings.BindingDirection.IN, "bg-opacity",          "bgOpacity",         cb);
        b(Settings.BindingDirection.IN, "corner-radius",       "cornerRadius",      cb);
        b(Settings.BindingDirection.IN, "color-bg",            "colorBg",           cb);
        b(Settings.BindingDirection.IN, "color-text",          "colorText",         cb);
        b(Settings.BindingDirection.IN, "color-accent",        "colorAccent",       cb);
        b(Settings.BindingDirection.IN, "color-border",        "colorBorder",       cb);
        b(Settings.BindingDirection.IN, "color-divider",       "colorDivider",      cb);
        b(Settings.BindingDirection.IN, "font-quote",          "fontQuote",         cb);
        b(Settings.BindingDirection.IN, "font-size-quote",     "fontSizeQuote",     cb);
        b(Settings.BindingDirection.IN, "font-italic-quote",   "fontItalicQuote",   cb);
        b(Settings.BindingDirection.IN, "font-author",         "fontAuthor",        cb);
        b(Settings.BindingDirection.IN, "font-size-author",    "fontSizeAuthor",    cb);
        b(Settings.BindingDirection.IN, "border-width",        "borderWidth",       cb);
        b(Settings.BindingDirection.IN, "shadow-enabled",      "shadowEnabled",     cb);
        b(Settings.BindingDirection.IN, "show-ornament",       "showOrnament",      cb);
        b(Settings.BindingDirection.IN, "show-divider",        "showDivider",       cb);
        b(Settings.BindingDirection.IN, "text-align",          "textAlign",         cb);
        b(Settings.BindingDirection.IN, "desklet-width",       "deskletWidth",      cb);
        b(Settings.BindingDirection.IN, "show-source",         "showSource",        cb);
        b(Settings.BindingDirection.IN, "show-refresh-button", "showRefreshButton", cb);
        b(Settings.BindingDirection.IN, "refresh-frequency",   "refreshFrequency",  cb);
    },

    _onSettingChanged: function() {
        this._applyAllStyles();
        this._showPromesa();
        this._scheduleNextRefresh();
    },

    _watchDesktopTheme: function() {
        try {
            let s = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
            this._themeSignal = s.connect("changed::gtk-theme", () => {
                if (this.themeMode === "auto") {
                    this._applyAllStyles();
                }
            });
            this._themeSettings = s;
        } catch (e) {
            global.log("[promesas-biblicas] No se pudo escuchar cambios de tema: " + e);
        }
    },

    _buildUI: function() {
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "promesas-desklet"
        });

        this._ornament = new St.Label({
            style_class: "promesas-ornament",
            text: "\u2726"
        });

        this._quoteLabel = new St.Label({
            style_class: "promesas-quote-text",
            text: ""
        });
        this._quoteLabel.clutter_text.line_wrap      = true;
        this._quoteLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._quoteLabel.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;

        this._divider = new St.Widget({
            style_class: "promesas-divider",
            x_expand: true
        });

        this._authorLabel = new St.Label({ style_class: "promesas-author", text: "" });
        this._sourceLabel = new St.Label({ style_class: "promesas-source", text: "" });

        let authorBox = new St.BoxLayout({ vertical: true });
        authorBox.add_child(this._authorLabel);
        authorBox.add_child(this._sourceLabel);
        authorBox.x_expand = true;

        this._refreshButton = new St.Button({
            style_class: "promesas-refresh-button",
            label: "\u21BB"
        });
        this._refreshButton.connect("clicked", () => {
            this._manualOffset++;
            global.log("[promesas-biblicas] Avance manual → offset " + this._manualOffset);
            this._showPromesa();
        });

        let footer = new St.BoxLayout({ vertical: false, style_class: "promesas-footer" });
        footer.add_child(authorBox);
        footer.add_child(this._refreshButton);

        this._container.add_child(this._ornament);
        this._container.add_child(this._quoteLabel);
        this._container.add_child(this._divider);
        this._container.add_child(footer);

        this.setContent(this._container);
    },

    _applyAllStyles: function() {
        if (!this._container) return;

        let pal = this._resolvePalette();

        // Paleta ya viene en formato CSS (rgba).
        let shadow = this.shadowEnabled
            ? "box-shadow: 0px 6px 22px rgba(0,0,0,0.55);"
            : "box-shadow: none;";

        let borderStyle = this.borderWidth > 0
            ? "border: " + this.borderWidth + "px solid " + pal.border + ";"
            : "border: none;";

        let opacity = this.bgOpacity / 100;
        let bg = _withOpacity(pal.bg, opacity);

        let containerStyle =
            "background-color: " + bg + ";" +
            "border-radius: " + this.cornerRadius + "px;" +
            "padding: 18px 20px 14px 20px;" +
            "width: " + (this.deskletWidth || 380) + "px;" +
            borderStyle +
            shadow;

        if (this._alignLabel() === "center") {
            containerStyle += "align-items: center;";
        }

        this._container.set_style(containerStyle);

        // Adorno
        this._ornament.visible = this.showOrnament;
        this._ornament.set_style(
            "color: " + pal.accent + ";" +
            "font-size: 14pt;" +
            "margin-bottom: 4px;" +
            "text-align: " + this._alignLabel() + ";"
        );

        // Cita
        let fontFamily = this._familyFromFontString(this.fontQuote || pal.fontFamily);
        let italic = (this.fontItalicQuote !== false && pal.italic !== false) ? "italic" : "normal";

        this._quoteLabel.set_style(
            "color: " + pal.text + ";" +
            "font-family: \"" + fontFamily + "\", Georgia, serif;" +
            "font-size: " + this.fontSizeQuote + "pt;" +
            "font-style: " + italic + ";" +
            "line-height: 1.45;" +
            "text-align: " + this._alignLabel() + ";"
        );

        // Divisor
        this._divider.visible = this.showDivider;
        if (this.showDivider) {
            this._divider.set_style(
                "background-color: " + pal.divider + ";" +
                "height: 1px;" +
                "margin: 12px 0 4px 0;"
            );
        }

        // Autor
        let authorFamily = this._familyFromFontString(this.fontAuthor);
        this._authorLabel.set_style(
            "color: " + pal.accent + ";" +
            "font-family: \"" + authorFamily + "\", Georgia, serif;" +
            "font-size: " + this.fontSizeAuthor + "pt;" +
            "font-weight: bold;" +
            "text-align: " + this._alignLabel() + ";"
        );

        // Fuente / sección
        this._sourceLabel.set_style(
            "color: " + _withOpacity(pal.accent, 0.65) + ";" +
            "font-family: \"" + authorFamily + "\", Georgia, serif;" +
            "font-size: " + (this.fontSizeAuthor - 1.5) + "pt;" +
            "font-style: italic;" +
            "text-align: " + this._alignLabel() + ";"
        );

        // Botón de refresco
        this._refreshButton.set_style(
            "color: " + pal.accent + ";" +
            "background-color: transparent;" +
            "border: none;" +
            "border-radius: 50%;" +
            "font-size: 15pt;" +
            "padding: 0px 2px 2px 6px;" +
            "min-width: 26px;" +
            "min-height: 26px;"
        );
    },

    _resolvePalette: function() {
        let base = this.baseTheme || "stained-glass";
        let customBg      = _colorToCss(this.colorBg,      null);
        let customText    = _colorToCss(this.colorText,    null);
        let customAccent  = _colorToCss(this.colorAccent,  null);
        let customBorder  = _colorToCss(this.colorBorder,  null);
        let customDivider = _colorToCss(this.colorDivider, null);

        if (base === "custom") {
            let auto = AUTO_PALETTES[_resolveThemeMode(this.themeMode)];
            return {
                bg:      customBg      || auto.bg,
                text:    customText    || auto.text,
                accent:  customAccent  || auto.accent,
                border:  customBorder  || auto.border,
                divider: customDivider || auto.divider,
                fontFamily: "DejaVu Serif",
                italic: true
            };
        }

        // Si hay un preset, permitimos que los colorchooser lo sobreescriban
        // (así el usuario puede partir de un preset y personalizar un color).
        let preset = PRESET_THEMES[base] || PRESET_THEMES["stained-glass"];

        if (this.themeMode === "auto") {
            let mode = _resolveThemeMode("auto");
            if (mode === "light" && base === "stained-glass") {
                preset = Object.assign({}, preset, {
                    bg:   "rgba(30, 45, 90, 0.95)",
                    text: "rgba(255, 250, 235, 1.0)"
                });
            }
            if (mode === "dark" && base === "modern") {
                preset = Object.assign({}, preset, {
                    bg:     "rgba(35, 35, 38, 0.95)",
                    text:   "rgba(230, 225, 215, 1.0)",
                    accent: "rgba(220, 180, 90, 1.0)"
                });
            }
        }

        return {
            bg:      customBg      || preset.bg,
            text:    customText    || preset.text,
            accent:  customAccent  || preset.accent,
            border:  customBorder  || preset.border,
            divider: customDivider || preset.divider,
            fontFamily: preset.fontFamily,
            italic: preset.italic
        };
    },

    _familyFromFontString: function(str) {
        if (!str) return "DejaVu Serif";
        return str.replace(/\s+\d+$/, "").trim() || "DejaVu Serif";
    },

    _alignLabel: function() {
        let a = this.textAlign || "left";
        if (a === "justify") return "justify";
        if (a === "center")  return "center";
        return "left";
    },

    _showPromesa: function() {
        let dateStr = _getDateString();
        if (dateStr !== this._lastDate) {
            this._manualOffset = 0;
            this._lastDate = dateStr;
        }

        let base = _dateHash(dateStr) % this._promesas.length;
        let idx  = (base + this._manualOffset) % this._promesas.length;
        let q    = this._promesas[idx] || PROMESA_FALLBACK;

        this._quoteLabel.set_text("\u201C" + (q.text || "") + "\u201D");
        this._authorLabel.set_text("\u2014 " + (q.author || _("Desconocido")));
        this._sourceLabel.set_text(q.source || "");

        this._sourceLabel.visible   = this.showSource && !!q.source;
        this._refreshButton.visible = this.showRefreshButton;
    },

    _scheduleNextRefresh: function() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this.refreshFrequency === "manual") return;

        let delaySec;
        if (this.refreshFrequency === "hourly") {
            delaySec = 3600;
        } else {
            let now      = new Date();
            let midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
            delaySec = Math.max(60, Math.ceil((midnight - now) / 1000));
        }

        this._refreshTimer = Mainloop.timeout_add_seconds(delaySec, () => {
            this._showPromesa();
            this._scheduleNextRefresh();
            return false;
        });
    },

    on_desklet_removed: function() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._themeSettings && this._themeSignal) {
            this._themeSettings.disconnect(this._themeSignal);
            this._themeSignal = null;
        }
    }
};

function main(metadata, desklet_id) {
    return new PromesasBiblicasDesklet(metadata, desklet_id);
}