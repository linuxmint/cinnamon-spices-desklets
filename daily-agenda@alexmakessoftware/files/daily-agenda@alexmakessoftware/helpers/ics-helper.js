// ics-helper.js

//DEBUG TIP: to print out a glib date, use glDate.format("%Y-%m-%dT%H:%M:%S").
const DEFAULT_DURATION_HRS = 1;
const MICROSECONDS_PER_DAY = 1000 * 1000 * 60 * 60 * 24;

const GLib = imports.gi.GLib;

function isSameDayIgnoringTime(a, b) {
    return (
        a.get_year() === b.get_year() &&
        a.get_month() === b.get_month() &&
        a.get_day_of_month() === b.get_day_of_month()
    );
}


// Construct new datetime with date from datePart and time from timePart (for repeating events).
function combineDateAndTime(datePart, timePart, tz) {
    const year = datePart.get_year();
    const month = datePart.get_month();
    const day = datePart.get_day_of_month();

    const hour = timePart.get_hour();
    const minute = timePart.get_minute();
    const second = timePart.get_second();    

    const datetime = GLib.DateTime.new(tz, year, month, day, hour, minute, second);
    if (!datetime) throw new Error("Failed to create combined GLib.DateTime");

    return datetime;
}


function unfoldIcs(text) {
    return text.replace(/\r?\n[ \t]/g, ' ');
}


function daysBetween(date1, date2) {
    // Truncate both dates to midnight (removing time portion)
    const tz = date1.get_timezone(); // assume both are in the same zone
    const d1 = GLib.DateTime.new(tz, date1.get_year(), date1.get_month(), date1.get_day_of_month(), 0, 0, 0);
    const d2 = GLib.DateTime.new(tz, date2.get_year(), date2.get_month(), date2.get_day_of_month(), 0, 0, 0);
    const microseconds = d2.difference(d1); // returns microseconds
    const days = microseconds / MICROSECONDS_PER_DAY;
    return Math.round(days);
}


function isOnOrBeforeToday(eventDate, todayDate) {
    const eYear = eventDate.get_year();
    const eMonth = eventDate.get_month();
    const eDay = eventDate.get_day_of_month();
    const tYear = todayDate.get_year();
    const tMonth = todayDate.get_month();
    const tDay = todayDate.get_day_of_month();
    if (eYear < tYear) return true;
    if (eYear > tYear) return false;
    if (eMonth < tMonth) return true;
    if (eMonth > tMonth) return false;
    return eDay <= tDay;
}


function convertToKVP(valueString) {
    const params = {};
    if (!valueString) return params;
    const pairs = valueString.split(';');
    for (const pair of pairs) {
        const [key, val] = pair.split('=');
        if (key && val !== undefined) {
            params[key.toLowerCase()] = val;
        }
    }
    return params;
}


class IcsHelperImpl {
    constructor(timezoneProvider = () => GLib.TimeZone.new_local()) {
        this.getLocalTimezone = timezoneProvider;    
        this._logger = () => {}; // default to no-op logger    
    }


    _getTimezoneObject(zoneString) {
        const GLib = imports.gi.GLib;
        if (!zoneString || zoneString === "local") {
            return getLocalTimezone();
        }

        const timezone = GLib.TimeZone.new(zoneString);
        if (!timezone) {
            global.logWarning(`ICS Helper: Failed to load time zone '${zoneString}', falling back to local time.`);
            return getLocalTimezone();
        }

        return timezone;
    }


    setLogger(logger) {
        this._logger = logger;        
    }


    _log(str) {
        this._logger(str);
    }


    _extractICalLine(content, key) {
        const pattern = new RegExp(`^${key}[^\\r\\n]*`, 'm');
        const match = content.match(pattern);
        return match ? match[0] : null;
    }


    _parseLineParts(line) {
        if (!line) return {};
        // E.g. "DTSTART;TZID=Europe/London:20250612T090000"
        const [, key, params, value] = line.match(/^([A-Z]+)(?:;([^:]+))?:(.+)$/) || [];
        const paramMap = {};        
        if (params) {
            for (const part of params.split(';')) {
                const [k, v] = part.split('=');
                paramMap[k.toUpperCase()] = v;
            }
        }

        return { key, params: paramMap, value };
    }


