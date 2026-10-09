// Web Radio - Small radio player: store stations (stream addresses) in the settings, play them on the desktop
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Webradio-Desklet: kleiner Player für Radio-Streams. Die Sender (Name + Stream-Adresse)
// stehen in den Einstellungen; abgespielt wird mit GStreamer (playbin) direkt hier.
// Neben Sender und Titel steht ein kleines Bild: das Cover des laufenden Titels (über den Titeltext
// bei iTunes bzw. Deezer nachgeschlagen), sonst das Logo des Senders (radio-browser.info).
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Mainloop = imports.mainloop;
const Gst = imports.gi.Gst;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;

const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const Gettext = imports.gettext;
const UUID = "web-radio@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const LAUT_SCHRITT = 5;             // Prozent je Klick / Mausrad-Raste
const BILD_PX = 38;                 // Kantenlänge von Cover bzw. Logo bei Größe 1
const GROSS_PX = 300;               // Kantenlänge der großen Ansicht (Klick auf das Bild), für alle gleich
const BILD_ORDNER = GLib.build_filenamev([GLib.get_user_cache_dir(), "web-radio@ersenender"]);
const VERZEICHNIS = "https://all.api.radio-browser.info/json/";     // Senderlogos
const COVER_TAGE = 14;              // so lange bleiben Cover im Zwischenspeicher
const LOGO_TAGE = 60;               // Logos; „kein Logo gefunden“ gilt 7 Tage

const TEXTE = {
    titel: _("Web radio"),
    gestoppt: _("Stopped"),
    verbinden: _("Connecting …"),
    puffern: _("Buffering … %d%%"),
    laeuft: _("Playing"),
    fehler: _("Station not reachable"),
    keine: _("No stations stored"),
    keineHinweis: _("Right-click → Configure"),
    lautstaerke: _("Volume %d%%"),
    tipZurueck: _("Previous station"),
    tipWeiter: _("Next station"),
    tipStart: _("Start playback"),
    tipStopp: _("Stop playback"),
    tipLeiser: _("Quieter"),
    tipLauter: _("Louder"),
    tipSpur: _("Click or drag – the mouse wheel works too"),
    tipSpielen: _("Click: play this station"),
    tipBild: _("Click: show large"),
};

// Startet ein Programm, ohne Cinnamon anzuhalten; liefert dessen Ausgabe, bei einem Fehler null
function starten(argv) {
    return new Promise(fertig => {
        try {
            let prozess = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            prozess.init(null);
            prozess.communicate_utf8_async(null, null, (p, ergebnis) => {
                try {
                    let [, ausgabe] = p.communicate_utf8_finish(ergebnis);
                    fertig(p.get_successful() ? (ausgabe || "") : null);
                } catch (e) {
                    fertig(null);
                }
            });
        } catch (e) {
            fertig(null);
        }
    });
}

// Abfrage per curl, Antwort als JSON; null, wenn nichts Brauchbares kam
async function abfragen(adresse, werte) {
    let argv = ["curl", "-s", "-f", "-m", "8", "-A", "webradio-desklet/1.0", "-G", adresse];
    for (let k in werte)
        argv.push("--data-urlencode", k + "=" + werte[k]);
    let aus = await starten(argv);
    if (!aus)
        return null;
    try {
        return JSON.parse(aus);
    } catch (e) {
        return null;
    }
}

// Zum Vergleichen: klein, ohne Akzente (auch türkisches ı/İ), nur Buchstaben und Ziffern
function glatt(s) {
    return String(s || "").toLowerCase().replace(/ı/g, "i").normalize("NFD")
                          .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

// „Interpret - Titel“ zerlegen (erster Interpret, Titel ohne Klammerzusatz); null, wenn es kein Musiktitel ist
function titelTeile(titel) {
    let m = /^(.+?)\s+[-–]\s+(.+)$/.exec(String(titel || "").trim());
    if (!m)
        return null;
    let interpret = m[1].split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|&)\s+|[,;]/i)[0].trim();
    let lied = m[2].replace(/\s*[(\[].*$/, "").trim();
    return interpret && lied ? {interpret: interpret, lied: lied} : null;
}

// Passt ein Treffer aus dem Katalog zum gesuchten Titel? (sonst lieber kein Cover als ein falsches)
function passt(teile, interpret, lied) {
    let a = glatt(teile.interpret), b = glatt(teile.lied), ta = glatt(interpret), tb = glatt(lied);
    return a && b && ta && tb && (a.indexOf(ta) >= 0 || ta.indexOf(a) >= 0)
                              && (b.indexOf(tb) >= 0 || tb.indexOf(b) >= 0);
}

function bildDatei(vorsatz, schluessel, endung) {
    return GLib.build_filenamev([BILD_ORDNER, vorsatz + GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, schluessel, -1) + endung]);
}

function gibtEs(pfad) {
    return GLib.file_test(pfad, GLib.FileTest.EXISTS);
}

// Bild holen und prüfen, dass es wirklich ein lesbares Bild ist
async function bildLaden(adresse, pfad) {
    let aus = await starten(["curl", "-s", "-f", "-L", "-m", "12", "--max-filesize", "3000000",
                             "-A", "Mozilla/5.0", "-o", pfad, adresse]);
    let ok = false;
    if (aus !== null && gibtEs(pfad)) {
        try {
            let [format] = GdkPixbuf.Pixbuf.get_file_info(pfad);
            ok = !!format;
        } catch (e) {
            ok = false;
        }
    }
    if (!ok && gibtEs(pfad))
        GLib.unlink(pfad);
    return ok;
}

