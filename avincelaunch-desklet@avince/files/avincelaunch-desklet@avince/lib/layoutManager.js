// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;

// AP13a/b - Groesse aendern, Fence-Verzeichnis, Hilfslinien, Ablage.
//
// AP13a - Groesse eines Fence mit der Maus aendern.
//
// Gezogen wird nur am rechten Rand, am unteren Rand und an der Ecke unten
// rechts. Waehrend des Ziehens zeigt ein Rahmen die neue Groesse; gespeichert
// wird erst beim Loslassen, genau einmal. Die Maus wird wie bei Cinnamons
// eigenem Verschieben (dnd.js) ueber pushModal festgehalten und an vier
// Stellen wieder freigegeben: Loslassen, Esc, Zerstoeren des Fence und
// 30 Sekunden ohne Bewegung.

var EDGE_ZONE = 8;
var CORNER_ZONE = 12;

// Untergrenze der Groesse. Die Obergrenze ist die Arbeitsflaeche; beides
// haelt max-width/max-height sicher von min (0) und max (4000) im Schema
// fern - Werte genau auf der Grenze setzt Cinnamon sonst zurueck.
var MIN_SIZE = 120;
const MAX_SIZE_GUARD = 3990;

const IDLE_ABORT_MS = 30000;
const IDLE_CHECK_MS = 5000;

// Zeiger aus Muffin, wie in Cinnamons accessibility.js. Die Zeiger aus
// Cinnamon.Cursor zeigten im Test an den Raendern nichts an, und zum
// Verschieben nur eine Hand - gewuenscht ist das Kreuz.
const ZONE_CURSORS = {
    right: Meta.Cursor.EAST_RESIZE,
    bottom: Meta.Cursor.SOUTH_RESIZE,
    corner: Meta.Cursor.SE_RESIZE,
    move: Meta.Cursor.MOVE_OR_RESIZE_WINDOW
};

// Es gibt nur einen Mauszeiger. Frueher merkte sich jeder Fence selbst,
// was er gesetzt hatte; wanderte die Maus zum Nachbarn, blieb z. B. das
// Kreuz stehen (Test 01.10.). Jetzt ein gemeinsamer Zustand fuer alle.
let _cursorName = null;

function applyCursor(name) {
    if (name === _cursorName) {
        return;
    }
    global.display.set_cursor(name ? ZONE_CURSORS[name] : Meta.Cursor.DEFAULT);
    _cursorName = name;
}

// Nach fremden Eingriffen (Cinnamons Verschieben setzt den Zeiger selbst)
// ist der gemerkte Zustand unbekannt: hart zuruecksetzen.
function forgetCursor() {
    _cursorName = null;
    global.display.set_cursor(Meta.Cursor.DEFAULT);
}

// Arbeitsflaeche des Bildschirms, auf dem der Fence liegt - ohne Panel.
function getWorkAreaForActor(actor) {
    try {
        const monitor = Main.layoutManager.findMonitorForActor(actor);
        // AP15c: nur noch workspace_manager (seit Cinnamon 4); den alten
        // Rueckfall ueber das fruehere MetaScreen-Objekt gibt es unter
        // Wayland nicht.
        const manager = global.workspace_manager;
        if (!monitor || !manager) {
            return null;
        }
        return manager.get_active_workspace().get_work_area_for_monitor(monitor.index);
    } catch (e) {
        return null;
    }
}

// N16 (Tower avltest, 12.10.): EDGE_ZONE und CORNER_ZONE sind logische
// Punkte. Bei UI-Skalierung 2 rechnet der Akteur in doppelt so vielen
// Bildpunkten; mit festen 8 px war der Rand nur noch halb so breit und kaum
// zu treffen. global.ui_scale fehlt in alten Cinnamon-Fassungen -> 1.
function zoneScale() {
    try {
        const scale = Number(global.ui_scale);
        return scale >= 1 ? scale : 1;
    } catch (e) {
        return 1;
    }
}

// Die Zonen werden am sichtbaren Fence gemessen. Der Desklet-Akteur kann
// groesser sein als die sichtbare Flaeche; dann laegen schmale Randzonen
// ausserhalb dessen, was man sieht.
function hitZone(actor, stageX, stageY) {
    if (!actor) {
        return null;
    }
    const [ok, x, y] = actor.transform_stage_point(stageX, stageY);
    if (!ok) {
        return null;
    }

    const width = actor.get_width();
    const height = actor.get_height();
    if (x < 0 || y < 0 || x > width || y > height) {
        return null;
    }

    const scale = zoneScale();
    const corner = CORNER_ZONE * scale;
    const edge = EDGE_ZONE * scale;
    if (x >= width - corner && y >= height - corner) {
        return "corner";
    }
    if (x >= width - edge) {
        return "right";
    }
    if (y >= height - edge) {
        return "bottom";
    }
    return null;
}

