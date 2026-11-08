/**
 * Base contract for PowerPulse battery providers.
 * Future backends (OpenRazer, Solaar, BATT BT, UPS, …) extend this class
 * and register themselves in providers/registry.js — no core UI changes needed.
 */

class BaseProvider {
    /**
     * @param {object} options
     * @param {Function} [options.onChange]
     * @param {Function} [options.logError]
     */
    constructor(options) {
        this._options = options || {};
        this._onChange = typeof this._options.onChange === "function" ? this._options.onChange : null;
        this._logError = typeof this._options.logError === "function" ? this._options.logError : null;
        this._destroyed = false;
    }

    /** Stable provider id used in device.source */
    get id() {
        return "base";
    }

    /** Human-readable provider label */
    get label() {
        return "Base";
    }

    start() {}

    /**
     * Collect devices. Implementations may be sync or async.
     * @param {Function} callback function(Device[])
     */
    fetch(callback) {
        if (callback) {
            callback([]);
        }
    }

    refresh() {}

    destroy() {
        this._destroyed = true;
        this._onChange = null;
    }

    _emitChange() {
        if (!this._destroyed && this._onChange) {
            this._onChange(this);
        }
    }

    _error(message, err) {
        if (this._logError) {
            this._logError(this.id + ":" + message, err);
        }
    }
}

module.exports = { BaseProvider };
