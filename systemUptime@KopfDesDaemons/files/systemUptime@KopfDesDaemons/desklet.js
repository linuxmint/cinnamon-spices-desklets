const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;

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

    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

    // Bind settings properties
    settings.bindProperty(Settings.BindingDirection.IN, "fontSize", "fontSize", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "showStartDate", "showStartDate", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "showUptimeInDays", "showUptimeInDays", this.onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "hideDecorations", "hideDecorations", this.updateDecoration.bind(this));

    this._timeout = null;

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

    Mainloop.idle_add(() => {
      const computedHeight = contentBox.get_height();

      // Create clock icon
      const file = Gio.File.new_for_path(`${this.metadata.path}/clock.svg`);
      const fileIcon = new Gio.FileIcon({ file: file });
      const clockIcon = new St.Icon({ gicon: fileIcon, icon_size: computedHeight, icon_type: St.IconType.FULLCOLOR });

      this.container.insert_child_below(clockIcon, contentBox);

      return false;
    });

    this.setContent(this.container);
  }

  updateUptime() {
    let uptimeInSeconds = 0;
    try {
      const [result, out] = GLib.spawn_command_line_sync("awk '{print $1}' /proc/uptime");
      if (!result || !out) throw new Error("Could not get system uptime.");
      uptimeInSeconds = parseFloat(out.toString().trim());

      if (this.showUptimeInDays) {
        const days = Math.floor(uptimeInSeconds / 86400);
        const hours = Math.floor((uptimeInSeconds % 86400) / 3600);
        const minutes = Math.floor(((uptimeInSeconds % 86400) % 3600) / 60);

        this.uptimeValue.set_text(`${days} ${_("days")} ${hours} ${_("hrs")} ${minutes} ${_("min")}`);
      } else {
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
      const [result, out] = GLib.spawn_command_line_sync("uptime -s");
      if (!result || !out) throw new Error("Could not get system startup time.");

      const dateTimeStr = out.toString().trim();
      const [dateStr, timeStr] = dateTimeStr.split(" ");
      const [year, month, day] = dateStr.split("-");
      const [hour, minute, second] = timeStr.split(":");

      const dt = GLib.DateTime.new_local(parseInt(year), parseInt(month), parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));

      if (this.showStartDate) {
        this.startupValue.set_text(dt.format("%x") + ", " + dt.format("%X"));
      } else {
        this.startupValue.set_text(dt.format("%X"));
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
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
