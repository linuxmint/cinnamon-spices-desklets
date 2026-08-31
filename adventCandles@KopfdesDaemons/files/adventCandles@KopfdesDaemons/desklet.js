const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

const UUID = "adventCandles@KopfdesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Advent Candles"));

    this._candles = -1;
    this._animationTimeoutId = null;
    this._refreshTimeoutId = null;
    this._lastRandomNumber = null;
    this._isReloading = false;
    this._pixbufCache = {};
    this._svgCache = {};

    // Default settings values
    this.deskletScale = 1;
    this.animationEnabled = true;
    this.animationSpeed = 300;
    this.numberOfLitCandles = "automatic";
    this.colorPreset = "red";
    this.candle1Color = "#c01c28";
    this.candle2Color = "#c01c28";
    this.candle3Color = "#c01c28";
    this.candle4Color = "#c01c28";

    // Bind settings properties
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-scale", "deskletScale", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "animation-enabled", "animationEnabled", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "animation-speed", "animationSpeed", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "number-of-lit-candles", "numberOfLitCandles", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "color-preset", "colorPreset", this._onColorPresetChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "candle-1-color", "candle1Color", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "candle-2-color", "candle2Color", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "candle-3-color", "candle3Color", this._onSettingsChanged);
    this.settings.bindProperty(Settings.BindingDirection.IN, "candle-4-color", "candle4Color", this._onSettingsChanged);
  }

  on_desklet_added_to_desktop() {
    this._updateColorVariants();
    this._updateCandleNumber();
    this._setAnimationState();
    this._startUpdateCandleNumberLoop();
  }

  on_desklet_removed() {
    this._stopAnimation();
    this._stopUpdateCandleNumberLoop();
    this._pixbufCache = null;
    this._svgCache = null;
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _getAdventCandlesNumber() {
    if (this.numberOfLitCandles != "automatic") {
      return parseInt(this.numberOfLitCandles);
    }

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
      this._updateCandleNumber();
      return true;
    });
  }

  _stopUpdateCandleNumberLoop() {
    if (this._refreshTimeoutId) {
      Mainloop.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }
  }

  _updateCandleNumber() {
    const newCandles = this._getAdventCandlesNumber();
    if (this._candles !== newCandles) {
      this._candles = newCandles;
      this._loadImage();
      this._setAnimationState();
    }
  }

  _setAnimationState() {
    if (this._candles > 0 && this.animationEnabled) {
      this._startAnimation();
    } else {
      this._stopAnimation();
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
    this._pixbufCache = {};
    this._updateColorVariants();
    this._updateCandleNumber();
    this._loadImage();
    this._setAnimationState();
  }

  _onColorPresetChanged() {
    switch (this.colorPreset) {
      case "red":
        this.candle1Color = "#c01c28";
        this.candle2Color = "#c01c28";
        this.candle3Color = "#c01c28";
        this.candle4Color = "#c01c28";
        break;
      case "traditional":
        this.candle1Color = "#a351c2";
        this.candle2Color = "#a351c2";
        this.candle3Color = "#f58cad";
        this.candle4Color = "#a351c2";
        break;
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

  _updateColorVariants() {
    this._colorVariants = {
      c1: this._generateColorVariants(this.candle1Color || "#c01c28"),
      c2: this._generateColorVariants(this.candle2Color || "#c01c28"),
      c3: this._generateColorVariants(this.candle3Color || "#c01c28"),
      c4: this._generateColorVariants(this.candle4Color || "#c01c28"),
    };
  }

  _generateColorVariants(colorString) {
    const [res, color] = Clutter.Color.from_string(colorString);
    if (!res) {
      // Return the string on error
      return { a: colorString, b: colorString, c: colorString, d: colorString, e: colorString };
    }

    const toHex = (r, g, b) => {
      return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    };

    // Base color
    const a = toHex(color.red, color.green, color.blue);

    // Lighter variant
    const b = toHex(
      Math.min(255, Math.round(color.red + (255 - color.red) * 0.3)),
      Math.min(255, Math.round(color.green + (255 - color.green) * 0.3)),
      Math.min(255, Math.round(color.blue + (255 - color.blue) * 0.3)),
    );

    // Darker variants
    const c = toHex(Math.max(0, Math.round(color.red * 0.9)), Math.max(0, Math.round(color.green * 0.9)), Math.max(0, Math.round(color.blue * 0.9)));
    const d = toHex(Math.max(0, Math.round(color.red * 0.8)), Math.max(0, Math.round(color.green * 0.8)), Math.max(0, Math.round(color.blue * 0.8)));
    const e = toHex(Math.max(0, Math.round(color.red * 0.7)), Math.max(0, Math.round(color.green * 0.7)), Math.max(0, Math.round(color.blue * 0.7)));

    return { a, b, c, d, e };
  }

  _getImageAtScale(imageFileName, width, height) {
    const cacheKey = `${imageFileName}_${width}x${height}`;
    let pixBuf = this._pixbufCache ? this._pixbufCache[cacheKey] : null;

    if (!pixBuf) {
      if (imageFileName.endsWith(".svg")) {
        try {
          let svgString = this._svgCache[imageFileName];
          if (!svgString) {
            const file = Gio.File.new_for_path(imageFileName);
            const [success, contents] = file.load_contents(null);
            if (success) {
              svgString = ByteArray.toString(contents);
              this._svgCache[imageFileName] = svgString;
            }
          }

          if (svgString) {
            const { c1, c2, c3, c4 } = this._colorVariants;

            let coloredSvgString = svgString
              .replace(/%CANDLE_1_COLOR_A%/g, c1.a)
              .replace(/%CANDLE_1_COLOR_B%/g, c1.b)
              .replace(/%CANDLE_1_COLOR_C%/g, c1.c)
              .replace(/%CANDLE_1_COLOR_D%/g, c1.d)
              .replace(/%CANDLE_1_COLOR_E%/g, c1.e)
              .replace(/%CANDLE_2_COLOR_A%/g, c2.a)
              .replace(/%CANDLE_2_COLOR_B%/g, c2.b)
              .replace(/%CANDLE_2_COLOR_C%/g, c2.c)
              .replace(/%CANDLE_2_COLOR_D%/g, c2.d)
              .replace(/%CANDLE_2_COLOR_E%/g, c2.e)
              .replace(/%CANDLE_3_COLOR_A%/g, c3.a)
              .replace(/%CANDLE_3_COLOR_B%/g, c3.b)
              .replace(/%CANDLE_3_COLOR_C%/g, c3.c)
              .replace(/%CANDLE_3_COLOR_D%/g, c3.d)
              .replace(/%CANDLE_3_COLOR_E%/g, c3.e)
              .replace(/%CANDLE_4_COLOR_A%/g, c4.a)
              .replace(/%CANDLE_4_COLOR_B%/g, c4.b)
              .replace(/%CANDLE_4_COLOR_C%/g, c4.c)
              .replace(/%CANDLE_4_COLOR_D%/g, c4.d)
              .replace(/%CANDLE_4_COLOR_E%/g, c4.e);

            const bytes = ByteArray.fromString(coloredSvgString);
            const stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(bytes));
            pixBuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(stream, width, height, true, null);
          }
        } catch (e) {
          global.logError(`${UUID}: Error dynamically coloring SVG: ${e}`);
        }
      }

      if (!pixBuf) {
        pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, width, height);
      }

      if (this._pixbufCache) this._pixbufCache[cacheKey] = pixBuf;
    }

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
