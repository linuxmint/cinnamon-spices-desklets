const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;

const ORANGE = "#e8963a";
const BLUE = "#5aa2e8";
const TRACK = 200;

function PowerDesklet(metadata, desklet_id) { this._init(metadata, desklet_id); }

PowerDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this._helper = metadata.path + "/power-users.py";
        this._minW = 0;
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
        if (this._timer) Mainloop.source_remove(this._timer);
    },

    _schedule: function() {
        if (this._timer) Mainloop.source_remove(this._timer);
        this._timer = Mainloop.timeout_add_seconds(this.interval || 60, () => { this._poll(); return true; });
    },

    _poll: function() {
        if (this._busy) return;
        this._busy = true;
        try {
            let proc = Gio.Subprocess.new(["python3", "-I", this._helper],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                this._busy = false;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    this._data = JSON.parse(out);
                    this._render();
                } catch (e) { global.logError("power-users: " + e); }
            });
        } catch (e) { this._busy = false; global.logError("power-users: " + e); }
    },

    _render: function() {
        let s = this.scale || 1;
        let card = new St.BoxLayout({ vertical: true, style_class: "pu-card",
            style: "font-size: " + Math.round(10 * s) + "pt;" });
        card.add(new St.Label({ text: "POWER USERS", style_class: "pu-title" }));

        let d = this._data;
        if (!d) {
            card.add(new St.Label({ text: "Sampling…", style_class: "pu-sub", style: "padding-top: 8px;" }));
            this.setContent(card);
            return;
        }

        if (d.has_battery === false) {
            card.add(new St.Label({ text: "No battery found", style_class: "pu-sub", style: "padding-top: 8px;" }));
            this.setContent(card);
            return;
        }
        let dis = d.discharging;
        // base_w 0 = auto: lowest draw seen since the desklet started
        if (dis && d.power_w > 0.5) this._minW = this._minW ? Math.min(this._minW, d.power_w) : d.power_w;
        let base = this.base_w > 0 ? this.base_w : this._minW;
        let dynamic = dis ? Math.max(0, d.power_w - base) : 0;
        let totalCpu = d.total_cpu || 1;
        let col = dis ? ORANGE : BLUE;

        let head = new St.BoxLayout({ vertical: false, style: "padding-top: 4px;" });
        head.add(new St.Label({ text: dis ? d.power_w.toFixed(1) + " W" : "On AC", style_class: "pu-big" }));
        let hr = new St.BoxLayout({ vertical: true, style: "padding-left: 12px;" });
        hr.add(new St.Label({ text: dis ? "battery draw" : "showing CPU share only", style_class: "pu-sub" }));
        hr.add(new St.Label({ text: dis ? base.toFixed(1) + " W baseline · " +
            dynamic.toFixed(1) + " W attributed" : "watts need battery power",
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
            line.add(new St.Label({ text: dis ? "≈ " + est.toFixed(1) + " W" : r.cpu.toFixed(0) + "%",
                style_class: "pu-val", style: "color:" + col + ";" }));
            row.add(line);
            let tw = Math.round(TRACK * s);
            let track = new St.BoxLayout({ style_class: "pu-track", style: "width:" + tw + "px;" });
            track.add(new St.Widget({ style: "height:6px; border-radius:3px; background-color:" + col +
                "; width:" + Math.max(3, Math.round(r.cpu / top * tw)) + "px;" }));
            row.add(track);
            row.add(new St.Label({ text: r.cpu.toFixed(0) + "% of a core" + (r.pids > 1 ? " · " + r.pids + " processes" : ""),
                style_class: "pu-meta" }));
            card.add(row);
        });
        if (!rows.length) card.add(new St.Label({ text: "Nothing using noticeable CPU", style_class: "pu-sub",
            style: "padding-top: 8px;" }));

        card.add(new St.Label({ text: "Estimate: CPU time share of battery draw above the baseline. " +
            "Avg over last " + Math.round(d.window) + " s.", style_class: "pu-note" }));
        this.setContent(card);
    }
};

function main(metadata, desklet_id) { return new PowerDesklet(metadata, desklet_id); }
