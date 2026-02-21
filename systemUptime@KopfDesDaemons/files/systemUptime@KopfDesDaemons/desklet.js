const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const ByteArray = imports.byteArray;

const UUID = "systemUptime@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("System Uptime"));

    this._timeout = null;
    this.desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
    this._clockSettingsId = this.desktop_settings.connect("changed::clock-use-24h", () => this.updateValues());

    // Default settings values
    this.scaleSize = 1;
    this.labelColor = "rgb(51, 209, 122)";
    this.showStartDate = false;
    this.showUptimeInDays = false;
    this.hideDecorations = true;

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-start-date", "showStartDate", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-uptime-in-days", "showUptimeInDays", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this.updateDecoration.bind(this));
  }

  on_desklet_added_to_desktop() {
    this.updateDecoration();
    this.setupLayout();
    this.updateValues();
  }

  on_desklet_removed() {
    this.settings.finalize();
    if (this._timeout) Mainloop.source_remove(this._timeout);
    if (this._clockSettingsId) {
      this.desktop_settings.disconnect(this._clockSettingsId);
      this._clockSettingsId = 0;
    }
  }

  setupLayout() {
    const valueStyle = `font-size: ${1.5 * this.scaleSize}em;`;
    const labelStyle = `${valueStyle} color: ${this.labelColor};`;
    const iconStyle = `width: ${3 * this.scaleSize}em; height: ${3 * this.scaleSize}em;`;

    // Create labels for uptime
    const uptimeLabel = new St.Label({ text: _("Uptime:") + " ", style: labelStyle });
    this.uptimeValue = new St.Label({ text: _("Loading..."), style: valueStyle });

    const uptimeRow = new St.BoxLayout();
    uptimeRow.add_child(uptimeLabel);
    uptimeRow.add_child(this.uptimeValue);

    // Create labels for startup time
    const startTimeLabel = new St.Label({ text: _("Start time:") + " ", style: labelStyle });
    this.startupValue = new St.Label({ text: _("Loading..."), style: valueStyle });

    const startupRow = new St.BoxLayout();
    startupRow.add_child(startTimeLabel);
    startupRow.add_child(this.startupValue);

    // Combine all into the main container
    const labelBox = new St.BoxLayout({ vertical: true, y_align: St.Align.MIDDLE });
    labelBox.set_style("margin-left: 0.5em;");
    labelBox.add_child(startupRow);
    labelBox.add_child(uptimeRow);

    const clockIcon = new St.Icon({
      gicon: Gio.icon_new_for_string(`${this.metadata.path}/icons/clock.svg`),
      icon_size: 5 * 16 * this.scaleSize,
      style: iconStyle,
    });
    const iconBox = new St.Bin({ child: clockIcon, style: iconStyle });

    const container = new St.BoxLayout({ y_align: St.Align.MIDDLE });
    container.add_child(iconBox);
    container.add_child(labelBox);

    this.setContent(container);
  }

  updateUptime() {
    let uptimeInSeconds = 0;
    try {
      // Read uptime in seconds from /proc/uptime
      const [success, contents] = GLib.file_get_contents("/proc/uptime");
      if (!success) throw new Error("Could not get system uptime.");
      uptimeInSeconds = parseFloat(ByteArray.toString(contents).split(" ")[0]);

      if (this.showUptimeInDays) {
        // Convert uptime to days, hours, and minutes
        const days = Math.floor(uptimeInSeconds / 86400);
        const hours = Math.floor((uptimeInSeconds % 86400) / 3600);
        const minutes = Math.floor(((uptimeInSeconds % 86400) % 3600) / 60);

        this.uptimeValue.set_text(`${days} ${_("days")} ${hours} ${_("hrs")} ${minutes} ${_("min")}`);
      } else {
        // Hours can be more than 24
        const hours = Math.floor(uptimeInSeconds / 3600);
        const minutes = Math.floor((uptimeInSeconds % 3600) / 60);

        this.uptimeValue.set_text(`${hours} ${_("hours")} ${minutes} ${_("minutes")}`);
      }
    } catch (error) {
      this.uptimeValue.set_text(_("Error"));
      global.logError(`${UUID} Error: ${error.message}`);
    }
  }

  updateStartupTime() {
    try {
      // Read startup time from /proc/stat (btime)
      const [success, contents] = GLib.file_get_contents("/proc/stat");
      if (!success) throw new Error("Could not get system startup time.");

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

      const dt = GLib.DateTime.new_from_unix_local(btime);
      const use24h = this.desktop_settings.get_boolean("clock-use-24h");
      const timeFormat = use24h ? "%H:%M" : "%-l:%M %p";

      if (this.showStartDate) {
        // Show date and time
        this.startupValue.set_text(dt.format("%x") + ", " + dt.format(timeFormat));
      } else {
        // Show only time
        this.startupValue.set_text(dt.format(timeFormat));
      }
    } catch (error) {
      this.startupValue.set_text(_("Error"));
      global.logError(`${UUID}: ${error.message}`);
    }
  }

  updateValues() {
    this.updateUptime();
    this.updateStartupTime();

    if (this._timeout) Mainloop.source_remove(this._timeout);
    this._timeout = Mainloop.timeout_add_seconds(60, () => this.updateValues());
  }

  onSettingsChanged() {
    this.setupLayout();
    this.updateValues();
  }

  updateDecoration() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
