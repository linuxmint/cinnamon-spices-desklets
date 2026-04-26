// Stoic Quote Desklet — stoic-quote@orion
// Pattern: function constructor + __proto__ + Desklet.Desklet.prototype._init.call()
// This matches other working Cinnamon 6.x desklets on this system.

const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const Gio      = imports.gi.Gio;
const GLib     = imports.gi.GLib;
const Pango    = imports.gi.Pango;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Lang     = imports.lang;

const UUID = "stoic-quote@orion";

const FALLBACK_QUOTE = {
    text:   "The impediment to action advances action. What stands in the way becomes the way.",
    author: "Marcus Aurelius",
    source: "Meditations, Book 5"
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

function _decodeContents(raw) {
    if (typeof raw === "string") return raw;
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(raw);
    let s = "";
    for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
    return s;
}

// ── Desklet ───────────────────────────────────────────────────────────────────

function StoicQuoteDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

StoicQuoteDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        // Call the parent _init directly on the prototype — avoids the ES6
        // "class constructors must be invoked with 'new'" error.
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._deskletPath  = metadata.path;
        this._quotes       = [];
        this._refreshTimer = null;
        this._manualOffset = 0;   // incremented by the refresh button; resets at midnight
        this._lastDate     = null;

        // Defaults — overwritten immediately by bindProperty
        this.showSource        = true;
        this.deskletWidth      = 380;
        this.showRefreshButton = true;
        this.refreshFrequency  = "daily";

        this._loadSettings(desklet_id);
        this._buildUI();
        this._loadQuotes();
        this._showQuote();
        this._scheduleNextRefresh();
    },

    // ── Settings ──────────────────────────────────────────────────────────────

    _loadSettings: function(desklet_id) {
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        let cb = Lang.bind(this, this._onSettingChanged);
        this._settings.bindProperty(Settings.BindingDirection.IN, "show-source",        "showSource",        cb, null);
        this._settings.bindProperty(Settings.BindingDirection.IN, "desklet-width",       "deskletWidth",      cb, null);
        this._settings.bindProperty(Settings.BindingDirection.IN, "show-refresh-button", "showRefreshButton", cb, null);
        this._settings.bindProperty(Settings.BindingDirection.IN, "refresh-frequency",   "refreshFrequency",  cb, null);
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
        this._refreshButton.connect("clicked", Lang.bind(this, function() {
            this._manualOffset++;
            global.log("[stoic-quote] Manual advance → offset " + this._manualOffset);
            this._showQuote();
        }));

        let footer = new St.BoxLayout({ vertical: false, style_class: "stoic-footer" });
        footer.add_child(authorBox);
        footer.add_child(this._refreshButton);

        this._container.add_child(this._quoteLabel);
        this._container.add_child(footer);

        this.setContent(this._container);
        this._applyWidth();
    },

    // ── Quote loading & display ───────────────────────────────────────────────

    _loadQuotes: function() {
        try {
            let file = Gio.File.new_for_path(this._deskletPath + "/quotes.json");
            let [ok, raw] = file.load_contents(null);
            if (!ok) throw new Error("load_contents returned false");

            let data = JSON.parse(_decodeContents(raw));
            if (!Array.isArray(data) || data.length === 0)
                throw new Error("quotes.json must be a non-empty array");

            this._quotes = data;
            global.log("[stoic-quote] Loaded " + data.length + " quotes");
        } catch (e) {
            global.log("[stoic-quote] Quote load error — " + e.message + " — using fallback");
            this._quotes = [FALLBACK_QUOTE];
        }
    },

    _showQuote: function() {
        if (!this._quotes.length) this._quotes = [FALLBACK_QUOTE];

        let dateStr = _getDateString();
        if (dateStr !== this._lastDate) {
            this._manualOffset = 0;   // new day — reset to the day's deterministic quote
            this._lastDate = dateStr;
        }

        let base = _dateHash(dateStr) % this._quotes.length;
        let idx  = (base + this._manualOffset) % this._quotes.length;
        let q    = this._quotes[idx] || FALLBACK_QUOTE;

        this._quoteLabel.set_text("“" + (q.text || "") + "”");
        this._authorLabel.set_text("— " + (q.author || "Unknown"));
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
        this._refreshTimer = Mainloop.timeout_add_seconds(delaySec, Lang.bind(this, function() {
            global.log("[stoic-quote] Scheduled refresh fired");
            this._showQuote();
            this._scheduleNextRefresh();
            return false;
        }));
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
