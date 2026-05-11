const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Settings = imports.ui.settings;

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this._destroyed = false;
        this._generation = 0;
        this._shrunk = false;

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
            this.settings.bindProperty(Settings.BindingDirection.IN, "disk-paths", "disk_paths_raw", this.setupUI, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color", "bg_color", this.on_appearance_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "bg-transparency", "bg_transparency", this.on_appearance_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "bar-color", "bar_color", this.on_appearance_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-scale", "desklet_scale", this.on_appearance_changed, null);
        } catch (e) {
            global.logError("Settings bind failed: " + e);
        }

        // setupUI is called after bindings so settings values are available
        this.setupUI();
        this.update();
    },

    on_appearance_changed: function() {
        let opacity = this.bg_transparency !== undefined ? this.bg_transparency : 0.85;
        let scale = this.desklet_scale !== undefined ? this.desklet_scale : 1.0;
        let barColor = this.bar_color || "rgb(52, 152, 219)";
        let bgColor = this.bg_color || "rgb(25, 25, 25)";
        let rgbaColor = bgColor.replace("rgb", "rgba").replace(")", "," + opacity + ")");

        this.actor.set_scale(scale, scale);

        if (this.mainLayout) {
            let padding = this._shrunk ? "padding: 8px;" : "padding: 18px;";
            this.mainLayout.style = "background-image: none !important; " +
                                    "border: none !important; " +
                                    "box-shadow: none !important; " +
                                    "background-color: " + rgbaColor + "; " +
                                    "border-radius: 15px; " + padding;
        }

        let allStats = [this.cpu, this.ram, this.gpu];
        if (this.disks) this.disks.forEach(d => allStats.push(d.obj));

        for (let stat of allStats) {
            if (stat && stat.barFill) {
                stat.barFill.style = "background-color: " + barColor + ";";
            }
        }
    },

    _createStatBox: function(name) {
        let box = new St.BoxLayout({ vertical: true, style_class: "stat-box" });
        let label = new St.Label({ text: name + ": --%", style_class: "stat-label" });
        let barOutline = new St.Bin({ style_class: "bar-outline", x_align: St.Align.START });
        let barFill = new St.Bin({ style_class: "bar-fill", width: 0 });

        barOutline.set_child(barFill);
        box.add_actor(label);
        box.add_actor(barOutline);

        return { box, label, barFill, barOutline, name };
    },

    setupUI: function() {
        // Increment generation so any in-flight async callbacks from the
        // previous layout will bail out before touching destroyed objects
        this._generation++;

        if (this.mainLayout) {
            this.mainLayout.destroy_all_children();
        } else {
            this.mainLayout = new St.BoxLayout({ vertical: true, style_class: "monitor-container" });
        }

        // Title row
        this.titleRow = new St.BoxLayout({ vertical: false, style_class: "monitor-title-row" });
        let titleRow = this.titleRow;
        this.titleLabel = new St.Label({ text: "SYSTEM MONITOR", style_class: "monitor-title" });
        titleRow.add_actor(this.titleLabel);
        this.mainLayout.add_actor(titleRow);

        // Shrink button — created early so _applyShrinkState can reference it
        this.shrinkButton = new St.Label({ text: "−", style_class: "shrink-button", reactive: true, track_hover: true });
        this.shrinkButton.connect("button-press-event", () => { this._toggleShrink(); return true; });

        // Uptime directly below title
        this.uptimeLabel = new St.Label({ text: "Uptime: --", style_class: "stat-label" });
        this.uptimeLabel.style = "padding-bottom: 20px;";
        this.mainLayout.add_actor(this.uptimeLabel);

        this.cpu = this._createStatBox("CPU");
        this.ram = this._createStatBox("RAM");
        this.gpu = this._createStatBox("GPU");

        this.statsContainer = new St.BoxLayout({ vertical: true });
        this.statsContainer.add_actor(this.cpu.box);
        this.statsContainer.add_actor(this.ram.box);
        this.statsContainer.add_actor(this.gpu.box);

        this.disks = [];
        let pathsStr = this.disk_paths_raw || "/";
        let paths = pathsStr.split(",");

        for (let path of paths) {
            let p = path.trim();
            if (p === "") continue;
            let diskObj = this._createStatBox("Disk (" + p + ")");
            this.disks.push({ path: p, obj: diskObj });
            this.statsContainer.add_actor(diskObj.box);
        }

        this.mainLayout.add_actor(this.statsContainer);

        // Bottom row with shrink button pinned to the right
        let bottomRow = new St.BoxLayout({ vertical: false });
        let spacer = new St.Bin();
        bottomRow.add(spacer, { expand: true });
        bottomRow.add_actor(this.shrinkButton);
        this.mainLayout.add_actor(bottomRow);

        this.setContent(this.mainLayout);
        this.on_appearance_changed();
        this._applyShrinkState();
    },

    _toggleShrink: function() {
        this._shrunk = !this._shrunk;
        this._applyShrinkState();
    },

    _applyShrinkState: function() {
        if (!this.shrinkButton) return;
        let shrunk = this._shrunk;
        this.shrinkButton.set_text(shrunk ? "+" : "−");

        if (this.titleLabel) {
            if (shrunk) this.titleLabel.hide();
            else this.titleLabel.show();
        }

        if (this.titleRow) {
            this.titleRow.style = shrunk ? "border-bottom: none; margin-bottom: 0; padding-bottom: 0;" : "";
        }

        this.on_appearance_changed();

        if (this.uptimeLabel) {
            if (shrunk) this.uptimeLabel.hide();
            else this.uptimeLabel.show();
        }

        this._rearrangeStats();
    },

    _rearrangeStats: function() {
        if (!this.statsContainer || !this.cpu) return;
        let shrunk = this._shrunk;

        let coreStats = [this.cpu, this.ram, this.gpu].filter(s => s);
        let diskStats = (this.disks || []).map(d => d.obj);
        let allStats = coreStats.concat(diskStats);

        // Detach every stat box from its current parent (statsContainer or a row)
        for (let stat of allStats) {
            let parent = stat.box.get_parent();
            if (parent) parent.remove_actor(stat.box);
        }

        // Clear any leftover row containers from a previous shrunk layout
        let rows = this.statsContainer.get_children();
        for (let row of rows) this.statsContainer.remove_actor(row);

        if (shrunk) {
            for (let stat of allStats) {
                stat.barOutline.hide();
                stat.box.style = "margin-right: 10px; margin-bottom: 2px;";
            }

            let topRow = new St.BoxLayout({ vertical: false });
            for (let stat of coreStats) topRow.add_actor(stat.box);
            this.statsContainer.add_actor(topRow);

            if (diskStats.length > 0) {
                let diskRow = new St.BoxLayout({ vertical: false });
                for (let stat of diskStats) diskRow.add_actor(stat.box);
                this.statsContainer.add_actor(diskRow);
            }
        } else {
            for (let stat of allStats) {
                stat.barOutline.show();
                stat.box.style = "";
                this.statsContainer.add_actor(stat.box);
            }
        }
    },

    setPercent: function(statObj, percent) {
        if (!statObj || !statObj.label || !statObj.barFill || isNaN(percent)) return;
        percent = Math.max(0, Math.min(100, Math.round(percent)));

        statObj.label.set_text(statObj.name + ": " + percent + "%");

        let totalWidth = statObj.barFill.get_parent().get_width();
        if (totalWidth <= 0) totalWidth = 250;
        statObj.barFill.set_width((percent / 100) * totalWidth);

        if (percent >= 100) {
            statObj.barFill.style = "background-color: #e74c3c;";
        } else {
            let barColor = this.bar_color || "rgb(52, 152, 219)";
            statObj.barFill.style = "background-color: " + barColor + ";";
        }
    },

    update: function() {
        if (this._destroyed) return;

        // Capture generation at the start of this update cycle.
        // All async callbacks check this before touching any UI objects.
        let gen = this._generation;

        // UPTIME
        let procUptime = Gio.File.new_for_path("/proc/uptime");
        procUptime.load_contents_async(null, (file, res) => {
            try {
                if (this._destroyed || this._generation !== gen) return;
                let [success, contents] = file.load_contents_finish(res);
                if (success && contents) {
                    let totalSeconds = parseFloat(contents.toString().split(" ")[0]);
                    let d = Math.floor(totalSeconds / 86400);
                    let h = Math.floor((totalSeconds % 86400) / 3600);
                    let m = Math.floor((totalSeconds % 3600) / 60);
                    this.uptimeLabel.set_text("Uptime: " + (d > 0 ? d + "d " : "") + h + "h " + m + "m");
                }
            } catch (e) {}
        });

        // CPU
        let statFile = Gio.File.new_for_path("/proc/stat");
        statFile.load_contents_async(null, (file, res) => {
            try {
                if (this._destroyed || this._generation !== gen) return;
                let [success, contents] = file.load_contents_finish(res);
                if (success && contents) {
                    let parts = contents.toString().split("\n")[0].split(/\s+/).slice(1).map(Number);
                    let total = parts.reduce((a, b) => a + b, 0);
                    let idle = parts[3];
                    if (this.prevTotal !== undefined) {
                        let diffTotal = total - this.prevTotal;
                        let diffIdle = idle - this.prevIdle;
                        if (diffTotal > 0) this.setPercent(this.cpu, 100 * (diffTotal - diffIdle) / diffTotal);
                    }
                    this.prevTotal = total;
                    this.prevIdle = idle;
                }
            } catch (e) {}
        });

        // RAM
        let memFile = Gio.File.new_for_path("/proc/meminfo");
        memFile.load_contents_async(null, (file, res) => {
            try {
                if (this._destroyed || this._generation !== gen) return;
                let [success, contents] = file.load_contents_finish(res);
                if (success && contents) {
                    let lines = contents.toString().split("\n");
                    let memTotal = parseInt(lines[0].replace(/\D/g, ''));
                    let memAvailable = parseInt(lines[2].replace(/\D/g, ''));
                    if (memTotal > 0) this.setPercent(this.ram, ((memTotal - memAvailable) / memTotal) * 100);
                }
            } catch (e) {}
        });

        // GPU — hide the row and show N/A if nvidia-smi is not available
        try {
            let gpuSub = Gio.Subprocess.new(
                ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            gpuSub.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    if (this._destroyed || this._generation !== gen) return;
                    let [success, stdout] = proc.communicate_utf8_finish(res);
                    if (success && stdout && stdout.trim() !== "") {
                        this.setPercent(this.gpu, parseInt(stdout.trim()));
                        this.gpu.box.show();
                    } else {
                        this.gpu.label.set_text("GPU: N/A");
                        this.gpu.box.hide();
                    }
                } catch (e) {
                    if (this._generation === gen && this.gpu) {
                        this.gpu.label.set_text("GPU: N/A");
                        this.gpu.box.hide();
                    }
                }
            });
        } catch (e) {
            // nvidia-smi not installed — hide GPU row entirely
            if (this.gpu) {
                this.gpu.label.set_text("GPU: N/A");
                this.gpu.box.hide();
            }
        }

        // DISKS
        for (let disk of this.disks) {
            let dfSub = Gio.Subprocess.new(["df", "-Ph", disk.path], Gio.SubprocessFlags.STDOUT_PIPE);
            dfSub.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    if (this._destroyed || this._generation !== gen) return;
                    let [success, stdout] = proc.communicate_utf8_finish(res);
                    if (success && stdout) {
                        let match = stdout.toString().match(/(\d+)%/);
                        if (match) this.setPercent(disk.obj, parseInt(match[1]));
                    }
                } catch (e) {}
            });
        }

        // Re-schedule — only if not destroyed
        if (this.timeout) Mainloop.source_remove(this.timeout);
        if (!this._destroyed) {
            this.timeout = Mainloop.timeout_add_seconds(2, () => {
                this.update();
                return false;
            });
        }
    },

    on_desklet_removed: function() {
        this._destroyed = true;
        if (this.timeout) Mainloop.source_remove(this.timeout);
        if (this.settings) this.settings.finalize();
    }
};

function main(metadata, desklet_id) { return new MyDesklet(metadata, desklet_id); }
