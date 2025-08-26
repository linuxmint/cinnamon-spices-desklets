// cd to the dir above and run with:
// gjs tests/test-ics-helper.js

const GLib = imports.gi.GLib;

imports.searchPath.unshift('./helpers');
const IcsHelper = imports['ics-helper'].IcsHelper;


function assert(condition, message) {
    if (!condition) throw new Error("Assertion failed: " + message);
}

function sameDay(a, b, message) {
    return ( a.get_year() === b.get_year() && a.get_month() === b.get_month() && a.get_day_of_month() === b.get_day_of_month() );        
}

function makeGlibDateTime(yyyy, mm, dd, hh = 0, min = 0, timezoneStr = "Europe/London") {
    const tz = GLib.TimeZone.new(timezoneStr);
    return GLib.DateTime.new(tz, yyyy, mm, dd, hh, min, 0);
}


function _(s) {
    return s;
}


function test_parseToLocalisedDate_with_time() {
    // Inject a fixed timezone so tests are deterministic
    const tzName = "Europe/London";
    const helper = new IcsHelper(() => GLib.TimeZone.new(tzName));

    // Parse a date-time string with time
    const { datetime: dt, hasTime } = helper._parseToLocalisedDate("20250501T090000", tzName);

    assert(dt !== undefined, "Date should be a valid object.");

    assert(dt instanceof GLib.DateTime,
           "Expected a GLib.DateTime instance");

    assert(hasTime === true,
           "hasTime should be true when a time component is present");

    // Check components
    assert(dt.get_year() === 2025,    "Year should be 2025");
    assert(dt.get_month() === 5,      "Month should be May (5)");
    assert(dt.get_day_of_month() === 1, "Day should be 1");
    assert(dt.get_hour() === 9,       "Hour should be 09");

    print("✔ test_parseToLocalisedDate_with_time");
}


function test_parseToLocalisedDate_all_day() {
    const tzName = "Europe/London";
    const helper = new IcsHelper(() => GLib.TimeZone.new(tzName));

    // Parse a date-only string (all-day event)
    const { datetime: dt, hasTime } = helper._parseToLocalisedDate("20250501", tzName);

    assert(dt instanceof GLib.DateTime,
           "Expected a GLib.DateTime instance");

    assert(hasTime === false,
           "hasTime should be false for date-only (all-day) strings");

    // All-day events should be set to midnight local
    assert(dt.get_year() === 2025,       "Year should be 2025");
    assert(dt.get_month() === 5,         "Month should be May (5)");
    assert(dt.get_day_of_month() === 1,  "Day should be 1");
    assert(dt.get_hour() === 0,          "Hour should be 00 for all-day");
    assert(dt.get_minute() === 0,        "Minute should be 00 for all-day");

    print("✔ test_parseToLocalisedDate_all_day");
}


function test_parseLineParts_variants() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    // DTSTART:20250501T0900
    let result = helper._parseLineParts("DTSTART:20250501T0900");
    assert(result.key === "DTSTART", "Key should be DTSTART");
    assert(result.value === "20250501T0900", "Value should be correct");    

    // Test with a parameter
    result = helper._parseLineParts("DTSTART;TZID=Europe/London:20250612T090000");
    assert(result.key === "DTSTART", "Key should be DTSTART");
    assert(result.value === "20250612T090000", "Value should be correct");
    assert(result.params["TZID"] === "Europe/London", "TZID should be parsed");

    // Test without parameters
    result = helper._parseLineParts("SUMMARY:Test Event");
    assert(result.key === "SUMMARY", "Key should be SUMMARY");
    assert(result.value === "Test Event", "Value should be 'Test Event'");
    assert(Object.keys(result.params).length === 0, "Params should be empty");

    // Test multiple parameters
    result = helper._parseLineParts("ATTENDEE;CN=John Doe;ROLE=REQ-PARTICIPANT:mailto:johndoe@example.com");
    assert(result.key === "ATTENDEE", "Key should be ATTENDEE");
    assert(result.value === "mailto:johndoe@example.com", "Value should be email");
    assert(result.params["CN"] === "John Doe", "CN param should be parsed");
    assert(result.params["ROLE"] === "REQ-PARTICIPANT", "ROLE param should be parsed");

    // Test invalid line
    result = helper._parseLineParts("BrokenLineWithoutColon");
    assert(result.key === undefined, "Invalid line should return undefined key");

    print("✔ test_parseLineParts_variants");
}


function testFoldedSummaryParsesCorrectly() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
UID:blah:whatever.com
DTSTART:20250501T0900
SUMMARY:Meeting with
 Alice
