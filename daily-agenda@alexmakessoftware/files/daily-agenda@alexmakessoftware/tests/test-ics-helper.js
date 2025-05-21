// cd to the dir above and run with:
// gjs tests/test-ics-helper.js

const GLib = imports.gi.GLib;

imports.searchPath.unshift('./helpers');
const IcsHelper = imports['ics-helper'].IcsHelper;


function assert(condition, message) {
    if (!condition) throw new Error("Assertion failed: " + message);
}

function fakeDate(yyyy, mm, dd, hh = 0, min = 0) {
    return new Date(yyyy, mm - 1, dd, hh, min);
}


function _(s) {
    return s;
}


function testFoldedSummaryParsesCorrectly() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART:20250501T0900
SUMMARY:Meeting with
 Alice
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, fakeDate(2025, 5, 1));
    assert(results.length === 1, "Folded SUMMARY line should be parsed as a single logical line");
    assert(results[0].summary.includes("Meeting with Alice"), "Summary should include unfolded text");
    print("✔ testFoldedSummaryParsesCorrectly");
}


function testHandlesStartTimesWithTimezones() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART;TZID=Europe/London:20250501T1400
SUMMARY:Tea with vicar
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, fakeDate(2025, 5, 1)); // 1 May 2025

    assert(results.length === 1, "TZID DTSTART should be parsed correctly");
    assert(results[0].summary.includes("Tea with vicar"), "Event summary should be correct");
    print("✔ testHandlesStartTimesWithTimezones");
}


function testTolleratesTrailingZOnTimezone() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART:20250501T070000Z
SUMMARY:Call with New York
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, fakeDate(2025, 5, 1));

    assert(results.length === 1, "Should parse UTC time with Z suffix");
    assert(results[0].summary.includes("Call with New York"), "Event summary should be correct");
    print("✔ testHandlesUtcStartTime");
}


function testConvertsTZIDToLocalDate() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART;TZID=Europe/London:20250501T090000
SUMMARY:Morning meeting
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, fakeDate(2025, 5, 1));

    assert(results.length === 1, "Should parse TZID event");

    const event = results[0];
    const expected = new Date(2025, 4, 1, 9, 0); // May is month 4 (zero-based)

    assert(event.time.getHours() === expected.getHours(), "Event time should be 09:00 local");
    assert(event.summary.includes("Morning meeting"), "Summary should be correct");
    print("✔ testConvertsTZIDToLocalDate");
}


function testConvertsUtcZTimeToLocal() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART:20250501T080000Z
SUMMARY:Global conference call
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, fakeDate(2025, 5, 1));

    assert(results.length === 1, "Should parse UTC time");

    const event = results[0];

    const utc = new Date(Date.UTC(2025, 4, 1, 8, 0)); // 08:00 UTC
    const local = new Date(2025, 4, 1, 9, 0);         // BST in UK is +1h at that time

    assert(event.time.getUTCHours() === utc.getUTCHours(), "Stored time should match UTC");
    assert(
        event.time.getHours() === local.getHours(),
        "Event time should reflect UK local time (BST)"
    );
    assert(event.summary.includes("Global conference call"), "Summary should be correct");

    print("✔ testConvertsUtcZTimeToLocal");
}


function testParseToLocalisedDate_inUK() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    const { date, hasTime } = helper._parseToLocalisedDate("20250501T090000");

    // UK date: 1st May 2025, 09:00 BST
    const expected = new Date(2025, 4, 1, 9, 0); // JS months are 0-based

    assert(hasTime, "Expected hasTime to be true");
    assert(date.getFullYear() === expected.getFullYear(), "Year should match");
    assert(date.getMonth() === expected.getMonth(), "Month should match");
    assert(date.getDate() === expected.getDate(), "Date should match");
    assert(date.getHours() === expected.getHours(), "Hour should be 09");
    assert(date.getMinutes() === expected.getMinutes(), "Minute should be 00");

    print("✔ testParseToLocalisedDate_inUK");
}


