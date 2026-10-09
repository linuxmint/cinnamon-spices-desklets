// Clock - Clock with date, analog or digital - with alarm and timer
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Uhr-Desklet: Uhr mit Datum, in den Einstellungen zwischen analog und digital umschaltbar –
// dazu ein Wecker (täglich oder nur werktags) und ein Kurzzeit-Timer aus dem Rechtsklick-Menü.
// Beide melden sich mit Ton, Benachrichtigung und einer hervorgehobenen Zeile, bis man sie wegklickt;
// ein laufender Timer übersteht auch einen Neustart von Cinnamon.
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;
const Mainloop = imports.mainloop;

const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const Gettext = imports.gettext;
const UUID = "clock@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

// Pardus-Farben fürs Zifferblatt (r, g, b, Deckkraft) – wie bei der Weltzeit
const FARBEN = {
    blatt: [242 / 255, 239 / 255, 230 / 255, 0.10],
    rand: [255 / 255, 203 / 255, 8 / 255, 1],
    strich: [242 / 255, 239 / 255, 230 / 255, 0.45],
    strichViertel: [255 / 255, 203 / 255, 8 / 255, 1],
    ziffer: [242 / 255, 239 / 255, 230 / 255, 0.85],
    zifferViertel: [255 / 255, 203 / 255, 8 / 255, 1],  // 12, 3, 6, 9
    zeiger: [242 / 255, 239 / 255, 230 / 255, 1],
    sekunde: [255 / 255, 203 / 255, 8 / 255, 1],
    timer: [242 / 255, 239 / 255, 230 / 255, 0.7],       // Restzeit des Timers als heller Bogen innen am Rand
};

const TIMER_MINUTEN = [5, 10, 15, 30, 60];          // feste Einträge im Rechtsklick-Menü
const TON = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga";
const KLINGELN = 3;                                 // so oft ertönt der Ton (alle 3 Sekunden)

const TEXTE = {
    kw: _("Calendar week %d"),
    kwKurz: _("Week %d"),
    timer: _("Timer %s"),
    timerAus: _("Timer finished"),
    wecker: _("Alarm %s"),
    menuTimer: _("Timer: %d minutes"),
    menuStopp: _("Stop timer"),
    tipAus: _("Click: dismiss"),
    tipTimer: _("Right-click the desklet: stop timer"),
};

function zwei(n) {
    return (n < 10 ? "0" : "") + n;
}

// Stunde, Minute -> „07:30“ bzw. im 12-Stunden-Format „7:30 AM“
function zeitText(std, min, zwoelf) {
    if (!zwoelf)
        return zwei(std) + ":" + zwei(min);
    return (std % 12 || 12) + ":" + zwei(min) + (std < 12 ? " AM" : " PM");
}

// Sekunden -> „4:05“ bzw. „1:04:05“
function restText(sek) {
    sek = Math.max(0, Math.round(sek));
    let h = Math.floor(sek / 3600), m = Math.floor(sek % 3600 / 60), s = sek % 60;
    return h ? h + ":" + zwei(m) + ":" + zwei(s) : m + ":" + zwei(s);
}

// Beschriftung der Stunden 1–12 je Zifferblatt-Art (fehlt die Art -> Striche)
const ZIFFERN = {
    ziffern: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    ostarabisch: ["١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩", "١٠", "١١", "١٢"],
    roemisch: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"],
};


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

class UhrDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        farbeHuelle(this);
        this.timeout = 0;
        this.letzteMinute = -1;
        this.klingelt = "";             // "timer" | "wecker" | "" – bis zum Wegklicken
        this.klingelRest = 0;
        this.weckerTag = "";            // an diesem Tag hat der Wecker schon geklingelt
        this.menuEintraege = [];

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        this.settings.bind("art", "art", this._umschalten);
        this.settings.bind("zifferblatt", "zifferblatt", this._zeichnen);
        this.settings.bind("uhr-groesse", "uhrGroesse", this._umschalten);
        this.settings.bind("sekunden", "sekunden", this._umschalten);
        this.settings.bind("zeige-datum", "zeigeDatum", this._umschalten);
        this.settings.bind("format12", "format12", this._zeichnen);
        this.settings.bind("zeige-kw", "zeigeKw", this._zeichnen);
        this.settings.bind("wecker", "wecker", this._zeichnen);
        this.settings.bind("wecker-std", "weckerStd", this._zeichnen);
        this.settings.bind("wecker-min", "weckerMin", this._zeichnen);
        this.settings.bind("wecker-tage", "weckerTage", this._zeichnen);
        this.settings.bind("timer-eigen", "timerEigen", this._menuBauen);
        this.settings.bind("ton", "ton");
        this.settings.bind("melden", "melden");
        this.settings.bind("timer-ende", "timerEnde");
        this.settings.bind("timer-dauer", "timerDauer");
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this.box = new St.BoxLayout({vertical: true, style_class: "uh-box"});
        this.blatt = new St.DrawingArea({x_align: Clutter.ActorAlign.CENTER});
        this.blatt.connect("repaint", area => this._blattMalen(area));
        this.digital = new St.BoxLayout({style_class: "uh-digital", x_align: Clutter.ActorAlign.CENTER});
        this.lZeit = new St.Label({style_class: "uh-zeit"});
        this.lAmPm = new St.Label({style_class: "uh-ampm"});
        this.lSek = new St.Label({style_class: "uh-sek"});
        let neben = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.END});
        neben.add_actor(this.lAmPm);
        neben.add_actor(this.lSek);
        this.digital.add_actor(this.lZeit);
        this.digital.add_actor(neben);
        this.lTag = new St.Label({style_class: "uh-tag"});
        this.lDatum = new St.Label({style_class: "uh-datum"});
        this.box.add_actor(this.blatt);
        this.box.add_actor(this.digital);
        this.box.add_actor(this.lTag);
        this.box.add_actor(this.lDatum);
        // Zeile für Timer und Wecker; klingelt etwas, schaltet ein Klick darauf es aus
        this.lWach = new St.Label({style_class: "uh-wach-text"});
        this.wach = new St.Button({child: this.lWach, style_class: "uh-wach", reactive: true,
                                   x_align: St.Align.MIDDLE});
        this.wach.connect("clicked", () => this._ausschalten());
        this.box.add_actor(this.wach);
        this.setContent(this.box);
        this.setHeader(_(metadata.name));
        this._menuBauen();
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        // Timer, der während eines Neustarts abgelaufen ist: noch melden, wenn es keine Stunde her ist
        let unix = GLib.DateTime.new_now_local().to_unix();
        if (this.timerEnde > 0 && this.timerEnde <= unix) {
            let alt = unix - this.timerEnde > 3600;
            this.timerEnde = 0;
            if (!alt)
                this._klingeln("timer");
        }
        this._umschalten();
        if (!this.timeout)
            this.timeout = Mainloop.timeout_add_seconds(1, () => this._tick());
    }

    on_desklet_removed() {
        farbeEntfernen(this);
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

    // ------------------------------------------------------------ Wecker und Timer

    _spracheGeaendert() {
        this._menuBauen();
        this._zeichnen();
    }

    // Einträge im Rechtsklick-Menü: feste Dauern, die eigene Dauer und „Timer stoppen“
    _menuBauen() {
        for (let e of this.menuEintraege)
            e.destroy();
        this.menuEintraege = [];
        let T = TEXTE;
        let dazu = (text, aktion) => {
            let e = new PopupMenu.PopupMenuItem(text);
            e.connect("activate", aktion);
            this._menu.addMenuItem(e);
            this.menuEintraege.push(e);
        };
        let eigen = Math.round(this.timerEigen);
        let dauern = TIMER_MINUTEN.slice();
        if (eigen > 0 && dauern.indexOf(eigen) < 0)
            dauern.push(eigen);
        dauern.sort((a, b) => a - b);
        for (let m of dauern)
            dazu(T.menuTimer.format(m), () => this._timerStart(m));
        dazu(T.menuStopp, () => this._timerStopp());
    }

    _timerStart(minuten) {
        this.klingelt = "";
        this.timerDauer = minuten * 60;
        this.timerEnde = GLib.DateTime.new_now_local().to_unix() + minuten * 60;
        this._zeichnen();
    }

    _timerStopp() {
        this.timerEnde = 0;
        if (this.klingelt === "timer")
            this.klingelt = "";
        this._zeichnen();
    }

    _ton() {
        if (!this.ton)
            return;
        try {
            Main.soundManager.playSoundFile(0, TON);
        } catch (e) {
            // kein Ton verfügbar – Zeile und Benachrichtigung bleiben
        }
    }

    _klingeln(was) {
        let T = TEXTE;
        this.klingelt = was;
        this.klingelRest = KLINGELN - 1;
        this._ton();
        if (this.melden) {
            let zeit = zeitText(Math.round(this.weckerStd), Math.round(this.weckerMin), this.format12);
            Main.notify(was === "timer" ? T.timerAus : T.wecker.format(zeit), "");
        }
    }

    _ausschalten() {
        if (!this.klingelt)
            return;
        this.klingelt = "";
        this.klingelRest = 0;
        this._zeichnen();
    }

    // einmal je Sekunde: ist ein Timer abgelaufen, ist Weckzeit, soll der Ton noch einmal kommen?
    // liefert true, wenn neu gezeichnet werden muss
    _wachen(jetzt) {
        let neu = false;
        if (this.timerEnde > 0) {
            neu = true;                                     // Restzeit läuft
            if (jetzt.to_unix() >= this.timerEnde) {
                this.timerEnde = 0;
                this._klingeln("timer");
            }
        }
        if (this.wecker && jetzt.get_hour() === Math.round(this.weckerStd) && jetzt.get_minute() === Math.round(this.weckerMin)
            && (this.weckerTage !== "werktags" || jetzt.get_day_of_week() <= 5)) {
            let tag = jetzt.format("%F");
            if (tag !== this.weckerTag) {
                this.weckerTag = tag;
                this._klingeln("wecker");
                neu = true;
            }
        }
        if (this.klingelt && this.klingelRest > 0 && jetzt.get_second() % 3 === 0) {
            this.klingelRest--;
            this._ton();
        }
        return neu;
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

    // analog <-> digital, Größe, Datum: was sichtbar ist
    _umschalten() {
        let analog = this.art !== "digital";
        let px = Math.round(this.uhrGroesse);
        this.blatt.set_size(px, px);
        this.blatt.visible = analog;
        this.digital.visible = !analog;
        this.lSek.visible = this.sekunden;
        this.lTag.visible = this.lDatum.visible = this.zeigeDatum;
        this._zeichnen();
    }

    _tick() {
        let jetzt = GLib.DateTime.new_now_local();
        let neu = this._wachen(jetzt);
        if (neu || this.sekunden || jetzt.get_minute() !== this.letzteMinute)
            this._zeichnen();
        return GLib.SOURCE_CONTINUE;
    }

    _zeichnen() {
        let jetzt = GLib.DateTime.new_now_local();
        this.letzteMinute = jetzt.get_minute();
        let T = TEXTE;
        if (this.art === "digital") {
            let zeit = zeitText(jetzt.get_hour(), jetzt.get_minute(), this.format12).split(" ");
            this.lZeit.set_text(zeit[0]);
            this.lAmPm.set_text(zeit[1] || "");
            this.lAmPm.visible = !!zeit[1];
            this.lSek.set_text(jetzt.format("%S"));
        } else {
            this.blatt.queue_repaint();
        }
        this.lTag.set_text(tagName(jetzt));
        this.lDatum.set_text(datumText(jetzt, true) +
                             (this.zeigeKw ? " · " + T.kwKurz.format(jetzt.get_week_of_year()) : ""));

        // Zeile für Timer und Wecker: was klingelt (hervorgehoben), sonst Restzeit des Timers, sonst die Weckzeit
        let weckzeit = zeitText(Math.round(this.weckerStd), Math.round(this.weckerMin), this.format12);
        let wach = "", tip = "";
        if (this.klingelt) {
            wach = this.klingelt === "timer" ? T.timerAus : T.wecker.format(weckzeit);
            tip = T.tipAus;
        } else if (this.timerEnde > 0) {
            wach = T.timer.format(restText(this.timerEnde - jetzt.to_unix()));
            tip = T.tipTimer;
        } else if (this.wecker) {
            wach = T.wecker.format(weckzeit);
        }
        this.wach.visible = !!wach;
        this.lWach.set_text(wach);
        this.wach.set_style_class_name("uh-wach" + (this.klingelt ? " uh-klingelt" : ""));
        this._tip(this.wach, tip);

        // Tooltip: Datum mit Wochentag, Kalenderwoche und Zeitzone – auch wenn das Datum ausgeblendet ist
        let kw = T.kw.format(jetzt.get_week_of_year());
        let min = jetzt.get_utc_offset() / 6e7, betrag = Math.abs(min);
        let utc = "UTC" + (min < 0 ? "−" : "+") + Math.floor(betrag / 60) + (betrag % 60 ? ":" + (betrag % 60 < 10 ? "0" : "") + betrag % 60 : "");
        this._tip(this.box, [datumLang(jetzt, true), kw, jetzt.get_timezone_abbreviation() + " (" + utc + ")"].join("\n"));
    }

    _blattMalen(area) {
        let cr = area.get_context();
        let [w, h] = area.get_surface_size();
        let r = Math.min(w, h) / 2 - 2;
        let dt = GLib.DateTime.new_now_local();
        let std = dt.get_hour(), min = dt.get_minute(), sek = dt.get_second();
        let farbe = f => cr.setSourceRGBA(f[0], f[1], f[2], f[3]);

        cr.translate(w / 2, h / 2);
        cr.setLineCap(1);       // rund

        cr.arc(0, 0, r, 0, 2 * Math.PI);
        farbe(FARBEN.blatt);
        cr.fillPreserve();
        farbe(FARBEN.rand);
        cr.setLineWidth(Math.max(1.6, r * 0.035));
        cr.stroke();

        // laufender Timer: Restzeit als Bogen am Rand, von der 12 aus im Uhrzeigersinn
        if (this.timerEnde > 0 && this.timerDauer > 0) {
            let anteil = Math.max(0, Math.min(1, (this.timerEnde - dt.to_unix()) / this.timerDauer));
            if (anteil > 0) {
                farbe(FARBEN.timer);
                cr.setLineWidth(Math.max(2, r * 0.05));
                cr.arc(0, 0, r * 0.93, -Math.PI / 2, -Math.PI / 2 + anteil * 2 * Math.PI);
                cr.stroke();
            }
        }
        // eingeschalteter Wecker: kleine Marke am Rand, dort wo der Stundenzeiger zur Weckzeit steht
        if (this.wecker) {
            let a = ((Math.round(this.weckerStd) % 12) + Math.round(this.weckerMin) / 60) * Math.PI / 6;
            farbe(FARBEN.sekunde);
            cr.arc(Math.sin(a) * r, -Math.cos(a) * r, Math.max(2.5, r * 0.055), 0, 2 * Math.PI);
            cr.fill();
        }

        // Stunden: Ziffern oder Striche, 12/3/6/9 betont
        let ziffern = ZIFFERN[this.zifferblatt];
        let schrift = null;
        if (ziffern) {
            schrift = Pango.FontDescription.from_string("Ubuntu Bold");
            schrift.set_absolute_size(Math.max(7, r * (this.zifferblatt === "roemisch" ? 0.2 : 0.25)) * Pango.SCALE);
        }
        for (let i = 0; i < 12; i++) {
            let viertel = i % 3 === 0;
            let a = i * Math.PI / 6;
            if (ziffern) {
                let mitte = r * 0.76;
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
        let kurz = ziffern ? 0.86 : 1;         // Zeiger enden vor dem Ziffernkranz
        let sekTeil = this.sekunden ? sek / 60 : 0;
        zeiger(((std % 12) + min / 60) * Math.PI / 6, r * 0.50 * kurz, Math.max(2, r * 0.085), FARBEN.zeiger, 0);
        zeiger((min + sekTeil) * Math.PI / 30, r * 0.74 * kurz, Math.max(1.5, r * 0.055), FARBEN.zeiger, 0);
        if (this.sekunden)
            zeiger(sek * Math.PI / 30, r * 0.80 * kurz, Math.max(1, r * 0.025), FARBEN.sekunde, r * 0.16);

        cr.arc(0, 0, Math.max(2, r * 0.07), 0, 2 * Math.PI);
        farbe(FARBEN.sekunde);
        cr.fill();
        cr.$dispose();
    }
}

function main(metadata, desklet_id) {
    return new UhrDesklet(metadata, desklet_id);
}
