# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""Folder Portal (AP10b-1): Schutzschicht der Python-Seite.

Ein Portal ist eine reine Ansicht. Die Schreibstellen des Einrichten-Dialogs
(Sidecar, Starter anlegen/bearbeiten, Papierkorb, Kopieren) fragen hier, ob
ihr Ziel in einem Portalordner liegt, und verweigern dann.

Die Portalordner stehen in den Instanzdateien der Fences
(~/.config/cinnamon/spices/<UUID>/<ID>.json: source-mode = portal,
portal-path). Hier wird nur gelesen. Regeln wie lib/pathSource.js
(Pruefung Phase 2, A6):
  - P10: Der Basisordner (config.json) gehoert aVinceLaunch - was darin
    liegt, ist nie gesperrt, auch wenn ein Portal ihn mit anzeigt.
  - P28: Pfade werden NICHT aufgeloest (kein realpath - das griff auf die NAS
    zu und konnte den Dialog einfrieren); es zaehlen nur eingeschaltete
    Fences (enabled-desklets); eine unlesbare Instanzdatei eines solchen
    Fence heisst "unklar" -> ablehnen. Eine fehlende gilt als kein Portal
    (wie im Desklet: fehlende Datei = Vorgaben = Gruppe).
"""

import glob
import json
import os
import sys

UUID = "avincelaunch-desklet@avince"
APP_DIR_NAME = "avincelaunch"
LEGACY_DIR_NAME = "thelauncher"

# Wie NETWORK_FS in lib/pathSource.js.
NETWORK_FS = ("cifs", "smb3", "smbfs", "nfs", "nfs4", "autofs",
              "fuse.sshfs", "sshfs", "fuse.rclone", "davfs", "fuse.gvfsd-fuse")
MOUNTINFO_FILE = "/proc/self/mountinfo"
FSTAB_FILE = "/etc/fstab"

# Nur fuer Tests: {Pfad: Inhalt} statt der echten Tabellen, und eine Liste
# eingeschalteter Instanz-IDs statt der Abfrage bei Cinnamon.
_tables_for_tests = None
_enabled_for_tests = None


def _xdg_config_home():
    return os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")


def _xdg_data_home():
    return os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")


def _config_dir():
    return os.path.join(_xdg_config_home(), "cinnamon", "spices", UUID)


def _value(data, key):
    entry = data.get(key)
    if isinstance(entry, dict):
        return entry.get("value")
    return None


def normalize(path):
    """Absoluter Pfad ohne Aufloesen von Verweisen - wie pathSource.js."""
    text = (path or "").strip()
    if not text.startswith("/"):
        return ""
    return os.path.normpath(text)


def is_inside(target, root):
    return bool(target) and bool(root) and (
        target == root or root == "/" or target.startswith(root + os.sep))


def base_directory():
    """Basisordner nach der Regel von lib/config.js (nur lesen, nie sichern)."""
    default = os.path.join(_xdg_data_home(), APP_DIR_NAME)
    for name in (APP_DIR_NAME, LEGACY_DIR_NAME):
        path = os.path.join(_xdg_config_home(), name, "config.json")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            # Fehlt oder kaputt: wie loadConfig weiter zur naechsten Datei
            # (das Sichern einer kaputten Datei macht orderFolderEditor).
            continue
        if not isinstance(data, dict):
            continue
        return _normalize_base(data.get("baseDirectory")) or normalize(default)
    return normalize(default)


def _normalize_base(value):
    """Wie lib/config.js normalizeBaseDirectory: "~" erweitern, nur absolut."""
    text = value.strip() if isinstance(value, str) else ""
    if text == "~" or text.startswith("~/"):
        text = os.path.expanduser("~") + text[1:]
    return normalize(text)


def in_base_directory(path):
    return is_inside(normalize(path), base_directory())


def _enabled_instance_ids():
    """IDs der eingeschalteten Fences; None, wenn Cinnamon nicht fragbar ist."""
    if _enabled_for_tests is not None:
        return set(str(i) for i in _enabled_for_tests)
    try:
        from gi.repository import Gio
        entries = Gio.Settings.new("org.cinnamon").get_strv("enabled-desklets")
    except Exception:
        return None
    ids = set()
    for entry in entries:
        parts = entry.split(":")
        if len(parts) >= 2 and parts[0] == UUID:
            ids.add(parts[1])
    return ids


def _instance_files():
    files = glob.glob(os.path.join(_config_dir(), "*.json"))
    enabled = _enabled_instance_ids()
    if enabled is None:
        # Ohne Cinnamon (sollte im Dialog nicht vorkommen): alle Dateien,
        # wie frueher - lieber zu viel schuetzen als zu wenig.
        return files
    return [f for f in files
            if os.path.splitext(os.path.basename(f))[0] in enabled]


def portal_state():
    """(Portal-Wurzeln, unklar) - unklar = eine Instanzdatei ist unlesbar."""
    roots = set()
    unclear = False
    for file_name in _instance_files():
        try:
            with open(file_name, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            # Cinnamon ersetzt die Datei gerade (P74) o. ae.: kein Portal.
            continue
        except Exception:
            unclear = True
            continue
        if not isinstance(data, dict):
            unclear = True
            continue
        if _value(data, "source-mode") != "portal":
            continue
        root = normalize(_value(data, "portal-path") or "")
        if root:
            roots.add(root)
    return roots, unclear


def portal_roots():
    return portal_state()[0]


def is_portal_path(path):
    """True, wenn path ein Portalordner oder darin ist (ausser im Basisordner)
    oder die Lage wegen einer unlesbaren Instanzdatei unklar ist."""
    target = normalize(os.path.abspath(path) if path else "")
    if not target or in_base_directory(target):
        return False
    roots, unclear = portal_state()
    if unclear:
        return True
    return any(is_inside(target, root) for root in roots)


def refuse(path, what):
    """True (= verweigert), wenn path im Portal liegt; meldet es einmal."""
    if is_portal_path(path):
        print("aVinceLaunch: %s refused in a folder portal (view only): %s" % (what, path),
              file=sys.stderr)
        return True
    return False


def contains_base_directory(portal_path):
    """True, wenn ein Portal auf portal_path den Basisordner mit anzeigt (P27)."""
    return is_inside(base_directory(), normalize(portal_path))


# --- Netzlaufwerk erkennen (P26, P28) ---------------------------------------
# Wie lib/pathSource.js: nur aus /proc/self/mountinfo und /etc/fstab, der Pfad
# selbst wird nie angefasst.

def _read_table(path):
    if _tables_for_tests is not None:
        return _tables_for_tests.get(path, "")
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            return handle.read()
    except Exception:
        return ""


def _unescape(text):
    out, i = [], 0
    while i < len(text):
        chunk = text[i + 1:i + 4]
        if text[i] == "\\" and len(chunk) == 3 and all(c in "01234567" for c in chunk):
            out.append(chr(int(chunk, 8)))
            i += 4
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def network_mount_points():
    points = []
    for line in _read_table(MOUNTINFO_FILE).splitlines():
        left, sep, right = line.partition(" - ")
        if not sep:
            continue
        left_fields, right_fields = left.split(), right.split()
        if len(left_fields) >= 5 and right_fields and right_fields[0].lower() in NETWORK_FS:
            points.append(_unescape(left_fields[4]))
    for line in _read_table(FSTAB_FILE).splitlines():
        fields = line.split()
        if len(fields) < 3 or fields[0].startswith("#"):
            continue
        fs_type = fields[2].lower()
        sshfs_spec = fs_type == "fuse" and fields[0].startswith("sshfs#")
        mount_point = normalize(_unescape(fields[1]))
        if mount_point and (fs_type in NETWORK_FS or sshfs_spec):
            points.append(mount_point)
    return points


def is_network_path(path):
    target = normalize(path)
    return bool(target) and any(is_inside(target, point) for point in network_mount_points())