function testParseToLocalisedDate_respectsTimezone() {    

    // Simulate a local system running in UK timezone
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    // Input represents 09:00 in Berlin, but no Z = not UTC
    const dtstart = "20250501T090000";
    const timezone = "Europe/Berlin";

    const { date, hasTime } = helper._parseToLocalisedDate(dtstart, timezone);

    assert(hasTime, "Expected hasTime to be true");

    // Since it's 09:00 Berlin time, UK local time should be 08:00
    assert(date.getHours() === 8, `Expected 08:00 UK time, got ${date.getHours()}:00`);
    assert(date.getDate() === 1, "Expected May 1st");
    assert(date.getMonth() === 4, "Expected May");
    assert(date.getFullYear() === 2025, "Expected 2025");

    print("✔ testParseToLocalisedDate_respectsTimezone");
}


function testParsesAllDayEvent_withValueDate() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART;VALUE=DATE:20250501
SUMMARY:Bank Holiday
END:VEVENT`;

    const results = helper.parseTodaysEvents(ics, fakeDate(2025, 5, 1)); // 1st May 2025

    assert(results.length === 1, "Should detect all-day VALUE=DATE event");
    assert(results[0].is_all_day === true, "Should be all day event");
    assert(results[0].summary.includes("Bank Holiday"), "Summary should be shown correctly");

    print("✔ testParsesAllDayEvent_withValueDate");
}


function testParsesRealIcsDate() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));

    // Real-world DTSTART formats
    const inputs = [
        "20250501T090000Z",                 // UTC
        "20250501T090000",                  // Local time
        "20250501",                         // All-day event
    ];

    for (const input of inputs) {
        const { date, hasTime } = helper._parseToLocalisedDate(input);
        assert(date instanceof Date, `Returned object is not a Date for ${input}`);
        assert(!isNaN(date.getTime()), `Invalid Date object for ${input}`);
        //log(`✔ ${input} => ${date.toISOString()}, hasTime: ${hasTime}`);
    }

    print("✔ testParsesRealIcsDate passed");
}


function testDailyRepeatingEvent() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const fixedToday = new Date("2025-05-14T00:00:00Z");  // UTC date

    // Create a daily repeating event
    const dailyEvent = [
        "BEGIN:VEVENT",
        "DTSTART:20250513T090000",  // Event starts the day before, but repeats daily
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
        return isOnSameDay(new Date(event.time), fixedToday);
    }), "Repeating event not found for today");    

    print("✔ testDailyRepeatingEvent passed");
}


function isOnSameDay(a,b) {
    // console.log("comparing", a,b);

    // console.log(a.getFullYear() === b.getFullYear());
    // console.log(a.getMonth() === b.getMonth());
    // console.log(a.getDate() === b.getDate());

    return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}


function testWeeklyRepeatingEvent() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    const fixedToday = new Date("2025-05-14T00:00:00Z"); //UTC

    // Create a weekly repeating event
    const weeklyEvent = [
        "BEGIN:VEVENT",
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
        const eventDate = new Date(event.time);
        return isOnSameDay(eventDate, fixedToday);
    }), "Weekly event not found for today");

    print("✔ testWeeklyRepeatingEvent passed");
}


function testDailyRepeatingEventPastCount() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set a "today" date that's past the repeat count
    const fixedToday = new Date("2025-05-18T00:00:00Z");  // UTC date, after 5 occurrences

    // Create a daily repeating event with 5 occurrences
    const dailyEvent = [
        "BEGIN:VEVENT",
        "DTSTART:20250513T090000",  // Event starts the day before, but repeats daily
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
    const fixedToday = new Date("2025-06-10T00:00:00Z");  // UTC date, after 5 occurrences of a weekly event

    // Create a weekly repeating event with 5 occurrences
    const weeklyEvent = [
        "BEGIN:VEVENT",
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
    const fixedToday = new Date("2026-05-13T00:00:00Z");  // The second occurrence is May 13, 2026    

    // Create a yearly repeating event with 5 occurrences
    const yearlyEvent = [
        "BEGIN:VEVENT",
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
        return isOnSameDay(new Date(event.time), fixedToday);
    }), "Repeating event not found for today");

    print("✔ testYearlyRepeatingEvent passed");
}


function testYearlyRepeatingEventPastCount() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));
    
    const fixedToday = new Date("2030-05-13T00:00:00Z");  // 6th occurrence 

    // Create a yearly repeating event with 5 occurrences
    const yearlyEvent = [
        "BEGIN:VEVENT",
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
    const fixedToday = new Date("2025-05-12T00:00:00Z");  // This is one day before the UNTIL date

    // Create a daily repeating event with UNTIL
    const dailyEvent = [
        "BEGIN:VEVENT",
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


function test_byDayMatches_weeklyByday_match() {
    const helper = new imports['ics-helper'].IcsHelper(() => GLib.TimeZone.new("UTC"));

    const rrule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
    const eventStart = new Date("2025-05-05T09:00:00Z"); // Monday
    const referenceDate = new Date("2025-05-16T00:00:00Z"); // Friday (following week)

    assert(helper._byDayMatches(rrule, referenceDate, eventStart) === true,
        "Should match Friday in BYDAY even if event started on Monday");

    print("✔ test_byDayMatches_weeklyByday_match passed");
}

function test_byDayMatches_rejects_nomatch() {
    const helper = new imports['ics-helper'].IcsHelper(() => GLib.TimeZone.new("UTC"));

    const rrule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
    const eventStart = new Date("2025-05-05T09:00:00Z"); // Monday
    const referenceDate = new Date("2025-05-15T00:00:00Z"); // Thursday

    assert(helper._byDayMatches(rrule, referenceDate, eventStart) === false,
        "Should not match Thursday, not in BYDAY");

    print("✔ test_byDayMatches_rejects_nomatch passed");
}

function test_byDayMatches_noByDay_allDaysAllowed() {
    const helper = new imports['ics-helper'].IcsHelper(() => GLib.TimeZone.new("UTC"));

    const rrule = "FREQ=WEEKLY"; // no BYDAY
    const eventStart = new Date("2025-05-01T09:00:00Z");
    const referenceDate = new Date("2025-05-20T00:00:00Z"); // any day

    assert(helper._byDayMatches(rrule, referenceDate, eventStart) === true,
        "Should match any day if BYDAY is not specified");

    print("✔ test_byDayMatches_noByDay_allDaysAllowed passed");
}


function testDailyRepeatingEventUntilExpired() {
    const IcsHelper = imports['ics-helper'].IcsHelper;
    const helper = new IcsHelper(() => GLib.TimeZone.new("UTC"));

    // Set a "today" date that's after the UNTIL range
    const fixedToday = new Date("2025-05-14T00:00:00Z");  // This is after the UNTIL date of May 13, 2025

    // Create a daily repeating event with UNTIL (May 13, 2025)
    const dailyEvent = [
        "BEGIN:VEVENT",
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
        "DTSTART:20250505T090000",  // Monday
        "SUMMARY:MWF Repeating Event",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
        "END:VEVENT"
    ];

    const eventsText = repeatingEvent.join("\n");

    // Test Thursday, 2025-05-15 — should NOT match
    const thursday = new Date("2025-05-15T00:00:00Z");
    const thursdayEvents = helper.parseTodaysEvents(eventsText, thursday);
    assert(thursdayEvents.length === 0, `Expected no event on Thursday (${thursday.toISOString()})`);

    // Test Friday, 2025-05-16 — should match
    const friday = new Date("2025-05-16T00:00:00Z");
    const fridayEvents = helper.parseTodaysEvents(eventsText, friday);

    assert(fridayEvents.length === 1, `Expected one event on Friday (${friday.toISOString()})`);

    print("✔ testRepeatsByDay passed");
}


function testRepeatsMonthlyEvent() {
    const helper = new IcsHelper(() => GLib.TimeZone.new("Europe/London"));
    const ics = `BEGIN:VEVENT
