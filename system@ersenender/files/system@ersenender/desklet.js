// System - CPU load with history, temperatures, fan, free disk space and memory, top consumers
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// System-Desklet: CPU-Auslastung mit Verlauf, freier Platz der Systemplatte, Temperatur von Prozessor und
// Grafik, Lüfterdrehzahl, freier Arbeitsspeicher – und wer gerade am meisten Rechenzeit und Speicher braucht.
// Fast alles kommt direkt aus /proc und /sys (hwmon); für die größten Verbraucher wird alle paar Sekunden
// `top` gefragt, für NVIDIA-Karten nvidia-smi.
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Tooltips = imports.ui.tooltips;
const Main = imports.ui.main;

const Gettext = imports.gettext;
const UUID = "system@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const HWMON = "/sys/class/hwmon";
const CPU_FUEHLER = ["coretemp", "k10temp", "zenpower", "cpu_thermal", "soc_thermal"];
const GPU_FUEHLER = ["amdgpu", "radeon", "nouveau"];
const NVIDIA_ALLE = 5;              // Sekunden zwischen zwei nvidia-smi-Aufrufen
const TOP_ALLE = 6;                 // Sekunden zwischen zwei Abfragen der größten Verbraucher
const VERLAUF = 60;                 // so viele Messwerte zeigt die Kurve der CPU-Auslastung

const FARBEN = {
    kurve: [255 / 255, 203 / 255, 8 / 255, 1],
    flaeche: [255 / 255, 203 / 255, 8 / 255, 0.22],
    grund: [242 / 255, 239 / 255, 230 / 255, 0.14],
};

const TEXTE = {
    titel: _("System"),
    last: _("CPU load"),
    platte: _("System disk free"),
    knapp: _("⚠ Less than %s GB free"),
    knappTitel: _("System disk almost full"),
    knappText: _("Only %s GB left."),
    cpu: _("CPU temperature"),
    gpu: _("GPU temperature"),
    ram: _("RAM free"),
    imCpu: _("in the processor"),
    gesamt: _("%s of %s GB used"),
    kerne: _("%d cores"),
    tipFrei: _("%s GB free of %s GB"),
    tipBelegt: _("%s GB used (%s)"),
    tipWarn: _("Warning from %s °C"),
    tipPlatteWarn: _("Warning below %s GB"),
    verbraucher: _("Top consumers"),
    luefter: _("Fan"),
    upm: _("%s rpm"),
    tipSeit: _("Up for %s"),
    tipLastavg: _("Load (1, 5, 15 min): %s"),
    tipSwap: _("Swap: %s of %s GB used"),
    tage: _("%d d"),
    std: _("%s h"),
    tipProzess: _("%s (process %s)"),
    tipAnteil: _("Share of all %d cores"),
    tipVerlauf: _("History of the last %d seconds"),
};