function snapEdge(origin, size, interval) {
    if (!interval || interval <= 0) {
        return size;
    }
    return Math.round((origin + size) / interval) * interval - origin;
}

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

// options:
//   actor           der Desklet-Akteur
//   isLocked()      true = Groesse gesperrt
//   isMoveLocked()  true = Verschieben gesperrt (optional, AP18-4;
//                   fehlt es, gilt isLocked fuer beides wie bisher)
//   isMoveSource(a) true, wenn der Akteur zur Titelzeile gehoert
//   getSnapInterval() Raster in px, 0 = aus
//   onBegin()       vor dem ersten Rahmen
//   describe(w, h, zone) Text im Rahmen
//   onResized(w, h, zone) beim Loslassen, nur bei echter Aenderung
//   getFrameActor() sichtbare Flaeche des Fence (optional)
//   canResize()     false = keine Randzonen, z. B. eingeklappt (optional)
//   adjustSize(rect, w, h, zone, free) -> { w, h, guides } (optional, AP13b)
//   showGuides(guides)  Hilfslinien zeigen, [] = ausblenden (optional)
var FenceResizer = class FenceResizer {
    constructor(options) {
        this._options = options;
        this._actor = options.actor;
        this._active = false;

        this._capturedId = this._actor.connect(
            "captured-event",
            this._onCapturedEvent.bind(this)
        );
        this._hoverId = this._actor.connect("notify::hover", () => {
            if (!this._active && !this._actor.hover) {
                applyCursor(null);
            }
        });
    }

    destroy() {
        this._finish(false);
        this._setCursor(null);
        if (this._actor) {
            if (this._actor.hover) {
                applyCursor(null);
            }
            if (this._capturedId) {
                this._actor.disconnect(this._capturedId);
            }
            if (this._hoverId) {
                this._actor.disconnect(this._hoverId);
            }
        }
        this._capturedId = 0;
        this._hoverId = 0;
        this._actor = null;
    }

    _resizeZone(stageX, stageY) {
        if (this._options.canResize && !this._options.canResize()) {
            return null;
        }
        return hitZone(this._frameActor(), stageX, stageY);
    }

    _frameActor() {
        const frame = this._options.getFrameActor ? this._options.getFrameActor() : null;
        if (frame && !frame.is_finalized() && frame.get_stage()) {
            return frame;
        }
        return this._actor;
    }

    isActive() {
        return this._active;
    }

    // Zeiger zuruecksetzen. Beim Verschieben fuehrt Cinnamon den Zeiger
    // selbst; danach weiss diese Klasse nicht mehr, was gerade angezeigt wird.
    resetCursor() {
        forgetCursor();
    }

    // Zeiger fuer ein Ereignis, das nicht ueber diesen Fence hereinkam
    // (z. B. waehrend ein Menue offen ist). null = nicht ueber diesem Fence.
    cursorForEvent(event) {
        const [stageX, stageY] = event.get_coords();
        const [ok, x, y] = this._actor.transform_stage_point(stageX, stageY);
        if (!ok || x < 0 || y < 0 || x > this._actor.get_width() || y > this._actor.get_height()) {
            return undefined;
        }
        return this._cursorFor(event);
    }

    // Laufendes Ziehen abbrechen, z. B. wenn der Fence gesperrt wird.
    cancel() {
        this._finish(false);
    }

    _setCursor(name) {
        applyCursor(name);
    }

    _cursorFor(event) {
        const sizeLocked = this._options.isLocked();
        const moveLocked = this._options.isMoveLocked
            ? this._options.isMoveLocked() : sizeLocked;
        if (!sizeLocked) {
            const [stageX, stageY] = event.get_coords();
            const zone = this._resizeZone(stageX, stageY);
            if (zone) {
                return zone;
            }
        }
        if (!moveLocked && this._options.isMoveSource(event.get_source())) {
            return "move";
        }
        return null;
    }

    // Klick von aussen (z. B. der Klick, der ein Menue schliesst): liegt er
    // in einer Randzone, beginnt das Groesseaendern sofort.
    tryBeginFromEvent(event) {
        if (this._active || this._options.isLocked() || event.get_button() !== 1) {
            return false;
        }
        const [stageX, stageY] = event.get_coords();
        const zone = this._resizeZone(stageX, stageY);
        return !!zone && this._begin(event, zone);
    }

    _onCapturedEvent(actor, event) {
        if (this._active) {
            return Clutter.EVENT_PROPAGATE;
        }

        const type = event.type();
        if (type === Clutter.EventType.MOTION || type === Clutter.EventType.ENTER) {
            this._setCursor(this._cursorFor(event));
            return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === 1) {
            if (this._options.isLocked()) {
                return Clutter.EVENT_PROPAGATE;
            }
            const [stageX, stageY] = event.get_coords();
            const zone = this._resizeZone(stageX, stageY);
            if (zone && this._begin(event, zone)) {
                // Weder Kachel noch Cinnamons Verschieben bekommen den Klick.
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _begin(event, zone) {
        const handler = new Clutter.Actor({ width: 0, height: 0, reactive: true });
        Main.uiGroup.add_actor(handler);
        if (!Main.pushModal(handler)) {
            handler.destroy();
            return false;
        }

        this._handler = handler;
        this._device = event.get_device();
        this._device.grab(handler);
        this._eventId = handler.connect("event", this._onGrabEvent.bind(this));
        this._active = true;

        const [stageX, stageY] = event.get_coords();
        const frame = this._frameActor();
        const [originX, originY] = frame.get_transformed_position();
        this._zone = zone;
        this._start = {
            pointerX: stageX,
            pointerY: stageY,
            x: Math.round(originX),
            y: Math.round(originY),
            width: Math.round(frame.get_width()),
            height: Math.round(frame.get_height())
        };
        this._size = { width: this._start.width, height: this._start.height };
        this._area = getWorkAreaForActor(this._actor);

        this._lastMotion = GLib.get_monotonic_time();
        this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IDLE_CHECK_MS, () => {
            const idleMs = (GLib.get_monotonic_time() - this._lastMotion) / 1000;
            if (idleMs >= IDLE_ABORT_MS) {
                this._idleId = 0;
                this._finish(false);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });

        if (this._options.onBegin) {
            this._options.onBegin();
        }
        closeAllFenceMenus();
        this._buildOutline();
        this._updateOutline();
        return true;
    }

    _onGrabEvent(actor, event) {
        const type = event.type();

        if (type === Clutter.EventType.MOTION) {
            this._lastMotion = GLib.get_monotonic_time();
            this._resizeTo(event);
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._finish(true);
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._finish(false);
            }
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _resizeTo(event) {
        const [stageX, stageY] = event.get_coords();
        const start = this._start;

        // AP13b: Einrasten an Nachbarn, Raender, Ueberlappung.
        if (this._options.adjustSize) {
            const rect = { x: start.x, y: start.y, w: start.width, h: start.height };
            const free = !!(event.get_state() & Clutter.ModifierType.CONTROL_MASK);
            const result = this._options.adjustSize(rect,
                start.width + (stageX - start.pointerX),
                start.height + (stageY - start.pointerY),
                this._zone, free);
            this._size.width = Math.round(result.w);
            this._size.height = Math.round(result.h);
            if (this._options.showGuides) {
                this._options.showGuides(result.guides);
            }
            this._updateOutline();
            return;
        }

        const interval = this._options.getSnapInterval();

        let width = start.width;
        let height = start.height;

        if (this._zone === "right" || this._zone === "corner") {
            width = snapEdge(start.x, start.width + (stageX - start.pointerX), interval);
        }
        if (this._zone === "bottom" || this._zone === "corner") {
            height = snapEdge(start.y, start.height + (stageY - start.pointerY), interval);
        }

        let maxWidth = MAX_SIZE_GUARD;
        let maxHeight = MAX_SIZE_GUARD;
        if (this._area) {
            maxWidth = Math.min(maxWidth, this._area.x + this._area.width - start.x);
            maxHeight = Math.min(maxHeight, this._area.y + this._area.height - start.y);
        }

        this._size.width = Math.round(clamp(width, MIN_SIZE, Math.max(MIN_SIZE, maxWidth)));
        this._size.height = Math.round(clamp(height, MIN_SIZE, Math.max(MIN_SIZE, maxHeight)));
        this._updateOutline();
    }

    _buildOutline() {
        this._outlineLabel = new St.Label({
            style_class: "avincelaunch-resize-label",
            x_expand: true,
            y_expand: true
        });
        this._outlineLabel.set_x_align(Clutter.ActorAlign.CENTER);
        this._outlineLabel.set_y_align(Clutter.ActorAlign.CENTER);

        this._outline = new St.Bin({
            style_class: "avincelaunch-resize-outline",
            reactive: false
        });
        this._outline.set_child(this._outlineLabel);
        Main.uiGroup.add_actor(this._outline);
    }

    _updateOutline() {
        if (!this._outline) {
            return;
        }
        this._outline.set_position(this._start.x, this._start.y);
        this._outline.set_size(this._size.width, this._size.height);
        const text = this._options.describe
            ? this._options.describe(this._size.width, this._size.height, this._zone)
            : "%d × %d".format(this._size.width, this._size.height);
        this._outlineLabel.set_text(text);
    }

    _finish(commit) {
        if (!this._active) {
            return;
        }
        this._active = false;

        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }

        if (this._handler) {
            if (this._eventId) {
                this._handler.disconnect(this._eventId);
                this._eventId = 0;
            }
            if (this._device) {
                this._device.ungrab();
                this._device = null;
            }
            Main.popModal(this._handler);
            this._handler.destroy();
            this._handler = null;
        }

        if (this._outline) {
            this._outline.destroy();
            this._outline = null;
            this._outlineLabel = null;
        }
        if (this._options.showGuides) {
            this._options.showGuides([]);
        }

        forgetCursor();

        const changed = this._size.width !== this._start.width
            || this._size.height !== this._start.height;
        if (commit && changed && this._options.onResized) {
            this._options.onResized(this._size.width, this._size.height, this._zone);
        }
    }
};

// --- Ablage ~/.config/avincelaunch/layout.json ---------------------------
// Eigene Datei, nicht config.json: config.js schreibt jene immer ganz.
// AP13a legt hier die vorherige Groesse je Fence ab; AP13c/d ergaenzen
// Verlauf und Profile. Unbekannte Felder bleiben beim Schreiben erhalten.

function getLayoutStorePath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), "avincelaunch", "layout.json"]);
}

