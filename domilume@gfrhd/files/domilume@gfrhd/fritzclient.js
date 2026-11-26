// Connection to the FRITZ!Box shared by all desklet instances: shared settings (address,
// credentials, refresh interval), HTTP, login, session id, one polling timer per box and
// AHA commands. Cinnamon loads each module once, so the module-level state
// below is common to every instance of the desklet.

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;

// Own modules, see desklet.js.
const Me = imports.ui.extension.getCurrentExtension
    ? imports.ui.extension.getCurrentExtension().imports : null;
const FritzAuth = Me ? Me.fritzauth : require('./fritzauth');
const FritzXml = Me ? Me.fritzxml : require('./fritzxml');
const Credentials = Me ? Me.credentials : require('./credentials');
const I18n = Me ? Me.i18n : require('./i18n');
const _ = I18n._;

const EMPTY_SID = "0000000000000000";
const FOLLOW_UP_S = [2, 5, 10];   // extra fetches after a command, then the normal timer
// How long an expected change is shown before the box must have confirmed it. Thermostat
// set points are reported late by the box, so they get more time.
const EXPECT_SWITCH_S = 15;
const EXPECT_MODE_S = 60;
const EXPECT_TARGET_S = 120;
const STATS_MAX_AGE_S = 60;   // statistics change slowly (devices report about every 2 min)
const DEFAULT_INTERVAL = 30;
const MIN_INTERVAL = 10;

// Error with a state code for the settings window ("connection-state").
class FritzError extends Error {
    constructor(state, message) {
        super(message);
        this.state = state;
    }
}

function encodeForm(params) {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
}

// Error code for the settings window ("connection-state") and notifications.
function stateForError(e) {
    if (e instanceof FritzError)
        return e.state;
    if (e instanceof GLib.Error)   // name resolution, connection refused, timeout …
        return "unreachable";
    return "error";
}

function wait(seconds) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, seconds * 1000, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function findDevice(devices, ain) {
    return devices.find(d => d.ain === ain) || null;
}

// Copy of a device with some fields replaced (hkr fields merged).
function patched(d, patch) {
    let copy = Object.assign({}, d, patch);
    if (patch.hkr && d.hkr)
        copy.hkr = Object.assign({}, d.hkr, patch.hkr);
    return copy;
}

function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// ---- Notifications ---------------------------------------------------------

let notifier = null;           // (title, text) => void, set by the desklet

function setNotifier(fn) {
    notifier = fn;
}

function notify(title, text) {
    if (notifier)
        notifier(title, text);
}

// ---- Shared settings (one keyring item for all instances) ------------------

let shared = { host: "", username: "", password: "", interval: 0, priceImport: 0, priceExport: 0 };
let sharedLoad = null;         // promise of the first keyring lookup
const sharedListeners = new Set();
const clients = new Map();     // host -> FritzClient

function loadShared(uuid) {
    if (!sharedLoad)
        sharedLoad = Credentials.lookupCredentials(uuid).then(
            data => { shared = data; },
            e => { sharedLoad = null; throw e; });   // allow a retry later
    return sharedLoad;
}

function getCredentials() {
    return shared.password ? { username: shared.username, password: shared.password } : null;
}

function getUsername() {
    return shared.username;
}

function getSharedHost() {
    return shared.host;
}

// 0 = not stored yet
function getSharedInterval() {
    return shared.interval;
}

// Electricity prices in ct/kWh (0 = not set): { import, export }
function getSharedPrices() {
    return { import: shared.priceImport || 0, export: shared.priceExport || 0 };
}

function _effectiveInterval() {
    return Math.max(MIN_INTERVAL, shared.interval || DEFAULT_INTERVAL);
}

function _store(uuid) {
    if (!shared.host && !shared.username && !shared.password)
        return Credentials.clearCredentials(uuid);
    return Credentials.storeCredentials(uuid, shared);
}

// Store credentials in the keyring and let every client log in again and refresh.
var saveCredentials = async function (uuid, username, password) {
    shared = Object.assign({}, shared, { username, password });
    await _store(uuid);
    for (let client of clients.values()) {
        client.resetSession();
        client.refreshNow();
    }
};

