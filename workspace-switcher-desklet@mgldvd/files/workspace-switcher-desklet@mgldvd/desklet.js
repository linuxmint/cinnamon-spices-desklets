const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;

const wm = global.workspace_manager;

// setting key -> property name; all of these just restyle/rebuild the rectangles
const STYLE_KEYS = [
    "orientation", "per-line", "spacing",
    "width", "height", "shadow",
    "border-width", "border-width-active", "border-radius",
    "bg-color", "bg-color-hover", "bg-color-active",
    "border-color", "border-color-hover", "border-color-active",
    "label-mode", "font-size", "font-bold", "label-color", "label-color-active"
];

function camel(key) {
    return key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
}

function toRoman(n) {
    const table = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
                   [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (let [value, symbol] of table)
        while (n >= value) { out += symbol; n -= value; }
    return out;
}

// 1 -> A, 26 -> Z, 27 -> AA (spreadsheet style)
function toLetters(n) {
    let out = "";
    while (n > 0) {
        n--;
        out = String.fromCharCode(65 + n % 26) + out;
        n = Math.floor(n / 26);
    }
    return out;
}

function workArea(monitor) {
    return wm.get_active_workspace().get_work_area_for_monitor(monitor);
}

class WorkspacesDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader("");

        this._pressed = -1;
        this._home = -1;
        this._box = new St.BoxLayout({ reactive: true });
        this._box.connect("scroll-event", (actor, event) => this._onScroll(event));
        this.setContent(this._box);

        // Copies of the rectangles shown on the other monitors. They sit next
        // to the desklet layer rather than inside it, because the desklet
        // manager expects every child of its container to be a real desklet.
        this._clones = [];

        // The rectangles must not consume the press, otherwise the desklet's
        // drag handler never sees it. The press is remembered here and the
        // switch happens on release, which only reaches us when no drag occurred.
        this.actor.connect("button-release-event", (actor, event) => {
            let i = this._pressed;
            this._pressed = -1;
            if (i < 0 || event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            this._activate(i);
            return Clutter.EVENT_STOP;
        });
        this._draggable.connect("drag-begin", () => { this._pressed = -1; });

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, deskletId);
        STYLE_KEYS.forEach(key => this.settings.bind(key, camel(key), () => this._rebuild()));
        this.settings.bind("monitor", "monitor", () => this._rebuild());
        this.settings.bind("position", "position", () => this._rebuild());
        this.settings.bind("margin", "margin", () => this._reposition());
        this.settings.bind("scroll-switch", "scrollSwitch");
        this.settings.bind("scroll-wrap", "scrollWrap");
        this.settings.bind("custom-names", "customNames", () => this._updateAll());

        // Follow renames done in Cinnamon itself (used when no custom name is set).
        this._wmPrefs = new Gio.Settings({ schema_id: "org.cinnamon.desktop.wm.preferences" });
        this._wmPrefsSignal = this._wmPrefs.connect("changed::workspace-names", () => this._updateAll());

        this._signals = [
            wm.connect("workspace-added", () => this._rebuild()),
            wm.connect("workspace-removed", () => this._rebuild()),
            wm.connect("active-workspace-changed", () => this._updateAll())
        ];
        this._displaySignal = global.display.connect("workareas-changed", () => this._reposition());
        this._monitorsSignal = Main.layoutManager.connect("monitors-changed", () => this._rebuild());
        this._actorSignals = [
            this.actor.connect("notify::width", () => this._reposition()),
            this.actor.connect("notify::height", () => this._reposition()),
            this.actor.connect("notify::x", () => this._onMoved()),
            this.actor.connect("notify::y", () => this._onMoved())
        ];

        this._rebuild();
    }

    // Monitor indices to show on; the first is where the desklet itself goes,
    // the rest get clones.
    _targetMonitors() {
        let n = Main.layoutManager.monitors.length;
        let all = [...Array(n).keys()];
        let wanted = this.monitor === "all" ? all
                   : this.monitor === "primary" ? [Main.layoutManager.primaryIndex]
                   : [Math.min(parseInt(this.monitor), n - 1)];

        // In manual mode the desklet stays on whatever monitor it was dragged to.
        if (this.position === "manual") {
            let home = this._actorMonitor();
            return [home].concat(this.monitor === "all" ? all.filter(m => m !== home) : []);
        }
        return wanted;
    }

    // Monitor under the desklet's centre. Uses its coordinates rather than
    // findMonitorIndexForActor(), which warns while the actor is not yet on stage.
    _actorMonitor() {
        let [x, y] = this.actor.get_position();
        let [w, h] = this.actor.get_stage() ? this.actor.get_size() : [0, 0];
        return Main.layoutManager.findMonitorIndexAt(x + w / 2, y + h / 2);
    }

    _rebuild() {
        let monitors = this._targetMonitors();
        this._home = monitors[0];

        this._fill(this._box, true);

        this._clones.forEach(clone => clone.destroy());
        this._clones = monitors.slice(1).map(monitor => {
            let clone = new St.BoxLayout({ reactive: true });
            clone.connect("scroll-event", (actor, event) => this._onScroll(event));
            clone._monitor = monitor;
            this._fill(clone, false);
            Main.deskletContainer.actor.get_parent().insert_child_above(clone, Main.deskletContainer.actor);
            return clone;
        });

        this._updateAll();
        this._reposition();
    }

    _fill(box, isDesklet) {
        box.destroy_all_children();
        box._rects = [];

        let horizontal = this.orientation !== "vertical";
        let n = wm.get_n_workspaces();
        let perLine = this.perLine > 0 ? this.perLine : n;
        let spacing = "spacing: " + this.spacing + "px;";

        // Outer box stacks the lines; each line holds up to perLine rectangles.
        box.vertical = horizontal;
        box.set_style(spacing);

        let line = null;
        for (let i = 0; i < n; i++) {
            if (i % perLine === 0) {
                line = new St.BoxLayout({ vertical: !horizontal, style: spacing });
                box.add_child(line);
            }

            let rect = new St.Bin({ reactive: true, track_hover: true });
            rect.set_child(new St.Label({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true
            }));
            if (isDesklet) {
                rect.connect("button-press-event", (actor, event) => {
                    if (event.get_button() === 1) this._pressed = i;
                    return Clutter.EVENT_PROPAGATE;
                });
            } else {
                // Clones are not draggable, so a plain click is enough.
                rect.connect("button-release-event", (actor, event) => {
                    if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                    this._activate(i);
                    return Clutter.EVENT_STOP;
                });
            }
            rect.connect("notify::hover", () => this._styleRect(rect, i));
            line.add_child(rect);
            box._rects.push(rect);
        }
    }

    _activate(i) {
        let ws = wm.get_workspace_by_index(i);
        if (ws) ws.activate(global.get_current_time());
    }

    _updateAll() {
        [this._box].concat(this._clones).forEach(box =>
            box._rects.forEach((rect, i) => this._styleRect(rect, i)));
    }

    _styleRect(rect, i) {
        let active = i === wm.get_active_workspace_index();
        let hover = rect.hover && !active;

        let bg = active ? this.bgColorActive : hover ? this.bgColorHover : this.bgColor;
        let border = active ? this.borderColorActive : hover ? this.borderColorHover : this.borderColor;
        let borderWidth = active ? this.borderWidthActive : this.borderWidth;

        // St sizes the content box, so subtract the border to keep every
        // rectangle the same outer size even when the active border is thicker.
        let style =
            "width: " + Math.max(0, this.width - 2 * borderWidth) + "px;" +
            "height: " + Math.max(0, this.height - 2 * borderWidth) + "px;" +
            "border: " + borderWidth + "px solid " + border + ";" +
            "border-radius: " + this.borderRadius + "px;" +
            "background-color: " + bg + ";";

        if (this.shadow)
            style += "box-shadow: 0px 2px 6px rgba(0,0,0,0.5);";

        if (this.labelMode !== "none") {
            style +=
                "color: " + (active ? this.labelColorActive : this.labelColor) + ";" +
                "font-size: " + this.fontSize + "px;" +
                "font-weight: " + (this.fontBold ? "bold" : "normal") + ";";
            rect.child.text = this._labelFor(i);
        } else {
            rect.child.text = "";
        }

        rect.set_style(style);
    }

    _labelFor(i) {
        switch (this.labelMode) {
            case "roman": return toRoman(i + 1);
            case "roman-lower": return toRoman(i + 1).toLowerCase();
            case "letter": return toLetters(i + 1);
            case "letter-lower": return toLetters(i + 1).toLowerCase();
            case "name": {
                let custom = (this.customNames || []).find(row => row.workspace === i + 1 && row.name);
                if (custom) return custom.name;
                return this._wmPrefs.get_strv("workspace-names")[i] || Main.getWorkspaceName(i);
            }
            default: return String(i + 1);
        }
    }

    _onScroll(event) {
        if (!this.scrollSwitch) return Clutter.EVENT_PROPAGATE;

        let dir = event.get_scroll_direction();
        let step;
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT) step = -1;
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT) step = 1;
        else return Clutter.EVENT_PROPAGATE;

        let n = wm.get_n_workspaces();
        let target = wm.get_active_workspace_index() + step;
        if (this.scrollWrap) target = (target + n) % n;
        else target = Math.max(0, Math.min(n - 1, target));

        this._activate(target);
        return Clutter.EVENT_STOP;
    }

    // Top-left corner for the desklet actor at the configured position on a monitor.
    _place(monitor) {
        let area = workArea(monitor);
        let [w, h] = this.actor.get_size();
        let [v, hz] = this.position.split("-");
        let m = this.margin;

        let x = hz === "left" ? area.x + m
              : hz === "right" ? area.x + area.width - w - m
              : area.x + (area.width - w) / 2;
        let y = v === "top" ? area.y + m
              : v === "bottom" ? area.y + area.height - h - m
              : area.y + (area.height - h) / 2;
        return [Math.round(x), Math.round(y)];
    }

    _reposition() {
        // Sizes aren't known until the desklet is on stage; the first
        // allocation after that (notify::width/height) calls us again.
        if (!this.position || !this.actor.get_stage()) return;
        if (this.position !== "manual" && this._home >= 0) {
            let [x, y] = this._place(this._home);
            this.actor.set_position(x, y);
        }
        this._placeClones();
    }

    _onMoved() {
        if (this.position !== "manual") return;
        // Dragged onto another monitor: the set of monitors needing clones changed.
        if (this._actorMonitor() !== this._home) this._rebuild();
        else this._placeClones();
    }

    _placeClones() {
        if (!this._clones.length || !this.actor.get_stage()) return;

        // Where the rectangles sit inside the desklet actor (its padding).
        let [ax, ay] = this.actor.get_transformed_position();
        let [bx, by] = this._box.get_transformed_position();
        let [ox, oy] = [bx - ax, by - ay];

        let [x0, y0] = this.actor.get_position();
        let [w, h] = this.actor.get_size();
        let home = workArea(this._home);

        this._clones.forEach(clone => {
            let x, y;
            if (this.position === "manual") {
                // Same offset from the work area's corner as on the desklet's monitor.
                let area = workArea(clone._monitor);
                x = Math.min(area.x + (x0 - home.x), area.x + area.width - w);
                y = Math.min(area.y + (y0 - home.y), area.y + area.height - h);
            } else {
                [x, y] = this._place(clone._monitor);
            }
            clone.set_position(Math.round(x + ox), Math.round(y + oy));
        });
    }

    on_desklet_removed() {
        this._signals.forEach(id => wm.disconnect(id));
        this._actorSignals.forEach(id => this.actor.disconnect(id));
        global.display.disconnect(this._displaySignal);
        Main.layoutManager.disconnect(this._monitorsSignal);
        this._wmPrefs.disconnect(this._wmPrefsSignal);
        this._clones.forEach(clone => clone.destroy());
        this._clones = [];

        // On reload Cinnamon builds the new instance before this runs (after a
        // fade-out), and both share the same settings id, so finalize() would
        // unregister the new instance's settings. Put them back if so.
        let registry = Main.settingsManager.uuids[this.metadata.uuid];
        let current = registry && registry[this.settings.instanceId];
        this.settings.finalize();
        if (current && current !== this.settings)
            registry[this.settings.instanceId] = current;
    }
}

function main(metadata, deskletId) {
    return new WorkspacesDesklet(metadata, deskletId);
}
