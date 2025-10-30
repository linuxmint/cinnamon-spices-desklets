// not quite as isolated a module as the other sources
// this is more of a coherence choice
// and a way to keep desklet.js from getting bloated (again)

const Settings = imports.ui.settings;

const CONSTANTS = require("./constants");
const ShellUtils = require("./shell_utils");
const Translation = require("./translation");
const _ = Translation._;

function hour_to_p3time(hour) {
    if (0<=hour && hour<5) {
        return _("Late Night");
    }
    else if (5<=hour && hour<7) {
        return _("Early Morning");
    }
    else if (7<=hour && hour<10) {
        return _("Morning");
    }
    else if (10<=hour && hour<15) {
        return _("Daytime");
    }
    else if (15<=hour && hour<19) {
        return _("Afternoon");
    }
    else if (19<=hour && hour<24) {
        return _("Evening");
    }
}

function _get_days_left(date_json_string) {
    let today = new Date();
    today.setHours(0);
    today.setMinutes(0);
    today.setSeconds(0);
    today.setMilliseconds(0);

    let countdown_target = JSON.parse(date_json_string)

    let target = new Date(
        countdown_target.y,
        countdown_target.m-1,
        countdown_target.d
    );

    return Math.round((target - today) / (CONSTANTS.ONE_DAY_MSEC));
}

class WallclockSource {
    constructor(uuid, desklet_id, wallclock, file_handler) {
        // share a reference with the main desklet
        this.wallclock = wallclock;
        this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);

        this.settings.bind("middle-format", "time_format", this._onFormatSettingsChanged);
        this.settings.bind("top-format", "date_format", this._onFormatSettingsChanged);

        this.settings.bind("custom-countdown-list", "countdown_list");

        // people don't just change their locale all the time,
        // and I'm pretty sure that even if you change it you have to log out and back in,
        // so setting this only once is fine
        let p = new ShellUtils.ShellOutputProcess(["locale", "d_fmt"], file_handler);
        let d_fmt = p.spawn_sync_and_get_output().trim();
        // default stylistic choice: remove the year
        d_fmt = d_fmt.replace(/[^%0-9a-zA-Z]?%[yY][^%0-9a-zA-Z]?/, "");
        // default stylistic choice: put a little space in the date
        d_fmt = d_fmt.replace(/[/]/g, " / ");
        d_fmt = d_fmt.replace(/[-]/g, " - ");
        this.default_date_format = d_fmt
    }

    time_format_or_default() {
        return this.time_format || this.wallclock.get_default_time_format();
    }
    date_format_or_default() {
        return this.date_format || this.default_date_format;
    }

    get_time_text() {
        let p3time = hour_to_p3time(Number(this.wallclock.get_clock_for_format("%H")));
        let actual_time_format = this.time_format_or_default().replace(/(?<=(^|[^%])(%%)*)%!/g, p3time);
        let formatted_time = this.wallclock.get_clock_for_format(actual_time_format);
        if (formatted_time === null) {
            formatted_time = "!! FORMAT !!";
        }
        if (!this.time_format) {
            // default stylistic choice: put a little space in the clock
            formatted_time = formatted_time.replace(/[:]/g, " : ");
            formatted_time = formatted_time.replace(/[.]/g, " . ");
        }
        return formatted_time;
    }

    get_date_text() {
        let p3time = hour_to_p3time(Number(this.wallclock.get_clock_for_format("%H")));
        let actual_date_format = this.date_format_or_default().replace(/(?<=(^|[^%])(%%)*)%!/g, p3time);
        let formatted_date = this.wallclock.get_clock_for_format(actual_date_format);
        if (formatted_date === null) {
            formatted_date = "!! FORMAT !!";
        }
        return formatted_date;
    }

    get_custom_countdown_item_from_list(i) {
        let found = -1
        for (let item of this.countdown_list) {
            if (
                item.enabled &&
                (item.persistent || _get_days_left(item.date) >= 0)
            ) {
                found++;
                if (found == i) {
                    return item;
                }
            }
        }
        return undefined;
    }

    get_custom_countdown_text_from_list_item(item) {
        let days_left = _get_days_left(item.date)
        if (days_left == 0) {
            return _("Today");
        }
        else {
            return days_left.toString();
        }
    }
}