// Alle Dateizugriffe laufen nicht blockierend (Gio …_async): das Desklet teilt sich den Faden mit dem
// ganzen Desktop, ein hängendes Dateisystem würde sonst Cinnamon anhalten.

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
                liste.next_files_async(500, GLib.PRIORITY_DEFAULT, null, (l, erg) => {
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

// Ziel eines symbolischen Links -> Promise<Text | "">
function linkZiel(pfad) {
    return new Promise(fertig => {
        Gio.File.new_for_path(pfad).query_info_async(
            "standard::symlink-target", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null,
            (datei, ergebnis) => {
                try {
                    fertig(datei.query_info_finish(ergebnis).get_symlink_target() || "");
                } catch (e) {
                    fertig("");
                }
            });
    });
}

// Startet ein Programm, ohne Cinnamon anzuhalten; liefert dessen Ausgabe, bei einem Fehler null.
// umgebung: zusätzliche Umgebungsvariablen, z. B. {LC_ALL: "C"}
function starten(argv, umgebung) {
    return new Promise(fertig => {
        try {
            let starter = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            for (let k in umgebung || {})
                starter.setenv(k, umgebung[k], true);
            let prozess = starter.spawnv(argv);
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

function komma(zahl) {
    return zahl.toFixed(1).replace(".", DEZIMAL);
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

class SystemDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        farbeHuelle(this);
        this.timeout = 0;
        this.cpuVorher = null;
        this.nvidiaTemp = null;
        this.nvidiaZuletzt = 0;
        this.nvidiaLaeuft = false;
        this.topZuletzt = 0;
        this.topLaeuft = false;
        this.topCpu = null;                 // {name, pid, wert} – größter Verbraucher an Rechenzeit
        this.topRam = null;                 // … an Arbeitsspeicher (wert in GB)
        this.lastVerlauf = [];
        this.fanDateien = [];

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bind("akzent", "akzent", this._farbe);
        this.settings.bind("akzent-eigen", "akzentEigen", this._farbe);
        this.settings.bind("hintergrund", "hintergrund", this._farbe);
        this.settings.bind("takt", "takt", this._taktNeu);
        this.settings.bind("warn-ab", "warnAb", this._zeichnen);
        this.settings.bind("zeige-modell", "zeigeModell", this._zeichnen);
        this.settings.bind("zeige-platte", "zeigePlatte", this._zeichnen);
        this.settings.bind("zeige-verlauf", "zeigeVerlauf", this._zeichnen);
        this.settings.bind("zeige-luefter", "zeigeLuefter", this._zeichnen);
        this.settings.bind("zeige-prozesse", "zeigeProzesse", this._zeichnen);
        this.settings.bind("platte-warn-ab", "platteWarnAb", this._zeichnen);
        this.settings.bind("platte-melden", "platteMelden");
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this.cpuDateien = [];
        this.gpuDateien = [];
        this.gpuArt = "keine";              // "fuehler" | "nvidia" | "cpu" (im Prozessor) | "keine"
        this.modell = "";
        this.kerne = 0;
        this.liest = false;                 // ein Messdurchgang läuft noch
        this.entfernt = false;
        this._bauen();
        this.setHeader(_(metadata.name));
    }

    on_desklet_added_to_desktop() {
        this._farbe();
        this._stil();
        this._zeichnen();
        // erst die Fühler suchen (einmalig), dann die erste Messung
        this._fuehlerSuchen()
            .catch(e => global.logError("system@ersenender: Fühlersuche fehlgeschlagen: " + e))
            .then(() => this._messen());
        this._taktNeu();
    }

    on_desklet_removed() {
        farbeEntfernen(this);
        this.entfernt = true;               // laufende Messungen zeichnen dann nichts mehr
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
            this.timeout = 0;
        }
    }

    _taktNeu() {
        if (this.timeout)
            Mainloop.source_remove(this.timeout);
        this.timeout = Mainloop.timeout_add_seconds(Math.max(1, this.takt), () => this._tick());
    }

    // ------------------------------------------------------------ Fühler

    // Einmal beim Start: welche hwmon-Dateien liefern CPU- und GPU-Temperatur?
    async _fuehlerSuchen() {
        let cpu = [], gpu = [], ersatz = [];        // ersatz: z. B. Laptop-Fühler mit Beschriftung „CPU“
        let fan = [];
        for (let h of await ordner(HWMON)) {
            let basis = HWMON + "/" + h;
            let [name, dateien] = await Promise.all([lesen(basis + "/name"), ordner(basis)]);
            let temps = dateien.filter(n => /^temp\d+_input$/.test(n));
            fan = fan.concat(dateien.filter(n => /^fan\d+_input$/.test(n)).map(n => basis + "/" + n));
            if (CPU_FUEHLER.indexOf(name) >= 0)
                cpu = cpu.concat(temps.map(t => basis + "/" + t));
            else if (GPU_FUEHLER.indexOf(name) >= 0)
                gpu = gpu.concat(temps.map(t => basis + "/" + t));
            else {
                let schilder = await Promise.all(temps.map(t => lesen(basis + "/" + t.replace("_input", "_label"))));
                temps.forEach((t, i) => {
                    if (/^cpu/i.test(schilder[i] || ""))
                        ersatz.push(basis + "/" + t);
                });
            }
        }
        if (!cpu.length)
            cpu = ersatz;
        if (!cpu.length) {
            let zonen = (await ordner("/sys/class/thermal")).filter(z => /^thermal_zone/.test(z));
            let arten = await Promise.all(zonen.map(z => lesen("/sys/class/thermal/" + z + "/type")));
            zonen.forEach((z, i) => {
                if (/pkg|cpu|soc/i.test(arten[i] || ""))
                    cpu.push("/sys/class/thermal/" + z + "/temp");
            });
        }

        let art = "keine";
        if (gpu.length)
            art = "fuehler";
        else if (GLib.find_program_in_path("nvidia-smi"))
            art = "nvidia";
        else {
            let karten = (await ordner("/sys/class/drm")).filter(k => /^card\d+$/.test(k));
            let treiber = await Promise.all(karten.map(k => linkZiel("/sys/class/drm/" + k + "/device/driver")));
            if (treiber.some(t => /\/(i915|xe)$/.test(t)))
                art = "cpu";                // Intel-Grafik sitzt im Prozessor und hat keinen eigenen Fühler
        }

        let cpuinfo = (await lesen("/proc/cpuinfo")) || "";
        let modell = /model name\s*:\s*(.+)/.exec(cpuinfo);
        this.cpuDateien = cpu;
        this.fanDateien = fan;
        this.gpuDateien = gpu;
        this.gpuArt = art;
        this.modell = modell ? modell[1].replace(/\((R|TM)\)/g, "").replace(/\bCPU\b|@.*$/g, "")
                                        .replace(/\s+/g, " ").trim() : "";
        this.kerne = (cpuinfo.match(/^processor\s*:/gm) || []).length;
    }

    // höchster Wert der Dateien in °C (hwmon und thermal_zone liefern Milligrad)
    async _temperatur(dateien) {
        let max = null;
        for (let text of await Promise.all(dateien.map(d => lesen(d)))) {
            let v = parseInt(text);
            if (!isNaN(v) && v > 0 && (max === null || v > max))
                max = v;
        }
        return max === null ? null : max / 1000;
    }

    _nvidiaFragen() {
        let jetzt = GLib.get_monotonic_time() / 1e6;
        if (this.nvidiaLaeuft || jetzt - this.nvidiaZuletzt < NVIDIA_ALLE)
            return;
        this.nvidiaLaeuft = true;
        this.nvidiaZuletzt = jetzt;
        starten(["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"]).then(aus => {
            this.nvidiaLaeuft = false;
            let v = parseInt(aus);
            this.nvidiaTemp = aus !== null && !isNaN(v) ? v : null;
        });
    }

    // Größte Verbraucher: `top` misst über eine halbe Sekunde (zweiter Durchgang), daraus der Prozess mit
    // der meisten Rechenzeit und der mit dem meisten Arbeitsspeicher. Läuft nebenher, höchstens alle TOP_ALLE s.
    _prozesseFragen() {
        let jetzt = GLib.get_monotonic_time() / 1e6;
        if (this.topLaeuft || jetzt - this.topZuletzt < TOP_ALLE)
            return;
        this.topLaeuft = true;
        this.topZuletzt = jetzt;
        starten(["top", "-b", "-n", "2", "-d", "0.5", "-w", "200"], {LC_ALL: "C"}).then(aus => {
            this.topLaeuft = false;
            if (aus === null || this.entfernt)
                return;
            let bloecke = aus.split(/^\s*PID\s+USER.*$/m);
            let cpu = null, ram = null;
            for (let zeile of bloecke[bloecke.length - 1].split("\n")) {
                let f = zeile.trim().split(/\s+/);
                if (f.length < 12 || !/^\d+$/.test(f[0]))
                    continue;
                let name = f.slice(11).join(" ");
                if (name === "top")
                    continue;
                let last = parseFloat(f[8]);
                let m = /^([\d.]+)([mgt]?)$/i.exec(f[5]);            // RES: KiB, sonst mit m/g/t
                let gb = m ? parseFloat(m[1]) * {"": 1 / 1048576, m: 1 / 1024, g: 1, t: 1024}[m[2].toLowerCase()] : NaN;
                if (!isNaN(last) && (!cpu || last > cpu.wert))
                    cpu = {name: name, pid: f[0], wert: last};
                if (!isNaN(gb) && (!ram || gb > ram.wert))
                    ram = {name: name, pid: f[0], wert: gb};
            }
            // top zählt je Kern (100 % = ein Kern); hier als Anteil an allen Kernen, wie die Auslastung oben
            if (cpu)
                cpu.wert = cpu.wert / Math.max(1, this.kerne);
            this.topCpu = cpu;
            this.topRam = ram;
        });
    }

    // höchste Lüfterdrehzahl in U/min (null, wenn der Rechner keine meldet)
    async _luefter() {
        let max = null;
        for (let text of await Promise.all(this.fanDateien.map(d => lesen(d)))) {
            let v = parseInt(text);
            if (!isNaN(v) && (max === null || v > max))
                max = v;
        }
        return max;
    }

    // Laufzeit in Sekunden und die drei Lastwerte
    async _laufzeit() {
        let [up, last] = await Promise.all([lesen("/proc/uptime"), lesen("/proc/loadavg")]);
        let sek = parseFloat(up);
        return {sek: isNaN(sek) ? null : sek, last: last ? last.split(/\s+/).slice(0, 3) : null};
    }

    // Auslastung in % seit dem letzten Aufruf (null beim ersten)
    async _last() {
        let z = /^cpu\s+(.+)$/m.exec((await lesen("/proc/stat")) || "");
        if (!z)
            return null;
        let w = z[1].trim().split(/\s+/).map(Number);
        let leer = w[3] + (w[4] || 0);                              // idle + iowait
        let summe = w.slice(0, 8).reduce((a, b) => a + b, 0);       // ohne guest (steckt schon in user)
        let vorher = this.cpuVorher;
        this.cpuVorher = {leer: leer, summe: summe};
        if (!vorher || summe <= vorher.summe)
            return null;
        return 100 * (1 - (leer - vorher.leer) / (summe - vorher.summe));
    }

    async _speicher() {
        let t = (await lesen("/proc/meminfo")) || "";
        let gesamt = /^MemTotal:\s+(\d+)/m.exec(t), frei = /^MemAvailable:\s+(\d+)/m.exec(t);
        if (!gesamt || !frei)
            return null;
        let swGesamt = /^SwapTotal:\s+(\d+)/m.exec(t), swFrei = /^SwapFree:\s+(\d+)/m.exec(t);
        return {gesamt: gesamt[1] / 1048576, frei: frei[1] / 1048576,       // kB -> GB
                swap: swGesamt && swFrei && swGesamt[1] > 0
                    ? {gesamt: swGesamt[1] / 1048576, belegt: (swGesamt[1] - swFrei[1]) / 1048576} : null};
    }

    // Systemplatte (Dateisystem von /): Größe und für den Benutzer freier Platz in GB
    _platte() {
        return new Promise(fertig => {
            Gio.File.new_for_path("/").query_filesystem_info_async(
                "filesystem::size,filesystem::free", GLib.PRIORITY_DEFAULT, null, (datei, ergebnis) => {
                    try {
                        let info = datei.query_filesystem_info_finish(ergebnis);
                        let gesamt = info.get_attribute_uint64("filesystem::size");
                        let frei = info.get_attribute_uint64("filesystem::free");
                        fertig(gesamt > 0 ? {gesamt: gesamt / 1073741824, frei: frei / 1073741824} : null);
                    } catch (e) {
                        fertig(null);
                    }
                });
        });
    }

    // ------------------------------------------------------------ Aufbau

    // großer Wert mit Balken darunter, wie die CPU-Auslastung
    _block(zusatzKlasse) {
        let box = new St.BoxLayout({vertical: true, style_class: "sy-last-box" + (zusatzKlasse || "")});
        let titel = new St.Label({style_class: "sy-last-titel"});
        let wert = new St.Label({style_class: "sy-last"});
        let spur = new St.BoxLayout({style_class: "sy-spur"});
        let balken = new St.Widget({style_class: "sy-balken"});
        let warnung = new St.Label({style_class: "sy-warnung", visible: false});
        spur.add_actor(balken);
        box.add_actor(titel);
        box.add_actor(wert);
        box.add_actor(spur);
        box.add_actor(warnung);
        this.box.add_actor(box);
        return {box: box, titel: titel, wert: wert, spur: spur, balken: balken, warnung: warnung};
    }

    // anteil 0..1 oder null; rot = Warnfarbe
    _balkenSetzen(b, anteil, rot) {
        let breite = b.spur.get_width();
        b.balken.set_width(anteil === null || breite <= 0 ? 0 : Math.max(2, Math.round(breite * anteil)));
        b.balken.set_style_class_name("sy-balken" + (rot ? " sy-heiss-balken" : ""));
    }

    _zeile(ziel) {
        let zeile = new St.BoxLayout({style_class: "sy-zeile"});
        let links = new St.BoxLayout({vertical: true});
        let name = new St.Label({style_class: "sy-zeile-name"});
        let zusatz = new St.Label({style_class: "sy-zeile-zusatz"});
        let wert = new St.Label({style_class: "sy-zeile-wert", y_align: imports.gi.Clutter.ActorAlign.CENTER});
        links.add_actor(name);
        links.add_actor(zusatz);
        zeile.add(links, {expand: true, x_fill: true});
        zeile.add(wert);
        (ziel || this.zeilenBox).add_actor(zeile);
        return {zeile: zeile, name: name, zusatz: zusatz, wert: wert};
    }

    _bauen() {
        this.box = new St.BoxLayout({vertical: true, style_class: "sy-box"});
        this.lKopf = new St.Label({style_class: "sy-kopf"});
        this.lModell = new St.Label({style_class: "sy-modell"});
        this.box.add_actor(this.lKopf);
        this.box.add_actor(this.lModell);

        this.bLast = this._block();
        // Verlauf der Auslastung als Kurve (Zeichenfläche ohne eigene Breite – sie füllt, was sie bekommt)
        this.verlauf = new St.DrawingArea({style_class: "sy-verlauf"});
        this.verlauf.connect("repaint", flaeche => this._verlaufMalen(flaeche));
        this.bLast.box.add(this.verlauf, {x_fill: true});
        this.bPlatte = this._block(" sy-folge-box");

        this.zeilenBox = new St.BoxLayout({vertical: true, style_class: "sy-zeilen"});
        this.zCpu = this._zeile();
        this.zGpu = this._zeile();
        this.zFan = this._zeile();
        this.zRam = this._zeile();
        this.box.add_actor(this.zeilenBox);

        // größte Verbraucher: je eine Zeile für Rechenzeit und Arbeitsspeicher
        this.prozessBox = new St.BoxLayout({vertical: true, style_class: "sy-prozesse"});
        this.lProzesse = new St.Label({style_class: "sy-abschnitt"});
        this.prozessBox.add_actor(this.lProzesse);
        this.zTopCpu = this._zeile(this.prozessBox);
        this.zTopRam = this._zeile(this.prozessBox);
        for (let z of [this.zTopCpu, this.zTopRam]) {
            z.name.clutter_text.ellipsize = imports.gi.Pango.EllipsizeMode.END;
            z.zusatz.hide();
        }
        this.box.add_actor(this.prozessBox);

        this.lStatus = new St.Label({style_class: "sy-status"});
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
                           "background-color: rgba(" + FARBE.grund.join(", ") + ", " + a.toFixed(2) + ");" +
                           (this.randRot ? " border: 1px solid #ff7b72;" : ""));     // Warnung: roter Rand
        this.verlauf.set_height(Math.round(30 * this.groesse));
    }

    // ------------------------------------------------------------ Anzeige

    // Kurve der CPU-Auslastung: neuester Wert rechts, Fläche darunter gefüllt
    _verlaufMalen(flaeche) {
        let cr = flaeche.get_context();
        let [w, h] = flaeche.get_surface_size();
        let werte = this.lastVerlauf;
        let farbe = f => cr.setSourceRGBA(f[0], f[1], f[2], f[3]);
        let rand = Math.round(w * 0.035), oben = 2, unten = h - 1.5;
        let breite = w - 2 * rand, schritt = breite / (VERLAUF - 1);
        farbe(FARBEN.grund);
        cr.setLineWidth(1);
        cr.moveTo(rand, unten);
        cr.lineTo(w - rand, unten);
        cr.stroke();
        if (werte.length > 1) {
            let x0 = w - rand - (werte.length - 1) * schritt;
            let y = v => unten - (unten - oben) * Math.max(0, Math.min(100, v)) / 100;
            cr.moveTo(x0, unten);
            werte.forEach((v, i) => cr.lineTo(x0 + i * schritt, y(v)));
            cr.lineTo(w - rand, unten);
            cr.closePath();
            farbe(FARBEN.flaeche);
            cr.fill();
            werte.forEach((v, i) => i ? cr.lineTo(x0 + i * schritt, y(v)) : cr.moveTo(x0, y(v)));
            farbe(FARBEN.kurve);
            cr.setLineWidth(1.4);
            cr.setLineJoin(1);
            cr.stroke();
        }
        cr.$dispose();
    }

    // Timer-Rückruf: stößt eine Messung an und kehrt sofort zurück
    _tick() {
        this._messen();
        return GLib.SOURCE_CONTINUE;
    }

    // Eine Messung: alles gleichzeitig lesen, dann zeichnen. Läuft die vorige noch, wird diese ausgelassen.
    async _messen() {
        if (this.liest || this.entfernt)
            return;
        this.liest = true;
        try {
            let [last, cpuTemp, gpuFuehler, ram, platte, fan, laufzeit] = await Promise.all([
                this._last(), this._temperatur(this.cpuDateien),
                this.gpuArt === "fuehler" ? this._temperatur(this.gpuDateien) : Promise.resolve(null),
                this._speicher(), this._platte(), this._luefter(), this._laufzeit()]);
            if (this.entfernt)
                return;
            this.last = last;
            if (typeof last === "number") {
                this.lastVerlauf.push(last);
                if (this.lastVerlauf.length > VERLAUF)
                    this.lastVerlauf.shift();
            }
            this.fan = fan;
            this.laufzeit = laufzeit;
            if (this.zeigeProzesse)
                this._prozesseFragen();
            this.cpuTemp = cpuTemp;
            if (this.gpuArt === "fuehler")
                this.gpuTemp = gpuFuehler;
            else if (this.gpuArt === "nvidia") {
                this._nvidiaFragen();
                this.gpuTemp = this.nvidiaTemp;
            } else
                this.gpuTemp = this.gpuArt === "cpu" ? cpuTemp : null;
            this.ram = ram;
            this.platte = platte;
            this._zeichnen();
        } catch (e) {
            global.logError("system@ersenender: Messung fehlgeschlagen: " + e);
        } finally {
            this.liest = false;
        }
    }

    _tempZeile(z, name, temp, zusatz) {
        z.name.set_text(name);
        z.zusatz.set_text(zusatz || "");
        z.zusatz.visible = !!zusatz;
        z.wert.set_text(typeof temp === "number" ? Math.round(temp) + " °C" : "–");
        z.wert.set_style_class_name("sy-zeile-wert" + (typeof temp === "number" && temp >= this.warnAb ? " sy-heiss" : ""));
        this._tip(z.zeile, [name + (zusatz ? " (" + zusatz + ")" : "") + ": " + (typeof temp === "number" ? komma(temp) + " °C" : "–"),
                            TEXTE.tipWarn.format(this.warnAb)].join("\n"));
    }

    _zeichnen() {
        let T = TEXTE;
        this.lKopf.set_text(T.titel);
        this.lModell.set_text([this.modell, this.kerne ? T.kerne.format(this.kerne) : ""].filter(s => s).join(" · "));
        this.lModell.visible = this.zeigeModell && !!this.modell;

        this.bLast.titel.set_text(T.last);
        let last = typeof this.last === "number" ? Math.max(0, Math.min(100, this.last)) : null;
        this.bLast.wert.set_text(last === null ? "–" : prozentText(Math.round(last)));
        this._balkenSetzen(this.bLast, last === null ? null : last / 100, last !== null && last >= 90);
        // Tooltips: der genaue Wert und was dahintersteht – auch wenn die Modellzeile ausgeblendet ist
        // … dazu Laufzeit, Lastwerte und was die Kurve zeigt
        let seit = "";
        if (this.laufzeit && this.laufzeit.sek !== null) {
            let min = Math.floor(this.laufzeit.sek / 60), tage = Math.floor(min / 1440);
            let rest = Math.floor(min % 1440 / 60) + ":" + (min % 60 < 10 ? "0" : "") + min % 60;
            seit = T.tipSeit.format((tage ? T.tage.format(tage) + " " : "") + T.std.format(rest));
        }
        this._tip(this.bLast.box, [T.last + ": " + (last === null ? "–" : prozentText(Math.round(last))),
                                   this.zeigeVerlauf ? T.tipVerlauf.format(VERLAUF * Math.max(1, this.takt)) : "",
                                   this.laufzeit && this.laufzeit.last ? T.tipLastavg.format(this.laufzeit.last.join(" · ")) : "",
                                   seit, this.modell, this.kerne ? T.kerne.format(this.kerne) : ""].filter(s => s).join("\n"));
        this.verlauf.visible = this.zeigeVerlauf;
        this.bLast.spur.visible = !this.zeigeVerlauf;      // Kurve statt Balken
        this.verlauf.queue_repaint();

        // Systemplatte: Zahl = frei, Balken = belegt
        this.bPlatte.box.visible = this.zeigePlatte && !!this.platte;
        if (this.platte) {
            // Warnung ab der eingestellten Grenze in GB (0 = nie): rot, Hinweiszeile, roter Kartenrand
            let p = this.platte, grenze = Math.max(0, this.platteWarnAb);
            let knapp = grenze > 0 && p.frei < grenze;
            this.bPlatte.warnung.set_text(T.knapp.format(komma(grenze).replace(",0", "")));
            this.bPlatte.warnung.visible = knapp;
            if (this.randRot !== (knapp && this.zeigePlatte)) {
                this.randRot = knapp && this.zeigePlatte;
                this._stil();
            }
            // einmal melden, wenn die Grenze unterschritten wird – nicht bei jedem Takt
            if (knapp && !this.platteGemeldet && this.platteMelden)
                Main.warningNotify(T.knappTitel, T.knappText.format(komma(p.frei)));
            this.platteGemeldet = knapp;
            this.bPlatte.titel.set_text(T.platte);
            this.bPlatte.wert.set_text((p.frei >= 100 ? Math.round(p.frei) : komma(p.frei)) + " GB");
            this.bPlatte.wert.set_style_class_name("sy-last" + (knapp ? " sy-heiss" : ""));
            this._balkenSetzen(this.bPlatte, 1 - p.frei / p.gesamt, knapp);
            this._tip(this.bPlatte.box, [T.platte, T.tipFrei.format(komma(p.frei), komma(p.gesamt)),
                                         T.tipBelegt.format(komma(p.gesamt - p.frei), prozentText(Math.round(100 * (1 - p.frei / p.gesamt))))]
                .concat(grenze > 0 ? [T.tipPlatteWarn.format(komma(grenze).replace(",0", ""))] : []).join("\n"));
        }

        this._tempZeile(this.zCpu, T.cpu, this.cpuTemp);
        this._tempZeile(this.zGpu, T.gpu, this.gpuTemp, this.gpuArt === "cpu" ? T.imCpu : "");
        this.zGpu.zeile.visible = this.gpuArt !== "keine";

        // Lüfter: nur, wenn der Rechner eine Drehzahl meldet
        this.zFan.zeile.visible = this.zeigeLuefter && typeof this.fan === "number";
        this.zFan.name.set_text(T.luefter);
        this.zFan.zusatz.hide();
        if (typeof this.fan === "number")
            this.zFan.wert.set_text(T.upm.format(this.fan));

        // größte Verbraucher
        let c = this.topCpu, r = this.topRam;
        this.prozessBox.visible = this.zeigeProzesse && !!(c || r);
        this.lProzesse.set_text(T.verbraucher);
        this.zTopCpu.zeile.visible = !!c;
        if (c) {
            this.zTopCpu.name.set_text("CPU · " + c.name);
            this.zTopCpu.wert.set_text(prozentText(Math.round(c.wert)));
            this._tip(this.zTopCpu.zeile, [T.tipProzess.format(c.name, c.pid),
                                           T.last + ": " + prozentText(komma(c.wert)),
                                           T.tipAnteil.format(Math.max(1, this.kerne))].join("\n"));
        }
        this.zTopRam.zeile.visible = !!r;
        if (r) {
            this.zTopRam.name.set_text("RAM · " + r.name);
            this.zTopRam.wert.set_text(r.wert >= 1 ? komma(r.wert) + " GB" : Math.round(r.wert * 1024) + " MB");
            this._tip(this.zTopRam.zeile, T.tipProzess.format(r.name, r.pid));
        }

        this.zRam.name.set_text(T.ram);
        this.zRam.zusatz.hide();
        if (this.ram) {
            this.zRam.wert.set_text(komma(this.ram.frei) + " GB");
            this.zRam.wert.set_style_class_name("sy-zeile-wert" + (this.ram.frei / this.ram.gesamt < 0.1 ? " sy-heiss" : ""));
            this.lStatus.set_text(T.gesamt.format(komma(this.ram.gesamt - this.ram.frei), komma(this.ram.gesamt)));
            this._tip(this.zRam.zeile, [T.ram, T.tipFrei.format(komma(this.ram.frei), komma(this.ram.gesamt)),
                                        T.tipBelegt.format(komma(this.ram.gesamt - this.ram.frei),
                                                           prozentText(Math.round(100 * (1 - this.ram.frei / this.ram.gesamt))))]
                .concat(this.ram.swap ? [T.tipSwap.format(komma(this.ram.swap.belegt), komma(this.ram.swap.gesamt))] : []).join("\n"));
        } else {
            this.zRam.wert.set_text("–");
            this._tip(this.zRam.zeile, "");
            this.lStatus.set_text("");
        }
    }
}

function main(metadata, desklet_id) {
    return new SystemDesklet(metadata, desklet_id);
}
