// AutarkTrade-Desklet (Positionen)
// Shows open positions from the AutarkTrade
// Requires: Cinnamon 5.0+

const Desklet   = imports.ui.desklet;
const St        = imports.gi.St;
const GLib      = imports.gi.GLib;
const Gio       = imports.gi.Gio;
const Mainloop  = imports.mainloop;
const Settings  = imports.ui.settings;
const Gettext   = imports.gettext;
const Cairo     = imports.cairo;
const Tooltips  = imports.ui.tooltips;

// Soup version detection: Cinnamon < 5.8 uses Soup 2, newer ones Soup 3
let Soup;
try {
    imports.gi.versions.Soup = '3.0';
    Soup = imports.gi.Soup;
    var SOUP_VERSION = 3;
} catch(e) {
    Soup = imports.gi.Soup;
    var SOUP_VERSION = 2;
}

const UUID         = "trading-positions@trading-journal";

/** Trennlinie als 1px-Fläche — Strichzeichen hatten eine feste Länge und
 *  endeten je nach Schrift und Breite vor dem Rand oder liefen darüber. */
function linie(cls) {
    return new St.Widget({ style_class: cls, x_expand: true });
}

// --- Translation support -------------------------------------------------
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

// Die Einstellungsdatei enthält den Geräteschlüssel im Klartext. Cinnamon legt sie
// mit der Umask an (meist 0664, gruppenlesbar) — Audit SEC-DSK-001. Darum Ordner
// 0700 und Dateien 0600; GLib behält den Modus beim Zurückschreiben bei.
// Ältere Cinnamon-Versionen speichern unter ~/.cinnamon/configs/<uuid>.
// Ebenso die gekoppelte CA (ca-<id>.pem): nicht geheim, aber nur wir sollen sie tauschen können.
const EINSTELLUNGS_ORDNER = [
    GLib.get_user_config_dir() + '/cinnamon/spices/' + UUID,
    GLib.get_home_dir() + '/.cinnamon/configs/' + UUID,
];

const ATTR_FLAGS = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;

function istNichtGefunden(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

// Asynchron (Spices-Hinweis: kein blockierender Dateizugriff im Hauptloop).
// Ein fehlender Ordner ist normal und wird übergangen.
function schuetzeEinstellungen() {
    for (let pfad of EINSTELLUNGS_ORDNER) {
        let dir = Gio.File.new_for_path(pfad);
        dir.enumerate_children_async('standard::name,standard::type', ATTR_FLAGS,
            GLib.PRIORITY_LOW, null, (d, res) => {
                let liste;
                try {
                    liste = d.enumerate_children_finish(res);
                    d.set_attribute_uint32('unix::mode', 0o700, ATTR_FLAGS, null);
                } catch (e) {
                    if (!istNichtGefunden(e)) global.logWarning('[' + UUID + '] Rechte der Einstellungen: ' + e.message);
                    return;
                }
                liste.next_files_async(200, GLib.PRIORITY_LOW, null, (l, r) => {
                    try {
                        for (let info of l.next_files_finish(r)) {
                            if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                            if (!info.get_name().endsWith('.json') && !info.get_name().endsWith('.pem')) continue;
                            d.get_child(info.get_name()).set_attribute_uint32('unix::mode', 0o600, ATTR_FLAGS, null);
                        }
                    } catch (e) {
                        global.logWarning('[' + UUID + '] Rechte der Einstellungen: ' + e.message);
                    }
                    l.close_async(GLib.PRIORITY_LOW, null, null);
                });
            });
    }
}

// ---- TLS-Kopplung (Anfang) ----
// HTTPS gegen die eigene AutarkTrade-CA, Trust on first use mit Bestätigung: die CA
// kommt ohne Anmeldung über http://host:8080/api/esp32/ca ({pem, sha256}), der
// Fingerabdruck wird hier selbst gerechnet (der mitgeschickte ist nur Gegenprobe) und
// in den Einstellungen angezeigt; erst nach „Stimmt überein" wird die CA als Datei
// (0600) gespeichert. Danach ist sie der EINZIGE Vertrauensanker der Soup-Session
// (tls-database = Gio.TlsFileDatabase nur mit dieser Datei); die Prüfung des
// Hostnamens bzw. der IP im SAN macht GnuTLS wie üblich. Mit HTTPS an gibt es keinen
// Rückfall auf http. (Dieser Block wird vom Test im Scratch-Ordner herausgelöst.)

/** Erstes CERTIFICATE-Stück eines PEM → DER (Uint8Array) oder null. */
function pemZuDer(pem) {
    let m = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/.exec(String(pem || ''));
    if (!m) return null;
    try {
        let der = GLib.base64_decode(m[1].replace(/\s/g, ''));
        return der && der.length ? der : null;
    } catch (e) { return null; }
}

/** SHA-256 über das DER, hex gross mit Doppelpunkten — wie in der Web-App. */
function fingerabdruck(der) {
    let hex = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, der).toUpperCase();
    return hex.match(/../g).join(':');
}

function gleicherFingerabdruck(a, b) {
    let norm = s => String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    return norm(a).length > 0 && norm(a) === norm(b);
}

/** Erste und letzte vier Gruppen: „AB:CD:EF:01 … 9A:BC:DE:F0". */
function kurzFingerabdruck(fp) {
    let g = String(fp || '').split(':');
    return g.length <= 8 ? String(fp || '') : g.slice(0, 4).join(':') + ' … ' + g.slice(-4).join(':');
}

/** Antwort von /api/esp32/ca prüfen → {pem, fp}; wirft mit lesbarer Meldung. */
function pruefeCaAntwort(text) {
    let daten;
    try { daten = JSON.parse(text); } catch (e) { throw new Error(_("Certificate answer unreadable")); }
    let der = pemZuDer(daten && daten.pem);
    if (!der) throw new Error(_("Server sent no CA certificate"));
    try { Gio.TlsCertificate.new_from_pem(daten.pem, -1); }
    catch (e) { throw new Error(_("Certificate answer unreadable")); }
    let fp = fingerabdruck(der);
    if (daten.sha256 && !gleicherFingerabdruck(fp, daten.sha256))
        throw new Error(_("Fingerprint mismatch — connection tampered?"));
    return { pem: String(daten.pem).trim() + '\n', fp };
}

/**
 * Ordner für die CA-Datei: der Ordner der Einstellungsdatei, die Cinnamon für dieses
 * Desklet führt (kein Dateisystem-Test nötig); ohne sie der neue Ort (0700).
 */
function caPfad(deskletId, einstellungsDatei) {
    let ordner = einstellungsDatei && einstellungsDatei.get_parent && einstellungsDatei.get_parent();
    let pfad = (ordner && ordner.get_path()) || EINSTELLUNGS_ORDNER[0];
    return pfad + '/ca-' + deskletId + '.pem';
}

/** CA-Datei asynchron schreiben: Ordner 0700, Datei 0600; fertig(fehler|null). */
function speichereCa(pfad, pem, fertig) {
    let datei = Gio.File.new_for_path(pfad);
    let ordner = datei.get_parent();
    try {
        ordner.make_directory_with_parents(null);
    } catch (e) {
        if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))) return fertig(e);
    }
    datei.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(pem)), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null, (f, res) => {
            try {
                f.replace_contents_finish(res);
                ordner.set_attribute_uint32('unix::mode', 0o700, ATTR_FLAGS, null);
                f.set_attribute_uint32('unix::mode', 0o600, ATTR_FLAGS, null);
                fertig(null);
            } catch (e) {
                fertig(e);
            }
        });
}

/** Gespeicherte CA asynchron lesen → fertig({pem, fp} | null) (fehlt/unlesbar = null). */
function ladeCa(pfad, fertig) {
    Gio.File.new_for_path(pfad).load_contents_async(null, (f, res) => {
        let ergebnis = null;
        try {
            let [ok, inhalt] = f.load_contents_finish(res);
            if (ok) {
                let pem = new TextDecoder().decode(inhalt);
                let der = pemZuDer(pem);
                if (der) ergebnis = { pem, fp: fingerabdruck(der) };
            }
        } catch (e) {
            if (!istNichtGefunden(e)) global.logWarning('[' + UUID + '] CA-Datei: ' + e.message);
        }
        fertig(ergebnis);
    });
}