// Bild im Seitenverhältnis in ein Quadrat der Kantenlänge `px` einpassen (Logos sind oft breit)
function bildActor(pfad, px) {
    let w = px, h = px;
    try {
        let [format, bw, bh] = GdkPixbuf.Pixbuf.get_file_info(pfad);
        if (format && bw > 0 && bh > 0) {
            let f = Math.min(px / bw, px / bh);
            w = Math.max(1, Math.round(bw * f));
            h = Math.max(1, Math.round(bh * f));
        }
    } catch (e) {
    }
    return St.TextureCache.get_default().load_uri_async(GLib.filename_to_uri(pfad, null), w, h);
}

// >>> Farbwahl: Akzentfarbe und Kartengrund aus den Einstellungen
// Die Stildatei (stylesheet.css) und die selbst gezeichneten Teile sind in Gelb geschrieben; für eine andere
// Akzentfarbe erzeugt das Desklet daraus eine zweite Stildatei mit den umgerechneten Farben und lädt sie dazu.
const AKZENTE = {gelb: [255, 203, 8], rot: [228, 6, 19], orange: [255, 140, 26], gruen: [63, 185, 80],
                 tuerkis: [43, 181, 168], blau: [53, 132, 228], violett: [163, 113, 247]};
const HINTERGRUENDE = {grau: [35, 31, 32], tuerkis: [16, 60, 62], blau: [22, 32, 54], schwarz: [14, 14, 16]};
// die laufenden Farben dieses Desklets (0–255): Akzent, Schrift auf dem Akzent, Akzent als Schrift auf der
// dunklen Karte (bei dunklen Farben aufgehellt) und der Kartengrund; farbeAnwenden() hält sie aktuell
let FARBE = {akzent: [255, 203, 8], auf: [35, 31, 32], text: [255, 203, 8], grund: [35, 31, 32]};

// "#rrggbb" · "rgb(r, g, b)" · "rgba(r, g, b, a)" -> [r, g, b] oder null
function farbeLesen(wert) {
    let s = String(wert || "").trim();
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    if (m)
        return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(s);
    return m ? [1, 2, 3].map(i => Math.max(0, Math.min(255, Math.round(parseFloat(m[i]))))) : null;
}

// Helligkeit 0–1, wie das Auge sie sieht
function farbeHell(c) {
    let [r, g, b] = c.map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function farbeMischen(a, b, anteil) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * anteil));
}

function farbeHex(c) {
    return "#" + c.map(v => (v < 16 ? "0" : "") + v.toString(16)).join("");
}

// Farbe für Zeichenflächen: [r, g, b, Deckkraft] in 0–1; welche = "akzent" (Vorgabe) | "auf" | "text" | "grund"
function farbeCairo(deckkraft, welche) {
    let c = FARBE[welche || "akzent"];
    return [c[0] / 255, c[1] / 255, c[2] / 255, deckkraft === undefined ? 1 : deckkraft];
}