    _parseToLocalisedDate(dtstartString, _timezone = null) {

        const isUtc = dtstartString.endsWith('Z');

        //if the _timezone is non-null, use that for the timezone.
        //but if the dstart ends in Z, then it's UTC timezone.        
        //otherwise, just assume local timezone.
        const timezone = _timezone
            ? this._getTimezoneObject(_timezone)
            : isUtc
                ? this._getTimezoneObject("UTC")
                : this.getLocalTimezone();

        const raw = isUtc ? dtstartString.slice(0, -1) : dtstartString;
        const datePart = raw.slice(0, 8); // YYYYMMDD

        //if no time component, it's just a date (because it's an all-day event). Use local timezone for glib date contruction with 00:00 as time.
        const timePart = raw.includes("T") ? raw.slice(9) : "";
        const hasTime = timePart.length >= 4;
        const hour = timePart.slice(0, 2).padEnd(2, '0') || "00";
        const minute = timePart.slice(2, 4).padEnd(2, '0') || "00";
        const second = timePart.slice(4, 6).padEnd(2, '0') || "00";

        const iso8601string = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${hour}:${minute}:${second}`;
        const glibDate = GLib.DateTime.new_from_iso8601(iso8601string, timezone);
        if (!glibDate)
            throw new Error(`Invalid date format: ${dtstartString}`);

        // Convert to local system timezone if it's different from the input
        const localisedDate = glibDate.to_timezone(this.getLocalTimezone());

        return {
            datetime: localisedDate,
            hasTime
        };
    }


    _createEvent(glibDateTime, summary, hasTime) {
        let displayTime = glibDateTime;

        if (!hasTime) {
            displayTime = GLib.DateTime.new(
                glibDateTime.get_timezone(),
                glibDateTime.get_year(),
                glibDateTime.get_month(),
                glibDateTime.get_day_of_month(),
                0, 0, 0
            );
        }

        return {
            time: displayTime,
            summary: summary.trim(),
            is_all_day: !hasTime
        };
    }


    _eventExpired(until, now) {
        if(!until) throw new Error("until parameter undefined.");        
        let untilDate = this._parseToLocalisedDate(until).datetime;
        return !isOnOrBeforeToday(now, untilDate);
    }


    _byDayToGlibDay(icsDay) {
        const map = {
            MO: 1,
            TU: 2,
            WE: 3,
            TH: 4,
            FR: 5,
            SA: 6,
            SU: 0
        };
        return map[icsDay];
    }


    //TODO: proper handling of frequency.
    _byDayMatches(rruleParams, referenceDate, eventStartDate, frequency) {
        if (!rruleParams.byday) {
            if (rruleParams.freq.toUpperCase() === "WEEKLY") {
                // No BYDAY for a weekly event: default to weekday of DTSTART
                return referenceDate.get_day_of_week() === eventStartDate.get_day_of_week();
            } else {
                // For DAILY, MONTHLY, YEARLY, etc., BYDAY doesn't apply unless specified
                return true;
            }
        }

        const allowedDays = rruleParams.byday.split(",").map(dayStr => {
            const match = dayStr.match(/^([+-]?\d)?([a-z]{2})$/i);
            const prefix = match[1];
            //TODO: handle prefix properly.
            if (prefix !== undefined) {
                this._log(`Skipping unsupported BYDAY prefix in ${dayStr}`);
            }
            const weekday = match[2].toUpperCase();
            const glibDay = this._byDayToGlibDay(weekday);

            return { glibDay, prefix };
        });

        for (let { glibDay, prefix } of allowedDays) {
            if (prefix === undefined) {
                if (referenceDate.get_day_of_week() === glibDay) return true;
            } else {
                // Skip ordinals like 1MO for now
            }
        }

        return false;
    }


    //converts an array of string represented dates to an array of glib dates in the selected local timezone.
    _excludedStrsToGlibDates(exdateStrs) {
        const excludedDates = [];
        for (const strdate of exdateStrs) {                
                const { datetime } = this._parseToLocalisedDate(strdate.trim());
                const tz = datetime.get_timezone();
                const truncated = GLib.DateTime.new(
                    tz,
                    datetime.get_year(),
                    datetime.get_month(),
                    datetime.get_day_of_month(),
                    0, 0, 0);
                excludedDates.push(truncated);                
        }
        return excludedDates;
    }


    //TODO: don't think we're handling interval?
    _isRecurringInstanceValid(frequency, eventDate, todayDate, repeatCount, interval = 1) {
        const daysDifference = daysBetween(eventDate, todayDate);
        let occurrencesPassed;

        switch (frequency) {
            case "DAILY": {
                if (daysDifference % interval !== 0) return false;
                occurrencesPassed = Math.floor(daysDifference / interval) + 1;
                break;
            }

            case "WEEKLY": {
                const weeksPassed = Math.floor(daysDifference / 7);
                if (weeksPassed % interval !== 0) return false;
                occurrencesPassed = Math.floor(weeksPassed / interval) + 1;
                break;
            }

            case "MONTHLY": {
                if (todayDate.get_day_of_month() !== eventDate.get_day_of_month()) return false;

                const yearsDiff = todayDate.get_year() - eventDate.get_year();
                const monthsDiff = todayDate.get_month() - eventDate.get_month() + yearsDiff * 12;
                if (monthsDiff % interval !== 0) return false;
                occurrencesPassed = Math.floor(monthsDiff / interval) + 1;
                break;
            }

            case "YEARLY": {
                if (todayDate.get_month() !== eventDate.get_month()) return false;
                if (todayDate.get_day_of_month() !== eventDate.get_day_of_month()) return false;

                const yearsPassed = todayDate.get_year() - eventDate.get_year();                
                if (yearsPassed % interval !== 0) return false;
                occurrencesPassed = Math.floor(yearsPassed / interval) + 1;
                break;
            }

            default:
                return false;
        }

        return occurrencesPassed <= repeatCount;
    }


    _parseExdates(eventText) {
        const matches = [...eventText.matchAll(/EXDATE(?:;[^:]*)?:(.+)/g)];
        const allExdates = [];

        for (const [, dateList] of matches) {
            const dates = dateList.split(',');
            allExdates.push(...dates);
        }

        return allExdates;
    }


    _extractEventFields(eventText) {
        const dstartLine = this._extractICalLine(eventText, 'DTSTART');
        const dtendLine = this._extractICalLine(eventText, 'DTEND');
        const summaryLine = this._extractICalLine(eventText, 'SUMMARY');
        const rruleLine = this._extractICalLine(eventText, 'RRULE');
        const exdateStrArr = this._parseExdates(eventText);

        const { key: dtstartMatch, params: dtstartparams, value: dtstartvalue } = this._parseLineParts(dstartLine);
        const { key: dtendMatch, params: dtendparams, value: dtendvalue } = dtendLine ? this._parseLineParts(dtendLine) : {};
        const { value: summary } = this._parseLineParts(summaryLine || "");

        return {
            dtstartMatch, dtstartparams, dtstartvalue,
            dtendMatch, dtendparams, dtendvalue,
            summary, rruleLine, exdateStrArr
        };
    }

    _computeEndDate(eventDate, dtendValue, dtendTzid, hasTime) {
        if (dtendValue) {
            const { datetime: endDate } = this._parseToLocalisedDate(dtendValue, dtendTzid);
            return endDate;
        } else if (hasTime) {
            return eventDate.add_hours(DEFAULT_DURATION_HRS);
        }
        return null;
    }

    _computeRecurringEnd(instanceStart, originalStart, originalEnd, hasTime) {
        if (!originalEnd) return null;
        if (hasTime) {
            const durationSecs = originalEnd.to_unix() - originalStart.to_unix();
            return instanceStart.add_seconds(durationSecs);
        }
        return instanceStart;  // for all-day events
    }

    _isExcludedDate(instanceStart, exdateStrArr) {
        const excludedDates = this._excludedStrsToGlibDates(exdateStrArr);
        return excludedDates.some(exDate => isSameDayIgnoringTime(instanceStart, exDate));
    }


    _extractUidAndRecurrenceId(eventText) {
        const uidLine = this._extractICalLine(eventText, 'UID');
        const ridLine = this._extractICalLine(eventText, 'RECURRENCE-ID');

        const { value: uid } = this._parseLineParts(uidLine || "") || {};
        const { value: rid, params: ridParams } = this._parseLineParts(ridLine || "") || {};

        return {
            uid,
            recurrenceId: rid || null,
            recurrenceIdParams: ridParams || {}
        };
    }


    parseTodaysEvents(eventsText, todayDate = GLib.DateTime.new_now(this.getLocalTimezone())) {
        if (!(todayDate instanceof GLib.DateTime)) {
            throw new Error("Expected a GLib.DateTime for todayDate");
        }

        eventsText = unfoldIcs(eventsText);
        const eventList = [];
        const events = eventsText.split("BEGIN:VEVENT").slice(1);
        const overridesByUidAndRecurrenceId = {}; // [ADDED] Track RECURRENCE-ID overrides
        const masterEventsByUid = {};             // [ADDED] Track master events

        console.log("starting list of event text:",events);//TODO: remove me.

        // First pass: parse overrides and masters
        for (let eventText of events) {
            const { uid, recurrenceId } = this._extractUidAndRecurrenceId(eventText);

            if (!uid) {
                this._log("Skipping event with missing UID (spec violation)");
                continue;
            }

            if (recurrenceId) {
                // It's an override
                const key = `${uid}|${recurrenceId}`;
                overridesByUidAndRecurrenceId[key] = eventText;
            } else {
                // It's a master event
                masterEventsByUid[uid] = eventText;
            }
        }

        // Second pass: process all events (including overrides)
        for (let uid in masterEventsByUid) {
            const eventText = masterEventsByUid[uid];
            const {
                dtstartMatch, dtstartparams, dtstartvalue,
                dtendMatch, dtendparams, dtendvalue,
                summary, rruleLine, exdateStrArr
            } = this._extractEventFields(eventText);

            console.log("eventText:",eventText);//TODO: remove me.

            if (!dtstartMatch || !summary) continue;

            const { datetime: eventDate, hasTime } = this._parseToLocalisedDate(dtstartvalue, dtstartparams.TZID);
            const endDate = this._computeEndDate(eventDate, dtendvalue, dtendparams?.TZID, hasTime);

            let isRecurring = false;

            if (rruleLine && isOnOrBeforeToday(eventDate, todayDate)) {
                const { value: rruleValue } = this._parseLineParts(rruleLine);
                const rruleParams = convertToKVP(rruleValue);
                const repeatCount = rruleParams.count ? rruleParams.count : Infinity;
                const interval = parseInt(rruleParams.interval || "1", 10);

                if (rruleParams.until && this._eventExpired(rruleParams.until, todayDate)) continue;

                const instanceStart = hasTime
                    ? combineDateAndTime(todayDate, eventDate, this.getLocalTimezone())
                    : todayDate;

                const instanceEnd = this._computeRecurringEnd(instanceStart, eventDate, endDate, hasTime);

                if (this._isExcludedDate(instanceStart, exdateStrArr)) continue;
                if (!this._byDayMatches(rruleParams, todayDate, eventDate)) continue;

                if (this._isRecurringInstanceValid(rruleParams.freq, eventDate, todayDate, repeatCount, interval)) {
                    // [ADDED] Check if there's an override for this instance
                    const recurrenceKey = `${uid}|${eventDate.format("%Y%m%dT%H%M%S")}`;
                    if (overridesByUidAndRecurrenceId[recurrenceKey]) {
                        this._log(`Skipping overridden instance at ${eventDate} for UID ${uid}`);
                        continue; // overridden
                    }

                    if (hasTime && instanceEnd && instanceEnd.compare(todayDate) < 0) {
                        this._log(`skipping past instance of recurring event: '${summary}' at:${instanceStart}`);
                        continue;
                    }

                    eventList.push(this._createEvent(instanceStart, summary, hasTime));
                }

                isRecurring = true;
            }

            if (!isRecurring && isSameDayIgnoringTime(eventDate, todayDate)) {
                if (!hasTime || !endDate || endDate.compare(todayDate) >= 0) {
                    this._log(`found simple event: ${summary} at:${eventDate} time now:${todayDate}`);
                    eventList.push(this._createEvent(eventDate, summary, hasTime));
                }
            }
        }

        // [ADDED] Add the overrides themselves as standalone events
        for (let key in overridesByUidAndRecurrenceId) {
            const eventText = overridesByUidAndRecurrenceId[key];

            const { uid } = this._extractUidAndRecurrenceId(eventText);

            if (!uid) {
                this._log("Skipping override event with missing UID (spec violation)");
                continue;
            }

            const {
                dtstartMatch, dtstartparams, dtstartvalue,
                dtendMatch, dtendparams, dtendvalue,
                summary
            } = this._extractEventFields(eventText);

            if (!dtstartMatch || !summary) continue;

            const { datetime: eventDate, hasTime } = this._parseToLocalisedDate(dtstartvalue, dtstartparams.TZID);
            const endDate = this._computeEndDate(eventDate, dtendvalue, dtendparams?.TZID, hasTime);

            if (!isSameDayIgnoringTime(eventDate, todayDate)) continue;
            if (hasTime && endDate && endDate.compare(todayDate) < 0) continue;

            eventList.push(this._createEvent(eventDate, summary, hasTime));
        }

        eventList.sort((a, b) => a.time.to_unix() - b.time.to_unix());
        return eventList;
    }

}

//export for GJS
var IcsHelper = IcsHelperImpl;