// FRITZ!Box login (FRITZ!OS 7.24+), no Cinnamon imports so it can be tested with plain gjs.
//
// /login_sid.lua?version=2 returns a challenge of the form
//   2$<iter1>$<salt1>$<iter2>$<salt2>
// and expects  <salt2>$hex(PBKDF2(PBKDF2(password, salt1, iter1), salt2, iter2)).
//
// Neither GLib nor GJS ship PBKDF2 (GJS has no WebCrypto), so it is built on GLib.Hmac.
// The iterations run in chunks on the idle loop so the desktop does not freeze.

const GLib = imports.gi.GLib;

const CHUNK = 2000;
const BLOCK_INDEX_1 = new Uint8Array([0, 0, 0, 1]);

// Hex digit (lowercase, as returned by GLib) -> value. Much faster than parseInt/substr,
// which matters because the hot loop decodes 66,000 digests per login.
const NIBBLE = new Uint8Array(128);
for (let i = 0; i < 10; i++)
    NIBBLE[48 + i] = i;          // '0'..'9'
for (let i = 0; i < 6; i++) {
    NIBBLE[65 + i] = 10 + i;     // 'A'..'F'
    NIBBLE[97 + i] = 10 + i;     // 'a'..'f'
}

function hexInto(hex, out) {
    for (let i = 0; i < out.length; i++)
        out[i] = (NIBBLE[hex.charCodeAt(2 * i)] << 4) | NIBBLE[hex.charCodeAt(2 * i + 1)];
    return out;
}

function hexToBytes(hex) {
    return hexInto(hex, new Uint8Array(hex.length >> 1));
}

function bytesToHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// HMAC-SHA256 of data with an already keyed GLib.Hmac, written into out.
// (GLib.Hmac.get_digest() crashes gjs, so the hex string is decoded instead.)
function hmacInto(keyed, out, ...data) {
    let h = keyed.copy();
    for (let d of data)
        h.update(d);
    return hexInto(h.get_string(), out);
}

// PBKDF2-HMAC-SHA256 with 32 byte output (one block), resolved asynchronously.
function pbkdf2Sha256(password, salt, iterations) {
    return new Promise((resolve, reject) => {
        let keyed = GLib.Hmac.new(GLib.ChecksumType.SHA256, password);
        let u = hmacInto(keyed, new Uint8Array(32), salt, BLOCK_INDEX_1);
        let t = u.slice();
        let n = 1;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                for (let end = Math.min(iterations, n + CHUNK); n < end; n++) {
                    hmacInto(keyed, u, u);
                    for (let i = 0; i < t.length; i++)
                        t[i] ^= u[i];
                }
                if (n < iterations)
                    return GLib.SOURCE_CONTINUE;
                resolve(t);
            } catch (e) {
                reject(e);
            }
            return GLib.SOURCE_REMOVE;
        });
    });
}

// "var" instead of "async function": Cinnamon's module loader only exports
// top-level names declared with function/var/const/let/class.
var loginResponse = async function (challenge, password) {
    let parts = String(challenge).split("$");
    if (parts.length !== 5 || parts[0] !== "2")
        throw new Error("FRITZ!OS zu alt: PBKDF2-Login (ab 7.24) wird nicht angeboten");

    let [, iter1, salt1, iter2, salt2] = parts;
    let hash1 = await pbkdf2Sha256(new TextEncoder().encode(password), hexToBytes(salt1), parseInt(iter1, 10));
    let hash2 = await pbkdf2Sha256(hash1, hexToBytes(salt2), parseInt(iter2, 10));
    return `${salt2}$${bytesToHex(hash2)}`;
};
