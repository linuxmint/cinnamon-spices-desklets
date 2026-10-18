// Calendar - Month calendar with week numbers and holidays, optionally as a three-month view. German public holidays per state, own days and import from a calendar file
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Kalenderblatt-Desklet: Monatskalender mit Kalenderwochen und Feiertagen, auf Wunsch drei Monate.
// Feiertage: gesetzliche je Bundesland (berechnet), eigene Tage aus den Einstellungen und Einträge aus
// iCalendar-Quellen: eine Datei (.ics) und beliebig viele Kalender-Abos (Adresse einer .ics-Datei im Netz,
// z. B. Feiertage eines anderen Landes, Schulferien, der eigene Online-Kalender). Termine mit Uhrzeit und
// Wiederholungen (täglich, wöchentlich, monatlich, jährlich) werden mitgelesen. Dazu Neu- und Vollmond,
// Wochenbeginn Montag oder Sonntag und in der Liste der Abstand bis zum Termin.
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Tooltips = imports.ui.tooltips;

const Gettext = imports.gettext;
const UUID = "calendar-sheet@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const MONATE = [_("January"), _("February"), _("March"), _("April"), _("May"), _("June"), _("July"), _("August"), _("September"), _("October"), _("November"), _("December")];
const WOCHENTAGE = [_("Mo"), _("Tu"), _("We"), _("Th"), _("Fr"), _("Sa"), _("Su")];
const TEXTE = {
    kw: _("Wk"),
    heute: _("Back to the current month"),
    importFehler: _("Calendar file cannot be read"),
    aboFehler: _("Calendar subscription not reachable"),
    aboNeu: _("Refresh calendar subscriptions now"),
    vollmond: _("Full moon"),
    neumond: _("New moon"),
    heuteKurz: _("today"),
    morgen: _("tomorrow"),
    inTagen: _("in %d d"),
};

const ABO_ORDNER = GLib.build_filenamev([GLib.get_user_cache_dir(), "calendar-sheet@ersenender"]);
const ABO_ALLE = 6 * 3600;          // Sekunden zwischen zwei Abrufen der Kalender-Abos
const ICS_WOCHENTAGE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Gesetzliche Feiertage: [Name de, Name tr, fest "MM-TT" | Abstand zu Ostersonntag, Länder ("*" = bundesweit)]
const FEIERTAGE = [
    [_("New Year's Day"), "01-01", "*"],
    [_("Epiphany"), "01-06", "BW BY ST"],
    [_("International Women's Day"), "03-08", "BE MV"],
    [_("Good Friday"), -2, "*"],
    [_("Easter Sunday"), 0, "BB"],
    [_("Easter Monday"), 1, "*"],
    [_("Labour Day"), "05-01", "*"],
    [_("Ascension Day"), 39, "*"],
    [_("Whit Sunday"), 49, "BB"],
    [_("Whit Monday"), 50, "*"],
    [_("Corpus Christi"), 60, "BW BY HE NW RP SL"],
    [_("Assumption Day"), "08-15", "BY SL"],
    [_("World Children's Day"), "09-20", "TH"],
    [_("German Unity Day"), "10-03", "*"],
    [_("Reformation Day"), "10-31", "BB HB HH MV NI SN ST SH TH"],
    [_("All Saints' Day"), "11-01", "BW BY NW RP SL"],
    [_("Day of Repentance and Prayer"), "bussbettag", "SN"],
    [_("Christmas Day"), "12-25", "*"],
    [_("2nd Day of Christmas"), "12-26", "*"],
];

// Datei nicht blockierend lesen (das Desklet teilt sich den Faden mit dem ganzen Desktop)
// -> Promise<Text | null>; null = gibt es nicht oder nicht lesbar
function dateiLesen(pfad) {
    return new Promise(fertig => {
        Gio.File.new_for_path(pfad).load_contents_async(null, (datei, ergebnis) => {
            try {
                let [ok, inhalt] = datei.load_contents_finish(ergebnis);
                fertig(ok ? ByteArray.toString(inhalt) : null);
            } catch (e) {
                fertig(null);
            }
        });
    });
}

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

