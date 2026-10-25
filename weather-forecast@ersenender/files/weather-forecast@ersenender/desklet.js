// Weather - Current weather and forecast for the next days (Open-Meteo) with place search
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Wetter-Desklet: aktuelles Wetter und Vorhersage von Open-Meteo – mit dem Verlauf der nächsten 24 Stunden
// (Temperatur als Kurve, Regenwahrscheinlichkeit als Balken), einem Hinweis, ab wann bzw. bis wann es regnet,
// UV-Index und Luftqualität. Einheiten wahlweise °C/km/h/mm oder °F/mph/inch.
// Die Daten holt helper.py in den Cache; hier wird nur gelesen und gezeichnet.
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Tooltips = imports.ui.tooltips;

const Gettext = imports.gettext;
const UUID = "weather-forecast@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), "weather-forecast@ersenender"]);
const ABRUF_ALLE = 30 * 60;         // Sekunden zwischen zwei Abrufen
const ABRUF_FEHLER = 5 * 60;
const TAKT = 60;
const VERALTET = 3 * 3600;          // älter -> „aktuell“ wird nicht mehr als aktuell gezeigt
const KOORD = /^-?\d{1,3}(\.\d{1,4})?$/;
const STUNDEN = 24;                 // so viele Stunden zeigt der Verlauf

// Farben des Stundenverlaufs (r, g, b, Deckkraft)
const FARBEN = {
    kurve: [255 / 255, 203 / 255, 8 / 255, 1],
    regen: [242 / 255, 239 / 255, 230 / 255, 0.2],       // Balken: Regenwahrscheinlichkeit
    regenNass: [242 / 255, 239 / 255, 230 / 255, 0.45],  // … in Stunden mit Niederschlag
    schrift: [242 / 255, 239 / 255, 230 / 255, 0.6],
    wert: [242 / 255, 239 / 255, 230 / 255, 0.95],
};

// WMO-Wettercode -> Symbol (nachts mit „-night“, wo es eins gibt) und Text
const LAGEN = [
    {codes: [0], symbol: "weather-clear", nacht: true, text: _("Clear")},
    {codes: [1], symbol: "weather-few-clouds", nacht: true, text: _("Mostly clear")},
    {codes: [2], symbol: "weather-few-clouds", nacht: true, text: _("Partly cloudy")},
    {codes: [3], symbol: "weather-overcast", text: _("Overcast")},
    {codes: [45, 48], symbol: "weather-fog", text: _("Fog")},
    {codes: [51, 53, 55], symbol: "weather-showers-scattered", text: _("Drizzle")},
    {codes: [56, 57, 66, 67], symbol: "weather-showers", text: _("Freezing rain")},
    {codes: [61], symbol: "weather-showers", text: _("Light rain")},
    {codes: [63], symbol: "weather-showers", text: _("Rain")},
    {codes: [65], symbol: "weather-showers", text: _("Heavy rain")},
    {codes: [71, 73, 75, 77], symbol: "weather-snow", text: _("Snow")},
    {codes: [80, 81], symbol: "weather-showers-scattered", text: _("Rain showers")},
    {codes: [82], symbol: "weather-showers", text: _("Heavy showers")},
    {codes: [85, 86], symbol: "weather-snow", text: _("Snow showers")},
    {codes: [95, 96, 99], symbol: "weather-storm", text: _("Thunderstorm")},
];