DTSTART:20250115T090000
RRULE:FREQ=MONTHLY
SUMMARY:Monthly Report
END:VEVENT`;

    const testDate = fakeDate(2025, 5, 15); // 15 May 2025

    const results = helper.parseTodaysEvents(ics, testDate);

    assert(results.length === 1, "Monthly recurrence should include this date");
    assert(results[0].summary.includes("Monthly Report"), "Event summary should match");
    print("✔ testRepeatsMonthlyEvent");
}


function testMonthlyExpiration() {
    const startDateString = "20220519T090000Z"; // 19 May 2022
    const todayDate = new Date(2025, 4, 19);   // 19 May 2025

    const count = 36; // 3 years × 12 months

    const rrule = `FREQ=MONTHLY;COUNT=${count}`;

    const eventsText = `
BEGIN:VEVENT
DTSTART:${startDateString}
SUMMARY:Monthly Test Event
RRULE:${rrule}
END:VEVENT
`;

    const icsHelper = new IcsHelper();
    const events = icsHelper.parseTodaysEvents(eventsText, todayDate);

    if (events.length !== 0) {
        throw new Error(`Expected no events, but found ${events.length}`);
    }

    print("✔ testMonthlyExpiration");
}


function testMiddayFilter() {
    const todayDate = new Date(2025, 4, 19, 11, 0, 0); // 19 May 2025, 11:00 local time

    const eventsText = `