// Pruefung Phase 2, A3 (P3): Eine unlesbare layout.json wird nicht mehr
// still ersetzt. Sie bleibt liegen, wird als layout.json.broken-<Zeit>
// gesichert und gemeldet; bis sie repariert oder entfernt ist, arbeitet die
// Ablage leer und nur lesend (saveLayoutStore schreibt nichts).
function _safeJson() {
    return imports.desklets["avincelaunch-desklet@avince"].lib.safeJson;
}

function loadLayoutStore() {
    const SafeJson = _safeJson();
    const path = getLayoutStorePath();
    const info = SafeJson.readJson(path);
    if (info.state === SafeJson.STATE_OK) {
        return info.data;
    }
    if (info.state === SafeJson.STATE_BROKEN) {
        SafeJson.secureBroken(path, info);
    }
    return { version: 1 };
}

function saveLayoutStore(data) {
    try {
        const path = getLayoutStorePath();
        if (!_safeJson().mayWrite(path)) {
            return false;
        }
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        data.version = data.version || 1;
        GLib.file_set_contents(path, JSON.stringify(data, null, 2) + "\n");
        return true;
    } catch (e) {
        global.logError(e, "aVinceLaunch: layout.json konnte nicht geschrieben werden");
        return false;
    }
}

function getPreviousSize(instanceId) {
    const store = loadLayoutStore();
    const sizes = store.previousSize || {};
    return sizes[String(instanceId)] || null;
}

