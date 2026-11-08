const MILLISECONDS_PER_MINUTE = 60 * 1000;

// Also the wait after rate limiting, because retrying sooner would only prolong it.
const REFRESH_INTERVAL_MS = 30 * MILLISECONDS_PER_MINUTE;

// Shorter than the refresh interval so the chart recovers soon after the network comes up at login.
const RETRY_AFTER_FAILURE_MS = 5 * MILLISECONDS_PER_MINUTE;

// Each click on a settings spin button saves a new value. This waits until the
// user has paused, so that adjusting a coordinate costs only one fetch.
const LOCATION_SETTLE_MS = 2000;

var RefreshSchedule = class RefreshSchedule {
    constructor({ fetchPredictions, runAfter, onStateChanged }) {
        this._fetchPredictions = fetchPredictions;
        this._runAfter = runAfter;
        this._onStateChanged = onStateChanged;
        this._location = null;
        this._predictions = null;
        this._cancelFetch = null;
        this._cancelTimer = null;
    }

    start(location) {
        this._location = location;
        this._predictions = null;
        this._fetch();
    }

    setLocation(location) {
        this._location = location;
        this._cancelPendingWork();
        this._predictions = null;
        this._publish(null);
        this._cancelTimer = this._runAfter(LOCATION_SETTLE_MS, () => this._fetch());
    }

    stop() {
        this._cancelPendingWork();
    }

    _fetch() {
        this._cancelTimer = null;
        let isCurrent = true;
        const cancelRequest = this._fetchPredictions(this._location, (error, predictions) => {
            if (!isCurrent) {
                return;
            }
            this._cancelFetch = null;
            this._onFetchFinished(error, predictions);
        });
        this._cancelFetch = () => {
            isCurrent = false;
            cancelRequest();
        };
    }

    _onFetchFinished(error, predictions) {
        if (!error) {
            this._predictions = predictions;
        }
        // The timer goes first so that a failure while displaying the result cannot end the refreshes.
        const delayMs = this._delayAfter(error);
        // This goes against the advice in .github/copilot-instructions.md not to re-create timers,
        // because the delay varies: 5 minutes after most failures, 30 otherwise. A repeating timer
        // has a fixed interval.
        this._cancelTimer = this._runAfter(delayMs, () => this._fetch());
        this._publish(error);
    }

    _delayAfter(error) {
        if (error && !error.isRateLimited) {
            return RETRY_AFTER_FAILURE_MS;
        }
        return REFRESH_INTERVAL_MS;
    }

    _publish(error) {
        this._onStateChanged({ predictions: this._predictions, error });
    }

    _cancelPendingWork() {
        if (this._cancelFetch) {
            this._cancelFetch();
            this._cancelFetch = null;
        }
        if (this._cancelTimer) {
            this._cancelTimer();
            this._cancelTimer = null;
        }
    }
};