END:VEVENT`; //n.b. the space before Alice is important. It indicates that this is a multi-line summary.
    const today = makeGlibDateTime(2025, 5, 1, 0, 0, "Europe/London");
    const results = helper.parseTodaysEvents(ics, today);
    assert(results.length === 1, "Folded SUMMARY line should be parsed as a single logical line");
    assert(results[0].summary.includes("Meeting with Alice"), "Summary should include unfolded text");
    print("✔ testFoldedSummaryParsesCorrectly");
}


function testHandlesStartTimesWithTimezones() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
UID:blah:whatever.com
DTSTART;TZID=Europe/London:20250501T1400
SUMMARY:Tea with vicar
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, makeGlibDateTime(2025, 5, 1, 0, 0, "Europe/London"));

    assert(results.length === 1, "TZID DTSTART should be parsed correctly");
    assert(results[0].summary.includes("Tea with vicar"), "Event summary should be correct");
    print("✔ testHandlesStartTimesWithTimezones");
}


function testTolleratesTrailingZOnTimezone() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
UID:blah:whatever.com
DTSTART:20250501T070000Z
SUMMARY:Call with New York
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, makeGlibDateTime(2025, 5, 1, 0, 0, "Europe/London"));

    assert(results.length === 1, "Should parse UTC time with Z suffix");
    assert(results[0].summary.includes("Call with New York"), "Event summary should be correct");
    print("✔ testHandlesUtcStartTime");
}


function testConvertsTZIDToLocalDate() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    const ics = `BEGIN:VEVENT
UID:blah:whatever.com
DTSTART;TZID=Europe/London:20250501T090000
SUMMARY:Morning meeting
END:VEVENT`;

    // Provide UTC "now", but event is at 9am London time.
    const referenceDate = makeGlibDateTime(2025, 5, 1, 8, 0, "UTC");

    const results = helper.parseTodaysEvents(ics, referenceDate);

    assert(results.length === 1, "Should parse TZID event");

    const event = results[0];

    // 9:00 in Europe/London is 8:00 UTC on that day (BST)
    const expectedUtc = makeGlibDateTime(2025, 5, 1, 8, 0, "UTC");

    assert(event.time.to_unix() === expectedUtc.to_unix(), "TZID should be converted to UTC correctly");
    assert(event.summary.includes("Morning meeting"), "Summary should be correct");
    print("✔ testConvertsTZIDToLocalDate");
}


function testConvertsUtcZTimeToLocal() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
UID:blah:whatever.com
DTSTART:20250501T080000Z
SUMMARY:Global conference call
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, makeGlibDateTime(2025, 5, 1, 0, 0, "Europe/London"));

    assert(results.length === 1, "Should parse UTC time");

    const event = results[0];

    const utc = makeGlibDateTime(2025, 5, 1, 8, 0, "UTC");
    
    const local = makeGlibDateTime(2025, 5, 1, 9, 0, "Europe/London");
    
    assert(
        event.time.get_hour() === local.get_hour(),
        "Event time should reflect UK local time (BST)"
    );
    assert(event.summary.includes("Global conference call"), "Summary should be correct");

    print("✔ testConvertsUtcZTimeToLocal");
}


function testParseToLocalisedDate_inUK() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    const { datetime:date, hasTime } = helper._parseToLocalisedDate("20250501T090000");

    // UK date: 1st May 2025, 09:00 BST
    const expected = makeGlibDateTime(2025, 5, 1, 9, 0);

    assert(hasTime, "Expected hasTime to be true");
    assert(date.get_year() === expected.get_year(), "Year should match");
    assert(date.get_month() === expected.get_month(), "Month should match");
    assert(date.get_day_of_month() === expected.get_day_of_month(), "Date should match");
    assert(date.get_hour() === expected.get_hour(), "Hour should be 09");
    assert(date.get_minute() === expected.get_minute(), "Minute should be 00");

    print("✔ testParseToLocalisedDate_inUK");
}


function testParseToLocalisedDate_respectsTimezone() {    

    // Simulate a local system running in UK timezone
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    // Input represents 09:00 in Berlin, but no Z = not UTC
    const dtstart = "20250501T090000";
    const timezone = "Europe/Berlin";

    const { datetime:date, hasTime } = helper._parseToLocalisedDate(dtstart, timezone);

    assert(hasTime, "Expected hasTime to be true");

    // Since it's 09:00 Berlin time, UK local time should be 08:00
    assert(date.get_hour() === 8, `Expected 08:00 UK time, got ${date.get_hour()}:00`);
    assert(date.get_day_of_month() === 1, "Expected May 1st");
    assert(date.get_month() === 5, "Expected May");
    assert(date.get_year() === 2025, "Expected 2025");

    print("✔ testParseToLocalisedDate_respectsTimezone");
}


function testParsesAllDayEvent_withValueDate() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
UID:blah:whatever.com
DTSTART;VALUE=DATE:20250501
SUMMARY:Bank Holiday
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, makeGlibDateTime(2025, 5, 1, 0, 0, "Europe/London"));

    assert(results.length === 1, "Should detect all-day VALUE=DATE event");
    assert(results[0].is_all_day === true, "Should be all day event");
    assert(results[0].summary.includes("Bank Holiday"), "Summary should be shown correctly");

    print("✔ testParsesAllDayEvent_withValueDate");
}


function testParsesRealIcsDate() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    // Case 1: UTC time
    const utcInput = "20250501T090000Z";
    const { datetime: utcDate, hasTime: utcHasTime } = helper._parseToLocalisedDate(utcInput);
    assert(utcDate instanceof GLib.DateTime, "UTC: Should return a GLib.DateTime instance");
    assert(!isNaN(utcDate.to_unix()), "UTC: Should return a valid Unix timestamp");
    assert(utcHasTime === true, "UTC: Should indicate time is present");

    // Case 2: Local time
    const localInput = "20250501T090000";
    const { datetime: localDate, hasTime: localHasTime } = helper._parseToLocalisedDate(localInput);
    assert(localDate instanceof GLib.DateTime, "Local time: Should return a GLib.DateTime instance");
    assert(!isNaN(localDate.to_unix()), "Local time: Should return a valid Unix timestamp");
    assert(localHasTime === true, "Local time: Should indicate time is present");

    // Case 3: All-day event
    const alldayInput = "20250501";
    const { datetime: alldayDate, hasTime: alldayHasTime } = helper._parseToLocalisedDate(alldayInput);
    assert(alldayDate instanceof GLib.DateTime, "All-day: Should return a GLib.DateTime instance");
    assert(!isNaN(alldayDate.to_unix()), "All-day: Should return a valid Unix timestamp");
    assert(alldayHasTime === false, "All-day: Should indicate no time component");

    print("✔ testParsesRealIcsDate passed");
}


function test_eventExpired() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));    
    const now = makeGlibDateTime(2025, 6, 16, 0, 0, "UTC");

    const testCases = [
        {
            description: "UNTIL in the past",
            rrule: "20250601T000000Z",
            expected: true
        },
        {
            description: "UNTIL in the future",
            rrule: "20250630T000000Z",
            expected: false
        }        
    ];

    testCases.forEach(({ description, rrule, expected }, index) => {
        const result = helper._eventExpired(rrule, now);                
        assert(result === expected, `test_eventExpired FAILED: Expected ${expected}, got ${result}`);        
    });

    print("✔ test_eventExpired passed");
}


function test_byDayMatches() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));    
    const UK = GLib.TimeZone.new("Europe/London");

    const testCases = [
        {
            description: "Weekly event with BYDAY=MO matches Monday",
            rruleParams: { freq: "WEEKLY", byday: "MO" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 3, 9, 0, 0), // Monday
            expected: true
        },
        {
            description: "Weekly event with BYDAY=TU fails on Monday",
            rruleParams: { freq: "WEEKLY", byday: "TU" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 3, 9, 0, 0),
            expected: false
        },
        {
            description: "Weekly event with no BYDAY uses DTSTART weekday",
            rruleParams: { freq: "WEEKLY" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            expected: true
        },
        {
            description: "Weekly event with no BYDAY fails if wrong weekday",
            rruleParams: { freq: "WEEKLY" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 11, 9, 0, 0), // Tuesday
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            expected: false
        },
        {
            description: "Monthly event with no BYDAY always matches",
            rruleParams: { freq: "MONTHLY" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 11, 9, 0, 0),
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0),
            expected: true
        },
        {
            description: "Weekly event with lowercase byday matches weekday",
            rruleParams: { freq: "WEEKLY", byday: "mo" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 3, 9, 0, 0),  // Monday
            expected: true
        },
        {
            description: "Weekly event with lowercase byday fails on wrong day",
            rruleParams: { freq: "WEEKLY", byday: "tu" },
            referenceDate: GLib.DateTime.new(UK, 2024, 6, 10, 9, 0, 0), // Monday
            eventStartDate: GLib.DateTime.new(UK, 2024, 6, 3, 9, 0, 0),
            expected: false
        }
    ];

    testCases.forEach(({ description, rruleParams, referenceDate, eventStartDate, expected }, index) => {
        const result = helper._byDayMatches(
            rruleParams,
            referenceDate,
            eventStartDate,
            rruleParams.freq
        );

        assert(result === expected,
            `test_byDayMatches FAILED: index:${index}, desc:${description}\nExpected: ${expected}, Got: ${result}`);        
    });

    print("✔ test_byDayMatches passed");
}


function testDailyRepeatingEvent() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const fixedToday = makeGlibDateTime(2025, 5, 14, 0, 0, "UTC");    

    // Create a daily repeating event
    const dailyEvent = [
        "BEGIN:VEVENT",
        "UID:blah:whatever.com",
        "DTSTART:20250513T090000Z",  // Event starts the day before, but repeats daily
        "SUMMARY:Daily Event",
        "RRULE:FREQ=DAILY;COUNT=5", // Daily recurrence, 5 occurrences
        "END:VEVENT"
    ];

    // Convert the array to a single string
    const eventsText = dailyEvent.join("\n");  // Join array elements with a newline

    // Pass in the fixed "today" date
    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    // Ensure there are repeating events for today
    assert(events.length > 0, `Should have at least one repeating event for 'today' (${fixedToday})`);

    //Ensure the event appears on the correct day    
    assert(events.some(event => {
        return sameDay(event.time, fixedToday);
    }), "Repeating event not found for today");    

    print("✔ testDailyRepeatingEvent passed");
}


function testWeeklyRepeatingEvent() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    
    const fixedToday = makeGlibDateTime(2025, 5, 14, 0, 0, "UTC");

    // Create a weekly repeating event
    const weeklyEvent = [
        "BEGIN:VEVENT",
        "UID:blah:whatever.com",
        "DTSTART:20250507T090000",  // Previous event date, repeats weekly
        "SUMMARY:Weekly Event",
        "RRULE:FREQ=WEEKLY;COUNT=5", // Weekly recurrence, 5 occurrences
        "END:VEVENT"
    ];

    // Convert the array to a single string
    const eventsText = weeklyEvent.join("\n");  // Join array elements with a newline

    // Pass in the fixed "today" date
    const events = helper.parseTodaysEvents(eventsText, fixedToday);    

    // Ensure there are weekly events for today
    assert(events.length > 0, "Should have at least one weekly event for today");

    // Ensure the event appears on the correct day    
    assert(events.some(event => {        
        return sameDay(event.time, fixedToday);
    }), "Weekly event not found for today");

    print("✔ testWeeklyRepeatingEvent passed");
}


function test_daysBetween() {
    const UK = GLib.TimeZone.new("Europe/London");

    const cases = [
        {
            desc: "Same day",
            d1: GLib.DateTime.new(UK, 2024, 6, 10, 0, 0, 0),
            d2: GLib.DateTime.new(UK, 2024, 6, 10, 23, 59, 59),
            expected: 0
        },
        {
            desc: "Next day",
            d1: GLib.DateTime.new(UK, 2024, 6, 10, 12, 0, 0),
            d2: GLib.DateTime.new(UK, 2024, 6, 11, 12, 0, 0),
            expected: 1
        },
        {
            desc: "Five day span",
            d1: GLib.DateTime.new(UK, 2024, 6, 1, 0, 0, 0),
            d2: GLib.DateTime.new(UK, 2024, 6, 6, 0, 0, 0),
            expected: 5
        },
        {
            desc: "Negative difference",
            d1: GLib.DateTime.new(UK, 2024, 6, 6, 0, 0, 0),
            d2: GLib.DateTime.new(UK, 2024, 6, 1, 0, 0, 0),
            expected: -5
        },
        {
            desc: "Make sure to round up, not down",
            d1: GLib.DateTime.new(UK, 2024, 6, 13, 9, 0, 0),
            d2: GLib.DateTime.new(UK, 2024, 6, 18, 0, 0, 0),
            expected: 5
        }
    ];

    for (const { desc, d1, d2, expected } of cases) {
        const result = imports['ics-helper'].daysBetween(d1, d2);
        assert(result === expected, `daysBetween FAILED: ${desc}. Expected ${expected}, got ${result}`);
    }

    print("✔ test_daysBetween passed");
}


function testDailyRepeatingEventPastCount() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set a "today" date that's past the repeat count    
    const fixedToday = makeGlibDateTime(2025, 5, 18, 0, 0, "UTC");// UTC date, after 5 occurrences

    // Create a daily repeating event with 5 occurrences
    const dailyEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250513T090000Z",  // Event starts the day before, but repeats daily
        "SUMMARY:Daily Event",
        "RRULE:FREQ=DAILY;COUNT=5", // Daily recurrence, 5 occurrences
        "END:VEVENT"
    ];

    // Convert the array to a single string
    const eventsText = dailyEvent.join("\n");  // Join array elements with a newline

    // Pass in the fixed "today" date
    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    // Ensure no events are added past the 5th occurrence
    assert(events.length === 0, `No repeating events should be found for 'today' (${fixedToday}), as they have exceeded the count`);

    print("✔ testDailyRepeatingEventPastCount passed");
}


function testWeeklyRepeatingEventPastCount() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set a "today" date that's past the repeat count (e.g., 6th occurrence)    
    const fixedToday = makeGlibDateTime(2025, 6, 10, 0, 0, "UTC");// UTC date, after 5 occurrences of a weekly event
    // Create a weekly repeating event with 5 occurrences
    const weeklyEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250513T090000",  // Event starts the day before, but repeats weekly
        "SUMMARY:Weekly Event",
        "RRULE:FREQ=WEEKLY;COUNT=4", // Weekly recurrence, 5 occurrences
        "END:VEVENT"
    ];

    // Convert the array to a single string
    const eventsText = weeklyEvent.join("\n");

    // Pass in the fixed "today" date
    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    // Ensure no events are added past the 5th occurrence
    assert(events.length === 0, `No repeating events should be found for 'today' (${fixedToday}), as they have exceeded the count`);

    print("✔ testWeeklyRepeatingEventPastCount passed");
}


function testYearlyRepeatingEvent() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set a "today" date that matches the second occurrence of the yearly event
    const fixedToday = makeGlibDateTime(2025, 5, 13, 0, 0, "UTC");// The second occurrence is May 13, 2026    

    // Create a yearly repeating event with 5 occurrences
    const yearlyEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250513T090000",  // Event starts on May 13, 2025
        "SUMMARY:Yearly Event",
        "RRULE:FREQ=YEARLY;COUNT=5", // Yearly recurrence, 5 occurrences
        "END:VEVENT"
    ];

    // Convert the array to a single string
    const eventsText = yearlyEvent.join("\n");

    // Pass in the fixed "today" date
    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    // Ensure the event is added for today (first occurrence)
    assert(events.length === 1, `There should be one repeating event for 'today' (${fixedToday})`);

    // Ensure the event appears on the correct day    
    assert(events.some(event => {
        return sameDay(event.time,fixedToday);
    }), "Repeating event not found for today");

    print("✔ testYearlyRepeatingEvent passed");
}


function testYearlyRepeatingEventPastCount() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    
    const fixedToday = makeGlibDateTime(2030, 5, 13, 0, 0, "UTC");  // 6th occurrence 

    // Create a yearly repeating event with 5 occurrences
    const yearlyEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250513T090000",  // Event starts on May 13, 2025
        "SUMMARY:Yearly Event",
        "RRULE:FREQ=YEARLY;COUNT=5", // Yearly recurrence, 5 occurrences
        "END:VEVENT"
    ];

    // Convert the array to a single string
    const eventsText = yearlyEvent.join("\n");

    // Pass in the fixed "today" date
    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    // Ensure no events are added past the 5th occurrence
    assert(events.length === 0, `No repeating events should be found for 'today' (${fixedToday}), as they have exceeded the count`);

    print("✔ testYearlyRepeatingEventPastCount passed");
}


function testDailyRepeatingEventUntil() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set "today" date to be inside the UNTIL range
    const fixedToday = makeGlibDateTime(2025, 5, 12, 0, 0, "UTC");  // This is one day before the UNTIL date

    // Create a daily repeating event with UNTIL
    const dailyEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250510T090000",  // Event starts on May 10, 2025
        "SUMMARY:Daily Event",
        "RRULE:FREQ=DAILY;UNTIL=20250513T000000Z", // Daily recurrence, until May 13, 2025
        "END:VEVENT"
    ];

    const eventsText = dailyEvent.join("\n");

    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    assert(events.length > 0, `Event should be found for 'today' (${fixedToday}), as it's within the UNTIL range`);

    print("✔ testDailyRepeatingEventUntil passed");
}