/** Soup-Session; mit [caDatei] vertraut sie NUR dieser CA. */
function neueSession(caDatei) {
    let props = {};
    if (caDatei) props.tls_database = Gio.TlsFileDatabase.new(caDatei);
    let s;
    if (SOUP_VERSION === 3) {
        s = new Soup.Session(props);
    } else {
        // Soup 2: SessionAsync prüft Zertifikate nur mit ssl-strict und eigener Datenbank.
        if (caDatei) { props.ssl_strict = true; props.ssl_use_system_ca_file = false; }
        s = new Soup.SessionAsync(props);
    }
    s.add_feature(new Soup.CookieJar());
    return s;
}

/**
 * Einordnung eines fehlgeschlagenen Aufrufs: 'zertifikat' (CA/Name passt nicht),
 * 'tls' (sonstiger TLS-Fehler, z. B. kein HTTPS auf dem Port) oder null.
 */
function tlsFehlerArt(status, fehler) {
    if (fehler && fehler.matches) {
        if (fehler.matches(Gio.TlsError, Gio.TlsError.BAD_CERTIFICATE)) return 'zertifikat';
        if (fehler.domain === Gio.tls_error_quark()) return 'tls';
    }
    if (fehler && /certificate|zertifikat/i.test(fehler.message || '')) return 'zertifikat';
    if (fehler && /\btls\b|ssl/i.test(fehler.message || '')) return 'tls';
    if (SOUP_VERSION === 2 && status === 6) return 'zertifikat';   // SOUP_STATUS_SSL_FAILED
    return null;
}

/** GET über [session]; callback(status, body, fehler). */
function soupGet(session, url, callback, headers) {
    let msg = Soup.Message.new('GET', url);
    if (SOUP_VERSION === 3) {
        if (headers) {
            let h = msg.get_request_headers();
            for (let name in headers) h.append(name, headers[name]);
        }
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, result) => {
            try {
                let bytes  = s.send_and_read_finish(result);
                let status = msg.get_status();
                let body   = bytes ? new TextDecoder().decode(bytes.get_data()) : '';
                callback(status, body, null);
            } catch(e) {
                global.logError('[' + UUID + '] soup GET ' + url + ': ' + e.message);
                callback(0, '', e);
            }
        });
    } else {
        if (headers) {
            for (let name in headers) msg.request_headers.append(name, headers[name]);
        }
        session.queue_message(msg, (s, response) => {
            let status = response.status_code;
            let body   = response.response_body ? response.response_body.data : '';
            callback(status, body, null);
        });
    }
}
// ---- TLS-Kopplung (Ende) ----

// ---- Kurs-Chart: Kerzen direkt von Binance-Futures (öffentlich, ohne Schlüssel) ----
// Die Kerzen-Route des Servers verlangt eine Browser-Sitzung; das Desklet hat nur
// den Geräteschlüssel. Je Spanne: Kerzenlänge, Anzahl, Abrufabstand (s).
const CHART_SPANNEN = {
    '1h':  { interval: '1m',  limit: 60,  takt: 30 },
    '24h': { interval: '15m', limit: 96,  takt: 60 },
    '7d':  { interval: '1h',  limit: 168, takt: 60 },
    '30d': { interval: '4h',  limit: 180, takt: 120 },
};
const CHART_URL = 'https://fapi.binance.com/fapi/v1/klines';

