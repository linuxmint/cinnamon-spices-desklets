const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;

const Desklet = imports.ui.desklet;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Util = imports.misc.util;
const UPowerGlib = imports.gi.UPowerGlib;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const SignalManager = imports.misc.signalManager;

const UUID = "analog-clock@cobinja.de";

const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

const DEG_PER_SECOND = 360 / 60;
const DEG_PER_HOUR = 360 / 12;
const MARGIN = 5;

function getImageAtScale(imageFileName, scale) {
  let width, height, fileInfo;
  [fileInfo, width, height] = GdkPixbuf.Pixbuf.get_file_info(imageFileName, null, null);
  
  let scaledWidth = scale * width;
  let scaledHeight = scale * height;
  
  let pixBuf = GdkPixbuf.Pixbuf.new_from_file_at_size(imageFileName, scaledWidth, scaledHeight);
  let image = new Clutter.Image();
  image.set_data(
    pixBuf.get_pixels(),
    pixBuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGBA_888,
    scaledWidth, scaledHeight,
    pixBuf.get_rowstride()
  );
  
  let actor = new Clutter.Actor({width: scaledWidth, height: scaledHeight});
  actor.set_content(image);
  
  return {actor: actor, origWidth: width, origHeight: height};
}

function CobiAnalogClockSettings(instanceId) {
  this._init(instanceId);
}

CobiAnalogClockSettings.prototype = {
  _init: function(instanceId) {
    this._instanceId = instanceId;
    this._signalManager = new SignalManager.SignalManager(this);
    this.values = {};
    
    let settingsDirName = GLib.get_user_config_dir();
    if (!settingsDirName) {
      settingsDirName = GLib.get_home_dir() + "/.config";
    }
    settingsDirName += "/cobinja/" + UUID;
    this._settingsDir = Gio.file_new_for_path(settingsDirName);
    if (!this._settingsDir.query_exists(null)) {
      this._settingsDir.make_directory_with_parents(null);
    }
    
    this._settingsFile = this._settingsDir.get_child(this._instanceId + ".json");
    if (!this._settingsFile.query_exists(null)) {
      this._getDefaultSettingsFile().copy(this._settingsFile, 0, null, null);
    }
    
    this._onSettingsChanged();
    
    this._upgradeSettings();
    
    this._monitor = this._settingsFile.monitor(Gio.FileMonitorFlags.NONE, null);
    this._signalManager.connect(this._monitor, "changed", this._onSettingsChanged);
  },
  
  _getDefaultSettingsFile: function() {
    return Gio.file_new_for_path(DESKLET_DIR + "/default_settings.json");
  },
  
  _onSettingsChanged: function() {
    let settings;
    try {
      settings = JSON.parse(Cinnamon.get_file_contents_utf8_sync(this._settingsFile.get_path()));
    }
    catch (e) {
      global.logError("Could not parse CobiAnalogClock's settings.json", e)
      return true;
    }
    
    for (let key in settings) {
      if (settings.hasOwnProperty(key)) {
        let comparison;
        if (settings[key] instanceof Array) {
          comparison = !compareArray(this.values[key], settings[key]);
        }
        else {
          comparison = this.values[key] !== settings[key];
        }
        if (comparison) {
          this.values[key] = settings[key];
          this.emit(key + "-changed", this.values[key]);
        }
      }
    }
    return true;
  },
  
  _upgradeSettings: function() {
    let defaultSettings;
    try {
      defaultSettings = JSON.parse(Cinnamon.get_file_contents_utf8_sync(this._getDefaultSettingsFile().get_path()));
    }
    catch (e) {
      global.logError("Could not parse CobiAnalogClock's default_settings.json", e);
      return true;
    }
    for (let key in defaultSettings) {
      if (defaultSettings.hasOwnProperty(key) && !(key in this.values)) {
        this.values[key] = defaultSettings[key];
      }
    }
    for (let key in this.values) {
      if (this.values.hasOwnProperty(key) && !(key in defaultSettings)) {
        delete this.values[key];
      }
    }
    this._writeSettings();
    return false;
  },
    
  setValue: function(key, value) {
    if (!compareArray(value, this.values[key])) {
      this.values[key] = value;
      this.emit(key + "-changed", this.values[key]);
      this._writeSettings();
    }
  },
  
  _writeSettings: function() {
    let filedata = JSON.stringify(this.values, null, "  ");
    GLib.file_set_contents(this._settingsFile.get_path(), filedata, filedata.length);
  },
  
  destroy: function() {
    this._signalManager.disconnectAllSignals();
    this._monitor.cancel();
    this.values = null;
  }
}

