const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

const UUID = "alarm-clock@KopfdesDaemons";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader(_("Alarm Clock"));

    this._isReloading = false;
    this._notificationSource = null;
    this._currentNotification = null;
    this._soundProc = null;
    this._lastClockUse24h = undefined;

    this.clock = new CinnamonDesktop.WallClock();
    this.clock_notify_id = 0;

    // Listen for changes in the system clock format (12h/24h) to update the layout accordingly
    this._desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
    this._clockUse24hId = this._desktop_settings.connect("changed::clock-use-24h", () => this._setupLayout());

    // Default settings
    this.scaleSize = 1;
    this.alarmName = "Alarm";
    this.alarmDays = [];
    this.alarmIsEnabled = false;
    this.amPm = "am";
    this.alarmHours = "";
    this.alarmMinutes = "";
    this.soundFile = "complete.oga";
    this.useCustomSound = false;
    this.customSoundFile = "";

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-days", "alarmDays");
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-is-enabled", "alarmIsEnabled");
    this.settings.bindProperty(Settings.BindingDirection.IN, "am-pm", "amPm");
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-name", "alarmName", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-hours", "alarmHours");
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-minutes", "alarmMinutes");
    this.settings.bindProperty(Settings.BindingDirection.IN, "sound-file", "soundFile", null);
    this.settings.bindProperty(Settings.BindingDirection.IN, "use-custom-sound", "useCustomSound", null);
    this.settings.bindProperty(Settings.BindingDirection.IN, "custom-sound-file", "customSoundFile", null);
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
    if (this.alarmIsEnabled) {
      this._setAlarm();
    }
  }

  on_desklet_removed() {
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
    if (this._clockUse24hId) {
      this._desktop_settings.disconnect(this._clockUse24hId);
      this._clockUse24hId = 0;
    }
    this._clearAlarmTimeOut();
    if (this._notificationSource) {
      this._notificationSource.destroy();
    }
    this._stopSound();
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _setupLayout() {
    this._convertTimeFormat();

    const mainContainerStyle = `background-color: #282828; spacing: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 1.5}em; padding: ${this.scaleSize * 0.5}em;`;
    const mainContainer = new St.BoxLayout({ vertical: true, style: mainContainerStyle });

    mainContainer.add(new St.Label({ text: this.alarmName, style: `font-size: ${this.scaleSize * 1.5}em; font-weight: bold; text-align: center` }));

    const getShortWeekdays = (locale = undefined) => {
      const baseDate = new Date(2024, 0, 1); // Start on a Monday
      const weekdays = [];

      for (let i = 0; i < 7; i++) {
        const weekday = { number: i + 1, shortName: baseDate.toLocaleString(locale, { weekday: "short" }) };
        weekdays.push(weekday);
        baseDate.setDate(baseDate.getDate() + 1);
      }

      return weekdays;
    };

    const dayButtonsRow = new St.BoxLayout({ style: `spacing: ${this.scaleSize * 0.2}em;` });
    const dayButtonStyle = `font-size: ${this.scaleSize * 1}em; padding: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 0.5}em;`;
    const weekdays = getShortWeekdays();

    // Create a button for each weekday
    for (const day of weekdays) {
      const dayButton = new St.Button({
        child: new St.Label({ text: day.shortName }),
        style: dayButtonStyle,
        style_class: "alarm-clock-day-button",
      });

      dayButton.connect("clicked", () => this._onDayButtonClicked(day.number));
      dayButtonsRow.add(dayButton);

      // Highlight the button if it's one of the selected alarm days
      if (this.alarmDays.includes(day.number)) {
        dayButton.set_style(dayButtonStyle + `background-color: #363A58;`);
      }
    }

    mainContainer.add(dayButtonsRow);

    const inputsRow = new St.BoxLayout({ vertical: false, y_align: St.Align.MIDDLE });

    const getInput = initialText => {
      const entry = new St.Entry({
        hint_text: "00",
        style: `font-size: ${this.scaleSize * 2}em; padding: ${this.scaleSize * 0.3}em; border-radius: 0.5em;`,
        reactive: true,
        track_hover: true,
        style_class: "alarm-clock-input",
      });
      if (initialText) entry.set_text(initialText);
      return entry;
    };

    this.inputHours = getInput(this.alarmHours);
    inputsRow.add(this.inputHours);

    const separator = new St.Bin({ child: new St.Label({ text: ":" }), style: `font-size: ${this.scaleSize * 2}em; padding: 0 ${this.scaleSize * 0.05}em;` });
    inputsRow.add(separator);

    this.inputMinutes = getInput(this.alarmMinutes);
    inputsRow.add(this.inputMinutes);

    // Function for input events
    const grabFocus = input => {
      global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
      input.grab_key_focus();
      global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    };

    const submit = () => {
      this._setAlarm();
      global.stage.set_key_focus(null);
    };

    // Connect input events
    this.inputHours.clutter_text.connect("button-press-event", () => grabFocus(this.inputHours));
    this.inputMinutes.clutter_text.connect("button-press-event", () => grabFocus(this.inputMinutes));
    this.inputHours.clutter_text.connect("text-changed", () => this._validateInput(this.inputHours, "hours"));
    this.inputMinutes.clutter_text.connect("text-changed", () => this._validateInput(this.inputMinutes, "minutes"));
    this.inputMinutes.clutter_text.connect("activate", () => submit());
    this.inputHours.clutter_text.connect("activate", () => submit());

    this.inputHours.clutter_text.connect("key-press-event", (actor, event) => {
      const symbol = event.get_key_symbol();
      if (symbol === Clutter.KEY_Tab) {
        grabFocus(this.inputMinutes);
        return true;
      }
      return false;
    });

    this.inputMinutes.clutter_text.connect("key-press-event", (actor, event) => {
      const symbol = event.get_key_symbol();
      if (symbol === Clutter.KEY_ISO_Left_Tab) {
        // Shift+Tab
        grabFocus(this.inputHours);
        return true;
      }
      return false;
    });

    if (!this._desktop_settings.get_boolean("clock-use-24h")) {
      const amPmButton = new St.Button({
        child: new St.Label({ text: this.amPm.toUpperCase(), style: `font-size: ${this.scaleSize * 1.5}em;` }),
        style: `padding: ${this.scaleSize * 0.2}em; margin: 0 ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 0.5}em;`,
        style_class: "alarm-clock-am-pm-button",
      });

      amPmButton.connect("clicked", () => {
        this.amPm = this.amPm === "am" ? "pm" : "am";
        amPmButton.get_child().set_text(this.amPm.toUpperCase());
      });

      const box = new St.Bin({ child: amPmButton, y_align: St.Align.START });
      inputsRow.add(box);
    }

    // Inner circle of the toggle button
    const baseToggleCircleStyle = `border-radius: ${this.scaleSize * 0.8}em; width: ${this.scaleSize * 1.5}em; height: ${this.scaleSize * 1.5}em;`;
    const toggleCircleStyleInactive = `margin-left: auto; margin-right: ${this.scaleSize * 1.5}em; ${baseToggleCircleStyle} background-color: #353535;`;
    const toggleCircleStyleActive = `margin-right: auto; margin-left: ${this.scaleSize * 1.5}em; ${baseToggleCircleStyle} background-color: #202020;`;
    const currentToggleCircleStyle = this.alarmIsEnabled ? toggleCircleStyleActive : toggleCircleStyleInactive;
    const toggleButtonCircle = new St.Bin({ style: currentToggleCircleStyle });

    // Toggle button
    const baseToggleStyle = `padding: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 3}em;`;
    const aktiveToggleStyle = `background-color: #35a854; ${baseToggleStyle}`;
    const inaktiveToggleStyle = `background-color: #5b5b5b; ${baseToggleStyle}`;
    const currentToggleStyle = this.alarmIsEnabled ? aktiveToggleStyle : inaktiveToggleStyle;
    const toggleButton = new St.Button({
      child: toggleButtonCircle,
      style: currentToggleStyle,
    });

    // Connect toggle button click event
    toggleButton.connect("clicked", () => {
      this._toggleAlarm();
      toggleButtonCircle.set_style(this.alarmIsEnabled ? toggleCircleStyleActive : toggleCircleStyleInactive);
      toggleButton.set_style(this.alarmIsEnabled ? aktiveToggleStyle : inaktiveToggleStyle);
    });

    inputsRow.add(new St.Bin({ x_expand: true }));
    const toggleBin = new St.Bin({ child: toggleButton });
    inputsRow.add(toggleBin);

    mainContainer.add(inputsRow);

    this.setContent(mainContainer);
  }

  _validateInput = (input, minutesOrHours) => {
    const use24h = this._desktop_settings.get_boolean("clock-use-24h");
    const originalText = input.get_text();

    let filteredText = originalText.replace(/[^0-9]/g, "");

    if (filteredText.length > 2) {
      filteredText = filteredText.slice(0, 2);
    }

    if (filteredText) {
      let num = parseInt(filteredText, 10);

      if (minutesOrHours === "hours") {
        const maxHours = use24h ? 23 : 12;
        if (num > maxHours) {
          filteredText = maxHours.toString();
        }
        this.alarmHours = filteredText;
        this.settings.setValue("alarm-hours", this.alarmHours);
      } else if (minutesOrHours === "minutes") {
        if (num > 59) {
          filteredText = "59";
        }
        this.alarmMinutes = filteredText;
        this.settings.setValue("alarm-minutes", this.alarmMinutes);
      }
    }

    if (originalText !== filteredText) input.set_text(filteredText);
  };

  _convertTimeFormat() {
    const use24h = this._desktop_settings.get_boolean("clock-use-24h");
    let currentHours = parseInt(this.alarmHours, 10);

    if (!isNaN(currentHours)) {
      // If the clock format has changed since the last setup, convert the alarm hours accordingly
      if (this._lastClockUse24h !== undefined && this._lastClockUse24h !== use24h) {
        if (!use24h) {
          // Convert to 12h format
          if (currentHours >= 24) currentHours = 0;
          if (currentHours > 12) {
            this.alarmHours = (currentHours - 12).toString().padStart(2, "0");
            this.amPm = "pm";
          } else if (currentHours === 0) {
            this.alarmHours = "12";
            this.amPm = "am";
          } else if (currentHours === 12) {
            this.amPm = "pm";
          } else {
            this.amPm = "am";
          }
        } else {
          // Convert to 24h format
          if (this.amPm === "pm" && currentHours < 12) {
            this.alarmHours = (currentHours + 12).toString().padStart(2, "0");
          } else if (this.amPm === "am" && currentHours === 12) {
            this.alarmHours = "00";
          } else {
            this.alarmHours = currentHours.toString().padStart(2, "0");
          }
        }
      } else if (!use24h && (currentHours > 12 || currentHours === 0)) {
        // Convert to 12h format
        if (currentHours >= 24) currentHours = 0;
        if (currentHours > 12) {
          this.alarmHours = (currentHours - 12).toString().padStart(2, "0");
          this.amPm = "pm";
        } else if (currentHours === 0) {
          this.alarmHours = "12";
          this.amPm = "am";
        }
      }
    }
    this._lastClockUse24h = use24h;
  }

  _onDayButtonClicked(dayNumber) {
    if (!this.alarmDays.includes(dayNumber)) {
      this.alarmDays.push(dayNumber);
    } else {
      this.alarmDays = this.alarmDays.filter(day => day !== dayNumber);
    }
    this.settings.setValue("alarm-days", this.alarmDays);
    this._setupLayout();
  }

  _toggleAlarm() {
    this.alarmIsEnabled = !this.alarmIsEnabled;
    if (this.alarmIsEnabled) {
      this._setAlarm();
      this._sendRemainingTimeNotification();
    } else {
      this._clearAlarmTimeOut();
      if (this._currentNotification) {
        this._currentNotification.destroy();
      }
      this._stopSound();
    }
  }

  _sendRemainingTimeNotification() {
    const now = new Date();

    // Get alarm time
    let alarmHours = parseInt(this.alarmHours, 10);
    const alarmMinutes = parseInt(this.alarmMinutes, 10);

    if (isNaN(alarmHours) || isNaN(alarmMinutes)) return;

    const use24h = this._desktop_settings.get_boolean("clock-use-24h");

    // Convert alarm hours to 24h format for calculation
    if (!use24h) {
      if (this.amPm === "pm" && alarmHours < 12) {
        alarmHours += 12;
      } else if (this.amPm === "am" && alarmHours === 12) {
        alarmHours = 0;
      }
    }

    let nextAlarmDate = null;

    // Check the next 7 days for the next active alarm day and time
    for (let i = 0; i <= 7; i++) {
      const testDate = new Date(now.getTime());
      testDate.setDate(testDate.getDate() + i);
      testDate.setHours(alarmHours, alarmMinutes, 0, 0);

      const jsDay = testDate.getDay();
      const isDayActive = this.alarmDays.includes(jsDay) || (jsDay === 0 && this.alarmDays.includes(7));

      if (isDayActive && testDate > now) {
        nextAlarmDate = testDate;
        break;
      }
    }

    if (nextAlarmDate) {
      // Calculate the difference between now and the next alarm time
      const diffMs = nextAlarmDate - now;
      const diffMinutes = Math.floor(diffMs / 60000);

      // Convert the difference into days, hours, and minutes
      const days = Math.floor(diffMinutes / (24 * 60));
      const hours = Math.floor((diffMinutes % (24 * 60)) / 60);
      const minutes = diffMinutes % 60;

      let timeParts = [];
      if (days > 0) timeParts.push(`${days} ` + _("day(s)"));
      if (hours > 0) timeParts.push(`${hours} ` + _("hour(s)"));
      if (minutes > 0 || timeParts.length === 0) timeParts.push(`${minutes} ` + _("minute(s)"));

      const message = _("Alarm is set for in") + ` ${timeParts.join(", ")}.`;
      this._sendNotification(this.alarmName || _("Alarm Clock"), message);
    } else {
      this._sendNotification(this.alarmName || _("Alarm Clock"), _("No active alarm days selected."));
    }
  }

  _setAlarm() {
    this._clearAlarmTimeOut();

    if (this.clock_notify_id === 0) {
      this.clock_notify_id = this.clock.connect("notify::clock", () => this._checkAlarm());
    }

    this._checkAlarm();
  }

  _checkAlarm() {
    const now = new Date();

    // Check if today is one of the alarm days
    const todayWeekdayNumber = now.getDay();

    if (!this.alarmDays.includes(todayWeekdayNumber) && !(todayWeekdayNumber === 0 && this.alarmDays.includes(7))) return;

    // Get current hours and minutes and alarm hours and minutes as numbers
    const hours = now.getHours();
    const minutes = now.getMinutes();
    let alarmHours = parseInt(this.alarmHours, 10);
    const alarmMinutes = parseInt(this.alarmMinutes, 10);

    if (isNaN(alarmHours) || isNaN(alarmMinutes)) return;

    const use24h = this._desktop_settings.get_boolean("clock-use-24h");

    if (!use24h) {
      // Convert alarm hours to 24h format for comparison
      if (this.amPm === "pm" && alarmHours < 12) {
        alarmHours += 12;
      } else if (this.amPm === "am" && alarmHours === 12) {
        alarmHours = 0;
      }
    }

    // Call the alarm if the current time is past the alarm time
    if (hours > alarmHours || (hours === alarmHours && minutes >= alarmMinutes)) {
      this._callAlarm();
    }
  }

  _callAlarm() {
    this._clearAlarmTimeOut();
    this._playSound();

    const title = this.timerName || _("Alarm Clock");
    const message = _("Alarm ringing!");

    this._sendNotification(title, message, () => {
      this._stopSound();
    });
  }

  _sendNotification(title, message, callback = null) {
    if (!this._notificationSource) {
      this._notificationSource = new MessageTray.SystemNotificationSource();
      Main.messageTray.add(this._notificationSource);
    }
    const icon = new St.Icon({
      icon_name: "alarm-symbolic",
      icon_type: St.IconType.SYMBOLIC,
    });
    this._currentNotification = new MessageTray.Notification(this._notificationSource, title, message, { icon: icon });
    this._currentNotification.setTransient(false);
    this._currentNotification.connect("destroy", () => {
      if (callback) callback();
      this._currentNotification = null;
    });
    this._notificationSource.notify(this._currentNotification);
  }

  _clearAlarmTimeOut() {
    if (this.clock_notify_id > 0) {
      this.clock.disconnect(this.clock_notify_id);
      this.clock_notify_id = 0;
    }
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
        global.logError(UUID + ": Error playing sound: " + e.message);
      }
    }
  }

  _stopSound() {
    if (this._soundProc) {
      this._soundProc.force_exit();
      this._soundProc = null;
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
