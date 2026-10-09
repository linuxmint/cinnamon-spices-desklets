// World Time - Two to eight analog clocks side by side, each with its own city
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Weltzeit-Desklet: zwei bis acht Analoguhren nebeneinander, jede mit eigener Stadt – darunter eine
// Zeitleiste der nächsten 24 Stunden je Ort (Arbeitszeit, wach, Nacht), die zeigt, wann man überall jemanden
// erreicht. Mit dem Mausrad lässt sich die Zeit verschieben („wie spät ist es dort, wenn es hier 18 Uhr ist?“).
// Ändert sich ein Zeitunterschied demnächst (Sommer-/Winterzeit), steht das unter der Uhr.
// Die Städteliste steht in staedte.json (daraus baut schema-bauen.py auch die Auswahlfelder).
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
const Tooltips = imports.ui.tooltips;

const Gettext = imports.gettext;
const UUID = "world-clock@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const MAX_UHREN = 8;
const SCHRITT = 30;                 // Minuten je Raste des Mausrads beim Verschieben der Zeit
const VERSATZ_MAX = 24 * 60;        // weiter als die Zeitleiste reicht, lässt sich nicht verschieben
const ZURUECK_NACH = 120;           // Sekunden ohne Mausrad, dann springt die Anzeige zurück auf jetzt
const WECHSEL_TAGE = 30;            // so weit voraus wird nach einer Zeitumstellung gesucht

// Pardus-Farben fürs Zifferblatt (r, g, b, Deckkraft)
const FARBEN = {
    tag: [242 / 255, 239 / 255, 230 / 255, 0.13],       // Blatt, wenn es dort Tag ist (6–18 Uhr)
    nacht: [0, 0, 0, 0.30],
    rand: [255 / 255, 203 / 255, 8 / 255, 0.45],
    randHier: [255 / 255, 203 / 255, 8 / 255, 1],        // Uhr mit der Ortszeit dieses Rechners
    strich: [242 / 255, 239 / 255, 230 / 255, 0.45],
    strichViertel: [255 / 255, 203 / 255, 8 / 255, 1],
    ziffer: [242 / 255, 239 / 255, 230 / 255, 0.85],
    zifferViertel: [255 / 255, 203 / 255, 8 / 255, 1],  // 12, 3, 6, 9
    zeiger: [242 / 255, 239 / 255, 230 / 255, 1],
    sekunde: [255 / 255, 203 / 255, 8 / 255, 1],
    // Zeitleiste
    arbeit: [255 / 255, 203 / 255, 8 / 255, 0.85],       // 9–17 Uhr dort
    wach: [242 / 255, 239 / 255, 230 / 255, 0.32],       // 7–22 Uhr dort
    schlaf: [242 / 255, 239 / 255, 230 / 255, 0.07],
    alle: [255 / 255, 203 / 255, 8 / 255, 1],            // Stunden, in denen überall Tag ist
    marke: [242 / 255, 239 / 255, 230 / 255, 1],
    schrift: [242 / 255, 239 / 255, 230 / 255, 0.6],
    name: [242 / 255, 239 / 255, 230 / 255, 0.9],
};

// Beschriftung der Stunden 1–12 je Zifferblatt-Art (fehlt die Art -> Striche)
const ZIFFERN = {
    ziffern: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    ostarabisch: ["١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩", "١٠", "١١", "١٢"],
    roemisch: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"],
};