// key: "host", "interval", "priceImport" or "priceExport". Stores the value for all instances and tells the others.
var setShared = async function (uuid, key, value) {
    if (shared[key] === value)
        return;
    shared = Object.assign({}, shared, { [key]: value });
    for (let listener of sharedListeners)
        listener(key, value);
    if (key === "interval")
        for (let client of clients.values())
            client.restartTimer();
    await _store(uuid);
};

// listener(key, value); returns a function that removes the listener again.
function onSharedChanged(listener) {
    sharedListeners.add(listener);
    return () => sharedListeners.delete(listener);
}

// ---- Client ----------------------------------------------------------------

class FritzClient {
    constructor(host) {
        this.host = host;
        this._session = new Soup.Session({ timeout: 10 });
        this._decoder = new TextDecoder();
        this._sid = null;
        this._loginPromise = null;
        this._health = null;          // null (unknown), "ok" or the state of the last failure
        this._subscribers = new Set();
        this._timerId = 0;
        this._fetching = false;
        this._fetchAgain = false;
        this._lastDevices = null;      // last list as reported by the box
        this._expectations = new Map(); // ain -> { patch, check, deadline, failTitle, failText }
        this._stats = new Map();        // ain -> { time, promise, stats }
    }

    // Statistics of one device, fetched at most once per STATS_MAX_AGE_S for all instances.
    // Resolves to the parsed stats (see FritzXml.parseDeviceStats) or null on failure.
    getStats(ain) {
        let entry = this._stats.get(ain);
        let now = Date.now();
        if (entry && now - entry.time < STATS_MAX_AGE_S * 1000)
            return entry.promise;
        let promise = this._command({ switchcmd: "getbasicdevicestats", ain: ain }, null)
            .then(xml => FritzXml.parseDeviceStats(xml))
            .catch(e => {
                global.logError(`[Domilume] Statistics ${ain}: ${e.message}`);
                this._stats.delete(ain);   // retry with the next refresh
                return null;
            });
        this._stats.set(ain, { time: now, promise });
        return promise;
    }

    // ---- polling: one timer and one request for all subscribed instances ----

    restartTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        if (!this._subscribers.size)
            return;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, _effectiveInterval(), () => {
            this.refreshNow();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Fetch the device list now and deliver it to every subscriber. Requests while a fetch
    // is running are folded into one more fetch afterwards.
    async refreshNow() {
        if (this._fetching) {
            this._fetchAgain = true;
            return;
        }
        this._fetching = true;
        this._fetchAgain = false;
        let result;
        try {
            result = { devices: await this.getDeviceList(null) };
        } catch (e) {
            result = { error: e };
        }
        this._fetching = false;
        this._distribute(result);
        if (this._fetchAgain && this._subscribers.size)
            this.refreshNow();
    }

    _distribute(result) {
        if (result.devices) {
            this._lastDevices = result.devices;
            result = { devices: this._applyExpectations(result.devices) };
        }
        for (let subscriber of [...this._subscribers]) {
            try {
                subscriber(result);
            } catch (e) {
                global.logError(`[Domilume] Error processing the data: ${e}\n${e.stack}`);
            }
        }
    }

    // ---- actions ----

    // Expected changes are laid over the box's data until the box confirms them (check)
    // or their deadline passes (then notify). So the display does not jump back while a
    // command is under way, and all instances show the same.
    _applyExpectations(devices) {
        if (!this._expectations.size)
            return devices;
        let now = Date.now();
        return devices.map(d => {
            let ex = this._expectations.get(d.ain);
            if (!ex)
                return d;
            if (ex.check(d)) {
                this._expectations.delete(d.ain);
                return d;
            }
            if (now > ex.deadline) {
                this._expectations.delete(d.ain);
                if (ex.failTitle)
                    notify(ex.failTitle, ex.failText);
                return d;
            }
            return patched(d, ex.patch);
        });
    }

    // AINs a thermostat command affects: for a group the group and its members, for a
    // member of a group the whole group as well (the box keeps grouped thermostats in sync).
    // The operated AIN comes first.
    _withMembers(ain) {
        let devices = this._lastDevices || [];
        let device = findDevice(devices, ain);
        if (!device)
            return [ain];
        let group = device.memberIds && device.memberIds.length ? device
            : devices.find(g => g.memberIds && g.memberIds.includes(device.id));
        if (!group)
            return [ain];
        let all = [group.ain, ...devices.filter(d => group.memberIds.includes(d.id)).map(d => d.ain)];
        return [ain, ...all.filter(a => a !== ain)];
    }

    expect(ain, patch, check, seconds, failTitle, failText) {
        let deadline = Date.now() + seconds * 1000;
        for (let a of this._withMembers(ain)) {
            // Only the device that was operated notifies; members of a group stay quiet.
            let own = a === ain;
            this._expectations.set(a, { patch, check, deadline,
                failTitle: own ? failTitle : null, failText: own ? failText : null });
        }
        if (this._lastDevices)
            this._distribute({ devices: this._lastDevices });
    }

    dropExpectation(ain) {
        for (let a of this._withMembers(ain))
            this._expectations.delete(a);
    }

    // A few extra fetches after a command; the normal timer pauses meanwhile.
    async _followUp(ain) {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        let elapsed = 0;
        for (let at of FOLLOW_UP_S) {
            await wait(at - elapsed);
            elapsed = at;
            if (!this._subscribers.size)
                return;
            let result;
            try {
                result = { devices: await this.getDeviceList(null) };
            } catch (e) {
                result = { error: e };
            }
            this._distribute(result);
            if (!this._withMembers(ain).some(a => this._expectations.has(a)))
                break;   // all confirmed (or given up)
        }
        this.restartTimer();
    }

    async toggleSwitch(ain, name) {
        let reply = await this.command({ switchcmd: "setswitchtoggle", ain: ain }, null);
        let on = reply.trim() === "1";
        this.expect(ain, { on: on }, d => d.on === on, EXPECT_SWITCH_S,
            _("Switch command not confirmed"), I18n.formatText(_("%s: the FRITZ!Box does not report the new state."), name));
        this._followUp(ain);
        return on;
    }

    // Shown at once while −/+ clicks are still collected (before setTarget is sent).
    expectTarget(ain, celsius, name, extraSeconds) {
        this.expect(ain, { hkr: { target: celsius, targetState: null } },
            d => d.hkr && d.hkr.target === celsius, EXPECT_TARGET_S + (extraSeconds || 0),
            _("Set point not confirmed"),
            I18n.formatText(_("%s: the FRITZ!Box does not report %s °C."), name, I18n.num(celsius, 1)));
    }

    // celsius: 8 … 28 in 0.5 steps
    async setTarget(ain, celsius, name) {
        await this.command({ switchcmd: "sethkrtsoll", ain: ain, param: Math.round(celsius * 2) }, null);
        this.expectTarget(ain, celsius, name);
        this._followUp(ain);
    }

    // mode: "boost" or "frost"; endUnix 0 ends the mode
    async setMode(ain, mode, endUnix, name) {
        let boost = mode === "boost";
        await this.command({ switchcmd: boost ? "sethkrboost" : "sethkrwindowopen", ain: ain, endtimestamp: endUnix }, null);
        let active = endUnix > 0;
        this.expect(ain,
            { hkr: boost ? { boostActive: active, boostEnd: endUnix } : { windowOpenActive: active, windowOpenEnd: endUnix } },
            d => d.hkr && (boost ? d.hkr.boostActive : d.hkr.windowOpenActive) === active,
            EXPECT_MODE_S, boost ? _("Boost not confirmed") : _("Frost protection not confirmed"),
            I18n.formatText(boost
                ? (active ? _("%s: the FRITZ!Box does not report boost as active.") : _("%s: the FRITZ!Box still reports boost as active."))
                : (active ? _("%s: the FRITZ!Box does not report frost protection as active.") : _("%s: the FRITZ!Box still reports frost protection as active.")),
            name));
        this._followUp(ain);
    }

    // ---- notifications once per change of the connection health ----

    _reportSuccess() {
        if (this._health !== null && this._health !== "ok")
            notify(_("Connection to the FRITZ!Box restored"), this.host);
        this._health = "ok";
    }

    _reportFailure(e) {
        if (isCancelled(e))
            return;
        let state = stateForError(e);
        if (state === "no-credentials" || state === this._health)
            return;   // missing credentials are shown in the settings window
        notify(this._health === "ok" ? _("Connection to the FRITZ!Box lost") : _("No connection to the FRITZ!Box"),
            e.message);
        this._health = state;
    }

    // ---- HTTP and login ----

    _baseUrl() {
        let host = this.host.replace(/\/+$/, "");
        return /^https?:\/\//.test(host) ? host : "http://" + host;
    }

    _send(message, cancellable) {
        if (!message)
            return Promise.reject(new FritzError("unreachable", _("Invalid address")));
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
                try {
                    let bytes = session.send_and_read_finish(result);
                    let data = bytes ? bytes.get_data() : null;
                    resolve({ status: message.get_status(), text: data ? this._decoder.decode(data) : "" });
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _get(path, params, cancellable) {
        return this._send(Soup.Message.new("GET", `${this._baseUrl()}${path}?${encodeForm(params)}`), cancellable);
    }

    _post(path, params, cancellable) {
        return this._send(Soup.Message.new_from_encoded_form("POST", this._baseUrl() + path, encodeForm(params)), cancellable);
    }

    resetSession() {
        this._sid = null;
    }

    // Several callers may ask at once; they all wait for the same login.
    _ensureLogin() {
        if (this._sid)
            return Promise.resolve();
        if (!this._loginPromise)
            this._loginPromise = this._login().finally(() => { this._loginPromise = null; });
        return this._loginPromise;
    }

    async _login() {
        let creds = getCredentials();
        if (!creds)
            throw new FritzError("no-credentials", _("No credentials"));

        let reply = await this._get("/login_sid.lua", { version: 2 }, null);
        if (reply.status !== 200)
            throw new FritzError("unreachable", I18n.formatText(_("Login page: HTTP %s"), reply.status));
        let info = FritzXml.parseSessionInfo(reply.text);
        if (info.blockTime > 0)
            throw new FritzError("blocked", I18n.formatText(_("Login blocked for another %s s"), info.blockTime));
        if (!info.challenge)
            throw new FritzError("unreachable", _("No login challenge received – is this a FRITZ!Box?"));

        let response = await FritzAuth.loginResponse(info.challenge, creds.password);
        reply = await this._post("/login_sid.lua", { version: 2, username: creds.username, response: response }, null);
        info = FritzXml.parseSessionInfo(reply.text);
        if (!info.sid || info.sid === EMPTY_SID) {
            if (info.blockTime > 0)
                throw new FritzError("blocked", I18n.formatText(_("Login wrong, blocked for %s s"), info.blockTime));
            throw new FritzError("login-failed", _("Login failed (user name/password?)"));
        }
        let now = getCredentials();
        if (!now || now.username !== creds.username || now.password !== creds.password)
            return this._login();   // credentials changed meanwhile: use the new ones
        global.log(`[Domilume] Login successful (${this.host})`);
        this._sid = info.sid;
    }

    // AHA-HTTP command; logs in when needed and once more if the session has expired.
    async command(params, cancellable) {
        try {
            let text = await this._command(params, cancellable);
            this._reportSuccess();
            return text;
        } catch (e) {
            this._reportFailure(e);
            throw e;
        }
    }

    async _command(params, cancellable) {
        for (let attempt = 0; attempt < 2; attempt++) {
            await this._ensureLogin();
            let reply = await this._get("/webservices/homeautoswitch.lua",
                Object.assign({}, params, { sid: this._sid }), cancellable);
            if (reply.status === 200)
                return reply.text;
            if (reply.status !== 403)
                throw new FritzError("error", `${params.switchcmd}: HTTP ${reply.status}`);
            this._sid = null;
        }
        throw new FritzError("no-right", _("No access to Smart Home (permission missing?)"));
    }

    async getDeviceList(cancellable) {
        return FritzXml.parseDeviceList(await this.command({ switchcmd: "getdevicelistinfos" }, cancellable));
    }

    _logout() {
        if (!this._sid)
            return;
        let message = Soup.Message.new("GET", `${this._baseUrl()}/login_sid.lua?${encodeForm({ logout: 1, sid: this._sid })}`);
        if (message)
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, () => {});
        this._sid = null;
    }
}

// subscriber(result) gets { devices } or { error } after every fetch of this box.
function acquireClient(host, subscriber) {
    let client = clients.get(host);
    if (!client) {
        client = new FritzClient(host);
        clients.set(host, client);
    }
    client._subscribers.add(subscriber);
    if (!client._timerId)
        client.restartTimer();
    return client;
}

// Stops polling and logs out from the box when the last instance lets go.
function releaseClient(client, subscriber) {
    client._subscribers.delete(subscriber);
    if (client._subscribers.size)
        return;
    client.restartTimer();   // stops the timer
    client._logout();
    clients.delete(client.host);
}
