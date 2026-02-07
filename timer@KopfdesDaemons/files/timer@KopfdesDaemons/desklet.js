const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Cairo = imports.cairo;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Gettext = imports.gettext;

const UUID = "timer@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.default_size = 200;
    this.isRunning = false;
    this._isInputView = false;
    this._timeout = null;
    this._totalSeconds = 0;
    this._remainingMs = 0;
    this._lastTimeText = "";
    this._soundProc = null;
    this._currentNotification = null;

    // Use default values if settings are not yet set
    this.labelColor = "rgb(51, 209, 122)";
    this.scaleSize = 1;
    this.indicatorColor = "rgb(51, 209, 122)";
    this.circleWidth = 0.03;
    this.circleColor = "rgb(255, 255, 255)";
    this.fillInnerCircle = true;
    this.innerCircleColor = "rgba(255, 255, 255, 0.3)";
    this.hideDecorations = false;
    this.soundFile = "complete.oga";
    this.useCustomSound = false;
    this.customSoundFile = "";
    this.timerName = "";
    this.showNotification = false;

    const settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    settings.bindProperty(Settings.BindingDirection.IN, "label-color", "labelColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "indicator-color", "indicatorColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "circle-width", "circleWidth", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "circle-color", "circleColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "inner-circle-color", "innerCircleColor", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "fill-inner-circle", "fillInnerCircle", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "hideDecorations", "hideDecorations", this.updateDecoration.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "sound-file", "soundFile", null);
    settings.bindProperty(Settings.BindingDirection.IN, "use-custom-sound", "useCustomSound", null);
    settings.bindProperty(Settings.BindingDirection.IN, "custom-sound-file", "customSoundFile", null);
    settings.bindProperty(Settings.BindingDirection.IN, "timer-name", "timerName", this._onSettingsChanged.bind(this));
    settings.bindProperty(Settings.BindingDirection.IN, "show-notification", "showNotification", null);

    this.setHeader("Timer");
    this._inputDigits = "";

    this._setButtonStyles();
    this.updateDecoration();
    this._setupTimerUI();
  }

  _onSettingsChanged() {
    this._setButtonStyles();
    if (this._isInputView) this._setupInputLayout();
    else this._setupTimerUI();
  }

  updateDecoration() {
    this.metadata["prevent-decorations"] = this.hideDecorations;
    this._updateDecoration();
  }

  _setButtonStyles() {
    this.buttonStyle = `font-size: ${1.8 * this.scaleSize}em;`;
    this.addTimeButtonStyle = `font-size: ${1.2 * this.scaleSize}em;`;
  }

  _setupInputLayout() {
    this._isInputView = true;

    const box = new St.BoxLayout({ vertical: true });
    box.style = "width: " + this.default_size * this.scaleSize + "px;";

    const labelRow = new St.BoxLayout();
    const labelStyle = `font-size: ${1.5 * this.scaleSize}em; color: ${this.labelColor};`;
    this._inputLabel = new St.Label({ text: "00h 00m 00s", style_class: "timer-input-label", x_expand: true, style: labelStyle });
    labelRow.add_child(this._inputLabel);
    box.add_child(labelRow);

    // Input buttons 1-9
    for (let i = 0; i < 3; i++) {
      const row = new St.BoxLayout();
      row.add_child(new St.Bin({ x_expand: true }));

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
      row.add_child(new St.Bin({ x_expand: true }));
      box.add_child(row);
    }

    const lastRow = new St.BoxLayout();
    lastRow.add_child(new St.Bin({ x_expand: true }));
    const zeroBtn = new St.Button({ label: "0", style_class: "timer-input-button", style: this.buttonStyle });
    zeroBtn.connect("clicked", () => this._onDigitPressed(0));
    lastRow.add_child(zeroBtn);

    const playIcon = new St.Icon({
      icon_name: "media-playback-start-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    const startBtn = new St.Button({ child: playIcon, style_class: "timer-input-button", style: this.buttonStyle });
    lastRow.add_child(startBtn);
    startBtn.connect("clicked", () => this._onStartPressed());

    const editIcon = new St.Icon({ icon_name: "edit-clear-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 * this.scaleSize });
    const editBtn = new St.Button({ child: editIcon, style_class: "timer-input-button", style: this.buttonStyle });
    editBtn.connect("clicked", () => this._onEditPressed());
    lastRow.add_child(editBtn);
    lastRow.add_child(new St.Bin({ x_expand: true }));

    box.add_child(lastRow);

    this.setContent(box);
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
    this._isInputView = false;

    const absoluteSize = this.default_size * this.scaleSize;

    const container = new St.Widget({ width: absoluteSize, height: absoluteSize });

    this.circleDrawingArea = new St.DrawingArea({ width: absoluteSize, height: absoluteSize });
    this.circleDrawingArea.set_pivot_point(0.5, 0.5);
    this.circleDrawingArea.connect("repaint", this._onRepaint.bind(this));
    container.add_child(this.circleDrawingArea);
    this.circleDrawingArea.queue_repaint();

    const centerContent = new St.BoxLayout({ vertical: true });
    const bin = new St.Bin({
      width: absoluteSize,
      height: absoluteSize,
      child: centerContent,
      x_align: St.Align.MIDDLE,
      y_align: St.Align.MIDDLE,
    });
    container.add_child(bin);

    if (this.timerName) {
      const titleLabel = new St.Label({
        text: this.timerName,
        style: `font-size: ${0.9 * this.scaleSize}em; background-color: rgba(0,0,0,0.5); padding: 2px 6px; border-radius: 4px;`,
      });
      centerContent.add_child(new St.Bin({ child: titleLabel, x_align: St.Align.MIDDLE }));
    }

    this.timeLabel = new St.Label({
      text: "00h 00m 00s",
      style: `font-size: ${1.5 * this.scaleSize}em; color: ${this.labelColor}; margin-top: ${!this.timerName ? 0.5 * this.scaleSize : 0}em;`,
    });
    this._lastTimeText = "";
    centerContent.add_child(new St.Bin({ child: this.timeLabel, x_align: St.Align.MIDDLE }));

    const buttonRow = new St.BoxLayout({ style: "spacing: 10px;" });

    const newTimerIcon = new St.Icon({ icon_name: "list-add-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 * this.scaleSize });
    this.newTimerBtn = new St.Button({ child: newTimerIcon, style_class: "timer-input-button", style: this.buttonStyle });
    this.newTimerBtn.connect("clicked", () => {
      this._removeNotification();
      this._inputDigits = "";
      this._setupInputLayout();
    });
    if (this._totalSeconds > 0) this.newTimerBtn.hide();
    buttonRow.add_child(this.newTimerBtn);

    // Play button
    const playIcon = new St.Icon({
      icon_name: "media-playback-start-symbolic",
      icon_type: St.IconType.SYMBOLIC,
      icon_size: 16 * this.scaleSize,
    });
    this.playBtn = new St.Button({ child: playIcon, style_class: "timer-input-button", style: this.buttonStyle });
    if (this._totalSeconds === 0 || this.isRunning || this._remainingMs <= 0) this.playBtn.hide();
    this.playBtn.connect("clicked", () => this._onPlayPressed());
    buttonRow.add_child(this.playBtn);

    // Restart button
    const refreshIcon = new St.Icon({ icon_name: "view-refresh-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 * this.scaleSize });
    this.restartBtn = new St.Button({ child: refreshIcon, style_class: "timer-input-button", style: this.buttonStyle });
    if (this._totalSeconds === 0 || this.isRunning || this._remainingMs > 0) this.restartBtn.hide();
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

    // Stop button
    const stopIcon = new St.Icon({ icon_name: "media-playback-stop-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 * this.scaleSize });
    this.stopBtn = new St.Button({ child: stopIcon, style_class: "timer-input-button", style: this.buttonStyle });
    this.stopBtn.connect("clicked", () => this._onStopPressed());
    if (this._totalSeconds === 0) this.stopBtn.hide();
    buttonRow.add_child(this.stopBtn);

    centerContent.add_child(new St.Bin({ child: buttonRow, x_align: St.Align.MIDDLE }));

    // Add +1 minute button
    const addTimeBtn = new St.Button({ label: "+1", style_class: "timer-add-time-button", style: this.addTimeButtonStyle });
    addTimeBtn.connect("clicked", () => this._onAddTimePressed());
    centerContent.add_child(new St.Bin({ child: addTimeBtn, x_align: St.Align.MIDDLE }));

    this._updateTimerVisuals();

    this.setContent(container);
  }

  _onAddTimePressed() {
    this._stopSound();
    this._removeNotification();
    const wasZero = this._totalSeconds === 0;
    if (!this.isRunning && this._remainingMs === 0) {
      this._totalSeconds = 0;
    }
    this._remainingMs += 60 * 1000;
    this._totalSeconds += 60;
    if (this.isRunning) {
      this._endTime += 60 * 1000;
    }
    this._updateTimerVisuals();
    if (wasZero) {
      this.newTimerBtn.hide();
      this.playBtn.show();
      this.stopBtn.show();
    } else if (!this.isRunning && this._remainingMs > 0) {
      this.playBtn.show();
      this.restartBtn.hide();
    }
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
    this._stopSound();
    this._removeNotification();

    this.isRunning = false;
    this._totalSeconds = 0;
    this._remainingMs = 0;
    this._inputDigits = "";
    this._setupTimerUI();
  }

  _onPlayPressed() {
    if (this._remainingMs > 0) {
      this._removeNotification();
      this._startTimer();
      this.playBtn.hide();
      this.pauseBtn.show();
    }
  }

  _onRestartPressed() {
    this._stopSound();
    this._removeNotification();
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
    this._timeout = Mainloop.timeout_add(20, this._updateTimer.bind(this));
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
      this._playSound();
      if (this.showNotification) {
        this._sendNotification();
      }
      return false;
    }

    this._updateTimerVisuals();
    return true;
  }

  _stopSound() {
    if (this._soundProc) {
      this._soundProc.force_exit();
      this._soundProc = null;
    }
  }

  _sendNotification() {
    const title = this.timerName || "Timer";
    const message = _("Timer expired!");
    if (!this._notificationSource) {
      this._notificationSource = new MessageTray.SystemNotificationSource();
    }
    Main.messageTray.add(this._notificationSource);
    const icon = new St.Icon({
      icon_name: "alarm-symbolic",
      icon_type: St.IconType.SYMBOLIC,
    });
    this._currentNotification = new MessageTray.Notification(this._notificationSource, title, message, { icon: icon });
    this._currentNotification.setTransient(false);
    this._currentNotification.connect("destroy", () => {
      this._stopSound();
      this._currentNotification = null;
    });
    this._notificationSource.notify(this._currentNotification);
  }

  _removeNotification() {
    if (this._currentNotification) {
      this._currentNotification.destroy();
      this._currentNotification = null;
    }
  }

  _updateTimerVisuals() {
    const totalSecondsLeft = Math.ceil(this._remainingMs / 1000);
    const h = Math.floor(totalSecondsLeft / 3600);
    const m = Math.floor((totalSecondsLeft % 3600) / 60);
    const s = totalSecondsLeft % 60;

    const text = `${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
    if (this.timeLabel && text !== this._lastTimeText) {
      this.timeLabel.set_text(text);
      this._lastTimeText = text;
    }

    if (this._totalSeconds > 0) {
      this.indicatorLength = (this._remainingMs / (this._totalSeconds * 1000)) * 100;
    } else {
      this.indicatorLength = 0;
    }

    if (this.circleDrawingArea) {
      this.circleDrawingArea.queue_repaint();
    }
  }

  _onRepaint(area) {
    const cr = area.get_context();
    const [width, height] = area.get_surface_size();

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
  }

  _playSound() {
    let path = null;
    if (this.useCustomSound) {
      if (this.customSoundFile) {
        path = this.customSoundFile;
        if (path.startsWith("file://")) {
          path = decodeURIComponent(path.replace("file://", ""));
        }
      }
    } else if (this.soundFile && this.soundFile !== "none") {
      path = "/usr/share/sounds/freedesktop/stereo/" + this.soundFile;
    }

    if (path) {
      try {
        this._stopSound();

        this._soundProc = new Gio.Subprocess({
          argv: ["paplay", path],
          flags: Gio.SubprocessFlags.NONE,
        });
        this._soundProc.init(null);
      } catch (e) {
        global.logError("timer@KopfdesDaemons: Error playing sound: " + e.message);
      }
    }
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

  on_desklet_removed() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
    this._stopSound();
    if (this._notificationSource) {
      this._notificationSource.destroy();
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
