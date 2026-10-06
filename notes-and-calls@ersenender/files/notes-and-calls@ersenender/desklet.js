// Notes and Calls - Notes and call notes of phone calls on the desktop - quick to add, callbacks in view
// Copyright (C) 2026 ersenender
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. It is distributed WITHOUT ANY WARRANTY; see the file COPYING for details.
//
// Comments and identifiers are in German, the language this desklet was written in.
// Notizen-Desklet: Notizzettel und Gesprächsnotizen von Telefonaten.
// Die Notizen liegen als JSON im Benutzerordner; geschrieben wird in einem kleinen Fenster (helper.py).
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

const Gettext = imports.gettext;
const UUID = "notes-and-calls@ersenender";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

const ORDNER = GLib.build_filenamev([GLib.get_user_state_dir(), UUID]);
const DATEI = GLib.build_filenamev([ORDNER, "notizen.json"]);
const TAKT = 60;

const TEXTE = {
    titel: _("Notes"),
    zettel: _("Notes: %d"),
    rueckrufe: _("%d callback open"),
    rueckrufeN: _("%d callbacks open"),
    leer: _("Nothing noted yet.\nYellow plus: note.\nPhone: call note of a phone call."),
    neuZettel: _("New note …"),
    neuAnruf: _("New call note …"),
    rueckruf: _("Call back"),
    erledigt: _("done"),
    anruf: _("Call"),
    unbekannt: _("Unknown caller"),
    heute: _("today %s"),
    gestern: _("yesterday %s"),
    hinweis: _("Click a note: edit"),
    aufraeumen: _("Remove completed call notes"),
};

function tagNr(dt) {
    return dt.get_year() * 10000 + dt.get_month() * 100 + dt.get_day_of_month();
}

// Programm mit Argumentliste starten (kein Befehlstext für eine Shell), `eingabe` geht an dessen stdin
// -> Promise<Ausgabe | null>; null = nicht startbar oder mit Fehler beendet
function starten(argv, eingabe) {
    return new Promise(fertig => {
        try {
            let prozess = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            prozess.init(null);
            prozess.communicate_utf8_async(eingabe, null, (p, ergebnis) => {
                try {
                    let [, ausgabe] = p.communicate_utf8_finish(ergebnis);
                    fertig(p.get_successful() ? ausgabe : null);
                } catch (e) {
                    fertig(null);
                }
            });
        } catch (e) {
            global.logError("notes-and-calls@ersenender: Fenster nicht startbar: " + e);
            fertig(null);
        }
    });
}

class NotizenDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.helper = GLib.build_filenamev([metadata.path, "helper.py"]);
        this.notizen = [];
        this.timeout = 0;
        this.hoeheIdle = 0;
        this.hoeheNach = 0;
        this.fensterOffen = false;
        this.unlesbar = false;
        this.entfernt = false;
        this.kette = Promise.resolve();     // Datei-Arbeiten laufen nacheinander, nie durcheinander

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        for (let [key, name] of [["ueberschrift", "ueberschrift"], ["liste-zeilen", "listeZeilen"],
                                 ["zeilen-je-zettel", "zeilenJeZettel"]])
            this.settings.bind(key, name, this._zeichnen);
        this.settings.bind("erledigte-tage", "erledigteTage", this._tick);
        this.settings.bind("groesse", "groesse", this._stil);
        this.settings.bind("deckkraft", "deckkraft", this._stil);

        this._bauen();
        this.setHeader(_(metadata.name));

        this.menuZettel = new PopupMenu.PopupMenuItem("");
        this.menuZettel.connect("activate", () => this._schreiben("zettel", null));
        this.menuAnruf = new PopupMenu.PopupMenuItem("");
        this.menuAnruf.connect("activate", () => this._schreiben("anruf", null));
        this.menuAufraeumen = new PopupMenu.PopupMenuItem("");
        this.menuAufraeumen.connect("activate", () => this._nacheinander(async () => {
            await this._laden();
            this.notizen = this.notizen.filter(n => !(n.art === "anruf" && n.erledigt));
            await this._speichern();
            this._zeichnen();
        }));
        this._menu.addMenuItem(this.menuZettel);
        this._menu.addMenuItem(this.menuAnruf);
        this._menu.addMenuItem(this.menuAufraeumen);
    }

    on_desklet_added_to_desktop() {
        this._stil();
        this._tick();
        if (!this.timeout)
            this.timeout = Mainloop.timeout_add_seconds(TAKT, () => this._tick());
    }

    on_desklet_removed() {
        this.entfernt = true;
        for (let quelle of ["timeout", "hoeheIdle", "hoeheNach"]) {
            if (this[quelle]) {
                Mainloop.source_remove(this[quelle]);
                this[quelle] = 0;
            }
        }
    }

    _t() {
        return TEXTE;
    }

    // ------------------------------------------------------------ Daten

    // Alle Dateizugriffe laufen nicht blockierend (Gio …_async): das Desklet teilt sich den Faden mit dem
    // ganzen Desktop. Damit „laden – ändern – speichern“ dabei nicht durcheinandergerät, hängt jede
    // solche Folge an EINE Kette und läuft erst, wenn die vorige fertig ist.
    _nacheinander(arbeit) {
        this.kette = this.kette.then(arbeit).catch(e => global.logError("notes-and-calls@ersenender: " + e));
        return this.kette;
    }

    _laden() {
        return new Promise(fertig => {
            Gio.File.new_for_path(DATEI).load_contents_async(null, (datei, ergebnis) => {
                let text = null;
                try {
                    let [ok, inhalt] = datei.load_contents_finish(ergebnis);
                    text = ok ? ByteArray.toString(inhalt) : null;
                } catch (e) {
                    if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                        this.notizen = [];              // noch nichts gespeichert
                        this.unlesbar = false;
                    } else {
                        this.unlesbar = true;           // Datei da, aber nicht lesbar: nicht anfassen
                        global.logError("notes-and-calls@ersenender: notizen.json nicht lesbar, wird nicht überschrieben: " + e);
                    }
                    fertig();
                    return;
                }
                try {
                    let daten = JSON.parse(text);
                    this.notizen = Array.isArray(daten.notizen) ? daten.notizen.filter(n => n && n.id) : [];
                    this.unlesbar = false;
                } catch (e) {
                    this.unlesbar = true;
                    global.logError("notes-and-calls@ersenender: notizen.json beschädigt, wird nicht überschrieben: " + e);
                }
                fertig();
            });
        });
    }

    _speichern() {
        if (this.unlesbar)          // eine beschädigte Datei nicht mit einer leeren Liste überschreiben
            return Promise.resolve();
        let text = JSON.stringify({version: 1, notizen: this.notizen}, null, 1);
        return new Promise(fertig => {
            let schreiben = () => {
                // PRIVATE: nur für den Benutzer lesbar; geschrieben wird über eine Zwischendatei (kein halber Stand)
                Gio.File.new_for_path(DATEI).replace_contents_bytes_async(
                    new GLib.Bytes(text), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE, null, (datei, ergebnis) => {
                        try {
                            datei.replace_contents_finish(ergebnis);
                        } catch (e) {
                            global.logError("notes-and-calls@ersenender: Speichern fehlgeschlagen: " + e);
                        }
                        fertig();
                    });
            };
            // Ordner anlegen, falls er fehlt („gibt es schon“ ist kein Fehler)
            Gio.File.new_for_path(ORDNER).make_directory_async(GLib.PRIORITY_DEFAULT, null, (ordner, ergebnis) => {
                try {
                    ordner.make_directory_finish(ergebnis);
                } catch (e) {
                    // vorhanden – oder der Fehler zeigt sich gleich beim Schreiben
                }
                schreiben();
            });
        });
    }

    // Timer-Rückruf: stößt das Nachladen an und kehrt sofort zurück
    _tick() {
        this._nacheinander(async () => {
            await this._laden();
            let tage = Math.round(this.erledigteTage);
            if (tage > 0) {
                let grenze = GLib.DateTime.new_now_local().to_unix() - tage * 86400;
                let vorher = this.notizen.length;
                this.notizen = this.notizen.filter(n => !(n.art === "anruf" && n.erledigt && n.erledigt_am < grenze));
                if (this.notizen.length !== vorher)
                    await this._speichern();
            }
            if (!this.entfernt)
                this._zeichnen();
        });
        return GLib.SOURCE_CONTINUE;
    }

    // Rückruf erledigt / wieder offen
    _rueckrufUmschalten(id) {
        this._nacheinander(async () => {
            await this._laden();
            for (let n of this.notizen) {
                if (n.id === id) {
                    n.erledigt = !n.erledigt;
                    n.erledigt_am = n.erledigt ? GLib.DateTime.new_now_local().to_unix() : null;
                }
            }
            await this._speichern();
            this._zeichnen();
        });
    }

    // notiz = null: neu anlegen
    _schreiben(art, notiz) {
        if (this.fensterOffen)
            return;
        this.fensterOffen = true;
        let alt = notiz ? {id: notiz.id, text: notiz.text, wer: notiz.wer, nummer: notiz.nummer,
                           wegen: notiz.wegen, rueckruf: notiz.rueckruf} : {};
        starten(["python3", this.helper, art], JSON.stringify(alt) + "\n").then(stdout => {
            this.fensterOffen = false;
            if (!stdout)
                return;
            let neu;
            try {
                neu = JSON.parse(stdout);
            } catch (e) {
                global.logError("notes-and-calls@ersenender: Antwort des Fensters unlesbar: " + e);
                return;
            }
            this._nacheinander(async () => {
                await this._laden();
                let jetzt = GLib.DateTime.new_now_local().to_unix();
                if (notiz && neu.loeschen) {
                    this.notizen = this.notizen.filter(n => n.id !== notiz.id);
                } else if (!neu.loeschen) {
                    let ziel = notiz ? this.notizen.filter(n => n.id === notiz.id)[0] : null;
                    if (!ziel) {
                        ziel = {id: GLib.uuid_string_random(), art: art, angelegt: jetzt, erledigt: false, erledigt_am: null};
                        this.notizen.push(ziel);
                    }
                    ziel.text = String(neu.text || "");
                    ziel.geaendert = jetzt;
                    if (art === "anruf") {
                        ziel.wer = String(neu.wer || "");
                        ziel.nummer = String(neu.nummer || "");
                        ziel.wegen = String(neu.wegen || "");
                        ziel.rueckruf = !!neu.rueckruf;
                        if (!ziel.rueckruf) {
                            ziel.erledigt = false;
                            ziel.erledigt_am = null;
                        }
                    }
                }
                await this._speichern();
                this._zeichnen();
            });
        });
    }

    // ------------------------------------------------------------ Aufbau

    _knopf(symbol, klasse, aktion) {
        let icon = new St.Icon({icon_name: symbol, icon_type: St.IconType.SYMBOLIC});
        let knopf = new St.Button({style_class: klasse, child: icon, reactive: true, can_focus: true,
                                   y_align: Clutter.ActorAlign.CENTER});
        knopf.connect("clicked", aktion);
        return {knopf: knopf, icon: icon};
    }

    _bauen() {
        this.box = new St.BoxLayout({vertical: true, style_class: "nz-box"});
        let kopf = new St.BoxLayout();
        let links = new St.BoxLayout({vertical: true});
        this.lKopf = new St.Label({style_class: "nz-kopf"});
        this.lUnter = new St.Label({style_class: "nz-unter"});
        links.add_actor(this.lKopf);
        links.add_actor(this.lUnter);
        let knoepfe = new St.BoxLayout({style_class: "nz-knoepfe"});
        this.kAnruf = this._knopf("call-start-symbolic", "nz-neu-zwei", () => this._schreiben("anruf", null));
        this.kZettel = this._knopf("list-add-symbolic", "nz-neu", () => this._schreiben("zettel", null));
        knoepfe.add_actor(this.kAnruf.knopf);
        knoepfe.add_actor(this.kZettel.knopf);
        kopf.add(links, {expand: true, x_fill: true});
        kopf.add(knoepfe, {y_fill: false, y_align: St.Align.MIDDLE});
        this.box.add_actor(kopf);

        this.liste = new St.BoxLayout({vertical: true});
        this.blaettern = new St.ScrollView({style_class: "nz-liste", hscrollbar_policy: St.PolicyType.NEVER,
                                            vscrollbar_policy: St.PolicyType.AUTOMATIC});
        // Rollbalken über dem Inhalt statt daneben: sonst wird die Liste beim Erscheinen des Balkens
        // schmaler, der Text bricht anders um, und die vorher gemessenen Zeilenhöhen stimmen nicht mehr
        if (typeof this.blaettern.set_overlay_scrollbars === "function")
            this.blaettern.set_overlay_scrollbars(true);
        this.blaettern.add_actor(this.liste);
        this.box.add_actor(this.blaettern);
        this.lStatus = new St.Label({style_class: "nz-status"});
        this.box.add_actor(this.lStatus);
        this.setContent(this.box);
    }

    _stil() {
        let a = Math.max(0, Math.min(1, this.deckkraft));
        this.box.set_style("font-size: " + (10 * this.groesse).toFixed(1) + "pt; " +
                           "background-color: rgba(35, 31, 32, " + a.toFixed(2) + ");");
        // Kreisrund: feste, gleiche Breite und Höhe. Ohne das streckt die Kopfzeile den Knopf auf ihre Höhe
        // (zwei Textzeilen) und er wird oval.
        let rund = Math.round(32 * this.groesse);
        for (let k of [this.kAnruf, this.kZettel]) {
            k.knopf.set_size(rund, rund);
            k.icon.set_icon_size(Math.round(16 * this.groesse));
        }
        this._zeichnen();
    }

    // Umbrochener Text. In der Übersicht reichen ein paar Zeilen: der Text wird vorher auf etwa
    // `zeilen` Zeilen gekürzt (… am Ende); den ganzen Text zeigt das Fenster beim Anklicken.
    _umbruch(label, zeilen) {
        let roh = String(label.get_text() || "");
        let proZeile = 36;                              // passt bei 19em Kartenbreite etwa in eine Zeile
        let teile = roh.split("\n").map(z => z.trim()).filter(z => z);
        let aus = [], frei = zeilen;
        for (let z of teile) {
            if (frei <= 0)
                break;
            let braucht = Math.max(1, Math.ceil(z.length / proZeile));
            if (braucht > frei)
                z = z.slice(0, frei * proZeile - 1).replace(/\s+\S*$/, "") + " …";
            aus.push(z);
            frei -= Math.min(braucht, frei);
        }
        let text = aus.join("\n");
        if (aus.length < teile.length && !/…$/.test(text))
            text += " …";
        label.set_text(text);
        let t = label.clutter_text;
        t.line_wrap = true;
        t.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        t.ellipsize = Pango.EllipsizeMode.NONE;
        return label;
    }

    // Liste auf höchstens die eingestellte Höhe begrenzen (echte Inhaltshöhe kennt der Rollbalken
    // erst nach dem Verteilen – wie beim Aufgaben-Desklet)
    _hoeheAnpassen() {
        if (this.hoeheIdle)
            return;
        this.hoeheIdle = Mainloop.idle_add(() => {
            this.hoeheIdle = 0;
            let em = 10 * this.groesse * 96 / 72;
            let rahmen = Math.round(1.5 * em);
            let max = Math.max(4, Math.round(this.listeZeilen)) * Math.round(1.32 * em);
            let [, geschaetzt] = this.liste.get_preferred_height(Math.max(50, this.blaettern.get_width() - 24));
            this.blaettern.set_height(Math.min(geschaetzt + 2, max) + rahmen);
            if (!this.hoeheNach) {
                this.hoeheNach = Mainloop.timeout_add(150, () => {
                    this.hoeheNach = 0;
                    let echt = this.blaettern.get_vscroll_bar().get_adjustment().upper;
                    if (echt > 0)
                        this.blaettern.set_height(Math.min(Math.ceil(echt), max) + rahmen);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ------------------------------------------------------------ Anzeige

    _zeitText(unix, jetzt) {
        let T = this._t();
        let d = GLib.DateTime.new_from_unix_local(unix || 0);
        let tage = tagNr(jetzt) === tagNr(d) ? 0 : tagNr(jetzt.add_days(-1)) === tagNr(d) ? 1 : 2;
        let uhr = d.format("%H:%M");
        if (tage === 0)
            return T.heute.format(uhr);
        if (tage === 1)
            return T.gestern.format(uhr);
        // Translators: date and time of a note for GLib.DateTime.format(), e.g. "Tue, 6/10/2026 · 14:05"
        return d.format(_("%a, %-d/%-m/%Y · %H:%M"));
    }

    _zettelBauen(n, jetzt) {
        let T = this._t();
        let anruf = n.art === "anruf";
        let offen = anruf && n.rueckruf && !n.erledigt;
        let klasse = "nz-zettel" + (anruf ? " nz-zettel-anruf" : "") + (offen ? " nz-zettel-rueckruf" : "") +
                     (anruf && n.erledigt ? " nz-zettel-fertig nz-fertig" : "");
        let inhalt = new St.BoxLayout({vertical: true});

        if (anruf) {
            let kopf = new St.BoxLayout({style_class: "nz-kopfzeile"});
            kopf.add(new St.Icon({icon_name: "call-start-symbolic", icon_type: St.IconType.SYMBOLIC,
                                  icon_size: Math.round(13 * this.groesse), style_class: "nz-symbol",
                                  y_align: Clutter.ActorAlign.CENTER}));
            let wer = new St.Label({text: n.wer || T.unbekannt, style_class: "nz-wer"});
            wer.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            kopf.add(wer, {expand: true, x_fill: true});
            if (n.rueckruf) {
                // Marke anklicken = Rückruf erledigt / wieder offen
                let marke = new St.Button({label: n.erledigt ? "✓ " + T.erledigt : T.rueckruf, reactive: true,
                                           style_class: "nz-marke", y_align: Clutter.ActorAlign.CENTER});
                if (n.erledigt)
                    marke.set_style("background-color: #8d8880;");
                marke.connect("clicked", () => this._rueckrufUmschalten(n.id));
                kopf.add(marke);
            }
            inhalt.add_actor(kopf);
            if (n.nummer)
                inhalt.add_actor(new St.Label({text: n.nummer, style_class: "nz-nummer"}));
            if (n.wegen)
                inhalt.add_actor(this._umbruch(new St.Label({text: n.wegen, style_class: "nz-wegen"}), 2));
        }
        if (n.text)
            inhalt.add_actor(this._umbruch(new St.Label({text: n.text, style_class: "nz-text"}),
                                           Math.max(1, Math.round(this.zeilenJeZettel))));
        inhalt.add_actor(new St.Label({text: this._zeitText(n.angelegt, jetzt), style_class: "nz-zeit"}));

        // Bewusst kein St.Button: der meldet seine Höhe ohne Zeilenumbruch, mehrzeiliger Text ragte dann
        // in den nächsten Zettel. Eine Box rechnet richtig; den Klick erkennen wir selbst.
        // WICHTIG: das Drücken hier abfangen (EVENT_STOP). Sonst erreicht es den Rahmen des Desklets, der zum
        // Verschieben die Maus an sich zieht – das Loslassen käme dann nie beim Zettel an und der Klick bliebe
        // ohne Wirkung. Verschieben lässt sich das Desklet weiter an Kopf und Rand.
        let zettel = new St.BoxLayout({style_class: klasse, vertical: true, reactive: true, track_hover: true});
        zettel.add_actor(inhalt);
        let gedrueckt = null;
        zettel.connect("button-press-event", (a, ereignis) => {
            if (ereignis.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;         // Rechtsklick: Menü des Desklets
            gedrueckt = ereignis.get_coords();
            return Clutter.EVENT_STOP;
        });
        zettel.connect("button-release-event", (a, ereignis) => {
            if (ereignis.get_button() !== 1 || !gedrueckt)
                return Clutter.EVENT_PROPAGATE;
            let [x, y] = ereignis.get_coords();
            let klick = Math.abs(x - gedrueckt[0]) < 8 && Math.abs(y - gedrueckt[1]) < 8;
            gedrueckt = null;
            if (klick)
                this._schreiben(n.art === "anruf" ? "anruf" : "zettel", n);
            return Clutter.EVENT_STOP;
        });
        return zettel;
    }

    _zeichnen() {
        let T = this._t();
        let jetzt = GLib.DateTime.new_now_local();
        this.menuZettel.label.set_text(T.neuZettel);
        this.menuAnruf.label.set_text(T.neuAnruf);
        this.menuAufraeumen.label.set_text(T.aufraeumen);
        this.menuAufraeumen.actor.visible = this.notizen.some(n => n.art === "anruf" && n.erledigt);
        this.lKopf.set_text((this.ueberschrift || "").trim() || T.titel);

        // offene Rückrufe zuerst, dann das Neueste; erledigte Gesprächsnotizen ganz unten
        let rang = n => n.art === "anruf" && n.rueckruf && !n.erledigt ? 0 : n.art === "anruf" && n.erledigt ? 2 : 1;
        let sortiert = this.notizen.slice().sort((a, b) => rang(a) - rang(b) || (b.angelegt || 0) - (a.angelegt || 0));
        let offen = sortiert.filter(n => rang(n) === 0).length;

        let unter = [];
        if (offen)
            unter.push((offen === 1 ? T.rueckrufe : T.rueckrufeN).format(offen));
        if (this.notizen.length)
            unter.push(T.zettel.format(this.notizen.length));
        this.lUnter.set_text(unter.join(" · "));
        this.lUnter.set_style_class_name("nz-unter" + (offen ? " nz-unter-gelb" : ""));
        this.lUnter.visible = unter.length > 0;

        this.liste.destroy_all_children();
        for (let n of sortiert)
            this.liste.add_actor(this._zettelBauen(n, jetzt));
        if (!sortiert.length) {
            let leer = new St.Label({text: T.leer, style_class: "nz-leer"});
            leer.clutter_text.line_wrap = true;
            leer.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            leer.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this.liste.add_actor(leer);
        }
        this.lStatus.set_text(T.hinweis);
        this.lStatus.visible = sortiert.length > 0;
        this._hoeheAnpassen();
    }
}

function main(metadata, desklet_id) {
    return new NotizenDesklet(metadata, desklet_id);
}
