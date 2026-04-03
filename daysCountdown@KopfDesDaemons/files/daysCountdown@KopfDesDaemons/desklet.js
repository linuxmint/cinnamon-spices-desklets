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

    this._mainContainer = null;
    this._textLabel = null;
    this._daysLabel = null;
    this._refreshTimeoutId = null;
    this._isReloading = false;

    // Default settings
    this.labelText = "";
    this.fontSizeLabel = 12;
    this.fontSizeCountdown = 36;
    this.colorCountdown = "rgb(255, 255, 255)";
    this.colorLabel = "rgb(98, 160, 234)";
    this.countdownDate = { d: 1, m: 1, y: 1 };
    this.refreshInterval = "only-after-starting";
    this.scaleSize = 1;
    this.hideDecorations = false;

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "label-text", "labelText", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "countdown-date", "countdownDate", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "font-size-label", "fontSizeLabel", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "font-size-countdown", "fontSizeCountdown", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-label", "colorLabel", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-countdown", "colorCountdown", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "refresh-interval", "refreshInterval", this._setRefreshCountdown);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._updateUI);
    this.settings.bindProperty(Settings.BindingDirection.IN, "hide-decorations", "hideDecorations", this._onDecorationChanged.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._onDecorationChanged();
    this._setupLayout();
    this._updateUI();
    this._setRefreshCountdown();
  }

  on_desklet_removed() {
    this._removeRefreshTimeout();
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _onDecorationChanged() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _setDefaultCountdown() {
    if (this.countdownDate.d === 1 && this.countdownDate.m === 1 && this.countdownDate.y === 1) {
      this.countdownDate = { d: 1, m: 1, y: new Date().getFullYear() + 1 };
      this.labelText = _("New Year %f Countdown").format(this.countdownDate.y.toString());
    }
  }

  _setupLayout() {
    this._mainContainer = new St.BoxLayout({ vertical: true });
    this._textLabel = new St.Label();
    this._daysLabel = new St.Label();

    this._mainContainer.add_child(this._textLabel);
    this._mainContainer.add_child(this._daysLabel);
    this.setContent(this._mainContainer);
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
    this._setDefaultCountdown();
    this._textLabel.set_text(this.labelText);
    const fontSize = size => (size * this.scaleSize) / 10 + "em";
    this._textLabel.set_style(`font-size: ${fontSize(this.fontSizeLabel)}; color: ${this.colorLabel};`);
    this._daysLabel.set_text(this._getDaysString());
    this._daysLabel.set_style(`font-size: ${fontSize(this.fontSizeCountdown)}; color: ${this.colorCountdown};`);
  }

  _setRefreshCountdown() {
    this._removeRefreshTimeout();
    if (this.refreshInterval === "only-after-starting") return;

    this._refreshTimeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
      this._daysLabel.set_text(this._getDaysString());
      return true;
    });
  }

  _removeRefreshTimeout() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