const TEXTE = {
    titel: _("World time"),
    ortszeit: _("Local time"),
    morgen: _("tomorrow"),
    gestern: _("yesterday"),
    std: _("%s h"),
    verschoben: _("in %s h"),
    zurueck: _("Back to now"),
    kurzDatum: _("%-d/%-m"),
    wechsel: _("%s: %s"),
    tipWechsel: _("From %s the time difference is %s"),
    tipUmstellung: _("Clock change on %s"),
    tipLeiste: _("The next 24 hours per place: strong = working hours (9-17), light = awake (7-22), dark = night.\nLine on top: hours when it is daytime everywhere.\nMouse wheel: shift the time in 30-minute steps."),
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

function zwei(n) {
    return (n < 10 ? "0" : "") + n;
}

// Uhrzeit „07:30“ bzw. im 12-Stunden-Format „7:30 AM“
function zeitText(dt, zwoelf) {
    let std = dt.get_hour(), min = dt.get_minute();
    if (!zwoelf)
        return zwei(std) + ":" + zwei(min);
    return (std % 12 || 12) + ":" + zwei(min) + (std < 12 ? " AM" : " PM");
}

function tagNr(dt) {
    return dt.get_year() * 10000 + dt.get_month() * 100 + dt.get_day_of_month();
}

// Datum in der Sprache des Systems; die Reihenfolge der Teile gibt die Übersetzung vor
function datumText(dt, mitJahr) {
    // Translators: date format for GLib.DateTime.format(), e.g. "6 October 2026" (%-d = day, %B = month, %Y = year)
    return dt.format(mitJahr ? _("%-d %B %Y") : _("%-d %B"));
}

function tagName(dt) {
    return dt.format("%A");
}

function datumLang(dt, mitJahr) {
    // Translators: date format with weekday for GLib.DateTime.format(), e.g. "Tuesday, 6 October 2026"
    return dt.format(mitJahr ? _("%A, %-d %B %Y") : _("%A, %-d %B"));
}

// Dezimalzeichen der Systemsprache
const DEZIMAL = (1.5).toLocaleString().replace(/[0-9]/g, "") || ".";

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

class WeltzeitDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.timeout = 0;
        this.letzteMinute = -1;
        this.versatz = 0;               // Minuten, um die die Anzeige mit dem Mausrad verschoben ist
        this.versatzZeit = 0;
        this.leisteStand = null;        // Zellen der Zeitleiste, je Stunde einmal berechnet

        // Zeitzone -> {de, tr}; die Liste wird im Hintergrund gelesen, danach baut sich das Desklet neu auf
        this.staedte = {};
        this.staedteDatei = GLib.build_filenamev([metadata.path, "staedte.json"]);

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        this.settings.bind("anzahl", "anzahl", this._neuAufbauen);
        for (let n = 1; n <= MAX_UHREN; n++) {
            this.settings.bind("uhr" + n, "uhr" + n, this._neuAufbauen);
            this.settings.bind("name" + n, "name" + n, this._neuAufbauen);
        }
        this.settings.bind("zeige-leiste", "zeigeLeiste", this._neuAufbauen);
        this.settings.bind("zeige-wechsel", "zeigeWechsel", this._neuAufbauen);
        this.settings.bind("format12", "format12", this._zeichnen);
        this.settings.bind("zeige-digital", "zeigeDigital", this._neuAufbauen);
        this.settings.bind("zeige-abstand", "zeigeAbstand", this._neuAufbauen);
        this.settings.bind("zeige-kopf", "zeigeKopf", this._neuAufbauen);
        this.settings.bind("uhr-groesse", "uhrGroesse", this._neuAufbauen);
        this.settings.bind("sekunden", "sekunden", this._zeichnen);
        this.settings.bind("zifferblatt", "zifferblatt", this._zeichnen);
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this.box = new St.BoxLayout({vertical: true, style_class: "wz-box", reactive: true});
        // Mausrad über dem Desklet verschiebt die Zeit
        this.box.connect("scroll-event", (a, ereignis) => {
            let r = ereignis.get_scroll_direction();
            if (r === Clutter.ScrollDirection.UP)
                this._verschieben(SCHRITT);
            else if (r === Clutter.ScrollDirection.DOWN)
                this._verschieben(-SCHRITT);
            return Clutter.EVENT_STOP;
        });
        this.lKopf = new St.Label({style_class: "wz-kopf"});
        this.lDatum = new St.Label({style_class: "wz-datum"});
        this.reihe = new St.BoxLayout({style_class: "wz-uhren"});
        // Zeitleiste (Zeichenfläche ohne eigene Breite – sie füllt, was die Uhrenreihe vorgibt)
        this.leiste = new St.DrawingArea({style_class: "wz-leiste", reactive: true});
        this.leiste.connect("repaint", flaeche => this._leisteMalen(flaeche));
        this.lZurueck = new St.Label({style_class: "wz-zurueck-text"});
        this.zurueck = new St.Button({child: this.lZurueck, style_class: "wz-zurueck", reactive: true,
                                      x_align: St.Align.MIDDLE, visible: false});
        this.zurueck.connect("clicked", () => this._verschieben(0));
        this.box.add_actor(this.lKopf);
        this.box.add_actor(this.lDatum);
        this.box.add_actor(this.reihe);
        this.box.add(this.leiste, {x_fill: true});
        this.box.add_actor(this.zurueck);
        this.setContent(this.box);
        this.setHeader(_(metadata.name));
        this.uhren = [];
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        this._neuAufbauen();
        dateiLesen(this.staedteDatei).then(text => {
            try {
                for (let [tz, name] of JSON.parse(text))
                    this.staedte[tz] = name;         // englisch; übersetzt wird beim Anzeigen
            } catch (e) {
                global.logError("world-clock@ersenender: staedte.json unlesbar: " + e);
            }
            if (!this.entfernt)
                this._neuAufbauen();
        });
        if (!this.timeout)
            this.timeout = Mainloop.timeout_add_seconds(1, () => this._tick());
    }

    on_desklet_removed() {
        farbeEntfernen(this);
        this.entfernt = true;
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
            this.timeout = 0;
        }
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
    }

    _t() {
        return TEXTE;
    }

    // ------------------------------------------------------------ Zeit verschieben

    // die angezeigte Zeit: jetzt, um den Versatz des Mausrads verschoben
    _jetzt() {
        let jetzt = GLib.DateTime.new_now_local();
        return this.versatz ? jetzt.add_minutes(this.versatz) : jetzt;
    }

    // schritt in Minuten; 0 = zurück auf jetzt
    _verschieben(schritt) {
        this.versatz = schritt ? Math.max(0, Math.min(VERSATZ_MAX, this.versatz + schritt)) : 0;
        this.versatzZeit = GLib.get_monotonic_time() / 1e6;
        this._zeichnen();
    }

    // Abstand in Stunden als Text: 3 -> „+3“, -5.5 -> „−5,5“
    _stdText(std) {
        let betrag = Math.abs(std);
        return (std > 0 ? "+" : std < 0 ? "−" : "±") + (Number.isInteger(betrag) ? String(betrag) : betrag.toFixed(1).replace(".", DEZIMAL));
    }

    // Ändert sich der Zeitunterschied eines Ortes zur Ortszeit in den nächsten Wochen (Sommer-/Winterzeit)?
    // -> {tag: GLib.DateTime, std: neuer Unterschied, hier: die eigene Zeit stellt um} oder null
    _wechselSuchen(tz) {
        let hierTz = GLib.TimeZone.new_local();
        let jetzt = GLib.DateTime.new_now_utc();
        let versatz = (zone, zeit) => zeit.to_timezone(zone).get_utc_offset();
        let unterschied = zeit => versatz(tz, zeit) - versatz(hierTz, zeit);
        let u0 = unterschied(jetzt), h0 = versatz(hierTz, jetzt);
        for (let tag = 1; tag <= WECHSEL_TAGE; tag++) {
            let zeit = jetzt.add_days(tag);
            let u = unterschied(zeit);
            if (u !== u0)
                return {tag: zeit.to_timezone(hierTz), std: u / 3.6e9, hier: false};
            // die eigene Zeit stellt um: std = um wie viele Stunden die Uhr vor- bzw. zurückgeht
            if (u0 === 0 && versatz(hierTz, zeit) !== h0)
                return {tag: zeit.to_timezone(hierTz), std: (versatz(hierTz, zeit) - h0) / 3.6e9, hier: true};
        }
        return null;
    }

    // ------------------------------------------------------------ Aufbau

    _neuAufbauen() {
        let T = this._t();
        let px = Math.round(this.uhrGroesse);
        let anzahl = Math.max(2, Math.min(MAX_UHREN, Math.round(this.anzahl)));
        let hierVersatz = GLib.DateTime.new_now_local().get_utc_offset();

        this.reihe.destroy_all_children();
        this.uhren = [];
        for (let n = 1; n <= anzahl; n++) {
            let wahl = this["uhr" + n];
            let lokal = wahl === "lokal" || !this.staedte[wahl];
            let tz = lokal ? GLib.TimeZone.new_local() : GLib.TimeZone.new(wahl);
            let u = {tz: tz, name: lokal ? T.ortszeit : _(this.staedte[wahl])};
            // eigene Bezeichnung statt des Ortsnamens („Oma“, „Büro“)
            let eigen = String(this["name" + n] || "").trim();
            if (eigen)
                u.name = eigen;
            u.hier = GLib.DateTime.new_now(tz).get_utc_offset() === hierVersatz;
            u.wechsel = this.zeigeWechsel ? this._wechselSuchen(tz) : null;

            // Spalte so breit wie die Uhr; ein langer Name wird gekürzt statt die Reihe zu verschieben
            let spalte = new St.BoxLayout({vertical: true, style: "width: " + px + "px;"});
            u.blatt = new St.DrawingArea({width: px, height: px});
            u.blatt.connect("repaint", area => this._blattMalen(area, u));
            u.lStadt = new St.Label({text: u.name, style_class: "wz-stadt" + (u.hier ? " wz-stadt-hier" : "")});
            u.lStadt.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            u.lDigital = new St.Label({style_class: "wz-digital", visible: this.zeigeDigital});
            u.lAbstand = new St.Label({style_class: "wz-abstand", visible: this.zeigeAbstand});
            u.lWechsel = new St.Label({style_class: "wz-wechsel", visible: false});
            u.lWechsel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            u.spalte = spalte;
            spalte.add_actor(u.blatt);
            spalte.add_actor(u.lStadt);
            spalte.add_actor(u.lDigital);
            spalte.add_actor(u.lAbstand);
            spalte.add_actor(u.lWechsel);
            this.reihe.add_actor(spalte);
            this.uhren.push(u);
        }

        this.lKopf.set_text(T.titel);
        this.lKopf.visible = this.lDatum.visible = this.zeigeKopf;
        this.reihe.set_style_class_name("wz-uhren" + (this.zeigeKopf ? "" : " wz-uhren-ohne-kopf"));
        // Zeitleiste: eine Zeile je Uhr, darunter die Stundenskala
        this.leisteStand = null;
        this.leiste.visible = this.zeigeLeiste;
        this.leiste.set_height(Math.round((this.uhren.length * 15 + 26) * this.groesse));
        this._tip(this.leiste, T.tipLeiste);
        this.lZurueck.set_text(T.zurueck);
        this._zeichnen();
    }

    // ------------------------------------------------------------ Anzeige

    _tick() {
        // verschobene Anzeige springt von selbst zurück, wenn das Mausrad eine Weile ruht
        if (this.versatz && GLib.get_monotonic_time() / 1e6 - this.versatzZeit > ZURUECK_NACH)
            this.versatz = 0;
        let minute = GLib.DateTime.new_now_local().get_minute();
        if (this.sekunden || minute !== this.letzteMinute)
            this._zeichnen();
        return GLib.SOURCE_CONTINUE;
    }

    _zeichnen() {
        let T = this._t();
        let hier = this._jetzt();
        this.letzteMinute = GLib.DateTime.new_now_local().get_minute();
        // verschoben: davor steht, wie weit („in 3:30 Std.“)
        let voraus = this.versatz ? T.verschoben.format(Math.floor(this.versatz / 60) + ":" + zwei(this.versatz % 60)) + " · " : "";
        this.lDatum.set_text(voraus + datumLang(hier, true));
        this.zurueck.visible = this.versatz !== 0;
        if (this.zeigeLeiste)
            this.leiste.queue_repaint();

        for (let u of this.uhren) {
            u.jetzt = hier.to_timezone(u.tz);
            u.blatt.queue_repaint();
            u.lDigital.set_text(zeitText(u.jetzt, this.format12));

            // Unterschied zur Ortszeit, dazu „morgen“/„gestern“, wenn dort schon ein anderer Tag ist
            let std = (u.jetzt.get_utc_offset() - hier.get_utc_offset()) / 3.6e9;
            let teile = [];
            if (std !== 0)
                teile.push(T.std.format(this._stdText(std)));
            let tage = tagNr(u.jetzt) - tagNr(hier);
            if (tage !== 0)
                teile.push(tage > 0 ? T.morgen : T.gestern);
            u.lAbstand.set_text(teile.length ? teile.join(" · ") : T.ortszeit);

            // bevorstehende Änderung des Zeitunterschieds bzw. die eigene Zeitumstellung
            let w = u.wechsel, wechselLang = "";
            u.lWechsel.visible = !!w;
            if (w) {
                let kurz = w.tag.format(T.kurzDatum);
                u.lWechsel.set_text(T.wechsel.format(kurz, T.std.format(this._stdText(w.std))));
                wechselLang = w.hier ? T.tipUmstellung.format(datumText(w.tag, true))
                                     : T.tipWechsel.format(datumText(w.tag, true), T.std.format(this._stdText(w.std)));
            }

            // Tooltip: voller Stadtname, Datum und Uhrzeit dort, Abstand zu UTC und zur Ortszeit
            let min = u.jetzt.get_utc_offset() / 6e7, betrag = Math.abs(min);
            let utc = "UTC" + (min < 0 ? "−" : "+") + Math.floor(betrag / 60) + (betrag % 60 ? ":" + (betrag % 60 < 10 ? "0" : "") + betrag % 60 : "");
            this._tip(u.spalte, [u.name, datumLang(u.jetzt, true) + " · " + zeitText(u.jetzt, this.format12),
                                 u.jetzt.get_timezone_abbreviation() + " (" + utc + ")",
                                 teile.length ? teile.join(" · ") : T.ortszeit, wechselLang].filter(s => s).join("\n"));
        }
    }

    // Zellen der Zeitleiste: je Uhr 24 Stunden ab der laufenden Stunde, 0 = Nacht, 1 = wach, 2 = Arbeitszeit;
    // wird nur neu berechnet, wenn eine neue Stunde beginnt oder sich die Uhren ändern
    _leisteZellen() {
        let start = Math.floor(GLib.DateTime.new_now_utc().to_unix() / 3600) * 3600;
        if (this.leisteStand && this.leisteStand.start === start)
            return this.leisteStand;
        let hierTz = GLib.TimeZone.new_local();
        let zeilen = this.uhren.map(u => {
            let zellen = [];
            for (let i = 0; i < 24; i++) {
                let dort = GLib.DateTime.new_from_unix_utc(start + i * 3600 + 1800).to_timezone(u.tz);
                let h = dort.get_hour() + dort.get_minute() / 60;
                zellen.push(h >= 9 && h < 17 ? 2 : h >= 7 && h < 22 ? 1 : 0);
            }
            return zellen;
        });
        let stunden = [];
        for (let i = 0; i < 24; i++)
            stunden.push(GLib.DateTime.new_from_unix_utc(start + i * 3600).to_timezone(hierTz).get_hour());
        this.leisteStand = {start: start, zeilen: zeilen, stunden: stunden};
        return this.leisteStand;
    }

    _leisteMalen(flaeche) {
        let cr = flaeche.get_context();
        let [w, h] = flaeche.get_surface_size();
        let stand = this._leisteZellen();
        let n = stand.zeilen.length;
        if (!n) {
            cr.$dispose();
            return;
        }
        let farbe = f => cr.setSourceRGBA(f[0], f[1], f[2], f[3]);
        let teil = h / (n * 15 + 26);           // die Höhe ist n Zeilen zu 15 Teilen plus 26 für Rand und Skala
        let skala = 13 * teil;                  // Stundenskala unten
        let oben = 7 * teil;                    // Platz für den Strich „überall Tag“
        let zeileH = (h - skala - oben) / n;
        let schrift = Pango.FontDescription.from_string("Ubuntu");
        schrift.set_absolute_size(Math.max(7, Math.min(zeileH * 0.72, skala * 0.85)) * Pango.SCALE);
        let nameB = w * 0.24, x0 = nameB + 4, zelleB = (w - x0 - 1) / 24;

        for (let z = 0; z < n; z++) {
            let y = oben + z * zeileH;
            // Name der Uhr, gekürzt
            let layout = PangoCairo.create_layout(cr);
            layout.set_font_description(schrift);
            layout.set_width(nameB * Pango.SCALE);
            layout.set_ellipsize(Pango.EllipsizeMode.END);
            layout.set_text(this.uhren[z].name, -1);
            let [, l] = layout.get_pixel_extents();
            farbe(FARBEN.name);
            cr.moveTo(0, y + (zeileH - l.height) / 2 - l.y);
            PangoCairo.show_layout(cr, layout);
            for (let i = 0; i < 24; i++) {
                let art = stand.zeilen[z][i];
                farbe(art === 2 ? FARBEN.arbeit : art === 1 ? FARBEN.wach : FARBEN.schlaf);
                cr.rectangle(x0 + i * zelleB + 0.5, y + 1.5, zelleB - 1, zeileH - 3);
                cr.fill();
            }
        }
        // Strich oben: Stunden, in denen überall Tag ist (niemand schläft)
        farbe(FARBEN.alle);
        for (let i = 0; i < 24; i++) {
            if (stand.zeilen.every(zeile => zeile[i] > 0)) {
                cr.rectangle(x0 + i * zelleB + 0.5, 0, zelleB - 1, Math.max(2, oben * 0.45));
                cr.fill();
            }
        }
        // Stundenskala in Ortszeit, alle drei Stunden
        for (let i = 0; i < 24; i += 3) {
            let layout = PangoCairo.create_layout(cr);
            layout.set_font_description(schrift);
            layout.set_text(String(stand.stunden[i]), -1);
            let [, l] = layout.get_pixel_extents();
            farbe(FARBEN.schrift);
            cr.moveTo(x0 + i * zelleB - l.x, h - skala + (skala - l.height) / 2 - l.y);
            PangoCairo.show_layout(cr, layout);
        }
        // Marke: die angezeigte Zeit (jetzt oder mit dem Mausrad verschoben)
        let x = x0 + (this._jetzt().to_unix() - stand.start) / 3600 * zelleB;
        farbe(FARBEN.marke);
        cr.setLineWidth(1.6);
        cr.moveTo(x, 0);
        cr.lineTo(x, h - skala);
        cr.stroke();
        cr.$dispose();
    }

    _blattMalen(area, u) {
        let cr = area.get_context();
        let [w, h] = area.get_surface_size();
        let r = Math.min(w, h) / 2 - 1.5;
        let dt = u.jetzt || GLib.DateTime.new_now(u.tz);
        let mitSekunden = this.sekunden && !this.versatz;      // eine verschobene Zeit hat keine Sekunden
        let std = dt.get_hour(), min = dt.get_minute(), sek = dt.get_second();
        let farbe = f => cr.setSourceRGBA(f[0], f[1], f[2], f[3]);

        cr.translate(w / 2, h / 2);
        cr.setLineCap(1);       // rund

        // Blatt: tagsüber hell, nachts dunkel; die Ortszeit bekommt den vollen gelben Rand
        cr.arc(0, 0, r, 0, 2 * Math.PI);
        farbe(std >= 6 && std < 18 ? FARBEN.tag : FARBEN.nacht);
        cr.fillPreserve();
        farbe(u.hier ? FARBEN.randHier : FARBEN.rand);
        cr.setLineWidth(u.hier ? Math.max(1.6, r * 0.045) : Math.max(1, r * 0.03));
        cr.stroke();

        // Stunden: Ziffern oder Striche, 12/3/6/9 betont
        let ziffern = ZIFFERN[this.zifferblatt];
        let schrift = null;
        if (ziffern) {
            schrift = Pango.FontDescription.from_string("Ubuntu Bold");
            schrift.set_absolute_size(Math.max(7, r * (this.zifferblatt === "roemisch" ? 0.2 : 0.25)) * Pango.SCALE);
        }
        for (let i = 0; i < 12; i++) {
            let viertel = i % 3 === 0;
            if (ziffern) {
                let a = i * Math.PI / 6, mitte = r * 0.76;
                let layout = PangoCairo.create_layout(cr);
                layout.set_font_description(schrift);
                layout.set_text(ziffern[(i + 11) % 12], -1);
                let [, logisch] = layout.get_pixel_extents();
                farbe(viertel ? FARBEN.zifferViertel : FARBEN.ziffer);
                cr.moveTo(Math.sin(a) * mitte - logisch.x - logisch.width / 2,
                          -Math.cos(a) * mitte - logisch.y - logisch.height / 2);
                PangoCairo.show_layout(cr, layout);
                continue;
            }
            let a = i * Math.PI / 6;
            let innen = r * (viertel ? 0.78 : 0.86), aussen = r * 0.92;
            farbe(viertel ? FARBEN.strichViertel : FARBEN.strich);
            cr.setLineWidth(Math.max(1, r * (viertel ? 0.055 : 0.03)));
            cr.moveTo(Math.sin(a) * innen, -Math.cos(a) * innen);
            cr.lineTo(Math.sin(a) * aussen, -Math.cos(a) * aussen);
            cr.stroke();
        }

        let zeiger = (winkel, laenge, breite, f, rueck) => {
            farbe(f);
            cr.setLineWidth(breite);
            cr.moveTo(-Math.sin(winkel) * rueck, Math.cos(winkel) * rueck);
            cr.lineTo(Math.sin(winkel) * laenge, -Math.cos(winkel) * laenge);
            cr.stroke();
        };
        let sekTeil = mitSekunden ? sek / 60 : 0;
        let kurz = ziffern ? 0.86 : 1;         // Zeiger enden vor dem Ziffernkranz
        zeiger(((std % 12) + min / 60) * Math.PI / 6, r * 0.50 * kurz, Math.max(2, r * 0.085), FARBEN.zeiger, 0);
        zeiger((min + sekTeil) * Math.PI / 30, r * 0.74 * kurz, Math.max(1.5, r * 0.055), FARBEN.zeiger, 0);
        if (mitSekunden)
            zeiger(sek * Math.PI / 30, r * 0.80 * kurz, Math.max(1, r * 0.025), FARBEN.sekunde, r * 0.16);

        cr.arc(0, 0, Math.max(2, r * 0.07), 0, 2 * Math.PI);
        farbe(FARBEN.sekunde);
        cr.fill();
        cr.$dispose();
    }
}

function main(metadata, desklet_id) {
    return new WeltzeitDesklet(metadata, desklet_id);
}
