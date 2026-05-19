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

    findRecentProjects: function() {
        let results = [];
        let home = GLib.get_home_dir();

        // Editor sources: [settingFlag, configDir]
        let sources = [];
        if (this.sourceVscode !== false)
            sources.push(home + "/.config/Code/User/workspaceStorage");
        if (this.sourceVscodium !== false)
            sources.push(home + "/.config/VSCodium/User/workspaceStorage");
        if (this.sourceCursor !== false)
            sources.push(home + "/.config/Cursor/User/workspaceStorage");

        for (let s = 0; s < sources.length; s++) {
            this.scanWorkspaceStorage(sources[s], results);
        }

        let pinnedPaths = this.pinnedPaths;
        results.sort(function(a, b) {
            let aPinned = pinnedPaths.indexOf(a.path) !== -1;
            let bPinned = pinnedPaths.indexOf(b.path) !== -1;
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return b.mtime - a.mtime;
        });

        let paths = [];
        for (let i = 0; i < results.length; i++) {
            paths.push(results[i].path);
        }
        return paths;
    },

    scanWorkspaceStorage: function(wsDir, results) {
        if (!GLib.file_test(wsDir, GLib.FileTest.IS_DIR)) return;

        try {
            let dir = Gio.File.new_for_path(wsDir);
            let enumerator = dir.enumerate_children(
                "standard::name,standard::type",
                Gio.FileQueryInfoFlags.NONE, null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY) continue;

                let wsJsonPath = wsDir + "/" + info.get_name() + "/workspace.json";
                if (!GLib.file_test(wsJsonPath, GLib.FileTest.EXISTS)) continue;

                try {
                    let [ok, contents] = GLib.file_get_contents(wsJsonPath);
                    if (!ok) continue;

                    let data = JSON.parse(ByteArray.toString(contents));
                    let folderUri = data.folder || "";
                    if (!folderUri) continue;

                    let path = folderUri.replace("file://", "");
                    try { path = decodeURIComponent(path); } catch(e) {}

                    if (!GLib.file_test(path, GLib.FileTest.IS_DIR)) continue;

                    if (this.gitOnly && !GLib.file_test(path + "/.git", GLib.FileTest.IS_DIR)) continue;

                    let wsFile = Gio.File.new_for_path(wsJsonPath);
                    let wsInfo = wsFile.query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null);
                    let mtime = wsInfo.get_modification_time().tv_sec;

                    // Deduplicate across editors — keep most recent
                    let isDupe = false;
                    for (let r = 0; r < results.length; r++) {
                        if (results[r].path === path) {
                            if (mtime > results[r].mtime) results[r].mtime = mtime;
                            isDupe = true;
                            break;
                        }
                    }
                    if (!isDupe) {
                        results.push({ path: path, mtime: mtime });
                    }
                } catch(e) {}
            }
        } catch(e) {}
    },

    getLastEditedTime: function(projectPath) {
        // Use bash -c to handle piped commands
        try {
            let [ok, stdout] = GLib.spawn_command_line_sync(
                "bash -c " + GLib.shell_quote(
                    "find " + GLib.shell_quote(projectPath) +
                    " -maxdepth 3 -not -path '*/\\.*' -not -path '*/node_modules/*'" +
                    " -not -path '*/__pycache__/*' -type f -printf '%T@\\n' 2>/dev/null" +
                    " | sort -rn | head -1"
                )
            );
            if (ok && stdout) {
                let ts = parseFloat(ByteArray.toString(stdout).trim());
                if (ts > 0) return Math.floor(ts);
            }
        } catch(e) {}
        return 0;
    },

    getProjectInfo: function(projectPath) {
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
            repoSize: "—"
        };

        let editTs = this.getLastEditedTime(projectPath);
        if (editTs > 0) {
            info.lastEditedTimestamp = editTs;
            info.lastEditedTime = this.timeAgo(editTs);
        }

        if (!GLib.file_test(projectPath + "/.git", GLib.FileTest.IS_DIR))
            return info;

        info.hasGit = true;

        try {
            let [ok1, stdout1] = GLib.spawn_command_line_sync(
                "git -C " + GLib.shell_quote(projectPath) + " log -1 --format=%s"
            );
            if (ok1 && stdout1) {
                let msg = ByteArray.toString(stdout1).trim();
                if (msg.length > 50) msg = msg.substring(0, 47) + "...";
                if (msg) info.lastCommitMsg = msg;
            }
        } catch(e) {}

        try {
            let [ok2, stdout2] = GLib.spawn_command_line_sync(
                "git -C " + GLib.shell_quote(projectPath) + " log -1 --format=%ct"
            );
            if (ok2 && stdout2) {
                let ts = parseInt(ByteArray.toString(stdout2).trim());
                if (ts > 0) {
                    info.lastCommitTimestamp = ts;
                    info.lastCommitTime = this.timeAgo(ts);
                }
            }
        } catch(e) {}

        try {
            let [ok3, stdout3] = GLib.spawn_command_line_sync(
                "git -C " + GLib.shell_quote(projectPath) + " rev-list --count HEAD"
            );
            if (ok3 && stdout3) {
                let count = parseInt(ByteArray.toString(stdout3).trim());
                if (!isNaN(count)) info.totalCommits = count;
            }
        } catch(e) {}

        try {
            let [ok4, stdout4] = GLib.spawn_command_line_sync(
                "du -sh " + GLib.shell_quote(projectPath + "/.git")
            );
            if (ok4 && stdout4) {
                let size = ByteArray.toString(stdout4).trim().split("\t")[0];
                if (size) info.repoSize = size;
            }
        } catch(e) {}

        return info;
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
        this.mainBox.destroy_all_children();

        let bg = this.bgColor || "rgba(28,28,32,0.92)";
        let rowBg = this.rowColor || "rgba(42,42,48,0.8)";
        let fc = this.fontColor || "rgba(230,230,235,0.95)";
        let ac = this.accentColor || "rgba(160,180,210,0.85)";

        // Container with dynamic bg color
        let container = new St.BoxLayout({
            vertical: true,
            style: "background-color: " + bg + ";"
                + " border: 1px solid rgba(160,160,170,0.15);"
                + " border-radius: 14px;"
                + " padding: 16px;"
                + " min-width: 400px;"
        });

        // Header
        let headerBox = new St.BoxLayout({ vertical: false });
        let headerIcon = new St.Label({
            text: "⬡ ",
            style: "font-size: " + this.fs(16) + "px; font-weight: 700; color: " + ac + ";"
                + " padding-bottom: 8px;"
        });
        let headerLabel = new St.Label({
            text: "PROJECT TRACKER",
            style: "font-size: " + this.fs(16) + "px; font-weight: 700; color: " + fc + ";"
                + " padding-bottom: 8px;"
        });
        headerBox.add(headerIcon);
        headerBox.add(headerLabel);
        container.add(headerBox);

        let sep = new St.Widget({
            style: "background-color: rgba(160,160,170,0.12); height: 1px; margin: 6px 0;"
        });
        sep.set_height(1);
        container.add(sep);

        let projectPaths = this.findRecentProjects();
        let max = this.maxProjects || 10;
        if (projectPaths.length > max) projectPaths = projectPaths.slice(0, max);

        let projects = [];
        for (let i = 0; i < projectPaths.length; i++) {
            projects.push(this.getProjectInfo(projectPaths[i]));
        }

        if (projects.length === 0) {
            let noProjects = new St.Label({
                text: "No projects found",
                style: "font-size: " + this.fs(14) + "px; color: " + ac + ";"
                    + " text-align: center; padding: 20px;"
            });
            container.add(noProjects);
        }

        // Scrollable container
        let rowHeight = Math.round(115 * (this.fontScale || 1.0));
        let visible = 4;
        let scrollHeight = rowHeight * visible;

        let scrollView = new St.ScrollView({
            vscrollbar_policy: projects.length > visible ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
            hscrollbar_policy: St.PolicyType.NEVER
        });
        scrollView.set_height(Math.min(scrollHeight, rowHeight * projects.length));

        let scrollBox = new St.BoxLayout({ vertical: true });
        scrollView.add_actor(scrollBox);

        for (let i = 0; i < projects.length; i++) {
            this.addProjectRow(projects[i], scrollBox, rowBg, fc, ac);
        }

        container.add(scrollView);
        this.mainBox.add(container);

        this.timeout = Mainloop.timeout_add_seconds(
            120,
            Lang.bind(this, this.refreshData)
        );
    },

    addProjectRow: function(project, scrollBox, rowBg, fc, ac) {
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

        let projectPath = project.path;
        let self = this;

        // Left-click opens in VS Code
        row.connect("button-press-event", function(actor, event) {
            GLib.spawn_command_line_async("code " + GLib.shell_quote(projectPath));
            return true;
        });

        // Top line: pin button + name + edited time
        let topLine = new St.BoxLayout({ vertical: false });

        // Pin button
        let pinBtn = new St.Button({
            label: project.pinned ? "📌" : "○",
            reactive: true,
            style: "font-size: " + self.fs(13) + "px; padding: 0 6px 0 0; color: " + ac + ";"
                + " background: transparent; border: none;"
        });
        pinBtn.connect("clicked", function() {
            self.togglePin(projectPath);
            return true;
        });
        topLine.add(pinBtn, { expand: false });

        let nameLabel = new St.Label({
            text: project.name,
            style: "font-size: " + this.fs(15) + "px; font-weight: 600; color: " + fc + ";"
                + " font-family: 'JetBrains Mono', 'Fira Code', monospace;"
        });
        topLine.add(nameLabel, { expand: false });
        topLine.add(new St.Widget(), { expand: true });

        let timeLabel = new St.Label({
            text: "edited " + project.lastEditedTime,
            style: "font-size: " + this.fs(12) + "px; color: " + ac + ";"
        });
        topLine.add(timeLabel, { expand: false });
        row.add(topLine);

        // Path
        let shortPath = project.path.replace(GLib.get_home_dir(), "~");
        let pathLabel = new St.Label({
            text: shortPath,
            style: "font-size: " + this.fs(12) + "px; color: " + fc + ";"
                + " opacity: 0.6; padding-top: 2px;"
        });
        row.add(pathLabel);

        if (project.hasGit) {
            if (project.lastCommitMsg) {
                let commitLabel = new St.Label({
                    text: "\"" + project.lastCommitMsg + "\"",
                    style: "font-size: " + this.fs(12) + "px; color: " + fc + ";"
                        + " opacity: 0.7; font-style: italic; padding-top: 3px; padding-bottom: 4px;"
                });
                row.add(commitLabel);
            }

            let statsLine = new St.BoxLayout({ vertical: false });
            let statStyle = "font-size: " + this.fs(12) + "px; color: " + ac + "; opacity: 0.75;";
            let valStyle = "font-size: " + this.fs(13) + "px; font-weight: 600;"
                + " font-family: 'JetBrains Mono', 'Fira Code', monospace;";

            statsLine.add(new St.Label({ text: "⊙ ", style: statStyle }));
            statsLine.add(new St.Label({
                text: project.totalCommits.toString(),
                style: valStyle + " color: rgba(190,170,240,0.95);"
            }));
            statsLine.add(new St.Label({ text: " commits", style: statStyle }));
            statsLine.add(new St.Label({ text: "   ◆ ", style: statStyle }));
            statsLine.add(new St.Label({
                text: project.repoSize,
                style: valStyle + " color: rgba(240,190,120,0.95);"
            }));
            statsLine.add(new St.Label({ text: " .git", style: statStyle }));
            statsLine.add(new St.Label({ text: "   ◆ ", style: statStyle }));
            statsLine.add(new St.Label({
                text: "commit " + project.lastCommitTime,
                style: valStyle + " color: rgba(140,210,170,0.95);"
            }));

            row.add(statsLine);
        } else {
            let noGitLabel = new St.Label({
                text: "No git repository",
                style: "font-size: " + this.fs(12) + "px; color: " + ac + "; opacity: 0.6;"
            });
            row.add(noGitLabel);
        }

        scrollBox.add(row);
    },

    onSettingChanged: function() {
        this.metadata["prevent-decorations"] = this.hideDecorations;
        this._updateDecoration();
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
        this.refreshData();
    },

    on_desklet_removed: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
    }
};
