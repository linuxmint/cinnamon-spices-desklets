/*
 * aVincePulse
 * Desklet – UI, Refresh und Integration
 *
 * Copyright (C) 2026 Angelo Vincenti - aVince Industrietechnik
 *
 * This program is free software: you can redistribute it and/or
 * modify it under the terms of the GNU General Public License,
 * version 3, as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see
 * <https://www.gnu.org/licenses/>.
 *
 * Die Anzeigezeilen werden zentral aus metrics.js erzeugt.
 * Reihenfolge, Sichtbarkeit und eigene Bezeichnungen stammen aus
 * der Messwertliste der Einstellungen, METRICS liefert Vorgabe-
 * Beschriftung, Einheit und Startwert.
 *
 * Messwerterfassung liegt in measurement.js,
 * Hardware-/Sensorerkennung in hardwareDetection.js.
 */

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const ModalDialog = imports.ui.modalDialog;
const Dialog = imports.ui.dialog;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Gettext = imports.gettext;

/*
 * Uebersetzung (AP24).
 *
 * Die Domaene ist die UUID. Cinnamon legt die uebersetzten Dateien
 * beim Installieren eines Spice dorthin; zum Erproben tut das
 * "cinnamon-xlet-makepot -i". Fehlt eine Uebersetzung, liefert
 * dgettext den englischen Ausgangstext zurueck.
 */
const UUID = "avincepulse-desklet@avince";

// Fester Pfad, nicht get_user_data_dir(): Cinnamon legt die
// uebersetzten Kataloge durchgehend unter ~/.local/share/locale ab
// (xlet-settings.py, ExtensionCore.py, Spices.py). Bei gesetztem
// XDG_DATA_HOME liefen beide sonst auseinander (Befund P20 aus AP25).
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
    return Gettext.dgettext(UUID, text);
}

/*
 * Fuellt %s in einer uebersetzten Vorlage (AP24).
 *
 * Meldungen werden als ganzer Satz uebersetzt, nicht in Stuecken:
 * "automatisch - %s nicht gefunden" statt "automatisch - " + name +
 * " nicht gefunden". Nur so kann eine andere Sprache die Wortstellung
 * aendern. Geschrieben wird stets fuelle(_("..."), wert), damit
 * xgettext die Vorlage findet.
 */
function fuelle(vorlage, ...werte) {
    let i = 0;
    return String(vorlage).replace(/%s/g, () => {
        const w = werte[i++];
        return (w === undefined || w === null) ? "" : String(w);
    });
}

const Metrics = imports.desklets['avincepulse-desklet@avince'].metrics;
const Measurement = imports.desklets['avincepulse-desklet@avince'].measurement;
const HardwareDetection = imports.desklets['avincepulse-desklet@avince'].hardwareDetection;
const Speedtest = imports.desklets['avincepulse-desklet@avince'].speedtest;

/*
 * Die vier gemeinsamen Module kennen die UUID nicht und bekommen
 * die Uebersetzung deshalb uebergeben (AP24). Das geschieht hier,
 * unmittelbar nach dem Import und damit vor jeder Verwendung.
 */
Metrics.setzeUebersetzung(_);
Measurement.setzeUebersetzung(_);
HardwareDetection.setzeUebersetzung(_);
Speedtest.setzeUebersetzung(_);

const MeasurementProvider = Measurement.MeasurementProvider;
const HardwareDetector = HardwareDetection.HardwareDetector;
const SpeedtestRunner = Speedtest.SpeedtestRunner;
const StatusAnzeige = Speedtest.StatusAnzeige;

const METRICS = Metrics.METRICS;
const METRIC_ORDER = Metrics.METRIC_ORDER;
const standardMesswertListe = Metrics.standardMesswertListe;
const ordneMesswerte = Metrics.ordneMesswerte;
const SCHRIFTSCHATTEN = Metrics.SCHRIFTSCHATTEN;
const WARNFARBEN_VORGABE = Metrics.WARNFARBEN_VORGABE;
const warnfarbeFuer = Metrics.warnfarbeFuer;
const standardWarnListe = Metrics.standardWarnListe;
const ordneWarnschwellen = Metrics.ordneWarnschwellen;
const bewerteStufe = Metrics.bewerteStufe;
const UNTERSTUETZEN_URL = Metrics.UNTERSTUETZEN_URL;
const unterstuetzenUrlFehlt = Metrics.unterstuetzenUrlFehlt;

/*
 * Hintergrundflaeche des Desklets (AP20).
 *
 * Vorgabe 0 Prozent: Das Desklet sieht nach dem Update aus wie
 * bisher, die Flaeche wird bewusst eingeschaltet (Entscheidung des
 * Nutzers vom 20.09.2026).
 *
 * Hoechstwert 35 Prozent, siehe Einstellungsschema: Daruber wird die
 * Flaeche ueber hellem Bildschirminhalt mittelgrau, und die
 * Warnfarben verlieren darauf an Lesbarkeit. Den Schatten liefert
 * metrics.js, er ist fuer beide Komponenten gleich.
 */
const DEFAULT_HINTERGRUND_DECKKRAFT = 0;
const MAX_HINTERGRUND_DECKKRAFT = 35;

// Einstellungsschluessel der Sensorauswahl je Sensorart
// (siehe SENSOR_ARTEN in hardwareDetection.js).
const SENSOR_SCHLUESSEL = {
    cpu: "sensor-cpu",
    storage: "sensor-storage",
    fan: "sensor-fan"
};

// Fensterklasse des Cinnamon-Einstellungsfensters fuer Applets und Desklets.
// Cinnamon meldet sie ueber get_wm_class() als "Xlet-settings.py" mit
// grossem X; verglichen wird deshalb ohne Ruecksicht auf die Schreibweise.
const EINSTELLUNGEN_FENSTERKLASSE = "xlet-settings.py";