BEGIN:VEVENT
DTSTART:20250519T080000Z
SUMMARY:Too Early
END:VEVENT
BEGIN:VEVENT
DTSTART:20250519T120000Z
SUMMARY:Just Right
END:VEVENT
BEGIN:VEVENT
DTSTART:20250519T160000Z
SUMMARY:Later Still
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250519
SUMMARY:All Day Event
END:VEVENT
`;

    const icsHelper = new IcsHelper();
    const events = icsHelper.parseTodaysEvents(eventsText, todayDate);
    const summaries = events.map(e => e.summary);

    const expected = ["Just Right", "Later Still", "All Day Event"];

    for (const summary of expected) {
        if (!summaries.includes(summary)) {
            throw new Error(`Expected to find '${summary}' in event list`);
        }
    }

    if (summaries.includes("Too Early")) {
        throw new Error("Unexpected event 'Too Early' was included");
    }

    console.log(summaries);

    print("✔ testMiddayFilter");
}




// Run all tests
try {
    testFoldedSummaryParsesCorrectly();
    testHandlesStartTimesWithTimezones();
    testTolleratesTrailingZOnTimezone();
    testConvertsTZIDToLocalDate();
    testConvertsUtcZTimeToLocal();
    testParseToLocalisedDate_inUK();
    testParseToLocalisedDate_respectsTimezone();
    testParsesAllDayEvent_withValueDate();
    testParsesRealIcsDate();
    testDailyRepeatingEvent();
    testWeeklyRepeatingEvent();
    testDailyRepeatingEventPastCount();
    testWeeklyRepeatingEventPastCount();
    testYearlyRepeatingEvent();
    testYearlyRepeatingEventPastCount();
    testDailyRepeatingEventUntil();
    test_byDayMatches_weeklyByday_match();
    test_byDayMatches_rejects_nomatch();
    test_byDayMatches_noByDay_allDaysAllowed();
    testDailyRepeatingEventUntilExpired();
    testRepeatsByDay();
    testRepeatsMonthlyEvent();
    testMonthlyExpiration();
    testMiddayFilter();
    print("\nAll tests completed ok.");
} catch (e) {    
    console.log(`Tests failed. ${e}\n Stack trace:\n`, e.stack);
}
