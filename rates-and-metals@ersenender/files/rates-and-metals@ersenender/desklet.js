// Rates and Metals - Exchange rates (ECB) and precious metal prices as a list - choose in the settings what is shown
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Kurse-Desklet: Wechselkurse (EZB) und Edelmetallpreise als Liste – je Zeile mit einer kleinen Verlaufslinie
// und der Veränderung über einen Tag, eine Woche oder einen Monat. Dazu ein frei wählbarer Betrag zum
// Umrechnen und auf Wunsch der Nisab-Wert (80,18 g Gold nach Diyanet).
// Die Daten holt helper.py in den Cache; hier wird nur gelesen, umgerechnet und gezeichnet.
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;

const Gettext = imports.gettext;
const UUID = "rates-and-metals@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const CACHE = GLib.build_filenamev([GLib.get_user_cache_dir(), "rates-and-metals@ersenender", "kurse.json"]);
const ABRUF_FEHLER = 5 * 60;        // Sekunden bis zum nächsten Versuch nach einem Fehler
const TAKT = 60;
const UNZE = 31.1034768;            // Gramm je Feinunze
const NISAB_GRAMM = 80.18;          // Nisab für die Zakat in Gramm Gold (Diyanet)
const VERLAUF_TAGE = 30;            // so viele Tage zeigt die Verlaufslinie
const ZEITRAUM = {tag: 1, woche: 7, monat: 30};     // Veränderung gegenüber dem Stand vor so vielen Tagen

// Farben der Verlaufslinie (r, g, b, Deckkraft): gestiegen, gefallen, unverändert
const FARBEN = {
    plus: [126 / 255, 231 / 255, 135 / 255, 1],
    minus: [255 / 255, 123 / 255, 114 / 255, 1],
    gleich: [163 / 255, 158 / 255, 148 / 255, 1],
};
const EINHEITEN = {
    g: {teiler: UNZE, text: _("per gram")},
    oz: {teiler: 1, text: _("per troy ounce")},
    kg: {teiler: UNZE / 1000, text: _("per kilogram")},
};

// Währungen [Kürzel, Name, Zeichen] und Metalle [Kürzel, Name]
const WERTE = {
    waehrungen: [
        ["EUR", _("Euro"), "€"],
        ["USD", _("US dollar"), "$"],
        ["TRY", _("Turkish lira"), "₺"],
        ["GBP", _("Pound sterling"), "£"],
        ["CHF", _("Swiss franc"), "CHF"],
        ["JPY", _("Japanese yen"), "¥"],
        ["CAD", _("Canadian dollar"), "CA$"],
        ["AUD", _("Australian dollar"), "A$"],
        ["SEK", _("Swedish krona"), "kr"],
        ["NOK", _("Norwegian krone"), "kr"],
        ["DKK", _("Danish krone"), "kr"],
        ["PLN", _("Polish złoty"), "zł"],
        ["CZK", _("Czech koruna"), "Kč"],
        ["HUF", _("Hungarian forint"), "Ft"],
        ["RON", _("Romanian leu"), "lei"],
        ["CNY", _("Chinese yuan"), "CN¥"],
        ["INR", _("Indian rupee"), "₹"],
        ["IDR", _("Indonesian rupiah"), "Rp"],
        ["MYR", _("Malaysian ringgit"), "RM"],
    ],
    metalle: [
        ["XAU", _("Gold")],
        ["XAG", _("Silver")],
        ["XPT", _("Platinum")],
        ["XPD", _("Palladium")],
    ],
};

const TEXTE = {
    titel: _("Rates"),
    waehrungen: _("CURRENCIES"),
    metalle: _("PRECIOUS METALS"),
    basis: _("%s %s ="),
    fremd: _("Price in %s"),
    fremdN: _("Price of %s units in %s"),
    nisab: _("Nisab (80.18 g gold)"),
    tipNisab: _("Nisab for zakat according to Diyanet: value of 80.18 g of gold"),
    seitTag: _("Change from the previous day: %s"),
    seitWoche: _("Change in 7 days: %s"),
    seitMonat: _("Change in 30 days: %s"),
    spanne: _("30 days: low %s · high %s"),
    laden: _("Loading rates …"),
    fehler: _("No connection – will retry"),
    fehlerStand: _("No connection – as of %s"),
    stand: _("ECB rate of %s · metals %s"),
    standW: _("ECB rate of %s"),
    standM: _("Metals as of %s"),
    nichts: _("Nothing is selected in the settings."),
    neu: _("Refresh now"),
    vortag: _("Previous day: %s"),
};

