const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// An hour beyond the chart's left edge, so that edge stays filled until the next refresh.
const EXTRA_HOURS_BEFORE_CHART = 1;

// Tide predictions stay valid when offline, so a day's worth keeps the chart
// useful through a long network outage.
const HOURS_AFTER_NOW_TO_FETCH = 24;

const REQUEST_TIMEOUT_SECONDS = 30;

const USER_AGENT = "tide-times-cinnamon-desklet";

var PredictionFetcher = class PredictionFetcher {
    // tideApi is passed in because Cinnamon and plain gjs import helper modules differently.
    constructor(tideApi, chartHoursBeforeNow) {
        this._tideApi = tideApi;
        this._hoursBeforeNowToFetch = chartHoursBeforeNow + EXTRA_HOURS_BEFORE_CHART;
        this._session = new Soup.Session({ timeout: REQUEST_TIMEOUT_SECONDS, user_agent: USER_AGENT });
        this._knownExtremes = { location: null, extremes: [] };
    }

    // onDone is not called once cancelled.
    fetchPredictions(location, onDone) {
        const cancellable = new Gio.Cancellable();
        const nowMs = Date.now();
        const timeRange = {
            startMs: nowMs - this._hoursBeforeNowToFetch * MILLISECONDS_PER_HOUR,
            endMs: nowMs + HOURS_AFTER_NOW_TO_FETCH * MILLISECONDS_PER_HOUR,
        };

        this._get(this._tideApi.buildTimelineUrl(location, timeRange), cancellable, (status, body, networkError) => {
            let predictions;
            try {
                this._throwIfFailed(networkError);
                predictions = this._tideApi.parseTimelineResponse(status, body);
            } catch (error) {
                onDone(error, null);
                return;
            }

            const extremesUrl = this._tideApi.buildExtremesUrl(location, timeRange);
            this._get(extremesUrl, cancellable, (extremesStatus, extremesBody, extremesNetworkError) => {
                predictions.extremes = this._parseExtremesOrUseKnown(location, extremesStatus, extremesBody, extremesNetworkError);
                onDone(null, predictions);
            });
        });
        return () => cancellable.cancel();
    }

    destroy() {
        this._session.abort();
    }

    _get(url, cancellable, onResponse) {
        const message = Soup.Message.new("GET", url);
        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
            let bytes;
            try {
                bytes = session.send_and_read_finish(result);
            } catch (error) {
                if (!cancellable.is_cancelled()) {
                    onResponse(null, null, error);
                }
                return;
            }
            const data = bytes.get_data();
            onResponse(message.get_status(), data ? ByteArray.toString(data) : "", null);
        });
    }

    _throwIfFailed(networkError) {
        if (networkError) {
            throw new this._tideApi.TideApiError(this._tideApi.ErrorKind.NETWORK, networkError.message);
        }
    }

    // The curve is still correct without highs and lows, so a failure here should not
    // discard it. Earlier extremes for this location are still valid predictions, so keep them.
    _parseExtremesOrUseKnown(location, status, body, networkError) {
        try {
            this._throwIfFailed(networkError);
            const extremes = this._tideApi.parseExtremesResponse(status, body);
            this._knownExtremes = { location, extremes };
            return extremes;
        } catch (error) {
            return this._knownExtremes.location === location ? this._knownExtremes.extremes : [];
        }
    }
};
