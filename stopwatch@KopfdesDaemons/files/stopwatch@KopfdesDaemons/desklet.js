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

    this.fontSize = this.settings.getValue("fontSize") || 20;
    this.colorLabel = this.settings.getValue("colorLabel") || "rgb(51, 209, 122)";
    this._timeout = null;
    this._startTime = 0;
    this._elapsedTime = 0;
    this._isRunning = false;

    this.setHeader(_("Stoppuhr"));
    this._setupLayout();
  }

  _setupLayout() {
    this.timeLabel = this._createLabel(_("00.000"), this.colorLabel);

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

    this.buttonRow = new St.BoxLayout();
    this.buttonRow.add_child(this.playButton);
    this.buttonRow.add_child(this.pauseButton);
    this.buttonRow.add_child(this.stopButton);

    this.contentLayout = new St.BoxLayout({
      vertical: false,
      y_align: St.Align.MIDDLE,
    });
    this.contentLayout.add_child(this.buttonRow);

    this.timeLabelContainer = new St.Bin({
      child: this.timeLabel,
      x_align: St.Align.END,
      y_align: St.Align.MIDDLE,
    });
    this.contentLayout.add_child(this.timeLabelContainer);

    this.setContent(this.contentLayout);
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
}

function main(metadata, deskletId) {
  return new StopwatchDesklet(metadata, deskletId);
}