function testDailyRepeatingEventUntilExpired() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set a "today" date that's after the UNTIL range
    const fixedToday = makeGlibDateTime(2025, 5, 14, 0, 0, "UTC");  // This is after the UNTIL date of May 13, 2025

    // Create a daily repeating event with UNTIL (May 13, 2025)
    const dailyEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250510T090000",  // Event starts on May 10, 2025
        "SUMMARY:Daily Event",
        "RRULE:FREQ=DAILY;UNTIL=20250513T000000Z", // UNTIL is May 13, 2025
        "END:VEVENT"
    ];

    const eventsText = dailyEvent.join("\n");

    const events = helper.parseTodaysEvents(eventsText, fixedToday);

    assert(events.length === 0, `No repeating events should be found for 'today' (${fixedToday}), as it's past the UNTIL date`);

    print("✔ testDailyRepeatingEventUntilExpired passed");
}


function testRepeatsByDay() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // The event starts on Monday, 2025-05-05 and repeats every M/W/F indefinitely
    const repeatingEvent = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250505T090000",  // Monday
        "SUMMARY:MWF Repeating Event",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
        "END:VEVENT"
    ];

    const eventsText = repeatingEvent.join("\n");

    // Test Thursday, 2025-05-15 — should NOT match
    const thursday = makeGlibDateTime(2025, 5, 15, 0, 0, "UTC");
    const thursdayEvents = helper.parseTodaysEvents(eventsText, thursday);
    assert(thursdayEvents.length === 0, `Expected no event on Thursday (${thursday.format("%Y-%m-%d %H:%M:%S")})`);

    // Test Friday, 2025-05-16 — should match
    const friday = makeGlibDateTime(2025, 5, 16, 0, 0, "UTC");
    const fridayEvents = helper.parseTodaysEvents(eventsText, friday);

    assert(fridayEvents.length === 1, `Expected one event on Friday (${friday.format("%Y-%m-%d %H:%M:%S")})`);

    print("✔ testRepeatsByDay passed");
}


