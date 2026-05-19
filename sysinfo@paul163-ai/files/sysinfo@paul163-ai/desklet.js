const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;

const DATA_FILE = "/tmp/sysinfo-paul163.json";

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function MyDesklet(metadata, desklet_id) { this._init(metadata, desklet_id); }

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this._dead    = false;
        this._gen     = 0;
        this._timeout = null;

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
            this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "disk-paths",       "diskPathsRaw",    this._rebuild, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-gpu",         "showGpu",         this._rebuild, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-network",     "showNetwork",     this._rebuild, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "show-battery",     "showBattery",     this._rebuild, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color",         "bgColor",         this._applyTheme, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "bg-opacity",       "bgOpacity",       this._applyTheme, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "text-color",       "textColor",       this._applyTheme, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "accent-color",     "accentColor",     this._applyTheme, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "font-size",        "fontSize",        this._applyTheme, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-scale",    "deskletScale",    this._applyTheme, null);
        } catch(e) {
            global.logError("sysinfo@paul163-ai settings: " + e);
        }

        this._rebuild();
        this._startDaemon();
        this._update();
    },

    _startDaemon: function() {
        try {
            let daemonPath = this.metadata.path + "/sysinfo-daemon.py";
            let paths = (this.diskPathsRaw || "/").split(",").map(p => p.trim()).filter(p => p);
            let args = ["python3", daemonPath].concat(paths);
            Gio.Subprocess.new(args, Gio.SubprocessFlags.NONE);
        } catch(e) {
            global.logError("sysinfo@paul163-ai: could not start daemon: " + e);
        }
    },

    _rebuild: function() {
        this._gen++;
        this._root = new St.BoxLayout({ vertical: true, style_class: "sysinfo-root" });
        this._w = {};
        this._sectionLabels = [];
        this._buildHeader();

        this._buildSection("SYSTEM");
        this._addRow("uptime", "Uptime",    "--");
        this._addRow("load",   "Load avg",  "--");
        this._addRow("procs",  "Processes", "--");

        this._buildSection("CPU");
        this._addRow("cpu_model",   "Model",       "--");
        this._addRow("cpu_threads", "Threads",     "--");
        this._addRow("cpu_pct",     "Usage",       "--%");
        this._addBar("cpu");
        this._addRow("cpu_freq",    "Frequency",   "-- GHz");
        this._addRow("cpu_temp",    "Temperature", "--°C");

        this._buildSection("MEMORY");
        this._addRow("ram",   "RAM",       "-- / -- GB");
        this._addBar("ram");
        this._addRow("swap",  "Swap",      "-- / -- GB");
        this._addBar("swap");
        this._addRow("cache", "Cache+Buf", "-- GB");

        if (this.showGpu !== false) {
            this._buildSection("GPU");
            this._addRow("gpu_name", "Model",       "--");
            this._addRow("gpu_pct",  "Usage",       "--%");
            this._addBar("gpu");
            this._addRow("gpu_vram", "VRAM",        "-- / -- GB");
            this._addRow("gpu_temp", "Temperature", "--°C");
        }

        this._buildSection("STORAGE");
        this._diskPaths = [];
        let paths = (this.diskPathsRaw || "/").split(",").map(p => p.trim()).filter(p => p);
        for (let p of paths) {
            this._addRow("disk_" + p, p, "-- / -- GB");
            this._addBar("disk_" + p);
            this._diskPaths.push(p);
        }

        if (this.showNetwork !== false) {
            this._buildSection("NETWORK");
            this._addRow("net_down", "Download", "-- KB/s");
            this._addRow("net_up",   "Upload",   "-- KB/s");
            this._addRow("net_rx",   "Total ↓",  "--");
            this._addRow("net_tx",   "Total ↑",  "--");
        }

        if (this.showBattery !== false) {
            this._buildSection("BATTERY");
            this._addRow("bat_pct",  "Level",     "--%");
            this._addBar("bat");
            this._addRow("bat_stat", "Status",    "--");
            this._addRow("bat_time", "Est. time", "--");
        }

        this.setContent(this._root);
        this._applyTheme();
    },

    _buildHeader: function() {
        let col = new St.BoxLayout({ vertical: true });
        this._hostnameLabel = new St.Label({ text: "Loading…", style_class: "sysinfo-hostname" });
        this._osLabel       = new St.Label({ text: " ",        style_class: "sysinfo-os" });
        this._kernelLabel   = new St.Label({ text: " ",        style_class: "sysinfo-kernel" });
        col.add_actor(this._hostnameLabel);
        col.add_actor(this._osLabel);
        col.add_actor(this._kernelLabel);
        this._root.add(col,                           { x_fill: true });
        this._root.add(new St.Widget({ height: 10 }), { x_fill: true });
    },

    _buildSection: function(title) {
        this._root.add(new St.Widget({ height: 8 }), { x_fill: true });
        let lbl = new St.Label({ text: title, style_class: "sysinfo-section-title" });
        this._sectionLabels.push(lbl);
        this._root.add(lbl,                          { x_fill: true });
        this._root.add(new St.Widget({ height: 4 }), { x_fill: true });
        return lbl;
    },

    _addRow: function(key, labelText, defaultVal) {
        let row = new St.BoxLayout({ vertical: false });
        let lbl = new St.Label({ text: labelText, style_class: "sysinfo-dim" });
        let val = new St.Label({ text: defaultVal, style_class: "sysinfo-val" });
        row.add(lbl, { expand: false, x_fill: false });
        row.add(val, { expand: true,  x_fill: true });
        this._root.add(row, { x_fill: true });
        if (key && key[0] !== "_") this._w[key] = val;
        return val;
    },

    _addBar: function(key) {
        let bg   = new St.Bin({ style_class: "sysinfo-bar-bg", x_align: St.Align.START });
        let fill = new St.Bin({ style_class: "sysinfo-bar-fill", width: 0 });
        bg.set_child(fill);
        this._root.add(bg,                           { x_fill: true });
        this._root.add(new St.Widget({ height: 4 }), { x_fill: true });
        this._w[key + "_bar"] = { bg, fill };
    },

    _applyTheme: function() {
        let tc    = this.textColor    || "rgba(255,255,255,0.95)";
        let ac    = this.accentColor  || "rgba(52,152,219,1)";
        let fs    = this.fontSize     || 9;
        let scale = this.deskletScale || 1.0;
        let bgOpacity = this.bgOpacity !== undefined ? this.bgOpacity : 0.0;
        let bgBase    = this.bgColor || "rgb(0,0,0)";
        let bgRgba;
        if (bgBase.startsWith("rgba("))
            bgRgba = bgBase.replace(/,\s*[\d.]+\s*\)$/, ", " + bgOpacity + ")");
        else if (bgBase.startsWith("rgb("))
            bgRgba = bgBase.replace("rgb(", "rgba(").replace(")", ", " + bgOpacity + ")");
        else
            bgRgba = "rgba(0,0,0," + bgOpacity + ")";

        if (this._root)
            this._root.style = "background-color: " + bgRgba + "; border-radius: 10px;" +
                                " color: " + tc + "; font-size: " + fs + "pt;";
        this.actor.set_scale(scale, scale);
        if (this._hostnameLabel)
            this._hostnameLabel.style = "font-size: " + (fs+4) + "pt; font-weight: bold; color: white;";
        if (this._osLabel)
            this._osLabel.style = "font-size: " + (fs-1) + "pt; color: rgba(255,255,255,0.65); padding-top: 1px;";
        if (this._kernelLabel)
            this._kernelLabel.style = "font-size: " + (fs-1) + "pt; color: rgba(255,255,255,0.5); padding-top: 1px;";
        let sectionStyle = "font-weight: bold; font-size: " + (fs+1) + "pt;" +
                           " color: rgba(255,255,255,0.85); letter-spacing: 1px;" +
                           " padding-bottom: 3px; border-bottom: 1px solid rgba(255,255,255,0.2);";
        for (let lbl of (this._sectionLabels || [])) lbl.style = sectionStyle;
        for (let k in this._w) {
            if (!k.endsWith("_bar")) continue;
            let b = this._w[k];
            if (b && b.fill)
                b.fill.style = "background-color: " + ac + "; height: 5px; border-radius: 3px;";
        }
    },

    _set: function(key, text) {
        if (this._w && this._w[key]) this._w[key].set_text(String(text));
    },

    _setBar: function(key, pct) {
        let b = this._w && this._w[key + "_bar"];
        if (!b || !b.fill || !b.bg) return;
        pct = clamp(isNaN(pct) ? 0 : pct, 0, 100);
        let w = b.bg.get_width();
        if (w <= 0) w = 294;
        b.fill.set_width(Math.round((pct / 100) * w));
        let color;
        if (pct >= 90)      color = "#e74c3c";
        else if (pct >= 75) color = "#f39c12";
        else                color = this.accentColor || "rgba(52,152,219,1)";
        b.fill.style = "background-color: " + color + "; height: 5px; border-radius: 3px;";
    },

    // Single async file read — all the heavy work is done by the Python daemon
    _update: function() {
        if (this._dead) return;
        let gen = this._gen;

        Gio.File.new_for_path(DATA_FILE).load_contents_async(null, (f, res) => {
            if (this._dead || this._gen !== gen) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let d = JSON.parse(new TextDecoder().decode(c));
                this._applyData(d);
            } catch(e) {}
        });

        if (this._timeout) Mainloop.source_remove(this._timeout);
        if (!this._dead) {
            let iv = clamp(this.refreshInterval || 2, 1, 60);
            this._timeout = Mainloop.timeout_add_seconds(iv, () => { this._update(); return false; });
        }
    },

    _applyData: function(d) {
        if (d.static) {
            let s = d.static;
            if (this._hostnameLabel && s.hostname) this._hostnameLabel.set_text(s.hostname);
            if (this._osLabel       && s.os_name)  this._osLabel.set_text(s.os_name);
            if (this._kernelLabel   && s.kernel)   this._kernelLabel.set_text("Kernel " + s.kernel);
            if (s.cpu_model)   this._set("cpu_model",   s.cpu_model);
            if (s.cpu_threads) this._set("cpu_threads", s.cpu_threads);
        }
        if (d.uptime) this._set("uptime", d.uptime);
        if (d.load)   this._set("load",   d.load);
        if (d.procs)  this._set("procs",  d.procs);
        if (d.cpu_pct)  { this._set("cpu_pct", d.cpu_pct); this._setBar("cpu", d.cpu_bar || 0); }
        if (d.cpu_freq)   this._set("cpu_freq", d.cpu_freq);
        if (d.cpu_temp)   this._set("cpu_temp", d.cpu_temp);
        if (d.ram)  { this._set("ram",  d.ram);  this._setBar("ram",  d.ram_bar  || 0); }
        if (d.swap) { this._set("swap", d.swap); this._setBar("swap", d.swap_bar || 0); }
        if (d.cache)  this._set("cache", d.cache);
        if (d.gpu_name) {
            this._set("gpu_name", d.gpu_name);
            this._set("gpu_pct",  d.gpu_pct  || "--%");
            this._setBar("gpu",   d.gpu_bar  || 0);
            this._set("gpu_vram", d.gpu_vram || "--");
            this._set("gpu_temp", d.gpu_temp || "--°C");
        }
        for (let p of (this._diskPaths || [])) {
            let k = "disk_" + p;
            if (d[k]) { this._set(k, d[k]); this._setBar(k, d[k + "_bar"] || 0); }
        }
        if (d.net_down) this._set("net_down", d.net_down);
        if (d.net_up)   this._set("net_up",   d.net_up);
        if (d.net_rx)   this._set("net_rx",   d.net_rx);
        if (d.net_tx)   this._set("net_tx",   d.net_tx);
        if (d.bat_pct)  { this._set("bat_pct", d.bat_pct); this._setBar("bat", d.bat_bar || 0); }
        if (d.bat_stat)  this._set("bat_stat", d.bat_stat);
        if (d.bat_time)  this._set("bat_time", d.bat_time);
    },

    on_desklet_removed: function() {
        this._dead = true;
        if (this._timeout) Mainloop.source_remove(this._timeout);
        if (this.settings) this.settings.finalize();
        // Kill the daemon via its pidfile
        try {
            Gio.File.new_for_path("/tmp/sysinfo-paul163.pid").load_contents_async(null, (f, res) => {
                try {
                    let [ok, c] = f.load_contents_finish(res);
                    if (ok) {
                        let pid = parseInt(new TextDecoder().decode(c).trim());
                        if (pid) GLib.spawn_async(null, ["kill", String(pid)], null,
                            GLib.SpawnFlags.SEARCH_PATH, null);
                    }
                } catch(e) {}
            });
        } catch(e) {}
    }
};

function main(metadata, desklet_id) { return new MyDesklet(metadata, desklet_id); }
