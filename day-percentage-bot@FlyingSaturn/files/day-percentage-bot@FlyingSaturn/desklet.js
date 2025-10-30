const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;

const UUID = "day-percentage-bot@FlyingSaturn";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.metadata = metadata;

    this.setHeader(_("Day percentage"));
    this._setupUI();
    this._update();
  }

  _setupUI() {
    this.container = new St.Group();

    this.text = new St.Label();
    this.text.set_text("... %");
    this.text.style = "font-size: 24px; text-align: center;";

    const iconSize = 32;
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

    this.container.add_actor(this.text);
    this.container.add_actor(this.sunIcon);
    this.container.add_actor(this.moonIcon);

    this.setContent(this.container);
  }

  _update() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    const dayPercent = this._calcPercent();
    const now = new Date();
    const hour = now.getHours();

    this.text.set_text(dayPercent.toFixed(1) + " %");

    // Position icon in a semi-circle
    const radius = 80;
    const textWidth = this.text.get_width();
    const textHeight = this.text.get_height();
    const centerX = textWidth / 2;
    const centerY = textHeight / 2;

    // Angle from 180 (left) to 0 (right) degrees
    const angle = Math.PI * (dayPercent / 100.0);

    const iconX = centerX - radius * Math.cos(angle);
    const iconY = centerY - radius * Math.pow(Math.sin(angle), 0.7) + 10 * (1 - Math.sin(angle));

    const isDay = hour >= 6 && hour < 18;
    this.sunIcon.visible = isDay;
    this.moonIcon.visible = !isDay;

    const currentIcon = isDay ? this.sunIcon : this.moonIcon;
    currentIcon.set_position(iconX - currentIcon.get_width() / 2, iconY - currentIcon.get_height() / 2);
    this.text.set_position(0, currentIcon.get_height() / 2);

    // update every second
    this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
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
    this.container.destroy_all_children();
    this.container.destroy();
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
