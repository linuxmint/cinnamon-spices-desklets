const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const UUID = "adventCandles@KopfdesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Advent Candles"));

    this._candles = 0;
    this._animationTimeoutId = null;
    this._refreshTimeoutId = null;
    this._isReloading = false;

    // Default settings values
    this.deskletScale = 1;
    this.animationSpeed = 300;

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-scale", "deskletScale", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "animation-speed", "animationSpeed", this._onSettingsChanged);
  }

  on_desklet_added_to_desktop() {
    this._candles = this._getAdventCandlesNumber();
    this._loadImage();
    if (this._candles > 0) {
      this._startAnimation();
    }
    this._startUpdateCandleNumberLoop();
  }

  on_desklet_removed() {
    this._stopAnimation();
    this._stopUpdateCandleNumberLoop();
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _getAdventCandlesNumber() {
    const today = new Date();
    const year = today.getFullYear();
    const christmas = new Date(year, 11, 25);

    // Get the day of the week (1-7, where Monday is 1 and Sunday is 7)
    const dayOfWeek = christmas.getDay() || 7;

    // Advent 1 is always 21 days plus the offset to the previous Sunday
    const daysToSubtract = dayOfWeek + 21;

    const firstAdvent = new Date(christmas);
    firstAdvent.setDate(christmas.getDate() - daysToSubtract);

    // Define the start of the next year
    const newYear = new Date(year + 1, 0, 1);

    // If today is already in the next year, no candles should be lit
    if (today >= newYear) return 0;

    let candles = 0;

    // Loop through the four Sundays of Advent
    for (let i = 0; i < 4; i++) {
      // Calculate the date of each Advent Sunday
      const adventSunday = new Date(firstAdvent);
      adventSunday.setDate(firstAdvent.getDate() + i * 7);

      // Check if today is on or after the Advent Sunday
      // Increment the candle count for each Advent Sunday that has passed
      if (adventSunday.getDay() === 0 && today >= adventSunday) {
        candles++;
      }
    }

    return candles;
  }

  _startUpdateCandleNumberLoop() {
    this._stopUpdateCandleNumberLoop();
    this._refreshTimeoutId = Mainloop.timeout_add_seconds(60, () => {
      this._updateCandlesState();
      return true;
    });
  }

  _stopUpdateCandleNumberLoop() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
  }

  _updateCandlesState() {
    const newCandles = this._getAdventCandlesNumber();
    if (this._candles !== newCandles) {
      this._candles = newCandles;
      this._loadImage();

      if (this._candles === 0) {
        this._stopAnimation();
      } else if (!this._animationTimeoutId) {
        this._startAnimation();
      }
    }
  }

  _loadImage() {
    const deskletPath = this.metadata.path;
    const imageFolder = deskletPath + "/images/";

    if (this._candles === 0) {
      const noCandlesImagePath = imageFolder + "no-candles.svg";
      const noCandlesImage = this._getImageAtScale(noCandlesImagePath, 350 * this.deskletScale, 198 * this.deskletScale);
      this.setContent(noCandlesImage);
      return;
    }

    const imageFolderCandles = imageFolder + this._candles + "-candle/";

    // Randomly select a candle image
    if (!this._lastRandomNumber) this._lastRandomNumber = 0;
    let randomNumber;
    do randomNumber = Math.floor(Math.random() * 3) + 1;
    while (randomNumber === this._lastRandomNumber);
    this._lastRandomNumber = randomNumber;

    // Load the candle image
    const imagePath = imageFolderCandles + "frame-" + randomNumber + ".svg";
    this.setContent(this._getImageAtScale(imagePath, 350 * this.deskletScale, 198 * this.deskletScale));
  }

  _onSettingsChanged() {
    this._loadImage();
    if (this._candles > 0) {
      this._startAnimation();
    }
  }

  _startAnimation() {
    this._stopAnimation();
    if (this._candles === 0) return;

    this._animationTimeoutId = Mainloop.timeout_add(this.animationSpeed, () => {
      this._loadImage();
      return true;
    });
  }

  _stopAnimation() {
    if (this._animationTimeoutId) {
      Mainloop.source_remove(this._animationTimeoutId);
      this._animationTimeoutId = null;
    }
  }

  _getImageAtScale(imageFileName, width, height) {
    const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, width, height);
    const image = new Clutter.Image();
    image.set_data(pixBuf.get_pixels(), pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888, width, height, pixBuf.get_rowstride());

    const actor = new Clutter.Actor({ width, height });
    actor.set_content(image);
    return actor;
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