function setPreviousSize(instanceId, size) {
    const store = loadLayoutStore();
    store.previousSize = store.previousSize || {};
    store.previousSize[String(instanceId)] = size;
    return saveLayoutStore(store);
}

function getOriginalSize(instanceId) {
    const store = loadLayoutStore();
    const sizes = store.originalSize || {};
    return sizes[String(instanceId)] || null;
}

// AP18-5: Wird ein Fence entfernt (Cinnamon loescht dann auch seine
// <ID>.json), vergisst er seine Groessen - sonst sammeln sich bei jedem
// Duplizieren und Entfernen Reste an. Der Verlauf bleibt; fehlende Fences
// uebergeht applyArrangement.
function forgetFenceLayout(instanceId) {
    const store = loadLayoutStore();
    const key = String(instanceId);
    let changed = false;
    ["previousSize", "originalSize"].forEach(section => {
        if (store[section] && key in store[section]) {
            delete store[section][key];
            changed = true;
        }
    });
    return changed ? saveLayoutStore(store) : false;
}

// Pruefung Phase 2, P48: Groessen von Fences, die es nicht mehr gibt (vor
// AP18-5 entfernt, z. B. 42), einmal je Cinnamon-Start vergessen. Massgeblich
// ist enabled-desklets, nicht das Fence-Verzeichnis (beim Start sind noch
// nicht alle Fences geladen). Der Verlauf bleibt; applyArrangement
// uebergeht fehlende Fences ohnehin.
let _orphansPruned = false;

