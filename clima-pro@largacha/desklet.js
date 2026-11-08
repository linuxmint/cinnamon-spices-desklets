// Clima Pro — desklet de pronóstico del tiempo para Cinnamon (Linux Mint)
// Datos: Open-Meteo (https://open-meteo.com), sin API key.
// Requiere `curl`, que viene instalado en Linux Mint.

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Cairo = imports.cairo;

// ───────────────────────── Textos ─────────────────────────
const TXT = {
    es: {
        loading: "Cargando pronóstico…",
        errNet: "No se pudo obtener el clima. Reintentando…",
        errCity: "Ciudad no encontrada. Revisa la configuración.",
        feels: "🌡️ Sensación",
        humidity: "💧 Humedad",
        wind: "💨 Viento",
        pressure: "🧭 Presión",
        uv: "☀️ UV",
        sun: "🌅 Sol",
        hourly: "PRÓXIMAS HORAS",
        daily: "PRÓXIMOS DÍAS",
        now: "Ahora",
        today: "Hoy",
        updated: "Actualizado",
        daysShort: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
        daysFull: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
        months: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        compass: ["N", "NE", "E", "SE", "S", "SO", "O", "NO"],
        uvLevels: ["Bajo", "Moderado", "Alto", "Muy alto", "Extremo"]
    },
    en: {
        loading: "Loading forecast…",
        errNet: "Couldn't get the weather. Retrying…",
        errCity: "City not found. Check the settings.",
        feels: "🌡️ Feels like",
        humidity: "💧 Humidity",
        wind: "💨 Wind",
        pressure: "🧭 Pressure",
        uv: "☀️ UV",
        sun: "🌅 Sun",
        hourly: "NEXT HOURS",
        daily: "NEXT DAYS",
        now: "Now",
        today: "Today",
        updated: "Updated",
        daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        daysFull: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
        compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
        uvLevels: ["Low", "Moderate", "High", "Very high", "Extreme"]
    }
};

// ───────────────── Códigos WMO → icono, texto y categoría ─────────────────
function C(d, n, es, en, cat) { return { d: d, n: n, es: es, en: en, cat: cat }; }
const WMO = {
    0: C("☀️", "🌙", "Despejado", "Clear sky", "clear"),
    1: C("🌤️", "🌙", "Mayormente despejado", "Mainly clear", "clear"),
    2: C("⛅", "☁️", "Parcialmente nublado", "Partly cloudy", "cloud"),
    3: C("☁️", "☁️", "Nublado", "Overcast", "cloud"),
    45: C("🌫️", "🌫️", "Niebla", "Fog", "fog"),
    48: C("🌫️", "🌫️", "Niebla helada", "Rime fog", "fog"),
    51: C("🌦️", "🌧️", "Llovizna ligera", "Light drizzle", "rain"),
    53: C("🌦️", "🌧️", "Llovizna", "Drizzle", "rain"),
    55: C("🌧️", "🌧️", "Llovizna intensa", "Heavy drizzle", "rain"),
    56: C("🌧️", "🌧️", "Llovizna helada", "Freezing drizzle", "rain"),
    57: C("🌧️", "🌧️", "Llovizna helada fuerte", "Heavy freezing drizzle", "rain"),
    61: C("🌦️", "🌧️", "Lluvia ligera", "Light rain", "rain"),
    63: C("🌧️", "🌧️", "Lluvia", "Rain", "rain"),
    65: C("🌧️", "🌧️", "Lluvia fuerte", "Heavy rain", "rain"),
    66: C("🌧️", "🌧️", "Lluvia helada", "Freezing rain", "rain"),
    67: C("🌧️", "🌧️", "Lluvia helada fuerte", "Heavy freezing rain", "rain"),
    71: C("🌨️", "🌨️", "Nevada ligera", "Light snow", "snow"),
    73: C("🌨️", "🌨️", "Nevada", "Snow", "snow"),
    75: C("❄️", "❄️", "Nevada fuerte", "Heavy snow", "snow"),
    77: C("🌨️", "🌨️", "Granos de nieve", "Snow grains", "snow"),
    80: C("🌦️", "🌧️", "Chubascos", "Rain showers", "rain"),
    81: C("🌧️", "🌧️", "Chubascos fuertes", "Heavy showers", "rain"),
    82: C("🌧️", "🌧️", "Chubascos violentos", "Violent showers", "rain"),
    85: C("🌨️", "🌨️", "Chubascos de nieve", "Snow showers", "snow"),
    86: C("❄️", "❄️", "Chubascos de nieve fuertes", "Heavy snow showers", "snow"),
    95: C("⛈️", "⛈️", "Tormenta eléctrica", "Thunderstorm", "storm"),
    96: C("⛈️", "⛈️", "Tormenta con granizo", "Thunderstorm with hail", "storm"),
    99: C("⛈️", "⛈️", "Tormenta con granizo fuerte", "Severe thunderstorm with hail", "storm")
};
const WMO_UNKNOWN = C("❔", "❔", "—", "—", "cloud");

