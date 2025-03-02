const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;

const UUID = "moonlight-clock@torchipeppo";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
let SU, CONSTANTS;
if (typeof require !== 'undefined') {
    SU = require("./style_utils");
    CONSTANTS = require("./constants");
}
else {
    imports.searchPath.push(DESKLET_DIR);
    SU = imports.style_utils;
    CONSTANTS = imports.constants;
}

// get day-only date from full ISO string
function new_midnight_date(isostring) {
    let date = isostring ? new Date(isostring) : new Date();
    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
}

class LunarCalendarSource {
    constructor(uuid, desklet_id, file_handler) {
        this.file_handler = file_handler;
        this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);

        this.settings.bind("bottom-emoji-type", "emoji_type");
        this.settings.bind("bottom-caption-type", "caption_type");
    }

    _get_fpath() {
        let today = new Date();
        return this.file_handler.get_path_to_file("local_lunar_calendar/"+today.getFullYear()+".json")
    }

    local_lunar_calendar_exists() {
        let path = this._get_fpath();
        if (path) {
            return GLib.file_test(path, GLib.FileTest.EXISTS);
        }
        else {
            return false;
        }
    }

    get_emoji_text() {
        switch (this.emoji_type) {
            case "moon":
                let moon_phase_name = this._find_moon_phase_name();
                return CONSTANTS.MOON_PHASES_BY_WEATHERAPI_NAME[moon_phase_name];
            default:
                return "";
        }
    }
    get_label_text() {
        switch (this.caption_type) {
            case "moon":
                let moon_phase_name = this._find_moon_phase_name();
                moon_phase_name = CONSTANTS.TRANSLATED_MOON_PHASE_NAMES[moon_phase_name];
                return moon_phase_name.replace(" ", "\n");
            case "cntdn-full":
                return this._get_full_moon_countdown_str();
            default:
                return "";
        }
    }

    _find_moon_phase_name() {
        let today = new_midnight_date();
        let lunar_calendar = JSON.parse(this.file_handler.get_file_text(this._get_fpath()));
        // find today's date or the two dates today falls in between
        let i = lunar_calendar.month_index[today.getMonth()];
        while (today > new_midnight_date(lunar_calendar.calendar[i][0])) {
            i += 1;
        }

        if (today.getTime() == new_midnight_date(lunar_calendar.calendar[i][0]).getTime()) {
            return CONSTANTS.MOON_PHASE_NAMES_BY_LUNCAL_RESULT[
                lunar_calendar.calendar[i][1]
            ];
        }
        else {
            return CONSTANTS.MOON_PHASE_NAMES_BY_LUNCAL_RESULT[
                lunar_calendar.calendar[i-1][1] + "-" + lunar_calendar.calendar[i][1]
            ];
        }
    }

    _get_full_moon_countdown_str() {
        let today = new_midnight_date();
        let lunar_calendar = JSON.parse(this.file_handler.get_file_text(this._get_fpath()));
        // find the first full moon that is today or later,
        // but also stop if today is any other "important" phase
        // b/c that's a special message
        let i = lunar_calendar.month_index[today.getMonth()];
        while (true) {
            let i_date = new_midnight_date(lunar_calendar.calendar[i][0]);
            if (today.getTime() == i_date.getTime()) {
                return CONSTANTS.MOON_PHASE_SHORTNAMES[lunar_calendar.calendar[i][1]];
            }
            if (today < i_date && lunar_calendar.calendar[i][1] == "full") {
                let days_left = Math.round((i_date - today) / (1000 * 60 * 60 * 24));
                return SU.countdown_formatting(days_left);
            }
            i += 1;
        }
    }
}
