const API_BASE_URL = "https://api.openwaters.io/tides";

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

var ErrorKind = {
    INVALID_LOCATION: "invalid-location",
    NO_STATION: "no-station",
    RATE_LIMITED: "rate-limited",
    SERVICE_UNAVAILABLE: "service-unavailable",
    MALFORMED_RESPONSE: "malformed-response",
    NETWORK: "network",
};

var TideApiError = class TideApiError extends Error {
    constructor(kind, message) {
        super(message);
        this.kind = kind;
    }

    get isRateLimited() {
        return this.kind === ErrorKind.RATE_LIMITED;
    }
};

function isUsableLocation({ latitude, longitude }) {
    const isSet = latitude !== 0 || longitude !== 0;
    return isSet && Math.abs(latitude) <= MAX_LATITUDE && Math.abs(longitude) <= MAX_LONGITUDE;
}

function buildTimelineUrl(location, timeRange) {
    return _buildUrl("timeline", location, timeRange);
}

function buildExtremesUrl(location, timeRange) {
    return _buildUrl("extremes", location, timeRange);
}

function parseTimelineResponse(status, bodyText) {
    const body = _parseSuccessfulBody(status, bodyText, "timeline");
    if (body.timeline.length === 0) {
        throw new TideApiError(ErrorKind.NO_STATION, "The response has no predictions");
    }
    return {
        stationName: typeof body.station?.name === "string" ? body.station.name : null,
        distanceKm: Number.isFinite(body.distance) ? body.distance : null,
        samples: body.timeline.map((entry) => ({
            timeMs: _parseTime(entry?.time),
            level: _parseLevel(entry?.level),
        })),
    };
}

function parseExtremesResponse(status, bodyText) {
    const body = _parseSuccessfulBody(status, bodyText, "extremes");
    return body.extremes.map((entry) => ({
        timeMs: _parseTime(entry?.time),
        isHigh: entry.high === true,
    }));
}

function _buildUrl(endpoint, { latitude, longitude }, { startMs, endMs }) {
    const query = [
        `latitude=${latitude}`,
        `longitude=${longitude}`,
        `start=${encodeURIComponent(new Date(startMs).toISOString())}`,
        `end=${encodeURIComponent(new Date(endMs).toISOString())}`,
        "units=meters",
    ].join("&");
    return `${API_BASE_URL}/${endpoint}?${query}`;
}

function _parseSuccessfulBody(status, bodyText, listName) {
    _throwForFailureStatus(status);
    let body;
    try {
        body = JSON.parse(bodyText);
    } catch (error) {
        throw new TideApiError(ErrorKind.MALFORMED_RESPONSE, "The response is not JSON");
    }
    if (!Array.isArray(body?.[listName])) {
        throw new TideApiError(ErrorKind.MALFORMED_RESPONSE, `The response has no ${listName} list`);
    }
    return body;
}

function _throwForFailureStatus(status) {
    if (status === HTTP_OK) {
        return;
    }
    const kindForStatus = {
        [HTTP_BAD_REQUEST]: ErrorKind.INVALID_LOCATION,
        [HTTP_NOT_FOUND]: ErrorKind.NO_STATION,
        [HTTP_TOO_MANY_REQUESTS]: ErrorKind.RATE_LIMITED,
    };
    const kind = kindForStatus[status] ?? ErrorKind.SERVICE_UNAVAILABLE;
    throw new TideApiError(kind, `The service replied with HTTP ${status}`);
}

function _parseTime(timeText) {
    const timeMs = Date.parse(timeText);
    if (Number.isNaN(timeMs)) {
        throw new TideApiError(ErrorKind.MALFORMED_RESPONSE, `Unreadable time: ${timeText}`);
    }
    return timeMs;
}

function _parseLevel(level) {
    if (!Number.isFinite(level)) {
        throw new TideApiError(ErrorKind.MALFORMED_RESPONSE, `Unreadable level: ${level}`);
    }
    return level;
}
