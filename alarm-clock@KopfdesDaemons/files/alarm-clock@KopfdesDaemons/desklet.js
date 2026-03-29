const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Cinnamon = imports.gi.Cinnamon;

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);
    this.setHeader("Alarm Clock");

    this.alarmTime = null;
    this.timeout = null;
    this.alarmIsEnabled = false;

    //  Default settings
    this.scaleSize = 1;
    this.alarmName = "Alarm";
  }

  on_desklet_added_to_desktop() {
    this._setupLayout();
  }

  on_desklet_removed_from_desktop() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  }

  _setupLayout() {
    const mainContainerStyle = `background-color: #282828; spacing: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 1.5}em; padding: ${this.scaleSize * 0.5}em;`;
    const mainContainer = new St.BoxLayout({ vertical: true, style: mainContainerStyle });

    mainContainer.add(new St.Label({ text: this.alarmName, style: `font-size: ${this.scaleSize * 1.5}em; font-weight: bold; text-align: center` }));

    const getShortWeekdays = (locale = undefined) => {
      const baseDate = new Date(2024, 0, 1);
      const weekdays = [];

      for (let i = 0; i < 7; i++) {
        weekdays.push(baseDate.toLocaleString(locale, { weekday: "short" }));
        baseDate.setDate(baseDate.getDate() + 1);
      }

      return weekdays;
    };

    const dayButtonsRow = new St.BoxLayout({ style: `spacing: ${this.scaleSize * 0.2}em;` });
    const weekdays = getShortWeekdays();
    for (const day of weekdays) {
      const dayButton = new St.Button({
        child: new St.Label({ text: day }),
        style: `font-size: ${this.scaleSize * 1}em; padding: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 0.5}em;`,
        style_class: "alarm-clock-day-button",
      });
      dayButtonsRow.add(dayButton);
    }

    mainContainer.add(dayButtonsRow);

    const getInput = () => {
      return new St.Entry({
        text: "00",
        style: `font-size: ${this.scaleSize * 2}em; padding: ${this.scaleSize * 0.3}em; border-radius: ${this.scaleSize * 0.5}em;`,
        reactive: true,
        track_hover: true,
        style_class: "alarm-clock-input",
      });
    };

    this.inputHours = getInput();
    this.inputMinutes = getInput();

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
    this.inputMinutes.clutter_text.connect("activate", () => submit());
    this.inputHours.clutter_text.connect("activate", () => submit());

    const separator = new St.Bin({ child: new St.Label({ text: ":" }), style: `font-size: ${this.scaleSize * 2}em; padding: 0 ${this.scaleSize * 0.05}em;` });

    // Inner circle of the toggle button
    const baseToggleCircleStyle = `border-radius: ${this.scaleSize * 0.8}em; width: ${this.scaleSize * 1.5}em; height: ${this.scaleSize * 1.5}em;`;
    const toggleCircleStyleInactive = `margin-left: auto; margin-right: ${this.scaleSize * 1.5}em; ${baseToggleCircleStyle} background-color: #353535;`;
    const toggleCircleStyleActive = `margin-right: auto; margin-left: ${this.scaleSize * 1.5}em; ${baseToggleCircleStyle} background-color: #202020;`;
    const toggleButtonCircle = new St.Bin({ style: toggleCircleStyleInactive });

    // Toggle button
    const baseToggleStyle = `padding: ${this.scaleSize * 0.2}em; border-radius: ${this.scaleSize * 3}em;`;
    const aktiveToggleStyle = `background-color: #35a854; ${baseToggleStyle}`;
    const inaktiveToggleStyle = `background-color: #5b5b5b; ${baseToggleStyle}`;
    const toggleButton = new St.Button({
      child: toggleButtonCircle,
      style: inaktiveToggleStyle,
    });

    // Connect toggle button click event
    toggleButton.connect("clicked", () => {
      this.alarmIsEnabled = !this.alarmIsEnabled;
      toggleButtonCircle.set_style(this.alarmIsEnabled ? toggleCircleStyleActive : toggleCircleStyleInactive);
      toggleButton.set_style(this.alarmIsEnabled ? aktiveToggleStyle : inaktiveToggleStyle);
    });

    // Container for the toggle button for alignment
    const toggleBin = new St.Bin({ child: toggleButton });

    // Add elements to the inputs row
    const inputsRow = new St.BoxLayout({ vertical: false, y_align: St.Align.MIDDLE });
    inputsRow.add(this.inputHours);
    inputsRow.add(separator);
    inputsRow.add(this.inputMinutes);
    inputsRow.add(new St.Bin({ x_expand: true }));
    inputsRow.add(toggleBin);

    mainContainer.add(inputsRow);

    this.setContent(mainContainer);
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
