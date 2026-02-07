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

    // Default settings values
    this.fontSize = 20;
    this.colorLabel = "rgb(51, 209, 122)";

    // Bind settings properties
    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "fontSize", "fontSize", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "showStartDate", "showStartDate", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "showUptimeInDays", "showUptimeInDays", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "hideDecorations", "hideDecorations", this.updateDecoration.bind(this));

    this.desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
    this._clockSettingsId = this.desktop_settings.connect("changed::clock-use-24h", () => this.updateValues());

    this.setHeader(_("System Uptime"));
    this.updateDecoration();
    this.setupLayout();
    this.updateValues();
  }

  setupLayout() {
    // Create labels for uptime
    this.uptimeLabel = new St.Label({ text: _("Uptime:") + " ", style: `font-size: ${this.fontSize}px; color: ${this.colorLabel};` });
    this.uptimeValue = new St.Label({ text: _("Loading..."), style: `font-size: ${this.fontSize}px;` });

    const uptimeRow = new St.BoxLayout();
    uptimeRow.add_child(this.uptimeLabel);
    uptimeRow.add_child(this.uptimeValue);

    // Create labels for startup time
    this.startTimeLabel = new St.Label({ text: _("Start time:") + " ", style: `font-size: ${this.fontSize}px; color: ${this.colorLabel};` });
    this.startupValue = new St.Label({ text: _("Loading..."), style: `font-size: ${this.fontSize}px;` });

    const startupRow = new St.BoxLayout();
    startupRow.add_child(this.startTimeLabel);
    startupRow.add_child(this.startupValue);

    // Combine all into the main container
    const contentBox = new St.BoxLayout({ vertical: true });
    contentBox.set_style("margin-left: 0.5em;");
    contentBox.add_child(startupRow);
    contentBox.add_child(uptimeRow);

    this.container = new St.BoxLayout();
    this.container.add_child(contentBox);

    //  Use idle, because the size of the clock icon depends on the rest of the content.
    Mainloop.idle_add(() => {
      const computedHeight = contentBox.get_height();

      // Create clock icon
      const clockIcon = new St.Icon({
        gicon: Gio.icon_new_for_string(`${this.metadata.path}/clock.svg`),
        icon_size: computedHeight,
      });

      this.container.insert_child_below(clockIcon, contentBox);

      // Don't run this again
      return false;
    });

    this.setContent(this.container);
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
      this.uptimeValue.set_text("Error");
      global.logError(`${UUID}: ${error.message}`);
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
      this.startupValue.set_text("Error");
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

  on_desklet_removed() {
    if (this._timeout) Mainloop.source_remove(this._timeout);
    if (this._clockSettingsId) {
      this.desktop_settings.disconnect(this._clockSettingsId);
      this._clockSettingsId = 0;
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
