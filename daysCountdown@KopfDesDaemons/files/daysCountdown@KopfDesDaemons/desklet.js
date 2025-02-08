const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

const UUID = "daysCountdown@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.setHeader(_("Days Countdown"));

        // Initialize settings
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);

        // Get settings
        this.labelText = this.settings.getValue("labelText") || "New Year 2025 Countdown";
        this.fontSizeLabel = this.settings.getValue("fontSizeLabel") || 12;
        this.fontSizeCountdown = this.settings.getValue("fontSizeCountdown") || 36;
        this.colorCountdown = this.settings.getValue("colorCountdown") || "rgb(255, 255, 255)";
        this.colorLabel = this.settings.getValue("colorLabel") || "rgb(98, 160, 234)";
        this.countdownDate = this.settings.getValue("countdownDate") || { d: 31, m: 12, y: 2025 };
        this.refreshInterval = this.settings.getValue("refreshInterval") || "only-after-starting";

        // Bind settings properties
        this.settings.bindProperty(Settings.BindingDirection.IN, "labelText", "labelText", this.updateUI, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "countdownDate", "countdownDate", this.updateUI, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeLabel", "fontSizeLabel", this.updateUI, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeCountdown", "fontSizeCountdown", this.updateUI, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this.updateUI, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "colorCountdown", "colorCountdown", this.updateUI, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "refreshInterval", "refreshInterval", this.refreshCountdown, null);

        this._setupLayout();

        this.timeout = null;

        this.updateUI();
        this.refreshCountdown();
    },

    _setupLayout() {
        this.box = new St.BoxLayout({ vertical: true });
        this.textLabel = new St.Label();
        this.daysLabel = new St.Label();

        this.box.add_child(this.textLabel);
        this.box.add_child(this.daysLabel);
        this.setContent(this.box);
    },

    calcDays() {
        if (!this.countdownDate) return 0;
        const now = new Date();
        const then = new Date(this.countdownDate.y, this.countdownDate.m - 1, this.countdownDate.d);
        return Math.ceil((then - now) / (1000 * 60 * 60 * 24));
    },

    getDaysString() {
        return _("%f days").format(this.calcDays().toString());
    },

    updateUI: function () {
        if (this.textLabel) {
            this.textLabel.set_text(this.labelText);
            this.textLabel.set_style(`font-size: ${this.fontSizeLabel}px; color: ${this.colorLabel};`);
        }

        if (this.daysLabel) {
            this.daysLabel.set_text(this.getDaysString());
            this.daysLabel.set_style(`font-size: ${this.fontSizeCountdown}px; color: ${this.colorCountdown};`);
        }
    },

    refreshCountdown: function () {
        this.daysLabel.set_text(this.getDaysString());

        if (this.timeout) Mainloop.source_remove(this.timeout);
        if (this.refreshInterval === "only-after-starting") return;

        global.log(`${UUID}: ${this.labelText} refreshed. Next refresh in ${this.refreshInterval} seconds.`);
        this.timeout = Mainloop.timeout_add_seconds(this.refreshInterval, () => this.refreshCountdown());
    },

    on_desklet_removed: function () {
        if (this.timeout) Mainloop.source_remove(this.timeout);
        if (this.textLabel) this.box.remove_child(this.textLabel);
        if (this.daysLabel) this.box.remove_child(this.daysLabel);

        this.timeout = this.textLabel = this.daysLabel = null;
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