// iCalendar-Zeitangabe (Treffer von /^DTSTART([^:\n]*):(\S+)/m) -> {d: Datum in Ortszeit, zeit: "14:30" | null}
// „Z“ = Weltzeit und TZID=… werden in die Ortszeit dieses Rechners umgerechnet; ohne Uhrzeit = ganztägig
function icsZeit(treffer) {
    if (!treffer)
        return null;
    let m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(treffer[2]);
    if (!m)
        return null;
    let jahr = +m[1], monat = +m[2] - 1, tag = +m[3];
    if (m[4] === undefined)
        return {d: new Date(jahr, monat, tag), zeit: null};
    let std = +m[4], min = +m[5];
    let d = new Date(jahr, monat, tag, std, min);
    let zone = /TZID=([^;:]+)/.exec(treffer[1] || "");
    if (m[7]) {
        d = new Date(Date.UTC(jahr, monat, tag, std, min));
    } else if (zone) {
        try {
            let dort = GLib.DateTime.new(GLib.TimeZone.new(zone[1]), jahr, monat + 1, tag, std, min, 0);
            if (dort)
                d = new Date(dort.to_unix() * 1000);
        } catch (e) {
            // unbekannte Zeitzone: die Zeit so nehmen, wie sie dasteht
        }
    }
    return {d: new Date(d.getFullYear(), d.getMonth(), d.getDate()), zeit: zwei(d.getHours()) + ":" + zwei(d.getMinutes())};
}

// Wiederholungen eines Termins nach seiner RRULE (FREQ, INTERVAL, UNTIL, COUNT, bei wöchentlich BYDAY)
// -> Liste der Tage zwischen `von` und `bis`
function wiederholungen(start, regel, von, bis) {
    let schritt = Math.max(1, parseInt(regel.INTERVAL) || 1);
    let anzahl = regel.COUNT ? parseInt(regel.COUNT) : Infinity;
    let ende = bis;
    let u = /^(\d{4})(\d{2})(\d{2})/.exec(regel.UNTIL || "");
    if (u) {
        let until = new Date(+u[1], +u[2] - 1, +u[3]);
        if (until < ende)
            ende = until;
    }
    let aus = [], n = 0, grenze = 4000;
    let dazu = tag => {
        n++;
        if (n <= anzahl && tag >= von)
            aus.push(tag);
        return n < anzahl;
    };
    if (regel.FREQ === "WEEKLY") {
        let tage = (regel.BYDAY || "").split(",").map(x => ICS_WOCHENTAGE.indexOf(x.slice(-2))).filter(x => x >= 0);
        if (!tage.length)
            tage = [start.getDay()];
        tage.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));        // Montag zuerst
        let woche = new Date(start.getFullYear(), start.getMonth(), start.getDate() - ((start.getDay() + 6) % 7));
        while (woche <= ende && grenze-- > 0) {
            for (let wd of tage) {
                let tag = new Date(woche.getFullYear(), woche.getMonth(), woche.getDate() + ((wd + 6) % 7));
                if (tag >= start && tag <= ende && !dazu(tag))
                    return aus;
            }
            woche = new Date(woche.getFullYear(), woche.getMonth(), woche.getDate() + 7 * schritt);
        }
        return aus;
    }
    for (let i = 0; grenze-- > 0; i++) {
        let tag = regel.FREQ === "DAILY" ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * schritt)
            : regel.FREQ === "MONTHLY" ? new Date(start.getFullYear(), start.getMonth() + i * schritt, start.getDate())
            : new Date(start.getFullYear() + i * schritt, start.getMonth(), start.getDate());
        if (tag > ende)
            break;
        if (tag.getDate() !== start.getDate() && regel.FREQ !== "DAILY")
            continue;                       // den 31. gibt es nicht in jedem Monat
        if (!dazu(tag))
            break;
    }
    return aus;
}

// Neu- und Vollmonde um einen Monat herum (Näherung nach Meeus, auf wenige Stunden genau)
// -> {"JJJJ-MM-TT": "neu" | "voll"}
function mondphasen(jahr, monat) {
    let aus = {};
    let k0 = Math.floor((jahr + (monat + 0.5) / 12 - 2000) * 12.3685);
    let rad = g => g * Math.PI / 180;
    for (let k = k0 - 2; k <= k0 + 2; k += 0.5) {
        let voll = k % 1 !== 0;
        let T = k / 1236.85, E = 1 - 0.002516 * T;
        let M = rad(2.5534 + 29.1053567 * k), Ms = rad(201.5643 + 385.81693528 * k), F = rad(160.7108 + 390.67050284 * k);
        let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T
            + (voll ? -0.40614 : -0.4072) * Math.sin(Ms) + (voll ? 0.17302 : 0.17241) * E * Math.sin(M)
            + (voll ? 0.01614 : 0.01608) * Math.sin(2 * Ms) + (voll ? 0.01043 : 0.01039) * Math.sin(2 * F)
            + (voll ? 0.00734 : 0.00739) * E * Math.sin(Ms - M) - (voll ? 0.00515 : 0.00514) * E * Math.sin(Ms + M)
            + (voll ? 0.00209 : 0.00208) * E * E * Math.sin(2 * M);
        // Julianisches Datum (Dynamische Zeit, gut eine Minute vor der Weltzeit) -> Tag in Ortszeit
        let d = new Date((jde - 2440587.5) * 86400000 - 70000);
        aus[schluessel(d)] = voll ? "voll" : "neu";
    }
    return aus;
}

