// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const UUID = "avincelaunch-desklet@avince";
const {
    makeItemId,
    parseFolderEntry,
    parseDesktopEntry,
    parseDocumentEntry,
    applyOrdering,
    sortItems,
    scanDirectoryFromInfos,
    ENTRY_ATTRIBUTES
} = imports.desklets[UUID].lib.linkScanner;

// AP10b-1 - Portal im Hintergrund einlesen.
//
// Der Einlesecode der Gruppen (linkScanner.scanDirectory) laeuft synchron im
// Cinnamon-Hauptprozess und oeffnet jede Datei einzeln zur Pruefung. Auf der
// NAS fror das den Schreibtisch ein (296 Eintraege: 2,6-2,8 s, Messung
// 03.10.). Hier holt EIN asynchroner Durchgang Name, Art und "versteckt" aller
// Eintraege stapelweise; nichts wird geoeffnet ausser .desktop-Dateien.
//
// Verweise (Symlinks) zeigen ihr Ziel, behalten aber ihren Pfad IM Portal -
// so bleibt die Navigation im Portal und die Schutzschicht greift.
//
// Es wird nie geschrieben und nie eine Sidecar-Datei gelesen: Portale
// sortieren immer automatisch (Entscheidung 03.10.).

// time::* fuer die Sortierarten "Aenderungsdatum" und "zuletzt
// hinzugefuegt" (AP18-3) - stehen im selben Durchgang, kein Oeffnen.
const ATTRIBUTES = "standard::name,standard::type,standard::is-hidden,time::modified,time::changed";
const BATCH_SIZE = 64;
const EMPTY_SIDECAR = { version: 1, order: [], disabled: [], folderClickMode: null, itemStyles: {} };

// options: { showHidden, folderSort, limit }
// callback(result): { items, sidecar, error, total, truncated }
// Rueckgabe: Gio.Cancellable - cancel() verwirft das Ergebnis.
function scanPortalAsync(directoryPath, options, callback) {
    const showHidden = !!(options && options.showHidden);
    const folderSort = options && options.folderSort ? options.folderSort : "mixed";
    const sortMode = options && options.sortMode ? options.sortMode : "manual";
    const limit = options && options.limit > 0 ? options.limit : 0;
    const cancellable = new Gio.Cancellable();
    const items = [];

    function finish(error) {
        if (cancellable.is_cancelled()) {
            return;
        }
        if (error) {
            callback({ items: [], sidecar: EMPTY_SIDECAR, error: error, total: 0, truncated: 0 });
            return;
        }
        // Portale haben keine gespeicherte Reihenfolge: "manual" = A-Z.
        const ordered = sortMode === "manual"
            ? applyOrdering(items, [], folderSort)
            : sortItems(items, sortMode, folderSort);
        const total = ordered.length;
        const shown = limit && total > limit ? ordered.slice(0, limit) : ordered;
        callback({
            items: shown,
            sidecar: EMPTY_SIDECAR,
            error: null,
            total: total,
            truncated: total - shown.length
        });
    }

    function addEntry(info) {
        const before = items.length;
        addParsedEntry(info);
        if (items.length > before) {
            const item = items[items.length - 1];
            item.mtime = info.get_attribute_uint64("time::modified");
            item.ctime = info.get_attribute_uint64("time::changed");
        }
    }

    function addParsedEntry(info) {
        const name = info.get_name();
        if (!showHidden && (name.charAt(0) === "." || info.get_is_hidden())) {
            return;
        }

        const path = GLib.build_filenamev([directoryPath, name]);
        const type = info.get_file_type();

        if (type === Gio.FileType.DIRECTORY) {
            items.push(parseFolderEntry(path, name, EMPTY_SIDECAR));
            return;
        }
        if (type !== Gio.FileType.REGULAR) {
            // Defekte Verweise, Geraete, Sockets: nicht anzeigen.
            return;
        }
        if (name.endsWith(".desktop")) {
            const app = parseDesktopEntry(path, name);
            if (app) {
                items.push(app);
            }
            return;
        }
        const doc = parseDocumentEntry(path);
        doc.id = makeItemId("document", name);
        doc.fileName = name;
        items.push(doc);
    }

    function nextBatch(enumerator) {
        enumerator.next_files_async(BATCH_SIZE, GLib.PRIORITY_LOW, cancellable, (source, result) => {
            let infos;
            try {
                infos = source.next_files_finish(result);
            } catch (e) {
                if (!cancellable.is_cancelled()) {
                    finish("unreadable");
                }
                return;
            }
            if (!infos || infos.length === 0) {
                enumerator.close_async(GLib.PRIORITY_LOW, null, () => {});
                finish(null);
                return;
            }
            infos.forEach(info => {
                try {
                    addEntry(info);
                } catch (e) {
                    // Einzelner Eintrag unlesbar - die uebrigen trotzdem zeigen.
                }
            });
            nextBatch(enumerator);
        });
    }

    let dir;
    try {
        dir = Gio.File.new_for_path(directoryPath);
    } catch (e) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            finish("missing");
            return GLib.SOURCE_REMOVE;
        });
        return cancellable;
    }

    // FileQueryInfoFlags.NONE: Verweise liefern die Art ihres Ziels.
    dir.enumerate_children_async(ATTRIBUTES, Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_LOW, cancellable, (source, result) => {
            let enumerator;
            try {
                enumerator = source.enumerate_children_finish(result);
            } catch (e) {
                if (cancellable.is_cancelled()) {
                    return;
                }
                const missing = e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
                finish(missing ? "missing" : "unreadable");
                return;
            }
            nextBatch(enumerator);
        });

    return cancellable;
}

