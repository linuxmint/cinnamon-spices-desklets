const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;
const Cinnamon = imports.gi.Cinnamon;
const Cairo = imports.cairo;

const UUID = "stopwatch@KopfdesDaemons";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class StopwatchDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.metadata = metadata;

    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

    // bind the settings
    this.settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "indicator-color", "indicatorColor", this.onSettingsChanged.bind(this));

    // get the settings
    this.labelColor = this.settings.getValue("colorLabel") || "rgb(51, 209, 122)";
    this.scaleSize = this.settings.getValue("scale-size") || 1;
    this.indicatorColor = this.settings.getValue("indicator-color") || "rgb(51, 209, 122)";

    this._timeout = null;
    this._animationTimeout = null;
    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;
    this.default_size = 180;

    this.setHeader(_("Stopwatch"));
    this._setupLayout();
  }

  _setupLayout() {
    this.mainContainer = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
    });
    this.setContent(this.mainContainer);

    const absoluteSize = this.default_size * this.scaleSize;

    this.circleActor = new Clutter.Actor({
      width: absoluteSize,
      height: absoluteSize,
    });
    this.mainContainer.add_child(this.circleActor);

    // Boxlayout for the elements in the middle of the circle
    this.centerContent = new St.BoxLayout({ vertical: true });

    // time label
    this.timeLabel = this._createLabel(_("00.000"), this.labelColor);
    this.timeLabel.style = `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`;
    this.timeLabelBox = new St.Bin({ x_align: St.Align.MIDDLE });
    this.timeLabelBox.set_child(this.timeLabel);
    this.centerContent.add_child(this.timeLabelBox);

    // buttons
    const computedHeight = 40 * this.scaleSize;
    const playIcon = this._getImageAtScale(`${this.metadata.path}/play.svg`, computedHeight, computedHeight);
    this.playButton = new St.Button({ child: playIcon });
    this.playButton.connect("clicked", this._startStopwatch.bind(this));

    const pauseIcon = this._getImageAtScale(`${this.metadata.path}/pause.svg`, computedHeight, computedHeight);
    this.pauseButton = new St.Button({ child: pauseIcon, visible: false });
    this.pauseButton.connect("clicked", this._pauseStopwatch.bind(this));

    const stopIcon = this._getImageAtScale(`${this.metadata.path}/stop.svg`, computedHeight, computedHeight);
    this.stopButton = new St.Button({ child: stopIcon });
    this.stopButton.connect("clicked", this._resetStopwatch.bind(this));

    this.buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });
    this.buttonRow.add_child(this.playButton);
    this.buttonRow.add_child(this.pauseButton);
    this.buttonRow.add_child(this.stopButton);

    const buttonRowBox = new St.Bin({ x_align: St.Align.MIDDLE });
    buttonRowBox.set_child(this.buttonRow);
    this.centerContent.add_child(buttonRowBox);
    this.mainContainer.add_child(this.centerContent);

    this._drawCircle();
  }

  _createLabel(text, color = "inherit") {
    return new St.Label({ text, style: `font-size: ${this.fontSize}px; color: ${color};` });
  }

  _rgbToRgba(colorString) {
    let rgba = [0.3, 0.8, 0.5, 1];
    const rgbValues = colorString.match(/\d+/g).map(Number);
    if (rgbValues.length === 3) {
      const r = rgbValues[0] / 255;
      const g = rgbValues[1] / 255;
      const b = rgbValues[2] / 255;
      rgba = [r, g, b, 1];
    }
    return rgba;
  }

  _getImageAtScale(imageFileName, requestedWidth, requestedHeight) {
    try {
      const pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, requestedWidth, requestedHeight);
      const width = pixBuf.get_width();
      const height = pixBuf.get_height();

      const image = new Clutter.Image();
      image.set_data(
        pixBuf.get_pixels(),
        pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
        width,
        height,
        pixBuf.get_rowstride()
      );

      const actor = new Clutter.Actor({ width, height });
      actor.set_content(image);
      return actor;
    } catch (e) {
      global.logError(`Error loading image ${imageFileName}: ${e}`);
      return new St.Label({ text: "Error" });
    }
  }

  _updateTime() {
    const currentTime = new Date().getTime();
    const elapsedTime = this._elapsedTime + (this._isRunning ? currentTime - this._startTime : 0);
    const totalSeconds = Math.floor(elapsedTime / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;
    const milliseconds = elapsedTime % 1000;

    let formattedTime;
    if (hours === 0 && minutes === 0) {
      formattedTime = `${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
    } else if (hours === 0) {
      formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
    } else {
      formattedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
        milliseconds
      ).padStart(3, "0")}`;
      this.timeLabel.style = `font-size: ${16 * this.scaleSize}px; color: ${this.labelColor};`;
    }

    this.timeLabel.set_text(formattedTime);
    return true;
  }

  _animateIndicator() {
    this.circleActor.rotation_angle_z = (this.circleActor.rotation_angle_z + 2) % 360;
    return true;
  }

  _startStopwatch() {
    if (!this._isRunning) {
      this._startTime = new Date().getTime();
      this._timeout = Mainloop.timeout_add(10, this._updateTime.bind(this));
      this._isRunning = true;
      this.playButton.hide();
      this.pauseButton.show();

      // start the animation loop when the stopwatch starts
      this._animationTimeout = Mainloop.timeout_add(16, this._animateIndicator.bind(this));
    }
  }

  _pauseStopwatch() {
    if (this._isRunning) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
      this._elapsedTime += new Date().getTime() - this._startTime;
      this._isRunning = false;
      this.playButton.show();
      this.pauseButton.hide();

      // stop the animation loop when the stopwatch is paused
      if (this._animationTimeout) {
        Mainloop.source_remove(this._animationTimeout);
        this._animationTimeout = null;
      }
    }
  }

  _resetStopwatch() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }

    // stop the animation loop when the stopwatch is reset
    if (this._animationTimeout) {
      Mainloop.source_remove(this._animationTimeout);
      this._animationTimeout = null;
    }
    // reset the indicator's rotation
    this.circleActor.rotation_angle_z = 0;

    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;
    this.timeLabel.style = `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`;
    this.timeLabel.set_text(_("00.000"));
    this.playButton.show();
    this.pauseButton.hide();
  }

  onSettingsChanged() {
    this._setupLayout();
    if (this._isRunning) {
      this.playButton.hide();
      this.pauseButton.show();
    }
  }

  on_desklet_removed() {
    if (this._timeout) Mainloop.source_remove(this._timeout);
    if (this._animationTimeout) Mainloop.source_remove(this._animationTimeout);
  }

  _drawCircle() {
    let canvas = new Clutter.Canvas();
    const absoluteSize = this.default_size * this.scaleSize;
    canvas.set_size(absoluteSize * global.ui_scale, absoluteSize * global.ui_scale);

    canvas.connect("draw", (canvas, cr, width, height) => {
      cr.save();
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.restore();
      cr.setOperator(Cairo.Operator.OVER);
      cr.scale(width, height);
      cr.translate(0.5, 0.5);

      // draw the circle
      cr.setSourceRGBA(1, 1, 1, 0.2);
      cr.setLineWidth(0.1);
      cr.arc(0, 0, 0.4, 0, Math.PI * 2);
      cr.stroke();

      // draw indicator
      const size = 10;
      const offset = Math.PI * 0.5;
      const start = 0 - offset;
      const end = (size * (Math.PI * 2)) / 100 - offset;
      const rgbaColor = this._rgbToRgba(this.indicatorColor);
      cr.setSourceRGBA(rgbaColor[0], rgbaColor[1], rgbaColor[2], rgbaColor[3]);
      cr.setLineWidth(0.1);
      cr.arc(0, 0, 0.4, start, end);
      cr.stroke();

      return true;
    });

    canvas.invalidate();
    this.circleActor.set_content(canvas);

    // Set the pivot point for the rotation to the center of the actor
    this.circleActor.set_pivot_point(0.5, 0.5);
  }
}

function main(metadata, deskletId) {
  return new StopwatchDesklet(metadata, deskletId);
}