function zwei(n) {
    return (n < 10 ? "0" : "") + n;
}

function schluessel(d) {
    return d.getFullYear() + "-" + zwei(d.getMonth() + 1) + "-" + zwei(d.getDate());
}

// Ostersonntag (gregorianisch, Verfahren nach Butcher/Meeus)
function ostern(jahr) {
    let a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
    let d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    let g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    let i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = Math.floor((a + 11 * h + 22 * l) / 451);
    let monat = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(jahr, monat - 1, tag);
}

// ISO-Kalenderwoche
function kalenderwoche(d) {
    let t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));           // Donnerstag derselben Woche
    let erster = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - erster) / 86400000 - 3 + ((erster.getDay() + 6) % 7)) / 7);
}

// >>> Farbwahl: Akzentfarbe und Kartengrund aus den Einstellungen
// Die Stildatei (stylesheet.css) und die selbst gezeichneten Teile sind in Gelb geschrieben; für eine andere
// Akzentfarbe erzeugt das Desklet daraus eine zweite Stildatei mit den umgerechneten Farben und lädt sie dazu.
const AKZENTE = {gelb: [255, 203, 8], rot: [228, 6, 19], orange: [255, 140, 26], gruen: [63, 185, 80],
                 tuerkis: [43, 181, 168], blau: [53, 132, 228], violett: [163, 113, 247]};
const HINTERGRUENDE = {grau: [35, 31, 32], tuerkis: [16, 60, 62], blau: [22, 32, 54], schwarz: [14, 14, 16]};
// die laufenden Farben dieses Desklets (0–255): Akzent, Schrift auf dem Akzent, Akzent als Schrift auf der
// dunklen Karte (bei dunklen Farben aufgehellt) und der Kartengrund. Jedes aufgestellte Exemplar hat seine
// eigenen Farben (d._farbWerte); FARBE und die Tabelle FARBEN zeigen immer die des Exemplars, das gerade
// arbeitet – farbeFuer() schaltet um, farbeHuelle() sorgt dafür, dass das vor jeder Methode geschieht
let FARBE = {akzent: [255, 203, 8], auf: [35, 31, 32], text: [255, 203, 8], grund: [35, 31, 32]};
let FARBE_VON = null;

// FARBE und FARBEN auf die Farben des Exemplars d stellen
function farbeFuer(d) {
    let w = d._farbWerte;
    if (!w || FARBE_VON === d)
        return;
    FARBE_VON = d;
    FARBE = w.farbe;
    for (let k in w.tabelle || {})
        w.ziel[k] = w.tabelle[k];
}

// alle Methoden des Exemplars d so umhüllen, dass vor ihrem Lauf seine Farben gelten (nötig, wenn dasselbe
// Desklet mehrfach mit verschiedenen Farben auf dem Schreibtisch steht)
function farbeHuelle(d) {
    let p = Object.getPrototypeOf(d);
    Object.getOwnPropertyNames(p).forEach(n => {
        let f = Object.getOwnPropertyDescriptor(p, n).value;
        if (n === "constructor" || typeof f !== "function")
            return;
        d[n] = function () {
            farbeFuer(d);
            return f.apply(d, arguments);
        };
    });
}

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
    if (d._farbWeg)
        return;                                             // das Desklet ist schon entfernt
    let akzent = AKZENTE[d.akzent] || (d.akzent === "eigen" && farbeLesen(d.akzentEigen)) || AKZENTE.gelb;
    let weiss = [255, 255, 255];
    let text = akzent;
    for (let i = 0; i < 14 && farbeHell(text) < 0.3; i++)
        text = farbeMischen(text, weiss, 0.12);
    let werte = {farbe: {akzent: akzent, auf: farbeHell(akzent) > 0.4 ? [35, 31, 32] : weiss, text: text,
                         grund: HINTERGRUENDE[d.hintergrund] || HINTERGRUENDE.grau}, tabelle: null, ziel: farben};

    // selbst gezeichnete Teile: was in der Tabelle gelb ist, bekommt den Akzent (Ziffern die aufgehellte
    // Schriftfarbe), was dunkel auf Gelb steht, die Schriftfarbe auf dem Akzent
    if (farben) {
        if (!farben._gelb)
            Object.defineProperty(farben, "_gelb", {value: JSON.parse(JSON.stringify(farben))});
        let gleich = (c, r, g, b) => Math.abs(c[0] * 255 - r) < 1 && Math.abs(c[1] * 255 - g) < 1 && Math.abs(c[2] * 255 - b) < 1;
        werte.tabelle = {};
        for (let k in farben._gelb) {
            let alt = farben._gelb[k];
            let neu = gleich(alt, 255, 203, 8) ? (/^ziffer/.test(k) ? text : akzent)
                : gleich(alt, 35, 31, 32) ? werte.farbe.auf : null;
            if (neu)
                werte.tabelle[k] = neu.map(v => v / 255).concat(alt.slice(3));
        }
    }
    d._farbWerte = werte;
    FARBE_VON = null;
    farbeFuer(d);

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
        farbeFuer(d);
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
        farbeFuer(d);
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
    if (FARBE_VON === d)
        FARBE_VON = null;
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

class KalenderblattDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        farbeHuelle(this);
        this.versatz = 0;               // Monate vor/zurück gegenüber heute
        this.timeout = 0;
        this.heuteTag = "";
        this.importiert = {fest: {}, jaehrlich: {}};
        this.importFehler = false;
        this.abo = {fest: {}, jaehrlich: {}};       // Einträge aus den Kalender-Abos
        this.aboFehler = false;
        this.aboNaechster = 0;
        this.mond = {};                             // "JJJJ-M" -> Mondphasen des Monats
        this.gesetzlich = {};           // Jahr -> {"JJJJ-MM-TT": Name}

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        for (let [key, name] of [["ansicht", "ansicht"], ["drei-lage", "dreiLage"], ["zeige-kw", "zeigeKw"],
                                 ["zeige-liste", "zeigeListe"], ["liste-max", "listeMax"],
                                 ["eigene", "eigene"]])
            this.settings.bind(key, name, this._zeichnen);
        this.settings.bind("wochenstart", "wochenstart", this._zeichnen);
        this.settings.bind("zeige-mond", "zeigeMond", this._zeichnen);
        this.settings.bind("zeige-abstand", "zeigeAbstand", this._zeichnen);
        this.settings.bind("abos", "abos", this._abosGeaendert);
        this.settings.bind("land", "land", this._landNeu);
        this.settings.bind("import-datei", "importDatei", this._importLesen);
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this.box = new St.BoxLayout({vertical: true, style_class: "kb-box", reactive: true});
        this.box.connect("scroll-event", (a, ereignis) => {
            let r = ereignis.get_scroll_direction();
            if (r === Clutter.ScrollDirection.UP)
                this._blaettern(-1);
            else if (r === Clutter.ScrollDirection.DOWN)
                this._blaettern(1);
            return Clutter.EVENT_STOP;
        });
        this.monate = new St.BoxLayout({style_class: "kb-monate"});
        this.liste = new St.BoxLayout({vertical: true, style_class: "kb-liste"});
        this.lStatus = new St.Label({style_class: "kb-status", visible: false});
        this.box.add_actor(this.monate);
        this.box.add_actor(this.liste);
        this.box.add_actor(this.lStatus);
        this.setContent(this.box);
        this.setHeader(_(metadata.name));

        this.menuHeute = new PopupMenu.PopupMenuItem("");
        this.menuHeute.connect("activate", () => this._blaettern(0));
        this._menu.addMenuItem(this.menuHeute);
        this.menuAbo = new PopupMenu.PopupMenuItem("");
        this.menuAbo.connect("activate", () => this._abosHolen());
        this._menu.addMenuItem(this.menuAbo);
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._importLesen();
        this._stil();
        // Abos: erst den letzten Stand aus dem Zwischenspeicher zeigen, dann frisch holen
        this._abosLesen().then(() => this._abosHolen());
        if (!this.timeout)
            this.timeout = Mainloop.timeout_add_seconds(60, () => {
                // um Mitternacht wandert die Markierung „heute“ weiter
                if (schluessel(new Date()) !== this.heuteTag)
                    this._zeichnen();
                if (GLib.get_monotonic_time() / 1e6 > this.aboNaechster)
                    this._abosHolen();
                return GLib.SOURCE_CONTINUE;
            });
    }

    on_desklet_removed() {
        farbeEntfernen(this);
        this.entfernt = true;
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
            this.timeout = 0;
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
        this._zeichnen();
    }

    // richtung 0 = zurück zum heutigen Monat
    _blaettern(richtung) {
        this.versatz = richtung === 0 ? 0 : this.versatz + richtung;
        this._zeichnen();
    }

    // ------------------------------------------------------------ Feiertage

    _landNeu() {
        this.gesetzlich = {};
        this._zeichnen();
    }

    _gesetzlicheFuer(jahr) {
        if (this.gesetzlich[jahr])
            return this.gesetzlich[jahr];
        let aus = {};
        let land = this.land || "NW";
        if (land !== "-") {
            let o = ostern(jahr);
            for (let f of FEIERTAGE) {
                if (f[2] !== "*" && (" " + f[2] + " ").indexOf(" " + land + " ") < 0)
                    continue;
                let d;
                if (typeof f[1] === "number") {
                    d = new Date(o.getFullYear(), o.getMonth(), o.getDate() + f[1]);
                } else if (f[1] === "bussbettag") {
                    d = new Date(jahr, 10, 22);                 // Mittwoch vor dem 23. November
                    while (d.getDay() !== 3)
                        d.setDate(d.getDate() - 1);
                } else {
                    let [m, t] = f[1].split("-").map(Number);
                    d = new Date(jahr, m - 1, t);
                }
                aus[schluessel(d)] = f[0];
            }
        }
        this.gesetzlich[jahr] = aus;
        return aus;
    }

    // eigene Tage aus den Einstellungen: "TT.MM." (jedes Jahr) oder "TT.MM.JJJJ"
    _eigeneTage() {
        let fest = {}, jaehrlich = {};
        for (let e of this.eigene || []) {
            let m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})?\s*$/.exec(String(e.datum || ""));
            let name = String(e.name || "").trim();
            if (!m || !name || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12)
                continue;
            let md = zwei(+m[2]) + "-" + zwei(+m[1]);
            if (m[3])
                (fest[m[3] + "-" + md] = fest[m[3] + "-" + md] || []).push(name);
            else
                (jaehrlich[md] = jaehrlich[md] || []).push(name);
        }
        return {fest: fest, jaehrlich: jaehrlich};
    }

    // iCalendar-Datei: ganztägige oder datierte Einträge als markierte Tage.
    // Gelesen wird im Hintergrund; ist die Datei da, wird neu gezeichnet.
    _importLesen() {
        let pfad = String(this.importDatei || "").trim();
        if (!pfad) {
            this.importiert = {fest: {}, jaehrlich: {}};
            this.importFehler = false;
            if (this.monate)
                this._zeichnen();
            return;
        }
        if (/^file:\/\//.test(pfad)) {
            try {
                pfad = GLib.filename_from_uri(pfad)[0];
            } catch (e) {
                pfad = "";
            }
        }
        let lauf = this.importLauf = (this.importLauf || 0) + 1;
        dateiLesen(pfad).then(text => {
            if (lauf !== this.importLauf || this.entfernt)
                return;                                 // inzwischen wurde eine andere Datei gewählt
            let neu = {fest: {}, jaehrlich: {}};
            let fehler = text === null;
            if (!fehler) {
                try {
                    this._icsAuswerten(text, neu);
                } catch (e) {
                    fehler = true;
                    global.logWarning("calendar-sheet@ersenender: Import: " + e);
                }
            }
            this.importiert = fehler ? {fest: {}, jaehrlich: {}} : neu;
            this.importFehler = fehler;
            this._zeichnen();
        });
    }

    // ---- Kalender-Abos: .ics-Adressen aus den Einstellungen, per curl in den Zwischenspeicher geholt

    // gültige Adressen (webcal:// ist dasselbe wie https://) mit ihrer Datei im Zwischenspeicher
    _aboListe() {
        let aus = [];
        for (let e of this.abos || []) {
            let url = String(e.url || "").trim().replace(/^webcal:\/\//i, "https://");
            if (/^https?:\/\/\S+$/i.test(url))
                aus.push({url: url, datei: GLib.build_filenamev([ABO_ORDNER,
                    "abo-" + GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1) + ".ics"])});
        }
        return aus;
    }

    _abosGeaendert() {
        this._abosLesen().then(() => this._abosHolen());
    }

    // alle Abos holen (nebenher); danach wird neu gelesen und gezeichnet
    _abosHolen() {
        this.aboNaechster = GLib.get_monotonic_time() / 1e6 + ABO_ALLE;
        let liste = this._aboListe();
        if (!liste.length || this.aboLaeuft)
            return;
        this.aboLaeuft = true;
        GLib.mkdir_with_parents(ABO_ORDNER, 0o755);
        Promise.all(liste.map(a => starten(["curl", "-s", "-f", "-L", "-m", "20", "--max-filesize", "5000000",
                                            "-A", "kalenderblatt-desklet/1.0", "-o", a.datei + ".neu", a.url])
            .then(aus => aus === null ? null
                : starten(["mv", "-f", a.datei + ".neu", a.datei])))).then(() => {
            this.aboLaeuft = false;
            if (!this.entfernt)
                this._abosLesen();
        });
    }

    // Zwischenspeicher der Abos lesen und auswerten -> Promise
    _abosLesen() {
        let liste = this._aboListe();
        return Promise.all(liste.map(a => dateiLesen(a.datei))).then(texte => {
            if (this.entfernt)
                return;
            let neu = {fest: {}, jaehrlich: {}};
            let fehler = false;
            for (let text of texte) {
                if (text === null) {
                    fehler = true;              // noch nie geholt oder nicht erreichbar
                    continue;
                }
                try {
                    this._icsAuswerten(text, neu);
                } catch (e) {
                    fehler = true;
                    global.logWarning("calendar-sheet@ersenender: Abo: " + e);
                }
            }
            this.abo = neu;
            this.aboFehler = fehler;
            this._zeichnen();
        });
    }

    // Einträge einer iCalendar-Quelle nach `ziele` ({fest, jaehrlich}): ganztägige und solche mit Uhrzeit
    // (die Uhrzeit steht dann vor dem Namen), mehrtägige und sich wiederholende
    _icsAuswerten(inhalt, ziele) {
        let text = inhalt.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");      // Zeilen entfalten
        let re = /BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g, block, n = 0;
        let heute = new Date();
        let von = new Date(heute.getFullYear() - 1, heute.getMonth(), 1);
        let bis = new Date(heute.getFullYear() + 2, heute.getMonth(), 1);
        let merken = (ziel, key, titel) => {
            let liste = ziel[key] = ziel[key] || [];
            if (liste.indexOf(titel) < 0)
                liste.push(titel);
        };
        while ((block = re.exec(text)) !== null && n < 5000) {
            n++;
            let b = block[1];
            let start = icsZeit(/^DTSTART([^:\n]*):(\S+)/m.exec(b));
            let ende = icsZeit(/^DTEND([^:\n]*):(\S+)/m.exec(b));
            let name = /^SUMMARY[^:\n]*:(.*)$/m.exec(b);
            if (!start || !name)
                continue;
            let titel = name[1].replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
            if (!titel)
                continue;
            if (start.zeit !== null)
                titel = start.zeit + " " + titel;
            // Dauer in Tagen: bei ganztägigen Einträgen ist das Ende der Tag danach
            let tage = 1;
            if (ende) {
                let letzter = new Date(ende.d.getFullYear(), ende.d.getMonth(), ende.d.getDate() - (ende.zeit === null ? 1 : 0));
                tage = Math.max(1, Math.min(62, Math.round((letzter - start.d) / 86400000) + 1));
            }
            let regel = {};
            let r = /^RRULE:(.*)$/m.exec(b);
            if (r)
                r[1].split(";").forEach(teil => {
                    let [k, v] = teil.split("=");
                    regel[k] = v;
                });
            // schlicht jährlich (Geburtstage, feste Feiertage): als Jahrestag merken – gilt dann für jedes Jahr
            let jaehrlich = regel.FREQ === "YEARLY" && !regel.UNTIL && !regel.COUNT && !regel.BYDAY
                && !regel.BYSETPOS && (parseInt(regel.INTERVAL) || 1) === 1;
            let termine = jaehrlich || !regel.FREQ ? [start.d] : wiederholungen(start.d, regel, von, bis);
            for (let t0 of termine) {
                for (let k = 0; k < tage; k++) {
                    let d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + k);
                    if (jaehrlich)
                        merken(ziele.jaehrlich, zwei(d.getMonth() + 1) + "-" + zwei(d.getDate()), titel);
                    else
                        merken(ziele.fest, schluessel(d), titel);
                }
            }
        }
    }

    // Was ist an diesem Tag? -> {feiertag: Name|null, eigen: [Namen]}
    _tagInfo(d, eigene) {
        let key = schluessel(d), md = key.slice(5);
        let eigen = [];
        for (let quelle of [eigene, this.importiert, this.abo]) {
            for (let n of (quelle.fest[key] || []).concat(quelle.jaehrlich[md] || [])) {
                if (eigen.indexOf(n) < 0)
                    eigen.push(n);
            }
        }
        eigen.sort((a, b) => /^\d\d:\d\d /.test(a) && /^\d\d:\d\d /.test(b) ? (a < b ? -1 : a > b ? 1 : 0) : 0);     // Uhrzeiten der Reihe nach
        return {feiertag: this._gesetzlicheFuer(d.getFullYear())[key] || null, eigen: eigen};
    }

    // ------------------------------------------------------------ Anzeige

    _pfeil(symbol, richtung) {
        let knopf = new St.Button({style_class: "kb-pfeil", reactive: true, can_focus: true,
                                   child: new St.Icon({icon_name: symbol, icon_type: St.IconType.SYMBOLIC,
                                                       icon_size: Math.round(14 * this.groesse)})});
        knopf.connect("clicked", () => this._blaettern(richtung));
        return knopf;
    }

    // Die Spaltenbreite hängt am Rahmen, nicht am Text: "em" rechnet mit der Schriftgröße des
    // jeweiligen Elements, die kleineren Kopf- und KW-Texte würden sonst schmalere Spalten bekommen.
    // hinweis: Text für den Tooltip (was an dem Tag eingetragen ist); er verschwindet mit der Zelle
    _zelle(text, klasse, hinweis) {
        let zelle = new St.Bin({style_class: "kb-spalte", x_fill: true, reactive: !!hinweis,
                                child: new St.Label({text: text, style_class: klasse})});
        if (hinweis)
            new Tooltips.Tooltip(zelle, hinweis);
        return zelle;
    }

    // ein Monatsblatt; pfeile: "beide" | "links" | "rechts" | "keine"
    _monatBauen(jahr, monat, heute, eigene, pfeile, eintraege) {
        let blatt = new St.BoxLayout({vertical: true});

        let kopf = new St.BoxLayout({style_class: "kb-kopf"});
        if (pfeile === "beide" || pfeile === "links")
            kopf.add(this._pfeil("go-previous-symbolic", -1));
        let istHeuteMonat = jahr === heute.getFullYear() && monat === heute.getMonth();
        let titel = new St.Button({label: MONATE[monat] + " " + jahr, reactive: true,
                                   style_class: istHeuteMonat || this.ansicht === "1" ? "kb-titel" : "kb-titel-neben",
                                   x_align: St.Align.START});
        titel.connect("clicked", () => this._blaettern(0));         // Klick auf den Monatsnamen: zurück zu heute
        kopf.add(titel, {expand: true, x_fill: false, x_align: St.Align.START});
        if (pfeile === "beide" || pfeile === "rechts")
            kopf.add(this._pfeil("go-next-symbolic", 1));
        blatt.add_actor(kopf);

        // Wochenbeginn: 0 = Montag, 6 = Sonntag (Stelle in der Liste WOCHENTAGE, die mit Montag anfängt)
        let anfang = this.wochenstart === "so" ? 6 : 0;
        let zeile = new St.BoxLayout();
        if (this.zeigeKw)
            zeile.add_actor(this._zelle(TEXTE.kw, "kb-zelle kb-wt"));
        for (let i = 0; i < 7; i++)
            zeile.add_actor(this._zelle(WOCHENTAGE[(i + anfang) % 7], "kb-zelle kb-wt"));
        blatt.add_actor(zeile);

        // Neu- und Vollmond dieses Monats (einmal je Monat berechnet)
        let mond = {};
        if (this.zeigeMond)
            mond = this.mond[jahr + "-" + monat] = this.mond[jahr + "-" + monat] || mondphasen(jahr, monat);

        // immer sechs Wochen: so bleibt die Karte beim Blättern gleich hoch
        let erster = new Date(jahr, monat, 1);
        let tag = new Date(jahr, monat, 1 - ((erster.getDay() + 6 - anfang + 7) % 7));
        let heuteKey = schluessel(heute);
        for (let w = 0; w < 6; w++) {
            zeile = new St.BoxLayout();
            if (this.zeigeKw)       // beginnt die Woche am Sonntag, zählt die Kalenderwoche des Montags darin
                zeile.add_actor(this._zelle(String(kalenderwoche(new Date(tag.getFullYear(), tag.getMonth(), tag.getDate() + (anfang ? 1 : 0)))),
                                            "kb-zelle kb-kw"));
            for (let t = 0; t < 7; t++) {
                let imMonat = tag.getMonth() === monat;
                let klasse = "kb-zelle", hinweis = "";
                if (!imMonat) {
                    klasse += " kb-fremd";
                } else {
                    let info = this._tagInfo(tag, eigene);
                    let phase = mond[schluessel(tag)];
                    let mondText = phase === "voll" ? TEXTE.vollmond : phase === "neu" ? TEXTE.neumond : "";
                    if (info.feiertag || info.eigen.length || mondText) {
                        let namen = (info.feiertag ? [info.feiertag] : []).concat(info.eigen);
                        if (namen.length)
                            eintraege.push({datum: new Date(tag), namen: namen, feiertag: !!info.feiertag});
                        hinweis = WOCHENTAGE[(t + anfang) % 7] + " " + tag.getDate() + "." + (tag.getMonth() + 1) + "." +
                                  tag.getFullYear() + "\n" + namen.concat(mondText ? [mondText] : []).join("\n");
                    }
                    if (phase)
                        klasse += phase === "voll" ? " kb-vollmond" : " kb-neumond";
                    if (schluessel(tag) === heuteKey)
                        klasse += " kb-heute";
                    else if (info.feiertag)
                        klasse += " kb-feiertag";
                    else if (info.eigen.length)
                        klasse += " kb-eigen";
                    else if ((t + anfang) % 7 >= 5)
                        klasse += " kb-we";
                }
                zeile.add_actor(this._zelle(String(tag.getDate()), klasse, hinweis));
                tag = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate() + 1);
            }
            blatt.add_actor(zeile);
        }
        return blatt;
    }

    _zeichnen() {
        let heute = new Date();
        this.heuteTag = schluessel(heute);
        this.menuHeute.label.set_text(TEXTE.heute);
        this.menuHeute.actor.visible = this.versatz !== 0;
        this.menuAbo.label.set_text(TEXTE.aboNeu);
        this.menuAbo.actor.visible = this._aboListe().length > 0;
        let eigene = this._eigeneTage();

        let drei = this.ansicht === "3q" || this.ansicht === "3h";
        let erster = this.versatz + (drei && this.dreiLage !== "anfang" ? -1 : 0);
        let anzahl = drei ? 3 : 1;

        this.monate.destroy_all_children();
        this.monate.vertical = this.ansicht === "3h";
        this.monate.set_style_class_name(this.ansicht === "3h" ? "kb-monate-hoch" : "kb-monate");
        let eintraege = [];
        for (let i = 0; i < anzahl; i++) {
            let m = new Date(heute.getFullYear(), heute.getMonth() + erster + i, 1);
            let pfeile = anzahl === 1 ? "beide"
                : this.ansicht === "3h" ? (i === 0 ? "beide" : "keine")
                : i === 0 ? "links" : i === anzahl - 1 ? "rechts" : "keine";
            this.monate.add_actor(this._monatBauen(m.getFullYear(), m.getMonth(), heute, eigene, pfeile, eintraege));
        }

        // Liste der Feiertage/eigenen Tage der angezeigten Monate; Vergangenes ausgegraut
        this.liste.destroy_all_children();
        this.liste.visible = this.zeigeListe && eintraege.length > 0;
        // Die Liste darf die Karte nicht breiter machen: Breite der Monatsblätter übernehmen, Namen kürzen
        let [, breite] = this.monate.get_preferred_width(-1);
        this.liste.set_width(breite > 0 ? breite : -1);
        if (this.liste.visible) {
            let max = Math.max(1, Math.round(this.listeMax));
            // Mehrtägiges (Ferien) zu einem Zeitraum zusammenziehen: gleiche Namen an aufeinanderfolgenden Tagen
            let gruppen = [];
            for (let e of eintraege) {
                let letzte = gruppen[gruppen.length - 1];
                let morgen = letzte ? new Date(letzte.bis.getFullYear(), letzte.bis.getMonth(), letzte.bis.getDate() + 1) : null;
                if (letzte && schluessel(morgen) === schluessel(e.datum) && letzte.namen.join("|") === e.namen.join("|"))
                    letzte.bis = e.datum;
                else
                    gruppen.push({datum: e.datum, bis: e.datum, namen: e.namen, feiertag: e.feiertag});
            }
            // zuerst das Kommende (auch Laufendes); ist danach noch Platz, das zuletzt Vergangene davor
            let kommend = gruppen.filter(e => schluessel(e.bis) >= this.heuteTag);
            let vorbei = gruppen.filter(e => schluessel(e.bis) < this.heuteTag);
            let zeigen = vorbei.slice(Math.max(0, vorbei.length - Math.max(0, max - kommend.length))).concat(kommend).slice(0, max);
            for (let e of zeigen) {
                let alt = schluessel(e.bis) < this.heuteTag;
                let zeile = new St.BoxLayout({style_class: "kb-eintrag"});
                let wt = WOCHENTAGE[(e.datum.getDay() + 6) % 7];
                let kurz = d => d.getDate() + "." + (d.getMonth() + 1) + ".";
                let wann = schluessel(e.datum) === schluessel(e.bis) ? wt + " " + kurz(e.datum)
                    : e.datum.getMonth() === e.bis.getMonth() ? e.datum.getDate() + ".–" + kurz(e.bis)
                    : kurz(e.datum) + "–" + kurz(e.bis);
                zeile.add(new St.Label({text: wann,
                                        style_class: "kb-eintrag-datum " + (alt ? "kb-vorbei" : e.feiertag ? "kb-feiertag" : "kb-eigen")}));
                let name = new St.Label({text: e.namen.join(" · "), style_class: "kb-eintrag-name" + (alt ? " kb-vorbei" : "")});
                name.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
                name.clutter_text.set_single_line_mode(true);
                zeile.add(name, {expand: true, x_fill: true});
                // Abstand bis zum Termin: heute, morgen, in n Tagen (Laufendes zählt als heute)
                if (this.zeigeAbstand && !alt) {
                    let mitternacht = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
                    let tage = Math.max(0, Math.round((e.datum - mitternacht) / 86400000));
                    zeile.add(new St.Label({text: tage === 0 ? TEXTE.heuteKurz : tage === 1 ? TEXTE.morgen : TEXTE.inTagen.format(tage),
                                            style_class: "kb-eintrag-abstand"}));
                }
                this.liste.add_actor(zeile);
            }
        }
        this.lStatus.set_text(this.importFehler ? TEXTE.importFehler : TEXTE.aboFehler);
        this.lStatus.visible = this.importFehler || this.aboFehler;
    }
}

function main(metadata, desklet_id) {
    return new KalenderblattDesklet(metadata, desklet_id);
}