class AVinceHWMonitor extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        // Titel des eigenen Einstellungsfensters, siehe configureDesklet().
        this._einstellungsTitel = metadata.name;

        this.actor.add_style_class_name("avince-hwmonitor");

        this._timeout = null;

        // Wird beim Entfernen gesetzt; danach keine Messung mehr.
        this._entfernt = false;

        // Zuordnung Messwert-ID -> Anzeigezeile.
        // Wird in _buildRows() aus METRIC_ORDER gefuellt.
        this._rows = {};

        this.fontSize = 14;
        this.fontWeight = "600";
        this.refreshInterval = 3;

        this._speedtest = new SpeedtestRunner();
        this._speedtest.setzeQuelle("aVincePulse Desklet");
        this._statusAnzeige = new StatusAnzeige();

        this._detector = new HardwareDetector();

        this._measurement = new MeasurementProvider(
            this._detector,
            this._speedtest
        );

        this.settings = new Settings.DeskletSettings(
            this,
            metadata.uuid,
            desklet_id
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "font-size",
            "fontSize",
            this._applyStyle.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "font-weight",
            "fontWeight",
            this._applyStyle.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "hintergrund-deckkraft",
            "hintergrundDeckkraft",
            this._applyStyle.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "refresh-interval",
            "refreshInterval",
            this._onRefreshIntervalChanged.bind(this)
        );


        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "messwert-liste",
            "messwertListe",
            this._baueZeilenNeu.bind(this)
        );

        // Warnschwellen (AP18). Eine Aenderung baut die Zeilen neu auf
        // und loest damit sofort eine neue Bewertung aus.
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "warnschwellen-aktiv",
            "warnAktiv",
            this._baueZeilenNeu.bind(this)
        );

        // Welcher Farbsatz passt, haengt vom Hintergrundbild ab und
        // wird deshalb vom Benutzer gewaehlt (AP20).
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "warnfarben-satz",
            "warnfarbenSatz",
            this._applyStyle.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "warnschwellen-liste",
            "warnListe",
            this._baueZeilenNeu.bind(this)
        );

        // Fehlende Zeilen in den gespeicherten Listen ergaenzen, damit
        // jeder Messwert in den Einstellungen einstellbar ist.
        this._vervollstaendigeListen();

        this._bindeSensorAuswahl();

        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "avince-hw-container"
        });

        this._buildRows();

        this.setContent(this._container);

        /*
         * Der Speedtest laesst sich ueber das Kontextmenue ausloesen.
         * Ein Klick auf das Desklet waere zwar schneller erreichbar,
         * wuerde aber beim Verschieben versehentlich einen Test
         * starten, der spuerbar Zeit und Bandbreite kostet.
         */
        this._menuEintragSpeedtest =
            new PopupMenu.PopupMenuItem(_("Run a speed test now"));

        this._menuEintragSpeedtest.connect("activate", () => {
            this.starteSpeedtest();
        });

        this._menu.addMenuItem(this._menuEintragSpeedtest);

        // Ohne Speedtest-Programm bleibt der Eintrag verborgen
        // (AP22). Der Aufruf in _aktualisiereSensorOptionen() kam
        // dafuer zu frueh: Das Menue entsteht erst hier.
        this._aktualisiereSpeedtestVerfuegbarkeit();

        this._applyStyle();
        this._update();
    }

    /*
     * Erzeugt fuer jeden Messwert der Messwertliste genau eine
     * Anzeigezeile, in der vom Benutzer gewaehlten Reihenfolge.
     *
     * ordneMesswerte() stellt sicher, dass jeder Messwert aus
     * metrics.js genau einmal vorkommt, auch wenn die Liste in den
     * Einstellungen beschaedigt oder unvollstaendig ist. Ein neuer
     * Messwert erfordert dadurch weiterhin nur einen Eintrag in
     * metrics.js und keine Aenderung an dieser Datei.
     *
     * Messwerte, fuer die auf diesem Geraet kein Sensor gefunden
     * wurde, erhalten keine Zeile. Ein fehlender Sensor fuehrt
     * damit weder zu einer Dauerausgabe "--" noch zu einem Fehler.
     */
    _buildRows() {
        const availability =
            this._measurement.getMetricAvailability();

        for (const eintrag of ordneMesswerte(this.messwertListe)) {
            const id = eintrag.id;
            const metric = METRICS[id];

            // Vom Benutzer abgewaehlte Messwerte erhalten keine Zeile.
            if (!eintrag.sichtbar)
                continue;

            // Messwerte ohne passenden Sensor werden nicht angezeigt,
            // unabhaengig von der Einstellung. Nur ausdruecklich als
            // nicht verfuegbar gemeldete Werte entfallen.
            if (availability[id] === false) {
                global.log(
                    "aVincePulse AP07: metric hidden, no sensor -> " + id
                );
                continue;
            }

            // Eine eigene Bezeichnung ersetzt nur den Text. Das Symbol
            // bleibt erhalten, da es getrennt gefuehrt wird.
            const row = this._makeRow(
                eintrag.bezeichnung || metric.label,
                metric.defaultValue,
                metric.unit,
                metric.symbol,
                metric.symbolAnhebung
            );

            this._rows[id] = row;
            this._container.add_child(row.row);
        }
    }


    /*
     * Baut die Anzeigezeilen nach einer Aenderung der Messwertliste neu auf.
     */
    _baueZeilenNeu() {
        if (!this._container || this._entfernt)
            return;

        this._container.destroy_all_children();
        this._rows = {};

        this._buildRows();
        this._applyStyle();

        this._starteMessungNeu();
    }

    /*
     * Misst sofort und startet die Messschleife neu.
     *
     * Der laufende Zeitgeber muss entfernt werden, bevor _update()
     * einen neuen setzt. Sonst liefe die Messschleife doppelt und
     * wuerde sich mit jedem weiteren Aufruf vervielfachen. Bis AP19
     * rief der Speedtest _update() direkt auf; nach jedem Test lief
     * dadurch eine Schleife mehr (Befund K1). Jeder sofortige
     * Neustart der Messung geht deshalb ueber diese Methode.
     */
    _starteMessungNeu() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }

        this._update();
    }

    _makeRow(name, value, unit, symbol, symbolAnhebung) {
        const row = new St.BoxLayout({
            vertical: false,
            style_class: "avince-hw-row"
        });

        const nameLabel = new St.Label({
            text: name,
            style_class: "avince-hw-name"
        });

        const valueLabel = new St.Label({
            text: value,
            style_class: "avince-hw-value"
        });

        const unitLabel = new St.Label({
            text: unit,
            style_class: "avince-hw-unit"
        });

        /*
         * Alle drei Zellen auf der Mittellinie der Zeile ausrichten.
         *
         * Ohne das richten sie sich an der Schriftgrundlinie aus.
         * Zeichen wie die Uhr bei LAST oder der Datentraeger bei FREE
         * haben eine andere Hoehe als Grossbuchstaben und wirken
         * dadurch gegenueber der Beschriftung nach unten versetzt.
         */
        for (const zelle of [nameLabel, valueLabel, unitLabel])
            zelle.set_y_align(Clutter.ActorAlign.CENTER);

        row.add_child(nameLabel);
        row.add_child(valueLabel);
        row.add_child(unitLabel);

        return {
            row: row,
            name: nameLabel,
            value: valueLabel,
            unit: unitLabel,
            // Beschriftung und Symbol getrennt aufbewahren, damit
            // _setzeBeschriftung() die Auszeichnung bei jeder
            // Groessenaenderung neu aufbauen kann.
            nameText: name,
            symbol: symbol || "",
            symbolAnhebung: symbolAnhebung
        };
    }

    /*
     * Setzt den Anzeigewert eines Messwertes.
     * Nicht vorhandene Zeilen werden stillschweigend uebergangen,
     * damit ein fehlender Messwert kein Programmfehler ist.
     */
    _setValue(id, value) {
        const row = this._rows[id];

        if (!row || value === undefined || value === null)
            return;

        row.value.set_text(String(value));
    }

    /*
     * Setzt die Einheit eines Messwertes.
     * Wird fuer Messwerte mit dynamischer Einheit benoetigt,
     * zum Beispiel B/s, KB/s oder MB/s beim Netzwerkdurchsatz.
     */
    _setUnit(id, unit) {
        const row = this._rows[id];

        if (!row || !unit)
            return;

        row.unit.set_text(unit);
    }


    /*
     * Berechnet die Spaltenbreiten aus der Schriftgroesse und den
     * tatsaechlich angezeigten Beschriftungen.
     *
     * Feste Pixelbreiten passen nur zu einer einzigen Schriftgroesse.
     * Bei groesserer Schrift wurden Beschriftungen wie "SPEED" und
     * Einheiten wie "MBit/s" abgeschnitten.
     */

    /*
     * Maskiert die Zeichen, die Pango-Markup als Auszeichnung deutet.
     * Ohne das wuerde eine Beschriftung mit & oder < die Zeile leeren.
     */
    _maskiereMarkup(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /*
     * Setzt die Beschriftung einer Zeile und hebt ein vorhandenes
     * Symbol leicht an.
     *
     * Sinnbilder wie die Uhr oder der Datentraeger sind kleiner und
     * runder als Grossbuchstaben und sitzen auf der gemeinsamen
     * Schriftgrundlinie optisch zu tief.
     *
     * Die Anhebung wird aus der Schriftgroesse berechnet, nicht fest
     * vorgegeben. Ein fester Wert waere bei kleiner Schrift zu gross
     * und bei grosser zu klein und wuerde auf hochaufloesenden
     * Bildschirmen zusaetzlich verrutschen.
     */
    _setzeBeschriftung(item, fontSize) {
        if (!item)
            return;

        if (!item.symbol) {
            item.name.set_text(item.nameText);
            return;
        }

        try {
            /*
             * Pango rechnet in 1/1024 Punkt.
             *
             * Der Faktor gehoert zum jeweiligen Zeichen, da
             * Schriftzeichen unterschiedlich hoch auf der
             * Grundlinie sitzen. Er steht deshalb in metrics.js.
             */
            const faktor =
                Number.isFinite(Number(item.symbolAnhebung))
                    ? Number(item.symbolAnhebung)
                    : 110;

            const anhebung = Math.round(fontSize * faktor);

            item.name.clutter_text.set_use_markup(true);
            item.name.clutter_text.set_markup(
                this._maskiereMarkup(item.nameText) +
                " <span rise='" + anhebung + "'>" +
                this._maskiereMarkup(item.symbol) +
                "</span>"
            );

        } catch (e) {
            // Schlaegt die Auszeichnung fehl, bleibt die Zeile
            // lesbar: Beschriftung und Symbol als einfacher Text.
            global.logError(e);
            item.name.set_text(item.nameText + " " + item.symbol);
        }
    }

    _berechneSpaltenbreiten(fontSize) {
        let maxLabel = 0;
        let maxEinheit = 0;

        for (const id of METRIC_ORDER) {
            const item = this._rows[id];

            if (!item)
                continue;

            const metric = METRICS[id];

            // Massgeblich ist der angezeigte Text, also gegebenenfalls
            // die eigene Bezeichnung aus der Messwertliste.
            const beschriftung =
                String(item.nameText) +
                (item.symbol ? " " + item.symbol : "");

            maxLabel = Math.max(maxLabel, beschriftung.length);
            maxEinheit = Math.max(maxEinheit, String(metric.unit).length);
        }

        if (maxLabel === 0)
            maxLabel = 6;

        // Die Einheiten von Netzwerk und Speedtest wechseln zur
        // Laufzeit zwischen B/s, KB/s, MB/s, GB/s und MBit/s.
        // Die Spalte muss die laengste davon aufnehmen koennen.
        maxEinheit = Math.max(maxEinheit, 6);

        // Mittlere Zeichenbreite bei fetter Schrift, zuzueglich
        // eines Zeichens Reserve.
        const proZeichen = 0.62;

        return {
            name: Math.round(fontSize * proZeichen * (maxLabel + 1)),
            value: Math.round(fontSize * proZeichen * 7),
            unit: Math.round(fontSize * proZeichen * (maxEinheit + 1))
        };
    }

    /*
     * Eingestellte Deckkraft der Hintergrundflaeche in Prozent (AP20).
     * Ein beschaedigter oder ausserhalb des Bereichs liegender Wert
     * faellt auf die Vorgabe zurueck.
     */
    _deckkraft() {
        return Math.round(
            this._gueltig(this.hintergrundDeckkraft, 0,
                          MAX_HINTERGRUND_DECKKRAFT,
                          DEFAULT_HINTERGRUND_DECKKRAFT)
        );
    }

    /*
     * Gewaehlter Warnfarbensatz (AP20). Eine beschaedigte Auswahl
     * faellt auf die Vorgabe zurueck; warnfarbeFuer() tut das
     * ebenfalls, hier steht der Wert aber sauber fuer die Anzeige.
     */
    _warnfarbenSatz() {
        const wahl = String(this.warnfarbenSatz);

        return wahl === "hell" || wahl === "dunkel"
            ? wahl
            : WARNFARBEN_VORGABE;
    }

    /*
     * Legt die abgedunkelte Flaeche hinter die Messwerte (AP20).
     *
     * Bei 0 Prozent bleibt das Desklet ohne Flaeche und ohne
     * Innenabstand, also genau wie vor AP20. Ecken und Abstaende
     * richten sich nach der Schriftgroesse, damit sie bei 10 px
     * nicht klobig und bei 30 px nicht zu knapp wirken.
     */
    _setzeHintergrundflaeche(deckkraft, fontSize) {
        if (!this._container)
            return;

        if (deckkraft <= 0) {
            this._container.set_style(
                "background-color: transparent;" +
                "padding: 0;"
            );

            return;
        }

        this._container.set_style(
            "background-color: rgba(0, 0, 0, " + (deckkraft / 100) + ");" +
            "border-radius: " + Math.round(fontSize * 1.2) + "px;" +
            "padding: " + Math.round(fontSize * 0.8) + "px " +
            Math.round(fontSize * 1.1) + "px;"
        );
    }

    _applyStyle() {
        if (!this._rows)
            return;

        // Bereiche wie im Einstellungsschema (Befund H1).
        const fontSize = Math.round(this._gueltig(this.fontSize, 10, 30, 14));
        const fontWeight =
            ["400", "500", "600", "700"].includes(String(this.fontWeight))
                ? String(this.fontWeight)
                : "600";

        const breiten = this._berechneSpaltenbreiten(fontSize);

        const deckkraft = this._deckkraft();

        this._setzeHintergrundflaeche(deckkraft, fontSize);

        /*
         * Der Schatten steht in metrics.js und wird hier gesetzt,
         * nicht im Stylesheet (AP20): So haben Applet und Desklet
         * denselben Wert, und eine Aenderung erfordert keinen
         * Cinnamon-Neustart. Das Stylesheet behaelt seine Angabe als
         * Vorgabe, falls noch kein Stil gesetzt ist.
         */
        const style =
            "font-size: " + fontSize + "px;" +
            "font-weight: " + fontWeight + ";" +
            "text-shadow: " + SCHRIFTSCHATTEN + ";";

        for (const id of METRIC_ORDER) {
            const item = this._rows[id];

            if (!item)
                continue;

            item.name.set_style(
                style + "width: " + breiten.name + "px;");

            this._setzeBeschriftung(item, fontSize);

            item.wertStil =
                style +
                "width: " + breiten.value + "px;" +
                "text-align: right;";

            item.einheitStil =
                style +
                "width: " + breiten.unit + "px;" +
                "text-align: left;";

            this._wendeStufeAn(item);
        }
    }

    /*
     * Ergaenzt fehlende Messwerte in den gespeicherten Listen, jeweils
     * mit der Vorgabe am Ende. Vorhandene Eintraege bleiben unveraendert.
     *
     * Fehlt eine Zeile, wird der Messwert zwar mit der Vorgabe
     * angezeigt bzw. bewertet, erscheint aber nicht in der Liste und
     * laesst sich nicht einstellen. Das betrifft etwa Messwerte, die
     * ein Update neu hinzufuegt.
     */
    _vervollstaendigeListen() {
        const ergaenze = (schluessel, eigenschaft, standard) => {
            const liste = Array.isArray(this[eigenschaft])
                ? this[eigenschaft]
                : [];

            const vorhanden = new Set(
                liste
                    .filter(e => e && typeof e === "object")
                    .map(e => e.messwert)
            );

            const fehlend = standard.filter(e => !vorhanden.has(e.messwert));

            if (fehlend.length === 0)
                return;

            const neu = liste.concat(fehlend);

            // setValue schreibt nur die Datei, die gebundene Eigenschaft
            // wird deshalb zusaetzlich gesetzt (siehe AP09).
            this.settings.setValue(schluessel, neu);
            this[eigenschaft] = neu;

            global.log(
                "aVincePulse AP18: " + schluessel + " ergaenzt um " +
                fehlend.map(e => e.messwert).join(", ")
            );
        };

        ergaenze("messwert-liste", "messwertListe", standardMesswertListe());
        ergaenze("warnschwellen-liste", "warnListe", standardWarnListe());
    }

    /*
     * Bewertet die Messwerte mit Warnschwellen und faerbt Wert und
     * Einheit ein. Nur bei einem Stufenwechsel wird der Stil neu
     * gesetzt.
     */
    _bewerteWarnschwellen(werte) {
        const schwellen = ordneWarnschwellen(this.warnListe);

        for (const id in werte) {
            const item = this._rows[id];

            if (!item)
                continue;

            const stufe = this.warnAktiv === false
                ? "normal"
                : bewerteStufe(werte[id], schwellen[id], item.stufe);

            if (stufe !== item.stufe) {
                item.stufe = stufe;
                this._wendeStufeAn(item);
            }
        }
    }

    /*
     * Setzt Wert und Einheit auf ihren Grundstil, bei einer Warnstufe
     * mit angehaengter Farbe. Die spaeter angehaengte Farbe hat Vorrang
     * vor einer Farbe im Grundstil.
     */
    _wendeStufeAn(item) {
        if (!item || item.wertStil === undefined)
            return;

        const gewaehlt = warnfarbeFuer(item.stufe, this._warnfarbenSatz());

        const farbe = gewaehlt ? "color: " + gewaehlt + ";" : "";

        item.value.set_style(item.wertStil + farbe);
        item.unit.set_style(item.einheitStil + farbe);
    }

    /*
     * Ein Takt der Messschleife: messen, anzeigen, naechsten Takt setzen.
     *
     * Der naechste Takt wird auch dann gesetzt, wenn beim Messen oder
     * Anzeigen ein Fehler auftritt. Sonst bliebe die Anzeige bis zum
     * Neuladen stehen (Befund G2). Nach dem Entfernen des Desklets
     * wird nicht mehr gemessen.
     */
    _update() {
        if (this._entfernt)
            return;

        try {
            this._messeUndZeige();
        } catch (e) {
            global.logError(e);
        } finally {
            this._setzeNaechstenTakt();
        }
    }

    _setzeNaechstenTakt() {
        if (this._entfernt)
            return;

        const seconds = Math.round(
            this._gueltig(this.refreshInterval, 1, 30, 3)
        );

        /*
         * Ein Einmal-Zeitgeber, der sich im eigenen Rueckruf neu
         * anlegt - bewusst, nicht aus Versehen.
         *
         * Die Spices-Pruefliste nennt das einen haeufigen Fehler und
         * empfiehlt einen periodischen Zeitgeber ueber den
         * Rueckgabewert SOURCE_CONTINUE. Der haette einen festen
         * Abstand; gebraucht wird hier ein veraenderlicher.
         *
         * Der naechste Takt liegt auf einer vollen Taktmarke der
         * Systemuhr, damit Applet und Desklet im selben Moment messen
         * (AP15). msBisZumNaechstenTakt() rechnet den Abstand dafuer
         * bei jedem Takt neu aus: Er faellt um die Laufzeit der
         * Messung kuerzer aus, aendert sich mit dem vom Benutzer
         * eingestellten Intervall und ueberspringt eine Taktmarke, die
         * zu nah liegt (TAKT_MINDESTABSTAND_MS).
         *
         * Ein periodischer Zeitgeber koennte das nicht leisten; die
         * beiden Komponenten wuerden auseinanderlaufen. Der Rueckruf
         * gibt deshalb SOURCE_REMOVE zurueck und setzt den naechsten
         * Takt selbst.
         */
        this._timeout = Mainloop.timeout_add(
            Measurement.msBisZumNaechstenTakt(seconds),
            () => {
                this._timeout = null;
                this._update();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _messeUndZeige() {
        const hardware =
            this._measurement.readHardwareValues();

        const cpu = hardware.cpu;
        const ssd = hardware.ssd;
        const fan = hardware.fan;

        const load =
            this._measurement.readCpuLoad();

        const ram =
            this._measurement.readRamUsage();

        const speedtest =
            this._measurement.readSpeedtestValues();

        const network =
            this._measurement.readNetworkSpeed();

        const down =
            this._measurement.formatRate(network.down);

        const up =
            this._measurement.formatRate(network.up);

        this._setValue("cpu_temp", cpu);
        this._setValue("cpu_load", load);
        this._setValue("ram_load", ram);
        this._setValue("storage_temp", ssd);
        this._setValue("fan_speed", fan);

        this._setValue("battery_charge", hardware.batteryCharge);

        // Die STATUS-Zeile zeigt den festen Text "PSU" als Wert,
        // der Netzteilzustand ON/OFF steht in der Einheitenspalte.
        this._setUnit("psu_state", hardware.psuState);

        // Warnschwellen: Akku nur im Akkubetrieb, Speicherplatz in
        // Prozent des gemessenen Laufwerks.
        this._bewerteWarnschwellen({
            cpu_temp: cpu,
            storage_temp: ssd,
            cpu_load: load,
            ram_load: ram,
            battery_charge:
                hardware.psuState === "OFF" ? hardware.batteryCharge : null
        });

        /*
         * Der freie Speicherplatz kommt asynchron nach (AP26).
         *
         * Die Abfrage lief bis AP25 synchron im Hauptthread und hielt
         * bei einem haengenden Laufwerk die gesamte Oberflaeche an -
         * alle drei Sekunden erneut (Befund S1). Wert und Warnschwelle
         * werden deshalb im Rueckruf gesetzt, wenige Millisekunden
         * nach den uebrigen Zeilen.
         *
         * _bewerteWarnschwellen() laeuft nur ueber die uebergebenen
         * Schluessel, die anderen Zeilen bleiben also unberuehrt.
         */
        this._measurement.readStorageAsync((frei, anteil) => {
            if (this._entfernt)
                return;

            const groesse = this._measurement.formatSize(frei);

            this._setValue("storage_free", groesse.value);
            this._setUnit("storage_free", groesse.unit);

            this._bewerteWarnschwellen({ storage_free: anteil });
        });

        this._setValue("net_down", down.value);
        this._setUnit("net_down", down.unit);

        this._setValue("net_up", up.value);
        this._setUnit("net_up", up.unit);

        if (speedtest) {
            this._setValue("speed_down", speedtest.SPEED_DOWN);
            this._setValue("speed_up", speedtest.SPEED_UP);
            this._setValue("ping", speedtest.PING);
            this._setValue("jitter", speedtest.JITTER);

            const alter =
                this._measurement.readSpeedtestAge(speedtest);

            if (alter) {
                this._setValue("speed_age", alter.value);
                this._setUnit("speed_age", alter.unit);
            }
        }

        // Bis AP19 wurden die Werte hier zusaetzlich bei jedem Takt nach
        // /tmp/avince-hwmonitor-values geschrieben, fuer das alte Applet
        // avince-hwpopup@angelo. Das liest seit AP08 niemand mehr; das
        // Schreiben ist entfallen (Befund M3).
    }

    /*
     * Setzt den Zeitgeber nach einer Aenderung des Intervalls
     * sofort neu, damit die Aenderung ohne Wartezeit wirkt.
     */
    _onRefreshIntervalChanged() {
        if (!this._container || this._entfernt)
            return;

        this._starteMessungNeu();
    }

    /*
     * Begrenzt einen Einstellungswert auf den zulaessigen Bereich
     * und faellt bei ungueltiger Eingabe auf den Vorgabewert zurueck.
     * Das Einstellungsfenster laesst nur gueltige Werte zu; eine von
     * Hand bearbeitete oder beschaedigte Einstellungsdatei aber nicht
     * (Befund H1: Schriftgroesse 100 ergab ein Desklet groesser als
     * der Bildschirm). Wie _gueltig() im Applet.
     */
    _gueltig(wert, min, max, vorgabe) {
        /*
         * Zuerst den Typ pruefen, dann erst umwandeln.
         *
         * Number() allein genuegt nicht: Number(null), Number(""),
         * Number(false) und Number([]) ergeben jeweils 0 und sind
         * endlich. Der Vorgabewert griffe dann nur noch bei
         * undefined, NaN oder echtem Text, und ein "value": null in
         * der Einstellungsdatei ergaebe das Minimum statt der Vorgabe
         * - beim Messtakt etwa 1 statt 3 Sekunden, also dauerhaft
         * dreifache Messlast (Befund P16 aus AP25).
         *
         * Cinnamons _getValue() ersetzt ausschliesslich undefined
         * durch den Vorgabewert; ein null kommt unveraendert hier an.
         * Gleiche Pruefung wie zahlOderNull() in metrics.js.
         */
        let zahl;

        if (typeof wert === "number")
            zahl = wert;
        else if (typeof wert === "string" && wert.trim() !== "")
            zahl = Number(wert);
        else
            return vorgabe;

        if (!Number.isFinite(zahl))
            return vorgabe;

        return Math.max(min, Math.min(max, zahl));
    }

    /*
     * Setzt alle Einstellungen auf die Auslieferungswerte zurueck.
     * Wird ueber die Schaltflaeche im Einstellungsfenster gerufen.
     *
     * settings.setValue() schreibt ausschliesslich die
     * Einstellungsdatei. Weder die gebundenen Eigenschaften noch die
     * zugehoerigen Rueckrufe werden dabei aktualisiert. Die Werte
     * werden deshalb zusaetzlich hier gesetzt und angewendet.
     */

    /*
     * Bindet die Sensorauswahl der Einstellungen und uebergibt sie
     * der Hardwareerkennung. Anschliessend werden die Auswahlfelder
     * mit den auf diesem Geraet gefundenen Sensoren gefuellt.
     */
    _bindeSensorAuswahl() {
        for (const art in SENSOR_SCHLUESSEL) {
            this.settings.bindProperty(
                Settings.BindingDirection.IN,
                SENSOR_SCHLUESSEL[art],
                "sensorwahl_" + art,
                this._sensorAuswahlGeaendert.bind(this)
            );
        }

        // Netzwerkschnittstelle und Laufwerk fuer FREE (AP16).
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "netz-schnittstelle",
            "netzWahl",
            this._quellenAuswahlGeaendert.bind(this)
        );

        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "laufwerk-free",
            "laufwerkWahl",
            this._quellenAuswahlGeaendert.bind(this)
        );

        // Speedtest-Programm (AP22). Die Wahl wirkt beim naechsten
        // Test; ein laufender Test wird nicht umgeschaltet.
        this.settings.bindProperty(
            Settings.BindingDirection.IN,
            "speedtest-programm",
            "speedtestProgramm",
            this._speedtestProgrammGeaendert.bind(this)
        );

        this._uebernehmeQuellenAuswahl();
        this._uebernehmeSpeedtestProgramm();
        this._detector.setzeAuswahl(this._sensorAuswahl());
        this._aktualisiereSensorOptionen();
    }

    /*
     * Uebergibt die Programmwahl an den Speedtest (AP22).
     */
    _uebernehmeSpeedtestProgramm() {
        if (this._speedtest)
            this._speedtest.setzeProgramm(this.speedtestProgramm);
    }

    /*
     * Eine geaenderte Programmwahl wirkt beim naechsten Test. Die
     * Anzeige bleibt unberuehrt: Gespeicherte Werte eines anderen
     * Programms behalten ihre Gueltigkeit (AP22, Kriterium 7).
     */
    _speedtestProgrammGeaendert() {
        this._uebernehmeSpeedtestProgramm();
    }

    _uebernehmeQuellenAuswahl() {
        this._measurement.setzeNetzwerkAuswahl(this.netzWahl);
        this._measurement.setzeLaufwerkAuswahl(this.laufwerkWahl);

        // Der Temperatursensor soll zu dem Laufwerk gehoeren, dessen
        // freien Platz die Anzeige nennt (Befund B1 aus AP25).
        if (this._detector)
            this._detector.setzeLaufwerkGeraet(
                this._measurement.laufwerkGeraet());
    }

    /*
     * Eine geaenderte Schnittstelle oder ein anderes Laufwerk wirkt
     * sofort. Die erste Netzwerkmessung danach zeigt 0, da fuer die
     * neue Schnittstelle noch kein Vergleichswert vorliegt.
     */
    _quellenAuswahlGeaendert() {
        if (!this._measurement)
            return;

        this._uebernehmeQuellenAuswahl();
        this._baueZeilenNeu();
    }

    _sensorAuswahl() {
        const auswahl = {};

        for (const art in SENSOR_SCHLUESSEL)
            auswahl[art] = this["sensorwahl_" + art];

        return auswahl;
    }

    /*
     * Die Auswahlfelder koennen nicht im Schema stehen, da die
     * Sensoren von Geraet zu Geraet verschieden sind. setOptions()
     * schreibt sie in die Einstellungsdatei. Ein bereits geoeffnetes
     * Einstellungsfenster zeigt sie erst nach erneutem Oeffnen.
     */
    _aktualisiereSensorOptionen() {
        const angebote = {};

        for (const art in SENSOR_SCHLUESSEL) {
            angebote[SENSOR_SCHLUESSEL[art]] = () =>
                this._detector.getSensorOptionen(
                    art,
                    this["sensorwahl_" + art]
                );
        }

        angebote["netz-schnittstelle"] = () =>
            this._measurement.getNetzwerkOptionen(this.netzWahl);

        angebote["laufwerk-free"] = () =>
            this._measurement.getLaufwerkOptionen(this.laufwerkWahl);

        // Welche Speedtest-Programme auf diesem Rechner liegen, steht
        // ebenso wenig im Schema fest wie die Sensoren (AP22).
        angebote["speedtest-programm"] = () =>
            this._speedtest.getProgrammOptionen(this.speedtestProgramm);

        const geschrieben = {};

        for (const schluessel in angebote) {
            try {
                geschrieben[schluessel] = angebote[schluessel]();
                this.settings.setOptions(schluessel, geschrieben[schluessel]);
            } catch (e) {
                global.logError(e);
            }
        }

        this._aktualisiereSpeedtestVerfuegbarkeit();

        // Merkt sich, was das Einstellungsfenster jetzt anbietet.
        this._geschriebeneAuswahl = this._auswahlKennzeichen(geschrieben);

        /*
         * Die Beschriftungen des Laufwerk-Auswahlfeldes nennen den
         * freien Platz. Er wird seit AP26 asynchron geholt und steht
         * beim ersten Aufbau noch nicht zur Verfuegung; dort stuende
         * dann "--". Sobald die Werte da sind, werden die Optionen ein
         * zweites Mal gesetzt.
         *
         * Nur die BESCHRIFTUNGEN aendern sich dabei, nicht die Werte.
         * _auswahlKennzeichen() vergleicht ausschliesslich Werte;
         * _geschriebeneAuswahl bleibt deshalb unberuehrt, und die
         * Rueckfrage zum Neu-Oeffnen des Fensters (AP16) wird davon
         * nicht ausgeloest.
         */
        this._measurement.aktualisiereLaufwerkPlatz(() => {
            if (this._entfernt)
                return;

            try {
                this.settings.setOptions(
                    "laufwerk-free",
                    this._measurement.getLaufwerkOptionen(this.laufwerkWahl)
                );
            } catch (e) {
                global.logError(e);
            }
        });
    }

    /*
     * Haelt fest, ob ueberhaupt ein Speedtest-Programm vorhanden ist
     * (AP22, Kriterien 8 und 9).
     *
     * Der Wert steuert ueber "dependency" im Schema, was das
     * Einstellungsfenster zeigt: mit Programm die Programmwahl, den
     * Bedienhinweis und die Schaltflaeche "Speedtest jetzt starten",
     * ohne Programm stattdessen einen erklaerenden Hinweis. Die
     * Schaltflaeche zum Oeffnen der Berichte bleibt in beiden Faellen
     * sichtbar, da aeltere Berichte weiterhin lesbar sein sollen.
     *
     * Warum eine Einstellung und keine Abfrage im Fenster: Cinnamon
     * bietet keine Moeglichkeit, ein Bedienelement zur Laufzeit
     * auszublenden. "dependency" wertet ausschliesslich gespeicherte
     * Einstellungswerte aus. Der Schluessel ist deshalb vom Typ
     * "generic" und hat kein eigenes Bedienelement.
     *
     * Ebenso wird der Menueeintrag ein- und ausgeblendet, damit ein
     * Klick nicht ins Leere laeuft.
     */
    _aktualisiereSpeedtestVerfuegbarkeit() {
        if (!this._speedtest)
            return;

        const vorhanden = this._speedtest.istVerfuegbar();

        try {
            if (this.settings.getValue("speedtest-vorhanden") !== vorhanden)
                this.settings.setValue("speedtest-vorhanden", vorhanden);
        } catch (e) {
            global.logError(e);
        }

        if (this._menuEintragSpeedtest) {
            try {
                this._menuEintragSpeedtest.actor.visible = vorhanden;
            } catch (e) {
                global.logError(e);
            }
        }
    }

    /*
     * Eine geaenderte Sensorauswahl wirkt sofort. Ein Neuaufbau der
     * Zeilen loest die naechste Messung ohne Wartezeit aus.
     */
    _sensorAuswahlGeaendert() {
        if (!this._detector)
            return;

        this._detector.setzeAuswahl(this._sensorAuswahl());
        this._baueZeilenNeu();
    }

    /*
     * Oeffnet die Einstellungen. Ist das Einstellungsfenster bereits
     * offen, wird es nach vorne geholt, statt ein weiteres zu starten.
     *
     * Cinnamon startet bei jedem Aufruf von "Konfigurieren ..." ein
     * neues Fenster. Erkannt wird das eigene Fenster an der
     * Fensterklasse von xlet-settings und am Titel, den xlet-settings
     * aus dem Namen in metadata.json bildet. Der Titel unterscheidet
     * das Fenster des Applets von dem des Desklets.
     *
     * Oeffnet der Benutzer die Einstellungen ueber die Systemeinstellungen,
     * startet Cinnamon das Fenster selbst; dieser Weg laesst sich von
     * hier aus nicht beeinflussen.
     */
    configureDesklet(tab = 0) {
        if (this._holeEinstellungsfensterNachVorne())
            return;

        super.configureDesklet(tab);
    }

    _holeEinstellungsfensterNachVorne() {
        try {
            const fenster = this._findeEinstellungsfenster();

            if (!fenster)
                return false;

            // Liegt das Fenster auf einem anderen Arbeitsbereich,
            // wird dorthin gewechselt. Minimierte Fenster werden
            // dabei wiederhergestellt.
            const bereich = fenster.get_workspace();

            Main.activateWindow(
                fenster,
                global.get_current_time(),
                bereich ? bereich.index() : undefined
            );

            return true;

        } catch (e) {
            global.logError(e);
        }

        return false;
    }

    /*
     * Das eigene, derzeit offene Einstellungsfenster oder null.
     * ausser: ein Fenster, das dabei nicht in Frage kommt, etwa das
     * gerade geschlossene.
     */
    _findeEinstellungsfenster(ausser) {
        for (const actor of global.get_window_actors()) {
            const fenster = actor.get_meta_window();

            if (
                fenster &&
                fenster !== ausser &&
                String(fenster.get_wm_class()).toLowerCase() ===
                    EINSTELLUNGEN_FENSTERKLASSE &&
                fenster.get_title() === this._einstellungsTitel
            )
                return fenster;
        }

        return null;
    }

    /*
     * Kennzeichen einer geschriebenen Auswahl: alle Sensoren,
     * Schnittstellen und Laufwerke, ohne die mitangezeigten Werte.
     *
     * Verglichen wird mit dem zuletzt in die Einstellungen
     * geschriebenen Stand, also mit dem, was ein offenes
     * Einstellungsfenster anzeigt. Ein Vergleich mit einer frischen
     * Abfrage vor der Erkennung genuegt nicht: Laufwerke und
     * Schnittstellen werden live gelesen, ein eingesteckter
     * USB-Stick waere dann schon im Vorher enthalten.
     *
     * Eintraege "Nicht gefunden" zaehlen nicht mit; kehrt ein
     * gewaehlter Sensor zurueck, aendert sich dadurch das Kennzeichen.
     *
     * Erkannt werden sie nicht mehr am Wortanfang, sondern daran, dass
     * die Beschriftung genau der uebersetzten Vorlage mit diesem Wert
     * entspricht (AP24). Ein Vergleich auf "Nicht " haette nach der
     * Uebersetzung nicht mehr gegriffen, und in einer Sprache, die den
     * Platzhalter voranstellt, wuerde auch ein Praefixvergleich
     * scheitern.
     */
    _auswahlKennzeichen(geschrieben) {
        const fehlendeVorlagen = [
            _("Not found: %s"),
            _("Not mounted: %s")
        ];

        return Object.keys(geschrieben).sort().map(schluessel => {
            const optionen = geschrieben[schluessel];

            const werte = Object.keys(optionen)
                .filter(text => !fehlendeVorlagen.some(
                    vorlage => text === fuelle(vorlage, optionen[text])))
                .map(text => optionen[text])
                .sort();

            return schluessel + ":" + werte.join(",");
        }).join("|");
    }

    /*
     * Fragt, ob das offene Einstellungsfenster neu geoeffnet werden
     * soll, damit seine Auswahlfelder die neu erkannte Hardware zeigen.
     *
     * Grundsatz: aVincePulse oeffnet oder schliesst Fenster nur nach
     * einer Benutzeraktion und nur mit vorherigem Hinweis bzw. mit
     * Rueckfrage. Bis zur Antwort bleibt das Fenster unveraendert.
     * Esc wirkt wie "Nicht jetzt".
     */
    _frageNeuOeffnen(meldung) {
        if (this._rueckfrage)
            this._rueckfrage.close();

        const dialog = new ModalDialog.ModalDialog();

        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: this._einstellungsTitel + " \u2013 " +
                   _("hardware detected again"),
            description:
                _("Sensors, interfaces or drives have appeared or gone. " +
                  "The display is already up to date.\n\n" +
                  "For the selection lists in the settings window to show " +
                  "them as well, the window has to close briefly and " +
                  "reopen in the same place.")
        }));

        let beantwortet = false;

        const antworte = neuOeffnen => {
            if (beantwortet)
                return;

            beantwortet = true;
            this._rueckfrage = null;

            // Erst weitermachen, wenn der Dialog ganz ausgeblendet ist.
            // Sonst lagen Rueckfrage und Meldung kurz uebereinander in
            // der Bildschirmmitte und waren beide nicht lesbar.
            dialog.connect("closed", () => this._nachRueckfrage(neuOeffnen, meldung));
            dialog.close();
        };

        dialog.setButtons([
            {
                label: _("Not now"),
                key: Clutter.KEY_Escape,
                action: () => antworte(false)
            },
            {
                label: _("Reopen now"),
                action: () => antworte(true)
            }
        ]);

        this._rueckfrage = dialog;

        // open() liefert false, wenn pushModal scheitert. Ohne diese
        // Pruefung bliebe _rueckfrage dauerhaft gesetzt, und der
        // Nutzer saehe nach dem Klick ueberhaupt nichts, da die
        // Statusmeldung zuvor ausgeblendet wurde (Befund P23).
        if (!dialog.open()) {
            this._rueckfrage = null;
            dialog.destroy();

            if (this._statusAnzeige) {
                this._statusAnzeige.zeige(
                    _("The query could not be shown. Please try again.")
                );
                this._statusAnzeige.verbergeNachLesezeit();
            }
        }
    }

    /*
     * Fuehrt die Antwort auf die Rueckfrage aus, nachdem der Dialog
     * ausgeblendet ist.
     */
    _nachRueckfrage(neuOeffnen, meldung) {
        if (!this._statusAnzeige)
            return;

        const zeigeMeldung = geoeffnet => {
            if (!this._statusAnzeige || this._entfernt)
                return;

            this._statusAnzeige.zeige(
                meldung +
                (geoeffnet
                    ? "\n\n" + _("The settings window was reopened for this.")
                    : "\n\n" + _("The new entries appear in the lists as " +
                                 "soon as you close the settings window " +
                                 "and open it again."))
            );
            this._statusAnzeige.verbergeNachLesezeit();
        };

        // Beim Neu-Oeffnen erscheint die Meldung erst, wenn das neue
        // Fenster an seinem Platz steht. Zuvor schien fuer gut eine
        // halbe Sekunde das Fenster dahinter durch die halbtransparente
        // Meldung (Befund H15).
        if (neuOeffnen && this._oeffneEinstellungenNeu(() => zeigeMeldung(true)))
            return;

        zeigeMeldung(false);
    }

    /*
     * Schliesst das offene Einstellungsfenster und oeffnet es an
     * derselben Bildschirmposition neu, damit es die gerade neu
     * geschriebene Auswahl zeigt. Ein bereits geoeffnetes Fenster
     * liest die Optionen sonst nicht erneut ein.
     *
     * fertig wird gerufen, sobald das neue Fenster steht, spaetestens
     * nach fuenf Sekunden (Befund H15).
     *
     * Rueckgabe: true, wenn ein Fenster offen war.
     */
    _oeffneEinstellungenNeu(fertig) {
        const altesFenster = this._findeEinstellungsfenster();

        if (!altesFenster)
            return false;

        const rahmen = altesFenster.get_frame_rect();
        const x = rahmen.x;
        const y = rahmen.y;

        let geoeffnet = false;

        const oeffnen = () => {
            if (geoeffnet)
                return;

            geoeffnet = true;
            this._trenneFensterSignal();

            // Wurde das Desklet inzwischen entfernt, kein Fenster mehr
            // oeffnen (Befund G6).
            if (this._entfernt)
                return;

            // Direkt die Cinnamon-Funktion, damit nicht das noch
            // verschwindende alte Fenster nach vorne geholt wird.
            super.configureDesklet();
            this._setzeFensterPosition(x, y, altesFenster, fertig);
        };

        // Erst oeffnen, wenn das alte Fenster geschlossen ist.
        // Die Zeitgrenze sichert ab, falls das Signal ausbleibt.
        // Signal und Zeitgeber werden gemerkt, damit sie beim Entfernen
        // des Desklets aufgeraeumt werden koennen (Befund G6).
        this._trenneFensterSignal();
        this._fensterSignal = {
            fenster: altesFenster,
            id: altesFenster.connect("unmanaged", () => oeffnen())
        };

        if (this._fensterZeitgeber)
            Mainloop.source_remove(this._fensterZeitgeber);

        this._fensterZeitgeber = Mainloop.timeout_add(2000, () => {
            this._fensterZeitgeber = null;
            oeffnen();
            return GLib.SOURCE_REMOVE;
        });

        altesFenster.delete(global.get_current_time());

        return true;
    }

    /*
     * Trennt das Signal "unmanaged" des alten Einstellungsfensters,
     * sofern noch verbunden.
     */
    _trenneFensterSignal() {
        if (!this._fensterSignal)
            return;

        try {
            this._fensterSignal.fenster.disconnect(this._fensterSignal.id);
        } catch (e) {
            // Fenster bereits verschwunden: nichts mehr zu trennen.
        }

        this._fensterSignal = null;
    }

    /*
     * Wartet bis zu fuenf Sekunden auf das neue Einstellungsfenster
     * und setzt es an die Position des alten.
     *
     * Die Fensterverwaltung legt die Position erst beim Anzeigen fest
     * und ueberschreibt dabei eine zu frueh gesetzte. Die Position wird
     * deshalb so lange nachgesetzt, bis sie bei drei aufeinander
     * folgenden Pruefungen stimmt.
     */
    _setzeFensterPosition(x, y, altesFenster, fertig) {
        let versuche = 50;
        let stabil = 0;

        const ende = () => {
            this._fensterZeitgeber = null;

            if (fertig && !this._entfernt)
                fertig();
        };

        if (this._fensterZeitgeber)
            Mainloop.source_remove(this._fensterZeitgeber);

        this._fensterZeitgeber = Mainloop.timeout_add(100, () => {
            const fenster = this._findeEinstellungsfenster(altesFenster);

            if (fenster) {
                const rahmen = fenster.get_frame_rect();

                if (rahmen.x === x && rahmen.y === y) {
                    if (++stabil >= 3) {
                        ende();
                        return GLib.SOURCE_REMOVE;
                    }
                } else {
                    stabil = 0;
                    fenster.move_frame(true, x, y);
                }
            }

            if (--versuche <= 0) {
                ende();
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    /*
     * Fuehrt die Hardware- und Sensorerkennung erneut durch und
     * baut die Anzeige danach neu auf.
     *
     * Die Erkennung laeuft sonst nur einmal beim Laden. Nach einem
     * Hardwarewechsel oder bei einem verzoegert geladenen Treiber
     * waere ein Messwert bis zum naechsten Cinnamon-Neustart nicht
     * verfuegbar.
     */
    on_hardware_neu_erkennen() {
        // Keine Meldung "Hardware wird neu erkannt ...": Die Erkennung
        // dauert rund 115 ms und laeuft ohne Pause, die Meldung wurde
        // dadurch nie gezeichnet (seit AP12, in AP17 nachgemessen).
        try {
            const kennzeichenVorher = this._geschriebeneAuswahl;

            // Die Sensorauswahl des Benutzers bleibt erhalten.
            const detector = new HardwareDetector(this._sensorAuswahl());

            this._detector = detector;
            this._measurement.setHardwareDetector(detector);

            /*
             * Die neue Erkennung kennt das gemessene Laufwerk noch
             * nicht. Ohne diese Zeile faellt sie bei zwei
             * gleichartigen Platten wieder auf den zuerst gefundenen
             * Sensor zurueck, und "Hardware neu erkennen" machte die
             * Zuordnung aus Befund B1 zunichte (Befund B8 aus AP25,
             * auf dem Zweitgeraet belegt).
             *
             * Die Zeile steht vor _aktualisiereSensorOptionen(): Sonst
             * traegt das Auswahlfeld den Eintrag "Automatisch (...)"
             * noch mit dem falschen Sensor ein.
             *
             * Regel: Wer einen HardwareDetector erzeugt, muss ihm auch
             * das gemessene Laufwerk nennen.
             */
            detector.setzeLaufwerkGeraet(
                this._measurement.laufwerkGeraet());

            this._aktualisiereSensorOptionen();

            // Nur wenn Sensoren, Schnittstellen oder Laufwerke
            // hinzugekommen oder weggefallen sind und das
            // Einstellungsfenster offen ist, muss es neu geoeffnet
            // werden. Das geschieht nie ohne Rueckfrage.
            const auswahlNeu =
                this._geschriebeneAuswahl !== kennzeichenVorher;

            const fensterOffen =
                auswahlNeu && this._findeEinstellungsfenster() !== null;

            const verfuegbar = detector.getAvailability();

            const gefunden = Object.keys(verfuegbar)
                .filter(id => verfuegbar[id] === true);

            const fehlend = Object.keys(verfuegbar)
                .filter(id => verfuegbar[id] === false);

            global.log(
                "aVincePulse AP12: hardware rescan - available: " +
                (gefunden.join(", ") || "none") +
                " | missing: " + (fehlend.join(", ") || "none")
            );

            // Die Verfuegbarkeit kann sich geaendert haben, deshalb
            // werden die Anzeigezeilen vollstaendig neu aufgebaut.
            // Das geschieht sofort und wartet nicht auf den Bericht.
            this._baueZeilenNeu();

            /*
             * Bericht ablegen, damit das Ergebnis nachlesbar ist, ohne
             * das Systemprotokoll durchsuchen zu muessen.
             *
             * Der Bericht nennt den freien Platz jedes Laufwerks und
             * holt sich diese Werte seit AP26 asynchron. Meldung und
             * Rueckfrage stehen deshalb im Rueckruf: Die Meldung sagt
             * aus, ob der Bericht geschrieben werden konnte.
             *
             * auswahlNeu und fensterOffen sind vorher ermittelt und
             * bleiben gueltig - die Reihenfolge der Pruefungen aendert
             * sich nicht (AP12, AP16, AP17).
             */
            this._schreibeHardwareBericht(detector, (pfad) => {
                if (this._entfernt)
                    return;

                try {
                    const meldung =
                        _("Hardware detected again") + "\n\n" +
                        fuelle(
                            _("%s of %s sensor-based values available"),
                            gefunden.length,
                            Object.keys(verfuegbar).length
                        ) +
                        (fehlend.length
                            ? "\n" + fuelle(_("Not found: %s"),
                                            fehlend.join(", "))
                            : "") +
                        (pfad
                            ? "\n\n" + _("Report saved \u2013 reachable " +
                                         "from the settings under " +
                                         "“Open the hardware reports”")
                            : "") +
                        (auswahlNeu
                            ? "\n\n" + _("Sensors, interfaces or drives " +
                                         "have appeared or gone \u2013 the " +
                                         "lists are up to date.")
                            : "\n\n" + _("The sensors, interfaces and " +
                                         "drives on offer are unchanged."));

                    if (fensterOffen) {
                        // Erst fragen, dann melden: Meldung und
                        // Rueckfrage stuenden sonst uebereinander in
                        // der Bildschirmmitte.
                        this._statusAnzeige.verberge();
                        this._frageNeuOeffnen(meldung);
                        return;
                    }

                    this._statusAnzeige.zeige(meldung);
                    this._statusAnzeige.verbergeNachLesezeit();

                } catch (e) {
                    global.logError(e);
                    this._statusAnzeige.zeige(
                        _("The hardware detection failed."));
                    this._statusAnzeige.verbergeNach(8);
                }
            });

        } catch (e) {
            global.logError(e);
            this._statusAnzeige.zeige(_("The hardware detection failed."));
            this._statusAnzeige.verbergeNach(8);
        }
    }

    /*
     * Schreibt den Hardwarebericht als Textdatei.
     *
     * Je Komponente gibt es genau eine Datei, die bei jeder Erkennung
     * ueberschrieben wird. Das Kuerzel am Anfang zeigt, welche
     * Komponente den Bericht erstellt hat.
     *
     * Vorher trug der Dateiname Datum und Uhrzeit, jeder Druck auf
     * "Hardware neu erkennen" hinterliess also eine weitere Datei und
     * geloescht wurde nie. Die Hardware eines Rechners aendert sich
     * aber selten: Aufeinanderfolgende Berichte unterschieden sich nur
     * im Zeitstempel und in der Momentantemperatur, der Sensorbestand
     * war derselbe. Gebraucht wird der letzte Stand, nicht eine Kette
     * fast gleicher Momentaufnahmen (Befund P31 aus AP25, Weg B).
     *
     * Der Zeitpunkt der Erkennung geht dadurch nicht verloren - er
     * steht im Bericht selbst unter "Erstellt am".
     *
     * Die Speedtest-Berichte bleiben unveraendert: dort ist der
     * Verlauf gerade der Zweck.
     *
     * Bereits vorhandene Berichte mit Zeitstempel im Namen werden
     * nicht angeruehrt. aVincePulse loescht nichts, was der Nutzer
     * noch lesen will; wer aufraeumen moechte, tut es selbst.
     *
     * Der Laufwerksteil des Berichts wird seit AP26 asynchron
     * geholt; die Funktion meldet ihr Ergebnis deshalb ueber einen
     * Rueckruf statt ueber den Rueckgabewert.
     *
     * fertig(pfad): Pfad der geschriebenen Datei, oder null.
     */
    _schreibeHardwareBericht(detector, fertig) {
        this._measurement.berichtTextAsync((laufwerkTeil) => {
            let pfad = null;

            try {
                const verzeichnis = this._berichtsVerzeichnis("Hardware");

                GLib.mkdir_with_parents(verzeichnis, 0o755);

                pfad = GLib.build_filenamev([
                    verzeichnis,
                    "aVP-desklet-hardware-bericht.txt"
                ]);

                GLib.file_set_contents(
                    pfad,
                    detector.berichtText("aVincePulse Desklet") + laufwerkTeil
                );

            } catch (e) {
                global.logError(e);
                pfad = null;
            }

            fertig(pfad);
        });
    }

    /*
     * Verzeichnis der Berichte.
     *
     * Hardwareerkennung und Speedtest legen in getrennten
     * Unterordnern ab, damit die Uebersicht erhalten bleibt.
     */
    _berichtsVerzeichnis(unterordner) {
        const teile = [
            GLib.get_user_data_dir(),
            "avincepulse",
            "berichte"
        ];

        if (unterordner)
            teile.push(unterordner);

        return GLib.build_filenamev(teile);
    }

    /*
     * Oeffnet einen Berichtsordner im Dateimanager.
     *
     * Hardwareerkennung und Speedtest legen in getrennten
     * Unterordnern ab. Die Schaltflaechen fuehren deshalb direkt
     * zum jeweils passenden Ordner, statt beide in den
     * gemeinsamen Elternordner zu fuehren.
     */
    _oeffneBerichte(unterordner) {
        try {
            const verzeichnis = this._berichtsVerzeichnis(unterordner);

            GLib.mkdir_with_parents(verzeichnis, 0o755);

            // Den URI vom Dateiobjekt bilden lassen, nicht selbst
            // zusammensetzen: ein Pfad mit Leerzeichen, Umlaut, "#"
            // oder "?" ergaebe sonst einen ungueltigen URI
            // (Befund P19 aus AP25).
            Gio.AppInfo.launch_default_for_uri(
                Gio.File.new_for_path(verzeichnis).get_uri(),
                null
            );

        } catch (e) {
            global.logError(e);

            this._statusAnzeige.zeige(
                _("The report folder could not be opened.")
            );
            this._statusAnzeige.verbergeNach(8);
        }
    }

    on_berichte_hardware_oeffnen() {
        this._oeffneBerichte("Hardware");
    }

    on_berichte_speedtest_oeffnen() {
        this._oeffneBerichte("Speedtest");
    }

    /*
     * Oeffnet die Unterstuetzerseite im Browser (AP23).
     *
     * Nur nach einem Klick des Benutzers, entsprechend der
     * Fensterregel aus Abschnitt 8 der Projektdokumentation und der
     * Regel von Cinnamon Spices, dass ein Unterstuetzen-Hinweis den
     * Benutzer nicht unterbrechen darf. Das Programm oeffnet von
     * sich aus nie etwas.
     *
     * Die Adresse steht in metrics.js, damit Applet und Desklet
     * nicht auseinanderlaufen koennen.
     */
    on_unterstuetzen() {
        // Ohne brauchbare Adresse waere der Browser irgendwohin
        // geschickt worden.
        if (unterstuetzenUrlFehlt()) {
            this._statusAnzeige.zeige(
                _("The support page is not set up yet.\n\n" +
                  "This development version does not carry an address.")
            );
            this._statusAnzeige.verbergeNachLesezeit();
            return;
        }

        try {
            Gio.AppInfo.launch_default_for_uri(UNTERSTUETZEN_URL, null);

        } catch (e) {
            global.logError(e);

            this._statusAnzeige.zeige(
                _("The support page could not be opened.")
            );
            this._statusAnzeige.verbergeNach(8);
        }
    }

    /*
     * Vorgabewert einer Einstellung, aus dem Schema gelesen.
     *
     * Ohne diese Funktion stand jeder Vorgabewert zweimal im Projekt:
     * im Schema, das Cinnamon beim ersten Start und im
     * Einstellungsfenster auswertet, und noch einmal im Code, den
     * on_standardwerte_zuruecksetzen() verwendet. Am 22.09.2026 liefen
     * beide auseinander - die geaenderte Vorgabe des Leistensymbols
     * kam beim Zuruecksetzen nicht an (Befund P28 aus AP25). Das
     * Schema ist die eine Quelle, hier wird sie gelesen.
     *
     * settingsData ist kein dokumentierter Bestandteil der
     * Einstellungs-API - anders als getValue(), setValue() und
     * setOptions(). Cinnamon selbst greift durchgehend darauf zu
     * (settings.js:308, 312, 316, 336), es ist also stabil, aber ein
     * Implementierungsdetail. Faellt es eines Tages weg, greift der
     * Ersatzwert; ohne ihn stuende undefined in der Einstellungsdatei.
     */
    _vorgabe(schluessel, ersatz) {
        try {
            const daten = this.settings && this.settings.settingsData;
            const eintrag = daten ? daten[schluessel] : null;

            if (eintrag && eintrag.default !== undefined)
                return eintrag.default;

        } catch (e) {
            global.logError(e);
        }

        global.logError(
            "aVincePulse: no default for \"" + schluessel +
            "\" in the schema, using the built-in value");

        return ersatz;
    }

    on_standardwerte_zuruecksetzen() {
        if (!this.settings)
            return;

        // Alle Einzelwerte aus dem Schema, nicht aus dem Code
        // (Befund P28 aus AP25). Schriftgroesse, Schriftstaerke und
        // Messtakt standen hier als Zahl bzw. Text mitten in der
        // Funktion - dieselbe Falle wie beim Leistensymbol im Applet.
        const schriftgroesse = this._vorgabe("font-size", 14);
        const schriftstaerke = this._vorgabe("font-weight", "600");
        const intervall = this._vorgabe("refresh-interval", 3);
        const deckkraft = this._vorgabe(
            "hintergrund-deckkraft", DEFAULT_HINTERGRUND_DECKKRAFT);

        this.settings.setValue("font-size", schriftgroesse);
        this.settings.setValue("font-weight", schriftstaerke);
        this.settings.setValue("hintergrund-deckkraft", deckkraft);
        this.settings.setValue("refresh-interval", intervall);

        // Messwertliste: alle sichtbar, Reihenfolge und
        // Bezeichnungen wie ausgeliefert.
        const liste = standardMesswertListe();

        this.settings.setValue("messwert-liste", liste);
        this.messwertListe = liste;

        // Sensorauswahl: ueberall wieder automatisch. Da beide
        // Komponenten dieselbe automatische Auswahl verwenden, zeigen
        // sie danach dieselben Sensoren.
        for (const art in SENSOR_SCHLUESSEL) {
            const schluessel = SENSOR_SCHLUESSEL[art];
            const wert = this._vorgabe(schluessel, "auto");

            this.settings.setValue(schluessel, wert);
            this["sensorwahl_" + art] = wert;
        }

        // Netzwerkschnittstelle und Laufwerk ebenfalls automatisch.
        const netz = this._vorgabe("netz-schnittstelle", "auto");
        const laufwerk = this._vorgabe("laufwerk-free", "auto");

        this.settings.setValue("netz-schnittstelle", netz);
        this.settings.setValue("laufwerk-free", laufwerk);
        this.netzWahl = netz;
        this.laufwerkWahl = laufwerk;
        this._uebernehmeQuellenAuswahl();

        // Speedtest-Programm wieder automatisch (AP22).
        const programm = this._vorgabe("speedtest-programm", "auto");

        this.settings.setValue("speedtest-programm", programm);
        this.speedtestProgramm = programm;
        this._uebernehmeSpeedtestProgramm();

        // Warnschwellen: eingeschaltet, Vorgaben.
        const warnListe = standardWarnListe();

        const warnAktiv = this._vorgabe("warnschwellen-aktiv", true);
        const warnfarben = this._vorgabe("warnfarben-satz", WARNFARBEN_VORGABE);

        this.settings.setValue("warnschwellen-aktiv", warnAktiv);
        this.settings.setValue("warnfarben-satz", warnfarben);
        this.settings.setValue("warnschwellen-liste", warnListe);
        this.warnAktiv = warnAktiv;
        this.warnfarbenSatz = warnfarben;
        this.warnListe = warnListe;

        this._detector.setzeAuswahl(this._sensorAuswahl());
        this._aktualisiereSensorOptionen();

        this.fontSize = schriftgroesse;
        this.fontWeight = schriftstaerke;
        this.hintergrundDeckkraft = deckkraft;
        this.refreshInterval = intervall;

        this._baueZeilenNeu();

        this._statusAnzeige.zeige(
            _("Settings restored to their defaults"));
        this._statusAnzeige.verbergeNachLesezeit();

        global.log("aVincePulse AP12: settings reset to defaults");
    }

    /*
     * Startet den Internet-Speedtest.
     * Wird aus dem Kontextmenue und aus den Einstellungen gerufen.
     */
    starteSpeedtest() {
        if (this._entfernt || this._speedtest.istAktiv())
            return;

        this._statusAnzeige.zeige(_("Internet speed test running …"));

        this._speedtest.starte(ergebnis => {
            // Nach dem Entfernen keine Meldung mehr (Befund M2).
            if (this._entfernt || !this._statusAnzeige)
                return;

            if (ergebnis.erfolg) {
                this._statusAnzeige.zeige(
                    _("Speed test finished") + "\n\n" +
                    fuelle(
                        _("Download %s MBit/s, upload %s MBit/s"),
                        ergebnis.werte.SPEED_DOWN,
                        ergebnis.werte.SPEED_UP
                    ) +
                    (ergebnis.bericht
                        ? "\n\n" + _("Report saved \u2013 reachable from " +
                                     "the settings under “Open the speed " +
                                     "test reports”")
                        : "")
                );
                this._statusAnzeige.verbergeNachLesezeit();
                // Nicht _update() direkt: das startete eine zweite
                // Messschleife (Befund K1).
                this._starteMessungNeu();
            } else {
                // Die Meldung bleibt kurz stehen, damit der Grund
                // des Fehlschlags lesbar ist.
                this._statusAnzeige.zeige(ergebnis.meldung);
                this._statusAnzeige.verbergeNach(8);
            }
        });
    }

    on_speedtest_starten() {
        this.starteSpeedtest();
    }

    on_desklet_removed() {
        // Ab hier wird nicht mehr gemessen und nichts mehr aufgebaut.
        this._entfernt = true;

        // Einstellungen abmelden. Sonst leitet Cinnamon Aenderungen aus
        // einem noch offenen Einstellungsfenster weiter an dieses
        // entfernte Desklet (Befund M1). Das Applet macht das bereits.
        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }

        if (this._rueckfrage) {
            this._rueckfrage.close();
            this._rueckfrage = null;
        }

        this._trenneFensterSignal();

        if (this._fensterZeitgeber) {
            Mainloop.source_remove(this._fensterZeitgeber);
            this._fensterZeitgeber = null;
        }

        // Ein laufender Speedtest wird beendet (Befund M2).
        if (this._speedtest)
            this._speedtest.verwerfe();

        if (this._statusAnzeige) {
            this._statusAnzeige.zerstoere();
            this._statusAnzeige = null;
        }

        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    }
}

function main(metadata, desklet_id) {
    return new AVinceHWMonitor(metadata, desklet_id);
}
