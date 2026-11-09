// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

const GLib = imports.gi.GLib;

// AP10b-1 - Quelle eines Fence: Gruppenordner oder Portal.
//
// Ein Portal ist eine reine Ansicht auf einen echten Ordner. aVinceLaunch
// darf darin nichts anlegen, aendern, verschieben oder loeschen - auch keine
// Sidecar-Datei. Jeder Portal-Fence meldet seinen Ordner hier an; die
// Schreibstellen (sidecar.js writeSidecar) fragen isReadOnlyPath() und
// verweigern. Die Bibliothek ist fuer alle Instanzen dieselbe, das
// Verzeichnis gilt also fuer alle Fences gemeinsam.

var SOURCE_GROUP = "group";
var SOURCE_PORTAL = "portal";

// Hoechstens so viele Eintraege zeigt ein Portal (Entscheidung 03.10.).
var PORTAL_LIMIT = 200;

const _readOnlyRoots = new Map();
let _refusedLogged = {};
let _refusedReporter = null;
let _baseDirectoryForTests = null;
let _tablesForTests = null;

function normalizeSourceMode(value) {
    return value === SOURCE_PORTAL ? SOURCE_PORTAL : SOURCE_GROUP;
}

// Absoluter Pfad ohne abschliessenden Schraegstrich, "." und "..".
// Symbolische Verweise werden bewusst NICHT aufgeloest: Navigation und
// Schreibstellen arbeiten mit denselben, unaufgeloesten Pfaden.
function normalizePath(path) {
    const text = String(path || "").trim();
    if (!text || text.charAt(0) !== "/") {
        return "";
    }
    let canonical = GLib.canonicalize_filename(text, null);
    while (canonical.length > 1 && canonical.endsWith("/")) {
        canonical = canonical.substring(0, canonical.length - 1);
    }
    return canonical;
}

// Pruefung Phase 2, P16: Eintraege tragen ihren Besitzer (das Desklet-Objekt).
// Baut Cinnamon einen Fence neu auf, meldet sich der neue an, bevor der alte
// nach dem Ausblenden abraeumt - der alte darf dann den Schutz des neuen
// nicht mehr loeschen (wie unregisterFence in layoutManager.js).
function registerReadOnlyRoot(instanceId, path, owner) {
    const root = normalizePath(path);
    if (root) {
        _readOnlyRoots.set(String(instanceId), { root: root, owner: owner || null });
    } else {
        unregisterReadOnlyRoot(instanceId, owner);
    }
}

function unregisterReadOnlyRoot(instanceId, owner) {
    const key = String(instanceId);
    const entry = _readOnlyRoots.get(key);
    if (entry && owner && entry.owner && entry.owner !== owner) {
        return;
    }
    _readOnlyRoots.delete(key);
}

// Pruefung Phase 2, P10: Der Basisordner (config.json, Regel wie
// lib/config.js) gehoert aVinceLaunch. Was darin liegt - die Gruppenordner
// mit ihren Sidecar-Dateien -, ist nie gesperrt, auch wenn ein Portal ihn mit
// anzeigt (z. B. ein Portal auf "~"). Ein Portal-Fence selbst schreibt
// ohnehin nie (_isPortal() in desklet.js); gesperrt bleibt also nur, was
// ausserhalb des Basisordners in einem Portal liegt.
function getBaseDirectory() {
    if (_baseDirectoryForTests !== null) {
        return normalizePath(_baseDirectoryForTests);
    }
    try {
        return normalizePath(imports.desklets["avincelaunch-desklet@avince"].lib.config
            .getBaseDirectory());
    } catch (e) {
        return "";
    }
}

function isInsidePath(target, root) {
    return !!target && !!root
        && (target === root || root === "/" || target.indexOf(root + "/") === 0);
}

function isInBaseDirectory(path) {
    return isInsidePath(normalizePath(path), getBaseDirectory());
}

// true, wenn path ein Portalordner oder ein Ordner darin ist - ausser im
// Basisordner (P10).
function isReadOnlyPath(path) {
    const target = normalizePath(path);
    if (!target) {
        return false;
    }
    if (_readOnlyRoots.size === 0 || isInBaseDirectory(target)) {
        return false;
    }
    for (const { root } of _readOnlyRoots.values()) {
        if (target === root || root === "/" || target.indexOf(root + "/") === 0) {
            return true;
        }
    }
    return false;
}