function testRepeatsMonthlyEvent() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
UID:expected@example.com
DTSTART:20250115T090000
RRULE:FREQ=MONTHLY
SUMMARY:Monthly Report
END:VEVENT`;

    const testDate = makeGlibDateTime(2025, 5, 15, 9, 0, "Europe/London"); // 15 May 2025

    const results = helper.parseTodaysEvents(ics, testDate);

    assert(results.length === 1, "Monthly recurrence should include this date");
    assert(results[0].summary.includes("Monthly Report"), "Event summary should match");
    print("✔ testRepeatsMonthlyEvent");
}


function testMonthlyExpiration() {    
    const todayDate = makeGlibDateTime(2025, 5, 19, 0, 0, "UTC");
    const count = 36; // 3 years × 12 months    
    const eventsText = `
BEGIN:VEVENT
UID:expected@example.com
DTSTART:20220519T090000Z
SUMMARY:Monthly Test Event
RRULE:FREQ=MONTHLY;COUNT=${count}
END:VEVENT
`;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const events = helper.parseTodaysEvents(eventsText, todayDate);

    if (events.length !== 0) {
        throw new Error(`Expected no events, but found ${events.length}`);
    }

    print("✔ testMonthlyExpiration");
}


function testMiddayFilter() {
    const todayDate = makeGlibDateTime(2025, 5, 19, 11, 0, "UTC");

    const eventsText = `
