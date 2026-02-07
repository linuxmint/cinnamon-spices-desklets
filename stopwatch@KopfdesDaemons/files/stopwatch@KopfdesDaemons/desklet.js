const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Cairo = imports.cairo;
const Gio = imports.gi.Gio;

const UUID = "stopwatch@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class StopwatchDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    // Initialize default properties
    this._elapsedTime = 0;
    this._default_size = 180;

    // Use default values if settings are not yet set
    this.labelColor = "rgb(51, 209, 122)";
    this.scaleSize = 1;
    this.indicatorColor = "rgb(51, 209, 122)";
    this.rotationSpeed = 2;
    this.circleWidth = 0.1;
    this.indicatorLength = 10;
    this.circleColor = "rgb(255, 255, 255)";

    // Setup settings and bind them to properties
    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "indicator-color", "indicatorColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "animation-speed", "rotationSpeed", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "circle-width", "circleWidth", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "indicator-length", "indicatorLength", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circleColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "hideDecorations", "hideDecorations", this.updateDecoration.bind(this));

    // Set the desklet header and build the layout
    this.setHeader(_("Stopwatch"));
    this.updateDecoration();
    this._setupLayout();
  }

  // Setup the entire visual layout of the desklet
  _setupLayout() {
    this.mainContainer = new St.Widget();
    this.setContent(this.mainContainer);

    const absoluteSize = this._default_size * this.scaleSize;

    // Create the circle actor for the canvas
    this.circleDrawingArea = new St.DrawingArea({ width: absoluteSize, height: absoluteSize });
    this.circleDrawingArea.set_pivot_point(0.5, 0.5);
    this.circleDrawingArea.connect("repaint", this._drawCircle.bind(this));
    this.mainContainer.add_child(this.circleDrawingArea);

    // Create a vertical box layout for the time and buttons
    this.centerContent = new St.BoxLayout({ vertical: true });
    this.contentBin = new St.Bin({
      width: absoluteSize,
      height: absoluteSize,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
    });
    this.contentBin.set_child(this.centerContent);
    this.mainContainer.add_child(this.contentBin);

    // Create and style the time label
    this.timeLabel = new St.Label({ text: "00.000", style: `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};` });
    this.centerContent.add_child(new St.Bin({ child: this.timeLabel, x_align: St.Align.MIDDLE }));

    // Create a horizontal box for the buttons
    this.buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });
    this.centerContent.add_child(new St.Bin({ child: this.buttonRow, x_align: St.Align.MIDDLE }));

    // Draw the static part of the circle and set up initial buttons
    this._updateVisuals();
  }

  // Updates the visual properties based on current settings
  _updateVisuals() {
    const absoluteSize = this._default_size * this.scaleSize;
    this.circleDrawingArea.set_size(absoluteSize, absoluteSize);
    if (this.contentBin) this.contentBin.set_size(absoluteSize, absoluteSize);
    this.timeLabel.style = `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`;
    this.circleDrawingArea.queue_repaint();
    this._updateButtons();
  }

  // Updates the buttons based on the current scale size
  _updateButtons() {
    // Clear existing buttons
    this.buttonRow.destroy_all_children();
    const size = 40 * this.scaleSize;

    const addBtn = (icon, cb) => {
      const btn = new St.Button({
        child: new St.Icon({
          gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.metadata.path}/${icon}.svg`) }),
          icon_size: size,
        }),
        style_class: "stopwatch-button",
      });
      btn.connect("clicked", cb.bind(this));
      this.buttonRow.add_child(btn);
      return btn;
    };

    this.playButton = addBtn("play", this._startStopwatch);
    this.pauseButton = addBtn("pause", this._pauseStopwatch);
    this.stopButton = addBtn("stop", this._resetStopwatch);

    this._updateButtonState();
  }

  _updateButtonState() {
    this.playButton.visible = !this._isRunning;
    this.pauseButton.visible = this._isRunning;
  }

  // Updates the time label every 10ms
  _updateTime() {
    const now = Date.now();
    const elapsed = this._elapsedTime + (this._isRunning ? now - this._startTime : 0);

    const pad = (n, w = 2) => n.toString().padStart(w, "0");
    const totalSec = Math.floor(elapsed / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor(totalSec / 60) % 60;
    const s = totalSec % 60;
    const ms = elapsed % 1000;

    let timeString,
      size = 20;
    if (h > 0) {
      timeString = `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
      size = 16;
    } else if (m > 0) {
      timeString = `${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
    } else {
      timeString = `${pad(s)}.${pad(ms, 3)}`;
    }

    this.timeLabel.set_text(timeString);
    this.timeLabel.style = `font-size: ${size * this.scaleSize}px; color: ${this.labelColor};`;
    return true;
  }

  // Rotates the indicator actor for animation
  _animateIndicator() {
    this.circleDrawingArea.rotation_angle_z = (this.circleDrawingArea.rotation_angle_z + this.rotationSpeed) % 360;
    return true;
  }

  // Starts the stopwatch
  _startStopwatch() {
    if (!this._isRunning) {
      this._startTime = Date.now();
      this._timeout = Mainloop.timeout_add(10, this._updateTime.bind(this));
      this._isRunning = true;
      this._animationTimeout = Mainloop.timeout_add(16, this._animateIndicator.bind(this));
      this._updateButtonState();
    }
  }

  _clearTimeouts() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
    if (this._animationTimeout) {
      Mainloop.source_remove(this._animationTimeout);
      this._animationTimeout = null;
    }
  }

  // Pauses the stopwatch
  _pauseStopwatch() {
    if (this._isRunning) {
      this._clearTimeouts();
      this._elapsedTime += Date.now() - this._startTime;
      this._isRunning = false;
      this._updateButtonState();
    }
  }

  // Resets the stopwatch to zero
  _resetStopwatch() {
    this._clearTimeouts();
    this.circleDrawingArea.rotation_angle_z = 0;
    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;
    this.timeLabel.style = `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`;
    this.timeLabel.set_text("00.000");
    this._updateButtonState();
  }

  // Callback for when settings are changed
  _onSettingsChanged() {
    const wasRunning = this._isRunning;
    if (wasRunning) this._pauseStopwatch();

    // Update only the visual properties without destroying the layout
    this._updateVisuals();

    if (wasRunning) this._startStopwatch();
  }

  updateDecoration() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  // Clean up timeouts when the desklet is removed
  on_desklet_removed() {
    this._clearTimeouts();
  }

  // Draws the static circle and arc on the canvas
  _drawCircle(area) {
    const [width, height] = area.get_surface_size();
    const cr = area.get_context();

    cr.save();
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.restore();
    cr.setOperator(Cairo.Operator.OVER);
    cr.scale(width, height);
    cr.translate(0.5, 0.5);

    // Draw the background circle
    const rgbaCircle = this._rgbToRgba(this.circleColor);
    cr.setSourceRGBA(rgbaCircle[0], rgbaCircle[1], rgbaCircle[2], rgbaCircle[3]);
    cr.setLineWidth(this.circleWidth);
    cr.arc(0, 0, 0.4, 0, Math.PI * 2);
    cr.stroke();

    // Draw the indicator arc
    const rgbaIndicator = this._rgbToRgba(this.indicatorColor);
    cr.setSourceRGBA(rgbaIndicator[0], rgbaIndicator[1], rgbaIndicator[2], rgbaIndicator[3]);
    cr.setLineWidth(this.circleWidth);
    const arcEnd = (this.indicatorLength * (Math.PI * 2)) / 100 - Math.PI * 0.5;
    cr.arc(0, 0, 0.4, 0 - Math.PI * 0.5, arcEnd);
    cr.stroke();
  }

  // Parses an RGB string to a RGBA array for Cairo
  _rgbToRgba(colorString) {
    const match = colorString.match(/\((.*?)\)/);
    if (match && match[1]) {
      const [r, g, b, a = 1] = match[1].split(",").map(parseFloat);
      return [r / 255, g / 255, b / 255, a];
    }
    return [0.3, 0.8, 0.5, 1]; // Default color if parsing fails
  }
}

// Entry point function for the desklet
function main(metadata, deskletId) {
  return new StopwatchDesklet(metadata, deskletId);
}
