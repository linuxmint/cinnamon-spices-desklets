const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;

function TemperatureDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

TemperatureDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        global.log(`TemperatureDesklet: _init(${metadata}, ${deskletId})`);
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        // Initialize settings
        this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

        this.settings.bindProperty(Settings.BindingDirection.IN, "tempFilePath", "tempFilePath", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "labelText", "labelText", this.on_settings_changed, null);

        // Create label for the static text
        this.label = new St.Label({ text: "CPU temperature:", y_align: St.Align.START });

        // Create label for the temperature value
        this.temperatureLabel = new St.Label({ text: "Loading...", style_class: "temperature-label" });

        // Set up the layout
        this.box = new St.BoxLayout({ vertical: true });
        this.box.add_child(this.label);
        this.box.add_child(this.temperatureLabel);
        this.setContent(this.box);

        this._timeout = null;
        this.updateTemperature();
    },

    updateTemperature: function () {
        try {
            let [result, out] = GLib.spawn_command_line_sync("cat /sys/class/thermal/thermal_zone2/temp");

            if (result && out !== null) {
                // Convert temperature from millidegree Celsius to degree Celsius
                let temperature = parseFloat(out.toString().trim()) / 1000.0;
                this.temperatureLabel.set_text(temperature.toFixed(1) + "°C");
            } else {
                this.temperatureLabel.set_text("Error");
                global.logError("Error: Could not retrieve CPU temperature.");
            }
        } catch (e) {
            global.logError("Error in updateTemperature: " + e.message);
            this.temperatureLabel.set_text("Error");
        }

        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
        }
        this._timeout = Mainloop.timeout_add_seconds(2, Lang.bind(this, this.updateTemperature));
    },

    on_settings_changed: function () {
        // Update the label text when the settings change
        if (this.label && this.labelText) {
            this.label.set_text(this.labelText);
        }
    },

    on_desklet_removed: function () {
        // Clean up the timeout when the desklet is removed
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }

        if (this.label) {
            this.box.remove_child(this.label);
            this.label = null;
        }

        if (this.temperatureLabel) {
            this.box.remove_child(this.temperatureLabel);
            this.temperatureLabel = null;
        }
    }
};

function main(metadata, deskletId) {
    return new TemperatureDesklet(metadata, deskletId);
}
