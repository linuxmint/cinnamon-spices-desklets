const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;
const ByteArray = imports.byteArray;
const Gettext = imports.gettext;

const UUID = "cpu-temp-ring@Vinit-M420";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");
function _(str) { return Gettext.dgettext(UUID, str); }

const T_MIN = 30, T_MAX = 100;   // gauge range (°C)
const HISTORY = 60;
const BASE_W = 200;

// colour stops: cool teal -> green -> amber -> coral red
const STOPS = [
    [30, [0.31, 0.82, 0.86]],
    [55, [0.42, 0.85, 0.55]],
    [72, [0.98, 0.75, 0.33]],
    [88, [0.96, 0.40, 0.40]],
];

function tempColor(t) {
    if (t <= STOPS[0][0]) return STOPS[0][1];
    for (let i = 1; i < STOPS.length; i++) {
        if (t <= STOPS[i][0]) {
            let [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
            let f = (t - t0) / (t1 - t0);
            return c0.map((v, k) => v + (c1[k] - v) * f);
        }
    }
    return STOPS[STOPS.length - 1][1];
}

// All sysfs access is asynchronous so the Cinnamon main loop is never blocked.
function readStr(path) {
    return new Promise(resolve => {
        Gio.File.new_for_path(path).load_contents_async(null, (file, res) => {
            try {
                let [ok, data] = file.load_contents_finish(res);
                resolve(ok ? ByteArray.toString(data).trim() : null);
            } catch (e) {
                resolve(null); // missing file / unreadable sensor
            }
        });
    });
}

async function readNum(path) {
    let s = await readStr(path);
    return s === null ? NaN : parseInt(s);
}

function listDir(path) {
    return new Promise(resolve => {
        let dir = Gio.File.new_for_path(path);
        dir.enumerate_children_async("standard::name", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (d, res) => {
            let en;
            try { en = d.enumerate_children_finish(res); } catch (e) { resolve([]); return; }
            en.next_files_async(256, GLib.PRIORITY_DEFAULT, null, (e2, res2) => {
                let names = [];
                try { names = en.next_files_finish(res2).map(i => i.get_name()); } catch (e) {}
                en.close_async(GLib.PRIORITY_DEFAULT, null, null);
                resolve(names);
            });
        });
    });
}

async function findThermalZone() {
    // Prefer a CPU-ish thermal zone, else the first one that reads a sane value
    let zones = (await listDir("/sys/class/thermal"))
        .filter(n => n.startsWith("thermal_zone"))
        .sort((a, b) => parseInt(a.slice(12)) - parseInt(b.slice(12)));
    let best = null;
    for (let z of zones) {
        let path = "/sys/class/thermal/" + z + "/temp";
        let t = await readNum(path);
        if (isNaN(t) || t <= 0) continue;
        let type = (await readStr("/sys/class/thermal/" + z + "/type")) || "";
        if (/x86_pkg_temp|cpu|soc|TCPU/i.test(type)) return path;
        if (!best) best = path;
    }
    return best;
}

async function findSensors() {
    // Locate coretemp / k10temp / zenpower hwmon dynamically (hwmonN numbering can change on boot)
    let res = { pkg: null, cores: [] };
    for (let name of await listDir("/sys/class/hwmon")) {
        let base = "/sys/class/hwmon/" + name;
        let drv = await readStr(base + "/name");
        if (!["coretemp", "k10temp", "zenpower"].includes(drv)) continue;
        let inputs = (await listDir(base)).filter(f => /^temp\d+_input$/.test(f));
        for (let f of inputs) {
            let label = (await readStr(base + "/" + f.replace("_input", "_label"))) || "";
            let input = base + "/" + f;
            if (/Package|Tctl|Tdie/.test(label)) res.pkg = input;
            else if (/Core/.test(label)) res.cores.push({ label: label, path: input, n: parseInt(label.replace(/\D/g, "")) });
        }
        if (res.pkg || res.cores.length) break;
    }
    if (!res.pkg) res.pkg = await findThermalZone(); // fallback for CPUs without coretemp/k10temp
    res.cores.sort((a, b) => a.n - b.n);
    return res;
}

class CpuTempRing extends Desklet.Desklet {
    constructor(metadata, id) {
        super(metadata, id);
        this.settings = new Settings.DeskletSettings(this, metadata.uuid, id);
        for (let k of ["size", "fahrenheit", "show-graph", "show-cores", "bg-opacity", "font"])
            this.settings.bind(k, k.replace(/-(.)/g, (_, c) => c.toUpperCase()), () => this._relayout());
        this.settings.bind("interval", "interval", () => this._restartTimer());

        this.sensors = { pkg: null, cores: [] };
        this.ready = false;
        this.history = [];
        this.temp = NaN; this.shown = NaN; this.peak = -Infinity; this.coreTemps = [];

        this.area = new St.DrawingArea();
        this.area.connect("repaint", (a) => this._draw(a));
        this.setContent(this.area);
        this._relayout();

        findSensors().then(sensors => {
            if (this._removed) return;
            this.sensors = sensors;
            this.ready = true;
            this._relayout();
            this._tick();
            this._restartTimer();
        }).catch(e => global.logError(UUID + ": sensor discovery failed: " + e));
    }

    _dims() {
        let s = this.size * global.ui_scale;
        let h = 200;
        if (this.showCores && this.sensors.cores.length) h += 26;
        if (this.showGraph) h += 44;
        return [Math.round(BASE_W * s), Math.round(h * s), s];
    }

    _relayout() {
        let [w, h] = this._dims();
        this.area.set_size(w, h);
        this.area.queue_repaint();
    }

    _restartTimer() {
        if (!this.ready) return;
        if (this.timer) GLib.source_remove(this.timer);
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.interval, () => { this._tick(); return GLib.SOURCE_CONTINUE; });
    }

    async _tick() {
        if (this._busy || !this.ready) return;
        this._busy = true;
        let t, cores;
        try {
            [t, ...cores] = await Promise.all([
                this.sensors.pkg ? readNum(this.sensors.pkg) : Promise.resolve(NaN),
                ...this.sensors.cores.map(c => readNum(c.path)),
            ]);
        } finally {
            this._busy = false;
        }
        if (this._removed) return;
        t /= 1000;
        this.coreTemps = cores.map(v => v / 1000).filter(v => !isNaN(v));
        if (!isNaN(t)) {
            this.temp = t;
            this.peak = Math.max(this.peak, t);
            this.history.push(t);
            if (this.history.length > HISTORY) this.history.shift();
            this._animate();
        }
    }

    _animate() {
        if (isNaN(this.shown)) { this.shown = this.temp; this.area.queue_repaint(); return; }
        if (this.anim) return;
        this.anim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            let d = this.temp - this.shown;
            if (Math.abs(d) < 0.05) { this.shown = this.temp; this.area.queue_repaint(); this.anim = 0; return GLib.SOURCE_REMOVE; }
            this.shown += d * 0.18;
            this.area.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _fmt(t) {
        return Math.round(this.fahrenheit ? t * 9 / 5 + 32 : t) + "°";
    }

    _text(cr, str, size, weight, x, y, rgba, align) {
        let layout = PangoCairo.create_layout(cr);
        let fd = Pango.FontDescription.from_string(this.font || "Ubuntu Sans");
        fd.set_absolute_size(size * Pango.SCALE);
        fd.set_weight(weight);
        layout.set_font_description(fd);
        layout.set_text(str, -1);
        let [w, h] = layout.get_pixel_size();
        cr.setSourceRGBA(...rgba);
        let ox = align === "center" ? w / 2 : align === "right" ? w : 0;
        cr.moveTo(x - ox, y - h / 2);
        PangoCairo.show_layout(cr, layout);
    }

    _roundRect(cr, x, y, w, h, r) {
        cr.newSubPath();
        cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
    }

    _draw(area) {
        let cr = area.get_context();
        let [W, H] = area.get_surface_size();
        let [, , s] = this._dims();
        let t = isNaN(this.shown) ? T_MIN : this.shown;
        let col = tempColor(t);

        // card
        this._roundRect(cr, 0, 0, W, H, 22 * s);
        cr.setSourceRGBA(0.07, 0.08, 0.10, this.bgOpacity);
        cr.fill();
        this._roundRect(cr, 0.5, 0.5, W - 1, H - 1, 22 * s);
        cr.setSourceRGBA(1, 1, 1, 0.07);
        cr.setLineWidth(1);
        cr.stroke();

        // ring gauge (270° sweep)
        let cx = W / 2, cy = 100 * s, R = 70 * s, lw = 11 * s;
        let a0 = 0.75 * Math.PI, sweep = 1.5 * Math.PI;
        let frac = Math.min(1, Math.max(0, (t - T_MIN) / (T_MAX - T_MIN)));
        cr.setLineCap(1); // ROUND

        cr.setLineWidth(lw);
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.arc(cx, cy, R, a0, a0 + sweep);
        cr.stroke();

        // tick marks every 10°
        cr.setLineWidth(1.2 * s);
        for (let v = T_MIN; v <= T_MAX; v += 10) {
            let a = a0 + sweep * (v - T_MIN) / (T_MAX - T_MIN);
            let r1 = R - lw / 2 - 5 * s, r2 = r1 - 4 * s;
            cr.setSourceRGBA(1, 1, 1, 0.18);
            cr.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
            cr.lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a));
            cr.stroke();
        }

        if (frac > 0.001) {
            // glow
            for (let g = 3; g >= 1; g--) {
                cr.setLineWidth(lw + g * 5 * s);
                cr.setSourceRGBA(col[0], col[1], col[2], 0.05);
                cr.arc(cx, cy, R, a0, a0 + sweep * frac);
                cr.stroke();
            }
            cr.setLineWidth(lw);
            cr.setSourceRGBA(col[0], col[1], col[2], 1);
            cr.arc(cx, cy, R, a0, a0 + sweep * frac);
            cr.stroke();
        }

        // peak marker
        if (isFinite(this.peak)) {
            let pf = Math.min(1, Math.max(0, (this.peak - T_MIN) / (T_MAX - T_MIN)));
            let a = a0 + sweep * pf;
            let pc = tempColor(this.peak);
            cr.setSourceRGBA(pc[0], pc[1], pc[2], 0.9);
            cr.arc(cx + (R + lw / 2 + 5 * s) * Math.cos(a), cy + (R + lw / 2 + 5 * s) * Math.sin(a), 2.2 * s, 0, 2 * Math.PI);
            cr.fill();
        }

        // centre text
        this._text(cr, isNaN(this.shown) ? "--" : this._fmt(t), 44 * s, Pango.Weight.LIGHT, cx + 6 * s, cy - 4 * s, [1, 1, 1, 0.95], "center");
        this._text(cr, (!this.ready || this.sensors.pkg) ? _("CPU") : _("No sensor"), 11 * s, Pango.Weight.BOLD, cx, cy + 28 * s, [col[0], col[1], col[2], 0.95], "center");
        this._text(cr, _("peak") + " " + (isFinite(this.peak) ? this._fmt(this.peak) : "--"), 9.5 * s, Pango.Weight.NORMAL, cx, cy + 62 * s, [1, 1, 1, 0.45], "center");

        let y = 196 * s;
        let pad = 18 * s, iw = W - 2 * pad;

        // per-core bars
        if (this.showCores && this.coreTemps.length) {
            let n = this.coreTemps.length, gap = 3 * s;
            let bw = (iw - gap * (n - 1)) / n, bh = 16 * s;
            this.coreTemps.forEach((ct, i) => {
                let x = pad + i * (bw + gap);
                let f = Math.min(1, Math.max(0.06, (ct - T_MIN) / (T_MAX - T_MIN)));
                this._roundRect(cr, x, y, bw, bh, Math.min(bw / 2, 2.5 * s));
                cr.setSourceRGBA(1, 1, 1, 0.07); cr.fill();
                let c = tempColor(ct);
                this._roundRect(cr, x, y + bh * (1 - f), bw, bh * f, Math.min(bw / 2, 2.5 * s));
                cr.setSourceRGBA(c[0], c[1], c[2], 0.9); cr.fill();
            });
            y += 26 * s;
        }

        // sparkline
        if (this.showGraph && this.history.length > 1) {
            let gh = 30 * s, gy = y + 2 * s;
            let lo = Math.min(...this.history) - 2, hi = Math.max(...this.history) + 2;
            let px = i => pad + iw * i / (HISTORY - 1);
            let off = HISTORY - this.history.length;
            let py = v => gy + gh - gh * (v - lo) / (hi - lo);

            cr.moveTo(px(off), gy + gh);
            this.history.forEach((v, i) => cr.lineTo(px(off + i), py(v)));
            cr.lineTo(px(HISTORY - 1), gy + gh);
            cr.closePath();
            let Cairo = imports.cairo;
            let grad = new Cairo.LinearGradient(0, gy, 0, gy + gh);
            grad.addColorStopRGBA(0, col[0], col[1], col[2], 0.35);
            grad.addColorStopRGBA(1, col[0], col[1], col[2], 0.0);
            cr.setSource(grad);
            cr.fill();

            cr.setLineWidth(1.5 * s);
            cr.setLineJoin(1);
            this.history.forEach((v, i) => (i ? cr.lineTo : cr.moveTo).call(cr, px(off + i), py(v)));
            cr.setSourceRGBA(col[0], col[1], col[2], 0.95);
            cr.stroke();
        }

        cr.$dispose();
    }

    on_desklet_removed() {
        this._removed = true;
        if (this.timer) GLib.source_remove(this.timer);
        if (this.anim) GLib.source_remove(this.anim);
    }
}

function main(metadata, id) {
    return new CpuTempRing(metadata, id);
}