/** „btc" → „BTCUSDT"; nur Buchstaben und Ziffern. */
function chartSymbol(roh) {
    let s = String(roh || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
    return /(USDT|USDC)$/.test(s) ? s : s + 'USDT';
}

// ---- Links je Coin: Chart in AutarkTrade (wie `/chart?symbol=…` der Web-App,
// src/utils/boersenLinks.js) und „BX" zur Bitunix-Handelsseite ----
const BITUNIX_HANDEL = 'https://www.bitunix.com/contract-trade/';
const CHART_BOERSEN  = ['bitunix', 'bitget'];   // als Kursquelle im Chart wählbar (kerzenQuelle.js)

/** Positions-Symbol → Handelspaar wie in der App: „BTCUSDT"; Coin-M „SOLUSD" → „SOLUSDT". */
function paarSymbol(roh) {
    let s = String(roh || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return '';
    if (/USD$/.test(s)) s += 'T';
    return /(USDT|USDC)$/.test(s) ? s : s + 'USDT';
}

function chartPreis(n) {
    return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
         : n >= 1    ? n.toFixed(3)
                     : n.toPrecision(4);
}

/** Runde Achsenschritte (1-2-2.5-5 × 10^n) für rund 4 Linien über [min, max]. */
function achsenStufen(min, max) {
    let roh = (max - min) / 4 || Math.abs(max) / 100 || 1;
    let basis = Math.pow(10, Math.floor(Math.log10(roh)));
    // der nächste runde Schritt (Verhältnis), nicht der nächstgrössere — sonst oft nur zwei Linien
    let schritt = [1, 2, 2.5, 5, 10].map(f => f * basis)
        .reduce((best, w) => Math.abs(Math.log(w / roh)) < Math.abs(Math.log(best / roh)) ? w : best);
    let stufen = [];
    for (let v = Math.ceil(min / schritt) * schritt; v <= max + schritt * 1e-9; v += schritt) stufen.push(v);
    return { stufen, schritt };
}

function achsenText(v, schritt) {
    let stellen = Math.max(0, Math.min(8, -Math.floor(Math.log10(schritt) + 1e-9)));
    if (schritt * Math.pow(10, stellen) % 1 > 1e-6) stellen++;   // 2.5er-Schritte
    return v.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

// ---- Alarme: Ansage wie im Android-Widget (Sprache.kt) ----
const ALARM_UEBERLAPPUNG_MS = 3 * 60 * 1000;
const RANG        = { info: 0, warnung: 1, einstieg: 2 };
const MAX_SAETZE  = 3;    // mehr am Stück wäre zu lang
const MAX_ZEILEN  = 4;    // Alarmzeilen im Desklet
const TON_ORDNER  = '/usr/share/sounds/freedesktop/stereo/';

/** „Trade-Einstieg. BTC Zonenalarm bei 65000" — ohne USDT und Tausender-Zeichen, die stören beim Vorlesen. */
function ansageSatz(schwere, titel, englisch) {
    let vorne = englisch
        ? (schwere === 'einstieg' ? 'Trade entry. ' : schwere === 'warnung' ? 'Warning. ' : '')
        : (schwere === 'einstieg' ? 'Trade-Einstieg. ' : schwere === 'warnung' ? 'Warnung. ' : '');
    let rein = String(titel)
        .replace(/\b([A-Z0-9]{2,}?)USDT\b/g, '$1')
        .replace(/(\d)['\u2019](?=\d)/g, '$1')
        .replace(/\u2014/g, ',');
    if (englisch) {
        rein = rein.replace(/\b(Long|Short)-/g, '$1 ');
        for (let [de, en] of AUF_ENGLISCH) rein = rein.replace(new RegExp(`(^|[^\\wäöü])${de}(?![\\wäöü])`, 'g'), `$1${en}`);
    }
    return vorne + rein;
}

// Die Alarmtexte kommen deutsch vom Server; für die englische Stimme die
// festen Wörter übersetzen (Wortlaut aus chart-alarme.js, -momentum.js, -lsob.js,
// esp32-alarme.js). Längere Wendungen zuerst.
const AUF_ENGLISCH = [
    ['steigt über', 'rises above'], ['fällt unter', 'falls below'],
    ['läuft in die Zone', 'enters the zone'], ['verlässt die Zone', 'leaves the zone'],
    ['mit Divergenz', 'with divergence'], ['Preisalarm', 'price alert'], ['Linienalarm', 'line alert'],
    ['Zonenalarm', 'zone alert'], ['Alarm', 'alert'], ['Signale', 'signals'], ['kreuzt', 'crosses'],
    ['grosser', 'large'], ['kleiner', 'small'], ['Punkt', 'dot'], ['neue', 'new'], ['Box', 'box'],
    ['bei', 'at'], ['jetzt', 'now'], ['Kurs', 'price'],
];

/** Programm ohne Shell starten (Text vom Server landet nur als Argument hinter `--`). */
function starte(argv) {
    try {
        GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
    } catch (e) {
        global.logWarning('[' + UUID + '] ' + argv[0] + ': ' + e.message);
    }
}

function _(str) {
    let translation = Gettext.dgettext(UUID, str);
    if (translation !== str && translation !== "") return translation;
    return Gettext.gettext(str);
}

class TradingPositionsDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._metadata = metadata;

        // Settings
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this._settings.bind("server-host",      "serverHost",      this._onSettingChanged.bind(this));
        this._settings.bind("server-port",      "serverPort",      this._onSettingChanged.bind(this));
        this._settings.bind("api-key",          "apiKey",          this._onSettingChanged.bind(this));
        this._settings.bind("use-https",        "useHttps",        this._onSettingChanged.bind(this));
        this._settings.bind("https-port",       "httpsPort",       this._onSettingChanged.bind(this));
        this._settings.bind("ca-pending",       "caPending");
        this._settings.bind("ca-paired",        "caPaired");
        this._settings.bind("refresh-interval", "refreshInterval", this._onSettingChanged.bind(this));
        this._settings.bind("show-leverage",    "showLeverage",    this._onSettingChanged.bind(this));
        this._settings.bind("show-mark-price",  "showMarkPrice",   this._onSettingChanged.bind(this));
        this._settings.bind("show-realized-pnl","showRealizedPnl", this._onSettingChanged.bind(this));
        this._settings.bind("show-bots",        "showBots",        this._onSettingChanged.bind(this));
        this._settings.bind("bot-usdt",         "botUsdt",         () => this._zeigeProzent());
        this._settings.bind("pnl-prozent",      "pnlProzent",      () => this._zeigeProzent());
        this._settings.bind("show-github-link", "showGithubLink",  this._onFooterChanged.bind(this));
        this._settings.bind("bitunix-link",     "bitunixLink",     this._onStyleChanged.bind(this));
        this._settings.bind("font-size",        "fontSize",        this._onStyleChanged.bind(this));
        this._settings.bind("font-size-ui",    "fontSizeUi",      this._onStyleChanged.bind(this));
        this._settings.bind("bg-opacity",       "bgOpacity",       this._onStyleChanged.bind(this));
        this._settings.bind("min-width",        "minWidth",        this._onStyleChanged.bind(this));
        for (let [schluessel, name] of [
                ["alarme-an", "alarmeAn"], ["alarm-intervall", "alarmIntervall"],
                ["alarm-preis", "alarmPreis"], ["alarm-linie", "alarmLinie"], ["alarm-zone", "alarmZone"],
                ["alarm-momentum", "alarmMomentum"], ["alarm-lsob", "alarmLsob"]]) {
            this._settings.bind(schluessel, name, () => this._startAlarme());
        }
        this._settings.bind("alarm-ton",        "alarmTon");
        this._settings.bind("sprache-an",       "spracheAn",       () => this._zeigeSprachKnopf());
        this._settings.bind("sprache-ab",       "spracheAb");
        this._settings.bind("stimme",           "stimme");
        this._settings.bind("ruhe-an",          "ruheAn");
        this._settings.bind("ruhe-von",         "ruheVon");
        this._settings.bind("ruhe-bis",         "ruheBis");
        for (let [schluessel, name] of [["chart-an", "chartAn"], ["chart-symbol", "chartSymbolRoh"],
                                        ["chart-spanne", "chartSpanne"], ["chart-hoehe", "chartHoehe"],
                                        ["chart-art", "chartArt"]]) {
            this._settings.bind(schluessel, name, () => this._startChart());
        }

        this._cookieAcquired = false;
        this._timeoutId      = null;
        this._appVersion     = null;
        this._deskletId      = desklet_id;
        this._caOffen        = null;   // abgeholte, noch nicht bestätigte CA {pem, fp, host}
        this._alarmTimer     = null;
        this._alarmSeit      = 0;          // Serverzeit (ms) des letzten Abrufs, 0 = noch keiner
        this._alarmGesehen   = new Set();  // Kennungen `alarmId-t` gegen Doppelte aus der Überlappung
        this._chartTimer     = null;
        this._chartKurs      = [];         // Schlusskurse der Kerzen, älteste zuerst
        this._chartKerzen    = [];         // [o, h, l, c] je Kerze, für die Kerzendarstellung
        this._marktSession   = neueSession(null);   // System-CAs, getrennt von der Server-Kopplung

        schuetzeEinstellungen();
        this._initSoup();
        this._buildUI();
        this._applyStyle();
        this._ladeKopplung(() => {
            this._startPolling();
            this._startAlarme();
        });
        this._startChart();
    }

    get _baseUrl() {
        let host = (this.serverHost || 'localhost').trim();
        if (this.useHttps) return `https://${host}:${this.httpsPort || 8443}`;
        return `http://${host}:${this.serverPort}`;
    }

    /** Coin im Chart der Web-App; bei Bitunix/Bitget-Positionen mit dieser Börse als Kursquelle. */
    _chartLink(paar, broker) {
        let boerse = CHART_BOERSEN.includes(broker) ? `&boerse=${broker}` : '';
        return `${this._baseUrl}/chart?symbol=${encodeURIComponent(paar)}${boerse}`;
    }

    _oeffne(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            global.logWarning('[' + UUID + '] ' + url + ': ' + e.message);
        }
    }

    /** Symbol-Zelle: Klick auf den Coin öffnet den AutarkTrade-Chart, „BX" die Bitunix-Handelsseite. */
    _symbolZelle(pos, width, fs) {
        let box  = new St.BoxLayout({ style_class: 'symbol-box' });
        box.set_style(`min-width: ${width}px;`);
        let name = new St.Label({ text: pos.symbol || '-', style_class: 'symbol-cell' });
        name.set_style(`font-size: ${fs}px;`);
        let paar = paarSymbol(pos.symbol);
        if (!paar) {
            box.add_child(name);
            return box;
        }
        let knopf = new St.Button({ child: name, style_class: 'symbol-link', reactive: true, track_hover: true });
        knopf.connect('clicked', () => this._oeffne(this._chartLink(paar, pos.broker)));
        new Tooltips.Tooltip(knopf, _("Open in the AutarkTrade chart"));
        box.add_child(knopf);
        if (pos.broker === 'bitunix' && this.bitunixLink !== false) {
            let bx = new St.Button({ label: 'BX', style_class: 'bitunix-link', reactive: true, track_hover: true });
            bx.set_style(`font-size: ${Math.max(8, Math.round(fs * 0.7))}px;`);
            bx.connect('clicked', () => this._oeffne(BITUNIX_HANDEL + paar));
            new Tooltips.Tooltip(bx, _("Open on Bitunix"));
            box.add_child(bx);
        }
        return box;
    }

    /** Klartext-Adresse — nur zum Abholen der CA beim Koppeln (und ohne HTTPS). */
    get _httpUrl() {
        let host = (this.serverHost || 'localhost').trim();
        return `http://${host}:${this.serverPort}`;
    }

    // ------------------------------------------------------------------ HTTPS-Kopplung

    get _caDatei() { return caPfad(this._deskletId, this._settings && this._settings.file); }

    /**
     * Gespeicherte CA asynchron laden und die HTTPS-Session darauf bauen (sonst keine),
     * danach weiter(). Ein später gestarteter Ladevorgang macht einen älteren ungültig.
     */
    _ladeKopplung(weiter) {
        let nr = this._kopplungNr = (this._kopplungNr || 0) + 1;
        let pfad = this._caDatei;
        ladeCa(pfad, (ca) => {
            if (nr !== this._kopplungNr || this._entfernt) return;
            this._tlsSession = null;
            if (ca) {
                try { this._tlsSession = neueSession(pfad); }
                catch (e) { global.logWarning('[' + UUID + '] CA-Datei: ' + e.message); }
            }
            let anzeige = (ca && this._tlsSession) ? ca.fp : '';
            if (this.caPaired !== anzeige) this.caPaired = anzeige;
            if (weiter) weiter();
        });
    }

    /** Knopf „Fetch server certificate": CA über HTTP holen, Fingerabdruck zum Vergleich zeigen. */
    onCaHolen() {
        this._caOffen = null;
        this.caPending = _("Fetching…");
        let host = (this.serverHost || '').trim();
        soupGet(this._session, this._httpUrl + '/api/esp32/ca', (status, body) => {
            if (status !== 200) {
                this.caPending = status === 404
                    ? _("Server too old — /api/esp32/ca missing (404)")
                    : _("Server not reachable") + ` (${this._httpUrl})`;
                return;
            }
            try {
                let ca = pruefeCaAntwort(body);
                this._caOffen = { pem: ca.pem, fp: ca.fp, host };
                this.caPending = ca.fp;
                this._showStatus(_("Compare the fingerprint with Settings › General › HTTPS in the web app:") +
                    '\n' + kurzFingerabdruck(ca.fp) + '\n' + _("Then press \"Fingerprint matches\" in the desklet settings."));
            } catch (e) {
                this.caPending = e.message;
            }
        });
    }

    /** Knopf „Fingerprint matches — pair": abgeholte CA speichern, ab jetzt nur HTTPS mit ihr. */
    onCaBestaetigen() {
        let offen = this._caOffen;
        if (!offen || !gleicherFingerabdruck(offen.fp, this.caPending)) {
            this.caPending = _("Fetch the server certificate first");
            return;
        }
        if (offen.host !== (this.serverHost || '').trim()) {
            this._caOffen = null;
            this.caPending = _("Host changed — fetch the certificate again");
            return;
        }
        speichereCa(this._caDatei, offen.pem, (fehler) => {
            if (this._entfernt) return;
            if (fehler) {
                this.caPending = _("Could not save the certificate:") + ' ' + fehler.message;
                return;
            }
            this._caOffen = null;
            this.caPending = '';
            this._ladeKopplung(() => {
                this._startPolling();
                this._startAlarme();
            });
        });
    }

    // ------------------------------------------------------------------ Style

    _applyStyle() {
        let opacity = Math.max(0, Math.min(100, this.bgOpacity ?? 88)) / 100;
        let fs      = this.fontSize    ?? 12;
        let fsUi    = this.fontSizeUi  ?? 11;
        let mw      = this.minWidth    ?? 480;
        this._outer.set_style(
            `background-color: rgba(12,18,22,${opacity.toFixed(2)});` +
            `min-width: ${mw}px;`
        );
        // Scaling factor for column widths (base: fs=12)
        let scale = fs / 12;
        this._colWidths = {
            symbol:   Math.round((this.bitunixLink !== false ? 112 : 90) * scale),   // + Platz für „BX"
            side:     Math.round(55  * scale),
            leverage: Math.round(36  * scale),
            price:    Math.round(78  * scale),
            pnl:      Math.round(95  * scale),
            realized: Math.round(85  * scale),
        };
        // Positions
        this._posFs        = fs;
        // UI elements (title, footer, total, header)
        this._headerFs     = fs;  // header same size as positions
        this._titleStyle   = `font-size: ${fsUi + 3}px;`;
        this._subtitleStyle = `font-size: ${fsUi}px;`;
        this._totalStyle   = `font-size: ${fsUi}px;`;  // same as subtitle
        this._footerStyle  = `font-size: ${Math.max(8, fsUi - 1)}px;`;
    }

    _onStyleChanged() {
        this._applyStyle();
        // Update static UI elements
        if (this._titleLabel)    this._titleLabel.set_style(this._titleStyle);
        if (this._titleAkzent)   this._titleAkzent.set_style(this._titleStyle);
        if (this._subtitleLabel) this._subtitleLabel.set_style(this._subtitleStyle);
        if (this._footerTime)    this._footerTime.set_style(this._footerStyle);
        if (this._footerRight)   this._footerRight.set_style(this._footerStyle);
        // Re-render so the position font size takes effect immediately
        this._refresh();
    }

    // ------------------------------------------------------------------ Soup

    // Zwei Sessions: _session (Klartext, Kopplung und Betrieb ohne HTTPS) und
    // _tlsSession (nur die gekoppelte CA, siehe _ladeKopplung).
    _initSoup() {
        this._session = neueSession(null);
        this._tlsSession = null;
    }

    _soupGet(url, callback, headers) {
        soupGet(this.useHttps ? this._tlsSession : this._session, url, callback, headers);
    }

    // ------------------------------------------------------------------ UI

    _buildUI() {
        // Outer frame
        let outer = new St.BoxLayout({ vertical: true, style_class: 'trading-desklet' });
        this._outer = outer;
        this.setContent(outer);

        // --- Logo-Header ---
        let headerRow = new St.BoxLayout({ style_class: 'desklet-header-row' });

        // Logo
        let iconPath = this._metadata.path + '/icon.png';
        try {
            let gicon = Gio.icon_new_for_string(iconPath);
            let logo  = new St.Icon({ gicon: gicon, icon_size: 42, style_class: 'desklet-logo' });
            headerRow.add_child(logo);
        } catch(_) {}

        // Title
        let titleBox = new St.BoxLayout({ vertical: true, style_class: 'desklet-title-box' });
        // Schriftzug wie in der Kopfleiste der Web-App: „Autark" + „Trade" in Akzentfarbe.
        let titleRow = new St.BoxLayout({ style_class: 'desklet-title-row' });
        this._titleLabel    = new St.Label({ text: 'Autark', style_class: 'desklet-title' });
        this._titleAkzent   = new St.Label({ text: 'Trade', style_class: 'desklet-title-akzent' });
        titleRow.add_child(this._titleLabel);
        titleRow.add_child(this._titleAkzent);
        this._subtitleLabel = new St.Label({ text: _('Open positions & bots'), style_class: 'desklet-subtitle' });
        titleBox.add_child(titleRow);
        titleBox.add_child(this._subtitleLabel);
        headerRow.add_child(titleBox);

        // Schnellschalter Sprachausgabe (schreibt dieselbe Einstellung wie der Dialog)
        headerRow.add_child(new St.Widget({ x_expand: true }));
        // Schnellschalter PnL: Betrag ↔ Prozent der Marge (dieselbe Einstellung wie im Dialog)
        this._prozentKnopf = new St.Button({ style_class: 'prozent-knopf', reactive: true, can_focus: true,
                                             y_align: St.Align.MIDDLE, label: '%' });
        this._prozentKnopf.connect('clicked', () => {
            this.pnlProzent = !this.pnlProzent;
            this._zeigeProzent();
        });
        headerRow.add_child(this._prozentKnopf);
        this._sprachKnopf = new St.Button({ style_class: 'sprach-knopf', reactive: true, can_focus: true,
                                            y_align: St.Align.MIDDLE });
        this._sprachSymbol = new St.Icon({ icon_size: 18 });
        this._sprachKnopf.set_child(this._sprachSymbol);
        this._sprachKnopf.connect('clicked', () => {
            this.spracheAn = !this.spracheAn;
            this._zeigeSprachKnopf();
        });
        headerRow.add_child(this._sprachKnopf);
        this._zeigeSprachKnopf();
        this._prozentKnopf.style_class = 'prozent-knopf' + (this.pnlProzent ? '' : ' prozent-aus');
        outer.add_child(headerRow);

        // Separator after header
        outer.add_child(linie('linie'));

        // --- Alarme (leer = unsichtbar) ---
        this._alarmBox = new St.BoxLayout({ vertical: true, style_class: 'alarm-box' });
        this._alarmBox.hide();
        outer.add_child(this._alarmBox);

        // --- Kurs-Chart (aus = unsichtbar) ---
        this._chartBox = new St.BoxLayout({ vertical: true, style_class: 'chart-box' });
        let chartKopf = new St.BoxLayout({ style_class: 'chart-kopf' });
        this._chartTitel = new St.Label({ text: '', style_class: 'chart-titel' });
        this._chartWert  = new St.Label({ text: '', style_class: 'chart-wert' });
        chartKopf.add_child(this._chartTitel);
        chartKopf.add_child(new St.Widget({ x_expand: true }));
        chartKopf.add_child(this._chartWert);
        this._chartBox.add_child(chartKopf);
        this._chartFlaeche = new St.DrawingArea({ style_class: 'chart-flaeche', x_expand: true });
        this._chartFlaeche.connect('repaint', (flaeche) => this._zeichneChart(flaeche));
        this._chartBox.add_child(this._chartFlaeche);
        this._chartSpanneLabel = new St.Label({ text: '', style_class: 'chart-spanne' });
        this._chartBox.add_child(this._chartSpanneLabel);
        this._chartBox.add_child(linie('linie-duenn'));
        this._chartBox.hide();
        outer.add_child(this._chartBox);

        // --- Content area (positions / status) ---
        this._content = new St.BoxLayout({ vertical: true, style_class: 'desklet-content' });
        outer.add_child(this._content);

        // --- Footer ---
        outer.add_child(linie('linie'));
        let footer = new St.BoxLayout({ style_class: 'desklet-footer' });
        this._footerTime  = new St.Label({ text: '', style_class: 'footer-time' });
        this._footerRight = new St.Label({ text: '', style_class: 'footer-right' });
        this._updateFooterRight();
        footer.add_child(this._footerTime);
        let spacer = new St.Widget({ x_expand: true });
        footer.add_child(spacer);
        footer.add_child(this._footerRight);
        outer.add_child(footer);

        this._showStatus(_("Connecting…"));
    }

    // ------------------------------------------------------------------ Polling

    _startPolling() {
        this._stopPolling();
        this._refresh();
        this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _refresh() {
        this._fetchDisplay();
    }

    // Single read-only call to the public, key-authenticated endpoint
    // (X-ESP32-Key header — no session cookie). Works even with the app's
    // optional password gate enabled. Returns futures (openPositions) + bots.
    _fetchDisplay() {
        if (!this.apiKey) {
            this._showStatus(_("No API key set.\nEnter it in the desklet settings."));
            return;
        }
        // HTTPS an, aber (noch) nicht gekoppelt: nichts senden — schon gar nicht per http.
        if (this.useHttps && !this._tlsSession) {
            this._showStatus(_("HTTPS is on but not paired yet.\nSettings → \"Fetch server certificate\", compare, confirm."));
            return;
        }
        this._soupGet(this._baseUrl + '/api/esp32/display', (status, body, fehler) => {
            if (status === 401) {
                this._showStatus(_("Invalid API key (401)"));
                return;
            }
            if (status !== 200) {
                let art = this.useHttps ? tlsFehlerArt(status, fehler) : null;
                if (art === 'zertifikat') {
                    this._showStatus(_("Certificate does not match — pair again\n(or the host is not in the server certificate)"));
                } else if (art === 'tls') {
                    this._showStatus(_("HTTPS connection failed — check the HTTPS port") + `\n${this._baseUrl}`);
                } else {
                    this._showStatus(_("Server not reachable") + `\n${this._baseUrl.replace(/^https?:\/\//, '')}`);
                }
                return;
            }
            let data;
            try {
                data = JSON.parse(body);
            } catch(e) {
                this._showStatus(_("Parse error:") + "\n" + e.message);
                return;
            }
            this._futures = data.openPositions || [];
            let bots = (this.showBots !== false) ? (data.bots || []) : [];
            this._letzteDaten = [this._futures, bots];   // für den %-Schalter ohne neuen Abruf
            this._renderAll(this._futures, bots);
            this._updateFooterTime();
        }, { 'X-ESP32-Key': this.apiKey });
    }

    _updateFooterTime() {
        let now = new Date();
        let hh  = String(now.getHours()).padStart(2, '0');
        let mm  = String(now.getMinutes()).padStart(2, '0');
        let ss  = String(now.getSeconds()).padStart(2, '0');
        if (this._footerTime) {
            this._footerTime.set_text(_("Updated: %s").format(`${hh}:${mm}:${ss}`));
        }
    }

    _updateFooterRight() {
        if (!this._footerRight) return;
        let text = this._appVersion ? `v${this._appVersion}` : '';
        if (this.showGithubLink !== false) {
            if (text) text += '  \u2022  ';
            text += 'AutarkTrade';
        }
        this._footerRight.set_text(text);
    }

    _onFooterChanged() {
        this._updateFooterRight();
    }

    // ------------------------------------------------------------------ Render

    _renderAll(positions, bots) {
        this._content.destroy_all_children();

        positions = positions || [];
        bots      = bots || [];

        if (positions.length === 0 && bots.length === 0) {
            this._content.add_child(
                new St.Label({ text: _("No open positions"), style_class: 'no-positions-label' })
            );
            return;
        }

        // Futures nach Börse gruppieren — je eine Sektion (alphabetisch sortiert).
        let renderedAny = false;
        if (positions.length > 0) {
            let byBroker = {};
            for (let p of positions) {
                let b = p.broker || '?';
                (byBroker[b] = byBroker[b] || []).push(p);
            }
            for (let b of Object.keys(byBroker).sort()) {
                if (renderedAny) this._content.add_child(linie('linie-duenn'));
                this._renderFuturesSection(byBroker[b], this._brokerLabel(b));
                renderedAny = true;
            }
        }

        if (bots.length > 0) {
            if (renderedAny) {
                this._content.add_child(linie('linie-duenn'));
            }
            this._renderBotSection(bots);
        }
    }

    _brokerLabel(b) {
        switch ((b || '').toLowerCase()) {
            case 'bitunix': return 'Bitunix';
            case 'bitget':  return 'Bitget';
            case 'pionex':  return 'Pionex';
            default:        return b ? b.charAt(0).toUpperCase() + b.slice(1) : '—';
        }
    }

    // Side einheitlich LONG/SHORT/NEUTRAL (nicht BUY/SELL).
    _displaySide(s) {
        let u = (s || '').toString().toUpperCase();
        if (u === 'BUY'  || u === 'LONG')  return 'LONG';
        if (u === 'SELL' || u === 'SHORT') return 'SHORT';
        return u || '-';
    }

    _zeigeProzent() {
        this._prozentKnopf.style_class = 'prozent-knopf' + (this.pnlProzent ? '' : ' prozent-aus');
        if (this._letzteDaten) this._renderAll(...this._letzteDaten);
    }

    /** Eingesetzte Marge einer Position: Einstieg × Menge / Hebel (wie die Börse für den ROE). */
    _marge(pos) {
        let m = parseFloat(pos.margin);
        if (m > 0) return m;
        let e = parseFloat(pos.entryPrice), q = Math.abs(parseFloat(pos.qty)), l = parseFloat(pos.leverage);
        return e > 0 && q > 0 && l > 0 ? e * q / l : 0;
    }

    /** „+12.34 %" bezogen auf die Marge, „-" ohne Marge. */
    _prozentText(betrag, marge) {
        if (!(marge > 0)) return '-';
        let p = betrag / marge * 100;
        return (p >= 0 ? '+' : '') + p.toFixed(2) + ' %';
    }

    _renderFuturesSection(positions, brokerLabel) {
        // Total PnL
        let totalPnl   = positions.reduce((sum, p) => sum + (parseFloat(p.unrealizedPNL) || 0), 0);
        let totalClass = totalPnl >= 0 ? 'pnl-profit' : 'pnl-loss';
        let totalSign  = totalPnl >= 0 ? '+' : '';
        let totalRow   = new St.BoxLayout({ style_class: 'total-row' });
        let posWord = positions.length === 1 ? _("position") : _("positions");
        let prefix = brokerLabel ? brokerLabel + '  ' : _("Total:") + '  ';
        let totalMarge = positions.reduce((sum, p) => sum + this._marge(p), 0);
        let totalText  = this.pnlProzent ? this._prozentText(totalPnl, totalMarge)
                                         : `${totalSign}${totalPnl.toFixed(2)} USDT`;
        let totalLbl = new St.Label({
            text: prefix + `${totalText}   (${positions.length} ${posWord})`,
            style_class: 'total-label ' + totalClass
        });
        if (this._totalStyle) totalLbl.set_style(this._totalStyle);
        totalRow.add_child(totalLbl);
        this._content.add_child(totalRow);
        this._content.add_child(linie('linie-duenn'));

        // Header row — same column widths as the position rows
        let headerCells = [
            { text: _('Symbol'), width: this._colWidths.symbol },
            { text: _('Side'),   width: this._colWidths.side },
        ];
        if (this.showLeverage)  headerCells.push({ text: _('Lvg'),  width: this._colWidths.leverage });
        headerCells.push({ text: _('Entry'), width: this._colWidths.price });
        if (this.showMarkPrice) headerCells.push({ text: _('Mark'), width: this._colWidths.price });
        headerCells.push({ text: _('unr. PnL'), width: this._colWidths.pnl });
        if (this.showRealizedPnl !== false) headerCells.push({ text: _('real. PnL'), width: this._colWidths.realized });
        this._content.add_child(this._makeHeaderRow(headerCells));

        for (let pos of positions) {
            this._content.add_child(this._makePositionRow(pos));
        }
    }

    // Dedicated section for running Pionex bots. PnL/margin is in the
    // respective margin coin (e.g. SOL for Coin-M) — therefore NO USDT total
    // (coins are not summable), just the count + liquidation price per bot.
    _renderBotSection(bots) {
        let titleRow = new St.BoxLayout({ style_class: 'total-row' });
        let titleLbl = new St.Label({
            text: _("Bots:") + `  ${bots.length} ` + _("running"),
            style_class: 'total-label'
        });
        if (this._totalStyle) titleLbl.set_style(this._totalStyle);
        titleRow.add_child(titleLbl);
        this._content.add_child(titleRow);
        this._content.add_child(linie('linie-duenn'));

        let headerCells = [
            { text: _('Symbol'), width: this._colWidths.symbol },
            { text: _('Side'),   width: this._colWidths.side },
        ];
        if (this.showLeverage) headerCells.push({ text: _('Lvg'), width: this._colWidths.leverage });
        headerCells.push({ text: _('Ø Entry'), width: this._colWidths.price });
        headerCells.push({ text: _('Liq'),     width: this._colWidths.price });
        headerCells.push({ text: _('Grid'),    width: this._colWidths.pnl });
        headerCells.push({ text: _('PnL'),     width: this._colWidths.pnl });
        this._content.add_child(this._makeHeaderRow(headerCells));

        for (let bot of bots) {
            this._content.add_child(this._makeBotRow(bot));
        }
    }

    _makeBotRow(pos) {
        let coin     = pos.marginCoin || 'USDT';
        // Coin-M auf Wunsch in USDT: Beträge × aktueller Kurs (Prozente bleiben gleich)
        let kurs     = parseFloat(pos.markPrice) || 0;
        let faktor   = 1;
        if (this.botUsdt && coin !== 'USDT' && kurs > 0) { faktor = kurs; coin = 'USDT'; }
        let dec      = coin === 'USDT' ? 2 : 4;
        let pnl      = (parseFloat(pos.unrealizedPNL) || 0) * faktor;
        let isProfit = pnl >= 0;
        let pnlClass = isProfit ? 'pnl-profit' : 'pnl-loss';
        let pnlText  = this.pnlProzent ? this._prozentText(pnl, (parseFloat(pos.margin) || 0) * faktor)
                                       : (isProfit ? '+' : '') + pnl.toFixed(dec) + ' ' + coin;
        // Bisher realisierter Grid-Gewinn — fehlt bei älterem Server oder Bots ohne Grid
        let grid     = Number.isFinite(pos.gridProfit) ? pos.gridProfit * faktor : null;
        let gridText = grid === null ? '-' : (grid >= 0 ? '+' : '') + grid.toFixed(dec) + ' ' + coin;
        let gridClass = grid === null ? '' : grid >= 0 ? 'pnl-profit' : 'pnl-loss';
        let sideLower = (pos.side || '').toLowerCase();
        let sideClass = (sideLower === 'long' || sideLower === 'buy') ? 'side-long'
                      : (sideLower === 'neutral') ? 'side-neutral' : 'side-short';

        let liq = pos.liqPrice;
        if (!liq && pos.bitunixData) {
            try {
                let bd = typeof pos.bitunixData === 'string' ? JSON.parse(pos.bitunixData) : pos.bitunixData;
                liq = bd.liqPrice || null;
            } catch(e) {
                global.logError('[' + UUID + '] bot bitunixData parse: ' + e.message);
            }
        }

        let fmt = (v) => {
            if (!v) return '-';
            let n = parseFloat(v);
            if (isNaN(n)) return '-';
            return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
                 : n >= 1    ? n.toFixed(4)
                             : n.toFixed(6);
        };

        let cw = this._colWidths;
        let cells = [   // Symbol kommt als Link-Zelle davor (_symbolZelle)
            { text: this._displaySide(pos.side), cls: 'side-cell ' + sideClass, width: cw.side },
        ];
        if (this.showLeverage) cells.push({ text: (pos.leverage ? pos.leverage + 'x' : '-'), cls: 'leverage-cell', width: cw.leverage });
        cells.push({ text: fmt(pos.entryPrice), cls: 'price-cell', width: cw.price });
        cells.push({ text: fmt(liq),            cls: 'price-cell', width: cw.price });
        cells.push({ text: gridText, cls: 'pnl-cell ' + gridClass, width: cw.pnl });
        cells.push({ text: pnlText, cls: 'pnl-cell ' + pnlClass, width: cw.pnl });

        let fs  = this._posFs || 12;
        let row = new St.BoxLayout({ style_class: 'position-row' });
        row.add_child(this._symbolZelle(pos, cw.symbol, fs));
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: c.cls });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _makePositionRow(pos) {
        let pnl       = parseFloat(pos.unrealizedPNL) || 0;
        let isProfit  = pnl >= 0;
        let pnlClass  = isProfit ? 'pnl-profit' : 'pnl-loss';
        let marge     = this._marge(pos);
        let pnlText   = this.pnlProzent ? this._prozentText(pnl, marge)
                                        : (isProfit ? '+' : '') + pnl.toFixed(2) + ' USDT';
        let sideLower = (pos.side || '').toLowerCase();
        let sideClass = (sideLower === 'long' || sideLower === 'buy') ? 'side-long'
                      : (sideLower === 'neutral') ? 'side-neutral' : 'side-short';

        let markPrice = pos.markPrice;
        if (!markPrice && pos.bitunixData) {
            try {
                let bd = typeof pos.bitunixData === 'string' ? JSON.parse(pos.bitunixData) : pos.bitunixData;
                markPrice = bd.markPrice || bd.liqPrice || null;
            } catch(e) {
                global.logError('[' + UUID + '] bitunixData parse: ' + e.message);
            }
        }

        let fmt = (v) => {
            if (!v) return '-';
            let n = parseFloat(v);
            if (isNaN(n)) return '-';
            return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
                 : n >= 1    ? n.toFixed(4)
                             : n.toFixed(6);
        };

        let cw = this._colWidths;
        let cells = [   // Symbol kommt als Link-Zelle davor (_symbolZelle)
            { text: this._displaySide(pos.side), cls: 'side-cell ' + sideClass, width: cw.side },
        ];
        if (this.showLeverage)  cells.push({ text: (pos.leverage ? pos.leverage + 'x' : '-'), cls: 'leverage-cell', width: cw.leverage });
        cells.push({ text: fmt(pos.entryPrice), cls: 'price-cell', width: cw.price });
        if (this.showMarkPrice) cells.push({ text: fmt(markPrice), cls: 'price-cell', width: cw.price });
        cells.push({ text: pnlText, cls: 'pnl-cell ' + pnlClass, width: cw.pnl });

        if (this.showRealizedPnl !== false) {
            let realized = parseFloat(
                pos.realizedPNL ?? pos.realized_pnl ?? pos.realizedPnl ?? pos.realizedPL ?? 0
            ) || 0;
            let realClass = realized >= 0 ? 'pnl-profit' : 'pnl-loss';
            let realText  = this.pnlProzent ? this._prozentText(realized, marge)
                                            : (realized >= 0 ? '+' : '') + realized.toFixed(2) + ' USDT';
            cells.push({ text: realText, cls: 'pnl-cell ' + realClass, width: cw.realized });
        }

        let fs  = this._posFs || 12;
        let row = new St.BoxLayout({ style_class: 'position-row' });
        row.add_child(this._symbolZelle(pos, cw.symbol, fs));
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: c.cls });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _makeHeaderRow(cells) {
        let fs  = this._headerFs || 12;
        let row = new St.BoxLayout({ style_class: 'header-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: 'header-cell' });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _showStatus(text) {
        this._content.destroy_all_children();
        this._content.add_child(new St.Label({ text, style_class: 'status-label' }));
    }

    // ------------------------------------------------------------------ Alarme
    // Wie das Android-Widget: GET /api/esp32/alarme?seit=… mit dem Hauptschlüssel.
    // Der erste Abruf nach dem Start meldet nichts (sonst käme der ganze Verlauf),
    // danach mit Überlappung fragen und Doppelte über die Kennung aussortieren —
    // der Verlaufseintrag kann eine Zeit tragen, die vor dem letzten Abruf liegt.

    _startAlarme() {
        this._stopAlarme();
        this._zeigeSprachKnopf();
        if (!this.alarmeAn) {
            this._alarmBox.destroy_all_children();
            this._alarmBox.hide();
            return;
        }
        this._holeAlarme();
        this._alarmTimer = Mainloop.timeout_add_seconds(Math.max(5, this.alarmIntervall || 15), () => {
            this._holeAlarme();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopAlarme() {
        if (this._alarmTimer) {
            Mainloop.source_remove(this._alarmTimer);
            this._alarmTimer = null;
        }
    }

    get _alarmArten() {
        let arten = [];
        if (this.alarmPreis)    arten.push('preis');
        if (this.alarmLinie)    arten.push('linie');
        if (this.alarmZone)     arten.push('zone');
        if (this.alarmMomentum) arten.push('momentum');
        if (this.alarmLsob)     arten.push('lsob');
        return arten;
    }

    _holeAlarme() {
        if (!this.apiKey || (this.useHttps && !this._tlsSession)) return;
        let arten = this._alarmArten;
        if (!arten.length) return;   // leer hiesse beim Server „alle"
        let erster = this._alarmSeit === 0;
        let seit = erster ? 0 : Math.max(0, this._alarmSeit - ALARM_UEBERLAPPUNG_MS);
        let url = `${this._baseUrl}/api/esp32/alarme?seit=${seit}&arten=${arten.join(',')}`;
        this._soupGet(url, (status, body) => {
            if (status === 401 || status === 429) {
                // Meist der Anzeige-Schlüssel statt des Hauptschlüssels: Positionen gehen,
                // Alarme nicht. Aufhören — jeder Fehlversuch zählt beim Server zur Sperre,
                // die dann auch die Positionen träfe. Neuer Versuch nach Änderung der Einstellungen.
                this._stopAlarme();
                this._zeigeAlarmZeile({ titel: _("Alarms need the main key, not the display key"), schwere: 'info' }, false);
                return;
            }
            if (status !== 200) return;
            let daten;
            try { daten = JSON.parse(body); } catch (e) { return; }
            let liste = Array.isArray(daten.alarme) ? daten.alarme : [];
            let neu = liste.filter(a => a && a.id && !this._alarmGesehen.has(a.id));
            for (let a of liste) if (a && a.id) this._alarmGesehen.add(a.id);
            if (this._alarmGesehen.size > 500) this._alarmGesehen = new Set(liste.map(a => a.id));
            if (Number.isFinite(daten.jetzt)) this._alarmSeit = daten.jetzt;
            if (erster || !neu.length) return;
            neu.sort((a, b) => a.zeit - b.zeit);   // älteste zuerst ansagen
            this._melde(neu, false);
        }, { 'X-ESP32-Key': this.apiKey });
    }

    _ruhezeit() {
        if (!this.ruheAn) return false;
        let h = new Date().getHours(), von = this.ruheVon, bis = this.ruheBis;
        if (von === bis) return false;
        return von < bis ? (h >= von && h < bis) : (h >= von || h < bis);
    }

    /** Anzeige, Benachrichtigung, Ton, Sprache. `test` übergeht die Ruhezeit. */
    _melde(alarme, test) {
        for (let a of alarme) {
            this._zeigeAlarmZeile(a, true);
            starte(['notify-send', '-a', 'AutarkTrade', '-i', this._metadata.path + '/icon.png',
                    '-u', a.schwere === 'einstieg' ? 'critical' : 'normal',
                    '--', a.titel || a.symbol || _("Alarm"), (a.text && a.text !== a.titel) ? a.text : '']);
        }
        if (this._ruhezeit() && !test) return;
        let hoechste = alarme.some(a => a.schwere === 'einstieg') ? 'einstieg'
                     : alarme.some(a => a.schwere === 'warnung') ? 'warnung' : 'info';
        if (this.alarmTon) {
            starte(['paplay', TON_ORDNER + (hoechste === 'info' ? 'message-new-instant.oga' : 'alarm-clock-elapsed.oga')]);
        }
        if (this.spracheAn) {
            let ab = RANG[this.spracheAb] ?? 1;
            let faellig = alarme.filter(a => (RANG[a.schwere] ?? 1) >= ab);
            if (!faellig.length) return;
            let englisch = this.stimme === 'jenny';
            let saetze = faellig.slice(0, MAX_SAETZE).map(a => ansageSatz(a.schwere, a.titel || a.symbol || '', englisch));
            if (faellig.length > MAX_SAETZE) {
                let rest = faellig.length - MAX_SAETZE;
                saetze.push(englisch ? `and ${rest} more alerts` : `und ${rest} weitere Alarme`);
            }
            // Erst den Ton ausklingen lassen.
            Mainloop.timeout_add(this.alarmTon ? 1200 : 0, () => {
                starte([this._metadata.path + '/sprechen.sh', saetze.join('. '), this.stimme || 'thorsten']);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /** Zeile oben im Desklet; Klick entfernt sie. Höchstens MAX_ZEILEN, neueste oben. */
    _zeigeAlarmZeile(a, mitZeit) {
        let zeit = '';
        if (mitZeit) {
            let d = Number.isFinite(a.zeit) ? new Date(a.zeit) : new Date();
            zeit = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}  `;
        }
        let knopf = new St.Button({ style_class: 'alarm-zeile alarm-' + (a.schwere || 'warnung'), x_expand: true, reactive: true });
        let reihe = new St.BoxLayout();
        reihe.add_child(new St.Label({ text: zeit + (a.titel || a.symbol || _("Alarm")), style_class: 'alarm-text', x_expand: true }));
        reihe.add_child(new St.Label({ text: '✕', style_class: 'alarm-weg' }));
        knopf.set_child(reihe);
        knopf.connect('clicked', () => {
            knopf.destroy();
            if (this._alarmBox.get_n_children() === 0) this._alarmBox.hide();
        });
        this._alarmBox.insert_child_at_index(knopf, 0);
        while (this._alarmBox.get_n_children() > MAX_ZEILEN) {
            this._alarmBox.get_child_at_index(this._alarmBox.get_n_children() - 1).destroy();
        }
        this._alarmBox.show();
    }

    _zeigeSprachKnopf() {
        if (!this._sprachKnopf) return;
        // Ohne Alarme gibt es nichts vorzulesen — dann kein Knopf.
        this._sprachKnopf.visible = !!this.alarmeAn;
        let an = !!this.spracheAn;
        this._sprachSymbol.icon_name = an ? 'audio-volume-high-symbolic' : 'audio-volume-muted-symbolic';
        this._sprachKnopf.set_style_class_name('sprach-knopf' + (an ? '' : ' sprach-aus'));
    }

    onAlarmTest() {
        this._melde([{ id: 'test', zeit: Date.now(), symbol: 'BTCUSDT', schwere: this.spracheAb || 'warnung',
                       titel: "BTCUSDT Zonenalarm bei 65'000", text: _("Test alarm from the desklet settings") }], true);
    }

    // ------------------------------------------------------------------ Kurs-Chart

    _startChart() {
        this._stopChart();
        if (!this.chartAn) { this._chartBox.hide(); return; }
        let spanne = CHART_SPANNEN[this.chartSpanne] || CHART_SPANNEN['24h'];
        this._chartFlaeche.set_height(Math.max(60, this.chartHoehe || 110));
        this._chartKurs = [];
        this._chartKerzen = [];
        this._chartTitel.set_text(chartSymbol(this.chartSymbolRoh) + '  ·  ' + (this.chartSpanne || '24h'));
        this._chartWert.set_text('…');
        this._chartSpanneLabel.set_text('');
        this._chartBox.show();
        this._chartFlaeche.queue_repaint();
        this._holeChart();
        this._chartTimer = Mainloop.timeout_add_seconds(spanne.takt, () => {
            this._holeChart();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopChart() {
        if (this._chartTimer) {
            Mainloop.source_remove(this._chartTimer);
            this._chartTimer = null;
        }
    }

    _holeChart() {
        let symbol = chartSymbol(this.chartSymbolRoh);
        let spanne = CHART_SPANNEN[this.chartSpanne] || CHART_SPANNEN['24h'];
        let url = `${CHART_URL}?symbol=${symbol}&interval=${spanne.interval}&limit=${spanne.limit}`;
        soupGet(this._marktSession, url, (status, body) => {
            if (symbol !== chartSymbol(this.chartSymbolRoh)) return;   // Einstellung inzwischen geändert
            if (status !== 200) {
                this._chartWert.set_text(status === 400 ? _("Unknown symbol") : _("No data"));
                this._chartWert.style_class = 'chart-wert';
                return;
            }
            let kerzen;
            try { kerzen = JSON.parse(body); } catch (e) { return; }
            if (!Array.isArray(kerzen) || kerzen.length < 2) return;
            this._chartKerzen = kerzen.map(k => [1, 2, 3, 4].map(i => parseFloat(k[i])))
                                      .filter(k => k.every(Number.isFinite));
            this._chartKurs = this._chartKerzen.map(k => k[3]);
            let hoch = Math.max(...kerzen.map(k => parseFloat(k[2])));
            let tief = Math.min(...kerzen.map(k => parseFloat(k[3])));
            let start = parseFloat(kerzen[0][1]);
            let jetzt = this._chartKurs[this._chartKurs.length - 1];
            let proz = start > 0 ? (jetzt - start) / start * 100 : 0;
            this._chartWert.set_text(`${chartPreis(jetzt)}   ${proz >= 0 ? '+' : ''}${proz.toFixed(2)} %`);
            this._chartWert.style_class = 'chart-wert ' + (proz >= 0 ? 'pnl-profit' : 'pnl-loss');
            this._chartSpanneLabel.set_text(`${_("Low")} ${chartPreis(tief)}   ${_("High")} ${chartPreis(hoch)}`);
            this._chartFlaeche.queue_repaint();
        });
    }

    /** Linie der Schlusskurse mit leichter Fläche darunter, gestrichelt der Startkurs,
     *  rechts eine Preisachse mit runden Stufen und dem letzten Kurs als Marke. */
    _zeichneChart(flaeche) {
        let cr = flaeche.get_context();
        let [gesamtB, h] = flaeche.get_surface_size();
        let kurs = this._chartKurs;
        if (kurs.length >= 2 && gesamtB > 0 && h > 0) {
            let kerzenArt = this.chartArt === 'kerzen' && this._chartKerzen.length === kurs.length;
            let min = kerzenArt ? Math.min(...this._chartKerzen.map(k => k[2])) : Math.min(...kurs);
            let max = kerzenArt ? Math.max(...this._chartKerzen.map(k => k[1])) : Math.max(...kurs);
            let rand = 8, spann = (max - min) || 1;
            let steigt = kurs[kurs.length - 1] >= kurs[0];
            let [r, g, bl] = steigt ? [0.247, 0.749, 0.561] : [0.878, 0.341, 0.298];   // good / bad
            let jetzt = kurs[kurs.length - 1];

            // Achse: Breite nach dem längsten Text, damit die Linie nie darunter läuft
            let { stufen, schritt } = achsenStufen(min, max);
            let texte = stufen.map(v => achsenText(v, schritt));
            let jetztText = chartPreis(jetzt);
            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(Math.max(8, (this.fontSizeUi ?? 11) - 1));
            let textB = Math.max(...texte.concat([jetztText]).map(t => cr.textExtents(t).xAdvance));
            let b = Math.max(40, gesamtB - textB - 12);
            // Linie: Punkte von Rand zu Rand; Kerzen: je Kerze ein Fach, Mitte darin
            let fach = b / kurs.length;
            let x = kerzenArt ? (i => (i + 0.5) * fach) : (i => i / (kurs.length - 1) * b);
            let y = v => rand + (1 - (v - min) / spann) * (h - 2 * rand);

            // Gitter und Beschriftung
            cr.setLineWidth(1);
            stufen.forEach((v, i) => {
                let yy = Math.round(y(v)) + 0.5;
                cr.setSourceRGBA(0.557, 0.647, 0.686, 0.12);
                cr.moveTo(0, yy);
                cr.lineTo(b, yy);
                cr.stroke();
                cr.setSourceRGBA(0.557, 0.647, 0.686, 0.75);
                cr.moveTo(b + 8, yy + 3.5);
                cr.showText(texte[i]);
            });

            // Startkurs
            cr.setSourceRGBA(0.557, 0.647, 0.686, 0.45);
            cr.setLineWidth(1);
            cr.setDash([3, 3], 0);
            cr.moveTo(0, Math.round(y(kurs[0])) + 0.5);
            cr.lineTo(b, Math.round(y(kurs[0])) + 0.5);
            cr.stroke();
            cr.setDash([], 0);

            if (kerzenArt) {
                // Kerzen: grün steigend, rot fallend; Docht 1px, Körper ~70 % des Fachs
                let koerperB = Math.max(1, Math.min(9, fach * 0.7));
                this._chartKerzen.forEach(([o, hh, l, c], i) => {
                    let mitte = Math.round(x(i)) + 0.5;
                    if (c >= o) cr.setSourceRGBA(0.247, 0.749, 0.561, 1);
                    else        cr.setSourceRGBA(0.878, 0.341, 0.298, 1);
                    cr.setLineWidth(1);
                    cr.moveTo(mitte, y(hh));
                    cr.lineTo(mitte, y(l));
                    cr.stroke();
                    let oben = y(Math.max(o, c));
                    cr.rectangle(mitte - koerperB / 2, oben, koerperB, Math.max(1, y(Math.min(o, c)) - oben));
                    cr.fill();
                });
                cr.setSourceRGBA(r, g, bl, 1);
            } else {
                // Fläche
                cr.moveTo(x(0), h);
                kurs.forEach((v, i) => cr.lineTo(x(i), y(v)));
                cr.lineTo(x(kurs.length - 1), h);
                cr.closePath();
                let verlauf = new Cairo.LinearGradient(0, 0, 0, h);
                verlauf.addColorStopRGBA(0, r, g, bl, 0.28);
                verlauf.addColorStopRGBA(1, r, g, bl, 0.0);
                cr.setSource(verlauf);
                cr.fill();

                // Linie
                cr.setSourceRGBA(r, g, bl, 1);
                cr.setLineWidth(1.6);
                cr.setLineJoin(Cairo.LineJoin.ROUND);
                kurs.forEach((v, i) => i === 0 ? cr.moveTo(x(i), y(v)) : cr.lineTo(x(i), y(v)));
                cr.stroke();

                // Letzter Kurs als Punkt
                cr.arc(x(kurs.length - 1), y(jetzt), 2.6, 0, 2 * Math.PI);
                cr.fill();
            }

            // Letzter Kurs als Marke auf der Achse
            let yj = y(jetzt);
            let markeH = Math.max(8, (this.fontSizeUi ?? 11) - 1) + 5;
            let my = Math.max(0, Math.min(h - markeH, yj - markeH / 2));
            cr.rectangle(b + 4, my, gesamtB - b - 4, markeH);
            cr.fill();
            cr.setSourceRGBA(0.047, 0.071, 0.086, 1);   // panel
            cr.moveTo(b + 8, my + markeH - 4);
            cr.showText(jetztText);
        }
        cr.$dispose();
    }

    // ------------------------------------------------------------------ Lifecycle

    _onSettingChanged() {
        schuetzeEinstellungen();   // falls Cinnamon die Datei neu angelegt hat
        this._cookieAcquired = false;
        this._appVersion     = null;  // server change → fetch version again
        this._ladeKopplung(() => {
            this._startPolling();
            this._startAlarme();
        });
    }

    on_desklet_removed() {
        this._entfernt = true;
        this._stopPolling();
        this._stopAlarme();
        this._stopChart();
    }
}

function main(metadata, desklet_id) {
    return new TradingPositionsDesklet(metadata, desklet_id);
}