// Aus der gelben Stildatei die Regeln mit Akzentfarbe in der neuen Farbe; jede Regel gilt nur unter der
// Marke dieses Desklets (und geht deshalb der gelben Regel vor)
function farbeStil(css, wurzel, marke) {
    let akzent = FARBE.akzent, weiss = [255, 255, 255], schwarz = [0, 0, 0];
    let aufWeiss = FARBE.auf[0] > 128;
    let aus = [];
    let regel = /([^{}]+)\{([^{}]*)\}/g, m;
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    while ((m = regel.exec(css)) !== null) {
        let inhalt = m[2];
        if (!/#ffcb08|255, ?203, ?8|#ffd94a|#ffd83d|#e0b200|#c99700/i.test(inhalt)
            && !/(^|[;\s])color:\s*(#231f20|rgba\(35, ?31, ?32)/i.test(inhalt))
            continue;
        inhalt = inhalt
            // Schrift AUF der Akzentfläche
            .replace(/(^|[;\s])(color:\s*)#231f20/gi, "$1$2" + farbeHex(FARBE.auf))
            .replace(/rgba\(35, ?31, ?32, ?0\.72\)/g, "rgba(" + FARBE.auf.join(", ") + ", " + (aufWeiss ? "0.85" : "0.72") + ")")
            // Akzent als SCHRIFT auf der dunklen Karte
            .replace(/(^|[;\s])(color:\s*)#ffcb08/gi, "$1$2" + farbeHex(FARBE.text))
            // Abstufungen der Knöpfe
            .replace(/#ffd94a|#ffd83d/gi, farbeHex(farbeMischen(akzent, weiss, 0.22)))
            .replace(/#e0b200/gi, farbeHex(farbeMischen(akzent, schwarz, 0.14)))
            .replace(/#c99700/gi, farbeHex(farbeMischen(akzent, schwarz, 0.24)))
            // Akzent als Fläche, Rand, Linie
            .replace(/#ffcb08/gi, farbeHex(akzent))
            .replace(/255, ?203, ?8\b/g, akzent.join(", "));
        let wahl = m[1].split(",").map(s => {
            s = s.trim();
            return s.indexOf("." + wurzel) === 0 && !/[\w-]/.test(s.charAt(wurzel.length + 1))
                ? "." + wurzel + "." + marke + s.slice(wurzel.length + 1) : "." + marke + " " + s;
        });
        aus.push(wahl.join(", ") + " {" + inhalt + "}");
    }
    return aus.join("\n") + "\n";
}

// Akzentfarbe und Kartengrund aus den Einstellungen übernehmen: d = das Desklet (mit d.akzent, d.akzentEigen,
// d.hintergrund und d.box), farben = seine Tabelle FARBEN für die selbst gezeichneten Teile (oder null)
function farbeAnwenden(d, farben) {
    let akzent = AKZENTE[d.akzent] || (d.akzent === "eigen" && farbeLesen(d.akzentEigen)) || AKZENTE.gelb;
    let weiss = [255, 255, 255];
    let text = akzent;
    for (let i = 0; i < 14 && farbeHell(text) < 0.3; i++)
        text = farbeMischen(text, weiss, 0.12);
    FARBE = {akzent: akzent, auf: farbeHell(akzent) > 0.4 ? [35, 31, 32] : weiss, text: text,
             grund: HINTERGRUENDE[d.hintergrund] || HINTERGRUENDE.grau};

    // selbst gezeichnete Teile: was in der Tabelle gelb ist, bekommt den Akzent (Ziffern die aufgehellte
    // Schriftfarbe), was dunkel auf Gelb steht, die Schriftfarbe auf dem Akzent
    if (farben) {
        if (!farben._gelb)
            Object.defineProperty(farben, "_gelb", {value: JSON.parse(JSON.stringify(farben))});
        let gleich = (c, r, g, b) => Math.abs(c[0] * 255 - r) < 1 && Math.abs(c[1] * 255 - g) < 1 && Math.abs(c[2] * 255 - b) < 1;
        for (let k in farben._gelb) {
            let alt = farben._gelb[k];
            let neu = gleich(alt, 255, 203, 8) ? (/^ziffer/.test(k) ? FARBE.text : akzent)
                : gleich(alt, 35, 31, 32) ? FARBE.auf : null;
            if (neu)
                farben[k] = neu.map(v => v / 255).concat(alt.slice(3));
        }
    }

    let St = imports.gi.St, GLib = imports.gi.GLib, Gio = imports.gi.Gio, Main = imports.ui.main;
    let uuid = d._uuid || d.metadata.uuid;
    let thema = () => St.ThemeContext.get_for_stage(global.stage).get_theme();
    // Die Regeln einer Farbe gelten nur unter einer Marke am Wurzelelement, die es für jede Farbe eigens gibt.
    // Das ist nötig: Cinnamon merkt sich berechnete Stile je Klassenkombination und rechnet beim Laden einer
    // Stildatei nichts neu – eine neue Marke ist eine neue Kombination und bekommt sofort die neuen Farben.
    let markeWeg = () => {
        if (d._farbMarke) {
            d.box.remove_style_class_name(d._farbMarke);
            d._farbMarke = null;
        }
    };
    // alles neu zeichnen, auch die Zeichenflächen
    let fertig = () => {
        if (d._farbWeg)
            return;
        if (d._stil)
            d._stil();
        if (d._zeichnen)
            d._zeichnen();
        let alle = a => {
            if (a instanceof St.DrawingArea)
                a.queue_repaint();
            if (a.get_children)
                a.get_children().forEach(alle);
        };
        alle(d.box);
    };
    // wechselt das Theme des Desktops, sind die zugeladenen Stildateien weg: dann neu anwenden
    if (!d._farbThema)
        d._farbThema = Main.themeManager.connect("theme-set", () => {
            d._farbGeladen = {};
            markeWeg();
            farbeAnwenden(d, farben);
        });

    let lauf = d._farbLauf = (d._farbLauf || 0) + 1;
    if (akzent.join() === AKZENTE.gelb.join()) {            // Gelb steht schon in der Stildatei
        markeWeg();
        fertig();
        return;
    }
    let quelle = Gio.File.new_for_path(GLib.build_filenamev([d.metadata.path, "stylesheet.css"]));
    quelle.load_contents_async(null, (datei, ergebnis) => {
        let css;
        try {
            css = imports.byteArray.toString(datei.load_contents_finish(ergebnis)[1]);
        } catch (e) {
            fertig();
            return;
        }
        let wurzel = (d.box.get_style_class_name() || "").split(/\s+/)[0];
        // Marke aus Desklet, Stildatei und Farbe: ändert sich eines davon, entsteht eine neue
        let marke = "f" + GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uuid + css + farbeHex(akzent), -1).slice(0, 12);
        let ordner = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]));
        let ziel = ordner.get_child("farben-" + marke + ".css");
        let text = farbeStil(css, wurzel, marke);
        ordner.make_directory_async(GLib.PRIORITY_DEFAULT, null, (o, erg) => {
            try {
                o.make_directory_finish(erg);
            } catch (e) {
                // gibt es schon
            }
            ziel.replace_contents_bytes_async(new GLib.Bytes(imports.byteArray.fromString(text)), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null, (z, erg2) => {
                    try {
                        z.replace_contents_finish(erg2);
                    } catch (e) {
                        global.logWarning(uuid + ": Farben nicht anwendbar: " + e);
                        fertig();
                        return;
                    }
                    if (lauf !== d._farbLauf || d._farbWeg)
                        return;                             // inzwischen wurde eine andere Farbe gewählt
                    let pfad = ziel.get_path();
                    d._farbGeladen = d._farbGeladen || {};
                    try {
                        if (!d._farbGeladen[pfad]) {
                            thema().load_stylesheet(pfad);
                            d._farbGeladen[pfad] = true;
                        }
                        markeWeg();
                        d.box.add_style_class_name(marke);
                        d._farbMarke = marke;
                    } catch (e) {
                        global.logWarning(uuid + ": Stildatei der Farben nicht ladbar: " + e);
                    }
                    fertig();
                });
        });
    });
}

// beim Entfernen des Desklets: zugeladene Stildateien und Theme-Beobachtung wieder weg
function farbeEntfernen(d) {
    d._farbWeg = true;
    if (d._farbThema) {
        imports.ui.main.themeManager.disconnect(d._farbThema);
        d._farbThema = 0;
    }
    for (let pfad in d._farbGeladen || {}) {
        try {
            imports.gi.St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(pfad);
        } catch (e) {
            // nichts zu retten
        }
    }
    d._farbGeladen = {};
}
// <<< Farbwahl

class WebradioDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.zustand = "gestoppt";      // "gestoppt" | "verbinden" | "puffern" | "laeuft" | "fehler"
        this.puffer = 0;
        this.aktuell = "";              // Stream-Adresse, die gerade läuft bzw. gewählt ist
        this.titel = "";                // laufender Titel, wenn der Sender ihn mitschickt
        this.organisation = "";         // Sendername aus dem Stream (steht anfangs oft auch als „Titel“ da)
        this.bildMarke = null;          // wofür das Bild zuletzt bestimmt wurde (Sender + Titel)
        this.bildSender = null;
        this.bildPfad = null;
        this.bildLauf = 0;
        this.bildWartet = {};           // laufende Abrufe je Datei, damit nichts doppelt geholt wird
        this.player = null;
        this.busId = 0;

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        this.settings.bind("sender", "sender", this._senderGeaendert);
        this.settings.bind("lautstaerke", "lautstaerke", this._lautSetzen);
        this.settings.bind("autostart", "autostart");
        this.settings.bind("letzter", "letzter");
        this.settings.bind("zeige-cover", "zeigeCover", this._coverGeaendert);
        this.settings.bind("zeige-liste", "zeigeListe", this._zeichnen);
        this.settings.bind("liste-zeilen", "listeZeilen", this._zeichnen);
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this._bauen();
        this.setHeader(_(metadata.name));
        this._bilderAufraeumen();
        this.aktuell = this.letzter || "";
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        this._zeichnen();
        if (this.autostart && this._index() >= 0)
            this._abspielen(this.aktuell);
    }

    on_desklet_removed() {
        farbeEntfernen(this);
        this._grossZu();
        if (this.rollIdle) {
            Mainloop.source_remove(this.rollIdle);
            this.rollIdle = 0;
        }
        this._stoppen();
        if (this.player) {
            if (this.busId)
                this.player.get_bus().disconnect(this.busId);
            this.player.get_bus().remove_signal_watch();
            this.player = null;
        }
    }

    // ------------------------------------------------------------ Wiedergabe

    _senderListe() {
        return (this.sender || []).filter(s => s && /^https?:\/\/\S+$/.test((s.url || "").trim()))
                                  .map(s => ({name: (s.name || "").trim() || s.url.trim(), url: s.url.trim(),
                                              logo: (s.logo || "").trim()}));
    }

    _index() {
        let liste = this._senderListe();
        for (let i = 0; i < liste.length; i++) {
            if (liste[i].url === this.aktuell)
                return i;
        }
        return -1;
    }

    _playerHolen() {
        if (this.player)
            return this.player;
        Gst.init(null);
        this.player = Gst.ElementFactory.make("playbin", "web-radio");
        // manche „Radio“-Streams bringen ein Videobild mit – das soll kein Fenster öffnen
        this.player.set_property("video-sink", Gst.ElementFactory.make("fakesink", null));
        let bus = this.player.get_bus();
        bus.add_signal_watch();
        this.busId = bus.connect("message", (b, msg) => this._meldung(msg));
        this._lautSetzen();
        return this.player;
    }

    _meldung(msg) {
        switch (msg.type) {
        case Gst.MessageType.ERROR: {
            let [fehler] = msg.parse_error();
            global.logWarning("web-radio@ersenender: " + (fehler ? fehler.message : "Fehler") + " (" + this.aktuell + ")");
            this.player.set_state(Gst.State.NULL);
            this.zustand = "fehler";
            break;
        }
        case Gst.MessageType.EOS:
            this.player.set_state(Gst.State.NULL);
            this.zustand = "gestoppt";
            break;
        case Gst.MessageType.BUFFERING: {
            let prozent = msg.parse_buffering();
            if (this.zustand === "gestoppt" || this.zustand === "fehler")
                return;
            this.puffer = prozent;
            this.zustand = prozent < 100 ? "puffern" : "laeuft";
            break;
        }
        case Gst.MessageType.STATE_CHANGED: {
            if (msg.src !== this.player)
                return;
            let [, neu] = msg.parse_state_changed();
            if (neu === Gst.State.PLAYING && this.zustand === "verbinden")
                this.zustand = "laeuft";
            else
                return;
            break;
        }
        case Gst.MessageType.TAG: {
            let tags = msg.parse_tag();
            let [okO, organisation] = tags.get_string("organization");
            if (okO)
                this.organisation = organisation;
            let [ok, titel] = tags.get_string("title");
            if (!ok || titel === this.titel)
                return;
            this.titel = titel;
            break;
        }
        default:
            return;
        }
        this._zeichnen();
    }

    _abspielen(url) {
        let player = this._playerHolen();
        player.set_state(Gst.State.NULL);
        this.aktuell = url;
        this.letzter = url;             // gebundene Einstellung: merkt sich den Sender
        this.titel = "";
        this.organisation = "";
        this.puffer = 0;
        this.zustand = "verbinden";
        player.set_property("uri", url);
        player.set_state(Gst.State.PLAYING);
        this._zeichnen();
    }

    _stoppen() {
        if (this.player)
            this.player.set_state(Gst.State.NULL);
        this.zustand = "gestoppt";
        this.titel = "";
    }

    _spielt() {
        return this.zustand === "verbinden" || this.zustand === "puffern" || this.zustand === "laeuft";
    }

    _startStopp() {
        let liste = this._senderListe();
        if (this._spielt()) {
            this._stoppen();
        } else if (liste.length) {
            let i = this._index();
            this._abspielen(liste[i < 0 ? 0 : i].url);
            return;
        }
        this._zeichnen();
    }

    // weiter = +1 / zurück = -1; läuft gerade nichts, wird nur gewählt
    _wechseln(richtung) {
        let liste = this._senderListe();
        if (!liste.length)
            return;
        let i = this._index();
        let neu = liste[((i < 0 ? 0 : i + richtung) + liste.length) % liste.length].url;
        if (this._spielt())
            this._abspielen(neu);
        else {
            this.aktuell = neu;
            this.letzter = neu;
            this.zustand = "gestoppt";
            this._zeichnen();
        }
    }

    _lautAendern(schritt) {
        this.lautstaerke = Math.max(0, Math.min(100, Math.round(this.lautstaerke) + schritt));
        this._lautSetzen();
    }

    _lautSetzen() {
        if (this.player)
            this.player.set_property("volume", Math.max(0, Math.min(100, this.lautstaerke)) / 100);
        if (this.spur)
            this._zeichnen();
    }

    _senderGeaendert() {
        // läuft ein Sender, der aus der Liste gelöscht wurde, spielt er weiter, bis gestoppt wird
        this._zeichnen();
    }

    // ------------------------------------------------------------ Cover und Senderlogo

    _coverGeaendert() {
        this.bildMarke = null;
        this._zeichnen();
    }

    // alte Bilder aus dem Zwischenspeicher werfen (läuft nebenher)
    _bilderAufraeumen() {
        if (!gibtEs(BILD_ORDNER))
            return;
        starten(["find", BILD_ORDNER, "-type", "f", "(",
                 "-name", "c-*", "-mtime", "+" + COVER_TAGE, "-o",
                 "-name", "*.kein", "-mtime", "+7", "-o",
                 "-name", "l-*.img", "-mtime", "+" + LOGO_TAGE, ")", "-delete"]);
    }

    // Jede Datei wird nur einmal gleichzeitig beschafft; `holen` liefert den Pfad oder ""
    _einmal(pfad, holen) {
        if (!this.bildWartet[pfad]) {
            this.bildWartet[pfad] = holen().then(p => {
                delete this.bildWartet[pfad];
                return p;
            }, e => {
                delete this.bildWartet[pfad];
                global.logWarning("web-radio@ersenender: Bild nicht ladbar: " + e);
                return "";
            });
        }
        return this.bildWartet[pfad];
    }

    // Logo des Senders: eigene Angabe aus der Senderliste, sonst aus dem Verzeichnis radio-browser.info
    _logo(sender) {
        let eigen = sender.logo;
        if (eigen && !/^https?:\/\//i.test(eigen)) {
            let pfad = eigen.replace(/^file:\/\//, "").replace(/^~(?=\/)/, GLib.get_home_dir());
            return Promise.resolve(gibtEs(pfad) ? pfad : "");
        }
        let pfad = bildDatei("l-", sender.url + "|" + eigen, ".img");
        let kein = pfad.replace(/\.img$/, ".kein");
        if (gibtEs(pfad))
            return Promise.resolve(pfad);
        if (gibtEs(kein))
            return Promise.resolve("");
        return this._einmal(pfad, async () => {
            GLib.mkdir_with_parents(BILD_ORDNER, 0o755);
            // Die Logo-Adressen im Verzeichnis sind teils veraltet – der Reihe nach probieren:
            // erst Einträge mit genau dieser Stream-Adresse, dann gleichnamige Sender
            let probiert = {}, versuche = 0;
            let probieren = async adressen => {
                for (let adresse of adressen) {
                    if (!adresse || probiert[adresse] || versuche >= 5)
                        continue;
                    probiert[adresse] = true;
                    versuche++;
                    if (await bildLaden(adresse, pfad))
                        return true;
                }
                return false;
            };
            if (eigen) {
                if (await probieren([eigen]))
                    return pfad;
            } else {
                let treffer = await abfragen(VERZEICHNIS + "stations/byurl", {url: sender.url});
                if (await probieren((treffer || []).map(t => t.favicon)))
                    return pfad;
                treffer = await abfragen(VERZEICHNIS + "stations/search",
                    {name: sender.name, limit: 8, order: "votes", reverse: "true", hidebroken: "true"}) || [];
                let genau = treffer.filter(t => glatt(t.name) === glatt(sender.name));
                if (await probieren(genau.concat(treffer).map(t => t.favicon)))
                    return pfad;
            }
            GLib.file_set_contents(kein, "");       // merken, damit nicht bei jedem Senderwechsel neu gesucht wird
            return "";
        });
    }

    // Cover zum laufenden Titel: erst iTunes, dann Deezer (beide ohne Anmeldung)
    _cover(titel) {
        let teile = titelTeile(titel);
        if (!teile)
            return Promise.resolve("");
        let pfad = bildDatei("c-", glatt(teile.interpret) + "|" + glatt(teile.lied), ".img");
        let kein = pfad.replace(/\.img$/, ".kein");
        if (gibtEs(pfad))
            return Promise.resolve(pfad);
        if (gibtEs(kein))
            return Promise.resolve("");
        return this._einmal(pfad, async () => {
            GLib.mkdir_with_parents(BILD_ORDNER, 0o755);
            let frage = teile.interpret + " " + teile.lied;
            let adresse = "";
            let a = await abfragen("https://itunes.apple.com/search", {term: frage, media: "music", entity: "song", limit: 5});
            let t = ((a && a.results) || []).filter(r => r.artworkUrl100 && passt(teile, r.artistName, r.trackName))[0];
            if (t)
                adresse = t.artworkUrl100.replace("100x100bb", "600x600bb");
            if (!adresse) {
                let d = await abfragen("https://api.deezer.com/search", {q: frage, limit: 5});
                t = ((d && d.data) || []).filter(r => r.album && r.album.cover_big && r.artist
                                                      && passt(teile, r.artist.name, r.title))[0];
                if (t)
                    adresse = t.album.cover_big;
            }
            if (adresse && await bildLaden(adresse, pfad))
                return pfad;
            GLib.file_set_contents(kein, "");
            return "";
        });
    }

    // Bild in die Fläche setzen; ohne Pfad das Radio-Symbol
    _bildSetzen(pfad, erzwingen) {
        if (pfad === this.bildPfad && !erzwingen)
            return;
        this.bildPfad = pfad;
        let px = Math.round(BILD_PX * this.groesse);
        this.bild.set_size(px, px);
        let kind = null;
        if (pfad) {
            try {
                kind = bildActor(pfad, px);
            } catch (e) {
                kind = null;
            }
        }
        if (!kind)
            kind = new St.Icon({icon_name: "audio-x-generic-symbolic", icon_type: St.IconType.SYMBOLIC,
                                icon_size: Math.round(px * 0.55)});
        this.bild.set_child(kind);
        this._tip(this.bild, pfad ? TEXTE.tipBild : "");
        if (this.gross) {
            if (pfad)
                this._grossAuf();           // offene große Ansicht zeigt das neue Bild
            else
                this._grossZu();
        }
    }

    // ---- große Ansicht: Klick auf das kleine Bild legt Cover bzw. Logo groß über den Desktop,
    // ein Klick auf das große oder noch einmal auf das kleine Bild schließt sie wieder

    _grossUmschalten() {
        if (this.gross)
            this._grossZu();
        else if (this.bildPfad)
            this._grossAuf();
    }

    _grossZu() {
        if (this.gross) {
            this.gross.destroy();
            this.gross = null;
        }
    }

    _grossAuf() {
        this._grossZu();
        let rand = 8, aussen = GROSS_PX + 2 * rand;
        let kind;
        try {
            kind = bildActor(this.bildPfad, GROSS_PX);
        } catch (e) {
            return;
        }
        this.gross = new St.Button({child: kind, reactive: true});
        this.gross.set_style("background-color: rgba(20, 20, 22, 0.96); border-radius: 12px; padding: " + rand + "px; " +
                             "border: 1px solid rgba(242, 239, 230, 0.25);");
        this.gross.set_size(aussen, aussen);
        this.gross.connect("clicked", () => this._grossZu());
        // mittig über dem Desklet, aber ganz auf dem Bildschirm
        let [x, y] = this.actor.get_transformed_position();
        let [w] = this.actor.get_transformed_size();
        let m = Main.layoutManager.findMonitorForActor(this.actor) || Main.layoutManager.primaryMonitor;
        let gx = Math.round(x + w / 2 - aussen / 2), gy = Math.round(y);
        gx = Math.max(m.x + 8, Math.min(gx, m.x + m.width - aussen - 8));
        gy = Math.max(m.y + 8, Math.min(gy, m.y + m.height - aussen - 8));
        this.gross.set_position(gx, gy);
        Main.uiGroup.add_actor(this.gross);
    }

    // Bestimmt das Bild neu, wenn sich Sender oder Titel geändert haben. Beim Senderwechsel kommt sofort
    // das Logo; ein neuer Titel lässt das alte Bild stehen, bis das neue Cover (oder das Logo) da ist.
    _bildAktualisieren(sender, titel) {
        this.bild.visible = !!this.zeigeCover;
        if (!this.zeigeCover) {
            this._grossZu();
            return;
        }
        // der Sendername als „Titel“ ist kein Musikstück
        if (titel && this.organisation && titel === this.organisation)
            titel = "";
        let marke = (sender ? sender.url + "|" + sender.logo : "") + "\n" + titel;
        if (marke === this.bildMarke)
            return;
        this.bildMarke = marke;
        let lauf = ++this.bildLauf;
        if (!sender) {
            this.bildSender = null;
            this._bildSetzen("");
            return;
        }
        (async () => {
            let logo = await this._logo(sender);
            if (lauf !== this.bildLauf)
                return;
            if (this.bildSender !== sender.url || !titel) {
                this.bildSender = sender.url;
                this._bildSetzen(logo);
            }
            if (!titel)
                return;
            let cover = await this._cover(titel);
            if (lauf === this.bildLauf)
                this._bildSetzen(cover || logo);
        })().catch(e => global.logError("web-radio@ersenender: " + e));
    }

    // ------------------------------------------------------------ Aufbau

    _taste(symbol, klasse, aktion) {
        let icon = new St.Icon({icon_name: symbol, icon_type: St.IconType.SYMBOLIC});
        let taste = new St.Button({style_class: klasse, child: icon, reactive: true, can_focus: true,
                                   y_align: Clutter.ActorAlign.CENTER});
        taste.connect("clicked", aktion);
        return {taste: taste, icon: icon};
    }

    _bauen() {
        this.box = new St.BoxLayout({vertical: true, style_class: "wr-box", reactive: true});
        this.box.connect("scroll-event", (a, ereignis) => {
            let r = ereignis.get_scroll_direction();
            if (r === Clutter.ScrollDirection.UP)
                this._lautAendern(LAUT_SCHRITT);
            else if (r === Clutter.ScrollDirection.DOWN)
                this._lautAendern(-LAUT_SCHRITT);
            return Clutter.EVENT_STOP;
        });
        this.lKopf = new St.Label({style_class: "wr-kopf"});
        this.lSender = new St.Label({style_class: "wr-sender"});
        this.lTitel = new St.Label({style_class: "wr-titel"});
        for (let l of [this.lSender, this.lTitel])
            l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.box.add_actor(this.lKopf);
        // Zeile „läuft gerade“: links Cover bzw. Senderlogo, rechts Sender und Titel
        let jetzt = new St.BoxLayout({style_class: "wr-jetzt"});
        this.bild = new St.Button({style_class: "wr-bild", reactive: true, y_align: Clutter.ActorAlign.CENTER});
        this.bild.connect("clicked", () => this._grossUmschalten());
        let texte = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        texte.add_actor(this.lSender);
        texte.add_actor(this.lTitel);
        jetzt.add(this.bild);
        jetzt.add(texte, {expand: true, x_fill: true});
        this.box.add_actor(jetzt);

        let bedien = new St.BoxLayout({vertical: true, style_class: "wr-bedien-box"});
        let tasten = new St.BoxLayout({style_class: "wr-tasten", x_align: Clutter.ActorAlign.CENTER});
        this.tZurueck = this._taste("media-skip-backward-symbolic", "wr-taste", () => this._wechseln(-1));
        this.tStart = this._taste("media-playback-start-symbolic", "wr-taste-haupt", () => this._startStopp());
        this.tWeiter = this._taste("media-skip-forward-symbolic", "wr-taste", () => this._wechseln(1));
        for (let t of [this.tZurueck, this.tStart, this.tWeiter])
            tasten.add_actor(t.taste);
        bedien.add_actor(tasten);

        let laut = new St.BoxLayout({style_class: "wr-laut"});
        this.tLeiser = this._taste("audio-volume-low-symbolic", "wr-taste-klein", () => this._lautAendern(-LAUT_SCHRITT));
        this.tLauter = this._taste("audio-volume-high-symbolic", "wr-taste-klein", () => this._lautAendern(LAUT_SCHRITT));
        // Lautstärkebalken als Zeichenfläche. Bewusst kein Kind-Element mit gesetzter Breite: dessen Breite
        // würde zur Mindestbreite der Zeile und könnte die Karte bei vollem Balken auseinanderdrücken.
        // Anklicken oder Ziehen setzt die Lautstärke direkt.
        this.spur = new St.DrawingArea({style_class: "wr-spur", reactive: true});
        this.balkenWert = 0;
        this.balkenZieht = false;
        let anteilBei = ereignis => {
            let [x] = ereignis.get_coords();
            let [links] = this.spur.get_transformed_position();
            let [breite] = this.spur.get_transformed_size();
            return breite > 0 ? Math.max(0, Math.min(1, (x - links) / breite)) : 0;
        };
        let setzen = ereignis => {
            this.lautstaerke = Math.round(anteilBei(ereignis) * 20) * 5;       // 5-%-Schritte
            this._lautSetzen();
        };
        this.spur.connect("repaint", flaeche => {
            let cr = flaeche.get_context();
            let [w, h] = flaeche.get_surface_size();
            let dick = Math.max(3, Math.round(h * 0.32)), r = dick / 2, mitte = h / 2;
            let strich = (bis, f) => {
                if (bis <= r * 2)
                    return;
                cr.setSourceRGBA(f[0], f[1], f[2], f[3]);
                cr.setLineWidth(dick);
                cr.setLineCap(1);                       // runde Enden
                cr.moveTo(r, mitte);
                cr.lineTo(bis - r, mitte);
                cr.stroke();
            };
            strich(w, [242 / 255, 239 / 255, 230 / 255, 0.16]);
            strich(this.balkenWert * w, farbeCairo(1));
            cr.$dispose();
        });
        // Drücken abfangen (EVENT_STOP): sonst zieht der Rahmen des Desklets zum Verschieben die Maus an sich
        this.spur.connect("button-press-event", (a, ereignis) => {
            if (ereignis.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this.balkenZieht = true;
            setzen(ereignis);
            return Clutter.EVENT_STOP;
        });
        this.spur.connect("motion-event", (a, ereignis) => {
            if (this.balkenZieht)
                setzen(ereignis);
            return Clutter.EVENT_PROPAGATE;
        });
        this.spur.connect("button-release-event", () => {
            this.balkenZieht = false;
            return Clutter.EVENT_STOP;
        });
        this.spur.connect("leave-event", () => {
            this.balkenZieht = false;
            return Clutter.EVENT_PROPAGATE;
        });
        laut.add(this.tLeiser.taste);
        laut.add(this.spur, {expand: true, x_fill: true, y_fill: true});
        laut.add(this.tLauter.taste);
        bedien.add_actor(laut);
        this.box.add_actor(bedien);

        // Senderliste: bei vielen Sendern blättert sie (Mausrad über der Liste)
        this.zeilenBox = new St.BoxLayout({vertical: true});
        this.blaettern = new St.ScrollView({style_class: "wr-zeilen", hscrollbar_policy: St.PolicyType.NEVER,
                                            vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this.blaettern.add_actor(this.zeilenBox);
        this.box.add_actor(this.blaettern);
        this.lStatus = new St.Label({style_class: "wr-status"});
        this.box.add_actor(this.lStatus);
        this.setContent(this.box);
    }

    // Tooltip an `actor`; der Text wird nur neu gesetzt, wenn er sich geändert hat (ein leerer Text zeigt nichts)
    _tip(actor, text) {
        text = text || "";
        if (!actor._tip) {
            actor.reactive = true;
            actor._tip = new Tooltips.Tooltip(actor, text);
            actor._tipText = text;
        } else if (actor._tipText !== text) {
            actor._tipText = text;
            actor._tip.set_text(text);
        }
    }

    // Akzentfarbe und Kartengrund aus den Einstellungen anwenden (zeichnet danach alles neu)
    _farbe() {
        farbeAnwenden(this, typeof FARBEN === "undefined" ? null : FARBEN);
    }

    _stil() {
        let a = Math.max(0, Math.min(1, this.deckkraft));
        this.box.set_style("font-size: " + (10 * this.groesse).toFixed(1) + "pt; " +
                           "background-color: rgba(" + FARBE.grund.join(", ") + ", " + a.toFixed(2) + ");");
        let px = n => Math.round(n * this.groesse);
        this.tStart.icon.set_icon_size(px(22));
        for (let t of [this.tZurueck, this.tWeiter])
            t.icon.set_icon_size(px(16));
        for (let t of [this.tLeiser, this.tLauter])
            t.icon.set_icon_size(px(14));
        this.spur.set_height(px(16));       // Greiffläche des Lautstärkebalkens
        this._bildSetzen(this.bildPfad || "", true);
        this._zeichnen();
    }

    // ------------------------------------------------------------ Anzeige

    _balkenSetzen() {
        let wert = Math.max(0, Math.min(100, this.lautstaerke)) / 100;
        if (wert !== this.balkenWert) {
            this.balkenWert = wert;
            this.spur.queue_repaint();
        }
    }

    _zeichnen() {
        let T = TEXTE;
        let liste = this._senderListe();
        let i = this._index();
        let spielt = this._spielt();

        this.lKopf.set_text(T.titel);
        this.lSender.set_text(liste.length ? (i >= 0 ? liste[i].name : liste[0].name) : T.keine);
        this.lTitel.set_text(liste.length ? (spielt && this.titel ? this.titel : " ") : T.keineHinweis);
        this.tStart.icon.set_icon_name(spielt ? "media-playback-stop-symbolic" : "media-playback-start-symbolic");
        this._bildAktualisieren(liste.length ? liste[i >= 0 ? i : 0] : null, spielt ? this.titel : "");

        let laut = Math.max(0, Math.min(100, this.lautstaerke));
        this._balkenSetzen();

        // Tooltips: was die Tasten tun; beim Sender der volle Name samt laufendem Titel (beides wird sonst gekürzt)
        this._tip(this.tZurueck.taste, T.tipZurueck);
        this._tip(this.tWeiter.taste, T.tipWeiter);
        this._tip(this.tStart.taste, spielt ? T.tipStopp : T.tipStart);
        this._tip(this.tLeiser.taste, T.tipLeiser);
        this._tip(this.tLauter.taste, T.tipLauter);
        this._tip(this.spur, T.lautstaerke.format(laut) + "\n" + T.tipSpur);
        let senderTip = liste.length ? [(i >= 0 ? liste[i] : liste[0]).name, spielt && this.titel ? this.titel : ""].filter(s => s).join("\n") : "";
        this._tip(this.lSender, senderTip);
        this._tip(this.lTitel, senderTip);
        this._tip(this.bild, this.bildPfad ? T.tipBild : "");

        this.zeilenBox.destroy_all_children();
        this.blaettern.visible = this.zeigeListe && liste.length > 0;
        if (this.blaettern.visible) {
            liste.forEach((s, n) => {
                let name = new St.Label({text: s.name, style_class: "wr-zeile-name"});
                name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                let zeile = new St.Button({style_class: "wr-zeile" + (n === i && spielt ? " wr-aktiv" : ""),
                                           child: name, reactive: true, x_fill: true, x_align: St.Align.START});
                new Tooltips.Tooltip(zeile, s.name + "\n" + s.url + "\n" + (n === i && spielt ? T.tipStopp : T.tipSpielen));
                zeile.connect("clicked", () => {
                    if (n === this._index() && this._spielt())
                        this._startStopp();             // Klick auf den laufenden Sender stoppt
                    else
                        this._abspielen(s.url);
                });
                this.zeilenBox.add_actor(zeile);
            });
            // Höhe auf die eingestellte Zeilenzahl begrenzen; den laufenden Sender in Sicht halten
            let zeilen = Math.max(3, Math.round(this.listeZeilen));
            let [, zeileH] = this.zeilenBox.get_first_child().get_preferred_height(-1);
            if (!(zeileH > 0))
                zeileH = Math.round(26 * this.groesse);
            this.blaettern.set_height(liste.length > zeilen ? zeilen * zeileH : -1);
            let wahl = i < 0 ? 0 : i;
            if (wahl !== this.gezeigterIndex || liste.length !== this.gezeigteAnzahl) {
                this.gezeigterIndex = wahl;
                this.gezeigteAnzahl = liste.length;
                let regler = this.blaettern.get_vscroll_bar().get_adjustment();
                let ziel = Math.max(0, (wahl - Math.floor(zeilen / 2)) * zeileH);
                if (this.rollIdle)
                    Mainloop.source_remove(this.rollIdle);
                this.rollIdle = Mainloop.idle_add(() => {
                    this.rollIdle = 0;
                    regler.set_value(Math.min(ziel, Math.max(0, regler.upper - regler.page_size)));
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        let status = this.zustand === "puffern" ? T.puffern.format(this.puffer)
            : this.zustand === "gestoppt" ? T.lautstaerke.format(laut) : T[this.zustand];
        if (this.zustand === "laeuft")
            status = T.laeuft + " · " + T.lautstaerke.format(laut);
        this.lStatus.set_text(status);
        this.lStatus.set_style_class_name("wr-status" + (this.zustand === "fehler" ? " wr-fehler" : ""));
    }
}

function main(metadata, desklet_id) {
    return new WebradioDesklet(metadata, desklet_id);
}
