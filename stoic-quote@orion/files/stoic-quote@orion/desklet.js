// Stoic Quote Desklet — stoic-quote@orion

const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Pango    = imports.gi.Pango;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Gettext  = imports.gettext;

const UUID = "stoic-quote@orion";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

// Import the quotes module from the desklet directory. Each field in
// quotes.js is wrapped in _() so xgettext extracts every quote and
// translators can localize the entire data set via po/<lang>.po.
let DESKLET_DIR = ".";
for (let key in imports.ui.deskletManager.deskletMeta) {
    if (key === UUID) {
        DESKLET_DIR = imports.ui.deskletManager.deskletMeta[key].path;
        break;
    }
}
imports.searchPath.unshift(DESKLET_DIR);
const QuotesModule = imports.quotes;

const FALLBACK_QUOTE = {
    text:   _("The impediment to action advances action. What stands in the way becomes the way."),
    author: _("Marcus Aurelius"),
    source: _("Meditations, Book 5")
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getDateString() {
    let d = new Date();
    return d.getFullYear()
        + "-" + String(d.getMonth() + 1).padStart(2, "0")
        + "-" + String(d.getDate()).padStart(2, "0");
}

// djb2 — same YYYY-MM-DD always yields the same index
function _dateHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = (((h << 5) >>> 0) + h + str.charCodeAt(i)) >>> 0;
    }
    return h;
}

// ── Desklet ───────────────────────────────────────────────────────────────────

function StoicQuoteDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

StoicQuoteDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._quotes = (Array.isArray(QuotesModule.QUOTES) && QuotesModule.QUOTES.length)
            ? QuotesModule.QUOTES
            : [FALLBACK_QUOTE];
        this._refreshTimer = null;
        this._manualOffset = 0;
        this._lastDate     = null;

        // Defaults — overwritten immediately by bindProperty
        this.showSource        = true;
        this.deskletWidth      = 380;
        this.showRefreshButton = true;
        this.refreshFrequency  = "daily";

        this._loadSettings(desklet_id);
        this._buildUI();
        this._showQuote();
        this._scheduleNextRefresh();
    },

    // ── Settings ──────────────────────────────────────────────────────────────

    _loadSettings: function(desklet_id) {
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this._settings.bindProperty(Settings.BindingDirection.IN, "show-source",        "showSource",        () => this._onSettingChanged(), null);
        this._settings.bindProperty(Settings.BindingDirection.IN, "desklet-width",       "deskletWidth",      () => this._onSettingChanged(), null);
        this._settings.bindProperty(Settings.BindingDirection.IN, "show-refresh-button", "showRefreshButton", () => this._onSettingChanged(), null);
        this._settings.bindProperty(Settings.BindingDirection.IN, "refresh-frequency",   "refreshFrequency",  () => this._onSettingChanged(), null);
    },

    _onSettingChanged: function() {
        this._showQuote();
        this._scheduleNextRefresh();
    },

    // ── UI construction ───────────────────────────────────────────────────────

    _buildUI: function() {
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "stoic-desklet"
        });

        this._quoteLabel = new St.Label({
            style_class: "stoic-quote-text",
            text: ""
        });
        this._quoteLabel.clutter_text.line_wrap      = true;
        this._quoteLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._quoteLabel.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;

        this._authorLabel = new St.Label({ style_class: "stoic-author", text: "" });
        this._sourceLabel = new St.Label({ style_class: "stoic-source", text: "" });

        let authorBox = new St.BoxLayout({ vertical: true });
        authorBox.add_child(this._authorLabel);
        authorBox.add_child(this._sourceLabel);
        authorBox.x_expand = true;

        this._refreshButton = new St.Button({
            style_class: "stoic-refresh-button",
            label: "↺"
        });
        this._refreshButton.connect("clicked", () => {
            this._manualOffset++;
            global.log("[stoic-quote] Manual advance → offset " + this._manualOffset);
            this._showQuote();
        });

        let footer = new St.BoxLayout({ vertical: false, style_class: "stoic-footer" });
        footer.add_child(authorBox);
        footer.add_child(this._refreshButton);

        this._container.add_child(this._quoteLabel);
        this._container.add_child(footer);

        this.setContent(this._container);
        this._applyWidth();
    },

    // ── Quote display ─────────────────────────────────────────────────────────

    _showQuote: function() {
        let dateStr = _getDateString();
        if (dateStr !== this._lastDate) {
            this._manualOffset = 0;
            this._lastDate = dateStr;
        }

        let base = _dateHash(dateStr) % this._quotes.length;
        let idx  = (base + this._manualOffset) % this._quotes.length;
        let q    = this._quotes[idx] || FALLBACK_QUOTE;

        this._quoteLabel.set_text("\u201C" + (q.text || "") + "\u201D");
        this._authorLabel.set_text("\u2014 " + (q.author || _("Unknown")));
        this._sourceLabel.set_text(q.source || "");

        this._sourceLabel.visible   = this.showSource && !!q.source;
        this._refreshButton.visible = this.showRefreshButton;
        this._applyWidth();
    },

    _applyWidth: function() {
        this._container.style = "width: " + (this.deskletWidth || 380) + "px;";
    },

    // ── Refresh timer ─────────────────────────────────────────────────────────

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

        global.log("[stoic-quote] Next refresh in " + delaySec + "s (mode=" + this.refreshFrequency + ")");
        this._refreshTimer = Mainloop.timeout_add_seconds(delaySec, () => {
            global.log("[stoic-quote] Scheduled refresh fired");
            this._showQuote();
            this._scheduleNextRefresh();
            return false;
        });
    },

    on_desklet_removed: function() {
        if (this._refreshTimer) {
            Mainloop.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
};

// ── Entry point ───────────────────────────────────────────────────────────────

function main(metadata, desklet_id) {
    return new StoicQuoteDesklet(metadata, desklet_id);
}