// Meldung an den Nutzer (setzt desklet.js mit uebersetztem Text), P10:
// frueher stand eine Ablehnung nur im Protokoll. reporter(path)
function setRefusedReporter(reporter) {
    _refusedReporter = reporter;
}

// Einmal je Ordner ins Protokoll und auf den Schreibtisch - nicht im
// Sekundentakt.
function logRefusedWrite(path, what) {
    const key = String(what) + ":" + String(path);
    if (_refusedLogged[key]) {
        return;
    }
    _refusedLogged[key] = true;
    const text = "aVinceLaunch: " + what + " im Portal verweigert (nur Ansicht): " + path;
    if (typeof global !== "undefined" && global.log) {
        global.log(text);
    } else {
        printerr(text);
    }
    if (_refusedReporter) {
        try {
            _refusedReporter(path);
        } catch (e) {
            // Meldung ist Zugabe - der Schreibschutz gilt trotzdem.
        }
    }
}

// --- Netzlaufwerk erkennen (AP10b-2) --------------------------------------
// Nur aus der Einhaengetabelle des Systems (/proc/self/mountinfo) - die NAS
// selbst wird dabei NICHT angefasst. Jede Pruefung direkt auf dem Pfad
// koennte haengen, wenn die NAS nicht erreichbar ist (CIFS, autofs).
// autofs zaehlt mit: nach dem Zeitablauf (timeout=600) ist die NAS
// ausgehaengt und nur der autofs-Eintrag steht noch da.
// Pruefung Phase 2, P26: zusaetzlich /etc/fstab (lokale Datei). Eine dort
// eingetragene, aber (noch) nicht eingehaengte Freigabe ohne autofs galt als
// lokal: leerer Einhaengepunkt bzw. "nicht erreichbar" ohne neuen Versuch.
const NETWORK_FS = ["cifs", "smb3", "smbfs", "nfs", "nfs4", "autofs",
    "fuse.sshfs", "sshfs", "fuse.rclone", "davfs", "fuse.gvfsd-fuse"];

const MOUNTINFO_FILE = "/proc/self/mountinfo";
const FSTAB_FILE = "/etc/fstab";

function _unescapeMount(text) {
    return text.replace(/\\([0-7]{3})/g, (m, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function _readTable(path) {
    if (_tablesForTests) {
        return _tablesForTests[path] || "";
    }
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : "";
    } catch (e) {
        return "";
    }
}

// Einhaengepunkte von Netzlaufwerken: [Pfad, ...]
function _networkMountPoints() {
    const points = [];
    for (const line of _readTable(MOUNTINFO_FILE).split("\n")) {
        const parts = line.split(" - ");
        if (parts.length < 2) {
            continue;
        }
        const mountPoint = _unescapeMount(parts[0].split(" ")[4] || "");
        const fsType = (parts[1].split(" ")[0] || "").toLowerCase();
        if (mountPoint && NETWORK_FS.indexOf(fsType) !== -1) {
            points.push(mountPoint);
        }
    }
    for (const line of _readTable(FSTAB_FILE).split("\n")) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 3 || fields[0].charAt(0) === "#") {
            continue;
        }
        const mountPoint = _unescapeMount(fields[1]);
        const fsType = fields[2].toLowerCase();
        const sshfsSpec = fsType === "fuse" && fields[0].indexOf("sshfs#") === 0;
        if (mountPoint.charAt(0) === "/"
            && (NETWORK_FS.indexOf(fsType) !== -1 || sshfsSpec)) {
            points.push(normalizePath(mountPoint));
        }
    }
    return points;
}

function isNetworkPath(path) {
    const target = normalizePath(path);
    if (!target) {
        return false;
    }
    for (const mountPoint of _networkMountPoints()) {
        if (isInsidePath(target, mountPoint)) {
            return true;
        }
    }
    return false;
}

// Nur fuer tests/portal-guard-test.js.
function _setForTests(baseDirectory, tables) {
    _baseDirectoryForTests = baseDirectory === undefined ? null : baseDirectory;
    _tablesForTests = tables || null;
    _refusedLogged = {};
}
