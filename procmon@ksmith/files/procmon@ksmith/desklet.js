const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Gettext = imports.gettext;

const UUID = "procmon@ksmith";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
function _(str) {
    return Gettext.dgettext(UUID, str);
}

function main(metadata, deskletId) {
    return new ProcMonDesklet(metadata, deskletId);
}

class ProcMonDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);

        this.metadata = metadata;
        this.deskletId = deskletId;

        this.refreshInterval = 2;
        this.rowCount = 10;
        this.onlyMyProcesses = false;
        this.cpuScalingMode = "total_scaled";
        this.commandMaxLength = 64;
        this.disableDecorations = false;
        this.headerTextColor = "#f7f7f7";
        this.contentTextColor = "#d9d9d9";
        this.backgroundColor = "#1b1f24";
        this.backgroundTransparency = 20;
        this.pidColumnWidth = 60;
        this.userColumnWidth = 60;
        this.cpuColumnWidth = 60;
        this.memColumnWidth = 80;
        this.commandColumnWidth = 240;

        this._rows = [];
        this._errorMessage = null;
        this._sortKey = "cpu";
        this._sortAscending = false;
        this._refreshTimeoutId = 0;
        this._refreshInFlight = false;
        this._numCores = Math.max(1, GLib.get_num_processors());

        this._columnDefs = {
            pid: { title: _("PID"), width: 60, align: "left" },
            user: { title: _("USER"), width: 60, align: "left" },
            cpu: { title: _("CPU%"), width: 60, align: "left" },
            mem: { title: _("MEM"), width: 80, align: "left" },
            command: { title: _("COMMAND"), width: 240, align: "left", expand: false },
        };

        this.setHeader(_("Process Monitor"));

        this._setupSettings();
        this._buildUi();
        this._scheduleRefresh(true);
    }

    _setupSettings() {
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.deskletId);

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "refresh-interval",
            "refreshInterval",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "row-count",
            "rowCount",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "only-my-processes",
            "onlyMyProcesses",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "cpu-scaling-mode",
            "cpuScalingMode",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "command-max-length",
            "commandMaxLength",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "disable-decorations",
            "disableDecorations",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "header-text-color",
            "headerTextColor",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "content-text-color",
            "contentTextColor",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "background-color",
            "backgroundColor",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "background-transparency",
            "backgroundTransparency",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "pid-column-width",
            "pidColumnWidth",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "user-column-width",
            "userColumnWidth",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "cpu-column-width",
            "cpuColumnWidth",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "mem-column-width",
            "memColumnWidth",
            () => this._onSettingsChanged(),
            null
        );
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "command-column-width",
            "commandColumnWidth",
            () => this._onSettingsChanged(),
            null
        );
    }

    _buildUi() {
        this._root = new St.BoxLayout({
            style_class: "procmon-root",
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        this._headerRow = new St.BoxLayout({
            style_class: "procmon-header-row",
            vertical: false,
            x_expand: true,
        });

        this._headerButtons = {};
        this._headerLabels = {};

        this._headerRow.add_child(this._createHeaderButton("pid"));
        this._headerRow.add_child(this._createHeaderButton("user"));
        this._headerRow.add_child(this._createHeaderButton("cpu"));
        this._headerRow.add_child(this._createHeaderButton("mem"));
        this._headerRow.add_child(this._createHeaderButton("command"));

        this._body = new St.BoxLayout({
            style_class: "procmon-body",
            vertical: true,
            x_expand: true,
        });

        this._root.add_child(this._headerRow);
        this._root.add_child(this._body);
        this.setContent(this._root);

        this._applyLayout();
        this._render();
    }

    _createHeaderButton(key) {
        const def = this._columnDefs[key];
        const button = new St.Button({
            style_class: "procmon-header-button",
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: !!def.expand,
        });

        const text = new St.Label({
            style_class: "procmon-header-label",
            text: "",
            x_expand: !!def.expand,
            x_align: def.align === "right" ? St.Align.END : St.Align.START,
        });
        this._setLabelAlignment(text, def.align);

        if (def.width > 0) {
            text.set_style(`width: ${def.width}px; min-width: ${def.width}px; max-width: ${def.width}px;`);
        }

        button.set_child(text);
        button.connect("clicked", () => this._onHeaderClicked(key));

        this._headerButtons[key] = button;
        this._headerLabels[key] = text;

        return button;
    }

    _onHeaderClicked(key) {
        if (this._sortKey === key) {
            this._sortAscending = !this._sortAscending;
        } else {
            this._sortKey = key;
            this._sortAscending = this._defaultAscendingFor(key);
        }

        this._render();
    }

    _defaultAscendingFor(key) {
        return key === "pid" || key === "user" || key === "command";
    }

    _onSettingsChanged() {
        this.refreshInterval = Math.max(1, Number.parseInt(this.refreshInterval, 10) || 2);
        this.rowCount = Math.max(1, Number.parseInt(this.rowCount, 10) || 10);
        this.commandMaxLength = Math.max(8, Number.parseInt(this.commandMaxLength, 10) || 64);
        this.backgroundTransparency = Math.max(0, Math.min(100, Number.parseInt(this.backgroundTransparency, 10) || 20));
        this.pidColumnWidth = Math.max(40, Number.parseInt(this.pidColumnWidth, 10) || 60);
        this.userColumnWidth = Math.max(60, Number.parseInt(this.userColumnWidth, 10) || 60);
        this.cpuColumnWidth = Math.max(50, Number.parseInt(this.cpuColumnWidth, 10) || 60);
        this.memColumnWidth = Math.max(50, Number.parseInt(this.memColumnWidth, 10) || 80);
        this.commandColumnWidth = Math.max(80, Number.parseInt(this.commandColumnWidth, 10) || 240);

        this._columnDefs.pid.width = this.pidColumnWidth;
        this._columnDefs.user.width = this.userColumnWidth;
        this._columnDefs.cpu.width = this.cpuColumnWidth;
        this._columnDefs.mem.width = this.memColumnWidth;
        this._columnDefs.command.width = this.commandColumnWidth;

        this._applyDecorationSetting();
        this._applyLayout();
        this._scheduleRefresh(true);
    }

    _applyLayout() {
        if (!this._root) {
            return;
        }

        const bgStyle = this._buildBackgroundStyle();
        const rootStyle = [
            `width: ${this._getTotalTableWidth()}px`,
            bgStyle,
        ].join("; ") + ";";
        this._root.set_style(rootStyle);
        if (this.content) {
            this.content.set_style(`${bgStyle};`);
        }
        if (this.actor) {
            this.actor.set_style(`${bgStyle};`);
        }
        if (this._draggable && this._draggable.actor) {
            this._draggable.actor.set_style(`${bgStyle};`);
        }

        const keys = Object.keys(this._columnDefs);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const def = this._columnDefs[key];
            const button = this._headerButtons[key];
            if (!button) {
                continue;
            }

            if (def.width > 0) {
                button.set_style(`width: ${def.width}px; min-width: ${def.width}px; max-width: ${def.width}px; padding: 0; margin: 0;`);
            } else {
                button.set_style("min-width: 80px; padding: 0; margin: 0;");
            }
        }

        this._applyHeaderTextColor();
    }

    _applyDecorationSetting() {
        this.metadata["prevent-decorations"] = !!this.disableDecorations;
        this._updateDecoration();
    }

    _getTotalTableWidth() {
        return this._columnDefs.pid.width +
            this._columnDefs.user.width +
            this._columnDefs.cpu.width +
            this._columnDefs.mem.width +
            this._columnDefs.command.width;
    }

    _scheduleRefresh(immediate) {
        if (this._refreshTimeoutId) {
            Mainloop.source_remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }

        if (immediate) {
            this._refreshNow();
        }

        this._refreshTimeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            this._refreshNow();
            return true;
        });
    }

    _refreshNow() {
        if (this._refreshInFlight) {
            return;
        }

        this._refreshInFlight = true;

        const args = ["top", "-b", "-n", "1", "-d", "0.1", "-o", "%CPU", "-w", "512"];
        if (this.onlyMyProcesses) {
            args.push("-u", GLib.get_user_name());
        }

        let subprocess;
        try {
            subprocess = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            this._setError(`Failed to launch top: ${e.message}`);
            this._refreshInFlight = false;
            return;
        }

        subprocess.communicate_utf8_async(null, null, (proc, result) => {
            let stdout = "";
            let stderr = "";
            let exitStatus = -1;

            try {
                const output = proc.communicate_utf8_finish(result);
                stdout = output[1] || "";
                stderr = output[2] || "";
                exitStatus = proc.get_exit_status();

                if (!proc.get_successful()) {
                    this._setError(this._buildCommandError(exitStatus, stderr));
                    return;
                }

                if (!stdout || !stdout.trim()) {
                    this._setError(this._buildCommandError(exitStatus, stderr, "top returned empty output"));
                    return;
                }

                const parsedRows = this._parseTopOutput(stdout);
                if (parsedRows.length === 0) {
                    this._setError(this._buildCommandError(exitStatus, stderr, "No process rows parsed from top output"));
                    return;
                }

                this._rows = parsedRows;
                this._errorMessage = null;
                this._render();
            } catch (e) {
                this._setError(`Error reading top output: ${e.message}`);
            } finally {
                this._refreshInFlight = false;
            }
        });
    }

    _buildCommandError(exitStatus, stderr, prefix = "top command failed") {
        const errorText = stderr && stderr.trim() ? stderr.trim() : "(stderr empty)";
        return `${prefix} (exit ${exitStatus}): ${errorText}`;
    }

    _setError(message) {
        this._errorMessage = message;
        this._rows = [];
        this._render();
    }

    _parseTopOutput(text) {
        const lines = text.split(/\r?\n/);
        let indexMap = null;
        const rows = [];

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            if (!raw) {
                continue;
            }

            const line = raw.trim();
            if (!line) {
                continue;
            }

            if (!indexMap && this._looksLikeHeader(line)) {
                indexMap = this._buildIndexMap(line);
                continue;
            }

            if (!/^\d+\s+/.test(line)) {
                continue;
            }

            const row = this._parseProcessLine(line, indexMap);
            if (row) {
                rows.push(row);
            }
        }

        return rows;
    }

    _looksLikeHeader(line) {
        const upper = line.toUpperCase();
        return (
            upper.indexOf("PID") >= 0 &&
            upper.indexOf("USER") >= 0 &&
            upper.indexOf("%CPU") >= 0 &&
            upper.indexOf("RES") >= 0 &&
            (upper.indexOf("COMMAND") >= 0 || upper.indexOf("CMD") >= 0)
        );
    }

    _buildIndexMap(headerLine) {
        const cols = headerLine.trim().split(/\s+/);
        const u = cols.map((c) => c.toUpperCase());

        const pid = u.indexOf("PID");
        const user = u.indexOf("USER");
        const cpu = u.indexOf("%CPU");
        const res = u.indexOf("RES");

        let command = u.indexOf("COMMAND");
        if (command < 0) {
            command = u.indexOf("CMD");
        }

        if (pid < 0 || user < 0 || cpu < 0 || res < 0 || command < 0) {
            return null;
        }

        return { pid, user, cpu, res, command };
    }

    _parseProcessLine(line, indexMap) {
        const parts = line.split(/\s+/);

        let pidIndex = 0;
        let userIndex = 1;
        let resIndex = 5;
        let cpuIndex = 8;
        let commandIndex = 11;

        if (indexMap) {
            pidIndex = indexMap.pid;
            userIndex = indexMap.user;
            resIndex = indexMap.res;
            cpuIndex = indexMap.cpu;
            commandIndex = indexMap.command;
        }

        const requiredIndex = Math.max(pidIndex, userIndex, resIndex, cpuIndex);
        if (parts.length <= requiredIndex) {
            return null;
        }

        const pid = Number.parseInt(parts[pidIndex], 10);
        if (!Number.isFinite(pid)) {
            return null;
        }

        const user = parts[userIndex] || "?";

        const cpuRaw = Number.parseFloat((parts[cpuIndex] || "0").replace(",", "."));
        let cpu = Number.isFinite(cpuRaw) ? cpuRaw : 0;
        if (this.cpuScalingMode === "total_scaled") {
            cpu = cpu / this._numCores;
        }

        const memKb = this._parseResToKb(parts[resIndex] || "0");
        const commandText = parts.length > commandIndex ? (parts.slice(commandIndex).join(" ") || "-") : "-";

        return {
            pid,
            user,
            cpu,
            memKb,
            memStr: this._formatMem(memKb),
            command: commandText,
        };
    }

    _parseResToKb(token) {
        const t = (token || "").trim().toLowerCase();
        if (!t) {
            return 0;
        }

        const m = t.match(/^([0-9]*[.,]?[0-9]+)([a-z]?)$/);
        if (!m) {
            const fallback = Number.parseFloat(t.replace(",", "."));
            if (!Number.isFinite(fallback)) {
                return 0;
            }
            return Math.max(0, Math.round(fallback));
        }

        const value = Number.parseFloat(m[1].replace(",", "."));
        if (!Number.isFinite(value)) {
            return 0;
        }

        const unit = m[2] || "";
        let kb = value;

        switch (unit) {
            case "b":
                kb = value / 1024;
                break;
            case "k":
                kb = value;
                break;
            case "m":
                kb = value * 1024;
                break;
            case "g":
                kb = value * 1024 * 1024;
                break;
            case "t":
                kb = value * 1024 * 1024 * 1024;
                break;
            case "p":
                kb = value * 1024 * 1024 * 1024 * 1024;
                break;
            case "e":
                kb = value * 1024 * 1024 * 1024 * 1024 * 1024;
                break;
            default:
                kb = value;
                break;
        }

        return Math.max(0, Math.round(kb));
    }

    _formatMem(memKb) {
        if (memKb >= 1024 * 1024) {
            return `${(memKb / (1024 * 1024)).toFixed(1)}G`;
        }
        if (memKb >= 1024) {
            return `${(memKb / 1024).toFixed(1)}M`;
        }
        return `${memKb}K`;
    }

    _sortRows(rows) {
        const decorated = rows.map((row, index) => ({ row, index }));

        decorated.sort((a, b) => {
            const cmp = this._compareRows(a.row, b.row, this._sortKey);
            if (cmp !== 0) {
                return this._sortAscending ? cmp : -cmp;
            }
            return a.index - b.index;
        });

        return decorated.map((d) => d.row);
    }

    _compareRows(a, b, key) {
        if (key === "pid") {
            return a.pid - b.pid;
        }
        if (key === "user") {
            return a.user.localeCompare(b.user);
        }
        if (key === "cpu") {
            return a.cpu - b.cpu;
        }
        if (key === "mem") {
            return a.memKb - b.memKb;
        }
        if (key === "command") {
            return a.command.localeCompare(b.command);
        }
        return 0;
    }

    _render() {
        this._body.destroy_all_children();
        this._refreshHeaderIndicators();

        if (this._errorMessage) {
            const error = new St.Label({
                style_class: "procmon-error",
                text: this._errorMessage,
                x_align: St.Align.START,
            });
            this._body.add_child(error);
            return;
        }

        const sorted = this._sortRows(this._rows);
        const visibleRows = sorted.slice(0, this.rowCount);

        for (let i = 0; i < visibleRows.length; i++) {
            const r = visibleRows[i];
            const rowBox = new St.BoxLayout({
                style_class: "procmon-data-row",
                vertical: false,
                x_expand: true,
            });

            rowBox.add_child(this._createCell("pid", String(r.pid)));
            rowBox.add_child(this._createCell("user", r.user));
            rowBox.add_child(this._createCell("cpu", r.cpu.toFixed(1)));
            rowBox.add_child(this._createCell("mem", r.memStr));
            rowBox.add_child(this._createCell("command", this._truncateCommand(r.command), true));

            this._body.add_child(rowBox);
        }
    }

    _refreshHeaderIndicators() {
        const keys = Object.keys(this._columnDefs);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const def = this._columnDefs[key];
            const indicator = this._sortKey === key ? (this._sortAscending ? " ^" : " v") : "";
            const label = this._headerLabels[key];
            if (!label) {
                continue;
            }

            label.set_text(def.title + indicator);
            this._setLabelAlignment(label, def.align);
            label.set_style(this._buildHeaderLabelStyle(def.width));
        }
    }

    _createCell(key, text, isCommand = false) {
        const def = this._columnDefs[key];
        const safeText = text == null ? "" : String(text);
        const label = new St.Label({
            style_class: "procmon-row-cell",
            text: safeText,
            x_expand: !!def.expand,
            x_align: def.align === "right" ? St.Align.END : St.Align.START,
        });
        this._setLabelAlignment(label, def.align);

        if (def.width > 0) {
            label.set_style(this._buildContentLabelStyle(def.width));
        } else {
            label.set_style(this._buildContentLabelStyle(0));
        }

        if (isCommand && label.clutter_text) {
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            label.clutter_text.line_wrap = false;
        }

        return label;
    }

    _setLabelAlignment(label, align) {
        if (align === "right") {
            label.x_align = St.Align.END;
            if (label.clutter_text) {
                label.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);
            }
            return;
        }

        label.x_align = St.Align.START;
        if (label.clutter_text) {
            label.clutter_text.set_line_alignment(Pango.Alignment.LEFT);
        }
    }

    _applyHeaderTextColor() {
        const keys = Object.keys(this._headerLabels);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const label = this._headerLabels[key];
            const def = this._columnDefs[key];
            if (!label || !def) {
                continue;
            }
            label.set_style(this._buildHeaderLabelStyle(def.width));
        }
    }

    _buildHeaderLabelStyle(width) {
        const parts = [`color: ${this._sanitizeColor(this.headerTextColor, "#f7f7f7")}`];
        if (width > 0) {
            parts.push(`width: ${width}px`, `min-width: ${width}px`, `max-width: ${width}px`);
        }
        return parts.join("; ") + ";";
    }

    _buildContentLabelStyle(width) {
        const parts = [`color: ${this._sanitizeColor(this.contentTextColor, "#d9d9d9")}`];
        if (width > 0) {
            parts.push(`width: ${width}px`, `min-width: ${width}px`, `max-width: ${width}px`);
        }
        return parts.join("; ") + ";";
    }

    _buildBackgroundStyle() {
        const rgb = this._parseColor(this.backgroundColor);
        const alpha = 1 - (this.backgroundTransparency / 100);
        const clampedAlpha = Math.max(0, Math.min(1, alpha));
        return `background-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha.toFixed(2)})`;
    }

    _sanitizeColor(value, fallback) {
        const v = (value || "").toString().trim();
        if (!v) {
            return fallback;
        }
        if (/^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v)) {
            return v;
        }
        if (/^rgba?\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(v)) {
            return v;
        }
        return fallback;
    }

    _parseColor(value) {
        const safe = this._sanitizeColor(value, "#1b1f24");
        const hex3 = safe.match(/^#([0-9a-fA-F]{3})$/);
        if (hex3) {
            const h = hex3[1];
            return {
                r: parseInt(h[0] + h[0], 16),
                g: parseInt(h[1] + h[1], 16),
                b: parseInt(h[2] + h[2], 16),
            };
        }

        const hex6 = safe.match(/^#([0-9a-fA-F]{6})$/);
        if (hex6) {
            const h = hex6[1];
            return {
                r: parseInt(h.slice(0, 2), 16),
                g: parseInt(h.slice(2, 4), 16),
                b: parseInt(h.slice(4, 6), 16),
            };
        }

        const rgb = safe.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgb) {
            return {
                r: Math.max(0, Math.min(255, Number.parseInt(rgb[1], 10) || 0)),
                g: Math.max(0, Math.min(255, Number.parseInt(rgb[2], 10) || 0)),
                b: Math.max(0, Math.min(255, Number.parseInt(rgb[3], 10) || 0)),
            };
        }

        return { r: 27, g: 31, b: 36 };
    }

    _truncateCommand(command) {
        const raw = command == null ? "" : String(command);
        const max = Math.max(8, this.commandMaxLength);
        if (raw.length <= max) {
            return raw;
        }

        if (max <= 3) {
            return raw.slice(0, max);
        }

        return `${raw.slice(0, max - 3)}...`;
    }

    on_desklet_removed() {
        if (this._refreshTimeoutId) {
            Mainloop.source_remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }
    }
}