function pruneOrphanFenceLayouts(uuid) {
    if (_orphansPruned) {
        return [];
    }
    _orphansPruned = true;
    const alive = new Set();
    try {
        global.settings.get_strv("enabled-desklets").forEach(entry => {
            const parts = entry.split(":");
            if (parts[0] === uuid && parts[1]) {
                alive.add(parts[1]);
            }
        });
    } catch (e) {
        return [];
    }
    if (alive.size === 0) {
        return [];
    }
    const store = loadLayoutStore();
    const removed = new Set();
    ["previousSize", "originalSize"].forEach(section => {
        Object.keys(store[section] || {}).forEach(key => {
            if (!alive.has(key)) {
                delete store[section][key];
                removed.add(key);
            }
        });
    });
    if (removed.size === 0) {
        return [];
    }
    if (saveLayoutStore(store)) {
        global.log("aVinceLaunch: Groessen entfernter Fences vergessen: "
            + Array.from(removed).sort().join(", "));
        return Array.from(removed);
    }
    return [];
}

// Wird nur beim allerersten Groesseaendern geschrieben, nie ueberschrieben.
function rememberOriginalSize(instanceId, size) {
    const store = loadLayoutStore();
    store.originalSize = store.originalSize || {};
    const key = String(instanceId);
    if (store.originalSize[key]) {
        return false;
    }
    store.originalSize[key] = size;
    return saveLayoutStore(store);
}

// Einstellungen der Layout Engine. Bis zur Seite "Globale Einstellungen"
// nur in layout.json ("settings") aenderbar. Fehlende Werte ergaenzt
// snapEngine.js mit seinen Standardwerten.
function getLayoutSettings() {
    const store = loadLayoutStore();
    return Object.assign({}, store.settings || {});
}

// --- Fence-Verzeichnis -----------------------------------------------------
// Die Bibliothek ist fuer alle Instanzen dieselbe (imports.desklets[UUID]).
// Jeder Fence meldet sich hier an; so sieht jeder seine Nachbarn.

const _fences = new Map();

// handlers: { getRect, closeMenu, pressHandler, cursorHandler,
//             getState, applyState, moveFrameTo }
function registerFence(instanceId, handlers) {
    _fences.set(String(instanceId), handlers);
}

