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

const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;

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
const DATE_WIDTH = 150;
const FONT_SIZE = 14;

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
            this.settings.bind("bgcolor", "bgcolor", this.onDeskletFormatChanged, null);
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
        let command = ["gcalcli", "agenda"];
        command.push(CalendarUtility.formatParameterDate(dateTime));
        if (this.interval == null) {
            this.interval = 7; // Default interval is 7 days
        }
        dateTime.setDate(dateTime.getDate() + this.interval);
        command.push(CalendarUtility.formatParameterDate(dateTime));
        command.push("--nostarted");
        command.push("--tsv");
        if (this.calendarName != "") {
            let calendars = this.calendarName.split(",");
            for (let name of calendars) {
                name = name.trim();
                if (name !== "") {
                    command.push("--calendar");
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
        let event = new Event(eventLine, this.use_24h_clock);
        this.eventsList.push(event);
        this.addEventToWidget(event);
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
        }

        // Create event row
        let box = CalendarUtility.container();
        let lblEvent = CalendarUtility.label(event.name, this.zoom, this.textcolor);
        box.add(lblEvent);

        let dateText = event.formatEventDuration(this.lastDate);
        if (dateText) {
            let lblDate = CalendarUtility.label(dateText, this.zoom, this.textcolor, false);
            lblEvent.width = TEXT_WIDTH;
            lblDate.width = DATE_WIDTH;
            box.add(lblDate);
        }

        this.window.add(box);
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
        this.resetWidget(true);
        // Set temporary method
        let label = CalendarUtility.label(_("No events found..."), this.zoom, this.textcolor);
        this.window.add(label);
        var outputReceived = false;
        try {
            // Execute the command to retrieve the calendar events.
            reader = new SpawnReader();
            reader.spawn("./", this.getCalendarCommand(), (output) => {
                if (!outputReceived) {
                    this.resetWidget();
                    outputReceived = true;
                }
                let eventLine = output.toString();
                try {
                    this.addEvent(eventLine);
                } catch (e) {
                    global.logError(e);
                    let label = CalendarUtility.label(_("Unable to retrieve events..."), this.zoom, this.textcolor);
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