BEGIN:VEVENT
UID:expected@example.com
DTSTART:20250519T080000Z
SUMMARY:Too Early
END:VEVENT
BEGIN:VEVENT
UID:expected2@example.com
DTSTART:20250519T120000Z
SUMMARY:Just Right
END:VEVENT
BEGIN:VEVENT
UID:expected3@example.com
DTSTART:20250519T160000Z
SUMMARY:Later Still
END:VEVENT
BEGIN:VEVENT
UID:expected4@example.com
DTSTART;VALUE=DATE:20250519
SUMMARY:All Day Event
END:VEVENT
`;

    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const events = helper.parseTodaysEvents(eventsText, todayDate);
    const summaries = events.map(e => e.summary);
    const expected = ["Just Right", "Later Still", "All Day Event"];

    console.log("returned: ",events);//TODO: remove me.

    for (const summary of expected) {
        if (!summaries.includes(summary)) {
            throw new Error(`Expected to find '${summary}' in event list`);
        }
    }

    if (summaries.includes("Too Early")) {
        throw new Error("Unexpected event 'Too Early' was included");
    }

    print("✔ testMiddayFilter");
}


function testExdateExclusion() {
    const icsHelper = new IcsHelper(() => GLib.TimeZone.new("UTC"));        
    const todayDate = makeGlibDateTime(2025,5,21,10,0, "UTC");    
    const eventsText = `
BEGIN:VEVENT
UID:expected@example.com
DTSTART:20250516T090000Z
SUMMARY:Daily Test Event
RRULE:FREQ=DAILY
EXDATE:20250517T090000Z
EXDATE:20250521T090000Z
END:VEVENT
`;
    const events = icsHelper.parseTodaysEvents(eventsText, todayDate);

    if (events.length !== 0) {
        throw new Error(`Expected no events for today due to EXDATE, but found ${events.length}`);
    }

    print("✔ testExdateExclusion");
}


function testExdateExclusionOnStartDate() {        
    const todayDate = makeGlibDateTime(2025,5,21,8,0); // same day.
    const eventsText = `
