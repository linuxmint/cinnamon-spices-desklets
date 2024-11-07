const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

const UUID = "systemTemperature@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function TemperatureDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

TemperatureDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        // Initialize settings
        this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

        // Get settings
        this.initialLabelText = this.settings.getValue("labelText") || "CPU temperature:";
        this.tempFilePath = this.settings.getValue("tempFilePath") || "/sys/class/thermal/thermal_zone2/temp";
        this.fontSizeLabel = this.settings.getValue("fontSizeLabel") || 12;
        this.fontSizeTemperature = this.settings.getValue("fontSizeTemperature") || 20;
        this.dynamicColorEnabled = this.settings.getValue("dynamicColorEnabled") || true;
        this.temperatureUnit = this.settings.getValue("temperatureUnit") || "C";
        this.updateInterval = this.settings.getValue("updateInterval") || 1;

        // Bind settings properties
        this.settings.bindProperty(Settings.BindingDirection.IN, "tempFilePath", "tempFilePath", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "labelText", "labelText", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "temperatureUnit", "temperatureUnit", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "updateInterval", "updateInterval", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeLabel", "fontSizeLabel", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeTemperature", "fontSizeTemperature", this.on_settings_changed, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "dynamicColorEnabled", "dynamicColorEnabled", this.on_settings_changed, null);

        // Create label for the static text
        this.label = new St.Label({ text: this.initialLabelText, y_align: St.Align.START, style_class: "label-text" });
        this.label.set_style(`font-size: ${this.fontSizeLabel}px;`);

        // Create label for the temperature value
        this.temperatureLabel = new St.Label({ text: "Loading...", style_class: "temperature-label" });
        this.temperatureLabel.set_style(`font-size: ${this.fontSizeTemperature}px;`);

        // Set up the layout
        this.box = new St.BoxLayout({ vertical: true });
        this.box.add_child(this.label);
        this.box.add_child(this.temperatureLabel);
        this.setContent(this.box);

        this._timeout = null;

        // Start the temperature update loop
        this.updateTemperature();
    },

    updateTemperature: function () {
        try {
            let [result, out] = GLib.spawn_command_line_sync("cat " + this.tempFilePath);

            if (result && out !== null) {
                // Convert temperature from millidegree Celsius to degree Celsius
                let temperature = parseFloat(out.toString().trim()) / 1000.0;

                // Convert to Fahrenheit if needed
                if (this.temperatureUnit === "F") {
                    temperature = (temperature * 9 / 5) + 32;
                }

                // Update temperature text with the chosen unit
                this.temperatureLabel.set_text(temperature.toFixed(1) + "°" + this.temperatureUnit);

                // Set the color based on the temperature if dynamic color is enabled
                if (this.dynamicColorEnabled) {
                    this.updateLabelColor(temperature);
                } else {
                    // Set default color if dynamic color is disabled
                    this.temperatureLabel.set_style(`color: #ffffff; font-size: ${this.fontSizeTemperature}px;`);
                }
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
        this._timeout = Mainloop.timeout_add_seconds(this.updateInterval, Lang.bind(this, this.updateTemperature));
    },

    updateLabelColor: function (temperature) {
        // Limits for color change depending on the temperature unit
        let minTemp, maxTemp;

        if (this.temperatureUnit === "F") {
            minTemp = (20 * 9 / 5) + 32;
            maxTemp = (90 * 9 / 5) + 32;
        } else {
            // Celsius Limits
            minTemp = 20;
            maxTemp = 90;
        }

        temperature = Math.max(minTemp, Math.min(maxTemp, temperature));

        let green = Math.max(0, 255 - Math.floor((temperature - minTemp) / (maxTemp - minTemp) * 255));
        let red = Math.max(0, Math.floor((temperature - minTemp) / (maxTemp - minTemp) * 255));

        // Set the color
        let color = `rgb(${red}, ${green}, 0)`;
        this.temperatureLabel.set_style(`color: ${color}; font-size: ${this.fontSizeTemperature}px;`);
    },


    on_settings_changed: function () {
        // Update the label text and styles when the settings change
        if (this.label && this.labelText) {
            this.label.set_text(this.labelText);
            this.label.set_style(`font-size: ${this.fontSizeLabel}px;`);
        }

        if (this.temperatureLabel) {
            this.temperatureLabel.set_style(`font-size: ${this.fontSizeTemperature}px;`);
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
