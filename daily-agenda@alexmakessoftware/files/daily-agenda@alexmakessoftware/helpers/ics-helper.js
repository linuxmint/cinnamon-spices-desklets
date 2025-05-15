// ics-helper.js
const GLib = imports.gi.GLib;


function isSameDayIgnoringTime(a, b) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function combineDateAndTime(thatDate, thisTime) {
    // Extract the date part from `thatDate`
    const year = thatDate.getFullYear();
    const month = thatDate.getMonth();
    const date = thatDate.getDate();

    // Extract the time part from `thisTime`
    const hours = thisTime.getHours();
    const minutes = thisTime.getMinutes();
    const seconds = thisTime.getSeconds();
    const milliseconds = thisTime.getMilliseconds();

    // Combine the date from `thatDate` with the time from `thisTime`
    const combinedDate = new Date(year, month, date, hours, minutes, seconds, milliseconds);

    // Return the new combined date
    return combinedDate;
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


    _createEvent(eventDate, summary, hasTime) {
        let displayDate = eventDate;

        // If there's no 'time component' of this date (because it's all day), set it to midnight. 
        if (!hasTime) {
            displayDate = new Date(eventDate);
            displayDate.setHours(0, 0, 0, 0);
        }
    
        return {
            time: displayDate,
            summary: summary.trim(),
            is_all_day: !hasTime
        };
    }


    _parseRepeatCount(rrule) {
        const countMatch = rrule.match(/COUNT=(\d+)/);
        return countMatch ? parseInt(countMatch[1], 10) : Infinity;
    }


    _eventExpired(rrule, now) {
        const untilMatch = rrule.match(/UNTIL=([0-9T\-]+)/);
        let untilDate = null;
        if (untilMatch) {
            untilDate = this._parseToLocalisedDate(untilMatch[1]).date;
        } else {
            return false;
        }
        
        if (untilDate <= now) {
            return true;
        } else {
            return false;
        }
    }


    parseTodaysEvents(eventsText, todayDate = new Date()) {
        eventsText = unfoldIcs(eventsText);
        const eventList = [];
        const events = eventsText.split("BEGIN:VEVENT").slice(1);
    
        for (let eventText of events) {
            const dtstartMatch = eventText.match(/DTSTART[^:]*:([^\r\n]+)/);
            const summaryMatch = eventText.match(/SUMMARY(?:;[^:\n]*)?:\s*(.+)/);
            const rruleMatch = eventText.match(/RRULE:(.+)/); // Capture the RRULE line
    
            if (dtstartMatch && summaryMatch) {
                const dtstartString = dtstartMatch[1]; // e.g., 20250501T090000Z
                const { date: eventDate, hasTime } = this._parseToLocalisedDate(dtstartString);

                // Handle recurrence rule (RRULE) if it exists
                let isRecurring = false;
                let repeatCount = 0;                

                if (rruleMatch && (eventDate <= todayDate)) {                    
                    const rrule = rruleMatch[1]; 
                    const frequency = rrule.split(";")[0].split("=")[1];
                    repeatCount = this._parseRepeatCount(rrule);
                    isRecurring = true;

                    if(this._eventExpired(rrule, todayDate)) continue;                   

                    let useDateTime = hasTime? combineDateAndTime(todayDate, eventDate) : todayDate;
                    let occurrencesPassed = 0;

                    const daysDifference = Math.floor((todayDate - eventDate) / (1000 * 60 * 60 * 24));                    

                    if (frequency === "DAILY") {                                    
                        occurrencesPassed = daysDifference + 1;
                        //check not expired.
                        if (occurrencesPassed < repeatCount) {                            
                            eventList.push(this._createEvent(useDateTime, summaryMatch[1], hasTime));                        
                        }
                    } else if (frequency === "WEEKLY") {                        
                        if (eventDate.getDay() === todayDate.getDay()) {
                            const weeksPast = Math.floor(daysDifference / 7);
                            occurrencesPassed = weeksPast + 1;
                            //check not expired.
                            if(occurrencesPassed < repeatCount) {
                                eventList.push(this._createEvent(useDateTime, summaryMatch[1], hasTime));
                            }
                        }
                    } else if (frequency === "YEARLY") {
                        const yearsPast = todayDate.getFullYear() - eventDate.getFullYear();

                        // Check if today is the correct day (same day and month)
                        if (todayDate.getMonth() === eventDate.getMonth() && todayDate.getDate() === eventDate.getDate()) {
                            occurrencesPassed = yearsPast + 1; // Include the first occurrence
                    
                            // Check if the occurrences haven't exceeded the repeat count
                            if (occurrencesPassed <= repeatCount) {
                                eventList.push(this._createEvent(useDateTime, summaryMatch[1], hasTime));
                            }
                        }
                    }
                } else {
                    // event is in the future. Ignoring.
                }
    
                // If no recurrence rule, just check if the event happens today
                if (!isRecurring && isSameDayIgnoringTime(eventDate, todayDate)) {
                    if (!hasTime || eventDate >= todayDate) {
                        eventList.push(this._createEvent(eventDate, summaryMatch[1], hasTime));
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