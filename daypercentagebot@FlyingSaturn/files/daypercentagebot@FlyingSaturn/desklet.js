const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;

const UUID = "daypercentagebot@FlyingSaturn";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Day Percentage"));

    this._deskletHeight = 100;
    this._deskletWidth = 300;
    this._isReloading = true;
    this._iconSize = 45;

    // Default settings
    this.scaleSize = 1;
    this.decoration = true;
    this.showSunAndMoon = true;

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "decoration", "decoration", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "show-sun-and-moon", "showSunAndMoon", this._onSettingsChanged.bind(this));
  }

  on_desklet_added_to_desktop() {
    this._initUI();
    this.timeout = Mainloop.timeout_add_seconds(1, this._update.bind(this));
  }

  on_desklet_removed() {
    if (this.timeout) Mainloop.source_remove(this.timeout);
    this.container.destroy();

    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _initUI() {
    this.container = new St.BoxLayout({ vertical: true });
    this.iconContainer = new St.Widget({ x_expand: true, y_expand: true });
    this.text = new St.Label();
    this.text.style = `font-size: ${16 * this.scaleSize}px; text-align: center;`;

    this.metadata["prevent-decorations"] = !this.decoration;
    this._updateDecoration();

    this._createIcons();

    this.container.add_child(this.iconContainer);
    this.container.add_child(this.text);
    this._updateWindowSize();
    this._updateContent();
    this.setContent(this.container);
  }

  _updateWindowSize() {
    if (this.showSunAndMoon) {
      this.iconContainer.show();
      this.container.set_size(this._deskletWidth * this.scaleSize, this._deskletHeight * this.scaleSize);
    } else {
      this.iconContainer.hide();
      // Set the container size to auto when sun and moon icons are hidden
      this.container.set_width(-1);
      this.container.set_height(-1);
    }
  }

  // update every second
  _update() {
    this._updateContent();
    return true;
  }

  _onSettingsChanged() {
    this.iconContainer.destroy_all_children();

    this.metadata["prevent-decorations"] = !this.decoration;
    this._updateDecoration();
    this.text.set_style(`font-size: ${16 * this.scaleSize}px; text-align: center;`);

    this._createIcons();
    this._updateWindowSize();
    this._updateContent();
  }

  _createIcons() {
    const iconSize = this._iconSize * this.scaleSize;
    const deskletPath = this.metadata.path;

    this.sunIcon = new St.Icon({ gicon: Gio.icon_new_for_string(`${deskletPath}/images/sun.svg`), icon_size: iconSize });
    this.moonIcon = new St.Icon({ gicon: Gio.icon_new_for_string(`${deskletPath}/images/moon.svg`), icon_size: iconSize });
    this.iconContainer.add_child(this.sunIcon);
    this.iconContainer.add_child(this.moonIcon);
  }

  _updateContent() {
    const dayPercent = this._calcPercent();
    this.text.set_text(dayPercent.toFixed(1) + " %");

    if (!this.showSunAndMoon) return;

    const iconSize = this._iconSize * this.scaleSize;
    const textHeight = this.text.get_height();

    const radiusY = this._deskletHeight * this.scaleSize - iconSize - textHeight;
    const radiusX = (this._deskletWidth * this.scaleSize) / 2 - iconSize / 2;

    const centerX = (this._deskletWidth * this.scaleSize) / 2;
    const centerY = this._deskletHeight * this.scaleSize - textHeight - iconSize / 2;

    const angle = Math.PI + (dayPercent / 100.0) * Math.PI;
    const iconX = centerX - iconSize / 2 + radiusX * Math.cos(angle);
    const iconY = centerY - iconSize / 2 + radiusY * Math.sin(angle);

    // Set sun or moon icon based on the time of day
    const hour = new Date().getHours();
    const isDay = hour >= 6 && hour < 18;
    this.sunIcon.visible = isDay;
    this.moonIcon.visible = !isDay;
    const currentIcon = isDay ? this.sunIcon : this.moonIcon;

    currentIcon.set_position(iconX, iconY);
  }

  _calcPercent() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const secondsPassed = (now.getTime() - startOfDay.getTime()) / 1000;
    const totalSecondsInDay = 24 * 60 * 60;
    return (secondsPassed / totalSecondsInDay) * 100;
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
