const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const UUID = "power-users@malnon-labs";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const ORANGE = "#e8963a";
const BLUE = "#5aa2e8";
const TRACK = 200;

function PowerDesklet(metadata, desklet_id) { this._init(metadata, desklet_id); }

PowerDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this._helper = metadata.path + "/power-users.py";
        this._state = GLib.get_user_cache_dir() + "/" + UUID + ".json";
        this._timer = 0;
        this._removed = false;
        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        ["base_w", "rows", "scale"].forEach((k) => this.settings.bind(k, k, () => this._render()));
        this.settings.bind("interval", "interval", () => this._schedule());
        this.setHeader("");
        this._data = null;
        this._render();
        this._poll();
        this._schedule();
    },

    on_desklet_removed: function() {
        this._removed = true;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
    },

    _schedule: function() {
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.interval || 60, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    },

    _poll: function() {
        if (this._busy) return;
        this._busy = true;
        try {
            let proc = Gio.Subprocess.new(["python3", "-I", this._helper, this._state],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                this._busy = false;
                if (this._removed) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    this._data = JSON.parse(out);
                    this._render();
                } catch (e) { global.logError(UUID + ": " + e); }
            });
        } catch (e) { this._busy = false; global.logError(UUID + ": " + e); }
    },

    _render: function() {
        let s = this.scale || 1;
        let card = new St.BoxLayout({ vertical: true, style_class: "pu-card",
            style: "font-size: " + Math.round(10 * s) + "pt;" });
        card.add(new St.Label({ text: _("POWER USERS"), style_class: "pu-title" }));

        let d = this._data;
        if (!d) {
            card.add(new St.Label({ text: _("Sampling…"), style_class: "pu-sub", style: "padding-top: 8px;" }));
            this.setContent(card);
            return;
        }

        if (d.has_battery === false) {
            card.add(new St.Label({ text: _("No battery found"), style_class: "pu-sub", style: "padding-top: 8px;" }));
            this.setContent(card);
            return;
        }
        let dis = d.discharging;
        let base = this.base_w || 5;
        let dynamic = dis ? Math.max(0, d.power_w - base) : 0;
        let totalCpu = d.total_cpu || 1;
        let col = dis ? ORANGE : BLUE;

        let head = new St.BoxLayout({ vertical: false, style: "padding-top: 4px;" });
        head.add(new St.Label({ text: dis ? _("%s W").format(d.power_w.toFixed(1)) : _("On AC"), style_class: "pu-big" }));
        let hr = new St.BoxLayout({ vertical: true, style: "padding-left: 12px;" });
        hr.add(new St.Label({ text: dis ? _("battery draw") : _("showing CPU share only"), style_class: "pu-sub" }));
        hr.add(new St.Label({ text: dis ? _("%s W baseline · %s W attributed").format(base.toFixed(1), dynamic.toFixed(1))
                : _("watts need battery power"),
            style_class: "pu-sub" }));
        head.add(hr, { y_align: St.Align.MIDDLE });
        card.add(head);

        let rows = d.rows.slice(0, this.rows || 6);
        let top = rows.length ? rows[0].cpu : 1;
        rows.forEach(function(r) {
            let est = dis ? dynamic * r.cpu / totalCpu : 0;
            let row = new St.BoxLayout({ vertical: true, style: "padding-top: 9px;" });
            let line = new St.BoxLayout({ vertical: false });
            line.add(new St.Label({ text: r.name, style_class: "pu-name" }), { expand: true, x_fill: true });
            line.add(new St.Label({ text: dis ? _("≈ %s W").format(est.toFixed(1)) : r.cpu.toFixed(0) + "%",
                style_class: "pu-val", style: "color:" + col + ";" }));
            row.add(line);
            let tw = Math.round(TRACK * s);
            let track = new St.BoxLayout({ style_class: "pu-track", style: "width:" + tw + "px;" });
            track.add(new St.Widget({ style: "height:6px; border-radius:3px; background-color:" + col +
                "; width:" + Math.max(3, Math.round(r.cpu / top * tw)) + "px;" }));
            row.add(track);
            row.add(new St.Label({ text: r.pids > 1 ? _("%s of a core · %d processes").format(r.cpu.toFixed(0) + "%", r.pids)
                : _("%s of a core").format(r.cpu.toFixed(0) + "%"),
                style_class: "pu-meta" }));
            card.add(row);
        });
        if (!rows.length) card.add(new St.Label({ text: _("Nothing using noticeable CPU"), style_class: "pu-sub",
            style: "padding-top: 8px;" }));

        card.add(new St.Label({ text: _("Estimate: CPU time share of battery draw above the baseline. Avg over last %d s.")
                .format(Math.round(d.window)), style_class: "pu-note" }));
        this.setContent(card);
    }
};

function main(metadata, desklet_id) { return new PowerDesklet(metadata, desklet_id); }
