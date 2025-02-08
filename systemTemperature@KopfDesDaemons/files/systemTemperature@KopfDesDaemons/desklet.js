const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

const UUID = "systemTemperature@KopfDesDaemons";

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

        this.setHeader(_("System Temperature"));

        // Initialize settings
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);

        // Get settings
        this.initialLabelText = this.settings.getValue("labelText") || "CPU temperature:";
        this.tempFilePath = this.settings.getValue("tempFilePath") || "/sys/class/thermal/thermal_zone2/temp";
        this.fontSizeLabel = this.settings.getValue("fontSizeLabel") || 12;
        this.fontSizeTemperature = this.settings.getValue("fontSizeTemperature") || 20;
        this.dynamicColorEnabled = this.settings.getValue("dynamicColorEnabled") || true;
        this.temperatureUnit = this.settings.getValue("temperatureUnit") || "C";
        this.updateInterval = this.settings.getValue("updateInterval") || 1;

        // Bind settings properties
        const boundSettings = [
            "tempFilePath",
            "labelText",
            "temperatureUnit",
            "updateInterval",
            "fontSizeLabel",
            "fontSizeTemperature",
            "dynamicColorEnabled"
        ];
        boundSettings.forEach(setting => {
            this.settings.bindProperty(Settings.BindingDirection.IN, setting, setting, this.on_settings_changed, null);
        });

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
            // Get CPU temperature
            const [result, out] = GLib.spawn_command_line_sync(`cat ${this.tempFilePath}`);

            if (!result || out === null) {
                throw new Error("Could not retrieve CPU temperature.");
            }

            // Convert temperature from millidegree Celsius to degree Celsius
            let temperature = parseFloat(out.toString().trim()) / 1000.0;
            if (this.temperatureUnit === "F") {
                temperature = (temperature * 9 / 5) + 32;
            }

            // Update temperature text with the chosen unit
            const temperatureText = `${temperature.toFixed(1)}°${this.temperatureUnit}`;
            this.temperatureLabel.set_text(temperatureText);

            // Set color based on temperature if dynamic color is enabled, else set default color
            if (this.dynamicColorEnabled) {
                this.updateLabelColor(temperature);
            } else {
                this.temperatureLabel.set_style(`color: #ffffff; font-size: ${this.fontSizeTemperature}px;`);
            }

        } catch (e) {
            this.temperatureLabel.set_text("Error");
            global.logError(`Error in updateTemperature: ${e.message}`);
        }

        // Reset and set up the interval timeout
        if (this._timeout) Mainloop.source_remove(this._timeout);
        this._timeout = Mainloop.timeout_add_seconds(this.updateInterval, () => this.updateTemperature());
    },

    updateLabelColor: function (temperature) {
        // Define min and max temperature thresholds based on the unit
        let minTemp = 20, maxTemp = 90;

        // Convert min and max temperature from degree Celsius to degree Fahrenheit
        if (this.temperatureUnit === "F") {
            minTemp = (minTemp * 9 / 5) + 32;
            maxTemp = (maxTemp * 9 / 5) + 32;
        }

        // Calculate color based on temperature
        temperature = Math.min(maxTemp, Math.max(minTemp, temperature));
        const ratio = (temperature - minTemp) / (maxTemp - minTemp);
        let color = `rgb(${Math.floor(ratio * 255)}, ${Math.floor((1 - ratio) * 255)}, 0)`;

        // Set the color
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
        if (this._timeout) Mainloop.source_remove(this._timeout);
        if (this.label) this.box.remove_child(this.label);
        if (this.temperatureLabel) this.box.remove_child(this.temperatureLabel);

        this.label = this.temperatureLabel = this._timeout = null;
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
