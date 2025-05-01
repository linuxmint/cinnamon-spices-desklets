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
    print("\nAll tests completed ok.");
} catch (e) {
    printerr("Test failed: " + e.message);
}
