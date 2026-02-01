const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Cogl = imports.gi.Cogl;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.default_size = 200;
    this.isRunning = false;
    this._timeout = null;
    this._totalSeconds = 0;
    this._remainingMs = 0;

    // Use default values if settings are not yet set
    this.labelColor = "rgb(51, 209, 122)";
    this.scaleSize = 1;
    this.indicatorColor = "rgb(51, 209, 122)";
    this.circleWidth = 0.03;
    this.circleColor = "rgb(255, 255, 255)";
    this.fillInnerCircle = false;
    this.innerCircleColor = "rgba(255, 255, 255, 0.3)";

    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "indicator-color", "indicatorColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "circle-width", "circleWidth", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circleColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "inner-circle-color", "innerCircleColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "fill-inner-circle", "fillInnerCircle", this._onSettingsChanged.bind(this));

    this.setHeader("Timer");
    this._inputDigits = "";

    this.mainContainer = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
    });
    this.setContent(this.mainContainer);
    this._setButtonStyles();
    this._setupInputLayout();
  }

  _onSettingsChanged() {
    this._setButtonStyles();
    if (this._totalSeconds > 0) this._setupTimerUI();
    else this._setupInputLayout();
  }

  _setButtonStyles() {
    this.buttonStyle = `font-size: ${1.8 * this.scaleSize}em;`;
    this.addTimeButtonStyle = `font-size: ${1.2 * this.scaleSize}em;`;
  }

  _setupInputLayout() {
    this.mainContainer.destroy_all_children();

    const box = new St.BoxLayout({ vertical: true });

    const labelRow = new St.BoxLayout();
    const labelStyle = `font-size: ${1.5 * this.scaleSize}em; color: ${this.labelColor};`;
    this._inputLabel = new St.Label({ text: "00h 00m 00s", style_class: "timer-input-label", x_expand: true, style: labelStyle });
    labelRow.add_child(this._inputLabel);
    box.add_child(labelRow);

    // Input buttons 1-9
    for (let i = 0; i < 3; i++) {
      const row = new St.BoxLayout();
      for (let j = 1; j <= 3; j++) {
        const num = i * 3 + j;
        const button = new St.Button({
          label: num.toString(),
          style_class: "timer-input-button",
          style: this.buttonStyle,
        });
        button.connect("clicked", () => this._onDigitPressed(num));
        row.add_child(button);
      }
      box.add_child(row);
    }

    const lastRow = new St.BoxLayout();
    const zeroBtn = new St.Button({
      label: "0",
      style_class: "timer-input-button",
      style: this.buttonStyle,
    });
    zeroBtn.connect("clicked", () => this._onDigitPressed(0));
    lastRow.add_child(zeroBtn);

    const playIcon = new St.Icon({
      icon_name: "media-playback-start-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    const startBtn = new St.Button({
      child: playIcon,
      style_class: "timer-input-button",
      style: this.buttonStyle,
    });
    lastRow.add_child(startBtn);
    startBtn.connect("clicked", () => this._onStartPressed());

    const editIcon = new St.Icon({
      icon_name: "edit-clear-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    const editBtn = new St.Button({
      child: editIcon,
      style_class: "timer-input-button",
      style: this.buttonStyle,
    });
    editBtn.connect("clicked", () => this._onEditPressed());
    lastRow.add_child(editBtn);

    box.add_child(lastRow);

    this.mainContainer.add_child(box);
  }

  _onDigitPressed(num) {
    if (this._inputDigits.length < 6) {
      this._inputDigits += num.toString();
      this._updateInputLabel();
    }
  }

  _onEditPressed() {
    this._inputDigits = this._inputDigits.slice(0, -1);
    this._updateInputLabel();
  }

  _updateInputLabel() {
    const padded = this._inputDigits.padStart(6, "0");
    this._inputLabel.set_text(`${padded.slice(0, 2)}h ${padded.slice(2, 4)}m ${padded.slice(4, 6)}s`);
  }

  _onStartPressed() {
    const padded = this._inputDigits.padStart(6, "0");
    const h = parseInt(padded.slice(0, 2));
    const m = parseInt(padded.slice(2, 4));
    const s = parseInt(padded.slice(4, 6));
    this._totalSeconds = h * 3600 + m * 60 + s;

    if (this._totalSeconds > 0) {
      this._remainingMs = this._totalSeconds * 1000;
      this.indicatorLength = 100;
      this._startTimer();
      this._setupTimerUI();
    }
  }

  _setupTimerUI() {
    this.mainContainer.destroy_all_children();

    const absoluteSize = this.default_size * this.scaleSize;

    this.circleActor = new Clutter.Actor({
      width: absoluteSize,
      height: absoluteSize,
    });
    this.mainContainer.add_child(this.circleActor);
    this._drawCircle();

    const centerContent = new St.BoxLayout({ vertical: true });
    this.mainContainer.add_child(centerContent);

    this.timeLabel = new St.Label({
      text: "00h 00m 00s",
      style: `font-size: ${1.5 * this.scaleSize}em; color: ${this.labelColor}; margin-top: ${0.5 * this.scaleSize}em;`,
    });
    centerContent.add_child(new St.Bin({ child: this.timeLabel, x_align: St.Align.MIDDLE }));

    const buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });

    const playIcon = new St.Icon({
      icon_name: "media-playback-start-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    this.playBtn = new St.Button({ child: playIcon, style_class: "timer-input-button", style: this.buttonStyle });
    if (this.isRunning || this._remainingMs <= 0) this.playBtn.hide();
    this.playBtn.connect("clicked", () => this._onPlayPressed());
    buttonRow.add_child(this.playBtn);

    const refreshIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    this.restartBtn = new St.Button({ child: refreshIcon, style_class: "timer-input-button", style: this.buttonStyle });
    if (this.isRunning || this._remainingMs > 0) this.restartBtn.hide();
    this.restartBtn.connect("clicked", () => this._onRestartPressed());
    buttonRow.add_child(this.restartBtn);

    const pauseIcon = new St.Icon({
      icon_name: "media-playback-pause-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    this.pauseBtn = new St.Button({ child: pauseIcon, style_class: "timer-input-button", style: this.buttonStyle });
    this.pauseBtn.connect("clicked", () => this._onPausePressed());
    if (!this.isRunning) this.pauseBtn.hide();
    buttonRow.add_child(this.pauseBtn);

    const stopIcon = new St.Icon({
      icon_name: "media-playback-stop-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    this.stopBtn = new St.Button({ child: stopIcon, style_class: "timer-input-button", style: this.buttonStyle });
    this.stopBtn.connect("clicked", () => this._onStopPressed());
    buttonRow.add_child(this.stopBtn);

    centerContent.add_child(new St.Bin({ child: buttonRow, x_align: St.Align.MIDDLE }));

    const addTimeBtn = new St.Button({
      label: "+1",
      style_class: "timer-add-time-button",
      style: this.addTimeButtonStyle,
    });
    addTimeBtn.connect("clicked", () => {
      this._remainingMs += 60 * 1000;
      this._totalSeconds += 60;
      if (this.isRunning) {
        this._endTime += 60 * 1000;
      }
      this._updateTimerVisuals();
    });
    centerContent.add_child(new St.Bin({ child: addTimeBtn, x_align: St.Align.MIDDLE }));

    this._updateTimerVisuals();
  }

  _onPausePressed() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
    this.isRunning = false;
    this.pauseBtn.hide();
    this.playBtn.show();
  }

  _onStopPressed() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
    this.isRunning = false;
    this._totalSeconds = 0;
    this._inputDigits = "";
    this._setupInputLayout();
  }

  _onPlayPressed() {
    if (this._remainingMs > 0) {
      this._startTimer();
      this.playBtn.hide();
      this.pauseBtn.show();
    }
  }

  _onRestartPressed() {
    this._remainingMs = this._totalSeconds * 1000;
    this.restartBtn.hide();
    this.pauseBtn.show();
    this._startTimer();
  }

  _startTimer() {
    this.isRunning = true;
    this._endTime = Date.now() + this._remainingMs;
    this._updateTimerVisuals();

    if (this._timeout) Mainloop.source_remove(this._timeout);
    this._timeout = Mainloop.timeout_add(10, this._updateTimer.bind(this));
  }

  _updateTimer() {
    const now = Date.now();
    this._remainingMs = this._endTime - now;

    if (this._remainingMs <= 0) {
      this._remainingMs = 0;
      this._updateTimerVisuals();
      this.isRunning = false;
      this._timeout = null;
      this.playBtn.hide();
      this.pauseBtn.hide();
      this.restartBtn.show();
      return false;
    }

    this._updateTimerVisuals();
    return true;
  }

  _updateTimerVisuals() {
    const totalSecondsLeft = Math.ceil(this._remainingMs / 1000);
    const h = Math.floor(totalSecondsLeft / 3600);
    const m = Math.floor((totalSecondsLeft % 3600) / 60);
    const s = totalSecondsLeft % 60;

    const text = `${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
    if (this.timeLabel) this.timeLabel.set_text(text);

    if (this._totalSeconds > 0) {
      this.indicatorLength = (this._remainingMs / (this._totalSeconds * 1000)) * 100;
    } else {
      this.indicatorLength = 0;
    }

    if (this.circleActor && this.circleActor.get_content()) {
      this.circleActor.get_content().invalidate();
    }
  }

  _drawCircle() {
    const canvas = new Clutter.Canvas();
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

      // Draw the inner circle
      if (this.fillInnerCircle) {
        const rgbaInner = this._rgbToRgba(this.innerCircleColor);
        cr.setSourceRGBA(rgbaInner[0], rgbaInner[1], rgbaInner[2], rgbaInner[3]);
        cr.arc(0, 0, 0.4 - this.circleWidth / 2, 0, Math.PI * 2);
        cr.fill();
      }

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

      return true;
    });

    canvas.invalidate();
    this.circleActor.set_content(canvas);
    this.circleActor.set_pivot_point(0.5, 0.5);
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

  on_desklet_removed() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
