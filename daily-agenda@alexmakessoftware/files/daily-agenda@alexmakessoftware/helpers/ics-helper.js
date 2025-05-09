// ics-helper.js
const GLib = imports.gi.GLib;


function isSameDay(a, b) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}


function getTimezoneObject(zoneString) {
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


function unfoldIcs(text) {
    return text.replace(/\r?\n[ \t]/g, ' ');
}

class IcsHelperImpl {
    constructor(timezoneProvider = () => GLib.TimeZone.new_local()) {
        this.getLocalTimezone = timezoneProvider;       
    }


    _parseToLocalisedDate(dtstartString, timezone = null) {
        const isUtc = dtstartString.endsWith('Z');
        const raw = isUtc ? dtstartString.slice(0, -1) : dtstartString;
    
        const datePart = raw.slice(0, 8);
        const timePart = raw.includes("T") ? raw.slice(9) : "";
    
        const hasTime = timePart.length >= 4;
    
        const hour = timePart.slice(0, 2).padEnd(2, '0') || "00";
        const minute = timePart.slice(2, 4).padEnd(2, '0') || "00";
        const second = timePart.slice(4, 6).padEnd(2, '0') || "00";
    
        const iso8601string = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${hour}:${minute}:${second}`;
    
        const tz = timezone
            ? getTimezoneObject(timezone)
            : isUtc
                ? getTimezoneObject("UTC")
                : this.getLocalTimezone();
    
        const glibDateInTimeZone = GLib.DateTime.new_from_iso8601(iso8601string, tz);
        if (!glibDateInTimeZone) throw new Error("Invalid date format: " + dtstartString);
    
        return {
            date: new Date(glibDateInTimeZone.to_unix() * 1000),
            hasTime
        };
    }
    

    parseTodaysEvents(eventsText, todayDate) {
        eventsText = unfoldIcs(eventsText);
        const eventList = [];
        const events = eventsText.split("BEGIN:VEVENT").slice(1);
    
        for (let eventText of events) {
            const dtstartMatch = eventText.match(/DTSTART[^:]*:([^\r\n]+)/);
            const summaryMatch = eventText.match(/SUMMARY(?:;[^:\n]*)?:\s*(.+)/);
    
            if (dtstartMatch && summaryMatch) {
                const dtstartString = dtstartMatch[1]; // e.g. 20250501T090000Z
                const { date: eventDate, hasTime } = this._parseToLocalisedDate(dtstartString);
    
                if (isSameDay(eventDate, todayDate)) {
                    if (!hasTime || eventDate >= todayDate) {
                        let displayDate = eventDate;

                        // Normalise all-day events to 00:00 on that day
                        if (!hasTime) {
                            displayDate = new Date(eventDate);
                            displayDate.setHours(0, 0, 0, 0); // clear time part
                        }

                        eventList.push({
                            time: eventDate,                            
                            summary: summaryMatch[1].trim(),
                            is_all_day: !hasTime
                        });
                    }
                }
            }
        }
    
        eventList.sort((a, b) => a.time - b.time);
        return eventList;
    }
}

//export for GJS
var IcsHelper = IcsHelperImpl;