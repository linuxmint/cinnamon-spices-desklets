const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const ByteArray = imports.byteArray;

const UUID = "systemUptime@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

function getFileContents(path) {
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(path);
    file.load_contents_async(null, (obj, res) => {
      try {
        const [success, contents] = obj.load_contents_finish(res);
        if (success) {
          resolve(contents);
        } else {
          reject(new Error(`Could not read ${path}`));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("System Uptime"));

    this._refreshTimeoutId = null;
    this._isReloading = false;
    this._startTimeLabel = null;
    this._startupValue = null;
    this._uptimeLabel = null;
    this._uptimeValue = null;
    this._clockIcon = null;
    this._iconBox = null;
    this._currentUptimeText = "";
    this._currentStartupText = "";

    // Listen for changes in the system clock format (12h/24h)
    this._desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
    this._clockSettingsId = this._desktop_settings.connect("changed::clock-use-24h", () => this._updateValues());

    // Default settings values
    this.scaleSize = 1;
    this.labelColor = "rgb(51, 209, 122)";
    this.showStartDate = false;
    this.showUptimeInDays = false;
    this.hideDecorations = true;
    this.showIcon = true;

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._setStyles);
    this.settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this._setStyles);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-start-date", "showStartDate", this._updateValues);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-uptime-in-days", "showUptimeInDays", this._updateValues);
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-icon", "showIcon", this._onShowIconChanged);
  }

  async on_desklet_added_to_desktop() {
    this._onDecorationChanged();
    await this._updateValues();
    this._setupLayout();
    this._setStyles();
    this._setRefreshTimeout();
  }

  on_desklet_removed() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
    if (this._clockSettingsId) {
      this._desktop_settings.disconnect(this._clockSettingsId);
      this._clockSettingsId = 0;
    }
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _setupLayout() {
    // Create labels for uptime
    this._uptimeLabel = new St.Label({ text: _("Uptime:") + " " });
    this._uptimeValue = new St.Label({ text: this._currentUptimeText });

    const uptimeRow = new St.BoxLayout();
    uptimeRow.add_child(this._uptimeLabel);
    uptimeRow.add_child(this._uptimeValue);

    // Create labels for startup time
    this._startTimeLabel = new St.Label({ text: _("Start time:") + " " });
    this._startupValue = new St.Label({ text: this._currentStartupText });

    const startupRow = new St.BoxLayout();
    startupRow.add_child(this._startTimeLabel);
    startupRow.add_child(this._startupValue);

    // Combine all into the main container
    const labelBox = new St.BoxLayout({ vertical: true, y_align: St.Align.MIDDLE });
    labelBox.set_style("margin-left: 0.5em;");
    labelBox.add_child(startupRow);
    labelBox.add_child(uptimeRow);

    const container = new St.BoxLayout({ y_align: St.Align.MIDDLE });

    if (this.showIcon) {
      this._clockIcon = new St.Icon({
        gicon: Gio.icon_new_for_string(`${this.metadata.path}/icons/clock.svg`),
        icon_size: 5 * 16 * this.scaleSize,
      });
      this._iconBox = new St.Bin({ child: this._clockIcon });
      container.add_child(this._iconBox);
    }

    container.add_child(labelBox);

    this.setContent(container);
  }

  _setStyles() {
    const valueStyle = `font-size: ${1.5 * this.scaleSize}em;`;
    const labelStyle = `${valueStyle} color: ${this.labelColor};`;
    const iconStyle = `width: ${3 * this.scaleSize}em; height: ${3 * this.scaleSize}em;`;

    // Uptime
    this._uptimeLabel.set_style(labelStyle);
    this._startTimeLabel.set_style(labelStyle);

    // Values
    this._uptimeValue.set_style(valueStyle);
    this._startupValue.set_style(valueStyle);

    // Icon
    if (this.showIcon && this._clockIcon && this._iconBox) {
      this._clockIcon.set_style(iconStyle);
      this._iconBox.set_style(iconStyle);
    }
  }

  async _fetchUptimeText() {
    try {
      // Read uptime in seconds from /proc/uptime
      const contents = await getFileContents("/proc/uptime");
      const uptimeInSeconds = parseFloat(ByteArray.toString(contents).split(" ")[0]);

      if (this.showUptimeInDays) {
        // Convert uptime to days, hours, and minutes
        const days = Math.floor(uptimeInSeconds / 86400);
        const hours = Math.floor((uptimeInSeconds % 86400) / 3600);
        const minutes = Math.floor(((uptimeInSeconds % 86400) % 3600) / 60);

        return `${days} ${_("days")} ${hours} ${_("hrs")} ${minutes} ${_("min")}`;
      } else {
        // Hours can be more than 24
        const hours = Math.floor(uptimeInSeconds / 3600);
        const minutes = Math.floor((uptimeInSeconds % 3600) / 60);

        return `${hours} ${_("hours")} ${minutes} ${_("minutes")}`;
      }
    } catch (error) {
      global.logError(`${UUID} Error: ${error.message}`);
      return _("Error");
    }
  }

  async _fetchStartupTimeText() {
    try {
      // Read startup time from /proc/stat (btime)
      const contents = await getFileContents("/proc/stat");

      // Search for the line starting with "btime " and parse the timestamp
      const lines = ByteArray.toString(contents).split("\n");
      let btime = 0;
      for (const line of lines) {
        if (line.startsWith("btime ")) {
          btime = parseInt(line.split(/\s+/)[1]);
          break;
        }
      }
      if (!btime) throw new Error("Could not get system startup time.");

      const dateTime = GLib.DateTime.new_from_unix_local(btime);
      const use24h = this._desktop_settings.get_boolean("clock-use-24h");
      const timeFormat = use24h ? "%H:%M" : "%-l:%M %p";

      if (this.showStartDate) {
        // Show date and time
        return dateTime.format("%x") + ", " + dateTime.format(timeFormat);
      } else {
        // Show only time
        return dateTime.format(timeFormat);
      }
    } catch (error) {
      global.logError(`${UUID}: ${error.message}`);
      return _("Error");
    }
  }

  async _updateUptime() {
    this._currentUptimeText = await this._fetchUptimeText();
    if (this._uptimeValue) {
      this._uptimeValue.set_text(this._currentUptimeText);
    }
  }

  async _updateStartupTime() {
    this._currentStartupText = await this._fetchStartupTimeText();
    if (this._startupValue) {
      this._startupValue.set_text(this._currentStartupText);
    }
  }

  async _updateValues() {
    await this._updateStartupTime();
    await this._updateUptime();
  }

  _setRefreshTimeout() {
    this._refreshTimeoutId = Mainloop.timeout_add_seconds(60, () => {
      this._updateValues();
      return true;
    });
  }

  _onDecorationChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _onShowIconChanged() {
    this._setupLayout();
    this._setStyles();
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
