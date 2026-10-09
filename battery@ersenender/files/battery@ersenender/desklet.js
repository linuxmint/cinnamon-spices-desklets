// Battery - Battery level with manufacturer, model and health of the battery, a warning threshold and battery care
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Akku-Desklet: Akkustand als Prozentzahl, als Grafik oder beides – dazu, was der Akku über sich verrät
// (Hersteller, Modell, Technik, Zustand gegenüber neu, Ladezyklen), eine Warngrenze und eine Akkupflege,
// die ans Abziehen bzw. Anschließen des Netzteils erinnert.
// Gelesen wird direkt aus /sys/class/power_supply; ohne Akku zeigt die Karte nur einen Hinweis.
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

const Desklet = imports.ui.desklet;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;

const Gettext = imports.gettext;
const UUID = "battery@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const QUELLE = "/sys/class/power_supply";
const TAKT = 10;                    // Sekunden

const FARBEN = {
    rahmen: [242 / 255, 239 / 255, 230 / 255, 0.75],
    voll: [255 / 255, 203 / 255, 8 / 255, 1],            // Pardus-Gelb
    knapp: [255 / 255, 123 / 255, 114 / 255, 1],
    blitz: [35 / 255, 31 / 255, 32 / 255, 1],
    blitzRand: [242 / 255, 239 / 255, 230 / 255, 1],
    marke: [242 / 255, 239 / 255, 230 / 255, 0.55],      // Pflegegrenzen in der Grafik
};

const TEXTE = {
    titel: _("Battery"),
    laedt: _("Charging"),
    entlaedt: _("On battery"),
    voll: _("Fully charged · plugged in"),
    netz: _("Plugged in · not charging"),
    noch: _("%s h left"),
    bisVoll: _("full in %s h"),
    keiner: _("No battery installed"),
    tipStand: _("Battery level %s"),
    tipLadung: _("Charge %s of %s Wh"),
    tipLeistung: _("Power %s W"),
    tipGesund: _("Capacity %s of design capacity"),
    tipZyklen: _("Charge cycles: %s"),
    gesund: _("Health %s"),
    zyklen: _("%s cycles"),
    ladegrenze: _("Charge limit %s"),
    leer: _("Battery low"),
    leerTun: _("Plug in the charger"),
    pflege: _("Battery care"),
    pflegeAb: _("%s reached – unplug the charger"),
    pflegeAn: _("below %s – charge now"),
};

// Alle Dateizugriffe laufen nicht blockierend (Gio …_async): das Desklet teilt sich den Faden mit dem
// ganzen Desktop.

// Datei lesen -> Promise<Text ohne Rand-Leerzeichen | null>
function lesen(pfad) {
    return new Promise(fertig => {
        Gio.File.new_for_path(pfad).load_contents_async(null, (datei, ergebnis) => {
            try {
                let [ok, inhalt] = datei.load_contents_finish(ergebnis);
                fertig(ok ? ByteArray.toString(inhalt).trim() : null);
            } catch (e) {
                fertig(null);               // gibt es nicht oder nicht lesbar
            }
        });
    });
}

// Namen in einem Verzeichnis -> Promise<sortierte Liste> (leer, wenn es das Verzeichnis nicht gibt)
function ordner(pfad) {
    return new Promise(fertig => {
        Gio.File.new_for_path(pfad).enumerate_children_async(
            "standard::name", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (datei, ergebnis) => {
                let liste;
                try {
                    liste = datei.enumerate_children_finish(ergebnis);
                } catch (e) {
                    fertig([]);
                    return;
                }
                liste.next_files_async(200, GLib.PRIORITY_DEFAULT, null, (l, erg) => {
                    let namen = [];
                    try {
                        namen = l.next_files_finish(erg).map(info => info.get_name());
                    } catch (e) {
                        // leer lassen
                    }
                    l.close_async(GLib.PRIORITY_DEFAULT, null, null);
                    fertig(namen.sort());
                });
            });
    });
}

function zahl(text) {
    let v = parseFloat(text);
    return isNaN(v) ? null : v;
}

