const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;

const UUID = "daypercentagebot@FlyingSaturn";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.metadata = metadata;

    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "icon-size", "iconSize", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "decoration", "decoration", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "font-size-label", "fontSizeLabel", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "show-sun-and-moon", "showSunAndMoon", this._onSettingsChanged.bind(this));

    this.setHeader(_("Day percentage"));
    this._initUI();
    this._update();
  }

  _initUI() {
    this.window = new St.Bin();
    this.container = new Clutter.Actor();
    this.text = new St.Label();
    this.text.set_text("... %");
    this.text.style = `font-size: ${this.fontSizeLabel}px; text-align: center;`;

    this.metadata["prevent-decorations"] = !this.decoration;
    this._updateDecoration();

    this._createIcons();

    this.container.add_actor(this.text);
    this.container.add_actor(this.sunIcon);
    this.container.add_actor(this.moonIcon);
    this.window.add_actor(this.container);
    this.setContent(this.window);
  }

  _update() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    this._updateContent();

    // update every second
    this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
  }

  _onSettingsChanged() {
    this.sunIcon.destroy();
    this.moonIcon.destroy();

    this.metadata["prevent-decorations"] = !this.decoration;
    this._updateDecoration();
    this.text.set_style(`font-size: ${this.fontSizeLabel}px; text-align: center;`);

    this._createIcons();

    this.container.add_actor(this.sunIcon);
    this.container.add_actor(this.moonIcon);

    this._updateContent();
  }

  _createIcons() {
    const iconSize = this.iconSize;
    const deskletPath = this.metadata.path;

    try {
      this.sunIcon = this._getImageAtScale(`${deskletPath}/images/sun.svg`, iconSize, iconSize);
      this.moonIcon = this._getImageAtScale(`${deskletPath}/images/moon.svg`, iconSize, iconSize);
    } catch (e) {
      global.logError(`[${UUID}] Error loading icons: ${e}`);
      this.sunIcon = new St.Label({ text: "S" });
      this.moonIcon = new St.Label({ text: "M" });
    }

    this.sunIcon.set_pivot_point(0.5, 0.5);
    this.moonIcon.set_pivot_point(0.5, 0.5);
  }

  _updateContent() {
    const dayPercent = this._calcPercent();
    this.text.set_text(dayPercent.toFixed(1) + " %");

    if (!this.showSunAndMoon) {
      this.sunIcon.visible = false;
      this.moonIcon.visible = false;
      const containerHeight = this.text.get_height();
      const containerWidth = this.text.get_width();
      this.window.set_size(containerWidth, containerHeight);
      this.container.set_size(containerWidth, containerHeight);
      this.text.set_position(0, 0);
      return;
    }

    const now = new Date();
    const hour = now.getHours();

    const iconSize = this.iconSize;
    const radius = this.iconSize * 1.5;
    const containerWidth = radius * 2 + iconSize;
    const containerHeight = radius + iconSize * 1.5;

    this.window.set_size(containerWidth, containerHeight);
    this.container.set_size(containerWidth, containerHeight);

    const centerX = this.window.get_width() / 2;
    const centerY = this.window.get_height() - this.text.get_height() - iconSize / 2;

    const angle = Math.PI * (dayPercent / 100.0);
    const iconX = centerX - radius * Math.cos(angle);
    const iconY = centerY - radius * Math.sin(angle);

    const isDay = hour >= 6 && hour < 18;
    this.sunIcon.visible = isDay;
    this.moonIcon.visible = !isDay;
    const currentIcon = isDay ? this.sunIcon : this.moonIcon;

    const iconWidth = currentIcon.get_width();
    const iconHeight = currentIcon.get_height();
    const textWidth = this.text.get_width();
    currentIcon.set_position(iconX - iconWidth / 2, iconY - iconHeight / 2);
    this.text.set_position(centerX - textWidth / 2, this.window.get_height() - this.text.get_height() - iconSize / 2);
  }

  _calcPercent() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const secondsPassed = (now.getTime() - startOfDay.getTime()) / 1000;
    const totalSecondsInDay = 24 * 60 * 60;
    return (secondsPassed / totalSecondsInDay) * 100;
  }

  _createActorFromPixbuf(pixBuf) {
    const pixelFormat = pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
    const image = new Clutter.Image();
    image.set_data(pixBuf.get_pixels(), pixelFormat, pixBuf.get_width(), pixBuf.get_height(), pixBuf.get_rowstride());

    return new Clutter.Actor({
      content: image,
      width: pixBuf.get_width(),
      height: pixBuf.get_height(),
    });
  }

  _getImageAtScale(imageFilePath, requestedWidth, requestedHeight) {
    const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFilePath, requestedWidth, requestedHeight);
    return this._createActorFromPixbuf(pixBuf);
  }

  on_desklet_removed() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
    this.container.destroy();
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