BEGIN:VEVENT
UID:expected@example.com
DTSTART:20250521T090000Z
SUMMARY:Daily Test Event
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20250521T090000Z
END:VEVENT
`;

    const icsHelper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const events = icsHelper.parseTodaysEvents(eventsText, todayDate);

    if (events.length !== 0) {
        throw new Error(`Expected no events for today due to EXDATE, but found ${events.length}`);
    }

    print("✔ testExdateExclusionOnStartDate");
}


function testExdateExclusionAllDay() {
    const icsHelper = new IcsHelper(() => GLib.TimeZone.new("UTC"));        
    const todayDate = makeGlibDateTime(2025, 5, 21, 10, 0, "UTC"); // 10:00 on 2025-05-21

    const eventsText = `
BEGIN:VEVENT
UID:expected@example.com
DTSTART;VALUE=DATE:20250516
SUMMARY:Daily All-Day Event
RRULE:FREQ=DAILY
EXDATE;VALUE=DATE:20250521
END:VEVENT
`;

    const events = icsHelper.parseTodaysEvents(eventsText, todayDate);

    if (events.length !== 0) {
        throw new Error(`Expected no events for today due to EXDATE, but found ${events.length}`);
    }

    print("✔ testExdateExclusionAllDay");
}



function testBiWeeklyEvent() {
    const startDateString = "20250507T090000Z"; // Wednesday 7 May 2025
    const todayDate = makeGlibDateTime(2025, 5, 14, 10, 0, "Europe/London"); // Wednesday 14 May 2025

    const rrule = "FREQ=WEEKLY;INTERVAL=2";

    const eventsText = `
