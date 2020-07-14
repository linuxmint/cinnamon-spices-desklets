/*
* Google Calendar Desklet displays your agenda based on your Google Calendar in Cinnamon desktop.

* Copyright (C) 2017  Gobinath

* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.

* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.

* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http:*www.gnu.org/licenses/>.
*/

"use strict";

const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;

// Import local libraries
imports.searchPath.unshift(GLib.get_home_dir() + "/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/lib");
const XDate = imports.utility.XDate;
const SpawnReader = imports.utility.SpawnReader;
const Event = imports.utility.Event;
const CalendarUtility = new imports.utility.CalendarUtility();


const UUID = "googleCalendar@javahelps.com";
const SEPARATOR_LINE = "\n\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

const TEXT_WIDTH = 250;
const FONT_SIZE = 14;
const HOME_PATH = GLib.get_home_dir();

function _(str) {
    return Gettext.dgettext(UUID, str);
}

function GoogleCalendarDesklet(metadata, deskletID) {
    this._init(metadata, deskletID);
}

GoogleCalendarDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    /**
     * Initialize the desklet.
     */
    _init(metadata, deskletID) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletID);
        this.metadata = metadata;
        this.maxSize = 7000;
        this.maxWidth = 0;
        this.updateID = null;
        this.updateInProgress = false;
        this.eventsList = [];
        this.lastDate = null;
        this.today = new XDate().toString("yyyy-MM-dd");
        this.tomorrow = new XDate().addDays(1).toString("yyyy-MM-dd");

        this._updateDecoration();

        // Bind properties
        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], deskletID);
        this.settings.bind("clientId", "clientId", this.onCalendarParamsChanged, null);
        this.settings.bind("clientSecret", "clientSecret", this.onCalendarParamsChanged, null);
        this.settings.bind("gcalendarAccount", "gcalendarAccount", this.onCalendarParamsChanged, null);
        this.settings.bind("calendarNames", "calendarNames", this.onCalendarParamsChanged, null);
        this.settings.bind("interval", "interval", this.onCalendarParamsChanged, null);
        this.settings.bind("delay", "delay", this.onCalendarParamsChanged, null);
        this.settings.bind("use_24h_clock", "use_24h_clock", this.onDeskletFormatChanged, null);
        this.settings.bind("date_format", "date_format", this.onDeskletFormatChanged, null);
        this.settings.bind("today_format", "today_format", this.onDeskletFormatChanged, null);
        this.settings.bind("tomorrow_format", "tomorrow_format", this.onDeskletFormatChanged, null);
        this.settings.bind("zoom", "zoom", this.onDeskletFormatChanged, null);
        this.settings.bind("textcolor", "textcolor", this.onDeskletFormatChanged, null);
        this.settings.bind("alldaytextcolor", "alldaytextcolor", this.onDeskletFormatChanged, null);
        this.settings.bind("bgcolor", "bgcolor", this.onDeskletFormatChanged, null);
        this.settings.bind("diff_calendar", "diff_calendar", this.onDeskletFormatChanged, null);
        this.settings.bind("show_location", "show_location", this.onDeskletFormatChanged, null);
        this.settings.bind("location_color", "location_color", this.onDeskletFormatChanged, null);
        this.settings.bind("transparency", "transparency", this.onDeskletFormatChanged, null);
        this.settings.bind("cornerradius", "cornerradius", this.onDeskletFormatChanged, null);
        this.setCalendarName();

        // Set header
        this.setHeader(_("Google Calendar"));
        // Set "Open Google Calendar" menu item
        Gtk.IconTheme.get_default().append_search_path(metadata.path + "/icons/");
        let openGoogleCalendarItem = new PopupMenu.PopupIconMenuItem(_("Open Google Calendar"), "google-calendar", St.IconType.SYMBOLIC);
        openGoogleCalendarItem.connect("activate", (event) => {
            GLib.spawn_command_line_async("xdg-open https://calendar.google.com");
        });
        this._menu.addMenuItem(openGoogleCalendarItem);
        // Start the update loop
        this.updateLoop();
    },

    //////////////////////////////////////////// Event Listeners ////////////////////////////////////////////
    /**
     * Called when user updates settings related to formatting.
     */
    onDeskletFormatChanged() {
        if (this.eventsList.length > 0) {
            this.resetWidget();
            for (let event of this.eventsList) {
                event.useTwentyFourHour = this.use_24h_clock;
                this.addEventToWidget(event);
            }
        } else {
            this.retrieveEventsIfAuthorized();
        }
    },

    /**
     * Called when user changes the settings which require new events.
     */
    onCalendarParamsChanged() {
        this.setCalendarName();
        if (this.updateID > 0) {
            Mainloop.source_remove(this.updateID);
        }
        this.updateID = null;
        this.retrieveEventsIfAuthorized();
    },

    /**
     * Called when the user clicks the button to populate the calendarName field with the names of all their calendars.
     */
    onAllNamesButtonClicked() {
        let reader = new SpawnReader();
        let command = ["gcalendar", "--output", "txt", "--list-calendars"];
        this.addAccountID(command, this.gcalendarAccount);
        // List of calendars already selected by user:
        let registeredCalendarNames = this.calendarName.toString().split(",");
        // List of all the user's calendars:
        var calendars = []; // We will populate it !
        this.calendarNames = [];
        reader.spawn(HOME_PATH, command, (output) => {
            let name = output.toString().trim();
            let display = (registeredCalendarNames.indexOf(name) > -1);
            calendars.push({
                name,
                display
            });
            this.calendarNames = calendars; // Refreshes the array in Settings.
        });
    },

    /**
     * Called when the desklet is removed.
     */
    on_desklet_removed() {
        Mainloop.source_remove(this.updateID);
    },

    /**
     * Called when user clicks on the desklet.
     */
    on_desklet_clicked(event) {
        this.retrieveEventsIfAuthorized();
    },

    //////////////////////////////////////////// Utility Functions ////////////////////////////////////////////
    /**
     * Set the this.calendarName value.
     */
    setCalendarName() {
        try {
            var names = [];
            for (var i = 0; i < this.calendarNames.length; i++) {
                if (this.calendarNames[i]["display"] === true) {
                    names.push(this.calendarNames[i]["name"]);
                }
            }
            this.calendarName = names.join(",");
        } catch (e) {
            this.calendarName = "";
        }
    },

    /**
     * Construct gcalendar command to retrieve events.
     */
    getCalendarCommand(accountId) {
        let dateTime = new Date();
        let command = ["gcalendar", "--output", "json", "--client-id", this.clientId, "--client-secret", this.clientSecret];
        command.push("--no-of-days");
        if (this.interval == null) {
            this.interval = 7; // Default interval is 7 days
        }
        command.push(this.interval.toString());
        this.addCalendarList(command);
        this.addAccountID(command, accountId);
        return command;
    },

    /**
     * Convert string line to Event object and store in a list.
     * This method also add the event to widget.
     */
    addEvent(eventLine) {
        let events = [];
        try {
            events = JSON.parse(eventLine);
        } catch (e) {
            throw e;
        }
        if (events.length === 0) {
            this.window.add(CalendarUtility.label(_("No events found"), this.zoom, this.textcolor));
        } else {
            events.forEach((element) => {
                let event = new Event(element, this.use_24h_clock);
                this.eventsList.push(event);
                this.addEventToWidget(event);
            });
        }
    },

    /**
     * Append given event to widget.
     */
    addEventToWidget(event) {
        // Create date header
        if (this.lastDate === null || event.startDate.diffDays(this.lastDate) <= -1) {
            let leadingNewline = "";
            if (this.lastDate) {
                leadingNewline = "\n\n";
            }
            this.lastDate = event.startDate;
            let label = CalendarUtility.label(leadingNewline + this.formatEventDate(event.startDateText) + SEPARATOR_LINE, this.zoom, this.textcolor);
            this.window.add(label);
            if (label.width > this.maxWidth) {
                this.maxWidth = label.width;
            }
        }

        // Create event row
        let box = CalendarUtility.container();
        this.window.add(box);

        let textWidth = this.maxWidth;
        let lblBullet;
        // Add a bullet to differentiate calendar
        if (this.diff_calendar) {
            lblBullet = CalendarUtility.label("\u2022 ", this.zoom, event.color);
            box.add(lblBullet);
            textWidth = textWidth - lblBullet.width;
        }

        let dateText = event.formatEventDuration(this.lastDate);
        if (dateText) {
            let lblEvent = CalendarUtility.label(event.name, this.zoom, this.textcolor);
            let lblDate = CalendarUtility.label(dateText, this.zoom, this.textcolor);
            box.add(lblEvent, {
                expand: true,
                x_fill: true,
                align: St.Align.START
            });
            box.add(lblDate);
            lblEvent.width = textWidth - lblDate.width - 50 * this.zoom * global.ui_scale;
        } else {
            let lblEvent = CalendarUtility.label(event.name, this.zoom, this.alldaytextcolor);
            lblEvent.width = textWidth;
            box.add(lblEvent);
        }

        if (this.show_location && event.location !== "") {
            let locationBox = CalendarUtility.container();
            if (this.diff_calendar) {
                let lblEmpty = CalendarUtility.label("", this.zoom, this.textcolor);
                lblEmpty.width = lblBullet.width;
                locationBox.add(lblEmpty);
            }
            let lblLocation = CalendarUtility.label(event.location, this.zoom, this.location_color, true, 8);
            lblLocation.style = lblLocation.style + "; font-style: italic;";
            lblLocation.width = textWidth;
            locationBox.add(lblLocation);
            this.window.add(locationBox);
        }
    },

    /**
     * Reset internal states and widget CalendarUtility.
     */
    resetWidget(resetEventsList = false) {
        if (resetEventsList) {
            this.eventsList = [];
            this.today = new XDate().toString("yyyy-MM-dd");
            this.tomorrow = new XDate().addDays(1).toString("yyyy-MM-dd");
        }
        this.lastDate = null;
        this.window = CalendarUtility.window(this.cornerradius, this.textcolor, this.bgcolor, this.transparency);
        this.setContent(this.window);
        this.maxWidth = 0;
    },

    /**
     * Updates every user set seconds
     **/
    updateLoop() {
        this.retrieveEventsIfAuthorized();
        this.updateID = Mainloop.timeout_add_seconds(this.delay * 60, Lang.bind(this, this.updateLoop));
    },

    /**
     * Returns well formatted string (for this.today_format, this.tomorrow_format and this.date_format).
     * This fixes a bug that occurs, for example, when 'today' is replaced by 'aujourd'hui' by a French-speaking user.
     */
    formatDatePattern(t) {
        var ret = t;
        if (t.indexOf("'") > -1) {
            let index1 = t.indexOf("'"); // first apostrophe
            let index2 = t.lastIndexOf("'"); // last apostrophe
            let sub = t.substr(index1 + 1, index2 - index1 - 1); // all between the first and last apostrophe
            if (sub.indexOf("'") > -1) { // there is at least one other apostrophe
                let sub2 = sub.replace("'", "’"); // replaces all other apostrophe &apos; by the &rsquo; character
                ret = t.replace(sub, sub2);
            }
        }
        return ret;
    },

    /**
     * Format date using given pattern.
     */
    formatEventDate(dateText) {
        if (this.today === dateText) {
            return new XDate(dateText).toString(this.formatDatePattern(this.today_format)).toUpperCase();
        } else if (this.tomorrow === dateText) {
            return new XDate(dateText).toString(this.formatDatePattern(this.tomorrow_format)).toUpperCase();
        } else {
            return new XDate(dateText).toString(this.formatDatePattern(this.date_format)).toUpperCase();
        }
    },

    retrieveEventsIfAuthorized() {
        let accountId = this.gcalendarAccount;
        try {
            // Check the status of gcalendar
            let reader = new SpawnReader();
            let command = ["gcalendar", "--output", "txt", "--status"];
            this.addAccountID(command, accountId);
            reader.spawn(HOME_PATH, command, (output) => {
                let status = output.toString().trim();
                if (status === "Authorized") {
                    // Authorized
                    this.retrieveEvents(accountId);
                } else {
                    this.showGcalendarStatus(status, accountId);
                }
            });
        } catch (e) {
            this.showErrorMessage(e.toString());
        }
    },

    showGcalendarStatus(status, accountId) {
        let message = _("gcalendar is not authorized");
        if (status === "Token Expired") {
            message = _("gcalendar token expired");
        }
        // Show the status on widget
        this.resetWidget(true);
        let label = CalendarUtility.label(message, this.zoom, this.textcolor);
        let hint = _("Execute: ") + "gcalendar";
        if (accountId != null && accountId !== "") {
            hint = hint + " --account " + accountId;
        }
        let lblHint = CalendarUtility.label(hint, this.zoom, this.location_color, true, 8);
        lblHint.style = lblHint.style + "; font-style: italic;";

        this.window.add(label);
        this.window.add(lblHint);
    },

    showErrorMessage(errorMessage) {
        this.resetWidget(true);
        let message = _("Unknown Error");
        let hint = errorMessage;
        if (errorMessage.includes("No such file or directory")) {
            message = _("Install gcalendar to use this desklet.");
            hint = _("Visit: ") + "https://github.com/slgobinath/gcalendar";
        }
        let label = CalendarUtility.label(message, this.zoom, this.textcolor);
        let lblHint = CalendarUtility.label(hint, this.zoom, this.location_color, true, 8);
        lblHint.style = lblHint.style + "; font-style: italic;";
        this.window.add(label);
        this.window.add(lblHint);
    },

    /**
     * Method to update the text/reading of the file
     **/
    retrieveEvents(accountId) {
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;
        var outputReceived = false;
        try {
            // Execute the command to retrieve the calendar events.
            let reader = new SpawnReader();
            let error = false;
            reader.spawn(HOME_PATH, this.getCalendarCommand(accountId), (output) => {
                this.resetWidget(true);
                if (!outputReceived) {
                    outputReceived = true;
                }
                let eventLine = output.toString();
                try {
                    this.addEvent(eventLine);
                    error = false;
                } catch (e) {
                    // Some JSON parse errors happened. May be because of first time authentication
                    // Wait until reaching last line of the output because the last line may be a valid events JSON
                    error = true;
                }
            });
            if (error) {
                let label = CalendarUtility.label(_("Unable to retrieve events..."), this.zoom, this.textcolor);
                this.window.add(label);
            }
        } catch (e) {
            global.logError(e);
        } finally {
            this.updateInProgress = false;
        }
    },

    /**
     * Add selected calendars to the command.
     * @param {String[]} command gcalendar command
     */
    addCalendarList(command) {
        if (this.calendarName != "") {
            command.push("--calendar");
            let calendars = this.calendarName.split(",");
            for (let name of calendars) {
                name = name.trim();
                if (name !== "") {
                    command.push(name);
                }
            }
        }
    },

    /**
     * Append the account id to the command if valid.
     * @param {String[]} command gcalendar command
     * @param {String} accountId gcalendar account id
     */
    addAccountID(command, accountId) {
        if (accountId != null && accountId !== "") {
            command.push("--account", accountId);
        }
    }
};

function main(metadata, deskletID) {
    let desklet = new GoogleCalendarDesklet(metadata, deskletID);
    return desklet;
};
