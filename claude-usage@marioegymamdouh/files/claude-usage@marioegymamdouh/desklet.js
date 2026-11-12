/*
 * Claude Usage - a Cinnamon desklet showing your Claude plan usage.
 *
 * Copyright 2026 Mario Egy Mamdouh
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * How it works:
 *   Claude Code (Anthropic's CLI) stores an OAuth access token in
 *   ~/.claude/.credentials.json when you log in. This desklet reads that
 *   file (read-only, it never writes it) and calls the same usage endpoint
 *   that the `/usage` command in Claude Code calls. The token is sent to
 *   api.anthropic.com and nowhere else.
 *
 *   The desklet deliberately does NOT refresh the OAuth token itself:
 *   Claude Code owns that token and rotating it behind Claude Code's back
 *   could log the user out. When the token has expired the desklet says so
 *   and picks up the new token as soon as Claude Code writes one.
 *
 * This is an unofficial community desklet and is not affiliated with Anthropic.
 */

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;

const UUID = "claude-usage@marioegymamdouh";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const DEFAULT_CREDENTIALS = GLib.build_filenamev([GLib.get_home_dir(), ".claude", ".credentials.json"]);

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function bytesToString(data) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(data);
    return imports.byteArray.toString(data);
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function formatReset(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const diff = Math.max(0, t - Date.now());
    const mins = Math.round(diff / 60000);
    let rel;
    if (mins < 1) rel = _("now");
    else if (mins < 60) rel = _("%d min").format(mins);
    else if (mins < 24 * 60) rel = _("%dh %sm").format(Math.floor(mins / 60), pad2(mins % 60));
    else rel = _("%dd %dh").format(Math.floor(mins / 1440), Math.floor((mins % 1440) / 60));
    const d = new Date(t);
    const days = [_("Sun"), _("Mon"), _("Tue"), _("Wed"), _("Thu"), _("Fri"), _("Sat")];
    const clock = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    const abs = diff < 24 * 3600 * 1000 ? clock : days[d.getDay()] + " " + clock;
    return _("resets in %s (%s)").format(rel, abs);
}

function severityFor(percent, severity, locked) {
    if (locked) return "locked";
    if (severity && severity !== "normal") return severity === "critical" ? "critical" : "warning";
    if (percent >= 90) return "critical";
    if (percent >= 70) return "warning";
    return "normal";
}

function kindLabel(kind) {
    switch (kind) {
        case "session": return _("Session (5 h)");
        case "weekly_all": return _("Weekly, all models");
        case "seven_day_oauth_apps": return _("Weekly, apps");
        case "seven_day_cowork": return _("Weekly, Cowork");
        default: return String(kind).replace(/_/g, " ");
    }
}

function limitLabel(limit) {
    const scope = limit.scope || {};
    const model = scope.model && scope.model.display_name;
    const surface = scope.surface && (scope.surface.display_name || scope.surface);
    if (limit.kind === "weekly_scoped") {
        const parts = [];
        if (model) parts.push(model);
        if (surface) parts.push(String(surface));
        return _("Weekly, %s").format(parts.length ? parts.join(" / ") : _("scoped"));
    }
    return kindLabel(limit.kind);
}

function money(amountMinor, currency, exponent) {
    if (amountMinor === null || amountMinor === undefined) return "";
    const digits = exponent || 2;
    return (currency || "") + " " + (amountMinor / Math.pow(10, digits)).toFixed(digits);
}

function ClaudeUsageDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

ClaudeUsageDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);
        this.metadata = metadata;
        this._timeoutId = 0;
        this._debounceId = 0;
        this._monitor = null;
        this._session = new Soup.Session();
        this._session.timeout = 20;
        this._session.user_agent = "claude-usage-desklet/1.0";
        this._lastData = null;
        this._lastFetched = null;
        this._cred = null;
        this._inflight = false;

        this.settings = new Settings.DeskletSettings(this, UUID, deskletId);
        this.settings.bind("refresh-minutes", "refreshMinutes", this._onIntervalChanged.bind(this));
        this.settings.bind("width", "width", this._onStyleChanged.bind(this));
        this.settings.bind("font-scale", "fontScale", this._onStyleChanged.bind(this));
        this.settings.bind("background-opacity", "bgOpacity", this._onStyleChanged.bind(this));
        this.settings.bind("show-reset-times", "showResetTimes", this._render.bind(this));
        this.settings.bind("show-spend", "showSpend", this._render.bind(this));
        this.settings.bind("credentials-path", "credentialsPath", this._onCredentialsPathChanged.bind(this));

        this.setHeader(_("Claude Usage"));
        this._buildUi();
        this._watchCredentials();

        this._menu.addAction(_("Refresh now"), () => this.refresh());
        this._menu.addAction(_("Open usage page on claude.ai"), function () {
            Gio.app_info_launch_default_for_uri("https://claude.ai/settings/usage", null);
        });

        this._applyStyle();
        this.refresh();
        this._schedule();
    },

    _buildUi: function () {
        this._root = new St.BoxLayout({ vertical: true, style_class: "cu-root", reactive: true });
        this._root.connect("button-release-event", (actor, event) => {
            if (event.get_button() === 1) { this.refresh(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });

        const header = new St.BoxLayout({ vertical: false, style_class: "cu-header" });
        this._title = new St.Label({ text: _("Claude usage"), style_class: "cu-title" });
        this._sub = new St.Label({ text: "", style_class: "cu-sub" });
        this._sub.set_y_align(Clutter.ActorAlign.END);
        header.add(this._title, { expand: true, x_fill: false, x_align: St.Align.START });
        header.add(this._sub, { x_fill: false, x_align: St.Align.END });
        this._root.add(header);

        this._rows = new St.BoxLayout({ vertical: true, style: "spacing: 8px;" });
        this._root.add(this._rows);

        this._status = new St.Label({ text: _("Loading..."), style_class: "cu-status" });
        this._status.clutter_text.line_wrap = true;
        this._root.add(this._status);

        this._footer = new St.Label({ text: "", style_class: "cu-footer" });
        this._root.add(this._footer);

        this.setContent(this._root);
    },

    _applyStyle: function () {
        const w = Math.max(200, this.width || 300);
        const alpha = Math.max(0, Math.min(1, this.bgOpacity === undefined ? 0.75 : this.bgOpacity));
        const fs = Math.max(0.5, this.fontScale || 1);
        this._root.set_style(
            "width: " + w + "px; font-size: " + Math.round(fs * 11) + "pt; " +
            "background-color: rgba(28, 25, 23, " + alpha.toFixed(2) + ");"
        );
        this._barWidth = w; // vertical box children stretch to the content width
        this._render();
    },

    _onStyleChanged: function () { this._applyStyle(); },

    _onIntervalChanged: function () { this._schedule(); },

    _onCredentialsPathChanged: function () { this._watchCredentials(); this.refresh(); },

    _credentialsFile: function () {
        // parse_name() expands a leading ~ and also accepts file:// URIs.
        return Gio.File.parse_name(this.credentialsPath || DEFAULT_CREDENTIALS);
    },

    _schedule: function () {
        if (this._timeoutId) { Mainloop.source_remove(this._timeoutId); this._timeoutId = 0; }
        const secs = Math.max(60, Math.round((this.refreshMinutes || 2) * 60));
        this._timeoutId = Mainloop.timeout_add_seconds(secs, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    },

    _watchCredentials: function () {
        if (this._monitor) { this._monitor.cancel(); this._monitor = null; }
        try {
            this._monitor = this._credentialsFile().monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect("changed", () => {
                // Claude Code rewrites the file when it refreshes the token; wait a moment, then re-fetch.
                if (this._debounceId) Mainloop.source_remove(this._debounceId);
                this._debounceId = Mainloop.timeout_add_seconds(3, () => {
                    this._debounceId = 0;
                    this.refresh();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            global.logWarning(UUID + ": cannot watch credentials file: " + e);
        }
    },

    // Reads the token asynchronously; calls back with {error} or {token, expiresAt, ...}.
    _readToken: function (callback) {
        const file = this._credentialsFile();
        file.load_contents_async(null, (f, result) => {
            let contents;
            try {
                [, contents] = f.load_contents_finish(result);
            } catch (e) {
                if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                    callback({ error: _("No Claude Code login found. Run `claude` and sign in, then this will populate.") });
                } else {
                    callback({ error: _("Could not read %s").format(f.get_parse_name()) });
                }
                return;
            }
            let json;
            try {
                json = JSON.parse(bytesToString(contents));
            } catch (e) {
                callback({ error: _("Credentials file is not valid JSON.") });
                return;
            }
            const oauth = json.claudeAiOauth;
            if (!oauth || !oauth.accessToken) {
                callback({ error: _("Credentials file has no OAuth token. Log in with `claude`.") });
                return;
            }
            callback({
                token: oauth.accessToken,
                expiresAt: oauth.expiresAt || 0,
                subscriptionType: oauth.subscriptionType || "",
                rateLimitTier: oauth.rateLimitTier || "",
            });
        });
    },

    refresh: function () {
        if (this._inflight) return;
        this._inflight = true;
        this._status.set_text(this._lastData ? _("Refreshing...") : _("Loading..."));
        this._status.show();

        this._readToken((cred) => {
            if (cred.error) {
                this._inflight = false;
                this._showError(cred.error, false);
                return;
            }
            this._cred = cred;
            this._fetchUsage(cred);
        });
    },

    _fetchUsage: function (cred) {
        const message = Soup.Message.new("GET", USAGE_URL);
        const headers = message.get_request_headers();
        headers.append("Authorization", "Bearer " + cred.token);
        headers.append("anthropic-beta", OAUTH_BETA);
        headers.append("Accept", "application/json");

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            this._inflight = false;
            let body = "";
            try {
                const bytes = session.send_and_read_finish(result);
                body = bytesToString(bytes.get_data());
            } catch (e) {
                this._showError(_("Network error: %s").format(e.message), true);
                return;
            }
            const status = message.get_status();
            if (status === 401 || status === 403) {
                const expired = cred.expiresAt && cred.expiresAt < Date.now();
                this._showError(expired
                    ? _("Token expired. Run any `claude` command to refresh the login.")
                    : _("Token rejected (HTTP %d). Run any `claude` command to refresh the login.").format(status), true);
                return;
            }
            if (status !== 200) {
                this._showError(_("Usage API returned HTTP %d.").format(status), true);
                return;
            }
            try {
                this._lastData = JSON.parse(body);
            } catch (e) {
                this._showError(_("Could not parse the usage response."), true);
                return;
            }
            this._lastFetched = new Date();
            this._render();
        });
    },

    _showError: function (text, keepData) {
        this._status.set_text(text);
        this._status.set_style_class_name("cu-error");
        this._status.show();
        if (!keepData) {
            this._rows.destroy_all_children();
            this._sub.set_text("");
        }
        const f = this._lastFetched;
        this._footer.set_text(f ? _("last good update %s").format(pad2(f.getHours()) + ":" + pad2(f.getMinutes())) : "");
    },

    _collectLimits: function (data) {
        if (Array.isArray(data.limits) && data.limits.length) {
            return data.limits.map(function (l) {
                return {
                    label: limitLabel(l),
                    percent: typeof l.percent === "number" ? l.percent : 0,
                    resetsAt: l.resets_at,
                    severity: l.severity,
                    locked: false,
                };
            });
        }
        // Older response shape: top-level windows.
        const out = [];
        const add = function (key, label) {
            const w = data[key];
            if (!w) return;
            out.push({
                label: label, percent: w.utilization || 0, resetsAt: w.resets_at,
                severity: "normal", locked: !!w.locked_reason,
            });
        };
        add("five_hour", kindLabel("session"));
        add("seven_day", kindLabel("weekly_all"));
        add("seven_day_opus", _("Weekly, %s").format("Opus"));
        add("seven_day_sonnet", _("Weekly, %s").format("Sonnet"));
        return out;
    },

    _render: function () {
        if (!this._root) return;
        const data = this._lastData;
        if (!data) return;

        this._rows.destroy_all_children();
        this._status.hide();
        this._status.set_style_class_name("cu-status");

        const cred = this._cred || {};
        const subParts = [];
        if (cred.subscriptionType) subParts.push(cred.subscriptionType);
        if (cred.rateLimitTier) {
            const m = /max_(\d+)x/i.exec(cred.rateLimitTier);
            if (m) subParts.push("Max " + m[1] + "x");
        }
        this._sub.set_text(subParts.join(" - "));

        const limits = this._collectLimits(data);
        for (let i = 0; i < limits.length; i++) this._rows.add(this._buildRow(limits[i]));

        if (this.showSpend && data.spend && data.spend.enabled) {
            const s = data.spend;
            const used = s.used ? money(s.used.amount_minor, s.used.currency, s.used.exponent).trim() : "";
            const limit = s.limit ? money(s.limit.amount_minor, s.limit.currency, s.limit.exponent).trim() : "";
            let label = _("Extra usage");
            if (limit) label = _("Extra usage: %s of %s").format(used, limit);
            else if (used) label = _("Extra usage: %s").format(used);
            this._rows.add(this._buildRow({
                label: label,
                percent: typeof s.percent === "number" ? s.percent : 0,
                resetsAt: null, severity: s.severity, locked: false,
            }));
        }

        if (!limits.length) {
            this._status.set_text(_("No limits reported for this account."));
            this._status.show();
        }

        const f = this._lastFetched;
        this._footer.set_text(f ? _("updated %s - click to refresh").format(pad2(f.getHours()) + ":" + pad2(f.getMinutes())) : "");
    },

    _buildRow: function (limit) {
        const row = new St.BoxLayout({ vertical: true, style_class: "cu-row" });

        const head = new St.BoxLayout({ vertical: false, style_class: "cu-row-head" });
        const name = new St.Label({ text: limit.label, style_class: "cu-name" });
        const pct = new St.Label({ text: Math.round(limit.percent) + "%", style_class: "cu-pct" });
        head.add(name, { expand: true, x_fill: false, x_align: St.Align.START });
        head.add(pct, { x_fill: false, x_align: St.Align.END });
        row.add(head);

        const sev = severityFor(limit.percent, limit.severity, limit.locked);
        const barW = Math.max(40, this._barWidth || 260);
        const bar = new St.BoxLayout({ vertical: false, style_class: "cu-bar" });
        bar.set_width(barW);
        const fill = new St.Bin({ style_class: "cu-bar-fill cu-fill-" + sev });
        const clamped = Math.max(0, Math.min(100, limit.percent));
        fill.set_width(Math.round(barW * clamped / 100));
        fill.set_height(8);
        bar.add(fill, { expand: false, x_fill: false, y_fill: true, x_align: St.Align.START });
        row.add(bar);

        if (this.showResetTimes && limit.resetsAt) {
            row.add(new St.Label({ text: formatReset(limit.resetsAt), style_class: "cu-reset" }));
        }
        return row;
    },

    on_desklet_removed: function () {
        if (this._timeoutId) { Mainloop.source_remove(this._timeoutId); this._timeoutId = 0; }
        if (this._debounceId) { Mainloop.source_remove(this._debounceId); this._debounceId = 0; }
        if (this._monitor) { this._monitor.cancel(); this._monitor = null; }
        if (this._session) { this._session.abort(); }
    },
};

function main(metadata, deskletId) {
    return new ClaudeUsageDesklet(metadata, deskletId);
}
