imports.searchPath.unshift("./files/tide-times@alexmakessoftware/helpers");
imports.searchPath.unshift("./tests");
const { test, assertEqual, finish } = imports.testing;
const { RefreshSchedule } = imports["refresh-schedule"];
const { ErrorKind, TideApiError } = imports["tide-api"];

const MINUTE_MS = 60 * 1000;
const LOCATION_SETTLE_MS = 2000;
const WHITBY = { latitude: 54.49, longitude: -0.61 };
const OBAN = { latitude: 56.41, longitude: -5.47 };

function createHarness({ onStateChanged = () => {} } = {}) {
    const harness = {
        nowMs: 0,
        timers: [],
        requests: [],
        states: [],
        advance(durationMs) {
            this.nowMs += durationMs;
            const due = this.timers.filter((timer) => timer.dueMs <= this.nowMs);
            this.timers = this.timers.filter((timer) => timer.dueMs > this.nowMs);
            due.forEach((timer) => timer.callback());
        },
        get latestState() {
            return this.states[this.states.length - 1];
        },
    };
    harness.schedule = new RefreshSchedule({
        fetchPredictions: (location, onDone) => {
            const request = { location, onDone, wasCancelled: false };
            harness.requests.push(request);
            return () => { request.wasCancelled = true; };
        },
        runAfter: (delayMs, callback) => {
            const timer = { dueMs: harness.nowMs + delayMs, callback };
            harness.timers.push(timer);
            return () => { harness.timers = harness.timers.filter((other) => other !== timer); };
        },
        onStateChanged: (state) => {
            harness.states.push(state);
            onStateChanged(state);
        },
    });
    return harness;
}

function succeed(request, label = "predictions") {
    request.onDone(null, label);
}

function fail(request, kind = ErrorKind.NETWORK) {
    request.onDone(new TideApiError(kind, "failed"), null);
}

test("starting fetches straight away", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    assertEqual(harness.requests.length, 1, "requests");
    assertEqual(harness.requests[0].location, WHITBY, "location");
});

test("after a success the next fetch happens 30 minutes later, and not before", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0]);
    harness.advance(29 * MINUTE_MS);
    assertEqual(harness.requests.length, 1, "at 29 minutes");
    harness.advance(MINUTE_MS);
    assertEqual(harness.requests.length, 2, "at 30 minutes");
});

test("a fresh success publishes the predictions with no error", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0], "whitby tides");
    assertEqual(harness.latestState, { predictions: "whitby tides", error: null });
});

test("a failed refresh keeps the old predictions and reports the error", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0], "whitby tides");
    harness.advance(30 * MINUTE_MS);
    fail(harness.requests[1], ErrorKind.SERVICE_UNAVAILABLE);
    assertEqual(harness.latestState.predictions, "whitby tides", "predictions");
    assertEqual(harness.latestState.error.kind, ErrorKind.SERVICE_UNAVAILABLE, "error");
});

test("a later success clears the error", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    fail(harness.requests[0]);
    harness.advance(5 * MINUTE_MS);
    succeed(harness.requests[1], "whitby tides");
    assertEqual(harness.latestState, { predictions: "whitby tides", error: null });
});

test("a failed fetch retries after 5 minutes, without a tight loop", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    fail(harness.requests[0]);
    assertEqual(harness.requests.length, 1, "immediately after failing");
    harness.advance(4 * MINUTE_MS);
    assertEqual(harness.requests.length, 1, "at 4 minutes");
    harness.advance(MINUTE_MS);
    assertEqual(harness.requests.length, 2, "at 5 minutes");
});

test("being rate limited waits the full 30 minutes", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    fail(harness.requests[0], ErrorKind.RATE_LIMITED);
    harness.advance(29 * MINUTE_MS);
    assertEqual(harness.requests.length, 1, "at 29 minutes");
    harness.advance(MINUTE_MS);
    assertEqual(harness.requests.length, 2, "at 30 minutes");
});

test("changing location fetches once the settings stop changing", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0]);
    harness.schedule.setLocation({ latitude: 56.4, longitude: -5.47 });
    harness.advance(LOCATION_SETTLE_MS / 2);
    harness.schedule.setLocation(OBAN);
    assertEqual(harness.requests.length, 1, "while still changing");
    harness.advance(LOCATION_SETTLE_MS);
    assertEqual(harness.requests.length, 2, "once settled");
    assertEqual(harness.requests[1].location, OBAN, "location");
});

test("changing location drops the old location's predictions straight away", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0], "whitby tides");
    harness.schedule.setLocation(OBAN);
    assertEqual(harness.latestState, { predictions: null, error: null });
});

test("changing location cancels a fetch in progress, so requests never overlap", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    harness.schedule.setLocation(OBAN);
    assertEqual(harness.requests[0].wasCancelled, true);
});

test("a late reply for the previous location is ignored", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    harness.schedule.setLocation(OBAN);
    harness.advance(LOCATION_SETTLE_MS);
    succeed(harness.requests[0], "whitby tides");
    assertEqual(harness.latestState.predictions, null, "the old reply is not shown");
    succeed(harness.requests[1], "oban tides");
    assertEqual(harness.latestState.predictions, "oban tides", "the new reply is shown");
});

test("the replaced location's timer does not also fire", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0]);
    harness.schedule.setLocation(OBAN);
    harness.advance(LOCATION_SETTLE_MS);
    succeed(harness.requests[1]);
    harness.advance(29 * MINUTE_MS);
    assertEqual(harness.requests.length, 2, "only Oban's own 30-minute timer remains");
});

test("stopping cancels the fetch and the timers, and ignores late replies", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    const statesBeforeStopping = harness.states.length;
    harness.schedule.stop();
    assertEqual(harness.requests[0].wasCancelled, true, "fetch cancelled");
    succeed(harness.requests[0]);
    assertEqual(harness.states.length, statesBeforeStopping, "late reply ignored");
    assertEqual(harness.timers.length, 0, "no timers left");
});

test("stopping after a success leaves no timer running", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0]);
    harness.schedule.stop();
    assertEqual(harness.timers.length, 0);
});

test("restarting after a stop never shows the earlier location's predictions", () => {
    const harness = createHarness();
    harness.schedule.start(WHITBY);
    succeed(harness.requests[0], "whitby tides");
    harness.schedule.stop();
    harness.schedule.start(OBAN);
    fail(harness.requests[1]);
    assertEqual(harness.latestState.predictions, null);
});

test("setting a location on a stopped schedule fetches once the settings stop changing", () => {
    const harness = createHarness();
    harness.schedule.setLocation(WHITBY);
    assertEqual(harness.requests.length, 0, "straight away");
    harness.advance(LOCATION_SETTLE_MS);
    assertEqual(harness.requests.length, 1, "once settled");
});

test("refreshes carry on even if showing a result throws", () => {
    const harness = createHarness({ onStateChanged: (state) => {
        if (state.predictions) {
            throw new Error("display failed");
        }
    } });
    harness.schedule.start(WHITBY);
    try {
        succeed(harness.requests[0]);
    } catch (error) {
        // The display's failure is not what this test is about.
    }
    harness.advance(30 * MINUTE_MS);
    assertEqual(harness.requests.length, 2);
});

finish();