// Schritt 4, V4d - Link-Ordner auf einem Netzlaufwerk.
//
// Liegt der Basisordner auf einer Freigabe, las jeder Fence seinen Ordner
// synchron im Cinnamon-Hauptprozess (linkScanner.scanDirectory); hing die
// Freigabe, stand der ganze Schreibtisch - bei jedem Fence einmal. Hier wird
// zuerst asynchron und stapelweise aufgelistet. Erst wenn die Freigabe darauf
// geantwortet hat, bereitet scanDirectoryFromInfos die Eintraege auf - mit
// demselben Code wie bisher (Reihenfolge-Datei, Verweise, .desktop-Dateien,
// Sortierarten, Angepinnte). Haengt die Freigabe, kommt kein Stapel an, und
// die Zeitgrenze des ScanGate (unten) meldet "nicht erreichbar".
//
// options: wie scanDirectory (persistOrder, folderSort, sortMode)
// callback(result): wie scanDirectory; error "missing" | "unreadable"
// Rueckgabe: Gio.Cancellable - cancel() verwirft das Ergebnis.
function scanLinkDirectoryAsync(directoryPath, options, callback) {
    const cancellable = new Gio.Cancellable();
    const infos = [];

    function fail(error) {
        if (!cancellable.is_cancelled()) {
            callback({ items: [], manualItems: [], sidecar: EMPTY_SIDECAR, error: error });
        }
    }

    function nextBatch(enumerator) {
        enumerator.next_files_async(BATCH_SIZE, GLib.PRIORITY_LOW, cancellable, (source, result) => {
            let batch;
            try {
                batch = source.next_files_finish(result);
            } catch (e) {
                fail("unreadable");
                return;
            }
            if (!batch || batch.length === 0) {
                enumerator.close_async(GLib.PRIORITY_LOW, null, () => {});
                if (cancellable.is_cancelled()) {
                    return;
                }
                let scan;
                try {
                    scan = scanDirectoryFromInfos(directoryPath, infos, options);
                } catch (e) {
                    fail("unreadable");
                    return;
                }
                callback(scan);
                return;
            }
            batch.forEach(info => infos.push(info));
            nextBatch(enumerator);
        });
    }

    let dir;
    try {
        dir = Gio.File.new_for_path(directoryPath);
    } catch (e) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            fail("missing");
            return GLib.SOURCE_REMOVE;
        });
        return cancellable;
    }

    // FileQueryInfoFlags.NONE wie scanDirectory: Verweise liefern die Art
    // ihres Ziels.
    dir.enumerate_children_async(ENTRY_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_LOW, cancellable, (source, result) => {
            let enumerator;
            try {
                enumerator = source.enumerate_children_finish(result);
            } catch (e) {
                const missing = e.matches && (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
                    || e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_DIRECTORY));
                fail(missing ? "missing" : "unreadable");
                return;
            }
            nextBatch(enumerator);
        });

    return cancellable;
}