// Zeiger zu einer Mausbewegung, die gerade kein Fence selbst sieht (ein
// Menue haelt die Maus fest): der Fence unter der Maus entscheidet.
function updateCursorFromEvent(event) {
    for (const entry of _fences.values()) {
        try {
            const name = entry.cursorHandler ? entry.cursorHandler(event) : undefined;
            if (name !== undefined) {
                applyCursor(name);
                return;
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    applyCursor(null);
}

// Ein Klick, der ein offenes Menue schliesst, soll gleich wirken: an der
// Titelzeile oder einem Rand eines Fence beginnt damit das Verschieben bzw.
// Groesseaendern. Liefert true, wenn ein Fence den Klick uebernommen hat.
function startDragFromPress(event) {
    for (const entry of _fences.values()) {
        try {
            if (entry.pressHandler && entry.pressHandler(event)) {
                return true;
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    return false;
}

// Offene Kontextmenue aller Fences schliessen, z. B. wenn einer verschoben
// wird - sonst bleibt ein Menue mitten auf dem Schreibtisch stehen.
function closeAllFenceMenus() {
    for (const entry of _fences.values()) {
        try {
            if (entry.closeMenu) {
                entry.closeMenu();
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
}

// AP12-1: Titelzeile bei allen Fences auf einmal ein- oder ausschalten.
// Danach ist jeder Fence wieder selbststaendig (Schluessel show-title).
function setShowTitleForAllFences(state) {
    for (const entry of _fences.values()) {
        try {
            if (entry.setShowTitle) {
                entry.setShowTitle(state);
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
}

// AP12-3: Suche ueber alle Fences (Angelo 05.10.). Jeder Fence filtert
// seine schon eingelesene Liste selbst.
function setSearchTextForAllFences(text) {
    for (const entry of _fences.values()) {
        try {
            if (entry.setSearchText) {
                entry.setSearchText(text);
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
}

// Erster Treffer Reihe fuer Reihe (oben vor unten, links vor rechts).
function findFirstSearchHit() {
    let best = null;
    for (const entry of _fences.values()) {
        try {
            const item = entry.getFirstSearchHit ? entry.getFirstSearchHit() : null;
            const rect = item ? entry.getRect() : null;
            if (!item || !rect) {
                continue;
            }
            if (!best || rect.y < best.rect.y - 5
                || (Math.abs(rect.y - best.rect.y) <= 5 && rect.x < best.rect.x)) {
                best = { entry: entry, item: item, rect: rect };
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    return best;
}

function closeSearchInAllFences() {
    for (const entry of _fences.values()) {
        try {
            if (entry.closeSearch) {
                entry.closeSearch();
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
}

function isInsideAnyFence(actor) {
    for (const entry of _fences.values()) {
        try {
            if (entry.containsActor && entry.containsActor(actor)) {
                return true;
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    return false;
}

// Nur den eigenen Eintrag loeschen: Baut Cinnamon einen Fence neu auf,
// meldet sich der neue an, BEVOR der alte abgebaut ist - der alte loeschte
// sonst den Eintrag seines Nachfolgers (Befund 04.10.2026: "Urspruengliche
// Anordnung" fand 4, 40, 41 nicht mehr).
function unregisterFence(instanceId, handlers) {
    const key = String(instanceId);
    if (handlers && _fences.get(key) !== handlers) {
        return;
    }
    _fences.delete(key);
}

// AP18-1: Ziele fuer "Verschieben nach" - alle anderen Gruppen-Fences
// (Portale melden kein Ziel), Reihe fuer Reihe wie die Suche.
// Eintrag: { instanceId, title, path, rect }
function getMoveTargets(instanceId) {
    const own = String(instanceId);
    const targets = [];
    for (const [id, entry] of _fences) {
        if (id === own || !entry.getMoveTarget) {
            continue;
        }
        try {
            const target = entry.getMoveTarget();
            if (target && target.path) {
                target.instanceId = id;
                targets.push(target);
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    targets.sort((a, b) => {
        const ay = a.rect ? a.rect.y : 0;
        const by = b.rect ? b.rect.y : 0;
        if (Math.abs(ay - by) > 5) {
            return ay - by;
        }
        return (a.rect ? a.rect.x : 0) - (b.rect ? b.rect.x : 0);
    });
    return targets;
}

// AP18-1: Fences, die einen der Ordner zeigen, lesen ihn neu ein und
// gleichen die Liste im Dialog ab.
function notifyItemsChangedIn(paths) {
    for (const entry of _fences.values()) {
        try {
            if (entry.showsAnyPath && entry.itemsChanged && entry.showsAnyPath(paths)) {
                entry.itemsChanged();
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
}

function getOtherFenceRects(instanceId) {
    const own = String(instanceId);
    const rects = [];
    for (const [id, entry] of _fences) {
        if (id === own) {
            continue;
        }
        try {
            const rect = entry.getRect();
            if (rect && rect.w > 0 && rect.h > 0) {
                rects.push(rect);
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    return rects;
}

// Arbeitsflaeche des Bildschirms, in dem die Mitte des Rechtecks liegt.
function getWorkAreaForRect(rect) {
    try {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const monitors = Main.layoutManager.monitors;
        let index = Main.layoutManager.primaryIndex;
        for (let i = 0; i < monitors.length; i++) {
            const m = monitors[i];
            if (cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height) {
                index = i;
                break;
            }
        }
        const manager = global.workspace_manager;
        if (!manager) {
            return null;
        }
        const area = manager.get_active_workspace().get_work_area_for_monitor(index);
        return { x: area.x, y: area.y, w: area.width, h: area.height };
    } catch (e) {
        return null;
    }
}

// --- Hilfslinien -----------------------------------------------------------

var GuideOverlay = class GuideOverlay {
    constructor() {
        this._lines = [];
    }

    show(guides) {
        const list = guides || [];
        while (this._lines.length < list.length) {
            const line = new St.Widget({ style_class: "avincelaunch-guide", reactive: false });
            Main.uiGroup.add_actor(line);
            this._lines.push(line);
        }
        this._lines.forEach((line, i) => {
            const g = list[i];
            if (!g) {
                line.hide();
                return;
            }
            line.set_position(g.x1, g.y1);
            line.set_size(Math.max(1, g.x2 - g.x1), Math.max(1, g.y2 - g.y1));
            line.show();
            Main.uiGroup.set_child_above_sibling(line, null);
        });
    }

    destroy() {
        this._lines.forEach(line => line.destroy());
        this._lines = [];
    }
};

// --- Verlauf der Anordnungen (AP13c) ---------------------------------------
// Eine Anordnung: Position und Groesse aller Fences, mit Zeitpunkt. Vor jeder
// abgeschlossenen Aenderung wird die bisherige abgelegt; drei Eintraege.
// Mehrere Aenderungen innerhalb von 60 s gelten als ein Umbau - sonst waeren
// die drei Eintraege nach drei kleinen Zuegen verbraucht. Ausdrueckliche
// Befehle (Ausrichten, Zuruecksetzen) legen immer einen eigenen Eintrag an.

var HISTORY_SIZE = 3;
const HISTORY_MERGE_MS = 60000;

function captureArrangement() {
    const fences = {};
    for (const [id, entry] of _fences) {
        try {
            const state = entry.getState ? entry.getState() : null;
            if (state) {
                fences[id] = state;
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    return { time: Date.now(), fences: fences };
}

function getHistory() {
    const store = loadLayoutStore();
    return Array.isArray(store.history) ? store.history : [];
}

// Art der Aenderung, die nach dem abgelegten Stand kam - fuer die Anzeige
// im Menue (Uhrzeit und Symbol, Wunsch 02.10.):
//   move, width, height, size (Ecke), size-restore, align, restore
// explicit = true: nie mit dem vorigen Eintrag zusammenfassen.
function pushHistory(arrangement, explicit, kind) {
    if (!arrangement || Object.keys(arrangement.fences || {}).length === 0) {
        return false;
    }
    const store = loadLayoutStore();
    const history = Array.isArray(store.history) ? store.history : [];
    const newest = history[0];
    if (!explicit && newest && !newest.explicit
        && arrangement.time - newest.recorded < HISTORY_MERGE_MS) {
        // Gleicher Umbau: der Stand vor dessen erstem Zug bleibt stehen;
        // die Art der weiteren Zuege kommt dazu.
        newest.recorded = arrangement.time;
        newest.kinds = newest.kinds || [];
        if (kind && newest.kinds.indexOf(kind) === -1) {
            newest.kinds.push(kind);
        }
        store.history = history;
        return saveLayoutStore(store);
    }
    history.unshift({
        time: arrangement.time,
        recorded: arrangement.time,
        explicit: !!explicit,
        kinds: kind ? [kind] : [],
        fences: arrangement.fences
    });
    store.history = history.slice(0, HISTORY_SIZE);
    return saveLayoutStore(store);
}

// Anordnung anwenden. Fehlende Fences werden uebersprungen, es wird nichts
// angelegt oder entfernt. Liefert die Zahl der uebersprungenen.
function applyArrangement(arrangement) {
    let skipped = 0;
    for (const id of Object.keys(arrangement.fences || {})) {
        const entry = _fences.get(id);
        if (!entry || !entry.applyState) {
            skipped += 1;
            continue;
        }
        try {
            entry.applyState(arrangement.fences[id]);
        } catch (e) {
            global.logError(e, "aVinceLaunch: Anordnung fuer Fence " + id);
            skipped += 1;
        }
    }
    return skipped;
}

// Den gespeicherten Stand zurueckholen; der Stand davor kommt in den
// Verlauf, das Zuruecksetzen ist also selbst wieder umkehrbar.
function restoreArrangement(index) {
    const history = getHistory();
    const target = history[index];
    if (!target) {
        return -1;
    }
    pushHistory(captureArrangement(), true, "restore");
    return applyArrangement(target);
}

// --- Alle Fences ausrichten (AP13c, Idee 3) --------------------------------

function alignFencesOnMonitorOf(rect, alignFences, settings, obstacles) {
    const area = getWorkAreaForRect(rect);
    const onMonitor = [];
    for (const [id, entry] of _fences) {
        try {
            const r = entry.getRect();
            if (!r) {
                continue;
            }
            const sameArea = getWorkAreaForRect(r);
            if (area && sameArea && sameArea.x === area.x && sameArea.y === area.y) {
                onMonitor.push({ id: id, x: r.x, y: r.y, w: r.w, h: r.h });
            }
        } catch (e) {
            // Fence wird gerade abgebaut.
        }
    }
    const targets = alignFences(onMonitor, area, settings, obstacles || []);
    const moves = onMonitor.filter(f => targets[f.id]
        && (targets[f.id].x !== f.x || targets[f.id].y !== f.y));
    if (moves.length === 0) {
        return 0;
    }
    pushHistory(captureArrangement(), true, "align");
    for (const f of moves) {
        _fences.get(f.id).moveFrameTo(targets[f.id].x, targets[f.id].y);
    }
    return moves.length;
}

// --- Ursprungsanordnung (AP13c) -------------------------------------------
// Ein fester Eintrag, der nie aus dem Verlauf faellt: die Anordnung beim
// ersten Start mit dieser Fassung. Der Verlauf hat nur drei Plaetze - beim
// Testen am 02.10. war der Ausgangsstand zweimal schnell verdraengt.

function getOriginalArrangement() {
    const store = loadLayoutStore();
    return store.originalArrangement || null;
}

function restoreOriginalArrangement() {
    const original = getOriginalArrangement();
    if (!original) {
        return -1;
    }
    pushHistory(captureArrangement(), true, "restore");
    return applyArrangement(original);
}

// --- Abstaende einmalig lernen (AP13c) -------------------------------------
// Beim ersten Start mit dieser Fassung: haeufigster Abstand je Richtung aus
// der dann vorhandenen Anordnung, abgelegt in layout.json settings.gapX/gapY.
// Danach nur noch, wenn jemand sie dort entfernt. Ausrichten nutzt diese
// Werte statt der gerade gemessenen.
let _gapLearnId = 0;

function scheduleGapLearning(measureGaps) {
    const store = loadLayoutStore();
    const settings = store.settings || {};
    const haveGaps = typeof settings.gapX === "number" && typeof settings.gapY === "number";
    if (haveGaps && store.originalArrangement) {
        return;
    }
    if (_gapLearnId) {
        return;
    }
    // Warten, bis alle Fences geladen und angeordnet sind.
    _gapLearnId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
        _gapLearnId = 0;
        const fences = [];
        for (const [id, entry] of _fences) {
            try {
                const r = entry.getRect();
                if (r) {
                    fences.push({ id: id, x: r.x, y: r.y, w: r.w, h: r.h });
                }
            } catch (e) {
                // Fence wird gerade abgebaut.
            }
        }
        const fresh = loadLayoutStore();
        const freshSettings = fresh.settings || {};
        if (fences.length >= 2
            && !(typeof freshSettings.gapX === "number" && typeof freshSettings.gapY === "number")) {
            const gaps = measureGaps(fences, freshSettings);
            fresh.settings = Object.assign({}, freshSettings, {
                gapX: gaps.gapX,
                gapY: gaps.gapY,
                gapsLearnedAt: new Date().toISOString()
            });
        }
        if (!fresh.originalArrangement) {
            const arrangement = captureArrangement();
            if (Object.keys(arrangement.fences).length > 0) {
                fresh.originalArrangement = arrangement;
            }
        }
        saveLayoutStore(fresh);
        return GLib.SOURCE_REMOVE;
    });
}

// --- Schnellstart einmal bei Neuinstallation (AP09d) -----------------------
// Neuinstallation = es gibt noch keine layout.json (sie entsteht wenige
// Sekunden nach dem ersten Fence, siehe scheduleGapLearning). Das Ergebnis
// steht sofort in layout.json "quickstart" - so erscheint der Schnellstart
// hoechstens einmal, auch wenn mehrere Fences gleichzeitig starten.
let _quickstartChecked = false;

function scheduleQuickstartOnce(openQuickstart) {
    if (_quickstartChecked) {
        return;
    }
    _quickstartChecked = true;

    const fresh = !GLib.file_test(getLayoutStorePath(), GLib.FileTest.EXISTS);
    const store = loadLayoutStore();
    if (store.quickstart) {
        return;
    }
    store.quickstart = { shown: fresh, at: new Date().toISOString() };
    if (!saveLayoutStore(store) || !fresh) {
        return;
    }
    // Erst wenn der Schreibtisch steht.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        try {
            openQuickstart();
        } catch (e) {
            global.logError(e, "aVinceLaunch: Schnellstart konnte nicht geoeffnet werden");
        }
        return GLib.SOURCE_REMOVE;
    });
}

// --- Fremde Desklets (Wunsch 02.10.) ---------------------------------------
// Andere Desklets auf dem Schreibtisch, z. B. aVincePulse: Hindernisse fuer
// Einrasten, Ueberlappungsschutz und Ausrichten. Sie werden nie bewegt.
// Cinnamon haelt alle Desklets in global.desklet_container; jedes kennt
// seine UUID (deskletManager.js:342).
function getForeignDeskletRects(ownUuid) {
    const rects = [];
    try {
        const container = global.desklet_container;
        for (const child of container.get_children()) {
            const desklet = child._delegate;
            if (!desklet || !desklet._uuid || desklet._uuid === ownUuid || !child.visible) {
                continue;
            }
            const [x, y] = child.get_transformed_position();
            const w = Math.round(child.get_width());
            const h = Math.round(child.get_height());
            if (w > 0 && h > 0) {
                rects.push({ x: Math.round(x), y: Math.round(y), w: w, h: h });
            }
        }
    } catch (e) {
        // Andere Cinnamon-Fassung: ohne fremde Desklets weiter.
    }
    return rects;
}