BEGIN:VEVENT
UID:expected@example.com
DTSTART:${startDateString}
SUMMARY:Bi-Weekly Test Event
RRULE:${rrule}
END:VEVENT
`;

    const icsHelper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const events = icsHelper.parseTodaysEvents(eventsText, todayDate);    

    if (events.length !== 0) {
        throw new Error(`Expected no events for today due to bi-weekly rule, but found ${events.length}`);
    }

    print("✔ testBiWeeklyEvent");
}


function test_isOnOrBeforeToday() {
    const UTC = GLib.TimeZone.new("UTC");
    const UK = GLib.TimeZone.new("Europe/London");
    const JST = GLib.TimeZone.new("Asia/Tokyo");

    const testCases = [
        {
            description: "Same day in same timezone",
            eventDate: GLib.DateTime.new(UTC, 2025, 6, 17, 0, 0, 0),
            todayDate: GLib.DateTime.new(UTC, 2025, 6, 17, 23, 59, 59),
            expected: true
        },
        {
            description: "Earlier day, same month/year",
            eventDate: GLib.DateTime.new(UTC, 2025, 6, 16, 12, 0, 0),
            todayDate: GLib.DateTime.new(UTC, 2025, 6, 17, 10, 0, 0),
            expected: true
        },
        {
            description: "Later day, same month/year",
            eventDate: GLib.DateTime.new(UTC, 2025, 6, 18, 9, 0, 0),
            todayDate: GLib.DateTime.new(UTC, 2025, 6, 17, 10, 0, 0),
            expected: false
        },
        {
            description: "Same date, different timezones (UTC vs UK)",
            eventDate: GLib.DateTime.new(UTC, 2025, 6, 17, 0, 0, 0),
            todayDate: GLib.DateTime.new(UK, 2025, 6, 17, 0, 0, 0),
            expected: true
        },
        {
            description: "Same date, different timezones (UTC vs JST)",
            eventDate: GLib.DateTime.new(JST, 2025, 6, 17, 0, 0, 0),
            todayDate: GLib.DateTime.new(UTC, 2025, 6, 17, 0, 0, 0),
            expected: true
        },
        {
            description: "Off-by-one due to timezone difference",
            eventDate: GLib.DateTime.new(JST, 2025, 6, 18, 0, 0, 0),
            todayDate: GLib.DateTime.new(UK, 2025, 6, 17, 23, 59, 59),
            expected: false
        }
    ];

    testCases.forEach(({ description, eventDate, todayDate, expected }, index) => {
        const result = imports['ics-helper'].isOnOrBeforeToday(eventDate, todayDate);
        assert(result === expected, `FAILED [${index}] ${description}: Expected ${expected}, got ${result}`);
    });

    print("✔ test_isOnOrBeforeToday passed.");
}


function testUntil() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));     

    const ics = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250513T090000Z",
        "SUMMARY:Event with UNTIL",
        "RRULE:FREQ=DAILY;UNTIL=20250515T090000Z", // Repeats 13th, 14th, 15th
        "END:VEVENT"
    ].join("\n");

    const includedDate = makeGlibDateTime(2025, 5, 15, 0, 0, "UTC"); // still within UNTIL
    const excludedDate = makeGlibDateTime(2025, 5, 16, 0, 0, "UTC"); // beyond UNTIL

    const included = helper.parseTodaysEvents(ics, includedDate);
    const excluded = helper.parseTodaysEvents(ics, excludedDate);

    assert(included.length === 1, "Event should be included on UNTIL date");
    assert(excluded.length === 0, "Event should not appear after UNTIL date");

    print("✔ testUntil passed");
}


function testPreferUntilOverCount() {
    // If both UNTIL and COUNT are specified (invalid per RFC 5545 but common in the wild), prefer UNTIL, ignore COUNT.
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    const ics = [
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250513T090000Z",
        "SUMMARY:Prefer UNTIL over COUNT",
        "RRULE:FREQ=DAILY;COUNT=10;UNTIL=20250515T090000Z", // COUNT would allow up to 22nd, but UNTIL says 15th
        "END:VEVENT"
    ].join("\n");

    const beforeUntil = makeGlibDateTime(2025, 5, 14, 0, 0, "UTC");
    const onUntil = makeGlibDateTime(2025, 5, 15, 0, 0, "UTC");
    const afterUntil = makeGlibDateTime(2025, 5, 16, 0, 0, "UTC");

    const eventsBefore = helper.parseTodaysEvents(ics, beforeUntil);
    const eventsOnUntil = helper.parseTodaysEvents(ics, onUntil);
    const eventsAfter = helper.parseTodaysEvents(ics, afterUntil);

    assert(eventsBefore.length === 1, "Event should appear before UNTIL date");
    assert(eventsOnUntil.length === 1, "Event should appear on UNTIL date");
    assert(eventsAfter.length === 0, "Event should not appear after UNTIL date even if COUNT allows it");

    print("✔ testPreferUntilOverCount passed");
}


function testRecurringInstanceValid_expiry() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const make = makeGlibDateTime;

    const cases = [
        {
            description: "Daily event, today is after repeatCount limit",
            frequency: "DAILY",
            eventDate: make(2025, 6, 1, 9, 0, "UTC"),
            todayDate: make(2025, 6, 5, 9, 0, "UTC"),
            repeatCount: 3, // valid for 3 days: 1st, 2nd, 3rd
            expected: false
        },
        {
            description: "Daily event, today is within repeatCount",
            frequency: "DAILY",
            eventDate: make(2025, 6, 1, 9, 0, "UTC"),
            todayDate: make(2025, 6, 3, 9, 0, "UTC"),
            repeatCount: 3,
            expected: true
        },
        {
            description: "Weekly event, today is too far",
            frequency: "WEEKLY",
            eventDate: make(2025, 6, 1, 9, 0, "UTC"),
            todayDate: make(2025, 6, 29, 9, 0, "UTC"),
            repeatCount: 3, // valid for 3 weeks
            expected: false
        },
        {
            description: "Monthly event, today is too far",
            frequency: "MONTHLY",
            eventDate: make(2025, 1, 10, 9, 0, "UTC"),
            todayDate: make(2025, 5, 10, 9, 0, "UTC"),
            repeatCount: 3, // valid for Feb, Mar, Apr
            expected: false
        },
        {
            description: "Yearly event, just within range",
            frequency: "YEARLY",
            eventDate: make(2020, 6, 17, 9, 0, "UTC"),
            todayDate: make(2022, 6, 17, 9, 0, "UTC"),
            repeatCount: 3,
            expected: true
        },
        {
            description: "Yearly event, beyond repeat limit",
            frequency: "YEARLY",
            eventDate: make(2020, 6, 17, 9, 0, "UTC"),
            todayDate: make(2024, 6, 17, 9, 0, "UTC"),
            repeatCount: 3,
            expected: false
        },
    ];

    for (const { description, frequency, eventDate, todayDate, repeatCount, expected } of cases) {
        const result = helper._isRecurringInstanceValid(
            frequency,
            eventDate,
            todayDate,
            repeatCount
        );

        assert(result === expected,
            `FAILED: ${description}\nExpected: ${expected}, Got: ${result}`);
    }

    print("✔ testRecurringInstanceValid_expiry");
}


function testRepeatedEventsTimePassedButNotRemovedBugFix() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // 10:00 UTC on the test day (8 May 2025)
    const timeNow   = makeGlibDateTime(2025, 5, 8, 10, 0, "UTC");
    // 11:00 UTC on the same day
    const timeLater = makeGlibDateTime(2025, 5, 8, 11, 0, "UTC");

    const ics = [
        // Daily 09:00 event – 40 minutes duration
        "BEGIN:VEVENT",
        "UID:expected@example.com",
        "DTSTART:20250501T090000Z",
        "DTEND:20250501T094000Z",
        "SUMMARY:09:00 event",
        "RRULE:FREQ=DAILY",
        "END:VEVENT",

        // Daily 10:00 event – 40 minutes duration
        "BEGIN:VEVENT",
        "UID:expected2@example.com",
        "DTSTART:20250501T100000Z",
        "DTEND:20250501T104000Z",
        "SUMMARY:10:00 event",
        "RRULE:FREQ=DAILY",
        "END:VEVENT",

        // Daily 11:00 event – 40 minutes duration
        "BEGIN:VEVENT",
        "UID:expected3@example.com",
        "DTSTART:20250501T110000Z",
        "DTEND:20250501T114000Z",
        "SUMMARY:11:00 event",
        "RRULE:FREQ=DAILY",
        "END:VEVENT"
    ].join("\n");

    // At 10 am we expect the 10 am and 11 am instances – total 2
    const events = helper.parseTodaysEvents(ics, timeNow);
    assert(events.length === 2, "There should be two events remaining at 10:00.");

    // At 11 am only the 11 am instance should remain – total 1
    const events2 = helper.parseTodaysEvents(ics, timeLater);
    assert(events2.length === 1, "There should be one event remaining at 11:00.");

    print("✔ testRepeatedEventsTimePassedButNotRemovedBugFix passed");
}


function testRecurringEventWithOverride() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    const timeNow = makeGlibDateTime(2025, 6, 12, 18, 0, "UTC");

    const ics = [
        // Recurring daily event at 17:00 starting June 10
        "BEGIN:VEVENT",
        "UID:recurring-1@example.com",
        "DTSTART:20250610T170000Z",
        "RRULE:FREQ=DAILY;COUNT=5",
        "SUMMARY:Daily Meeting",
        "EXDATE:20250612T170000Z", //The bit that cancels a specific occurance.
        "END:VEVENT",

        // Overridden instance for June 12 at 20:00
        "BEGIN:VEVENT",
        "UID:recurring-1@example.com",
        "RECURRENCE-ID:20250612T170000Z",
        "DTSTART:20250612T200000Z",
        "SUMMARY:Daily Meeting (rescheduled)",
        "END:VEVENT"
    ].join("\n");

    const events = helper.parseTodaysEvents(ics, timeNow);
    assert(events.length === 1, "Only the rescheduled instance should be returned.");
    assert(events[0].summary === "Daily Meeting (rescheduled)", "The summary should match the overridden instance.");
    assert(events[0].time.get_hour() === 20, "The event should start at 20:00 UTC.");
    
    print("✔ testRecurringEventWithOverride passed");
}


function testOngoingEventNotExcluded() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    const now = makeGlibDateTime(2025, 6, 20, 12, 0, "UTC"); // 12:00

    const eventsText = `
