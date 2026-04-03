const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;

const UUID = "daysCountdown@KopfDesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Days Countdown"));

    this.mainContainer = null;
    this.textLabel = null;
    this.daysLabel = null;
    this.refreshTimeoutId = null;

    // Default settings
    this.labelText = "New Year 2025 Countdown";
    this.fontSizeLabel = 12;
    this.fontSizeCountdown = 36;
    this.colorCountdown = "rgb(255, 255, 255)";
    this.colorLabel = "rgb(98, 160, 234)";
    this.countdownDate = { d: 31, m: 12, y: 2025 };
    this.refreshInterval = "only-after-starting";

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "labelText", "labelText", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "countdownDate", "countdownDate", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeLabel", "fontSizeLabel", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "fontSizeCountdown", "fontSizeCountdown", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "colorCountdown", "colorCountdown", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refreshInterval", "refreshInterval", this._setRefreshCountdown);
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
    this._updateUI();
    this._setRefreshCountdown();
  }

  on_desklet_removed() {
    this._removeRefreshTimeout();
  }

  _setupLayout() {
    this.mainContainer = new St.BoxLayout({ vertical: true });
    this.textLabel = new St.Label();
    this.daysLabel = new St.Label();

    this.mainContainer.add_child(this.textLabel);
    this.mainContainer.add_child(this.daysLabel);
    this.setContent(this.mainContainer);
  }

  _calcDays() {
    if (!this.countdownDate) return 0;
    const then = new Date(this.countdownDate.y, this.countdownDate.m - 1, this.countdownDate.d);
    return Math.ceil((then - new Date()) / (1000 * 60 * 60 * 24));
  }

  _getDaysString() {
    return _("%f days").format(this._calcDays().toString());
  }

  _updateUI() {
    this.textLabel.set_text(this.labelText);
    this.textLabel.set_style(`font-size: ${this.fontSizeLabel}px; color: ${this.colorLabel};`);
    this.daysLabel.set_text(this._getDaysString());
    this.daysLabel.set_style(`font-size: ${this.fontSizeCountdown}px; color: ${this.colorCountdown};`);
  }

  _setRefreshCountdown() {
    this._removeRefreshTimeout();
    if (this.refreshInterval === "only-after-starting") return;

    this.refreshTimeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
      this.daysLabel.set_text(this._getDaysString());
      return true;
    });
  }

  _removeRefreshTimeout() {
    if (this.refreshTimeoutId) {
      Mainloop.source_remove(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
