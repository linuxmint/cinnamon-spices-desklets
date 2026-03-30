const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader("Alarm Clock");

    this._isReloading = false;
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

    // Bind settings
    this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-days", "alarmDays");
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-is-enabled", "alarmIsEnabled");
    this.settings.bindProperty(Settings.BindingDirection.IN, "am-pm", "amPm");
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-name", "alarmName", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "scale-size", "scaleSize", this._setupLayout);
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-hours", "alarmHours");
    this.settings.bindProperty(Settings.BindingDirection.IN, "alarm-minutes", "alarmMinutes");
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
  }

  on_desklet_removed() {
    if (this.settings && !this._isReloading) {
      this.settings.finalize();
    }
    if (this._clockUse24hId) {
      this._desktop_settings.disconnect(this._clockUse24hId);
      this._clockUse24hId = 0;
    }
  }

  on_desklet_reloaded() {
    this._isReloading = true;
  }

  _setupLayout() {
    const mainContainerStyle = `background-color: #282828; spacing: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 1.5}em; padding: ${this.scaleSize * 0.5}em;`;
    const mainContainer = new St.BoxLayout({ vertical: true, style: mainContainerStyle });

    mainContainer.add(new St.Label({ text: this.alarmName, style: `font-size: ${this.scaleSize * 1.5}em; font-weight: bold; text-align: center` }));

    const getShortWeekdays = (locale = undefined) => {
      const baseDate = new Date(2024, 0, 1);
      const weekdays = [];

      for (let i = 0; i < 7; i++) {
        const weekday = { number: i, shortName: baseDate.toLocaleString(locale, { weekday: "short" }) };
        weekdays.push(weekday);
        baseDate.setDate(baseDate.getDate() + 1);
      }

      return weekdays;
    };

    const dayButtonsRow = new St.BoxLayout({ style: `spacing: ${this.scaleSize * 0.2}em;` });
    const dayButtonStyle = `font-size: ${this.scaleSize * 1}em; padding: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 0.5}em;`;
    const weekdays = getShortWeekdays();
    for (const day of weekdays) {
      const dayButton = new St.Button({
        child: new St.Label({ text: day.shortName }),
        style: dayButtonStyle,
        style_class: "alarm-clock-day-button",
      });
      dayButton.connect("clicked", () => this._on_day_button_clicked(day.number));
      dayButtonsRow.add(dayButton);
      if (this.alarmDays.includes(day.number)) {
        dayButton.set_style(dayButtonStyle + `background-color: #363A58;`);
      }
    }

    mainContainer.add(dayButtonsRow);

    const inputsRow = new St.BoxLayout({ vertical: false, y_align: St.Align.MIDDLE });

    const getInput = initialText => {
      const entry = new St.Entry({
        hint_text: "00",
        style: `font-size: ${this.scaleSize * 2}em; padding: ${this.scaleSize * 0.3}em; border-radius: ${this.scaleSize * 0.5}em;`,
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

    const validateInput = (input, minutesOrHours) => {
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
        } else if (minutesOrHours === "minutes") {
          if (num > 59) {
            filteredText = "59";
          }
          this.alarmMinutes = filteredText;
        }
      }

      if (originalText !== filteredText) input.set_text(filteredText);
    };

    const submit = () => {
      this._setAlarm();
      global.stage.set_key_focus(null);
    };

    // Connect input events
    this.inputHours.clutter_text.connect("button-press-event", () => grabFocus(this.inputHours));
    this.inputMinutes.clutter_text.connect("button-press-event", () => grabFocus(this.inputMinutes));
    this.inputHours.clutter_text.connect("text-changed", () => validateInput(this.inputHours, "hours"));
    this.inputMinutes.clutter_text.connect("text-changed", () => validateInput(this.inputMinutes, "minutes"));
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
      this.alarmIsEnabled = !this.alarmIsEnabled;
      toggleButtonCircle.set_style(this.alarmIsEnabled ? toggleCircleStyleActive : toggleCircleStyleInactive);
      toggleButton.set_style(this.alarmIsEnabled ? aktiveToggleStyle : inaktiveToggleStyle);
    });

    inputsRow.add(new St.Bin({ x_expand: true }));
    const toggleBin = new St.Bin({ child: toggleButton });
    inputsRow.add(toggleBin);

    mainContainer.add(inputsRow);

    this.setContent(mainContainer);
  }

  _on_day_button_clicked(dayNumber) {
    if (!this.alarmDays.includes(dayNumber)) {
      this.alarmDays.push(dayNumber);
    } else {
      this.alarmDays = this.alarmDays.filter(day => day !== dayNumber);
    }
    this.settings.setValue("alarm-days", this.alarmDays);
    this._setupLayout();
  }

  _setAlarm() {
    const hours = this.inputHours.get_text();
    const minutes = this.inputMinutes.get_text();

    global.log(`Alarm set to: ${hours}:${minutes}`);
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
