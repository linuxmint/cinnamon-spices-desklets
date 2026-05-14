const Desklet  = imports.ui.desklet;
const St       = imports.gi.St;
const GLib     = imports.gi.GLib;
const Gio      = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
    if (isNaN(bytes) || bytes < 0) return "0 B";
    if (bytes < 1024)        return bytes.toFixed(0) + " B";
    if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824)  return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
}

function fmtGB(kb) { return (kb / 1048576).toFixed(2) + " GB"; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── desklet ────────────────────────────────────────────────────────────────

function MyDesklet(metadata, desklet_id) { this._init(metadata, desklet_id); }

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._dead    = false;
        this._gen     = 0;
        this._timeout = null;

        this._cpuPrevTotal = 0;
        this._cpuPrevIdle  = 0;
        this._netPrevTime  = 0;
        this._netPrevRx    = 0;
        this._netPrevTx    = 0;

        // Static info — loaded async and patched into live labels
        this._hostname = "Loading…";
        this._osName   = "";
        this._kernel   = "";
        this._cpuName  = "";
        this._cpuCores = 0;

        // Label refs for async static patches
        this._hostnameLabel = null;
        this._osLabel       = null;
        this._kernelLabel   = null;

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
        this._loadStaticAsync();
        this._update();
    },

    // ── static info (all async, no blocking calls) ───────────────────────

    _loadStaticAsync: function() {
        // Hostname
        Gio.File.new_for_path("/etc/hostname").load_contents_async(null, (f, res) => {
            if (this._dead) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (ok) {
                    this._hostname = c.toString().trim();
                    if (this._hostnameLabel) this._hostnameLabel.set_text(this._hostname);
                }
            } catch(e) {}
        });

        // OS name
        Gio.File.new_for_path("/etc/os-release").load_contents_async(null, (f, res) => {
            if (this._dead) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (ok) {
                    let m = c.toString().match(/^PRETTY_NAME="(.+)"$/m);
                    if (m) {
                        this._osName = m[1];
                        if (this._osLabel) this._osLabel.set_text(this._osName);
                    }
                }
            } catch(e) {}
        });

        // Kernel — uname via async subprocess
        try {
            let proc = Gio.Subprocess.new(["uname", "-r"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (ok && out) {
                        this._kernel = out.trim();
                        if (this._kernelLabel) this._kernelLabel.set_text("Kernel " + this._kernel);
                    }
                } catch(e) {}
            });
        } catch(e) {}

        // CPU model + thread count from /proc/cpuinfo
        Gio.File.new_for_path("/proc/cpuinfo").load_contents_async(null, (f, res) => {
            if (this._dead) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let text = c.toString();
                let nm = text.match(/^model name\s*:\s*(.+)$/m);
                if (nm) {
                    this._cpuName = nm[1]
                        .replace(/Intel\(R\) Core\(TM\)\s*/i, "")
                        .replace(/AMD\s+/i, "")
                        .replace(/ CPU\b/i, "")
                        .replace(/ @ [\d.]+GHz/i, "")
                        .replace(/\s+\d+-Core\s+Processor/i, "")
                        .replace(/\s+Processor$/i, "")
                        .trim();
                    this._set("cpu_model", this._cpuName);
                }
                this._cpuCores = (text.match(/^processor\s*:/gm) || []).length;
                if (this._cpuCores) this._set("cpu_threads", this._cpuCores.toString());
            } catch(e) {}
        });
    },

    // ── UI construction ──────────────────────────────────────────────────

    _rebuild: function() {
        this._gen++;

        this._root = new St.BoxLayout({ vertical: true, style_class: "sysinfo-root" });
        this._w = {};
        this._sectionLabels = [];

        this._buildHeader();

        this._buildSection("SYSTEM");
        this._addRow("uptime", "Uptime",     "--");
        this._addRow("load",   "Load avg",   "--");
        this._addRow("procs",  "Processes",  "--");

        this._buildSection("CPU");
        this._addRow("cpu_model",   "Model",       this._cpuName || "--");
        this._addRow("cpu_threads", "Threads",     this._cpuCores ? this._cpuCores.toString() : "--");
        this._addRow("cpu_pct",     "Usage",       "--%");
        this._addBar("cpu");
        this._addRow("cpu_freq",    "Frequency",   "-- GHz");
        this._addRow("cpu_temp",    "Temperature", "--°C");

        this._buildSection("MEMORY");
        this._addRow("ram",   "RAM",        "-- / -- GB");
        this._addBar("ram");
        this._addRow("swap",  "Swap",       "-- / -- GB");
        this._addBar("swap");
        this._addRow("cache", "Cache+Buf",  "-- GB");

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
            this._addRow("bat_pct",  "Level",    "--%");
            this._addBar("bat");
            this._addRow("bat_stat", "Status",   "--");
            this._addRow("bat_time", "Est. time","--");
        }

        this.setContent(this._root);
        this._applyTheme();
    },

    _buildHeader: function() {
        let col = new St.BoxLayout({ vertical: true });

        this._hostnameLabel = new St.Label({ text: this._hostname, style_class: "sysinfo-hostname" });
        col.add_actor(this._hostnameLabel);

        this._osLabel = new St.Label({ text: this._osName || " ", style_class: "sysinfo-os" });
        col.add_actor(this._osLabel);

        this._kernelLabel = new St.Label({ text: this._kernel ? "Kernel " + this._kernel : " ", style_class: "sysinfo-kernel" });
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
        this._root.add(bg,                          { x_fill: true });
        this._root.add(new St.Widget({ height: 4 }), { x_fill: true });
        this._w[key + "_bar"] = { bg, fill };
    },

    // ── theme ────────────────────────────────────────────────────────────

    _applyTheme: function() {
        let tc    = this.textColor    || "rgba(255,255,255,0.95)";
        let ac    = this.accentColor  || "rgba(52,152,219,1)";
        let fs    = this.fontSize     || 9;
        let scale = this.deskletScale || 1.0;

        // Background: combine bgColor + bgOpacity into a single rgba value
        let bgOpacity = this.bgOpacity !== undefined ? this.bgOpacity : 0.0;
        let bgBase    = this.bgColor || "rgb(0,0,0)";
        let bgRgba;
        if (bgBase.startsWith("rgba(")) {
            bgRgba = bgBase.replace(/,\s*[\d.]+\s*\)$/, ", " + bgOpacity + ")");
        } else if (bgBase.startsWith("rgb(")) {
            bgRgba = bgBase.replace("rgb(", "rgba(").replace(")", ", " + bgOpacity + ")");
        } else {
            bgRgba = "rgba(0,0,0," + bgOpacity + ")";
        }

        if (this._root)
            this._root.style = "background-color: " + bgRgba + "; border-radius: 10px;" +
                                " color: " + tc + "; font-size: " + fs + "pt;";

        this.actor.set_scale(scale, scale);

        // Header labels — scale relative to base font size
        if (this._hostnameLabel)
            this._hostnameLabel.style = "font-size: " + (fs + 4) + "pt; font-weight: bold; color: white;";
        if (this._osLabel)
            this._osLabel.style = "font-size: " + (fs - 1) + "pt; color: rgba(255,255,255,0.65); padding-top: 1px;";
        if (this._kernelLabel)
            this._kernelLabel.style = "font-size: " + (fs - 1) + "pt; color: rgba(255,255,255,0.5); padding-top: 1px;";

        // Section titles
        let sectionStyle = "font-weight: bold; font-size: " + (fs + 1) + "pt;" +
                           " color: rgba(255,255,255,0.85); letter-spacing: 1px;" +
                           " padding-bottom: 3px; border-bottom: 1px solid rgba(255,255,255,0.2);";
        for (let lbl of (this._sectionLabels || [])) {
            lbl.style = sectionStyle;
        }

        for (let k in this._w) {
            if (!k.endsWith("_bar")) continue;
            let b = this._w[k];
            if (b && b.fill)
                b.fill.style = "background-color: " + ac + "; height: 5px; border-radius: 3px;";
        }
    },

    // ── helpers ──────────────────────────────────────────────────────────

    _set: function(key, text) {
        if (this._w && this._w[key]) this._w[key].set_text(String(text));
    },

    _setBar: function(key, pct) {
        let b = this._w && this._w[key + "_bar"];
        if (!b || !b.fill || !b.bg) return;
        pct = clamp(isNaN(pct) ? 0 : pct, 0, 100);
        let w = b.bg.get_width();
        if (w <= 0) w = 294;   // matches 330px container minus 36px padding
        b.fill.set_width(Math.round((pct / 100) * w));
        let color;
        if (pct >= 90)      color = "#e74c3c";
        else if (pct >= 75) color = "#f39c12";
        else                color = this.accentColor || "rgba(52,152,219,1)";
        b.fill.style = "background-color: " + color + "; height: 5px; border-radius: 3px;";
    },

    // ── update cycle ─────────────────────────────────────────────────────

    _update: function() {
        if (this._dead) return;
        let gen = this._gen;

        this._pollUptime(gen);
        this._pollCpu(gen);
        this._pollMem(gen);
        this._pollDisks(gen);
        if (this.showNetwork !== false) this._pollNetwork(gen);
        if (this.showBattery !== false) this._pollBattery(gen);
        if (this.showGpu     !== false) this._pollGpu(gen);

        if (this._timeout) Mainloop.source_remove(this._timeout);
        if (!this._dead) {
            let iv = clamp(this.refreshInterval || 2, 1, 60);
            this._timeout = Mainloop.timeout_add_seconds(iv, () => { this._update(); return false; });
        }
    },

    // ── UPTIME / LOAD ────────────────────────────────────────────────────

    _pollUptime: function(gen) {
        Gio.File.new_for_path("/proc/uptime").load_contents_async(null, (f, res) => {
            if (this._dead || this._gen !== gen) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let secs = parseFloat(c.toString().split(" ")[0]);
                let d = Math.floor(secs / 86400);
                let h = Math.floor((secs % 86400) / 3600);
                let m = Math.floor((secs % 3600) / 60);
                let s = Math.floor(secs % 60);
                this._set("uptime", (d ? d + "d " : "") + h + "h " + m + "m " + s + "s");
            } catch(e) {}
        });

        Gio.File.new_for_path("/proc/loadavg").load_contents_async(null, (f, res) => {
            if (this._dead || this._gen !== gen) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let parts = c.toString().trim().split(" ");
                this._set("load", parts[0] + "  " + parts[1] + "  " + parts[2]);
                let pp = (parts[3] || "0/0").split("/");
                this._set("procs", pp[1] + " total, " + pp[0] + " running");
            } catch(e) {}
        });
    },

    // ── CPU ──────────────────────────────────────────────────────────────

    _pollCpu: function(gen) {
        Gio.File.new_for_path("/proc/stat").load_contents_async(null, (f, res) => {
            if (this._dead || this._gen !== gen) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let nums  = c.toString().split("\n")[0].split(/\s+/).slice(1).map(Number);
                let total = nums.reduce((a, b) => a + b, 0);
                let idle  = nums[3];
                if (this._cpuPrevTotal) {
                    let dT = total - this._cpuPrevTotal;
                    let dI = idle  - this._cpuPrevIdle;
                    if (dT > 0) {
                        let pct = 100 * (dT - dI) / dT;
                        this._set("cpu_pct", pct.toFixed(1) + "%");
                        this._setBar("cpu", pct);
                    }
                }
                this._cpuPrevTotal = total;
                this._cpuPrevIdle  = idle;
            } catch(e) {}
        });

        // Average CPU frequency across all cores
        try {
            let proc = Gio.Subprocess.new(
                ["bash", "-c",
                 "awk '{s+=$1;c++} END{if(c)printf \"%.2f\",s/c/1e6}'" +
                 " /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead || this._gen !== gen) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (ok && out && out.trim()) this._set("cpu_freq", out.trim() + " GHz");
                } catch(e) {}
            });
        } catch(e) {}

        // CPU package temperature — prefer x86_pkg_temp zone, fall back to highest zone
        try {
            let proc = Gio.Subprocess.new(
                ["bash", "-c",
                 "temp=$(paste /sys/class/thermal/thermal_zone*/type" +
                 " /sys/class/thermal/thermal_zone*/temp 2>/dev/null" +
                 " | awk '/x86_pkg_temp/{print $2; exit}');" +
                 " [ -z \"$temp\" ] &&" +
                 " temp=$(sort -n /sys/class/thermal/thermal_zone*/temp 2>/dev/null | tail -1);" +
                 " echo \"$temp\""],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead || this._gen !== gen) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (ok && out && out.trim())
                        this._set("cpu_temp", (parseInt(out.trim()) / 1000).toFixed(0) + "°C");
                } catch(e) {}
            });
        } catch(e) {}
    },

    // ── MEMORY ───────────────────────────────────────────────────────────

    _pollMem: function(gen) {
        Gio.File.new_for_path("/proc/meminfo").load_contents_async(null, (f, res) => {
            if (this._dead || this._gen !== gen) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let kv = {};
                c.toString().split("\n").forEach(line => {
                    let p = line.split(":");
                    if (p.length >= 2) kv[p[0].trim()] = parseInt(p[1].replace(/\D/g, ""));
                });
                let total     = kv["MemTotal"]     || 0;
                let avail     = kv["MemAvailable"] || 0;
                let used      = total - avail;
                let buf       = (kv["Buffers"] || 0) + (kv["Cached"] || 0);
                let swapTotal = kv["SwapTotal"] || 0;
                let swapFree  = kv["SwapFree"]  || 0;
                let swapUsed  = swapTotal - swapFree;

                this._set("ram",   fmtGB(used)     + " / " + fmtGB(total));
                this._setBar("ram", total ? (used / total) * 100 : 0);
                this._set("swap",  fmtGB(swapUsed) + " / " + fmtGB(swapTotal));
                this._setBar("swap", swapTotal ? (swapUsed / swapTotal) * 100 : 0);
                this._set("cache", fmtGB(buf));
            } catch(e) {}
        });
    },

    // ── DISKS ────────────────────────────────────────────────────────────

    _pollDisks: function(gen) {
        for (let p of (this._diskPaths || [])) {
            try {
                let proc = Gio.Subprocess.new(
                    ["df", "-BGB", "--output=used,size,pcent", p],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                proc.communicate_utf8_async(null, null, (pr, res) => {
                    if (this._dead || this._gen !== gen) return;
                    try {
                        let [ok, out] = pr.communicate_utf8_finish(res);
                        if (!ok || !out) return;
                        let lines = out.trim().split("\n");
                        if (lines.length < 2) return;
                        let cols = lines[1].trim().split(/\s+/);
                        this._set("disk_" + p, cols[0] + " / " + cols[1]);
                        this._setBar("disk_" + p, parseInt(cols[2]));
                    } catch(e) {}
                });
            } catch(e) {}
        }
    },

    // ── NETWORK ──────────────────────────────────────────────────────────

    _pollNetwork: function(gen) {
        Gio.File.new_for_path("/proc/net/dev").load_contents_async(null, (f, res) => {
            if (this._dead || this._gen !== gen) return;
            try {
                let [ok, c] = f.load_contents_finish(res);
                if (!ok) return;
                let now    = GLib.get_monotonic_time() / 1e6;
                let totalRx = 0, totalTx = 0;
                c.toString().split("\n").slice(2).forEach(line => {
                    let parts = line.trim().split(/\s+/);
                    if (parts.length < 10) return;
                    let iface = parts[0].replace(":", "");
                    if (iface === "lo") return;
                    totalRx += parseInt(parts[1]) || 0;
                    totalTx += parseInt(parts[9]) || 0;
                });
                let elapsed = now - this._netPrevTime;
                if (this._netPrevTime > 0 && elapsed > 0) {
                    let dn = (totalRx - this._netPrevRx) / elapsed;
                    let up = (totalTx - this._netPrevTx) / elapsed;
                    this._set("net_down", "↓ " + fmtBytes(Math.max(0, dn)) + "/s");
                    this._set("net_up",   "↑ " + fmtBytes(Math.max(0, up)) + "/s");
                }
                this._set("net_rx", fmtBytes(totalRx));
                this._set("net_tx", fmtBytes(totalTx));
                this._netPrevTime = now;
                this._netPrevRx   = totalRx;
                this._netPrevTx   = totalTx;
            } catch(e) {}
        });
    },

    // ── BATTERY ──────────────────────────────────────────────────────────

    _pollBattery: function(gen) {
        try {
            let capProc = Gio.Subprocess.new(
                ["bash", "-c", "cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            capProc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead || this._gen !== gen) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (ok && out && out.trim()) {
                        let pct = parseInt(out.trim());
                        this._set("bat_pct", pct + "%");
                        this._setBar("bat", pct);
                    } else {
                        this._set("bat_pct",  "N/A");
                        this._set("bat_stat", "No battery");
                    }
                } catch(e) {}
            });

            let statProc = Gio.Subprocess.new(
                ["bash", "-c",
                 "f=$(ls /sys/class/power_supply/BAT*/status 2>/dev/null | head -1);" +
                 "[ -f \"$f\" ] && cat \"$f\""],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            statProc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead || this._gen !== gen) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (ok && out && out.trim()) this._set("bat_stat", out.trim());
                } catch(e) {}
            });

            let timeProc = Gio.Subprocess.new(
                ["bash", "-c", [
                    "bat=$(ls -d /sys/class/power_supply/BAT* 2>/dev/null | head -1)",
                    "[ -z \"$bat\" ] && exit 0",
                    "status=$(cat \"$bat/status\" 2>/dev/null)",
                    "[ \"$status\" != \"Discharging\" ] && [ \"$status\" != \"Charging\" ] && exit 0",
                    // Prefer charge_now/charge_full/current_now (µAh / µA) together
                    "if [ -f \"$bat/charge_now\" ] && [ -f \"$bat/current_now\" ]; then",
                    "  now=$(cat \"$bat/charge_now\")",
                    "  full=$(cat \"$bat/charge_full\")",
                    "  cur=$(cat \"$bat/current_now\")",
                    // Else fall back to energy_now/energy_full/power_now (µWh / µW) together
                    "elif [ -f \"$bat/energy_now\" ] && [ -f \"$bat/power_now\" ]; then",
                    "  now=$(cat \"$bat/energy_now\")",
                    "  full=$(cat \"$bat/energy_full\" 2>/dev/null || echo 0)",
                    "  cur=$(cat \"$bat/power_now\")",
                    "else",
                    "  exit 0",
                    "fi",
                    "[ \"$cur\" -le 0 ] 2>/dev/null && exit 0",
                    "if [ \"$status\" = \"Discharging\" ]; then",
                    "  awk \"BEGIN{printf \\\"%d\\\", $now / $cur * 60}\"",
                    "else",
                    "  awk \"BEGIN{printf \\\"%d\\\", ($full - $now) / $cur * 60}\"",
                    "fi"
                ].join("\n")],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            timeProc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead || this._gen !== gen) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (ok && out && out.trim()) {
                        let mins = parseInt(out.trim());
                        if (!isNaN(mins) && mins > 0) {
                            let h = Math.floor(mins / 60), m = mins % 60;
                            this._set("bat_time", h + "h " + m + "m");
                        } else {
                            this._set("bat_time", "--");
                        }
                    }
                } catch(e) {}
            });
        } catch(e) {}
    },

    // ── GPU (NVIDIA) ─────────────────────────────────────────────────────

    _pollGpu: function(gen) {
        try {
            let proc = Gio.Subprocess.new(
                ["nvidia-smi",
                 "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                 "--format=csv,noheader,nounits"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                if (this._dead || this._gen !== gen) return;
                try {
                    let [ok, out] = p.communicate_utf8_finish(res);
                    if (!ok || !out || !out.trim()) { this._set("gpu_name", "N/A"); return; }
                    let parts = out.trim().split(",").map(s => s.trim());
                    if (parts.length < 5) return;
                    let name      = parts[0].replace(/NVIDIA GeForce /i, "").replace(/NVIDIA /i, "");
                    let usage     = parseInt(parts[1]);
                    let vramUsed  = parseFloat(parts[2]);
                    let vramTotal = parseFloat(parts[3]);
                    let temp      = parseInt(parts[4]);
                    this._set("gpu_name",  name);
                    this._set("gpu_pct",   usage + "%");
                    this._setBar("gpu", usage);
                    this._set("gpu_vram",  (vramUsed / 1024).toFixed(2) + " / " + (vramTotal / 1024).toFixed(2) + " GB");
                    this._set("gpu_temp",  temp + "°C");
                } catch(e) { this._set("gpu_name", "N/A"); }
            });
        } catch(e) {
            this._set("gpu_name", "nvidia-smi not found");
        }
    },

    // ── cleanup ──────────────────────────────────────────────────────────

    on_desklet_removed: function() {
        this._dead = true;
        if (this._timeout) Mainloop.source_remove(this._timeout);
        if (this.settings) this.settings.finalize();
    }
};

function main(metadata, desklet_id) { return new MyDesklet(metadata, desklet_id); }
