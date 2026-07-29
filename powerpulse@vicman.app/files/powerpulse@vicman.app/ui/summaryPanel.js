/**
 * Header summary panel — expands when the PowerPulse title is clicked.
 */

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const { fadeIn, fadeOut } = require("./animations/animator");
const { formatAge } = require("./utils/formatter");

class SummaryPanel {
    constructor(host) {
        this.host = host;
        this.expanded = false;

        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: "powerpulse-summary",
            x_expand: true
        });
        this.actor.hide();
        this.actor.opacity = 0;

        this._body = new St.Label({
            text: "",
            style_class: "powerpulse-summary-body"
        });
        this.actor.add_child(this._body);
    }

    _t(str) {
        return this.host && this.host._ ? this.host._(str) : str;
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
        fadeIn(this.actor, 220);
    }

    collapse() {
        if (!this.expanded) {
            return;
        }
        this.expanded = false;
        fadeOut(this.actor, 180);
    }

    /**
     * @param {object} stats from buildStats()
     * @param {number} lastRefresh epoch seconds
     * @param {string} version
     */
    update(stats, lastRefresh, version) {
        const lines = [];
        const s = stats || { count: 0, charging: 0, discharging: 0, low: 0, providers: [] };
        lines.push(this._t("%s devices").format(String(s.count)));
        lines.push(this._t("%s charging").format(String(s.charging)));
        lines.push(this._t("%s low").format(String(s.low)));
        if (lastRefresh) {
            lines.push(this._t("Updated %s ago").format(formatAge((Date.now() / 1000) - lastRefresh)));
        }
        if (s.providers && s.providers.length) {
            lines.push(this._t("Providers: %s").format(s.providers.join(", ")));
        }
        lines.push(this._t("Version %s").format(version || "1.2.0"));
        this._body.set_text(lines.join("\n"));
    }
}

module.exports = { SummaryPanel };