const TEXTE = {
    heute: _("Today"),
    morgen: _("Tomorrow"),
    gefuehlt: _("feels like %s"),
    wind: _("wind %s"),
    feuchte: _("%d%% humidity"),
    kmh: _("km/h"),
    richtungen: _("N,NE,E,SE,S,SW,W,NW"),
    boeen: _("gusts up to %s"),
    regenAb: _("Precipitation from %s"),
    regenBis: _("Precipitation until %s"),
    regenDurch: _("Precipitation all day"),
    trocken: _("Dry for 24 hours"),
    uv: _("UV up to %s (%s)"),
    uv0: _("low"),
    uv1: _("moderate"),
    uv2: _("high"),
    uv3: _("very high"),
    uv4: _("extreme"),
    luft: _("Air %s (AQI %d)"),
    aqi0: _("good"),
    aqi1: _("fair"),
    aqi2: _("moderate"),
    aqi3: _("poor"),
    aqi4: _("very poor"),
    aqi5: _("extremely poor"),
    feinstaub: _("Particulates PM2.5: %s · PM10: %s µg/m³"),
    tipStunden: _("The next %d hours:\ncurve = temperature, bars = chance of rain"),
    sonne: _("Sun %s – %s"),
    laden: _("Loading weather …"),
    fehler: _("No connection – will retry"),
    fehlerStand: _("No connection – as of %s"),
    quelle: _("Source: Open-Meteo · as of %s"),
    ort: _("Search place …"),
    neu: _("Refresh now"),
    keinOrt: _("No place chosen yet.\nRight-click → „Search place …“"),
    spanne: _("Low %s · High %s"),
    regen: _("Chance of rain %s"),
    menge: _("Precipitation %s"),
    windMax: _("Wind up to %s"),
    stand: _("As of %s"),
};

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

function tagName(dt) {
    return dt.format("%A");
}

function komma(zahl, stellen) {
    return zahl.toFixed(stellen).replace(".", DEZIMAL);
}

// Dezimalzeichen der Systemsprache
const DEZIMAL = (1.5).toLocaleString().replace(/[0-9]/g, "") || ".";

function lage(code) {
    for (let l of LAGEN) {
        if (l.codes.indexOf(code) >= 0)
            return l;
    }
    return {symbol: "weather-severe-alert", text: "–"};
}

function symbolName(code, nacht) {
    let l = lage(code);
    return l.symbol + (nacht && l.nacht ? "-night" : "") + "-symbolic";
}

function grad(wert) {
    if (typeof wert !== "number")
        return "–";
    let n = Math.round(wert);
    return (n < 0 ? "−" : "") + Math.abs(n) + "°";
}

function tagSchluessel(dt) {
    return dt.format("%Y-%m-%d");
}

