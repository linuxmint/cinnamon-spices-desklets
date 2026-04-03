const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;

const UUID = "systemTemperature@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("System Temperature"));

    this._mainContainer = null;
    this._textLabel = null;
    this._refreshTimeoutId = null;
    this._temperatureLabel = null;

    // Default settings
    this.labelText = "CPU temperature:";
    this.tempFilePath = "/sys/class/thermal/thermal_zone2/temp";
    this.textLabelFontSize = 12;
    this.temperatureLabelFontSize = 20;
    this.dynamicColorEnabled = true;
    this.temperatureUnit = "C";
    this.updateInterval = 1;

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "tempFilePath", "tempFilePath", this._on_settings_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "labelText", "labelText", this._on_settings_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "temperatureUnit", "temperatureUnit", this._on_settings_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "updateInterval", "updateInterval", this._setRefreshTimeout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeLabel", "textLabelFontSize", this._on_settings_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeTemperature", "temperatureLabelFontSize", this._on_settings_changed);
    this.settings.bindProperty(Settings.BindingDirection.IN, "dynamicColorEnabled", "dynamicColorEnabled", this._on_settings_changed);
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
    this._updateTemperature();
    this._setRefreshTimeout();
  }

  on_desklet_removed() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
  }

  _setupLayout() {
    // Text label
    this._textLabel = new St.Label({ text: this.labelText });
    this._textLabel.set_style(`font-size: ${this.textLabelFontSize}px;`);

    // Temperature label
    this._temperatureLabel = new St.Label({ text: "Loading..." });
    this._temperatureLabel.set_style(`font-size: ${this.temperatureLabelFontSize}px; font-weight: bold;`);

    // Set up the layout
    this._mainContainer = new St.BoxLayout({ vertical: true });
    this._mainContainer.add_child(this._textLabel);
    this._mainContainer.add_child(this._temperatureLabel);

    this.setContent(this._mainContainer);
  }

  _setRefreshTimeout() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }

    this._refreshTimeoutId = Mainloop.timeout_add_seconds(this.updateInterval, () => {
      this._updateTemperature();
      return true;
    });
  }

  getFileContent(path) {
    return new Promise((resolve, reject) => {
      const file = Gio.File.new_for_path(path);
      file.load_contents_async(null, (obj, res) => {
        try {
          const [success, content] = obj.load_contents_finish(res);
          if (success) {
            resolve(content);
          } else {
            reject(new Error(`Could not read ${path}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async _updateTemperature() {
    try {
      // Get CPU temperature
      const fileContent = await this.getFileContent(this.tempFilePath);

      // Convert temperature from millidegree Celsius to degree Celsius
      let temperature = parseFloat(fileContent.toString().trim()) / 1000.0;

      // Convert to Fahrenheit when the user has selected that unit
      if (this.temperatureUnit === "F") {
        temperature = (temperature * 9) / 5 + 32;
      }

      // Update temperature text with the chosen unit
      const temperatureText = `${temperature.toFixed(1)}°${this.temperatureUnit}`;
      this._temperatureLabel.set_text(temperatureText);

      // Set color based on temperature if dynamic color is enabled, else set default color
      if (this.dynamicColorEnabled) {
        this._updateLabelColor(temperature);
      } else {
        this._temperatureLabel.set_style(`color: #ffffff; font-size: ${this.temperatureLabelFontSize}px; font-weight: bold;`);
      }
    } catch (e) {
      this._temperatureLabel.set_text("Error");
      global.logError(`${UUID}: Error while reading temperature: ${e.message}`);
    }
  }

  _updateLabelColor(temperature) {
    // Define min and max temperature thresholds based on the unit
    let minTemp = 20;
    let maxTemp = 90;

    // Convert min and max temperature from degree Celsius to degree Fahrenheit
    if (this.temperatureUnit === "F") {
      minTemp = (minTemp * 9) / 5 + 32;
      maxTemp = (maxTemp * 9) / 5 + 32;
    }

    // Calculate color based on temperature
    temperature = Math.min(maxTemp, Math.max(minTemp, temperature));
    const ratio = (temperature - minTemp) / (maxTemp - minTemp);
    const colorString = `rgb(${Math.floor(ratio * 255)}, ${Math.floor((1 - ratio) * 255)}, 0)`;

    // Set the color
    this._temperatureLabel.set_style(`color: ${colorString}; font-size: ${this.temperatureLabelFontSize}px; font-weight: bold;`);
  }

  _on_settings_changed() {
    this._textLabel.set_text(this.labelText);
    this._textLabel.set_style(`font-size: ${this.textLabelFontSize}px;`);
    this._temperatureLabel.set_style(`font-size: ${this.temperatureLabelFontSize}px;`);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
