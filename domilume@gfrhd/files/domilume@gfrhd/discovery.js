// Find the FRITZ!Box in the local network: first the name "fritz.box", then an
// SSDP/UPnP search. No Cinnamon imports, testable with plain gjs.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_TARGET = "urn:dslforum-org:device:InternetGatewayDevice:1";
const SSDP_TIMEOUT_MS = 2500;

function resolveName(name, cancellable) {
    return new Promise(resolve => {
        Gio.Resolver.get_default().lookup_by_name_async(name, cancellable, (resolver, result) => {
            try {
                let addresses = resolver.lookup_by_name_finish(result);
                let v4 = addresses.find(a => a.get_family() === Gio.SocketFamily.IPV4);
                resolve((v4 || addresses[0]).to_string());
            } catch (e) {
                resolve(null);
            }
        });
    });
}

// True if http://<host>/login_sid.lua answers like a FRITZ!Box.
function looksLikeFritzBox(host, cancellable) {
    return new Promise(resolve => {
        let url = host.includes(":") && !host.startsWith("[") ? `http://[${host}]` : `http://${host}`;
        let message = Soup.Message.new("GET", `${url}/login_sid.lua?version=2`);
        if (!message)
            return resolve(false);
        let session = new Soup.Session({ timeout: 4 });
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, result) => {
            try {
                let bytes = s.send_and_read_finish(result);
                let text = new TextDecoder().decode(bytes.get_data() || new Uint8Array());
                resolve(message.get_status() === 200 && text.includes("<SessionInfo>"));
            } catch (e) {
                resolve(false);
            }
        });
    });
}

// Host from the first SSDP answer whose SERVER header names a FRITZ!Box.
function parseSsdpReply(text) {
    if (!/^SERVER:.*FRITZ!Box/im.test(text))
        return null;
    let m = text.match(/^LOCATION:\s*https?:\/\/(\[[^\]]+\]|[^:/\s]+)/im);
    return m ? m[1].replace(/^\[|\]$/g, "") : null;
}

function ssdpSearch() {
    return new Promise(resolve => {
        let socket;
        try {
            socket = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
            socket.bind(Gio.InetSocketAddress.new_from_string("0.0.0.0", 0), true);
            socket.set_blocking(false);
            let request = [
                "M-SEARCH * HTTP/1.1",
                `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
                'MAN: "ssdp:discover"',
                "MX: 2",
                `ST: ${SSDP_TARGET}`,
                "", "",
            ].join("\r\n");
            socket.send_to(Gio.InetSocketAddress.new_from_string(SSDP_ADDRESS, SSDP_PORT),
                new TextEncoder().encode(request), null);
        } catch (e) {
            if (socket)
                socket.close();
            return resolve(null);
        }

        let started = Date.now();
        let decoder = new TextDecoder();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            try {
                while (socket.condition_check(GLib.IOCondition.IN) & GLib.IOCondition.IN) {
                    let [bytes] = socket.receive_bytes_from(4096, 0, null);
                    let host = parseSsdpReply(decoder.decode(bytes.get_data()));
                    if (host) {
                        socket.close();
                        resolve(host);
                        return GLib.SOURCE_REMOVE;
                    }
                }
            } catch (e) {
                // ignore single broken datagrams
            }
            if (Date.now() - started < SSDP_TIMEOUT_MS)
                return GLib.SOURCE_CONTINUE;
            socket.close();
            resolve(null);
            return GLib.SOURCE_REMOVE;
        });
    });
}

// Resolves to { host, method } or null.
var discoverFritzBox = async function (cancellable) {
    let ip = await resolveName("fritz.box", cancellable);
    if (ip && await looksLikeFritzBox(ip, cancellable))
        return { host: ip, method: "fritz.box" };
    let found = await ssdpSearch();
    if (found && await looksLikeFritzBox(found, cancellable))
        return { host: found, method: "UPnP" };
    return null;
};