// Prozentangabe, wie die Sprache sie schreibt: 10 % · 10% · %10
function prozentText(zahl) {
    // Translators: a percentage, %s is the number; e.g. "%s%%" -> 10%, "%s %%" -> 10 %, "%%%s" -> %10
    return _("%s%%").format(zahl);
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

class WetterDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.helper = GLib.build_filenamev([metadata.path, "helper.py"]);
        this.daten = null;
        this.fehler = false;
        this.abrufLaeuft = false;
        this.naechsterAbruf = 0;
        this.timeout = 0;

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        this.settings.bind("breite", "breite", this._ortGeaendert);
        this.settings.bind("laenge", "laenge", this._ortGeaendert);
        this.settings.bind("ort-name", "ortName", this._zeichnen);
        this.settings.bind("tage", "tage", this._zeichnen);
        this.settings.bind("zeige-details", "zeigeDetails", this._zeichnen);
        this.settings.bind("zeige-sonne", "zeigeSonne", this._zeichnen);
        this.settings.bind("zeige-stunden", "zeigeStunden", this._zeichnen);
        this.settings.bind("zeige-hinweis", "zeigeHinweis", this._zeichnen);
        this.settings.bind("zeige-luft", "zeigeLuft", this._neuHolen);
        this.settings.bind("einheit", "einheit", this._neuHolen);
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this._bauen();
        this.setHeader(_(metadata.name));

        this.menuOrt = new PopupMenu.PopupMenuItem("");
        this.menuOrt.connect("activate", () => this.ortWaehlen());
        this.menuNeu = new PopupMenu.PopupMenuItem("");
        this.menuNeu.connect("activate", () => this._abrufen(true));
        this._menu.addMenuItem(this.menuOrt);
        this._menu.addMenuItem(this.menuNeu);
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        this._zeichnen();
        this._cacheLesen().then(() => this._tick());
        if (!this.timeout)
            this.timeout = Mainloop.timeout_add_seconds(TAKT, () => this._tick());
    }

    on_desklet_removed() {
        farbeEntfernen(this);
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
            this.timeout = 0;
        }
    }

    // ------------------------------------------------------------ Aufbau

    _bauen() {
        this.box = new St.BoxLayout({vertical: true, style_class: "wt-box"});
        this.lOrt = new St.Label({style_class: "wt-ort"});
        this.lLage = new St.Label({style_class: "wt-lage"});
        this.lSonne = new St.Label({style_class: "wt-sonne"});
        this.box.add_actor(this.lOrt);
        this.box.add_actor(this.lLage);
        this.box.add_actor(this.lSonne);

        this.jetztBox = new St.BoxLayout({vertical: true, style_class: "wt-jetzt-box", reactive: true});
        this.tipJetzt = new Tooltips.Tooltip(this.jetztBox, "");
        this.tipJetztText = "";
        let mitte = new St.BoxLayout({style_class: "wt-jetzt", x_align: Clutter.ActorAlign.CENTER});
        this.iJetzt = new St.Icon({style_class: "wt-jetzt-symbol", icon_type: St.IconType.SYMBOLIC,
                                   y_align: Clutter.ActorAlign.CENTER});
        this.lTemp = new St.Label({style_class: "wt-temp"});
        mitte.add_actor(this.iJetzt);
        mitte.add_actor(this.lTemp);
        this.lDetails = new St.Label({style_class: "wt-details"});
        this.lLuft = new St.Label({style_class: "wt-details"});
        this.lAqi = new St.Label({style_class: "wt-details"});
        this.lHinweis = new St.Label({style_class: "wt-hinweis"});
        this.jetztBox.add_actor(mitte);
        this.jetztBox.add_actor(this.lDetails);
        this.jetztBox.add_actor(this.lLuft);
        this.jetztBox.add_actor(this.lAqi);
        this.jetztBox.add_actor(this.lHinweis);
        this.box.add_actor(this.jetztBox);

        // Verlauf der nächsten Stunden (Zeichenfläche ohne eigene Breite – sie füllt, was sie bekommt)
        this.stunden = new St.DrawingArea({style_class: "wt-stunden", reactive: true});
        this.stunden.connect("repaint", flaeche => this._stundenMalen(flaeche));
        this.tipStunden = new Tooltips.Tooltip(this.stunden, "");
        this.box.add(this.stunden, {x_fill: true});

        this.zeilenBox = new St.BoxLayout({vertical: true, style_class: "wt-zeilen"});
        this.box.add_actor(this.zeilenBox);

        this.lStatus = new St.Label({style_class: "wt-status"});
        this.box.add_actor(this.lStatus);
        this.setContent(this.box);
    }

    // Akzentfarbe und Kartengrund aus den Einstellungen anwenden (zeichnet danach alles neu)
    _farbe() {
        farbeAnwenden(this, typeof FARBEN === "undefined" ? null : FARBEN);
    }

    _stil() {
        let a = Math.max(0, Math.min(1, this.deckkraft));
        this.box.set_style("font-size: " + (10 * this.groesse).toFixed(1) + "pt; " +
                           "background-color: rgba(" + FARBE.grund.join(", ") + ", " + a.toFixed(2) + ");");
        this.stunden.set_height(Math.round(78 * this.groesse));
        this._zeichnen();           // Symbolgrößen hängen an der Größe
    }

    _t() {
        return TEXTE;
    }

    // ------------------------------------------------------------ Daten

    _ortGueltig() {
        return KOORD.test(String(this.breite)) && KOORD.test(String(this.laenge));
    }

    _cacheDatei() {
        return GLib.build_filenamev([CACHE_DIR, "wetter-" + this.breite + "_" + this.laenge + ".json"]);
    }

    // Zwischenspeicher im Hintergrund lesen -> Promise (ist sie erfüllt, steht this.daten)
    _cacheLesen() {
        if (!this._ortGueltig()) {
            this.daten = null;
            return Promise.resolve();
        }
        let datei = this._cacheDatei();
        return dateiLesen(datei).then(text => {
            if (datei !== this._cacheDatei())
                return;                         // Ort wurde währenddessen gewechselt
            this.daten = null;
            if (text !== null) {
                try {
                    this.daten = JSON.parse(text);
                } catch (e) {
                    // beschädigter Zwischenspeicher – wird beim nächsten Abruf ersetzt
                }
            }
        });
    }

    _abrufen(erzwingen) {
        let jetzt = GLib.get_monotonic_time() / 1e6;
        if (this.abrufLaeuft || !this._ortGueltig() || (!erzwingen && jetzt < this.naechsterAbruf))
            return;
        this.abrufLaeuft = true;
        let ort = this.breite + "_" + this.laenge;
        starten(["python3", this.helper, "fetch", String(this.breite), String(this.laenge),
                 this.einheit === "imperial" ? "imperial" : "metrisch", this.zeigeLuft ? "luft" : "ohne"]).then(aus => {
            this.abrufLaeuft = false;
            this.fehler = aus === null;
            this.naechsterAbruf = GLib.get_monotonic_time() / 1e6 + (this.fehler ? ABRUF_FEHLER : ABRUF_ALLE);
            if (ort === this.breite + "_" + this.laenge) {
                this._cacheLesen().then(() => this._zeichnen());
            } else {
                this.naechsterAbruf = 0;        // Ort wurde währenddessen gewechselt
                this._zeichnen();
            }
        });
    }

    // Einheiten oder Luftqualität umgestellt: gleich neu holen, der alte Stand bleibt bis dahin stehen
    _neuHolen() {
        this.naechsterAbruf = 0;
        this._tick();
    }

    _ortGeaendert() {
        this.naechsterAbruf = 0;
        this.fehler = false;
        this.daten = null;
        this._cacheLesen().then(() => this._tick());
    }

    // Aufruf aus dem Kontextmenü und über den Knopf in den Einstellungen
    ortWaehlen() {
        if (this.wahlLaeuft)
            return;
        this.wahlLaeuft = true;
        starten(["python3", this.helper, "choose"]).then(stdout => {
            this.wahlLaeuft = false;
            if (!stdout)
                return;
            try {
                let wahl = JSON.parse(stdout);
                if (wahl.name && KOORD.test(wahl.breite) && KOORD.test(wahl.laenge)) {
                    this.settings.setValue("ort-name", wahl.name);
                    this.settings.setValue("breite", wahl.breite);
                    this.settings.setValue("laenge", wahl.laenge);
                    this._ortGeaendert();
                }
            } catch (e) {
                global.logError("weather-forecast@ersenender: Ortswahl unlesbar: " + e);
            }
        });
    }

    // ------------------------------------------------------------ Anzeige

    _tick() {
        this._abrufen(false);
        this._zeichnen();
        return GLib.SOURCE_CONTINUE;
    }

    _uhrzeit(iso) {
        let m = /T(\d{2}:\d{2})/.exec(iso || "");
        return m ? m[1] : "–";
    }

    // Windgeschwindigkeit mit Einheit, wie die Daten sie liefern (km/h oder mph)
    _windText(wert) {
        let einheit = this.daten && this.daten.current_units && this.daten.current_units.wind_speed_10m;
        return Math.round(wert) + " " + (einheit === "mp/h" ? "mph" : this._t().kmh);
    }

    // Niederschlagsmenge mit Einheit (mm oder inch)
    _mengeText(wert) {
        let zoll = this.daten && this.daten.daily_units && this.daten.daily_units.precipitation_sum === "inch";
        return komma(wert, zoll ? 2 : 1) + (zoll ? " in" : " mm");
    }

    // „UV bis 3 (mäßig)“ – die Stufe richtet sich nach dem gerundeten Wert, der auch dasteht
    _uvText(wert) {
        if (typeof wert !== "number")
            return "";
        let T = this._t(), uv = Math.round(wert);
        return T.uv.format(uv, T["uv" + (uv >= 11 ? 4 : uv >= 8 ? 3 : uv >= 6 ? 2 : uv >= 3 ? 1 : 0)]);
    }

    // Himmelsrichtung, aus der der Wind kommt (acht Richtungen)
    _richtung(winkel) {
        return typeof winkel === "number" ? this._t().richtungen.split(",")[Math.round(winkel / 45) % 8] : "";
    }

    // Stelle der laufenden Stunde in den Stundenwerten (der Zwischenspeicher kann etwas älter sein)
    _stundeJetzt() {
        let h = this.daten && this.daten.hourly;
        if (!h || !h.time || !h.time.length)
            return -1;
        let start = Date.parse(h.time[0] + ":00Z") / 1000 - (this.daten.utc_offset_seconds || 0);
        let i = Math.floor((GLib.DateTime.new_now_local().to_unix() - start) / 3600);
        return i >= 0 && i < h.time.length ? i : -1;
    }

    // „Niederschlag ab 15:00“ · „Niederschlag bis morgen 03:00“ · „24 Stunden trocken“
    _regenHinweis() {
        let T = this._t();
        let h = this.daten.hourly, i0 = this._stundeJetzt();
        if (i0 < 0 || !h.precipitation)
            return "";
        let zoll = this.daten.daily_units && this.daten.daily_units.precipitation_sum === "inch";
        let nass = i => (h.precipitation[i] || 0) >= (zoll ? 0.004 : 0.1)
            && (typeof h.precipitation_probability[i] !== "number" || h.precipitation_probability[i] >= 30);
        let ende = Math.min(i0 + STUNDEN, h.time.length);
        let uhr = i => (h.time[i].slice(0, 10) !== h.time[i0].slice(0, 10) ? T.morgen.toLowerCase() + " " : "") + h.time[i].slice(11, 16);
        let jetztNass = nass(i0);
        for (let i = i0 + 1; i < ende; i++) {
            if (nass(i) !== jetztNass)
                return (jetztNass ? T.regenBis : T.regenAb).format(uhr(i));
        }
        return jetztNass ? T.regenDurch : T.trocken;
    }

    // Verlauf: Temperatur als Kurve, Regenwahrscheinlichkeit als Balken, darunter die Uhrzeiten
    _stundenMalen(flaeche) {
        let cr = flaeche.get_context();
        let [w, h] = flaeche.get_surface_size();
        let d = this.daten && this.daten.hourly, i0 = this._stundeJetzt();
        if (!d || i0 < 0) {
            cr.$dispose();
            return;
        }
        let n = Math.min(STUNDEN, d.time.length - i0);
        let temps = d.temperature_2m.slice(i0, i0 + n);
        let farbe = f => cr.setSourceRGBA(f[0], f[1], f[2], f[3]);
        let schrift = Pango.FontDescription.from_string("Ubuntu");
        schrift.set_absolute_size(Math.max(7, h * 0.135) * Pango.SCALE);
        let text = (s, x, y, f, wo) => {            // wo: 0 = mittig über y, 1 = mittig unter y
            let layout = PangoCairo.create_layout(cr);
            layout.set_font_description(schrift);
            layout.set_text(s, -1);
            let [, l] = layout.get_pixel_extents();
            farbe(f);
            cr.moveTo(Math.max(1, Math.min(w - l.width - 1, x - l.width / 2)) - l.x, wo ? y : y - l.height);
            PangoCairo.show_layout(cr, layout);
        };
        let rand = w * 0.04, oben = h * 0.24, unten = h * 0.78;
        let schritt = n > 1 ? (w - 2 * rand) / (n - 1) : 0;
        let min = Math.min.apply(null, temps), max = Math.max.apply(null, temps);
        let spanne = Math.max(1, max - min);
        let x = i => rand + i * schritt;
        let y = v => unten - (unten - oben) * (v - min) / spanne;

        // Regenwahrscheinlichkeit: Balken von unten, höchstens bis zur halben Höhe der Fläche
        for (let i = 0; i < n; i++) {
            let p = d.precipitation_probability[i0 + i];
            if (typeof p !== "number" || p < 5)
                continue;
            let hoehe = (unten - h * 0.3) * p / 100;
            farbe((d.precipitation[i0 + i] || 0) > 0 ? FARBEN.regenNass : FARBEN.regen);
            cr.rectangle(x(i) - schritt * 0.36, unten - hoehe, Math.max(1.5, schritt * 0.72), hoehe);
            cr.fill();
        }
        // Temperatur
        temps.forEach((v, i) => i ? cr.lineTo(x(i), y(v)) : cr.moveTo(x(i), y(v)));
        farbe(FARBEN.kurve);
        cr.setLineWidth(Math.max(1.5, h * 0.025));
        cr.setLineJoin(1);
        cr.setLineCap(1);
        cr.stroke();
        // höchster und tiefster Wert an der Kurve
        let iMax = temps.indexOf(max), iMin = temps.indexOf(min);
        text(grad(max), x(iMax), y(max) - 2, FARBEN.wert, 0);
        if (iMin !== iMax)
            text(grad(min), x(iMin), y(min) - 2, FARBEN.wert, 0);
        // Uhrzeiten: die laufende Stunde und danach alle sechs Stunden (nicht direkt neben der ersten)
        for (let i = 0; i < n; i++) {
            let stunde = parseInt(d.time[i0 + i].slice(11, 13));
            if (i === 0 || (stunde % 6 === 0 && i >= 3))
                text(String(stunde), x(i), h * 0.82, FARBEN.schrift, 1);
        }
        cr.$dispose();
    }

    _zeichnen() {
        let T = this._t();
        let jetzt = GLib.DateTime.new_now_local();
        let px = n => Math.round(n * this.groesse);

        this.menuOrt.label.set_text(T.ort);
        this.menuNeu.label.set_text(T.neu);
        this.lOrt.set_text(this.ortName || "");
        this.lStatus.set_style_class_name("wt-status" + (this.fehler ? " wt-fehler" : ""));
        this.zeilenBox.destroy_all_children();

        // Vorhersage ab heute; ein Cache von gestern beginnt einen Tag früher
        let d = this.daten && this.daten.daily;
        let start = d ? d.time.indexOf(tagSchluessel(jetzt)) : -1;
        if (start < 0) {
            this.lLage.hide();
            this.lSonne.hide();
            this.jetztBox.hide();
            this.stunden.hide();
            this.zeilenBox.hide();
            this.lStatus.set_text(!this._ortGueltig() ? T.keinOrt : this.fehler ? T.fehler : T.laden);
            return;
        }

        let stand = GLib.DateTime.new_from_unix_local(this.daten.stand || 0);
        let standText = stand.format(tagSchluessel(stand) === tagSchluessel(jetzt) ? "%H:%M" : "%-d.%-m. %H:%M");
        let frisch = jetzt.to_unix() - (this.daten.stand || 0) < VERALTET;
        let c = this.daten.current;

        // Kopf: aktuelle Lage (veraltet: die Tageslage), darunter die Sonnenzeiten
        let code = frisch ? c.weather_code : d.weather_code[start];
        this.lLage.set_text(lage(code).text);
        this.lLage.show();
        this.lSonne.set_text(T.sonne.format(this._uhrzeit(d.sunrise[start]), this._uhrzeit(d.sunset[start])));
        this.lSonne.visible = this.zeigeSonne;

        if (frisch) {
            this.iJetzt.set_icon_name(symbolName(c.weather_code, !c.is_day));
            this.iJetzt.set_icon_size(px(40));
            this.lTemp.set_text(grad(c.temperature_2m));
            let wind = T.wind.format((this._windText(c.wind_speed_10m) + " " + this._richtung(c.wind_direction_10m)).trim());
            this.lDetails.set_text([T.gefuehlt.format(grad(c.apparent_temperature)),
                                    T.feuchte.format(Math.round(c.relative_humidity_2m))].join(" · "));
            this.lDetails.visible = this.zeigeDetails;

            // UV-Index (höchster Wert des Tages) und Luftqualität (europäischer Index)
            let luft = this.daten.luft;
            let zusatz = [];
            let uvText = this._uvText(d.uv_index_max && d.uv_index_max[start]);
            if (uvText)
                zusatz.push(uvText);
            if (luft && typeof luft.european_aqi === "number")
                zusatz.push(T.luft.format(T["aqi" + Math.min(5, Math.floor(luft.european_aqi / 20))], Math.round(luft.european_aqi)));
            // zweite Zeile: Wind und UV, dritte: Luftqualität – je nachdem, was eingeschaltet ist
            let zeile2 = (this.zeigeDetails ? [wind] : []).concat(this.zeigeLuft && uvText ? [uvText] : []);
            this.lLuft.set_text(zeile2.join(" · "));
            this.lLuft.visible = zeile2.length > 0;
            this.lAqi.set_text(zusatz.length > (uvText ? 1 : 0) ? zusatz[zusatz.length - 1] : "");
            this.lAqi.visible = this.zeigeLuft && !!this.lAqi.get_text();

            // Hinweis, ab wann bzw. bis wann es regnet
            let hinweis = this.daten.hourly ? this._regenHinweis() : "";
            this.lHinweis.set_text(hinweis);
            this.lHinweis.visible = this.zeigeHinweis && !!hinweis;

            // Tooltip: alle aktuellen Werte, auch wenn die Detailzeilen ausgeblendet sind
            let tip = [lage(c.weather_code).text + " · " + grad(c.temperature_2m),
                       T.gefuehlt.format(grad(c.apparent_temperature)), wind,
                       typeof c.wind_gusts_10m === "number" ? T.boeen.format(this._windText(c.wind_gusts_10m)) : "",
                       T.feuchte.format(Math.round(c.relative_humidity_2m))].concat(zusatz).concat([
                       luft && typeof luft.pm2_5 === "number" && typeof luft.pm10 === "number"
                           ? T.feinstaub.format(komma(luft.pm2_5, 1), komma(luft.pm10, 1)) : "",
                       hinweis,
                       T.sonne.format(this._uhrzeit(d.sunrise[start]), this._uhrzeit(d.sunset[start])),
                       T.stand.format(standText)]).filter(s => s).join("\n");
            if (tip !== this.tipJetztText) {
                this.tipJetztText = tip;
                this.tipJetzt.set_text(tip);
            }
            this.jetztBox.show();
        } else {
            this.jetztBox.hide();
        }

        // Stundenverlauf: nur mit Stundenwerten und solange der Stand frisch ist
        this.stunden.visible = this.zeigeStunden && frisch && this._stundeJetzt() >= 0;
        if (this.stunden.visible) {
            this.tipStunden.set_text(T.tipStunden.format(STUNDEN));
            this.stunden.queue_repaint();
        }

        let anzahl = Math.max(0, Math.min(this.tage, d.time.length - start));
        for (let i = 0; i < anzahl; i++) {
            let k = start + i;
            let tagDatum = jetzt.add_days(i);
            let name = i === 0 ? T.heute : i === 1 ? T.morgen : tagName(tagDatum);
            let zeile = new St.BoxLayout({style_class: "wt-zeile" + (i === 0 ? " wt-aktiv" : ""), reactive: true});
            let regen = d.precipitation_probability_max[k];
            // Tooltip: der ganze Tag in Worten; Menge und Wind fehlen in älteren Zwischenspeichern
            let tip = [tagName(tagDatum) + ", " + tagDatum.format("%-d.%-m.%Y"),
                       lage(d.weather_code[k]).text,
                       T.spanne.format(grad(d.temperature_2m_min[k]), grad(d.temperature_2m_max[k]))];
            if (typeof regen === "number")
                tip.push(T.regen.format(prozentText(regen)));
            let menge = d.precipitation_sum && d.precipitation_sum[k];
            if (typeof menge === "number" && menge > 0)
                tip.push(T.menge.format(this._mengeText(menge)));
            let windMax = d.wind_speed_10m_max && d.wind_speed_10m_max[k];
            if (typeof windMax === "number")
                tip.push(T.windMax.format(this._windText(windMax)));
            let uvTag = this._uvText(d.uv_index_max && d.uv_index_max[k]);
            if (uvTag)
                tip.push(uvTag);
            tip.push(T.sonne.format(this._uhrzeit(d.sunrise[k]), this._uhrzeit(d.sunset[k])));
            new Tooltips.Tooltip(zeile, tip.join("\n"));
            zeile.add(new St.Label({text: name, style_class: "wt-zeile-tag"}), {expand: true, x_fill: true});
            zeile.add(new St.Label({text: typeof regen === "number" && regen >= 10 ? prozentText(regen) : "",
                                    style_class: "wt-zeile-regen", y_align: Clutter.ActorAlign.CENTER}));
            zeile.add(new St.Icon({icon_name: symbolName(d.weather_code[k], false), icon_size: px(16),
                                   icon_type: St.IconType.SYMBOLIC, y_align: Clutter.ActorAlign.CENTER}));
            zeile.add(new St.Label({text: grad(d.temperature_2m_min[k]), style_class: "wt-zeile-min"}));
            zeile.add(new St.Label({text: grad(d.temperature_2m_max[k]), style_class: "wt-zeile-max"}));
            this.zeilenBox.add_actor(zeile);
        }
        this.zeilenBox.visible = anzahl > 0;

        this.lStatus.set_text((this.fehler ? T.fehlerStand : T.quelle).format(standText));
    }
}

function main(metadata, desklet_id) {
    return new WetterDesklet(metadata, desklet_id);
}