BEGIN:VEVENT
UID:ongoing-event-20250620@example.com
DTSTART:20250620T110000Z
DTEND:20250620T130000Z
SUMMARY:Ongoing Event
END:VEVENT
BEGIN:VEVENT
UID:past-event-20250620@example.com
DTSTART:20250620T090000Z
DTEND:20250620T100000Z
SUMMARY:Past Event
END:VEVENT
BEGIN:VEVENT
UID:future-event-20250620@example.com
DTSTART:20250620T130000Z
DTEND:20250620T140000Z
SUMMARY:Future Event
END:VEVENT
`;

    const events = helper.parseTodaysEvents(eventsText, now);
    const summaries = events.map(e => e.summary);

    // The past event should be excluded
    if (summaries.includes("Past Event")) {
        throw new Error("Past event should have been excluded");
    }

    // The ongoing and future events should be included
    ["Ongoing Event", "Future Event"].forEach(summary => {
        if (!summaries.includes(summary)) {
            throw new Error(`Expected to find '${summary}' in agenda`);
        }
    });

    print("✔ testOngoingEventNotExcluded passed");
}


function testRecurringEventOverride() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const testDate = makeGlibDateTime(2025, 7, 4, 12, 0, "Europe/London"); // test override day

    const ics = `
BEGIN:VEVENT
UID:X0l2m-DWWnf-AjtamssjYqRt0KDS@proton.me
DTSTAMP:20250703T162127Z
SUMMARY:Test
DTSTART;TZID=Europe/London:20250701T173000
DTEND;TZID=Europe/London:20250701T180000
SEQUENCE:0
RRULE:FREQ=DAILY
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:X0l2m-DWWnf-AjtamssjYqRt0KDS@proton.me
DTSTAMP:20250704T101933Z
SUMMARY:Test
DTSTART;TZID=Europe/London:20250704T190000
DTEND;TZID=Europe/London:20250704T193000
SEQUENCE:1
RECURRENCE-ID;TZID=Europe/London:20250704T173000
STATUS:CONFIRMED
END:VEVENT
`;

    const events = helper.parseTodaysEvents(ics, testDate);
    const summaries = events.map(e => `${e.summary} @ ${e.time.format('%H:%M')}`);

    if (!summaries.includes("Test @ 19:00")) {
        throw new Error("Expected to find overridden event at 19:00");
    }

    if (summaries.includes("Test @ 17:30")) {
        throw new Error("Did not expect original recurring instance at 17:30");
    }

    print("✔ testRecurringEventOverride passed");
}



// Run all tests
try {
    test_parseToLocalisedDate_with_time();
    test_parseToLocalisedDate_all_day();
    test_parseLineParts_variants();
    testFoldedSummaryParsesCorrectly();
    testHandlesStartTimesWithTimezones();
    testTolleratesTrailingZOnTimezone();
    testConvertsTZIDToLocalDate();
    testConvertsUtcZTimeToLocal();
    testParseToLocalisedDate_inUK();
    testParseToLocalisedDate_respectsTimezone();
    testParsesAllDayEvent_withValueDate();
    testParsesRealIcsDate();
    test_eventExpired();
    test_byDayMatches();
    testDailyRepeatingEvent();
    testWeeklyRepeatingEvent();
    test_daysBetween();
    testDailyRepeatingEventPastCount();
    testWeeklyRepeatingEventPastCount();
    testYearlyRepeatingEvent();
    testYearlyRepeatingEventPastCount();
    testDailyRepeatingEventUntil();    
    testDailyRepeatingEventUntilExpired();
    testRepeatsByDay();
    testRepeatsMonthlyEvent();
    testMonthlyExpiration();
    testMiddayFilter();
    testExdateExclusion();
    testExdateExclusionOnStartDate();
    testExdateExclusionAllDay();
    testBiWeeklyEvent();
    test_isOnOrBeforeToday();
    testUntil();
    testPreferUntilOverCount();
    testRecurringInstanceValid_expiry();
    testRepeatedEventsTimePassedButNotRemovedBugFix();
    testRecurringEventWithOverride();
    testOngoingEventNotExcluded();
    testRecurringEventOverride();

    print("\nAll tests completed ok.");
} catch (e) {    
    console.log(`Tests failed. ${e}\n Stack trace:\n`, e.stack);
}