Signals.addSignalMethods(CobiAnalogClockSettings.prototype);

function CobiAnalogClock(metadata, instanceId){
    this._init(metadata, instanceId);
}

CobiAnalogClock.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function(metadata, instanceId){
    Desklet.Desklet.prototype._init.call(this, metadata, instanceId);
    this._signalManager = new SignalManager.SignalManager(this);
    this._settings = new CobiAnalogClockSettings(instanceId);
    
    this._displayTime = new GLib.DateTime();

    this._menu.addAction(_("Settings"), Lang.bind(this, function() {Util.spawnCommandLine(DESKLET_DIR + "/settings.py " + instanceId);}));
  },
  
  on_desklet_added_to_desktop: function(userEnabled) {
    this.metadata["prevent-decorations"] = this._settings.values["hide-decorations"];
    this._updateDecoration();
    
    this._clockSize = this._settings.values["size"] * global.ui_scale;
    
    this._clockActor = new St.Group();
    
    this._tzLabel = new St.Label();
    
    this.setHeader(_("Clock"));
    this.setContent(this._clockActor);
    
    this._onSizeChanged();
    
    let currentMillis = new Date().getMilliseconds();
    let timeoutMillis = (1000 - currentMillis) % 1000;
    
    this._signalManager.connect(global, "scale-changed", this._onSizeChanged);
    this._signalManager.connect(this._settings, "size-changed", this._onSizeChanged);
    this._signalManager.connect(this._settings, "theme-changed", this._onThemeChanged);
    this._signalManager.connect(this._settings, "hide-decorations-changed", this._onHideDecorationsChanged);
    this._signalManager.connect(global.settings, "changed::desklet-decorations", this._onHideDecorationsChanged);
    this._signalManager.connect(this._settings, "show-seconds-changed", this._onShowSecondsChanged);
    
    this._signalManager.connect(this._settings, "timezone-use-changed", this._onTimezoneChanged);
    this._signalManager.connect(this._settings, "timezone-changed", this._onTimezoneChanged);
    this._signalManager.connect(this._settings, "timezone-display-changed", this._onTimezoneDisplayChanged);
    
    this._upClient = new UPowerGlib.Client();
    try {
      this._upClient.connect('notify-resume', Lang.bind(this, this._onPowerResume));
    }
    catch (e) {
      this._upClient.connect('notify::resume', Lang.bind(this, this._onPowerResume));
    }
    this._onTimezoneChanged();
  },
  
  _onPowerResume: function() {
    this._initialUpdate = true;
    this._updateClock();
  },
  
  _loadTheme: function() {
    let themeName = this._settings.values["theme"];
    let themesDir = Gio.file_new_for_path(DESKLET_DIR + "/themes");
    let themeDir = themesDir.get_child(themeName);
    let metaDataFile = themeDir.get_child("metadata.json");
    let metaData = JSON.parse(Cinnamon.get_file_contents_utf8_sync(metaDataFile.get_path()));
    
    let clock = {"size": metaData["size"], "tz-label": metaData["tz-label"]};
    let scale = this._clockSize / clock["size"];
    
    let bodyFileName = metaData["body"];
    let body = getImageAtScale(themeDir.get_child(bodyFileName).get_path(), scale);
    clock.body = body;
    
    let clockfaceFileName = metaData["clockface"];
    let clockface = getImageAtScale(themeDir.get_child(clockfaceFileName).get_path(), scale);
    clock.clockface = clockface;
    
    let frameFileName = metaData["frame"];
    let frame = getImageAtScale(themeDir.get_child(frameFileName).get_path(), scale);
    clock.frame = frame;
    
    let hourFileName = metaData["hour"]["fileName"];
    let hour = getImageAtScale(themeDir.get_child(hourFileName).get_path(), scale);
    hour.pivotX = metaData["hour"]["pivot-x"];
    hour.pivotY = metaData["hour"]["pivot-y"];
    clock.hour = hour;
    
    let minuteFileName = metaData["minute"]["fileName"];
    let minute = getImageAtScale(themeDir.get_child(minuteFileName).get_path(), scale);
    minute.pivotX = metaData["minute"]["pivot-x"];
    minute.pivotY = metaData["minute"]["pivot-y"];
    clock.minute = minute;
    
    let secondFileName = metaData["second"]["fileName"];
    let second = getImageAtScale(themeDir.get_child(secondFileName).get_path(), scale);
    second.pivotX = metaData["second"]["pivot-x"];
    second.pivotY = metaData["second"]["pivot-y"];
    clock.second = second;
    
    return clock;
  },
  
  _loadClock: function() {
    let newClock = this._loadTheme();
    this._clock = newClock;
    this._clockActor.remove_all_children();
    
    this._clockActor.set_style(this._clock["tz-label"]);
    this._clockActor.add_actor(this._clock.body.actor);
    this._clock.body.actor.set_position(MARGIN * global.ui_scale, MARGIN * global.ui_scale);
    
    this._clockActor.add_actor(this._clock.clockface.actor);
    this._clock.clockface.actor.set_position(MARGIN * global.ui_scale, MARGIN * global.ui_scale);
    
    // add timezone label
    this._clockActor.add_actor(this._tzLabel);
    //this._tzLabel.set_style(this._clock["tz-label"]);
    this._updateTzLabel();
    
    // add hands
    let hour = this._clock.hour;
    this._clockActor.add_actor(hour.actor);
    let pivotPoint = {};
    pivotPoint.x = hour.pivotX / hour.origWidth;
    pivotPoint.y = hour.pivotY / hour.origHeight;
    hour.actor.set_pivot_point(pivotPoint.x, pivotPoint.y);
    hour.actor.set_position(((this._clockSize / 2) - pivotPoint.x * hour.actor.size.width) + MARGIN * global.ui_scale,
                                        (this._clockSize / 2) - pivotPoint.y * hour.actor.size.height + MARGIN * global.ui_scale);
    
    let minute = this._clock.minute;
    this._clockActor.add_actor(minute.actor);
    pivotPoint.x = minute.pivotX / minute.origWidth;
    pivotPoint.y = minute.pivotY / minute.origHeight;
    minute.actor.set_pivot_point(pivotPoint.x, pivotPoint.y);
    minute.actor.set_position((this._clockSize / 2) - pivotPoint.x * minute.actor.size.width + MARGIN * global.ui_scale,
                                          (this._clockSize / 2) - pivotPoint.y * minute.actor.size.height + MARGIN * global.ui_scale);
    
    let second = this._clock.second;
    this._clockActor.add_actor(second.actor);
    pivotPoint.x = second.pivotX / second.origWidth;
    pivotPoint.y = second.pivotY / second.origHeight;
    second.actor.set_pivot_point(pivotPoint.x, pivotPoint.y);
    second.actor.set_position((this._clockSize / 2) - pivotPoint.x * second.actor.size.width + MARGIN * global.ui_scale,
                                          (this._clockSize / 2) - pivotPoint.y * second.actor.size.height + MARGIN * global.ui_scale);
    
    this._clockActor.add_actor(this._clock.frame.actor);
    this._clock.frame.actor.set_position(MARGIN * global.ui_scale, MARGIN * global.ui_scale);
    
    this._initialUpdate = true;
  },
  
  _onThemeChanged: function() {
    Mainloop.source_remove(this._timeoutId);
    try {
      this._loadClock();
    }
    catch (e) {
      global.logError("Could not load analog clock theme", e);
    }
    this._updateClock();
  },
  
  _onSizeChanged: function() {
    let size = this._settings.values["size"] * global.ui_scale;
    this._clockActor.set_width(size + 2 * MARGIN * global.ui_scale);
    this._clockActor.set_height(size + 2 * MARGIN * global.ui_scale);
    this._clockSize = size;
    this._loadClock();
    this._updateClock();
  },
  
  _onShowSecondsChanged: function() {
    let showSeconds = this._settings.values["show-seconds"];
    showSeconds ? this._clock.second.actor.show() : this._clock.second.actor.hide();
    this._updateClock();
  },
  
  _onHideDecorationsChanged: function() {
    this.metadata["prevent-decorations"] = this._settings.values["hide-decorations"];
    this._updateDecoration();
    this._updateTzLabel();
  },
  
  _onTimezoneChanged: function() {
    let tz = this._settings.values["timezone"];
    let zoneName = tz["region"];
    if (tz["city"] != "") {
      zoneName += "/" + tz["city"];
    }
    let zoneDirName = "/usr/share/zoneinfo/";
    let zoneDir = Gio.file_new_for_path(zoneDirName);
    let tzId = zoneDirName + tz["region"];
    if (tz["city"]) {
      tzId += "/" + tz["city"];
    }
    tzId = tzId.replace(" ", "_");
    let tzFile = Gio.file_new_for_path(tzId);
    this._tzId = tzFile.query_exists(null) ? ":" + tzId : null;
    this._updateHeader();
    this._updateTzLabel();
    this._updateClock();
  },
  
  _onTimezoneDisplayChanged: function() {
    this._updateHeader();
    this._updateTzLabel();
  },
  
  _getTzLabelText: function() {
    let result = _("Clock");
    if (this._settings.values["timezone-use"] && this._settings.values["timezone-display"]) {
      let tz = this._settings.values["timezone"];
      if (tz["city"] && tz["city"] != "") {
        result = tz["city"];
      }
      else {
        result = tz["region"];
      }
    }
    return result;
  },
  
  _updateTzLabel: function() {
    let showLabel = (this._settings.values["hide-decorations"] || global.settings.get_int("desklet-decorations") <= 1) &&
                     this._settings.values["timezone-use"] &&
                     this._settings.values["timezone-display"];
    if (showLabel) {
      this._tzLabel.set_text(this._getTzLabelText());
      let themeFontSize = this._clockActor.get_theme_node().get_length("font-size");
      let fontSize = themeFontSize * this._clockSize / (this._clock["size"] * global.ui_scale);
      this._tzLabel.set_style("font-size: " + fontSize + "px;");
      let lSize = this._tzLabel.size;
      let aSize = this._clockActor.size;
      let x = Math.round((aSize.width - lSize.width) / 2.0);
      let y = Math.round((aSize.height - lSize.height) * 2 / 3.0);
      this._tzLabel.set_position(x, y);
      this._tzLabel.show();
    }
    else {
      this._tzLabel.hide();
    }
  },
  
  _updateHeader: function() {
    this.setHeader(this._getTzLabelText());
  },
  
  _updateClock: function() {
    if (this._inRemoval != undefined) {
      return false;
    }
    this._displayTime = new GLib.DateTime();
    if (this._settings.values["timezone-use"] && this._tzId != null) {
      let tz = GLib.TimeZone.new(this._tzId);
      this._displayTime = this._displayTime.to_timezone(tz);
    }
    
    let newTimeoutSeconds = 1;
    if (!this._settings.values["show-seconds"]) {
      let seconds = this._displayTime.get_second();
      newTimeoutSeconds = 60 - seconds;
    }
    
    let hours = this._displayTime.get_hour() % 12;
    let minutes = this._displayTime.get_minute() % 60;
    let seconds = this._displayTime.get_second() % 60;
    
    if (seconds == 0 || this._initialUpdate) {
      if (minutes % 2 == 0 || this._initialUpdate) {
        this._clock.hour.actor.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, DEG_PER_HOUR * hours + (minutes * 0.5));
      }
      this._clock.minute.actor.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, DEG_PER_SECOND * minutes);
      this._initialUpdate = false;
    }
    if (this._settings.values["show-seconds"]) {
      this._clock.second.actor.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, DEG_PER_SECOND * seconds);
    }
    
    this._timeoutId = Mainloop.timeout_add_seconds(newTimeoutSeconds, Lang.bind(this, this._updateClock));
    return false;
  },
  
  on_desklet_removed: function() {
    this._inRemoval = true;
    if (this._timeoutId != undefined) {
      Mainloop.source_remove(this._timeoutId);
    }
    this._signalManager.disconnectAllSignals();
    this._settings.destroy();
  }
}

function main(metadata, instanceId){
  let desklet = new CobiAnalogClock(metadata, instanceId);
  return desklet;
}
