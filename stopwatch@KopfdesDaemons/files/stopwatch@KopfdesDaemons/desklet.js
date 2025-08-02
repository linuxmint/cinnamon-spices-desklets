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

    this.settings.bindProperty(Settings.BindingDirection.IN, "fontSize", "fontSize", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "colorLabel", "colorLabel", this.onSettingsChanged.bind(this));
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scale_size", this.on_setting_changed);

    this.fontSize = this.settings.getValue("fontSize") || 20;
    this.colorLabel = this.settings.getValue("colorLabel") || "rgb(51, 209, 122)";
    this._timeout = null;
    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;
    this.default_size = 150;

    this.setHeader(_("Stopwatch"));
    this._setupLayout();
  }

  _setupLayout() {
    // Der Main-Container, der alle anderen Elemente enthält.
    this.mainContainer = new Clutter.Actor();
    this.setContent(this.mainContainer);

    const absoluteSize = this.default_size * this.scale_size;

    // Erstellen Sie einen Clutter.Actor, um den Kreis zu zeichnen und fügen Sie ihn direkt dem mainContainer hinzu.
    this.circleActor = new Clutter.Actor({
      width: absoluteSize,
      height: absoluteSize,
    });
    this.mainContainer.add_actor(this.circleActor);

    // Erstellen Sie einen Container für die inneren Elemente.
    // Dieser Container muss die gleiche Größe wie der Kreis haben,
    // damit die Zentrierung von St.BoxLayout korrekt funktioniert.
    const innerContainer = new St.BoxLayout({
      vertical: true,
      width: absoluteSize,
      height: absoluteSize,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
      style: "background-color: red;",
    });
    this.mainContainer.add_actor(innerContainer);

    // Time label
    this.timeLabel = this._createLabel(_("00.000"), this.colorLabel);
    innerContainer.add_child(this.timeLabel);

    // Buttons
    const computedHeight = 50;
    const playIcon = this._getImageAtScale(`${this.metadata.path}/play.svg`, computedHeight, computedHeight);
    this.playButton = new St.Button({ child: playIcon });
    this.playButton.connect("clicked", this._startStopwatch.bind(this));

    const pauseIcon = this._getImageAtScale(`${this.metadata.path}/pause.svg`, computedHeight, computedHeight);
    this.pauseButton = new St.Button({ child: pauseIcon, visible: false });
    this.pauseButton.connect("clicked", this._pauseStopwatch.bind(this));

    const stopIcon = this._getImageAtScale(`${this.metadata.path}/stop.svg`, computedHeight, computedHeight);
    this.stopButton = new St.Button({ child: stopIcon });
    this.stopButton.connect("clicked", this._resetStopwatch.bind(this));

    this.buttonRow = new St.BoxLayout({
      x_align: St.Align.MIDDLE,
    });
    this.buttonRow.add_child(this.playButton);
    this.buttonRow.add_child(this.pauseButton);
    this.buttonRow.add_child(this.stopButton);

    innerContainer.add_child(this.buttonRow);

    this._drawCircle();
  }

  _createLabel(text, color = "inherit") {
    return new St.Label({ text, style: `font-size: ${this.fontSize}px; color: ${color};` });
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
      formattedTime = `${String(minutes).padStart(2, "0")}.${String(seconds).padStart(2, "0")}:${String(milliseconds).padStart(3, "0")}`;
    } else {
      formattedTime = `${String(hours).padStart(2, "0")}.${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(
        milliseconds
      ).padStart(3, "0")}`;
    }

    this.timeLabel.set_text(formattedTime);
    return true;
  }

  _startStopwatch() {
    if (!this._isRunning) {
      this._startTime = new Date().getTime();
      this._timeout = Mainloop.timeout_add(10, this._updateTime.bind(this));
      this._isRunning = true;
      this.playButton.hide();
      this.pauseButton.show();
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
    }
  }

  _resetStopwatch() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;
    this.timeLabel.set_text(_("00.000"));
    this.playButton.show();
    this.pauseButton.hide();
  }

  onSettingsChanged() {
    this.timeLabel.style = `font-size: ${this.fontSize}px; color: ${this.colorLabel};`;
  }

  on_desklet_removed() {
    if (this._timeout) Mainloop.source_remove(this._timeout);
  }

  _drawCircle() {
    let canvas = new Clutter.Canvas();
    const absoluteSize = this.default_size * this.scale_size;
    canvas.set_size(absoluteSize * global.ui_scale, absoluteSize * global.ui_scale);

    const use = 50;
    const size = 100;
    const circle_r = 0.3;
    const circle_g = 0.8;
    const circle_b = 0.5;
    const circle_a = 1.0;

    canvas.connect("draw", function (canvas, cr, width, height) {
      cr.save();
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.restore();
      cr.setOperator(Cairo.Operator.OVER);
      cr.scale(width, height);
      cr.translate(0.5, 0.5);

      let offset = Math.PI * 0.5;
      let start = 0 - offset;
      let end = (use * (Math.PI * 2)) / size - offset;

      // draw the circle
      cr.setSourceRGBA(1, 1, 1, 0.2);
      cr.setLineWidth(0.19);
      cr.arc(0, 0, 0.4, 0, Math.PI * 2);
      cr.stroke();

      if (size > 0) {
        cr.setSourceRGBA(circle_r, circle_g, circle_b, circle_a);
        cr.setLineWidth(0.19);
        cr.arc(0, 0, 0.4, start, end);
        cr.stroke();
      }

      return true;
    });

    canvas.invalidate();
    this.circleActor.set_content(canvas);
  }
}

function main(metadata, deskletId) {
  return new StopwatchDesklet(metadata, deskletId);
}
