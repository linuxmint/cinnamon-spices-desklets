/**
 * Compact / expandable device card (in-place, no dialogs).
 */

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Tooltips = imports.ui.tooltips;
const {
    DeviceType,
    FRESHNESS,
    friendlyName,
    shortName,
    iconForType,
    levelClass,
    statusIndicator,
    Transport
} = require("./models/device");
const {
    formatPercent,
    formatDurationSeconds,
    formatVoltage,
    formatAge,
    buildTooltip
} = require("./utils/formatter");
const { animateWidth, fadeIn, fadeOut } = require("./animations/animator");

class DeviceCard {
    /**
     * @param {object} host desklet-like host with _() and settings accessors
     * @param {object} device
     * @param {object} callbacks { onToggle(card), getSettings() }
     */
    constructor(host, device, callbacks) {
        this.host = host;
        this.callbacks = callbacks || {};
        this.device = device;
        this.expanded = false;
        this._tooltip = null;
        this._barWidth = 0;

        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: "powerpulse-device",
            reactive: true,
            track_hover: true,
            x_expand: true
        });

        this._row = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-device-row",
            x_expand: true,
            reactive: true
        });

        this._icon = new St.Icon({
            icon_name: "battery-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-device-icon",
            y_align: Clutter.ActorAlign.CENTER
        });

        this._name = new St.Label({
            text: "",
            style_class: "powerpulse-device-name",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        this._percentBox = new St.BoxLayout({
            vertical: false,
            style_class: "powerpulse-percent-box",
            y_align: Clutter.ActorAlign.CENTER
        });

        this._percent = new St.Label({
            text: "",
            style_class: "powerpulse-device-percent",
            y_align: Clutter.ActorAlign.CENTER
        });

        this._statusGlyph = new St.Label({
            text: "",
            style_class: "powerpulse-status-glyph",
            y_align: Clutter.ActorAlign.CENTER
        });

        this._ageIcon = new St.Icon({
            icon_name: "dialog-warning-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            style_class: "powerpulse-age-icon powerpulse-age-soft",
            y_align: Clutter.ActorAlign.CENTER
        });
        this._ageIcon.hide();

        this._percentBox.add_child(this._percent);
        this._percentBox.add_child(this._statusGlyph);
        this._percentBox.add_child(this._ageIcon);

        this._row.add_child(this._icon);
        this._row.add_child(this._name);
        this._row.add_child(this._percentBox);

        this._barTrack = new St.Bin({
            style_class: "powerpulse-bar-track",
            x_expand: true
        });
        this._barFill = new St.Bin({
            style_class: "powerpulse-bar-fill",
            x_align: Clutter.ActorAlign.START
        });
        this._barTrack.set_child(this._barFill);

        this._details = new St.BoxLayout({
            vertical: true,
            style_class: "powerpulse-details",
            x_expand: true
        });
        this._details.hide();
        this._details.opacity = 0;

        this.actor.add_child(this._row);
        this.actor.add_child(this._barTrack);
        this.actor.add_child(this._details);

        this._row.connect("button-release-event", (_a, event) => {
            if (event.get_button() === 1) {
                const settings = this._settings();
                if (settings.expand_on_click !== false) {
                    this.toggle();
                    if (this.callbacks.onToggle) {
                        this.callbacks.onToggle(this);
                    }
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.update(device);
    }

    _settings() {
        return this.callbacks.getSettings ? this.callbacks.getSettings() : {};
    }

    _t(str) {
        return this.host && this.host._ ? this.host._(str) : str;
    }

    _nameOpts() {
        const s = this._settings();
        return { laptopName: s.laptop_display_name || "Laptop" };
    }

    toggle() {
        if (this.expanded) {
            this.collapse();
        } else {
            this.expand();
        }
    }

    expand() {
        if (this.expanded) {
            return;
        }
        this.expanded = true;
        this.actor.add_style_class_name("expanded");
        this._rebuildDetails();
        fadeIn(this._details, 220);
    }

    collapse() {
        if (!this.expanded) {
            return;
        }
        this.expanded = false;
        this.actor.remove_style_class_name("expanded");
        fadeOut(this._details, 180);
    }

    update(device) {
        this.device = device;
        const s = this._settings();
        const connected = !!device.connected;
        const lvl = levelClass(device.percentage, connected);
        const label = friendlyName(device, this._nameOpts());

        this.actor.set_style_class_name(
            "powerpulse-device" + (s.compact_mode ? " compact" : "") + (this.expanded ? " expanded" : "")
        );
        ["powerpulse-level-high", "powerpulse-level-medium", "powerpulse-level-low",
            "powerpulse-level-disconnected", "powerpulse-level-unknown"].forEach((c) => {
            this.actor.remove_style_class_name(c);
        });
        this.actor.add_style_class_name(lvl);

        if (s.show_icons !== false) {
            this._icon.show();
            this._icon.icon_name = iconForType(device.type);
        } else {
            this._icon.hide();
        }

        this._name.set_text(shortName(label, s.compact_mode ? 14 : 20));

        if (s.show_percent !== false) {
            this._percent.show();
            this._percent.set_text(connected ? formatPercent(device.percentage) : this._t("N/A"));
        } else {
            this._percent.hide();
        }

        const indicator = statusIndicator(device, s.low_battery_threshold);
        if (indicator && connected) {
            this._statusGlyph.set_text(indicator.glyph);
            this._statusGlyph.show();
        } else {
            this._statusGlyph.set_text("");
            this._statusGlyph.hide();
        }

        if (connected && device.source === "upower" &&
            (device.freshness === FRESHNESS.SOFT || device.freshness === FRESHNESS.HARD)) {
            this._ageIcon.style_class = "powerpulse-age-icon " +
                (device.freshness === FRESHNESS.HARD ? "powerpulse-age-hard" : "powerpulse-age-soft");
            this._ageIcon.show();
        } else {
            this._ageIcon.hide();
        }

        if (s.show_progress_bars !== false && connected && device.percentage !== null) {
            this._barTrack.show();
            const pct = Math.max(0, Math.min(100, Math.round(device.percentage)));
            this._barFill.style_class = "powerpulse-bar-fill " + lvl;
            const target = Math.max(3, Math.round((pct / 100) * 200));
            if (this._barWidth === 0) {
                this._barFill.set_width(target);
            } else if (this._barWidth !== target) {
                animateWidth(this._barFill, target, 280);
            }
            this._barWidth = target;
        } else {
            this._barTrack.hide();
            this._barWidth = 0;
        }

        if (this.expanded) {
            this._rebuildDetails();
        }

        this._updateTooltip(label);
    }

    _updateTooltip(label) {
        let note = null;
        if (this.device.source === "upower" && this.device.freshness === FRESHNESS.SOFT) {
            note = this._t("Last UPower report %s ago. Bluetooth devices often keep a valid percentage until the level changes or they reconnect.").format(formatAge(this.device.ageSeconds));
        } else if (this.device.source === "upower" && this.device.freshness === FRESHNESS.HARD) {
            note = this._t("Last UPower report %s ago. The percentage may still be valid if the device only publishes updates on change.").format(formatAge(this.device.ageSeconds));
        }
        const text = buildTooltip(this.device, {
            displayName: label,
            freshnessNote: note
        });
        if (this._tooltip) {
            this._tooltip.set_text(text);
        } else {
            this._tooltip = new Tooltips.Tooltip(this.actor, text);
        }
    }

    _addDetail(label, value) {
        if (value === null || value === undefined || value === "") {
            return;
        }
        this._details.add_child(new St.Label({
            text: label,
            style_class: "powerpulse-detail-label"
        }));
        this._details.add_child(new St.Label({
            text: String(value),
            style_class: "powerpulse-detail-value"
        }));
    }

    _rebuildDetails() {
        const children = this._details.get_children();
        for (let i = 0; i < children.length; i++) {
            children[i].destroy();
        }

        const d = this.device;
        const s = this._settings();
        const connected = !!d.connected;

        this._addDetail(this._t("Status"), connected ? this._t("Connected") : this._t("Disconnected"));

        if (d.type === DeviceType.BATTERY) {
            if (s.show_health !== false && d.capacity !== null) {
                this._addDetail(this._t("Battery health"), Math.round(d.capacity) + "%");
            }
            if (s.show_health !== false && d.energyFullDesign !== null) {
                this._addDetail(this._t("Design capacity"), d.energyFullDesign.toFixed(1) + " Wh");
            }
            if (s.show_health !== false && d.energyFull !== null) {
                this._addDetail(this._t("Current capacity"), d.energyFull.toFixed(1) + " Wh");
            }
            if (s.show_cycles !== false && d.cycleCount !== null) {
                this._addDetail(this._t("Cycle count"), String(Math.round(d.cycleCount)));
            }
            this._addDetail(this._t("Charge state"), d.state || "—");
            if (s.show_time_remaining !== false && d.timeToEmpty) {
                const rem = formatDurationSeconds(d.timeToEmpty);
                if (rem) this._addDetail(this._t("Time remaining"), rem);
            }
            if (s.show_voltage !== false && d.voltage !== null) {
                const v = formatVoltage(d.voltage);
                if (v) this._addDetail(this._t("Voltage"), v);
            }
            this._addDetail(this._t("Provider"), d.providerLabel || d.source);
            return;
        }

        if (d.type === DeviceType.MOUSE || d.type === DeviceType.KEYBOARD) {
            this._addDetail(this._t("Last update"), this._t("%s ago").format(
                d.updated ? formatAge((Date.now() / 1000) - d.updated) : "—"
            ));
            this._addDetail(this._t("Provider"), d.providerLabel || d.source);
            this._addDetail(this._t("Connection"), this._transportLabel(d.transport));
            if (d.mac) {
                this._addDetail(this._t("MAC"), d.mac);
            }
            return;
        }

        // Headset / default expanded info
        if (s.show_time_remaining !== false && d.timeToEmpty) {
            const rem = formatDurationSeconds(d.timeToEmpty);
            if (rem) this._addDetail(this._t("Time remaining"), rem);
        }
        if (s.show_voltage !== false && d.voltage !== null) {
            const v = formatVoltage(d.voltage);
            if (v) this._addDetail(this._t("Voltage"), v);
        }
        this._addDetail(this._t("Last update"), this._t("%s ago").format(
            d.updated ? formatAge((Date.now() / 1000) - d.updated) : "—"
        ));
        this._addDetail(this._t("Provider"), d.providerLabel || d.source);
    }

    _transportLabel(transport) {
        switch (transport) {
            case Transport.BLUETOOTH:
                return "Bluetooth";
            case Transport.USB:
                return "USB";
            case Transport.BATTERY:
                return this._t("Internal");
            case Transport.WIRELESS:
                return this._t("Wireless");
            default:
                return this._t("Unknown");
        }
    }

    destroy() {
        if (this._tooltip) {
            try { this._tooltip.destroy(); } catch (e) {}
            this._tooltip = null;
        }
        try { this.actor.destroy(); } catch (e) {}
    }
}

module.exports = { DeviceCard };