// Dezimalzeichen der Systemsprache
const DEZIMAL = (1.5).toLocaleString().replace(/[0-9]/g, "") || ".";

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

class AkkuDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        farbeHuelle(this);
        this.timeout = 0;
        this.akku = null;
        this.gemeldet = "";             // wofür zuletzt benachrichtigt wurde ("leer" | "ab" | "an" | "")

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        for (let [key, name] of [["art", "art"], ["zeige-kopf", "zeigeKopf"], ["zeige-status", "zeigeStatus"],
                                 ["zeige-details", "zeigeDetails"], ["warn-ab", "warnAb"], ["pflege", "pflege"],
                                 ["pflege-oben", "pflegeOben"],
                                 ["pflege-unten", "pflegeUnten"]])
            this.settings.bind(key, name, this._zeichnen);
        this.settings.bind("melden", "melden");
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this.box = new St.BoxLayout({vertical: true, style_class: "ak-box"});
        this.lKopf = new St.Label({style_class: "ak-kopf"});
        this.lStatus = new St.Label({style_class: "ak-status"});
        this.stand = new St.BoxLayout({style_class: "ak-stand", x_align: Clutter.ActorAlign.CENTER});
        this.grafik = new St.DrawingArea({y_align: Clutter.ActorAlign.CENTER});
        this.grafik.connect("repaint", area => this._grafikMalen(area));
        this.lProzent = new St.Label({style_class: "ak-prozent", y_align: Clutter.ActorAlign.CENTER});
        this.stand.add_actor(this.grafik);
        this.stand.add_actor(this.lProzent);
        this.lHinweis = new St.Label({style_class: "ak-hinweis"});
        // Warnung bzw. Erinnerung der Akkupflege (zweizeilig), darunter die Angaben zum Akku selbst
        this.lMeldung = new St.Label({style_class: "ak-meldung"});
        this.details = new St.BoxLayout({vertical: true, style_class: "ak-details"});
        this.lModell = new St.Label({style_class: "ak-detail"});
        this.lZustand = new St.Label({style_class: "ak-detail"});
        this.details.add_actor(this.lModell);
        this.details.add_actor(this.lZustand);
        this.lMehr = new St.Label({style_class: "ak-detail"});
        this.details.add_actor(this.lMehr);
        this.box.add_actor(this.lKopf);
        this.box.add_actor(this.lStatus);
        this.box.add_actor(this.stand);
        this.box.add_actor(this.lMeldung);
        this.box.add_actor(this.details);
        this.box.add_actor(this.lHinweis);
        this.setContent(this.box);
        this.setHeader(_(metadata.name));
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        this._tick();
        if (!this.timeout)
            this.timeout = Mainloop.timeout_add_seconds(TAKT, () => this._tick());
    }

    on_desklet_removed() {
        farbeEntfernen(this);
        this.entfernt = true;               // ein noch laufendes Lesen zeichnet dann nichts mehr
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
        // Grafik wächst mit der Schrift
        this.grafik.set_size(Math.round(74 * this.groesse), Math.round(34 * this.groesse));
        this._zeichnen();
    }

    // ------------------------------------------------------------ Daten

    // erster verbauter Akku: {prozent, zustand: "laedt"|"entlaedt"|"voll"|"netz", stunden|null}; null = keiner
    async _akkuLesen() {
        const FELDER = ["type", "present", "scope", "energy_now", "energy_full", "power_now",
                        "charge_now", "charge_full", "current_now", "capacity", "status",
                        "energy_full_design", "charge_full_design", "cycle_count",
                        "manufacturer", "model_name", "technology", "voltage_now", "voltage_min_design",
                        "charge_control_end_threshold"];
        for (let n of await ordner(QUELLE)) {
            let p = QUELLE + "/" + n + "/";
            let werte = await Promise.all(FELDER.map(f => lesen(p + f)));
            let w = {};
            FELDER.forEach((f, i) => w[f] = werte[i]);
            // „scope=Device“ sind Akkus von Maus/Tastatur, nicht der des Rechners
            if (w.type !== "Battery" || w.present === "0" || w.scope === "Device")
                continue;
            // Ladung je nach Akku in µWh (energy_*) oder µAh (charge_*)
            let art = w.energy_now !== null ? "energy" : "charge";
            let jetzt = zahl(w[art + "_now"]), voll = zahl(w[art + "_full"]);
            let fluss = zahl(art === "energy" ? w.power_now : w.current_now);
            let prozent = zahl(w.capacity);
            if (prozent === null && jetzt !== null && voll)
                prozent = 100 * jetzt / voll;
            if (prozent === null)
                continue;
            let roh = w.status || "";
            let zustand = roh === "Charging" ? "laedt" : roh === "Discharging" ? "entlaedt" : roh === "Full" ? "voll" : "netz";
            let stunden = null;
            if (fluss && fluss > 0 && jetzt !== null && voll) {
                if (zustand === "entlaedt")
                    stunden = jetzt / fluss;
                else if (zustand === "laedt")
                    stunden = Math.max(0, voll - jetzt) / fluss;
            }
            // Zusatzangaben. Akkus, die in µAh zählen, werden über die Spannung in Wattstunden umgerechnet
            // (Ladung × Nennspannung, Leistung = Strom × aktuelle Spannung).
            let neu = zahl(w[art + "_full_design"]), zyklen = zahl(w.cycle_count);
            let nenn = zahl(w.voltage_min_design), spannung = zahl(w.voltage_now);
            let zuWh = art === "energy" ? 1e-6 : nenn ? nenn * 1e-12 : null;
            let zuW = art === "energy" ? 1e-6 : spannung ? spannung * 1e-12 : null;
            let klar = s => s && !/^(unknown|n\/a|none)$/i.test(s) ? s : "";
            let grenze = zahl(w.charge_control_end_threshold);
            return {prozent: Math.max(0, Math.min(100, prozent)), zustand: zustand, stunden: stunden,
                    wh: zuWh && jetzt !== null && voll ? [jetzt * zuWh, voll * zuWh] : null,
                    watt: zuW && fluss ? fluss * zuW : null,
                    gesund: voll && neu ? Math.min(100, 100 * voll / neu) : null,
                    zyklen: zyklen && zyklen > 0 ? zyklen : null,
                    hersteller: klar(w.manufacturer), modell: klar(w.model_name), technik: klar(w.technology),
                    // Ladegrenze, die das Gerät selbst einhält (ThinkPad, ASUS, neuere Dell …); 100 = keine
                    grenze: grenze !== null && grenze > 0 && grenze < 100 ? grenze : null};
        }
        return null;
    }

    // Timer-Rückruf: stößt das Lesen an und kehrt sofort zurück
    _tick() {
        if (!this.liest) {
            this.liest = true;
            this._akkuLesen()
                .then(akku => {
                    if (this.entfernt)
                        return;
                    this.akku = akku;
                    this._zeichnen();
                    this._melden();
                })
                .catch(e => global.logError("battery@ersenender: Lesen fehlgeschlagen: " + e))
                .then(() => this.liest = false);
        }
        return GLib.SOURCE_CONTINUE;
    }

    // ------------------------------------------------------------ Anzeige

    _knapp() {
        return !!this.akku && this.akku.zustand === "entlaedt" && this.akku.prozent < this.warnAb;
    }

    // Was gerade zu tun ist: "leer" (unter der Warngrenze), "ab" (Pflege: Netzteil abziehen),
    // "an" (Pflege: aufladen) oder "" – die Warnung geht vor
    _lage() {
        let a = this.akku;
        if (!a)
            return "";
        if (this._knapp())
            return "leer";
        if (!this.pflege)
            return "";
        // hält das Gerät selbst eine Ladegrenze ein, braucht es die Erinnerung ans Abziehen nicht
        if (a.zustand !== "entlaedt" && a.grenze === null && a.prozent >= this.pflegeOben)
            return "ab";
        if (a.zustand === "entlaedt" && a.prozent <= this.pflegeUnten)
            return "an";
        return "";
    }

    // [Überschrift, was zu tun ist] zur Lage
    _lageText(lage) {
        let T = TEXTE;
        if (lage === "leer")
            return [T.leer, T.leerTun];
        if (lage === "ab")
            return [T.pflege, T.pflegeAb.format(prozentText(Math.round(this.pflegeOben)))];
        if (lage === "an")
            return [T.pflege, T.pflegeAn.format(prozentText(Math.round(this.pflegeUnten)))];
        return null;
    }

    // Benachrichtigung, einmal je Überschreiten einer Grenze
    _melden() {
        let lage = this._lage();
        if (lage === this.gemeldet)
            return;
        this.gemeldet = lage;
        let text = this._lageText(lage);
        if (!text || !this.melden)
            return;
        if (lage === "leer")
            Main.criticalNotify(text[0], text[1], new St.Icon({icon_name: "battery-caution", icon_type: St.IconType.SYMBOLIC, icon_size: 36}));
        else
            Main.notify(text[0], text[1]);
    }

    _zeichnen() {
        let T = TEXTE;
        let a = this.akku;
        this.lKopf.set_text(T.titel);
        this.lKopf.visible = this.zeigeKopf;
        this.lHinweis.set_text(T.keiner);
        this.lHinweis.visible = !a;
        if (!a)
            this._tip(this.box, "");
        this.stand.visible = !!a;
        this.lStatus.visible = !!a && this.zeigeStatus;
        this.lMeldung.visible = false;
        this.details.visible = false;
        if (!a)
            return;

        // Warnung bzw. Erinnerung der Akkupflege
        let lage = this._lage(), meldung = this._lageText(lage);
        this.lMeldung.visible = !!meldung;
        if (meldung) {
            this.lMeldung.set_text(meldung.join("\n"));
            this.lMeldung.set_style_class_name("ak-meldung" + (lage === "leer" ? " ak-rot" : ""));
        }

        // Angaben zum Akku: Hersteller und Modell, darunter Technik und Zustand gegenüber neu,
        // in einer dritten Zeile Ladezyklen und Ladegrenze, soweit der Akku sie meldet
        let pz = n => prozentText(Math.round(n));
        let modell = [a.hersteller, a.modell].filter(s => s).join(" · ");
        let zustand = [a.technik, a.gesund !== null ? T.gesund.format(pz(a.gesund)) : ""].filter(s => s).join(" · ");
        let mehr = [a.zyklen !== null ? T.zyklen.format(a.zyklen) : "",
                    a.grenze !== null ? T.ladegrenze.format(pz(a.grenze)) : ""].filter(s => s).join(" · ");
        this.details.visible = this.zeigeDetails && !!(modell || zustand || mehr);
        this.lMehr.set_text(mehr);
        this.lMehr.visible = !!mehr;
        this.lModell.set_text(modell);
        this.lModell.visible = !!modell;
        this.lZustand.set_text(zustand);
        this.lZustand.visible = !!zustand;

        let teile = [T[a.zustand]];
        if (a.stunden !== null && a.stunden < 100) {
            let min = Math.round(a.stunden * 60);
            let dauer = Math.floor(min / 60) + ":" + (min % 60 < 10 ? "0" : "") + (min % 60);
            teile.push((a.zustand === "laedt" ? T.bisVoll : T.noch).format(dauer));
        }
        this.lStatus.set_text(teile.join(" · "));

        // Tooltip: alles, was der Akku über sich verrät – auch wenn Kopf und Statuszeile ausgeblendet sind
        let komma = (n, st) => n.toFixed(st).replace(".", DEZIMAL);
        let tip = [T.tipStand.format(prozentText(Math.round(a.prozent))), teile.join(" · ")];
        if (a.wh)
            tip.push(T.tipLadung.format(komma(a.wh[0], 1), komma(a.wh[1], 1)));
        if (a.watt)
            tip.push(T.tipLeistung.format(komma(a.watt, 1)));
        if (a.gesund !== null)
            tip.push(T.tipGesund.format(prozentText(Math.round(a.gesund))));
        if (a.zyklen !== null)
            tip.push(T.tipZyklen.format(a.zyklen));
        if (a.grenze !== null)
            tip.push(T.ladegrenze.format(pz(a.grenze)));
        if (modell)
            tip.push(modell);
        this._tip(this.box, tip.join("\n"));

        this.grafik.visible = this.art !== "prozent";
        this.lProzent.visible = this.art !== "grafik";
        this.lProzent.set_text(prozentText(Math.round(a.prozent)));
        this.lProzent.set_style_class_name("ak-prozent" + (this._knapp() ? " ak-rot" : ""));
        this.stand.set_style_class_name("ak-stand" + (this.zeigeKopf || this.zeigeStatus ? " ak-stand-mit-kopf" : ""));
        this.grafik.queue_repaint();
    }

    _grafikMalen(area) {
        let cr = area.get_context();
        let [w, h] = area.get_surface_size();
        let a = this.akku;
        if (!a) {
            cr.$dispose();
            return;
        }
        let farbe = f => cr.setSourceRGBA(f[0], f[1], f[2], f[3]);
        let rund = (x, y, b, hh, r) => {
            cr.newSubPath();
            cr.arc(x + b - r, y + r, r, -Math.PI / 2, 0);
            cr.arc(x + b - r, y + hh - r, r, 0, Math.PI / 2);
            cr.arc(x + r, y + hh - r, r, Math.PI / 2, Math.PI);
            cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
            cr.closePath();
        };
        let strich = Math.max(1.5, h * 0.07);
        let pol = h * 0.12;                                // Breite des Pluspols rechts
        let bw = w - pol - strich, bh = h - strich;        // Gehäuse
        let x0 = strich / 2, y0 = strich / 2, ecke = h * 0.18;

        farbe(FARBEN.rahmen);
        cr.setLineWidth(strich);
        rund(x0, y0, bw, bh, ecke);
        cr.stroke();
        rund(x0 + bw + strich * 0.3, h * 0.32, pol, h * 0.36, pol * 0.35);
        cr.fill();

        // Füllung
        let luft = strich * 1.3;
        let innenB = bw - 2 * luft, innenH = bh - 2 * luft;
        let fuell = innenB * a.prozent / 100;
        if (fuell > 0.5) {
            farbe(this._knapp() ? FARBEN.knapp : FARBEN.voll);
            rund(x0 + luft, y0 + luft, Math.max(fuell, ecke * 0.6), innenH, Math.min(ecke * 0.5, fuell / 2));
            cr.fill();
        }

        // Akkupflege: die beiden Grenzen als feine Marken im Gehäuse
        if (this.pflege) {
            farbe(FARBEN.marke);
            cr.setLineWidth(Math.max(1, strich * 0.55));
            for (let g of [this.pflegeUnten, this.pflegeOben]) {
                let x = x0 + luft + innenB * Math.max(0, Math.min(100, g)) / 100;
                cr.moveTo(x, y0 + luft);
                cr.lineTo(x, y0 + luft + innenH);
                cr.stroke();
            }
        }

        // Blitz beim Laden
        if (a.zustand === "laedt") {
            let mx = x0 + bw / 2, my = h / 2, s = h * 0.36;
            cr.moveTo(mx + s * 0.25, my - s);
            cr.lineTo(mx - s * 0.55, my + s * 0.12);
            cr.lineTo(mx - s * 0.02, my + s * 0.12);
            cr.lineTo(mx - s * 0.25, my + s);
            cr.lineTo(mx + s * 0.55, my - s * 0.12);
            cr.lineTo(mx + s * 0.02, my - s * 0.12);
            cr.closePath();
            farbe(FARBEN.blitz);
            cr.fillPreserve();
            farbe(FARBEN.blitzRand);
            cr.setLineWidth(Math.max(1, strich * 0.6));
            cr.setLineJoin(1);
            cr.stroke();
        }
        cr.$dispose();
    }
}

function main(metadata, desklet_id) {
    return new AkkuDesklet(metadata, desklet_id);
}