// 1234.5 -> "1.234,50"
function zahl(wert, stellen) {
    let [ganz, bruch] = wert.toFixed(stellen).split(".");
    ganz = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, DEZIMAL === "." ? "," : ".");
    return bruch ? ganz + DEZIMAL + bruch : ganz;
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

// Datum „2026-10-09“ -> Tage seit 1970 (zum Rechnen mit Abständen)
function tagZahl(datum) {
    return Math.round(Date.parse(datum + "T00:00:00Z") / 86400000);
}

// Wechselkurse brauchen mehr Stellen, je kleiner sie sind
function kursStellen(wert) {
    return wert >= 100 ? 2 : wert >= 10 ? 3 : 4;
}

// Dezimalzeichen der Systemsprache
const DEZIMAL = (1.5).toLocaleString().replace(/[0-9]/g, "") || ".";

// Prozentangabe, wie die Sprache sie schreibt: 10 % · 10% · %10
function prozentText(zahl) {
    // Translators: a percentage, %s is the number; e.g. "%s%%" -> 10%, "%s %%" -> 10 %, "%%%s" -> %10
    return _("%s%%").format(zahl);
}

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

class KurseDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.helper = GLib.build_filenamev([metadata.path, "helper.py"]);
        this.daten = null;
        this.fehler = false;
        this.abrufLaeuft = false;
        this.naechsterAbruf = 0;
        this.timeout = 0;

        this.werte = WERTE;

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        for (let key of ["basis", "richtung", "einheit", "zeige-aenderung", "zeige-kuerzel"])
            this.settings.bind(key, key, this._zeichnen);
        this.settings.bind("zeitraum", "zeitraum", this._zeichnen);
        this.settings.bind("zeige-verlauf", "zeigeVerlauf", this._zeichnen);
        this.settings.bind("betrag", "betrag", this._zeichnen);
        this.settings.bind("zeige-nisab", "zeigeNisab", this._zeichnen);
        this.settings.bind("waehrungen", "waehrungen", this._zeichnen);     // [{an, code}] in Anzeige-Reihenfolge
        this.settings.bind("metalle", "metalle", this._zeichnen);           // ebenso
        this.settings.bind("abruf-alle", "abrufAlle");
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this.box = new St.BoxLayout({vertical: true, style_class: "ku-box"});
        this.lKopf = new St.Label({style_class: "ku-kopf"});
        this.lUnter = new St.Label({style_class: "ku-unter"});
        this.liste = new St.BoxLayout({vertical: true});
        this.lStatus = new St.Label({style_class: "ku-status"});
        this.box.add_actor(this.lKopf);
        this.box.add_actor(this.lUnter);
        this.box.add_actor(this.liste);
        this.box.add_actor(this.lStatus);
        this.setContent(this.box);
        this.setHeader(_(metadata.name));

        this.menuNeu = new PopupMenu.PopupMenuItem("");
        this.menuNeu.connect("activate", () => this._abrufen(true));
        this._menu.addMenuItem(this.menuNeu);
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        this._cacheLesen().then(() => {
            if (this.entfernt)
                return;
            this._tick();
            if (!this.timeout)
                this.timeout = Mainloop.timeout_add_seconds(TAKT, () => this._tick());
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

    // ------------------------------------------------------------ Daten

    // -> Promise; danach steht der letzte Abruf in this.daten (oder null)
    _cacheLesen() {
        return dateiLesen(CACHE).then(text => {
            try {
                this.daten = text === null ? null : JSON.parse(text);
            } catch (e) {
                this.daten = null;
            }
        });
    }

    _abrufen(erzwingen) {
        let jetzt = GLib.get_monotonic_time() / 1e6;
        if (this.abrufLaeuft || (!erzwingen && jetzt < this.naechsterAbruf))
            return;
        this.abrufLaeuft = true;
        starten(["python3", this.helper, "fetch"]).then(aus => {
            this.abrufLaeuft = false;
            this.fehler = aus === null;
            this.naechsterAbruf = GLib.get_monotonic_time() / 1e6 +
                (this.fehler ? ABRUF_FEHLER : Math.max(10, this.abrufAlle) * 60);
            this._cacheLesen().then(() => {
                if (!this.entfernt)
                    this._zeichnen();
            });
        });
    }

    _tick() {
        this._abrufen(false);
        this._zeichnen();
        return GLib.SOURCE_CONTINUE;
    }

    // Wert von 1 Einheit `code` in der Basiswährung; `kurse` = EZB-Tabelle (1 EUR = x code)
    _inBasis(kurse, code) {
        let k = c => c === "EUR" ? 1 : kurse[c];
        let basis = k(this.basis), fremd = k(code);
        return basis && fremd ? basis / fremd : null;
    }

    // Verlauf einer Währung als Liste [{tag, wert}] (wert = 1 Einheit `code` in der Basiswährung),
    // aus den Tageskursen der EZB; leer, wenn der Zwischenspeicher noch keinen Verlauf hat
    _reiheWaehrung(w, code) {
        let aus = [];
        if (!w.tage || !w.reihe)
            return aus;
        let k = (c, i) => c === "EUR" ? 1 : (w.reihe[c] || [])[i];
        w.tage.forEach((datum, i) => {
            let basis = k(this.basis, i), fremd = k(code, i);
            if (basis && fremd)
                aus.push({tag: tagZahl(datum), wert: basis / fremd});
        });
        return aus;
    }

    // Verlauf eines Metalls in USD je Feinunze – wächst mit jedem Tag, an dem das Desklet lief
    _reiheMetall(m, code) {
        let aus = [];
        for (let datum of Object.keys(m.tage || {}).sort()) {
            let preis = m.tage[datum][code];
            if (preis)
                aus.push({tag: tagZahl(datum), wert: preis});
        }
        return aus;
    }

    // Veränderung in Prozent gegenüber dem Stand vor `tage` Tagen (letzter Wert davor); null, wenn es keinen gibt
    _aenderung(reihe, tage) {
        if (reihe.length < 2)
            return null;
        let letzter = reihe[reihe.length - 1];
        let frueher = reihe.filter(p => p.tag <= letzter.tag - tage);
        if (!frueher.length)
            return null;
        return (letzter.wert / frueher[frueher.length - 1].wert - 1) * 100;
    }

    // kleine Verlaufslinie der letzten VERLAUF_TAGE Tage; Farbe nach Richtung über das ganze Fenster
    _linie(reihe) {
        let letzter = reihe.length ? reihe[reihe.length - 1].tag : 0;
        let punkte = reihe.filter(p => p.tag > letzter - VERLAUF_TAGE);
        let flaeche = new St.DrawingArea({style_class: "ku-zeile-verlauf", y_align: Clutter.ActorAlign.CENTER});
        flaeche.set_size(Math.round(40 * this.groesse), Math.round(15 * this.groesse));
        flaeche.connect("repaint", f => {
            let cr = f.get_context();
            let [w, h] = f.get_surface_size();
            if (punkte.length > 1) {
                let werte = punkte.map(p => p.wert);
                let min = Math.min.apply(null, werte), max = Math.max.apply(null, werte);
                let spanne = max - min || 1, rand = 1.5;
                let x = p => rand + (w - 2 * rand) * (p.tag - punkte[0].tag) / Math.max(1, letzter - punkte[0].tag);
                let y = p => h - rand - (h - 2 * rand) * (p.wert - min) / spanne;
                let erster = werte[0], ende = werte[werte.length - 1];
                let f3 = ende > erster * 1.0005 ? FARBEN.plus : ende < erster * 0.9995 ? FARBEN.minus : FARBEN.gleich;
                cr.setSourceRGBA(f3[0], f3[1], f3[2], f3[3]);
                cr.setLineWidth(1.3);
                cr.setLineJoin(1);
                cr.setLineCap(1);
                punkte.forEach((p, i) => i ? cr.lineTo(x(p), y(p)) : cr.moveTo(x(p), y(p)));
                cr.stroke();
            }
            cr.$dispose();
        });
        return flaeche;
    }

    // ------------------------------------------------------------ Anzeige

    // Einstellungsliste [{an, code}] -> angehakte Einträge aus WERTE, in der gewählten Reihenfolge
    _auswahl(liste, bekannt) {
        let aus = [];
        for (let eintrag of liste || []) {
            let def = bekannt.filter(x => x[0] === eintrag.code)[0];
            if (def && eintrag.an && aus.indexOf(def) < 0)
                aus.push(def);
        }
        return aus;
    }

    _rubrik(text) {
        this.liste.add_actor(new St.Label({text: text, style_class: "ku-rubrik"}));
    }

    // hinweis: Text für den Tooltip der Zeile; reihe: Verlauf [{tag, wert}] für die Linie (oder null)
    _zeile(name, wert, aenderung, hinweis, reihe) {
        let zeile = new St.BoxLayout({style_class: "ku-zeile", reactive: !!hinweis});
        if (hinweis)
            new Tooltips.Tooltip(zeile, hinweis);
        zeile.add(new St.Label({text: name, style_class: "ku-zeile-name"}), {expand: true, x_fill: true});
        if (this.zeigeVerlauf && reihe)
            zeile.add(this._linie(reihe));
        if (this["zeige-aenderung"]) {
            let text = "", klasse = "";
            if (typeof aenderung === "number" && isFinite(aenderung)) {
                let gerundet = Math.round(aenderung * 100) / 100;
                text = (gerundet > 0 ? "+" : gerundet < 0 ? "−" : "±") + prozentText(zahl(Math.abs(gerundet), 2));
                klasse = gerundet > 0 ? " ku-plus" : gerundet < 0 ? " ku-minus" : "";
            }
            zeile.add(new St.Label({text: text, style_class: "ku-zeile-aenderung" + klasse,
                                    y_align: Clutter.ActorAlign.CENTER}));
        }
        zeile.add(new St.Label({text: wert, style_class: "ku-zeile-wert"}));
        this.liste.add_actor(zeile);
    }

    _zeichnen() {
        let T = TEXTE;
        let jetzt = GLib.DateTime.new_now_local();
        let zeit = unix => {
            let d = GLib.DateTime.new_from_unix_local(unix || 0);
            return d.format(d.format("%F") === jetzt.format("%F") ? "%H:%M" : "%-d.%-m. %H:%M");
        };
        this.menuNeu.label.set_text(T.neu);
        this.lKopf.set_text(T.titel);
        this.liste.destroy_all_children();
        this.lStatus.set_style_class_name("ku-status" + (this.fehler ? " ku-fehler" : ""));

        let w = this.daten && this.daten.waehrungen, m = this.daten && this.daten.metalle;
        let basisDef = this.werte.waehrungen.filter(x => x[0] === this.basis)[0] || ["EUR", "Euro", "€"];
        let symbol = basisDef[2];
        let fremd = this.richtung === "fremd";
        // Betrag zum Umrechnen: alle Währungszeilen gelten für so viele Einheiten
        let betrag = Math.max(1, Math.round(this.betrag) || 1);
        let tage = ZEITRAUM[this.zeitraum] || 1;
        let seit = tage === 30 ? T.seitMonat : tage === 7 ? T.seitWoche : T.seitTag;
        let proz = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + prozentText(zahl(Math.abs(v), 2));
        this.lUnter.set_text(fremd ? (betrag > 1 ? T.fremdN.format(zahl(betrag, 0), basisDef[1]) : T.fremd.format(basisDef[1]))
                                   : T.basis.format(zahl(betrag, 0), basisDef[1]));
        if (!w && !m) {
            this.lUnter.hide();
            this.lStatus.set_text(this.fehler ? T.fehler : T.laden);
            return;
        }
        this.lUnter.show();

        // Währungen in der Reihenfolge aus den Einstellungen; die Basiswährung selbst steht nicht in der Liste
        let zeilen = 0;
        let gewaehlt = this._auswahl(this.waehrungen, this.werte.waehrungen).filter(x => x[0] !== this.basis);
        if (w && gewaehlt.length) {
            this._rubrik(T.waehrungen);
            for (let x of gewaehlt) {
                let preis = this._inBasis(w.kurse, x[0]);           // 1 fremde = preis Basis
                let vor = this._inBasis(w.vortag || {}, x[0]);
                if (!preis)
                    continue;
                let wert = fremd ? preis : 1 / preis;
                let vorWert = vor ? (fremd ? vor : 1 / vor) : null;
                // Verlauf in der gezeigten Richtung; ohne Verlauf im Zwischenspeicher bleibt der Vergleich zum Vortag
                let reihe = this._reiheWaehrung(w, x[0]).map(p => ({tag: p.tag, wert: fremd ? p.wert : 1 / p.wert}));
                let aenderung = reihe.length > 1 ? this._aenderung(reihe, tage)
                    : vorWert && tage === 1 ? (wert / vorWert - 1) * 100 : null;
                let fenster = reihe.filter(p => p.tag > reihe[reihe.length - 1].tag - VERLAUF_TAGE).map(p => p.wert);
                let gezeigt = wert * betrag;
                this._zeile(this["zeige-kuerzel"] ? x[0] : x[1],
                            // ein umgerechneter Betrag steht wie Geld mit zwei Stellen da, ein Kurs mit mehr
                            zahl(gezeigt, betrag > 1 ? 2 : kursStellen(gezeigt)) + (fremd ? " " + symbol : this["zeige-kuerzel"] ? "" : " " + x[2]),
                            aenderung,
                            // Tooltip: voller Name, der Kurs in beiden Richtungen, Veränderung, Spanne und Vortag
                            [x[1] + " (" + x[0] + ")",
                             "1 " + x[0] + " = " + zahl(preis, kursStellen(preis)) + " " + this.basis,
                             "1 " + this.basis + " = " + zahl(1 / preis, kursStellen(1 / preis)) + " " + x[0]]
                                .concat(typeof aenderung === "number" ? [seit.format(proz(Math.round(aenderung * 100) / 100))] : [])
                                .concat(fenster.length > 1 ? [T.spanne.format(zahl(Math.min.apply(null, fenster), kursStellen(wert)),
                                                                               zahl(Math.max.apply(null, fenster), kursStellen(wert)))] : [])
                                .concat(vorWert ? [T.vortag.format(zahl(vorWert, kursStellen(vorWert)))] : []).join("\n"),
                            reihe.length > 1 ? reihe : null);
                zeilen++;
            }
        }

        // Edelmetalle: Quelle liefert USD je Feinunze -> Basiswährung und gewählte Einheit
        let metalle = this._auswahl(this.metalle, this.werte.metalle);
        let einheit = EINHEITEN[this.einheit] || EINHEITEN.g;
        let usd = w ? this._inBasis(w.kurse, "USD") : null;         // 1 USD in Basiswährung
        if (m && usd && metalle.length) {
            this._rubrik(T.metalle + " · " + einheit.text.toUpperCase());
            for (let x of metalle) {
                let preis = m.preise && m.preise[x[0]];
                if (!preis)
                    continue;
                let vor = m.vortag && m.vortag[x[0]];
                let wert = preis * usd / einheit.teiler;
                // Verlauf aus den gemerkten Tagespreisen (in USD); für die Veränderung reicht das Verhältnis
                let reihe = this._reiheMetall(m, x[0]);
                let aenderung = reihe.length > 1 ? this._aenderung(reihe, tage) : null;
                if (aenderung === null && vor && tage === 1)
                    aenderung = (preis / vor - 1) * 100;
                // Tooltip: der Preis in allen drei Einheiten
                let inEinheit = e => zahl(preis * usd / EINHEITEN[e].teiler, 2) + " " + symbol + " " + EINHEITEN[e].text;
                this._zeile(x[1], zahl(wert, wert >= 10000 ? 0 : 2) + " " + symbol, aenderung,
                            [x[1], inEinheit("g"), inEinheit("oz"), inEinheit("kg")]
                                .concat(typeof aenderung === "number" ? [seit.format(proz(Math.round(aenderung * 100) / 100))] : []).join("\n"),
                            reihe.length > 1 ? reihe : null);
                zeilen++;
            }
            // Nisab: Wert von 80,18 g Gold in der Basiswährung
            let gold = m.preise && m.preise.XAU;
            if (this.zeigeNisab && gold) {
                this._zeile(T.nisab, zahl(gold * usd / UNZE * NISAB_GRAMM, 0) + " " + symbol, null, T.tipNisab, null);
                zeilen++;
            }
        }

        let ezb = w ? (() => { let t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w.datum || ""); return t ? +t[3] + "." + +t[2] + "." : "–"; })() : null;
        if (this.fehler)
            this.lStatus.set_text(T.fehlerStand.format(zeit(Math.max(this.daten.stand_waehrungen || 0, this.daten.stand_metalle || 0))));
        else if (!zeilen)
            this.lStatus.set_text(T.nichts);
        else if (w && m && metalle.length && gewaehlt.length)
            this.lStatus.set_text(T.stand.format(ezb, zeit(this.daten.stand_metalle)));
        else if (m && metalle.length)
            this.lStatus.set_text(T.standM.format(zeit(this.daten.stand_metalle)));
        else
            this.lStatus.set_text(T.standW.format(ezb));
    }
}

function main(metadata, desklet_id) {
    return new KurseDesklet(metadata, desklet_id);
}
