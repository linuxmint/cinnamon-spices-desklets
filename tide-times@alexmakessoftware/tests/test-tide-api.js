imports.searchPath.unshift("./files/tide-times@alexmakessoftware/helpers");
imports.searchPath.unshift("./tests");
const { test, assertEqual, assertThrowsKind, finish } = imports.testing;
const TideApi = imports["tide-api"];

const WHITBY = { latitude: 54.49, longitude: -0.61 };

// Trimmed from a real /timeline response for Whitby.
const WHITBY_TIMELINE = JSON.stringify({
    datum: "LAT",
    units: "meters",
    station: { id: "ticon/whitby-whi-gbr-bodc", name: "Whitby", timezone: "Europe/London" },
    distance: 0.3,
    timeline: [
        { time: "2026-11-05T09:10:00.000Z", hour: 0, level: 2.25 },
        { time: "2026-11-05T09:20:00.000Z", hour: 0.1666, level: 2.5 },
    ],
});

test("a successful timeline gives the station, its distance and timed levels", () => {
    const predictions = TideApi.parseTimelineResponse(200, WHITBY_TIMELINE);

    assertEqual(predictions.stationName, "Whitby", "station name");
    assertEqual(predictions.distanceKm, 0.3, "distance");
    assertEqual(predictions.samples, [
        { timeMs: Date.UTC(2026, 10, 5, 9, 10), level: 2.25 },
        { timeMs: Date.UTC(2026, 10, 5, 9, 20), level: 2.5 },
    ], "samples");
});

test("each HTTP failure is reported as its own kind of error", () => {
    const ERROR_BODY = '{"message":"latitude must be <= 90"}';
    assertThrowsKind(() => TideApi.parseTimelineResponse(400, ERROR_BODY), TideApi.ErrorKind.INVALID_LOCATION);
    assertThrowsKind(() => TideApi.parseTimelineResponse(404, ERROR_BODY), TideApi.ErrorKind.NO_STATION);
    assertThrowsKind(() => TideApi.parseTimelineResponse(429, ERROR_BODY), TideApi.ErrorKind.RATE_LIMITED);
    assertThrowsKind(() => TideApi.parseTimelineResponse(503, "<html>Bad gateway</html>"), TideApi.ErrorKind.SERVICE_UNAVAILABLE);
});

test("a response that is not usable JSON is malformed", () => {
    const unusableBodies = [
        "<html>not json</html>",
        "null",
        "{}",
        '{"timeline":"soon"}',
        '{"timeline":[{"time":"not a date","level":1}]}',
        '{"timeline":[{"time":"2026-11-05T09:10:00.000Z","level":"high"}]}',
    ];
    for (const body of unusableBodies) {
        assertThrowsKind(() => TideApi.parseTimelineResponse(200, body), TideApi.ErrorKind.MALFORMED_RESPONSE);
    }
});

test("an empty timeline means no predictions are available", () => {
    assertThrowsKind(() => TideApi.parseTimelineResponse(200, '{"timeline":[]}'), TideApi.ErrorKind.NO_STATION);
});

test("a missing station or distance is tolerated, because the levels are still usable", () => {
    const body = '{"timeline":[{"time":"2026-11-05T09:10:00.000Z","level":1}]}';
    const predictions = TideApi.parseTimelineResponse(200, body);
    assertEqual(predictions.stationName, null, "station name");
    assertEqual(predictions.distanceKm, null, "distance");
});

test("a station name or distance of the wrong type counts as missing, because the display relies on them", () => {
    const body = '{"station":{"name":7},"distance":"near","timeline":[{"time":"2026-11-05T09:10:00.000Z","level":1}]}';
    const predictions = TideApi.parseTimelineResponse(200, body);
    assertEqual(predictions.stationName, null, "station name");
    assertEqual(predictions.distanceKm, null, "distance");
});

test("a successful extremes response gives timed highs and lows", () => {
    const body = JSON.stringify({
        extremes: [
            { time: "2026-11-05T13:14:14.566Z", level: 4.75, high: true, low: false, label: "High" },
            { time: "2026-11-05T19:23:38.046Z", level: 1.75, high: false, low: true, label: "Low" },
        ],
    });
    assertEqual(TideApi.parseExtremesResponse(200, body), [
        { timeMs: Date.UTC(2026, 10, 5, 13, 14, 14, 566), isHigh: true },
        { timeMs: Date.UTC(2026, 10, 5, 19, 23, 38, 46), isHigh: false },
    ]);
});

test("a response holding the wrong list, or broken entries, is malformed", () => {
    assertThrowsKind(() => TideApi.parseTimelineResponse(200, '{"extremes":[]}'), TideApi.ErrorKind.MALFORMED_RESPONSE);
    assertThrowsKind(() => TideApi.parseExtremesResponse(200, '{"timeline":[]}'), TideApi.ErrorKind.MALFORMED_RESPONSE);
    assertThrowsKind(() => TideApi.parseTimelineResponse(200, '{"timeline":[null]}'), TideApi.ErrorKind.MALFORMED_RESPONSE);
});

test("an unreadable height on an extreme does not matter, because only its time and type are used", () => {
    const body = '{"extremes":[{"time":"2026-11-05T13:14:14.566Z","level":"high","high":true}]}';
    assertEqual(TideApi.parseExtremesResponse(200, body), [{ timeMs: Date.UTC(2026, 10, 5, 13, 14, 14, 566), isHigh: true }]);
});

test("extremes failures use the same error kinds as the timeline", () => {
    assertThrowsKind(() => TideApi.parseExtremesResponse(429, "{}"), TideApi.ErrorKind.RATE_LIMITED);
    assertThrowsKind(() => TideApi.parseExtremesResponse(200, "{}"), TideApi.ErrorKind.MALFORMED_RESPONSE);
});

test("request URLs carry the location, the time range and metres", () => {
    const startMs = Date.UTC(2026, 6, 1, 6, 0);
    const endMs = Date.UTC(2026, 6, 2, 12, 30);
    const expectedQuery = "latitude=54.49&longitude=-0.61&start=2026-07-01T06%3A00%3A00.000Z&end=2026-07-02T12%3A30%3A00.000Z&units=meters";
    assertEqual(TideApi.buildTimelineUrl(WHITBY, { startMs, endMs }), `https://api.openwaters.io/tides/timeline?${expectedQuery}`);
    assertEqual(TideApi.buildExtremesUrl(WHITBY, { startMs, endMs }), `https://api.openwaters.io/tides/extremes?${expectedQuery}`);
});

test("only coordinates inside the valid ranges, and not the unset default of 0,0, are usable", () => {
    assertEqual(TideApi.isUsableLocation({ latitude: 54.49, longitude: -0.61 }), true, "Whitby");
    assertEqual(TideApi.isUsableLocation({ latitude: 90, longitude: 180 }), true, "the range limits");
    assertEqual(TideApi.isUsableLocation({ latitude: 0, longitude: 0 }), false, "the unset default");
    assertEqual(TideApi.isUsableLocation({ latitude: 90.5, longitude: 0 }), false, "latitude too large");
    assertEqual(TideApi.isUsableLocation({ latitude: 0, longitude: -180.5 }), false, "longitude too small");
    assertEqual(TideApi.isUsableLocation({ latitude: NaN, longitude: 1 }), false, "not a number");
});

finish();