function wmo(code) { return WMO[code] || WMO_UNKNOWN; }
function pad(n) { return (n < 10 ? "0" : "") + n; }

// Color según temperatura (°C) para las barras del pronóstico
const TEMP_STOPS = [
    [-10, [111, 168, 255]],
    [10, [79, 195, 247]],
    [20, [129, 199, 132]],
    [28, [255, 213, 79]],
    [36, [255, 112, 67]],
    [45, [229, 57, 53]]
];
function tempColor(c) {
    if (c <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
    for (let i = 1; i < TEMP_STOPS.length; i++) {
        let a = TEMP_STOPS[i - 1], b = TEMP_STOPS[i];
        if (c <= b[0]) {
            let t = (c - a[0]) / (b[0] - a[0]);
            return [0, 1, 2].map(k => Math.round(a[1][k] + (b[1][k] - a[1][k]) * t));
        }
    }
    return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

function rgba(arr, a) { return "rgba(" + arr[0] + "," + arr[1] + "," + arr[2] + "," + a + ")"; }

// ───────────────────────── Desklet ─────────────────────────
function ClimaDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

ClimaDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.uuid = metadata.uuid;
        this._timers = {};
        this._clockId = null;
        this._destroyed = false;
        this._req = 0;
        this.data = null;
        this.loc = null;
        this._geo = null;
        this.error = null;
        this.lastUpdate = null;
        this._timeLabel = null;
        this._dateLabel = null;

        this.settings = new Settings.DeskletSettings(this, this.uuid, desklet_id);
        let dataKeys = ["city", "units", "refresh_min"];
        let uiKeys = ["language", "theme", "opacity", "ui_scale", "hours", "days",
            "show_details", "show_hourly", "show_daily", "clock_24h"];
        dataKeys.forEach(k => this.settings.bindProperty(
            Settings.BindingDirection.IN, k, k, this._onDataSetting.bind(this), null));
        uiKeys.forEach(k => this.settings.bindProperty(
            Settings.BindingDirection.IN, k, k, this._onUiSetting.bind(this), null));

        this.root = new St.BoxLayout({ vertical: true, style_class: "clima-root" });
        this.setContent(this.root);
        this._menu.addAction("Actualizar / Refresh", () => this._refresh());

        this._renderLoading();
        this._clockId = Mainloop.timeout_add_seconds(20, () => {
            this._updateClock();
            return true;
        });
        this._refresh();
    },

    on_desklet_removed: function () {
        this._destroyed = true;
        Object.keys(this._timers).forEach(k => this._clearTimer(k));
        if (this._clockId) {
            Mainloop.source_remove(this._clockId);
            this._clockId = null;
        }
        if (this.settings) this.settings.finalize();
    },

    // ───── utilidades ─────
    _t: function (key) {
        let lang = TXT[this.language] ? this.language : "es";
        return TXT[lang][key];
    },

    px: function (n) {
        return Math.round(n * (this.ui_scale || 100) / 100);
    },

    _setTimer: function (name, ms, fn) {
        this._clearTimer(name);
        this._timers[name] = Mainloop.timeout_add(ms, () => {
            delete this._timers[name];
            if (!this._destroyed) fn();
            return false;
        });
    },

    _clearTimer: function (name) {
        if (this._timers[name]) {
            Mainloop.source_remove(this._timers[name]);
            delete this._timers[name];
        }
    },

    _onDataSetting: function () {
        this._geo = null;
        this._setTimer("settingsData", 1200, () => this._refresh());
    },

    _onUiSetting: function () {
        this._setTimer("settingsUi", 200, () => this._render());
    },

    // ───── red ─────
    _getJSON: function (url, cb) {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ["curl", "-sS", "-L", "--max-time", "20", "-A", "ClimaPro-Desklet/1.0", url],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            cb(e);
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            if (this._destroyed) return;
            let json = null, error = null;
            try {
                let r = p.communicate_utf8_finish(res);
                if (!p.get_successful()) throw new Error(r[2] || "curl");
                json = JSON.parse(r[1]);
            } catch (e) {
                error = e;
            }
            if (error) cb(error);
            else cb(null, json);
        });
    },

    _resolveLocation: function (cb) {
        let q = (this.city || "").trim();
        if (this._geo && this._geo.q === q) {
            cb(null, this._geo);
            return;
        }
        if (q === "") {
            this._getJSON("https://ipwho.is/", (err, j) => {
                if (err) return cb(err);
                if (!j || j.success === false || j.latitude === undefined) return cb(new Error("geo"));
                this._geo = { q: q, lat: j.latitude, lon: j.longitude, name: j.city || "—", cc: j.country_code || "" };
                cb(null, this._geo);
            });
        } else {
            let url = "https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&language=" +
                (this.language || "es") + "&name=" + encodeURIComponent(q);
            this._getJSON(url, (err, j) => {
                if (err) return cb(err);
                if (!j || !j.results || !j.results.length) return cb(new Error("notfound"));
                let r = j.results[0];
                this._geo = { q: q, lat: r.latitude, lon: r.longitude, name: r.name, cc: r.country_code || "" };
                cb(null, this._geo);
            });
        }
    },

    _fetchWeather: function (loc, cb) {
        let imp = this.units === "imperial";
        let url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
            "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m" +
            "&hourly=temperature_2m,precipitation_probability,weather_code,is_day,uv_index" +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max" +
            "&timezone=auto&forecast_days=7" +
            "&temperature_unit=" + (imp ? "fahrenheit" : "celsius") +
            "&wind_speed_unit=" + (imp ? "mph" : "kmh");
        this._getJSON(url, (err, j) => {
            if (err) return cb(err);
            if (!j || !j.current || !j.hourly || !j.daily) return cb(new Error("bad data"));
            cb(null, j);
        });
    },

    _refresh: function () {
        this._clearTimer("refresh");
        let req = ++this._req;
        this._resolveLocation((err, loc) => {
            if (req !== this._req || this._destroyed) return;
            if (err) return this._fail(err);
            this._fetchWeather(loc, (err2, data) => {
                if (req !== this._req || this._destroyed) return;
                if (err2) return this._fail(err2);
                this.data = data;
                this.loc = loc;
                this.error = null;
                this.lastUpdate = new Date();
                this._render();
                this._setTimer("refresh", Math.max(10, this.refresh_min || 30) * 60 * 1000, () => this._refresh());
            });
        });
    },

    _fail: function (err) {
        let msg = String(err && err.message ? err.message : err);
        let notFound = msg === "notfound";
        this.error = notFound ? this._t("errCity") : this._t("errNet");
        if (this.data) this._render();
        else this._renderLoading(this.error);
        this._setTimer("refresh", (notFound ? 600 : 120) * 1000, () => this._refresh());
    },

    // ───── formato ─────
    _fmtTime: function (d) {
        if (this.clock_24h) return pad(d.getHours()) + ":" + pad(d.getMinutes());
        let h = d.getHours();
        return (h % 12 || 12) + ":" + pad(d.getMinutes()) + " " + (h < 12 ? "AM" : "PM");
    },

    _fmtDate: function (d) {
        let t = TXT[TXT[this.language] ? this.language : "es"];
        let s = this.language === "en"
            ? t.daysFull[d.getDay()] + ", " + t.months[d.getMonth()] + " " + d.getDate()
            : t.daysFull[d.getDay()] + ", " + d.getDate() + " de " + t.months[d.getMonth()];
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    _fmtHourLabel: function (iso) {
        let h = parseInt(iso.slice(11, 13), 10);
        if (this.clock_24h) return pad(h) + ":00";
        return (h % 12 || 12) + (h < 12 ? " AM" : " PM");
    },

    _fmtClockStr: function (iso) {
        // "2026-11-01T05:52" → "05:52" (o 5:52 AM)
        let h = parseInt(iso.slice(11, 13), 10), m = iso.slice(14, 16);
        if (this.clock_24h) return pad(h) + ":" + m;
        return (h % 12 || 12) + ":" + m + (h < 12 ? "a" : "p");
    },

    _dayName: function (isoDate, idx) {
        if (idx === 0) return this._t("today");
        let p = isoDate.split("-").map(Number);
        return this._t("daysShort")[new Date(p[0], p[1] - 1, p[2]).getDay()];
    },

    _deg: function (v) { return Math.round(v) + "°"; },

    _toC: function (v) { return this.units === "imperial" ? (v - 32) * 5 / 9 : v; },

    _updateClock: function () {
        try {
            let now = new Date();
            if (this._timeLabel) this._timeLabel.set_text(this._fmtTime(now));
            if (this._dateLabel) this._dateLabel.set_text(this._fmtDate(now));
        } catch (e) { /* los labels pudieron destruirse durante un re-render */ }
    },

    // ───── paletas ─────
    _autoPalette: function () {
        if (!this.data) return { g1: [8, 12, 36], g2: [38, 52, 104], fg: [255, 255, 255] };
        let cur = this.data.current;
        let cat = wmo(cur.weather_code).cat;
        let night = !cur.is_day;
        let pal = {
            clear: [[38, 120, 224], [108, 196, 247], [8, 12, 36], [38, 52, 104]],
            cloud: [[84, 104, 126], [150, 168, 186], [26, 32, 48], [56, 66, 88]],
            fog: [[96, 106, 116], [168, 176, 184], [34, 38, 46], [70, 76, 86]],
            rain: [[48, 66, 88], [92, 116, 140], [20, 28, 44], [44, 60, 82]],
            snow: [[104, 128, 152], [196, 212, 226], [38, 50, 70], [88, 106, 130]],
            storm: [[34, 26, 58], [84, 64, 120], [22, 16, 40], [62, 46, 92]]
        }[cat];
        return night
            ? { g1: pal[2], g2: pal[3], fg: [255, 255, 255] }
            : { g1: pal[0], g2: pal[1], fg: [255, 255, 255] };
    },

    _palette: function () {
        let a = Math.max(0.2, Math.min(1, (this.opacity || 92) / 100));
        let P;
        switch (this.theme) {
            case "dark":
                P = { g1: [24, 28, 40], g2: [12, 14, 20], fg: [255, 255, 255] };
                break;
            case "light":
                P = { g1: [252, 253, 255], g2: [221, 231, 243], fg: [26, 36, 54], light: true };
                break;
            case "glass":
                P = { g1: [34, 40, 58], g2: [14, 18, 28], fg: [255, 255, 255] };
                a = a * 0.6;
                break;
            default:
                P = this._autoPalette();
        }
        P.a = a;
        P.pill = P.light ? "rgba(26,36,54,0.07)" : "rgba(255,255,255,0.11)";
        P.line = rgba(P.fg, 0.14);
        P.warm = P.light ? [214, 84, 40] : [255, 183, 120];
        P.cool = P.light ? [40, 110, 200] : [135, 200, 255];
        return P;
    },

    // ───── widgets de ayuda ─────
    _lbl: function (text, size, o) {
        o = o || {};
        let P = this.P;
        let col = o.color || (o.dim ? rgba(P.fg, 0.68) : rgba(P.fg, 1));
        let st = "font-size: " + this.px(size) + "px; color: " + col + ";";
        if (o.bold) st += " font-weight: bold;";
        if (o.align) st += " text-align: " + o.align + ";";
        let props = { text: String(text), style: st };
        if (o.width) props.width = o.width;
        if (o.vcenter) props.y_align = Clutter.ActorAlign.CENTER;
        return new St.Label(props);
    },

    _gap: function (h) {
        return new St.Widget({ height: this.px(h) });
    },

    _divider: function () {
        return new St.Widget({ height: 1, style: "background-color: " + this.P.line + ";" });
    },

    _section: function (text) {
        return this._lbl(text, 10, { dim: true, bold: true });
    },

    _rootStyle: function (P) {
        return "background-gradient-direction: vertical;" +
            " background-gradient-start: " + rgba(P.g1, P.a) + ";" +
            " background-gradient-end: " + rgba(P.g2, P.a) + ";" +
            " border-radius: " + this.px(24) + "px;" +
            " border: 1px solid " + rgba(P.fg, 0.14) + ";" +
            " padding: " + this.px(20) + "px;";
    },

    _pill: function (title, value, w, valueSize) {
        let box = new St.BoxLayout({
            vertical: true,
            width: w,
            style: "background-color: " + this.P.pill + "; border-radius: " + this.px(14) + "px; padding: " +
                this.px(8) + "px " + this.px(10) + "px;"
        });
        box.add_child(this._lbl(title, 10, { dim: true }));
        box.add_child(this._lbl(value, valueSize || 14, { bold: true }));
        return box;
    },

    _disposeCr: function (cr) {
        try { cr.$dispose(); } catch (e) {
            try { cr.__proto__.$dispose.call(cr); } catch (e2) { /* nada */ }
        }
    },

    // Curva suavizada de temperatura por horas (Cairo)
    _makeCurve: function (temps, w, h) {
        let area = new St.DrawingArea({ width: w, height: h });
        let P = this.P;
        let n = temps.length;
        area.connect("repaint", (a) => {
            let cr = a.get_context();
            try {
                let sz = a.get_surface_size();
                let cw = sz[0], ch = sz[1];
                let lo = Math.min.apply(null, temps), hi = Math.max.apply(null, temps);
                let range = Math.max(1, hi - lo);
                let top = this.px(10), bottom = this.px(8);
                let pts = temps.map((t, i) => [
                    (i + 0.5) * cw / n,
                    top + (1 - (t - lo) / range) * (ch - top - bottom)
                ]);
                let f = P.fg.map(v => v / 255);
                let get = (i) => pts[Math.max(0, Math.min(n - 1, i))];
                let trace = () => {
                    cr.moveTo(pts[0][0], pts[0][1]);
                    for (let i = 0; i < n - 1; i++) {
                        let p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
                        cr.curveTo(
                            p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
                            p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
                            p2[0], p2[1]);
                    }
                };
                if (n > 1) {
                    // relleno degradado bajo la curva
                    cr.newPath();
                    trace();
                    cr.lineTo(pts[n - 1][0], ch);
                    cr.lineTo(pts[0][0], ch);
                    cr.closePath();
                    let g = new Cairo.LinearGradient(0, 0, 0, ch);
                    g.addColorStopRGBA(0, f[0], f[1], f[2], 0.34);
                    g.addColorStopRGBA(1, f[0], f[1], f[2], 0.0);
                    cr.setSource(g);
                    cr.fill();
                    // línea
                    cr.newPath();
                    trace();
                    cr.setSourceRGBA(f[0], f[1], f[2], 0.95);
                    cr.setLineWidth(Math.max(1.5, this.px(2.2)));
                    cr.stroke();
                }
                // puntos
                for (let i = 0; i < n; i++) {
                    let r = i === 0 ? this.px(4.5) : this.px(2.6);
                    if (i === 0) {
                        cr.setSourceRGBA(f[0], f[1], f[2], 0.3);
                        cr.arc(pts[i][0], pts[i][1], r + this.px(3), 0, 2 * Math.PI);
                        cr.fill();
                    }
                    cr.setSourceRGBA(f[0], f[1], f[2], 1);
                    cr.arc(pts[i][0], pts[i][1], r, 0, 2 * Math.PI);
                    cr.fill();
                }
            } catch (e) {
                global.logError("ClimaPro curve: " + e);
            }
            this._disposeCr(cr);
        });
        return area;
    },

    // ───── render ─────
    _renderLoading: function (msg) {
        if (this._destroyed) return;
        this.P = this._palette();
        this._timeLabel = null;
        this._dateLabel = null;
        this.root.destroy_all_children();
        this.root.set_style(this._rootStyle(this.P));
        this.root.set_width(this.px(400));
        this.root.add_child(this._lbl(msg || this._t("loading"), 14, { dim: true }));
    },

    _render: function () {
        if (this._destroyed) return;
        try {
            this._renderInner();
        } catch (e) {
            global.logError("ClimaPro render: " + e);
        }
    },

    _renderInner: function () {
        if (!this.data) {
            this._renderLoading(this.error);
            return;
        }
        let d = this.data, cur = d.current, daily = d.daily, hourly = d.hourly;
        let imp = this.units === "imperial";
        let P = this.P = this._palette();
        let lang = TXT[this.language] ? this.language : "es";
        let T = TXT[lang];
        let px = (n) => this.px(n);

        let W = px(400), pad2 = px(20);
        let inner = W - 2 * pad2 - 2;
        let gap = px(8);

        this.root.destroy_all_children();
        this.root.set_style(this._rootStyle(P));
        this.root.set_width(W);

        let info = wmo(cur.weather_code);
        let icon = cur.is_day ? info.d : info.n;

        // Índice de la hora actual dentro de los arreglos horarios
        let curHour = cur.time.slice(0, 13);
        let curIdx = hourly.time.findIndex(t => t.slice(0, 13) >= curHour);
        if (curIdx < 0) curIdx = 0;

        // ── Cabecera: ciudad / fecha / hora ──
        let head = new St.BoxLayout({ vertical: false });
        let left = new St.BoxLayout({ vertical: true, x_expand: true });
        let place = this.loc ? this.loc.name + (this.loc.cc ? ", " + this.loc.cc : "") : "";
        left.add_child(this._lbl("📍 " + place, 17, { bold: true }));
        this._dateLabel = this._lbl(this._fmtDate(new Date()), 11, { dim: true });
        left.add_child(this._dateLabel);
        head.add_child(left);
        this._timeLabel = this._lbl(this._fmtTime(new Date()), 28, { bold: true, vcenter: true });
        head.add_child(this._timeLabel);
        this.root.add_child(head);
        this.root.add_child(this._gap(6));

        // ── Clima actual ──
        let now = new St.BoxLayout({ vertical: false });
        now.add_child(this._lbl(icon, 62, { vcenter: true }));
        let mid = new St.BoxLayout({ vertical: true, style: "padding-left: " + px(10) + "px;" });
        mid.add_child(this._lbl(this._deg(cur.temperature_2m), 56, { bold: true }));
        mid.add_child(this._lbl(info[lang], 14, { dim: true }));
        now.add_child(mid);
        now.add_child(new St.Widget({ x_expand: true }));
        let hl = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER });
        hl.add_child(this._lbl("▲ " + this._deg(daily.temperature_2m_max[0]), 16,
            { bold: true, color: rgba(P.warm, 1), align: "right" }));
        hl.add_child(this._lbl("▼ " + this._deg(daily.temperature_2m_min[0]), 16,
            { bold: true, color: rgba(P.cool, 1), align: "right" }));
        now.add_child(hl);
        this.root.add_child(now);
        this.root.add_child(this._gap(10));

        // ── Detalles ──
        if (this.show_details) {
            let pillW = Math.floor((inner - 2 * gap) / 3);
            let dirIdx = Math.round(((cur.wind_direction_10m % 360) + 360) % 360 / 45) % 8;
            let windStr = Math.round(cur.wind_speed_10m) + (imp ? " mph " : " km/h ") + T.compass[dirIdx];
            let pressStr = imp ? (cur.pressure_msl * 0.02953).toFixed(2) + " inHg" : Math.round(cur.pressure_msl) + " hPa";
            // UV de la hora actual (0 de noche); el máximo del día va en el título
            let uvMax = daily.uv_index_max[0] || 0;
            let uvH = hourly.uv_index ? hourly.uv_index[curIdx] : null;
            let uvNow = (uvH === null || uvH === undefined) ? uvMax : uvH;
            let uvLvl = uvNow < 3 ? 0 : uvNow < 6 ? 1 : uvNow < 8 ? 2 : uvNow < 11 ? 3 : 4;
            let uvStr = Math.round(uvNow) + " · " + T.uvLevels[uvLvl];
            let uvTitle = T.uv + " · " + (lang === "en" ? "max " : "máx ") + Math.round(uvMax);
            let sunStr = this._fmtClockStr(daily.sunrise[0]) + " · " + this._fmtClockStr(daily.sunset[0]);

            let row1 = new St.BoxLayout({ vertical: false, style: "spacing: " + gap + "px;" });
            row1.add_child(this._pill(T.feels, this._deg(cur.apparent_temperature), pillW));
            row1.add_child(this._pill(T.humidity, Math.round(cur.relative_humidity_2m) + "%", pillW));
            row1.add_child(this._pill(T.wind, windStr, pillW, 12));
            this.root.add_child(row1);
            this.root.add_child(this._gap(8));
            let row2 = new St.BoxLayout({ vertical: false, style: "spacing: " + gap + "px;" });
            row2.add_child(this._pill(T.pressure, pressStr, pillW, 12));
            row2.add_child(this._pill(uvTitle, uvStr, pillW, 12));
            row2.add_child(this._pill(T.sun, sunStr, pillW, 12));
            this.root.add_child(row2);
            this.root.add_child(this._gap(12));
        }

        // ── Próximas horas ──
        if (this.show_hourly) {
            let n = Math.max(4, Math.min(12, this.hours || 8));
            let start = curIdx;
            n = Math.min(n, hourly.time.length - start);

            let temps = [];
            for (let i = 0; i < n; i++) temps.push(hourly.temperature_2m[start + i]);

            this.root.add_child(this._divider());
            this.root.add_child(this._gap(8));
            this.root.add_child(this._section(T.hourly));
            let colW = Math.floor(inner / n);
            this.root.add_child(this._makeCurve(temps, colW * n, px(54)));

            let cols = new St.BoxLayout({ vertical: false });
            for (let i = 0; i < n; i++) {
                let k = start + i;
                let hi = wmo(hourly.weather_code[k]);
                let col = new St.BoxLayout({ vertical: true, width: colW });
                col.add_child(this._lbl(temps[i] !== undefined ? this._deg(temps[i]) : "–", 13,
                    { bold: true, width: colW, align: "center" }));
                col.add_child(this._lbl(hourly.is_day[k] ? hi.d : hi.n, 20, { width: colW, align: "center" }));
                let pp = hourly.precipitation_probability[k];
                col.add_child(this._lbl(pp >= 10 ? Math.round(pp) + "%" : " ", 10,
                    { width: colW, align: "center", color: rgba(P.cool, 1) }));
                col.add_child(this._lbl(i === 0 ? T.now : this._fmtHourLabel(hourly.time[k]), 10,
                    { dim: true, width: colW, align: "center" }));
                cols.add_child(col);
            }
            this.root.add_child(cols);
            this.root.add_child(this._gap(10));
        }

        // ── Próximos días ──
        if (this.show_daily) {
            let nd = Math.max(3, Math.min(7, this.days || 5));
            nd = Math.min(nd, daily.time.length);
            this.root.add_child(this._divider());
            this.root.add_child(this._gap(8));
            this.root.add_child(this._section(T.daily));
            this.root.add_child(this._gap(4));

            let wMin = Infinity, wMax = -Infinity;
            for (let i = 0; i < nd; i++) {
                wMin = Math.min(wMin, daily.temperature_2m_min[i]);
                wMax = Math.max(wMax, daily.temperature_2m_max[i]);
            }
            let range = Math.max(1, wMax - wMin);

            let dayW = px(46), emW = px(30), popW = px(44), tW = px(36), rowGap = px(8);
            let barW = Math.max(px(40), inner - (dayW + emW + popW + 2 * tW) - 5 * rowGap);

            for (let i = 0; i < nd; i++) {
                let dInfo = wmo(daily.weather_code[i]);
                let mn = daily.temperature_2m_min[i], mx = daily.temperature_2m_max[i];
                let row = new St.BoxLayout({
                    vertical: false,
                    style: "spacing: " + rowGap + "px; padding: " + px(3) + "px 0px;"
                });
                row.add_child(this._lbl(this._dayName(daily.time[i], i), 13, { bold: true, width: dayW, vcenter: true }));
                row.add_child(this._lbl(dInfo.d, 18, { width: emW, align: "center", vcenter: true }));
                let pp = daily.precipitation_probability_max[i];
                row.add_child(this._lbl(pp >= 10 ? "💧" + Math.round(pp) + "%" : " ", 10,
                    { width: popW, color: rgba(P.cool, 1), vcenter: true }));
                row.add_child(this._lbl(this._deg(mn), 13, { dim: true, width: tW, align: "right", vcenter: true }));

                let off = Math.round((mn - wMin) / range * barW);
                let span = Math.max(px(8), Math.round((mx - mn) / range * barW));
                if (off + span > barW) off = barW - span;
                let c1 = tempColor(this._toC(mn)), c2 = tempColor(this._toC(mx));
                let track = new St.BoxLayout({
                    vertical: false, width: barW, height: px(7),
                    y_align: Clutter.ActorAlign.CENTER,
                    style: "background-color: " + rgba(P.fg, 0.16) + "; border-radius: " + px(4) + "px;"
                });
                track.add_child(new St.Widget({ width: off }));
                track.add_child(new St.Widget({
                    width: span, height: px(7),
                    style: "border-radius: " + px(4) + "px; background-gradient-direction: horizontal;" +
                        " background-gradient-start: " + rgba(c1, 1) + ";" +
                        " background-gradient-end: " + rgba(c2, 1) + ";"
                }));
                row.add_child(track);
                row.add_child(this._lbl(this._deg(mx), 13, { bold: true, width: tW, align: "right", vcenter: true }));
                this.root.add_child(row);
            }
            this.root.add_child(this._gap(6));
        }

        // ── Pie ──
        let foot = this._t("updated") + " " + this._fmtTime(this.lastUpdate || new Date()) + " · Open-Meteo";
        if (this.error) foot = "⚠️ " + this.error;
        this.root.add_child(this._lbl(foot, 9, { dim: true, align: "right" }));
    }
};

function main(metadata, desklet_id) {
    return new ClimaDesklet(metadata, desklet_id);
}
