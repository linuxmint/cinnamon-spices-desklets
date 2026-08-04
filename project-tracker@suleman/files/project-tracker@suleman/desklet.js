const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

const UUID = "project-tracker@suleman";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;
const PINNED_FILE = DESKLET_ROOT + "/pinned.json";

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "max-projects", "maxProjects", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "git-only", "gitOnly", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "source-vscode", "sourceVscode", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "source-vscodium", "sourceVscodium", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "source-cursor", "sourceCursor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-scale", "fontScale", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "bg-color", "bgColor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "row-color", "rowColor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-color", "fontColor", this.onSettingChanged);
        this.settings.bindProperty(Settings.BindingDirection.IN, "accent-color", "accentColor", this.onSettingChanged);

        this.pinnedPaths = this.loadPinned();

        this.setHeader("Project Tracker");
        this.metadata["prevent-decorations"] = this.hideDecorations;
        this._updateDecoration();

        this.setupUI();
    },

    setupUI: function() {
        this.mainBox = new St.BoxLayout({ vertical: true });
        this.setContent(this.mainBox);
        this.refreshData();
    },

    // Font size helper — base size scaled by user setting
    fs: function(base) {
        return Math.round(base * (this.fontScale || 1.0));
    },

    loadPinned: function() {
        try {
            if (GLib.file_test(PINNED_FILE, GLib.FileTest.EXISTS)) {
                let [ok, contents] = GLib.file_get_contents(PINNED_FILE);
                if (ok) return JSON.parse(ByteArray.toString(contents));
            }
        } catch(e) {}
        return [];
    },

    savePinned: function() {
        try {
            GLib.file_set_contents(PINNED_FILE, JSON.stringify(this.pinnedPaths));
        } catch(e) {}
    },

    isPinned: function(path) {
        return this.pinnedPaths.indexOf(path) !== -1;
    },

    togglePin: function(path) {
        let idx = this.pinnedPaths.indexOf(path);
        if (idx !== -1) {
            this.pinnedPaths.splice(idx, 1);
        } else {
            this.pinnedPaths.push(path);
        }
        this.savePinned();
        if (this.timeout) Mainloop.source_remove(this.timeout);
        this.refreshData();
    },

    // Async scan of all editor workspaceStorage dirs. Yields between every entry so
    // the compositor can paint frames during the scan.
    findRecentProjectsAsync: function(callback) {
        let self = this;
        let results = [];
        let home = GLib.get_home_dir();

        let sources = [];
        if (this.sourceVscode !== false)
            sources.push(home + "/.config/Code/User/workspaceStorage");
        if (this.sourceVscodium !== false)
            sources.push(home + "/.config/VSCodium/User/workspaceStorage");
        if (this.sourceCursor !== false)
            sources.push(home + "/.config/Cursor/User/workspaceStorage");

        let pendingSources = sources.length;
        if (pendingSources === 0) { callback([]); return; }

        let finish = function() {
            let pinnedPaths = self.pinnedPaths;
            results.sort(function(a, b) {
                let aPinned = pinnedPaths.indexOf(a.path) !== -1;
                let bPinned = pinnedPaths.indexOf(b.path) !== -1;
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                return b.mtime - a.mtime;
            });
            // Return objects so callers can use mtime for cache keys
            callback(results);
        };

        for (let s = 0; s < sources.length; s++) {
            self.scanWorkspaceStorageAsync(sources[s], results, function() {
                if (--pendingSources === 0) finish();
            });
        }
    },

    // Enumerate entries in wsDir, then process them one at a time on idle ticks so the
    // compositor can paint a frame between each workspace.json load+parse.
    scanWorkspaceStorageAsync: function(wsDir, results, done) {
        let self = this;
        if (!GLib.file_test(wsDir, GLib.FileTest.IS_DIR)) { done(); return; }

        let entries = [];
        try {
            let dir = Gio.File.new_for_path(wsDir);
            let enumerator = dir.enumerate_children(
                "standard::name,standard::type",
                Gio.FileQueryInfoFlags.NONE, null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY) continue;
                entries.push(wsDir + "/" + info.get_name() + "/workspace.json");
            }
        } catch(e) { done(); return; }

        let i = 0;
        let processNext = function() {
            if (i >= entries.length) { done(); return false; }
            let wsJsonPath = entries[i++];
            self.processWorkspaceJson(wsJsonPath, results, function() {
                Mainloop.idle_add(processNext);
            });
            return false;
        };
        Mainloop.idle_add(processNext);
    },

    // Async per-entry: load workspace.json, parse, append to results.
    processWorkspaceJson: function(wsJsonPath, results, done) {
        let self = this;
        let file = Gio.File.new_for_path(wsJsonPath);
        file.load_contents_async(null, function(src, res) {
            try {
                let [ok, contents] = src.load_contents_finish(res);
                if (!ok) { done(); return; }

                let data = JSON.parse(ByteArray.toString(contents));
                let folderUri = data.folder || "";
                if (!folderUri) { done(); return; }

                let path = folderUri.replace("file://", "");
                try { path = decodeURIComponent(path); } catch(e) {}

                if (!GLib.file_test(path, GLib.FileTest.IS_DIR)) { done(); return; }
                if (self.gitOnly && !GLib.file_test(path + "/.git", GLib.FileTest.IS_DIR)) { done(); return; }

                file.query_info_async("time::modified", Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT, null, function(f, r2) {
                        try {
                            let wsInfo = f.query_info_finish(r2);
                            let mtime = wsInfo.get_modification_time().tv_sec;

                            let isDupe = false;
                            for (let r = 0; r < results.length; r++) {
                                if (results[r].path === path) {
                                    if (mtime > results[r].mtime) results[r].mtime = mtime;
                                    isDupe = true;
                                    break;
                                }
                            }
                            if (!isDupe) results.push({ path: path, mtime: mtime });
                        } catch(e) {}
                        done();
                    });
            } catch(e) { done(); }
        });
    },

    // Async subprocess helper — does not block the compositor thread.
    // argv is an array of strings; callback receives stdout (string) or null on failure.
    runAsync: function(argv, callback) {
        try {
            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, function(p, res) {
                try {
                    let [ok, stdout] = p.communicate_utf8_finish(res);
                    callback(ok ? stdout : null);
                } catch(e) {
                    callback(null);
                }
            });
        } catch(e) {
            callback(null);
        }
    },

    getLastEditedTimeAsync: function(projectPath, callback) {
        this.runAsync(["bash", "-c",
            "find " + GLib.shell_quote(projectPath) +
            " -maxdepth 3 -not -path '*/\\.*' -not -path '*/node_modules/*'" +
            " -not -path '*/__pycache__/*' -type f -printf '%T@\\n' 2>/dev/null" +
            " | sort -rn | head -1"
        ], function(stdout) {
            if (!stdout) { callback(0); return; }
            let ts = parseFloat(stdout.trim());
            callback(ts > 0 ? Math.floor(ts) : 0);
        });
    },

    // Cache for getProjectInfoAsync results, keyed by project path. Skips the
    // 4 git/du subprocess calls when nothing has changed since last fetch.
    _infoCache: {},

    // Collects project info via parallel async subprocesses, then calls callback(info).
    // Cache key: project path + .git HEAD mtime (if git) or workspace.json mtime.
    // pathMtime is the workspace.json mtime collected during findRecentProjectsAsync.
    getProjectInfoAsync: function(projectPath, callback, pathMtime) {
        let self = this;

        // Cache check: compare against last-known mtime. If nothing changed, reuse.
        let cached = this._infoCache[projectPath];
        let gitHead = projectPath + "/.git/HEAD";
        let gitHeadMtime = 0;
        if (GLib.file_test(gitHead, GLib.FileTest.EXISTS)) {
            try {
                let f = Gio.File.new_for_path(gitHead);
                gitHeadMtime = f.query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null)
                    .get_modification_time().tv_sec;
            } catch(e) {}
        }
        let cacheKey = (pathMtime || 0) + ":" + gitHeadMtime;

        if (cached && cached._key === cacheKey) {
            // Pinned state can change without a refresh — update it from current state
            cached.pinned = this.isPinned(projectPath);
            callback(cached);
            return;
        }

        let info = {
            name: projectPath.split("/").pop(),
            path: projectPath,
            hasGit: false,
            pinned: this.isPinned(projectPath),
            lastCommitMsg: "",
            lastCommitTime: "—",
            lastCommitTimestamp: 0,
            lastEditedTime: "—",
            lastEditedTimestamp: 0,
            totalCommits: 0,
            repoSize: "—",
            _key: cacheKey
        };

        let hasGit = GLib.file_test(projectPath + "/.git", GLib.FileTest.IS_DIR);
        info.hasGit = hasGit;

        // Number of async tasks to wait for before invoking callback
        let pending = 1 + (hasGit ? 4 : 0);
        let done = function() {
            if (--pending === 0) {
                self._infoCache[projectPath] = info;
                callback(info);
            }
        };

        self.getLastEditedTimeAsync(projectPath, function(ts) {
            if (ts > 0) {
                info.lastEditedTimestamp = ts;
                info.lastEditedTime = self.timeAgo(ts);
            }
            done();
        });

        if (!hasGit) return;

        self.runAsync(["git", "-C", projectPath, "log", "-1", "--format=%s"], function(stdout) {
            if (stdout) {
                let msg = stdout.trim();
                if (msg.length > 50) msg = msg.substring(0, 47) + "...";
                if (msg) info.lastCommitMsg = msg;
            }
            done();
        });

        self.runAsync(["git", "-C", projectPath, "log", "-1", "--format=%ct"], function(stdout) {
            if (stdout) {
                let ts = parseInt(stdout.trim());
                if (ts > 0) {
                    info.lastCommitTimestamp = ts;
                    info.lastCommitTime = self.timeAgo(ts);
                }
            }
            done();
        });

        self.runAsync(["git", "-C", projectPath, "rev-list", "--count", "HEAD"], function(stdout) {
            if (stdout) {
                let count = parseInt(stdout.trim());
                if (!isNaN(count)) info.totalCommits = count;
            }
            done();
        });

        self.runAsync(["du", "-sh", projectPath + "/.git"], function(stdout) {
            if (stdout) {
                let size = stdout.trim().split("\t")[0];
                if (size) info.repoSize = size;
            }
            done();
        });
    },

    timeAgo: function(timestamp) {
        let now = Math.floor(Date.now() / 1000);
        let diff = now - timestamp;

        if (diff < 60) return "just now";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
        if (diff < 2592000) return Math.floor(diff / 604800) + "w ago";
        return Math.floor(diff / 2592000) + "mo ago";
    },

    refreshData: function() {
        let self = this;
        let max = this.maxProjects || 10;

        this.findRecentProjectsAsync(function(projectEntries) {
            if (projectEntries.length > max) projectEntries = projectEntries.slice(0, max);

            if (projectEntries.length === 0) {
                self.renderUI([]);
                self.timeout = Mainloop.timeout_add_seconds(600, Lang.bind(self, self.refreshData));
                return;
            }

            let collected = new Array(projectEntries.length);
            let pending = projectEntries.length;

            for (let i = 0; i < projectEntries.length; i++) {
                (function(idx, entry) {
                    self.getProjectInfoAsync(entry.path, function(info) {
                        collected[idx] = info;
                        if (--pending === 0) {
                            self.renderUI(collected);
                            self.timeout = Mainloop.timeout_add_seconds(600, Lang.bind(self, self.refreshData));
                        }
                    }, entry.mtime);
                })(i, projectEntries[i]);
            }
        });
    },

    // Build the static UI shell once. After this, refreshes only mutate label text
    // and add/remove row containers — no widget churn during steady state.
    ensureShell: function() {
        if (this.shellBuilt) return;
        this.shellBuilt = true;

        let bg = this.bgColor || "rgba(28,28,32,0.92)";
        let fc = this.fontColor || "rgba(230,230,235,0.95)";
        let ac = this.accentColor || "rgba(160,180,210,0.85)";

        this.mainBox.destroy_all_children();

        let container = new St.BoxLayout({
            vertical: true,
            style: "background-color: " + bg + ";"
                + " border: 1px solid rgba(160,160,170,0.15);"
                + " border-radius: 14px;"
                + " padding: 16px;"
                + " min-width: 400px;"
        });

        let headerBox = new St.BoxLayout({ vertical: false });
        headerBox.add(new St.Label({
            text: "⬡ ",
            style: "font-size: " + this.fs(16) + "px; font-weight: 700; color: " + ac + ";"
                + " padding-bottom: 8px;"
        }));
        headerBox.add(new St.Label({
            text: "PROJECT TRACKER",
            style: "font-size: " + this.fs(16) + "px; font-weight: 700; color: " + fc + ";"
                + " padding-bottom: 8px;"
        }));
        container.add(headerBox);

        let sep = new St.Widget({
            style: "background-color: rgba(160,160,170,0.12); height: 1px; margin: 6px 0;"
        });
        sep.set_height(1);
        container.add(sep);

        this.emptyLabel = new St.Label({
            text: "No projects found",
            style: "font-size: " + this.fs(14) + "px; color: " + ac + ";"
                + " text-align: center; padding: 20px;"
        });
        container.add(this.emptyLabel);
        this.emptyLabel.hide();

        this.scrollView = new St.ScrollView({
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER
        });
        this.scrollBox = new St.BoxLayout({ vertical: true });
        this.scrollView.add_actor(this.scrollBox);
        container.add(this.scrollView);

        this.mainBox.add(container);

        this.rowWidgets = [];   // refs for in-place text updates, keyed by index
    },

    renderUI: function(projects) {
        this.ensureShell();

        let fc = this.fontColor || "rgba(230,230,235,0.95)";
        let ac = this.accentColor || "rgba(160,180,210,0.85)";
        let rowBg = this.rowColor || "rgba(42,42,48,0.8)";

        let rowHeight = Math.round(115 * (this.fontScale || 1.0));
        let visible = 4;
        this.scrollView.set_height(Math.min(rowHeight * visible, Math.max(rowHeight, rowHeight * projects.length)));

        if (projects.length === 0) {
            this.emptyLabel.show();
        } else {
            this.emptyLabel.hide();
        }

        // Grow rows array if needed (only first time or when project count increases)
        while (this.rowWidgets.length < projects.length) {
            let refs = this.buildRow(rowBg, fc, ac);
            this.scrollBox.add(refs.row);
            this.rowWidgets.push(refs);
        }
        // Hide extra rows if project count shrunk
        for (let i = projects.length; i < this.rowWidgets.length; i++) {
            this.rowWidgets[i].row.hide();
        }
        // Update visible rows in place
        for (let i = 0; i < projects.length; i++) {
            this.rowWidgets[i].row.show();
            this.updateRow(this.rowWidgets[i], projects[i], fc, ac);
        }
    },

    // Create a row's widget skeleton once; returns refs for later text mutation.
    buildRow: function(rowBg, fc, ac) {
        let self = this;

        let row = new St.BoxLayout({
            vertical: true,
            reactive: true,
            track_hover: true,
            style: "background-color: " + rowBg + ";"
                + " border: 1px solid rgba(140,140,150,0.1);"
                + " border-radius: 10px;"
                + " padding: 12px 16px;"
                + " margin-bottom: 8px;"
        });

        let refs = { row: row, projectPath: null };

        // Click handler — closure reads refs.projectPath at click time
        row.connect("button-press-event", function() {
            if (refs.projectPath) {
                GLib.spawn_command_line_async("code " + GLib.shell_quote(refs.projectPath));
            }
            return true;
        });

        let topLine = new St.BoxLayout({ vertical: false });

        refs.pinBtn = new St.Button({
            label: "○",
            reactive: true,
            style: "font-size: " + self.fs(13) + "px; padding: 0 6px 0 0; color: " + ac + ";"
                + " background: transparent; border: none;"
        });
        refs.pinBtn.connect("clicked", function() {
            if (refs.projectPath) self.togglePin(refs.projectPath);
            return true;
        });
        topLine.add(refs.pinBtn, { expand: false });

        refs.nameLabel = new St.Label({
            text: "",
            style: "font-size: " + self.fs(15) + "px; font-weight: 600; color: " + fc + ";"
                + " font-family: 'JetBrains Mono', 'Fira Code', monospace;"
        });
        topLine.add(refs.nameLabel, { expand: false });
        topLine.add(new St.Widget(), { expand: true });

        refs.timeLabel = new St.Label({
            text: "",
            style: "font-size: " + self.fs(12) + "px; color: " + ac + ";"
        });
        topLine.add(refs.timeLabel, { expand: false });
        row.add(topLine);

        refs.pathLabel = new St.Label({
            text: "",
            style: "font-size: " + self.fs(12) + "px; color: " + fc + ";"
                + " opacity: 0.6; padding-top: 2px;"
        });
        row.add(refs.pathLabel);

        refs.commitLabel = new St.Label({
            text: "",
            style: "font-size: " + self.fs(12) + "px; color: " + fc + ";"
                + " opacity: 0.7; font-style: italic; padding-top: 3px; padding-bottom: 4px;"
        });
        row.add(refs.commitLabel);

        let statsLine = new St.BoxLayout({ vertical: false });
        refs.statsLine = statsLine;
        let statStyle = "font-size: " + self.fs(12) + "px; color: " + ac + "; opacity: 0.75;";
        let valStyle = "font-size: " + self.fs(13) + "px; font-weight: 600;"
            + " font-family: 'JetBrains Mono', 'Fira Code', monospace;";

        statsLine.add(new St.Label({ text: "⊙ ", style: statStyle }));
        refs.commitsValLabel = new St.Label({ text: "0", style: valStyle + " color: rgba(190,170,240,0.95);" });
        statsLine.add(refs.commitsValLabel);
        statsLine.add(new St.Label({ text: " commits", style: statStyle }));
        statsLine.add(new St.Label({ text: "   ◆ ", style: statStyle }));
        refs.sizeValLabel = new St.Label({ text: "—", style: valStyle + " color: rgba(240,190,120,0.95);" });
        statsLine.add(refs.sizeValLabel);
        statsLine.add(new St.Label({ text: " .git", style: statStyle }));
        statsLine.add(new St.Label({ text: "   ◆ ", style: statStyle }));
        refs.commitTimeLabel = new St.Label({ text: "", style: valStyle + " color: rgba(140,210,170,0.95);" });
        statsLine.add(refs.commitTimeLabel);
        row.add(statsLine);

        refs.noGitLabel = new St.Label({
            text: "No git repository",
            style: "font-size: " + self.fs(12) + "px; color: " + ac + "; opacity: 0.6;"
        });
        row.add(refs.noGitLabel);

        return refs;
    },

    // Mutate text/visibility only — no widget allocation, no CSS reparse.
    updateRow: function(refs, project, fc, ac) {
        refs.projectPath = project.path;
        refs.pinBtn.set_label(project.pinned ? "📌" : "○");
        refs.nameLabel.set_text(project.name);
        refs.timeLabel.set_text("edited " + project.lastEditedTime);
        refs.pathLabel.set_text(project.path.replace(GLib.get_home_dir(), "~"));

        if (project.hasGit) {
            refs.noGitLabel.hide();
            if (project.lastCommitMsg) {
                let msg = "\"" + project.lastCommitMsg + "\"";
                refs.commitLabel.set_text(msg);
                refs.commitLabel.show();
            } else {
                refs.commitLabel.hide();
            }
            refs.commitsValLabel.set_text(project.totalCommits.toString());
            refs.sizeValLabel.set_text(project.repoSize);
            refs.commitTimeLabel.set_text("commit " + project.lastCommitTime);
            refs.statsLine.show();
        } else {
            refs.commitLabel.hide();
            refs.statsLine.hide();
            refs.noGitLabel.show();
        }
    },

    onSettingChanged: function() {
        this.metadata["prevent-decorations"] = this.hideDecorations;
        this._updateDecoration();
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
        // Theme colors changed — force rebuild on next refresh
        this.shellBuilt = false;
        if (this.rowWidgets) this.rowWidgets = [];
        this.refreshData();
    },

    on_desklet_removed: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
    }
};
