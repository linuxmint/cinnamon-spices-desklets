/**
 * Provider registry — merge multiple backends without touching desklet UI.
 */

class ProviderRegistry {
    constructor() {
        this._providers = [];
        this._destroyed = false;
    }

    /**
     * @param {object} provider BaseProvider-compatible instance
     */
    register(provider) {
        if (!provider || this._destroyed) {
            return;
        }
        this._providers.push(provider);
    }

    startAll() {
        this._providers.forEach((p) => {
            try {
                if (typeof p.start === "function") {
                    p.start();
                }
            } catch (e) {}
        });
    }

    refreshAll() {
        this._providers.forEach((p) => {
            try {
                if (typeof p.refresh === "function") {
                    p.refresh();
                }
            } catch (e) {}
        });
    }

    /**
     * Fetch from every provider and merge results.
     * @param {Function} callback function(Device[])
     */
    fetchAll(callback) {
        if (this._destroyed) {
            if (callback) callback([]);
            return;
        }

        const providers = this._providers.slice();
        if (!providers.length) {
            if (callback) callback([]);
            return;
        }

        let pending = providers.length;
        const buckets = new Array(providers.length);

        const doneOne = () => {
            pending -= 1;
            if (pending > 0) {
                return;
            }
            const merged = [];
            buckets.forEach((list) => {
                (list || []).forEach((d) => merged.push(d));
            });
            if (callback) {
                callback(merged);
            }
        };

        providers.forEach((provider, index) => {
            let settled = false;
            const finish = (devices) => {
                if (settled) {
                    return;
                }
                settled = true;
                buckets[index] = devices || [];
                doneOne();
            };

            try {
                if (typeof provider.fetch === "function") {
                    provider.fetch(finish);
                } else if (typeof provider.getDevices === "function") {
                    finish(provider.getDevices());
                } else {
                    finish([]);
                }
            } catch (e) {
                finish([]);
            }
        });
    }

    destroy() {
        this._destroyed = true;
        this._providers.forEach((p) => {
            try {
                if (typeof p.destroy === "function") {
                    p.destroy();
                }
            } catch (e) {}
        });
        this._providers = [];
    }
}

module.exports = { ProviderRegistry };
