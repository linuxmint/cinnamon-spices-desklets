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
const St = imports.gi.St;

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
const SCRIPT_PATH = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/py";

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
        this.eventsList;
        this.lastDate = null;
        this.today;
        this.tomorrow;

        this._updateDecoration();

        // Bind the properties
        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.updateID);
            this.settings.bind("calendarName", "calendarName", this.onCalendarParamsChanged, null);
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
        } catch (e) {
            global.logError(e);
        }
        // Set header
        this.setHeader(_("Google Calendar"));
        // Start the update loop
        this.updateLoop();
    },

    //////////////////////////////////////////// Event Listeners ////////////////////////////////////////////
    /**
     * Called when user updates settings related to formatting.
     */
    onDeskletFormatChanged() {
        this.updateAgenda();
    },

    /**
     * Called when user changes the settings which require new events.
     */
    onCalendarParamsChanged() {
        if (this.updateID > 0) {
            Mainloop.source_remove(this.updateID);
        }
        this.updateID = null;
        this.retrieveEvents();
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
        this.retrieveEvents();
    },

    //////////////////////////////////////////// Utility Functions ////////////////////////////////////////////
    /**
     * Construct gcalcli command to retrieve events.
     */
    getCalendarCommand() {
        let dateTime = new Date();
        let command = ["python3", "google_calendar.py"];
        command.push("--no-of-days");
        if (this.interval == null) {
            this.interval = 7; // Default interval is 7 days
        }
        command.push(this.interval.toString());
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
        return command;
    },

    /**
     * Convert string line to Event object and store in a list.
     * This method also add the event to widget.
     */
    addEvent(eventLine) {
        let events = JSON.parse(eventLine);
        events.forEach((element) => {
            let event = new Event(element, this.use_24h_clock);
            this.eventsList.push(event);
            this.addEventToWidget(event);
        });
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

        this.window.add(box);
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
        this.retrieveEvents();
        this.updateID = Mainloop.timeout_add_seconds(this.delay * 60, Lang.bind(this, this.updateLoop));
    },

    /*
     * Format date using given pattern.
     */
    formatEventDate(dateText) {
        if (this.today === dateText) {
            return new XDate(dateText).toString(this.today_format).toUpperCase();
        } else if (this.tomorrow === dateText) {
            return new XDate(dateText).toString(this.tomorrow_format).toUpperCase();
        } else {
            return new XDate(dateText).toString(this.date_format).toUpperCase();
        }
    },

    /**
     * Format the output of the command read from the file and display in the desklet.
     */
    updateAgenda() {
        if (this.eventsList.length > 0) {
            this.resetWidget();
            for (let event of this.eventsList) {
                event.useTwentyFourHour = this.use_24h_clock;
                this.addEventToWidget(event);
            }
        } else {
            this.retrieveEvents();
        }
    },

    /**
     * Method to update the text/reading of the file
     **/
    retrieveEvents() {
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;
        var outputReceived = false;
        try {
            // Execute the command to retrieve the calendar events.
            let reader = new SpawnReader();
            reader.spawn(SCRIPT_PATH, this.getCalendarCommand(), (output) => {
                this.resetWidget(true);
                if (!outputReceived) {
                    outputReceived = true;
                }
                let eventLine = output.toString();
                try {
                    this.addEvent(eventLine);
                } catch (e) {
                    global.logError(e);
                    let label;
                    if (eventLine.includes("https://accounts.google.com/o/oauth2/auth")) {
                        // Not authenticated
                        label = CalendarUtility.label(_("Please authenticate the desklet to continue"), this.zoom, this.textcolor);
                    } else {
                        label = CalendarUtility.label(_("Unable to retrieve events..."), this.zoom, this.textcolor);
                    }
                    this.window.add(label);
                }
            });
        } catch (e) {
            global.logError(e);
        } finally {
            this.updateInProgress = false;
        }
    }
}

function main(metadata, deskletID) {
    let desklet = new GoogleCalendarDesklet(metadata, deskletID);
    return desklet;
};