// Pruefung Phase 2, P50: hoechstens EIN Einlesen je Fence.
//
// Abbrechen (Gio.Cancellable) loest keinen haengenden Systemaufruf: auf einer
// haengenden NAS blieb jeder abgebrochene Durchgang in einem Faden aus GIOs
// gemeinsamem Vorrat stehen, und jeder Neuaufbau (Einstellungen, Sperren,
// "Titel aller Fences") startete einen weiteren. Jetzt wartet jede Anfrage,
// solange ein Durchgang laeuft; alle Anfragen in dieser Zeit ergeben genau
// EINEN Folgedurchgang mit dem neuesten Stand. Anfragen der regelmaessigen
// Abfrage (fromPoll) entfallen dann ganz.
//
// Schritt 4, BT3 (Befund T16): Kehrt ein Durchgang nie zurueck (hart
// eingehaengte Freigabe), blieb das Portal bis zum Neustart auf dem alten
// Stand. Jetzt gilt ein Durchgang nach options.timeoutMs (Vorgabe 2 min) als
// "haengt": onResult bekommt options.timeoutResult(job) (das Desklet zeigt
// "nicht erreichbar"), und es ist GENAU EIN weiterer Durchgang erlaubt. Haengt
// auch der, startet nichts mehr, bis einer der haengenden doch zurueckkehrt -
// so bleiben hoechstens zwei Faeden stehen. Kehrt ein haengender spaet
// zurueck, zaehlt sein Ergebnis wie ein normales (die Freigabe ist wieder da),
// ausser es laeuft schon ein neuerer Durchgang oder es wartet eine Anfrage.
// cancel() (anderer Ordner, Abbau) vergisst auch die haengenden: ihre
// Ergebnisse gelten nicht mehr, und der neue Ordner darf sofort eingelesen
// werden - ein bewusster Wechsel, kein automatischer Neuaufbau.
//
// scanFn(job, done) startet einen Durchgang und liefert ein Gio.Cancellable
// (oder null); done(result) meldet das Ergebnis.
// onResult(job, result, superseded) - superseded = ein Folgedurchgang steht
// schon an, das Ergebnis ist also veraltet.
// options: { timeoutMs, timeoutResult(job) } - ohne timeoutResult keine
// Zeitgrenze.
const SCAN_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_STALLED = 2;

var ScanGate = class ScanGate {
    constructor(scanFn, onResult, options) {
        this._scanFn = scanFn;
        this._onResult = onResult;
        this._timeoutMs = options && options.timeoutMs > 0 ? options.timeoutMs : SCAN_TIMEOUT_MS;
        this._timeoutResult = options && options.timeoutResult ? options.timeoutResult : null;
        this._running = null;
        this._pending = null;
        this._stalled = [];
        this._token = 0;
    }

    get busy() {
        return !!this._running;
    }

    // Anzahl der Durchgaenge, die die Zeitgrenze ueberschritten haben und
    // noch nicht zurueckgekehrt sind.
    get stalled() {
        return this._stalled.length;
    }

    // Liefert true, wenn sofort eingelesen wird, sonst false (wartet bzw.
    // entfaellt).
    request(job) {
        if (this._running || this._stalled.length >= MAX_STALLED) {
            if (!job.fromPoll) {
                this._pending = job;
            }
            return false;
        }
        this._start(job);
        return true;
    }

    _start(job) {
        const token = ++this._token;
        const running = { job: job, cancellable: null, timerId: 0, token: token };
        this._running = running;
        if (this._timeoutResult) {
            running.timerId = GLib.timeout_add(GLib.PRIORITY_LOW, this._timeoutMs, () => {
                running.timerId = 0;
                this._onTimeout(running);
                return GLib.SOURCE_REMOVE;
            });
        }
        const cancellable = this._scanFn(job, (result) => this._onDone(running, result));
        if (this._running === running) {
            running.cancellable = cancellable || null;
        }
    }

    _stopTimer(run) {
        if (run.timerId) {
            GLib.source_remove(run.timerId);
            run.timerId = 0;
        }
    }

    _onDone(run, result) {
        this._stopTimer(run);
        const stalledAt = this._stalled.indexOf(run);
        if (stalledAt >= 0) {
            // Spaet zurueckgekehrt: der Faden ist wieder frei.
            this._stalled.splice(stalledAt, 1);
            if (this._running) {
                return;
            }
            const next = this._pending;
            this._pending = null;
            this._onResult(run.job, result, !!next);
            if (next && !this._running) {
                this._start(next);
            }
            return;
        }
        if (run.token !== this._token || this._running !== run) {
            return;
        }
        this._running = null;
        const next = this._pending;
        this._pending = null;
        this._onResult(run.job, result, !!next);
        if (next && !this._running) {
            this._start(next);
        }
    }

    _onTimeout(run) {
        if (this._running !== run) {
            return;
        }
        this._running = null;
        this._stalled.push(run);
        const next = this._stalled.length < MAX_STALLED ? this._pending : null;
        if (next) {
            this._pending = null;
        }
        this._onResult(run.job, this._timeoutResult(run.job), !!next);
        if (next && !this._running) {
            this._start(next);
        }
    }

    // Beim Wechsel des Portal-Ordners und beim Abbau: Ergebnis verwerfen,
    // nichts nachholen.
    cancel() {
        this._token++;
        this._pending = null;
        const runs = this._stalled.slice();
        this._stalled = [];
        if (this._running) {
            runs.push(this._running);
        }
        this._running = null;
        runs.forEach(run => {
            this._stopTimer(run);
            if (run.cancellable) {
                run.cancellable.cancel();
            }
        });
    }
};
