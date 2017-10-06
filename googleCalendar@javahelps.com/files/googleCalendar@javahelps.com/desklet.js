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
const St = imports.gi.St;
const Util = imports.misc.util;
const Gettext = imports.gettext;
imports.searchPath.unshift(GLib.get_home_dir() + '/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/lib');
const XDate = imports.xdate.XDate;
const uuid = "googleCalendar@javahelps.com";
const separator = "\n\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\u2015\n";
var today = new XDate();
today.clearTime();
var today_str = new XDate().toString("yyyy-MM-dd");
var tomorrow_str = new XDate().addDays(1).toString("yyyy-MM-dd");
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    return Gettext.dgettext(uuid, str);
}

function GoogleCalendarDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function Event(event_line, use_24h_clock) {
    this._init(event_line, use_24h_clock);
}

/**
 * Event prototype with the following attributes:
 * - start_date
 * - start_time
 * - end_date
 * - end_time
 * - name
 * - use_24h_clock
 * - MAX_LENGTH = 35
 */
Event.prototype = {
    _init: function (event_line, use_24h_clock) {
        let properties = event_line.split("\t");
        this.start_date = new XDate(properties[0]);
        this.start_time = properties[1];
        this.end_date = new XDate(properties[2]);
        this.end_time = properties[3];
        this.name = properties[4];
        this.use_24h_clock = use_24h_clock;
        this.MAX_LENGTH = 35;
    },

    toString: function (date) {
        var start_diff_days = this.start_date.diffDays(date);
        var end_diff_days = this.end_date.diffDays(date);
        if (start_diff_days == 0 && end_diff_days == 0) {
            // Starting and ending at this date
            return this.format(this.name, this.formatTime(this.start_time) + " - " + this.formatTime(this.end_time));
        } else if ((start_diff_days == 0 && end_diff_days == -1 && this.start_time === "00:00") || (start_diff_days > 0 && end_diff_days < 0)) {
            // Whole day
            return this.format(this.name);
        } else if (start_diff_days == 0 && end_diff_days < 0) {
            if (this.start_time == "00:00") {
                // Whole day
                return this.format(this.name);
            } else {
                // starting at the middle of this day
                return this.format(this.name, this.formatTime(this.start_time) + " \u2192");
            }
        } else if (start_diff_days > 0 && end_diff_days == 0 && this.end_time != "00:00") {
            // Ending at the middle of this day
            return this.format(this.name, (this.use_24h_clock ? "         " : "             ") + "\u2192 " + this.formatTime(this.end_time));
        } else {
            return "";
        }
    },

    /**
     * Format the time into 24 hours or 12 hours based on the user preference.
     */
    formatTime: function (time) {
        if (this.use_24h_clock) {
            return time;
        }
        time = time.toString().match(/^([01]\d|2[0-3])(:)([0-5]\d)(:[0-5]\d)?$/) || [time];
        if (time.length > 1) {
            time = time.slice(1);
            time[5] = +time[0] < 12 ? ' AM' : ' PM';
            time[0] = +time[0] % 12 || 12;
        }
        return time.join('');
    },

    /**
     * Format an event name along with the interval.
     * This function defines the maximum length of a calendar event.
     */
    format: function (name, interval = "") {
        let max_length = 55;
        if (interval) {
            max_length = this.MAX_LENGTH;
        }
        name = (name.length > max_length) ? name.substr(0, max_length - 3) + '...' : name;
        if (interval) {
            name = name + '\t'.repeat((max_length - name.length) / 4);
            return name + (this.use_24h_clock ? "\t" : " ") + interval;
        } else {
            return name;
        }
    }
}

GoogleCalendarDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.gcalcli_command = "gcalcli --refresh --nocache agenda --nostarted --tsv";
        this.metadata = metadata;
        this.update_id = null;
        this.updateInProgress = false;
        this.mainDir = GLib.get_home_dir() + '/.local/share/cinnamon/desklets/googleCalendar@javahelps.com/';
        this.file = this.mainDir + "output.txt";
        this.reading_file = false;
        this.file_content = "";

        this._updateDecoration();

        // Bind the properties
        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.update_id);
            this.settings.bind("calendarName", "calendarName", this.on_calendar_config_changed, null);
            this.settings.bind("interval", "interval", this.on_calendar_config_changed, null);
            this.settings.bind("delay", "delay", this.on_setting_changed, null);
            this.settings.bind("use_24h_clock", "use_24h_clock", this.on_desklet_config_changed, null);
            this.settings.bind("date_format", "date_format", this.on_desklet_config_changed, null);
            this.settings.bind("today_format", "today_format", this.on_desklet_config_changed, null);
            this.settings.bind("tomorrow_format", "tomorrow_format", this.on_desklet_config_changed, null);
            this.settings.bind("zoom", "zoom", this.on_setting_changed, null);
            this.settings.bind("textcolor", "textcolor", this.on_setting_changed, null);
            this.settings.bind("bgcolor", "bgcolor", this.on_setting_changed, null);
            this.settings.bind("transparency", "transparency", this.on_setting_changed, null);
            this.settings.bind("cornerradius", "cornerradius", this.on_setting_changed, null);
        } catch (e) {
            global.logError(e);
        }

        this.maxSize = 7000;

        this.setHeader(_("Google Calendar"));
        this.on_calendar_config_changed();
        this.setup_display();
        this._update();
    },

    /**
     * Update the 'gcalcli' command whenever the user has changed the preference.
     */
    on_calendar_config_changed: function () {
        var dateTime = new Date();
        var command = "gcalcli agenda ";
        command += "\"" + this.formatDate(dateTime) + "\" ";
        if (this.interval == null) {
            this.interval = 7; // Default interval is 7 days
        }
        dateTime.setDate(dateTime.getDate() + this.interval);
        command += "\"" + this.formatDate(dateTime) + "\" --nostarted --tsv";
        if (this.calendarName != "") {
            var calendars = this.calendarName.split(",");
            for (var i = 0; i < calendars.length; i++) {
                var name = calendars[i].trim();
                if (name != "") {
                    command = command + " --calendar \"" + name + "\"";
                }
            }
        }
        this.gcalcli_command = command;
    },

    on_desklet_config_changed: function () {
        this.update_agenda();
    },

    on_setting_changed: function () {
        if (this.update_id > 0) {
            Mainloop.source_remove(this.update_id);
        }
        this.update_id = null;
        this.setup_display();
        this.update_agenda();
    },

    on_desklet_removed: function () {
        Mainloop.source_remove(this.update_id);
    },

    setup_display: function () {
        this.window = new St.BoxLayout({
            vertical: true,
            style_class: 'desklet'
        });
        this.window.style = "padding: 10px; border-radius: " + this.cornerradius + "px; background-color: " + (this.bgcolor.replace(")", "," + (1.0 - this.transparency) + ")")).replace('rgb', 'rgba') + "; color: " + this.textcolor;

        this.label = new St.Label();
        this.label.style = 'text-align : left; font-size:' + (14 * this.zoom) + 'px; color: ' + this.textcolor;

        this.window.add(this.label);
        this.setContent(this.window);
        this.label.set_text(_("Retrieving events..."))
    },

    /**
     * Updates every user set secconds
     **/
    _update_loop: function () {
        this._update();
        this.update_id = Mainloop.timeout_add_seconds(this.delay * 60, Lang.bind(this, this._update_loop));
    },

    formatDate: function (value) {
        return value.getMonth() + 1 + "/" + value.getDate() + "/" + value.getFullYear();
    },

    /*
     * Format date using given pattern.
     */
    formatEventDate: function (str_date) {
        if (today_str === str_date) {
            return new XDate(str_date).toString(this.today_format).toUpperCase();
        } else if (tomorrow_str === str_date) {
            return new XDate(str_date).toString(this.tomorrow_format).toUpperCase();
        } else {
            return new XDate(str_date).toString(this.date_format).toUpperCase();
        }
    },

    formatFileContent: function (commandOutput, date_format = "dddd, MMMM dd", use_24h_clock = false) {
        let content = "";
        let currentDate = "";
        let events = commandOutput.split("\n");
        let noOfEvents = events.length;
        let dates = new Set();
        var events_array = [];
        for (let i = 0; i < noOfEvents; i++) {
            let properties = events[i].split("\t");
            dates.add(properties[0]);
            events_array.push(new Event(events[i], this.use_24h_clock));
        }

        for (let d of dates) {
            let date = new XDate(d);
            if (today.diffDays(date) >= 0) {
                content += this.formatEventDate(d) + separator;
                for (var i = 0; i < events_array.length; i++) {
                    let txt = events_array[i].toString(date);
                    if (txt) {
                        content += txt + "\n";
                    }
                }
                content += "\n\n";
            }
        }

        return content.trim();
    },

    /**
     * Format the output of the command read from the file and display in the desklet.
     */
    update_agenda: function () {
        if (this.file_content) {
            let content = "";
            try {
                content = this.formatFileContent(this.file_content, this.date_format, this.use_24h_clock);
            } catch (e) {
                global.logError(e);
                content = _("Unable to retrieve events...")
            }
            this.label.set_text(content);
        } else {
            this.read_file();
        }
    },

    /**
     * Read the output file generated by the command.
     */
    read_file: function () {

        if (this.reading_file) {
            return;
        }
        try {
            this.reading_file = true;

            let output_file_content = Cinnamon.get_file_contents_utf8_sync(this.file).toString();
            let content = "";
            let commandOutput = output_file_content.substring(0, Math.min(output_file_content.length, this.maxSize)).trim();

            if (commandOutput != "") {
                try {
                    content = this.formatFileContent(commandOutput, this.date_format, this.use_24h_clock);
                    this.file_content = commandOutput;
                } catch (e) {
                    global.logError(e);
                    content = _("Unable to retrieve events...")
                }
            } else {
                content = _("No events found...")
            }

            this.label.set_text(content);

        } catch (e) {
            global.logError(e);
        } finally {
            this.reading_file = false;
        }
    },

    /**
     * Method to update the text/reading of the file
     **/
    _update: function () {
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;
        try {
            // Execute the command to retrieve the calendar events.
            Util.spawnCommandLine("bash " + this.mainDir + "execute_command.sh \"" + this.gcalcli_command + "\"");
            Mainloop.timeout_add_seconds(5, Lang.bind(this, this.read_file));
        } catch (e) {
            global.logError(e);
        } finally {
            this.updateInProgress = false;
        }
    },

    /**
     * Update the calendar when user clicks on the desklet.
     */
    on_desklet_clicked: function (event) {
        this._update();
    }
}

function main(metadata, desklet_id) {
    let desklet = new GoogleCalendarDesklet(metadata, desklet_id);
    return desklet;
}
