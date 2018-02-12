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

function GoogleCalendarDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

GoogleCalendarDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    /**
     * Initialize the desklet.
     */
    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.maxSize = 7000;
        this.update_id = null;
        this.updateInProgress = false;
        this.eventsList;
        this.lastDate;
        this.today_str;
        this.tomorrow_str;

        this._updateDecoration();

        // Bind the properties
        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.update_id);
            this.settings.bind("calendarName", "calendarName", this.onSettingChanged, null);
            this.settings.bind("interval", "interval", this.onSettingChanged, null);
            this.settings.bind("delay", "delay", this.onSettingChanged, null);
            this.settings.bind("use_24h_clock", "use_24h_clock", this.onCalendarFormatChanged, null);
            this.settings.bind("date_format", "date_format", this.onCalendarFormatChanged, null);
            this.settings.bind("today_format", "today_format", this.onCalendarFormatChanged, null);
            this.settings.bind("tomorrow_format", "tomorrow_format", this.onCalendarFormatChanged, null);
            this.settings.bind("zoom", "zoom", this.onSettingChanged, null);
            this.settings.bind("textcolor", "textcolor", this.onSettingChanged, null);
            this.settings.bind("bgcolor", "bgcolor", this.onSettingChanged, null);
            this.settings.bind("transparency", "transparency", this.onSettingChanged, null);
            this.settings.bind("cornerradius", "cornerradius", this.onSettingChanged, null);
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
    onCalendarFormatChanged: function() {
        this.updateAgenda();
    },

    /**
     * Called when user changes the settings which require new events.
     */
    onSettingChanged: function() {
        if (this.update_id > 0) {
            Mainloop.source_remove(this.update_id);
        }
        this.update_id = null;
        this.retrieveEvents();
    },

    /**
     * Called when the desklet is removed.
     */
    on_desklet_removed: function() {
        Mainloop.source_remove(this.update_id);
    },

    /**
     * Called when user clicks on the desklet.
     */
    on_desklet_clicked: function(event) {
        this.retrieveEvents();
    },

    //////////////////////////////////////////// Utility Functions ////////////////////////////////////////////
    /**
     * Construct gcalcli command to retrieve events.
     */
    getCalendarCommand: function() {
        var dateTime = new Date();
        var command = ["gcalcli", "agenda"];
        command.push(CalendarUtility.formatParameterDate(dateTime));
        if (this.interval == null) {
            this.interval = 7; // Default interval is 7 days
        }
        dateTime.setDate(dateTime.getDate() + this.interval);
        command.push(CalendarUtility.formatParameterDate(dateTime));
        command.push("--nostarted");
        command.push("--tsv");
        if (this.calendarName != "") {
            var calendars = this.calendarName.split(",");
            for (var i = 0; i < calendars.length; i++) {
                var calendar_name = calendars[i].trim();
                if (calendar_name != "") {
                    command.push("--calendar");
                    command.push(calendar_name);
                }
            }
        }
        return command;
    },

    /**
     * Convert string line to Event object and store in a list.
     * This method also add the event to widget.
     */
    addEvent: function(event_line) {
        let event = new Event(event_line, this.use_24h_clock);
        this.eventsList.push(event);
        this.addEventToWidget(event);
    },

    /**
     * Append given event to widget.
     */
    addEventToWidget: function(event) {
        // Create date header
        if (this.lastDate == undefined || event.start_date.diffDays(this.lastDate) <= -1) {
            let leadingNewline = "";
            if (this.lastDate) {
                leadingNewline = "\n\n";
            }
            this.lastDate = event.start_date;
            let label = CalendarUtility.label(leadingNewline + this.formatEventDate(event.start_date_str) + SEPARATOR_LINE, this.zoom, this.textcolor);
            this.window.add(label);
        }

        // Create event row
        let box = CalendarUtility.container();
        let lblEvent = CalendarUtility.label(event.name, this.zoom, this.textcolor);
        box.add(lblEvent);

        let dateText = event.formatEventDuration(this.lastDate);
        if (dateText) {
            let lblDate = CalendarUtility.label(dateText, this.zoom, this.textcolor, leftAlign = false);
            lblEvent.width = TEXT_WIDTH;
            lblDate.width = DATE_WIDTH;
            box.add(lblDate);
        }

        this.window.add(box);
    },

    /**
     * Reset internal states and widget CalendarUtility.
     */
    resetWidget: function(resetEventsList = false) {
        if (resetEventsList) {
            this.eventsList = [];
            this.today_str = new XDate().toString("yyyy-MM-dd");
            this.tomorrow_str = new XDate().addDays(1).toString("yyyy-MM-dd");
        }
        this.lastDate = undefined;
        this.window = CalendarUtility.window(this.cornerradius, this.textcolor, this.bgcolor, this.transparency);
        this.setContent(this.window);
    },

    /**
     * Updates every user set seconds
     **/
    updateLoop: function() {
        this.retrieveEvents();
        this.update_id = Mainloop.timeout_add_seconds(this.delay * 60, Lang.bind(this, this.updateLoop));
    },

    /*
     * Format date using given pattern.
     */
    formatEventDate: function(str_date) {
        if (this.today_str === str_date) {
            return new XDate(str_date).toString(this.today_format).toUpperCase();
        } else if (this.tomorrow_str === str_date) {
            return new XDate(str_date).toString(this.tomorrow_format).toUpperCase();
        } else {
            return new XDate(str_date).toString(this.date_format).toUpperCase();
        }
    },

    /**
     * Format the output of the command read from the file and display in the desklet.
     */
    updateAgenda: function() {
        if (this.eventsList.length > 0) {
            this.resetWidget();
            for (let event of this.eventsList) {
                this.addEventToWidget(event);
            }
        } else {
            this.retrieveEvents();
        }
    },

    /**
     * Method to update the text/reading of the file
     **/
    retrieveEvents: function() {
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;
        this.resetWidget(resetEventsList = true);
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

function main(metadata, desklet_id) {
    let desklet = new GoogleCalendarDesklet(metadata, desklet_id);
    return desklet;
};