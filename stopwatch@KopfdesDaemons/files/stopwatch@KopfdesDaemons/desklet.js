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
    this.default_size = 180;

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

    // Set the desklet header and build the layout
    this.setHeader(_("Stopwatch"));
    this._setupLayout();
  }

  // Setup the entire visual layout of the desklet
  _setupLayout() {
    this.mainContainer = new St.Widget();
    this.setContent(this.mainContainer);

    const absoluteSize = this.default_size * this.scaleSize;

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
    this.timeLabel = new St.Label({
      text: "00.000",
      style: `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`,
    });
    this.centerContent.add_child(new St.Bin({ child: this.timeLabel, x_align: St.Align.MIDDLE }));

    // Create a horizontal box for the buttons
    this.buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });
    this.centerContent.add_child(new St.Bin({ child: this.buttonRow, x_align: St.Align.MIDDLE }));

    // Draw the static part of the circle and set up initial buttons
    this._updateVisuals();
  }

  // Updates the visual properties based on current settings
  _updateVisuals() {
    const absoluteSize = this.default_size * this.scaleSize;
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

    const buttonHeight = 40 * this.scaleSize;

    const createButton = (iconName, callback) => {
      const file = Gio.File.new_for_path(`${this.metadata.path}/${iconName}.svg`);
      const fileIcon = new Gio.FileIcon({ file });
      const icon = new St.Icon({ gicon: fileIcon, icon_size: buttonHeight });
      const button = new St.Button({ child: icon, style_class: "stopwatch-button" });
      button.connect("clicked", callback.bind(this));
      return button;
    };

    this.playButton = createButton("play", this._startStopwatch);
    this.pauseButton = createButton("pause", this._pauseStopwatch);
    this.stopButton = createButton("stop", this._resetStopwatch);

    this.buttonRow.add_child(this.playButton);
    this.buttonRow.add_child(this.pauseButton);
    this.buttonRow.add_child(this.stopButton);

    if (this._isRunning) {
      this.playButton.hide();
      this.pauseButton.show();
    } else {
      this.playButton.show();
      this.pauseButton.hide();
    }
  }

  // Updates the time label every 10ms
  _updateTime() {
    const currentTime = new Date().getTime();
    const elapsedTime = this._elapsedTime + (this._isRunning ? currentTime - this._startTime : 0);
    const totalSeconds = Math.floor(elapsedTime / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor(totalSeconds / 60) % 60;
    const s = totalSeconds % 60;
    const ms = elapsedTime % 1000;

    let timeString;
    if (h > 0) {
      // Display hours, minutes, seconds, and milliseconds
      this.timeLabel.style = `font-size: ${16 * this.scaleSize}px; color: ${this.labelColor};`;
      timeString = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
    } else if (m > 0) {
      // Display minutes, seconds, and milliseconds
      timeString = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
    } else {
      // Display seconds and milliseconds
      this.timeLabel.style = `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`;
      timeString = `${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
    }

    this.timeLabel.set_text(timeString);
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
      this._startTime = new Date().getTime();
      this._timeout = Mainloop.timeout_add(10, this._updateTime.bind(this));
      this._isRunning = true;
      this.playButton.hide();
      this.pauseButton.show();
      this._animationTimeout = Mainloop.timeout_add(16, this._animateIndicator.bind(this));
    }
  }

  // Pauses the stopwatch
  _pauseStopwatch() {
    if (this._isRunning) {
      if (this._timeout) {
        Mainloop.source_remove(this._timeout);
        this._timeout = null;
      }
      if (this._animationTimeout) {
        Mainloop.source_remove(this._animationTimeout);
        this._animationTimeout = null;
      }
      this._elapsedTime += new Date().getTime() - this._startTime;
      this._isRunning = false;
      this.playButton.show();
      this.pauseButton.hide();
    }
  }

  // Resets the stopwatch to zero
  _resetStopwatch() {
    if (this._timeout) Mainloop.source_remove(this._timeout);
    this._timeout = null;
    if (this._animationTimeout) Mainloop.source_remove(this._animationTimeout);
    this._animationTimeout = null;

    this.circleDrawingArea.rotation_angle_z = 0;
    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;
    this.timeLabel.style = `font-size: ${20 * this.scaleSize}px; color: ${this.labelColor};`;
    this.timeLabel.set_text("00.000");
    this.playButton.show();
    this.pauseButton.hide();
  }

  // Callback for when settings are changed
  _onSettingsChanged() {
    const wasRunning = this._isRunning;
    if (wasRunning) {
      this._pauseStopwatch();
    }

    // Update only the visual properties without destroying the layout
    this._updateVisuals();

    if (wasRunning) {
      this._startStopwatch();
    }
  }

  // Clean up timeouts when the desklet is removed
  on_desklet_removed() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
    if (this._animationTimeout) {
      Mainloop.source_remove(this._animationTimeout);
      this._animationTimeout = null;
    }
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
      const c = match[1].split(",");
      if (c.length >= 3) {
        const a = c.length >= 4 ? parseFloat(c[3]) : 1;
        return [parseInt(c[0]) / 255, parseInt(c[1]) / 255, parseInt(c[2]) / 255, a];
      }
    }
    return [0.3, 0.8, 0.5, 1]; // Default color if parsing fails
  }
}

// Entry point function for the desklet
function main(metadata, deskletId) {
  return new StopwatchDesklet(metadata, deskletId);
}
