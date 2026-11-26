// FRITZ!Box connection data in the user's keyring (Secret Service, e.g. GNOME Keyring) via
// libsecret. No Cinnamon imports, so it can be tested with plain gjs.
//
// One item for the desklet, shared by all instances: address, user name, password and the
// refresh interval, kept together in the encrypted secret (as JSON), because item attributes
// are stored unencrypted.

const Secret = imports.gi.Secret;

const SCHEMA = new Secret.Schema(
    "org.cinnamon.desklets.Domilume",
    Secret.SchemaFlags.NONE,
    { desklet: Secret.SchemaAttributeType.STRING }
);
const LABEL = "Domilume-Desklet: FRITZ!Box-Verbindung";

function attributes(uuid) {
    return { desklet: uuid };
}

function call(start, finish) {
    return new Promise((resolve, reject) => {
        start((source, result) => {
            try {
                resolve(finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Resolves to { host, username, password, interval, priceImport, priceExport }
// (empty strings / 0 for missing parts; prices in ct/kWh).
function lookupCredentials(uuid) {
    return call(cb => Secret.password_lookup(SCHEMA, attributes(uuid), null, cb),
        Secret.password_lookup_finish).then(secret => {
        let data = null;
        try {
            data = JSON.parse(secret);
        } catch (e) {
            // nothing stored or not our format
        }
        data = data && typeof data === "object" ? data : {};
        return {
            host: String(data.host || ""),
            username: String(data.username || ""),
            password: String(data.password || ""),
            interval: Number(data.interval) || 0,
            priceImport: Number(data.priceImport) || 0,
            priceExport: Number(data.priceExport) || 0,
        };
    });
}

// data: { host, username, password, interval, priceImport, priceExport }
function storeCredentials(uuid, data) {
    let secret = JSON.stringify({
        host: data.host, username: data.username, password: data.password, interval: data.interval,
        priceImport: data.priceImport, priceExport: data.priceExport,
    });
    return call(cb => Secret.password_store(SCHEMA, attributes(uuid), Secret.COLLECTION_DEFAULT,
        LABEL, secret, null, cb), Secret.password_store_finish);
}

function clearCredentials(uuid) {
    return call(cb => Secret.password_clear(SCHEMA, attributes(uuid), null, cb),
        Secret.password_clear_finish);
}
