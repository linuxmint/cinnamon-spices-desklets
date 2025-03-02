const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;

const UUID = "moonlight-clock@torchipeppo";
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;
let SU, CONSTANTS, SunCalc;
if (typeof require !== 'undefined') {
    SU = require("./style_utils");
    CONSTANTS = require("./constants");
    SunCalc = require("./suncalc");
}
else {
    imports.searchPath.push(DESKLET_DIR);
    SU = imports.style_utils;
    CONSTANTS = imports.constants;
    SunCalc = imports.suncalc;
}

// get day-only date from full ISO string
// works also with Date objects actually
function new_midnight_date(isostring) {
    let date = isostring ? new Date(isostring) : new Date();
    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
}

class SunCalcSource {
    constructor(uuid, desklet_id) {
        this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);

        this.settings.bind("bottom-emoji-type", "emoji_type");
        this.settings.bind("bottom-caption-type", "caption_type");
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
        return CONSTANTS.MOON_PHASE_NAMES_BY_LUNCAL_RESULT[this._get_moon_phase(today)];
    }

    _get_full_moon_countdown_str() {
        let today = new_midnight_date();
        let phase_code = this._get_moon_phase(today);

        if (phase_code in CONSTANTS.MOON_PHASE_SHORTNAMES) {
            return CONSTANTS.MOON_PHASE_SHORTNAMES[phase_code];
        }
        else {
            let next = new_midnight_date(this._get_next_full_moon(today));
            let days_left = Math.round((next - today) / (1000 * 60 * 60 * 24));
            return SU.countdown_formatting(days_left);
        }
    }

    // assigning each new/full/half moon to a single day, the hard way
    // (a simple, interval-based approach cannot be made map consistently to exactly one day)

    // returns true if the "me" argument is the quarter moon represented by
    // the "quarter_threshold" argument (0, 0.25, 0.5, 0.75),
    // i.e. if "me" is closer to the threshold than "other".
    // "me" and "other" should be consecutive days.
    _check_quarter_threshold_one(me, other, quarter_threshold) {
        // special handling of the new moon, since that's when the cycle
        // wraps from 1 back to 0
        if (quarter_threshold == 0) {
            if (me > 0.5) {
                me -= 1;
            }
            if (other > 0.5) {
                other -= 1;
            }
        }

        // check if the threshold has been passed (me and other are on different sides)
        let my_diff = quarter_threshold-me;
        let other_diff = quarter_threshold-other;
        if (my_diff * other_diff <= 0) {
            // check who is closest to the threshold
            // but also, I can only be found positive for the quarter closest to me
            let my_abs_diff = Math.abs(my_diff);
            return (my_abs_diff <= 1/8 && my_abs_diff <= Math.abs(other_diff));
        }
        return false;
    }

    _check_quarter_threshold_both(me, other1, other2, quarter_threshold) {
        return this._check_quarter_threshold_one(me, other1, quarter_threshold) ||
               this._check_quarter_threshold_one(me, other2, quarter_threshold);
    }

    // dunno how heavy suncalc's computations actually are, and we're calling
    // getMoonIllumination a bunch of times, so let's get smart

    _get_moon_phase(today) {
        if (!(this.cached_today_date && Math.abs(this.cached_today_date - today) < 1000 * 60 * 60 * 24)) {
            this._refresh_cache(today);
        }
        return this.cached_today_phase;
    }

    _get_moon_illumination(today) {
        if (!(this.cached_today_date && Math.abs(this.cached_today_date - today) < 1000 * 60 * 60 * 24)) {
            this._refresh_cache(today);
        }
        return this.cached_today_illumination;
    }

    _get_next_full_moon(today) {
        if (!(this.cached_today_date && Math.abs(this.cached_today_date - today) < 1000 * 60 * 60 * 24)) {
            this._refresh_cache(today);
        }
        return this.cached_today_next_full;
    }

    _refresh_cache(today) {
        this.cached_today_date = today;
        this.cached_today_illumination = SunCalc.getMoonIllumination(today);
        this.cached_today_phase = this._calculate_moon_phase(today, this.cached_today_illumination);
        this.cached_today_next_full = this._calculate_next_full(today, this.cached_today_illumination);
    }

    _calculate_moon_phase(today, today_illumination) {
        let yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        let today_pv = today_illumination.phase;
        let yesterday_pv = SunCalc.getMoonIllumination(yesterday).phase;
        let tomorrow_pv = SunCalc.getMoonIllumination(tomorrow).phase;

        // checking by "eights" of the moon cycle should lead to
        // the least amount of comparisons
        if (today_pv <= 1/8) {  // waxing crescent, check for new
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0)) {
                return "new";
            }
            return "new-fq";
        }
        else if (today_pv <= 2/8) {  // waxing crescent, check for first quarter
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0.25)) {
                return "fq";
            }
            return "new-fq";
        }
        else if (today_pv <= 3/8) {  // waxing gibbous, check for first quarter
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0.25)) {
                return "fq";
            }
            return "fq-full";
        }
        else if (today_pv <= 4/8) {  // waxing gibbous, check for full
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0.5)) {
                return "full";
            }
            return "fq-full";
        }
        else if (today_pv <= 5/8) {  // waning gibbous, check for full
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0.5)) {
                return "full";
            }
            return "full-lq";
        }
        else if (today_pv <= 6/8) {  // waning gibbous, check for last quarter
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0.75)) {
                return "lq";
            }
            return "full-lq";
        }
        else if (today_pv <= 7/8) {  // waning crescent, check for last quarter
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0.75)) {
                return "lq";
            }
            return "lq-new";
        }
        else {  // waning crescent, check for new
            if (this._check_quarter_threshold_both(today_pv, yesterday_pv, tomorrow_pv, 0)) {
                return "new";
            }
            return "lq-new";
        }
    }

    _calculate_next_full(today, today_illumination) {
        // special initial case: checking wrt yesterday
        let yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let today_pv = today_illumination.phase;
        let yesterday_pv = SunCalc.getMoonIllumination(yesterday).phase;
        if (this._check_quarter_threshold_one(today_pv, yesterday_pv, 0.5)) {
            return today;
        }

        // now the true function begins
        let current_date = today;
        let current_pv = today_pv;
        // we should be guaranteed to hit a full moon before 60 days,
        // but having Cinnamon hang would be bad, so let's not use `while true` anyway
        // just in case there's a rare numerical error or something
        for (let i=0; i<60; i++) {
            let next_date = new Date(current_date);
            next_date.setDate(next_date.getDate() + 1);
            let next_pv = SunCalc.getMoonIllumination(next_date).phase;

            if (this._check_quarter_threshold_one(current_pv, next_pv, 0.5)) {
                return current_date;
            }
            // checking sequentially, so I can do the "yesterday check" in advance
            if (this._check_quarter_threshold_one(next_pv, current_pv, 0.5)) {
                return next_date;
            }
            current_date = next_date;
            current_pv = next_pv;
        }
        // if we haven't found a full moon in the next 60 days,
        // either some calculation went wrong (floating point stuff?)
        // or Moonbase Alpha went on a little journey through the cosmos,
        // anyway, it's nothing my little desklet can solve.
        // I guess this is better than returning undefined.
        return current_date;
    }
}
