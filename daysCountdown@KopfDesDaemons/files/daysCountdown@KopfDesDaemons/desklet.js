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
        this.labelText = this.settings.getValue("labelText") || "New Year Countdown";
        this.countdownDate = this.settings.getValue("countdownDate") || {
            d: 31,
            m: 12,
            y: new Date().getFullYear()
        };

        // Bind settings properties
        this.settings.bindProperty(Settings.BindingDirection.IN, "labelText", "labelText", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "countdownDate", "countdownDate", this.on_settings_changed, null);

        // Set up the layout
        const box = new St.BoxLayout({ vertical: true });
        this.textLabel = new St.Label({ text: this.labelText });
        this.daysLabel = new St.Label({ text: this._calcDays().toString() });
        box.add_child(this.textLabel);
        box.add_child(this.daysLabel);
        this.setContent(box);
    },

    _calcDays() {
        const now = new Date();
        const then = new Date(this.countdownDate.y, this.countdownDate.m - 1, this.countdownDate.d);
        const diff = then.getTime() - now.getTime();
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        return days;
    },

    on_settings_changed: function () {
        // Update the label text and styles when the settings change
        if (this.textLabel && this.labelText) {
            this.textLabel.set_text(this.labelText);
        }

        if (this.daysLabel && this.countdownDate) {
            this.daysLabel.set_text(this._calcDays().toString());
        }
    },
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
