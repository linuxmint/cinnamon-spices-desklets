/**
 * Rich hover panel for a device. Cinnamon's Tooltip is text-only, so this
 * floats a styled panel on Main.uiGroup beside the desklet.
 */

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const {
    DeviceType,
    DeviceState,
    batteryHealthGrade,
    iconForType,
    levelClass,
    friendlyName
} = require("./models/device");
const {
    formatPercent,
    formatDurationSeconds,
    formatVoltage,
    formatPowerWatts,
    formatClockTime,
    formatAge
} = require("./utils/formatter");

const SHOW_DELAY_MS = 320;
const HIDE_DELAY_MS = 180;

class HoverPopover {
    constructor(host) {
        this.host = host;
        this._card = null;
        this._showId = 0;
        this._hideId = 0;
        this._visible = false;

        this.actor = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-popover-wrap",
            reactive: true,
            track_hover: true,
            visible: false
        });
        this.actor.opacity = 0;

        this._caret = new St.Bin({ style_class: "powerpulse-popover-caret" });
        this._panel = new St.BoxLayout({
            vertical: true,
            style_class: "powerpulse-popover"
        });
        this.actor.add_child(this._caret);
        this.actor.add_child(this._panel);

        this.actor.connect("notify::hover", () => {
            if (this.actor.hover) {
                this._cancelHide();
            } else {
                this.scheduleHide();
            }
        });

        try {
            Main.uiGroup.add_child(this.actor);
        } catch (e) {
            try { global.stage.add_child(this.actor); } catch (e2) {}
        }
    }

    _t(str) {
        return this.host && this.host._ ? this.host._(str) : str;
    }

    handle(card, hovering) {
        if (hovering) {
            this._card = card;
            this._cancelHide();
            this._armShow();
        } else {
            this.scheduleHide();
        }
    }

    refresh(card) {
        if (!this._visible || this._card !== card) {
            return;
        }
        this._rebuild(card);
        this._position(card.actor);
    }

    scheduleHide() {
        this._cancelShow();
        this._cancelHide();
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this._hideId = 0;
            if (this.actor && this.actor.hover) {
                return GLib.SOURCE_REMOVE;
            }
            this.hideNow();
            return GLib.SOURCE_REMOVE;
        });
    }

    hideNow() {
        this._cancelShow();
        this._cancelHide();
        this._visible = false;
        this._card = null;
        if (!this.actor) {
            return;
        }
        try {
            this.actor.hide();
            this.actor.opacity = 0;
        } catch (e) {}
    }

    _armShow() {
        this._cancelShow();
        this._showId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
            this._showId = 0;
            this._showNow();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelShow() {
        if (this._showId) {
            GLib.source_remove(this._showId);
            this._showId = 0;
        }
    }

    _cancelHide() {
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }
    }

    _showNow() {
        const card = this._card;
        if (!card || !card.device || !card.actor) {
            return;
        }
        this._rebuild(card);
        this._position(card.actor);
        this.actor.show();
        this.actor.opacity = 255;
        this._visible = true;
        try { this.actor.raise_top(); } catch (e) {}
    }

    _rebuild(card) {
        const children = this._panel.get_children();
        for (let i = 0; i < children.length; i++) {
            children[i].destroy();
        }

        const device = card.device;
        const settings = card._settings ? card._settings() : {};
        const name = friendlyName(device, card._nameOpts ? card._nameOpts() : {});
        const connected = !!device.connected;
        const lvl = levelClass(device.percentage, connected);

        this._panel.add_child(this._header(device, name, connected, lvl));
        this._panel.add_child(this._divider());

        const rows = this._detailRows(device, settings, connected);
        for (let i = 0; i < rows.length; i++) {
            this._panel.add_child(rows[i]);
        }

        const actions = this._actionRows(device, card);
        if (actions.length) {
            this._panel.add_child(this._divider());
            for (let i = 0; i < actions.length; i++) {
                this._panel.add_child(actions[i]);
            }
        }
    }

    _header(device, name, connected, lvl) {
        const box = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-popover-header"
        });
        box.add_child(new St.Icon({
            icon_name: iconForType(device.type) || device.iconName || "battery-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-popover-device-icon"
        }));
        box.add_child(new St.Label({
            text: name,
            style_class: "powerpulse-popover-title",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        }));
        box.add_child(new St.Label({
            text: connected ? formatPercent(device.percentage) : this._t("N/A"),
            style_class: "powerpulse-popover-percent " + lvl,
            y_align: Clutter.ActorAlign.CENTER
        }));
        box.add_child(new St.Icon({
            icon_name: this._batteryIcon(device, connected),
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-popover-battery-icon " + lvl
        }));
        return box;
    }

    _batteryIcon(device, connected) {
        if (!connected) {
            return "battery-missing-symbolic";
        }
        if (device.state === DeviceState.CHARGING || device.state === DeviceState.PENDING_CHARGE) {
            return "battery-good-charging-symbolic";
        }
        const p = Number(device.percentage);
        if (isNaN(p)) {
            return "battery-symbolic";
        }
        if (p >= 80) {
            return "battery-full-symbolic";
        }
        if (p >= 40) {
            return "battery-good-symbolic";
        }
        if (p >= 15) {
            return "battery-low-symbolic";
        }
        return "battery-caution-symbolic";
    }

    _detailRows(device, settings, connected) {
        const rows = [];
        rows.push(this._row("network-transmit-receive-symbolic", this._t("Status"), this._stateLabel(device, connected)));

        if (settings.show_time_remaining !== false) {
            if (device.state === DeviceState.CHARGING && device.timeToFull) {
                const toFull = formatDurationSeconds(device.timeToFull);
                if (toFull) {
                    rows.push(this._row("appointment-soon-symbolic", this._t("Time to full"), toFull));
                }
            } else if (device.timeToEmpty) {
                const remaining = formatDurationSeconds(device.timeToEmpty);
                if (remaining) {
                    rows.push(this._row("appointment-soon-symbolic", this._t("Time left"), remaining));
                }
            }
        }

        const discharging = device.state === DeviceState.DISCHARGING
            || device.state === DeviceState.PENDING_DISCHARGE;
        const charging = device.state === DeviceState.CHARGING
            || device.state === DeviceState.PENDING_CHARGE;
        if (device.energyRate !== null && device.energyRate !== undefined) {
            const power = formatPowerWatts(device.energyRate, discharging || !charging);
            if (power) {
                rows.push(this._row("ac-adapter-symbolic", this._t("Power"), power));
            }
        }

        if (settings.show_voltage !== false) {
            const voltage = (device.voltage !== null && device.voltage !== undefined)
                ? formatVoltage(device.voltage)
                : null;
            rows.push(this._row("battery-symbolic", this._t("Voltage"), voltage || "—"));
        }

        if (settings.show_health !== false) {
            const grade = batteryHealthGrade(device.capacity);
            if (grade) {
                rows.push(this._row("emblem-ok-symbolic", this._t("Health"), this._healthLabel(grade)));
            }
        }

        if (settings.show_cycles !== false && device.cycleCount !== null && device.cycleCount !== undefined) {
            rows.push(this._row("view-refresh-symbolic", this._t("Cycles"), String(Math.round(device.cycleCount))));
        }

        const ageSeconds = this._ageSeconds(device);
        if (ageSeconds !== null) {
            rows.push(this._row("alarm-symbolic", this._t("Age"), formatAge(ageSeconds)));
        }

        if (device.updated) {
            const clock = formatClockTime(device.updated);
            if (clock) {
                rows.push(this._row("document-open-recent-symbolic", this._t("Last update"), clock));
            }
        }

        if (device.type === DeviceType.MOUSE || device.type === DeviceType.KEYBOARD) {
            rows.push(this._row("network-wireless-symbolic", this._t("Connection"), this._transportLabel(device.transport)));
        }

        if (device.providerLabel || device.source) {
            rows.push(this._row("application-x-executable-symbolic", this._t("Provider"), device.providerLabel || device.source));
        }

        return rows;
    }

    _ageSeconds(device) {
        if (device.ageSeconds !== null && device.ageSeconds !== undefined && Number(device.ageSeconds) >= 0) {
            return Number(device.ageSeconds);
        }
        if (device.updated) {
            return Math.max(0, (Date.now() / 1000) - Number(device.updated));
        }
        return null;
    }

    _transportLabel(transport) {
        switch (transport) {
            case "bluetooth":
                return "Bluetooth";
            case "usb":
                return "USB";
            case "internal":
                return this._t("Internal");
            case "wireless":
                return this._t("Wireless");
            default:
                return this._t("Unknown");
        }
    }

    _stateLabel(device, connected) {
        if (!connected) {
            return this._t("Disconnected");
        }
        switch (device.state) {
            case DeviceState.CHARGING:
                return this._t("Charging");
            case DeviceState.DISCHARGING:
                return this._t("Discharging");
            case DeviceState.FULLY_CHARGED:
                return this._t("Fully charged");
            case DeviceState.EMPTY:
                return this._t("Empty");
            case DeviceState.PENDING_CHARGE:
                return this._t("Pending charge");
            case DeviceState.PENDING_DISCHARGE:
                return this._t("Pending discharge");
            case DeviceState.AVAILABLE:
                return this._t("Available");
            default:
                return this._t("Connected");
        }
    }

    _healthLabel(grade) {
        if (grade === "good") {
            return this._t("Good");
        }
        if (grade === "fair") {
            return this._t("Fair");
        }
        return this._t("Poor");
    }

    _actionRows(device, card) {
        const rows = [];
        const cb = card.callbacks || {};
        const isHeadset = device.source === "headsetcontrol" || device.type === DeviceType.HEADSET;
        if (isHeadset && cb.onOpenHeadset) {
            rows.push(this._actionButton(
                "audio-headset-symbolic",
                this._t("Open HeadsetControl"),
                "web-browser-symbolic",
                false,
                () => cb.onOpenHeadset(device)
            ));
        }
        if (cb.onForget) {
            rows.push(this._actionButton(
                "user-trash-symbolic",
                this._t("Forget device"),
                "user-trash-symbolic",
                true,
                () => cb.onForget(device)
            ));
        }
        return rows;
    }

    _actionButton(leftIcon, label, rightIcon, danger, onClick) {
        const btn = new St.Button({
            style_class: "powerpulse-popover-action" + (danger ? " danger" : ""),
            x_expand: true,
            reactive: true,
            track_hover: true
        });
        const row = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-popover-action-row",
            x_expand: true
        });
        row.add_child(new St.Icon({
            icon_name: leftIcon,
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-popover-row-icon"
        }));
        row.add_child(new St.Label({
            text: label,
            style_class: "powerpulse-popover-action-label",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        }));
        row.add_child(new St.Icon({
            icon_name: rightIcon,
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-popover-row-icon"
        }));
        btn.set_child(row);
        btn.connect("clicked", () => {
            this.hideNow();
            if (onClick) {
                onClick();
            }
        });
        return btn;
    }

    _row(iconName, label, value) {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-popover-row"
        });
        row.add_child(new St.Icon({
            icon_name: iconName,
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-popover-row-icon"
        }));
        row.add_child(new St.Label({
            text: label,
            style_class: "powerpulse-popover-row-label",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        }));
        row.add_child(new St.Label({
            text: String(value),
            style_class: "powerpulse-popover-row-value",
            y_align: Clutter.ActorAlign.CENTER
        }));
        return row;
    }

    _divider() {
        return new St.Bin({ style_class: "powerpulse-popover-divider", x_expand: true });
    }

    _position(source) {
        if (!source || !this.actor) {
            return;
        }
        let x = 0;
        let y = 0;
        let sw = 0;
        let sh = 0;
        try {
            const pos = source.get_transformed_position();
            x = pos[0];
            y = pos[1];
        } catch (e) {}
        try {
            const size = source.get_transformed_size();
            sw = size[0];
            sh = size[1];
        } catch (e) {
            try {
                sw = source.width;
                sh = source.height;
            } catch (e2) {}
        }

        this.actor.show();
        const pw = this.actor.width || 260;
        const ph = this.actor.height || 220;

        let monitor = null;
        try {
            monitor = Main.layoutManager.findMonitorForActor(source);
        } catch (e) {}
        if (!monitor) {
            try { monitor = Main.layoutManager.primaryMonitor; } catch (e2) {}
        }
        const mx = monitor ? monitor.x : 0;
        const my = monitor ? monitor.y : 0;
        const mw = monitor ? monitor.width : 1920;
        const mh = monitor ? monitor.height : 1080;

        let px = x + sw + 10;
        let py = y - 8;
        this.actor.remove_style_class_name("flip");
        if (px + pw > mx + mw - 8) {
            px = x - pw - 10;
            this.actor.add_style_class_name("flip");
        }
        if (py + ph > my + mh - 8) {
            py = my + mh - ph - 8;
        }
        if (py < my + 8) {
            py = my + 8;
        }
        this.actor.set_position(Math.round(px), Math.round(py));
    }

    destroy() {
        this.hideNow();
        try { this.actor.destroy(); } catch (e) {}
        this.actor = null;
    }
}

module.exports = { HoverPopover };
