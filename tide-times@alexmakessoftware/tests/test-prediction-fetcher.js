imports.gi.versions.Soup = "3.0";
imports.searchPath.unshift("./files/tide-times@alexmakessoftware/helpers");
imports.searchPath.unshift("./tests");
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;
const { test, assertEqual, finish } = imports.testing;
const { PredictionFetcher } = imports["prediction-fetcher"];
const TideApi = imports["tide-api"];

const HTTP_OK = 200;
// Libsoup's Status enum has no value for this one, which GJS treats as an error.
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
// Also missing from the enum, and not a status the desklet handles by name.
const HTTP_NON_STANDARD_FAILURE = 599;

const CHART_HOURS_BEFORE_NOW = 6;
const REPLY_TIMEOUT_SECONDS = 5;
const WHITBY = { latitude: 54.49, longitude: -0.61 };

const TIMELINE_BODY = JSON.stringify({ timeline: [{ time: "2026-11-06T12:00:00Z", level: 1.5 }] });
const EXTREMES_BODY = JSON.stringify({ extremes: [{ time: "2026-11-06T13:00:00Z", high: true }] });

function reply(message, status, body) {
    message.set_status(status, null);
    message.set_response("application/json", Soup.MemoryUse.COPY, new TextEncoder().encode(body));
}

// Returns what onDone received, or null if it was never called, which is what stops the refreshes.
function fetchFromServerReplying({ timeline, extremes = { status: HTTP_OK, body: EXTREMES_BODY } }) {
    const server = new Soup.Server({});
    server.add_handler("/timeline", (_server, message) => reply(message, timeline.status, timeline.body));
    server.add_handler("/extremes", (_server, message) => reply(message, extremes.status, extremes.body));
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const baseUrl = `http://127.0.0.1:${server.get_uris()[0].get_port()}`;

    const tideApi = {
        ErrorKind: TideApi.ErrorKind,
        TideApiError: TideApi.TideApiError,
        parseTimelineResponse: TideApi.parseTimelineResponse,
        parseExtremesResponse: TideApi.parseExtremesResponse,
        buildTimelineUrl: () => `${baseUrl}/timeline`,
        buildExtremesUrl: () => `${baseUrl}/extremes`,
    };
    const fetcher = new PredictionFetcher(tideApi, CHART_HOURS_BEFORE_NOW);

    const loop = new GLib.MainLoop(null, false);
    let outcome = null;
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REPLY_TIMEOUT_SECONDS, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    fetcher.fetchPredictions(WHITBY, (error, predictions) => {
        outcome = { error, predictions };
        GLib.source_remove(timeoutId);
        loop.quit();
    });
    loop.run();

    fetcher.destroy();
    server.disconnect();
    return outcome;
}

function assertFailsWith(status, expectedKind) {
    const outcome = fetchFromServerReplying({ timeline: { status, body: "" } });
    assertEqual(outcome?.error?.kind, expectedKind, "error kind");
}

test("a 429 reports rate limiting", () => {
    assertFailsWith(HTTP_TOO_MANY_REQUESTS, TideApi.ErrorKind.RATE_LIMITED);
});

test("a 500 reports the service as unavailable", () => {
    assertFailsWith(HTTP_INTERNAL_SERVER_ERROR, TideApi.ErrorKind.SERVICE_UNAVAILABLE);
});

test("a status libsoup has no name for reports the service as unavailable", () => {
    assertFailsWith(HTTP_NON_STANDARD_FAILURE, TideApi.ErrorKind.SERVICE_UNAVAILABLE);
});

test("a 429 for the extremes alone still delivers the curve", () => {
    const outcome = fetchFromServerReplying({
        timeline: { status: HTTP_OK, body: TIMELINE_BODY },
        extremes: { status: HTTP_TOO_MANY_REQUESTS, body: "" },
    });
    assertEqual(outcome?.error, null, "error");
    assertEqual(outcome?.predictions?.samples.length, 1, "samples");
    assertEqual(outcome?.predictions?.extremes, [], "extremes");
});

test("a full success delivers the curve and the extremes", () => {
    const outcome = fetchFromServerReplying({ timeline: { status: HTTP_OK, body: TIMELINE_BODY } });
    assertEqual(outcome?.error, null, "error");
    assertEqual(outcome?.predictions?.extremes.length, 1, "extremes");
});

finish();
