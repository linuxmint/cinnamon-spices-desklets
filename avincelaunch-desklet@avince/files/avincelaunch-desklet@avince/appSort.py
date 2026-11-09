#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""N17 - Startaufstellung: installierte Programme einem von neun Fences zuordnen.

Ohne Fenster, damit es sich ohne Sitzung pruefen laesst
(tests/n17-sort-test.py). Der Dialog startaufstellung-dialog.py zeigt das
Ergebnis als Vorschlag; der Nutzer entscheidet.

Die Regeln des Zusatzpakets (avincelaunch_rules.py, rules.json fuer den
Waechter) bleiben davon unberuehrt.
"""

import errno
import os
import re
import tempfile

# Die neun Fences in der Reihenfolge des Rasters (zeilenweise). Titel
# englisch; uebersetzt wird im Dialog (gettext, Domaene des Desklets).
FENCES = [
    ("internet", "Internet"),
    ("communication", "Communication"),
    ("office", "Office"),
    ("graphics", "Graphics & Photos"),
    ("multimedia", "Multimedia"),
    ("games", "Games"),
    ("development", "Development"),
    ("tools", "Tools"),
    ("system", "System"),
]
FENCE_KEYS = [key for key, _title in FENCES]

# Programmregeln nach dem Namen des Programms (Exec, ohne Pfad) - vor den
# Kategorien, weil diese Programme oft nur "System" oder gar nichts melden.
EXEC_RULES = [
    ("system", {"virt-manager", "virtualbox", "vmware", "vmplayer", "gnome-boxes",
                "qemu-system-x86_64", "remmina"}),
]

# Kategorien (freedesktop "Categories="), erste passende Gruppe gewinnt.
# Die Reihenfolge loest Mehrfachangaben: "Development;TextEditor" ->
# Entwicklung, "Utility;TextEditor" -> Werkzeuge, "Office;Email" ->
# Kommunikation, "Utility;TerminalEmulator;System" -> System.
CATEGORY_RULES = [
    ("games", {"Game"}),
    ("development", {"Development", "IDE", "Debugger", "RevisionControl", "GUIDesigner",
                     "Profiling", "Translation", "WebDevelopment"}),
    ("graphics", {"Graphics", "2DGraphics", "3DGraphics", "RasterGraphics", "VectorGraphics",
                  "Photography", "Scanning", "OCR", "ImageProcessing"}),
    ("multimedia", {"AudioVideo", "Audio", "Video", "Player", "Recorder", "DiscBurning",
                    "Music", "Midi", "Mixer", "Sequencer", "Tuner", "TV", "AudioVideoEditing"}),
    ("communication", {"Email", "Chat", "InstantMessaging", "IRCClient", "Telephony",
                       "VideoConference"}),
    # WebApps: Mints Webapp-Verwaltung (Chat-Webapps melden oft nur das).
    ("internet", {"WebBrowser", "Network", "FileTransfer", "P2P", "RemoteAccess", "Dialup",
                  "Feed", "News", "WebApps"}),
    ("office", {"Office", "WordProcessor", "Spreadsheet", "Presentation", "Calendar",
                "ContactManagement", "Finance", "Database", "Dictionary",
                "Publishing", "Chart", "ProjectManagement", "FlowChart"}),
    ("system", {"System", "Settings", "TerminalEmulator", "FileManager", "Monitor", "Security",
                "PackageManager", "Emulator", "Filesystem", "HardwareSettings", "Printing",
                "DesktopSettings"}),
    ("tools", {"Utility", "Accessibility", "TextEditor", "Archiving", "Compression",
               "Calculator", "Clock", "Education", "Science", "Math", "Maths"}),
]
FALLBACK = "tools"

# Fuer Vergleiche ohne Gross/klein.
_CATEGORY_RULES_LOWER = [(key, {c.lower() for c in cats}) for key, cats in CATEGORY_RULES]

OWN_UUID = "avincelaunch-desklet@avince"
_CINNAMON_PANEL = re.compile(r"^cinnamon-.*-panel\.desktop$")


def exec_name(exec_line):
    """Erstes Wort von Exec= ohne Pfad und ohne env/flatpak-Vorspann."""
    words = [w for w in str(exec_line or "").split() if w]
    while words and (words[0] == "env" or "=" in words[0]):
        words.pop(0)
    if len(words) >= 3 and os.path.basename(words[0]) == "flatpak" and words[1] == "run":
        rest = [w for w in words[2:] if not w.startswith("-")]
        return rest[0].lower() if rest else ""
    return os.path.basename(words[0]).lower() if words else ""


def fence_for(categories, exec_line=""):
    """Schluessel des Fence fuer eine Kategorienliste ("A;B;" oder Liste)."""
    if isinstance(categories, str):
        categories = categories.split(";")
    cats = {c.strip().lower() for c in categories or [] if c and c.strip()}
    name = exec_name(exec_line)
    for key, names in EXEC_RULES:
        if name in names or name.split(".")[-1] in names:
            return key
    for key, wanted in _CATEGORY_RULES_LOWER:
        if cats & wanted:
            return key
    return FALLBACK


def is_settings_page(app_id, keys=()):
    """Cinnamons Einstellungsseiten (Systemeinstellungen -> ...)."""
    name = os.path.basename(str(app_id or ""))
    return (name.startswith("cinnamon-settings")
            or bool(_CINNAMON_PANEL.match(name))
            or "X-Cinnamon-Settings-Panel" in keys)


def collect(app_infos=None):
    """Sichtbare Programme als Liste von dicts, nach Name sortiert.

    app_infos: Liste von Gio.DesktopAppInfo (Tests); sonst alle der Sitzung.
    Felder: id, name, path, icon (Gio.Icon oder None), fence, settings_page.
    """
    if app_infos is None:
        import gi
        gi.require_version("Gio", "2.0")
        from gi.repository import Gio
        app_infos = Gio.AppInfo.get_all()
    apps = []
    seen = set()
    for info in app_infos:
        try:
            if not info.should_show():
                continue
            path = info.get_filename() if hasattr(info, "get_filename") else None
            app_id = info.get_id() or (os.path.basename(path) if path else "")
        except Exception:
            continue
        if not path or not app_id or app_id in seen or OWN_UUID in app_id:
            continue
        seen.add(app_id)
        try:
            keys = info.get_keys() if hasattr(info, "get_keys") else []
        except Exception:
            keys = []
        apps.append({
            "id": app_id,
            "name": info.get_display_name() or info.get_name() or app_id,
            "path": path,
            "icon": info.get_icon(),
            "fence": fence_for(info.get_categories() or "", info.get_commandline() or ""),
            "settings_page": is_settings_page(app_id, keys or []),
        })
    apps.sort(key=lambda a: a["name"].lower())
    return apps


# --- Ordner und Verknuepfungen --------------------------------------------

_UMLAUTE = {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"}


def folder_name(title):
    """Ordnername aus einem (uebersetzten) Titel: nur ASCII, ohne Leerzeichen.
    "Grafik & Fotos" -> "Grafik_Fotos", "Büro" -> "Buero"."""
    title = str(title or "")
    # Titel ganz in Grossbuchstaben (Angelo 13.10.): BÜRO -> BUERO, nicht BUeRO.
    caps = title == title.upper()
    text = "".join((_UMLAUTE.get(ch, ch).upper() if caps else _UMLAUTE.get(ch, ch)) for ch in title)
    text = re.sub(r"[^A-Za-z0-9_-]+", "_", text).strip("_")
    text = re.sub(r"_+", "_", text)
    return text or "Fence"


def unique_folder(base, name, taken=()):
    """name, sonst name_2, name_3 ... - frei im Basisordner und nicht in taken."""
    taken = set(taken)
    if name not in taken and not os.path.lexists(os.path.join(base, name)):
        return name
    for n in range(2, 1000):
        candidate = "%s_%d" % (name, n)
        if candidate not in taken and not os.path.lexists(os.path.join(base, candidate)):
            return candidate
    return None


# Wie avincelaunch_rules.create_new_file: nie halbe Dateien, nie ueberschreiben.
_NO_HARDLINK = {errno.EPERM, errno.EOPNOTSUPP, errno.ENOTSUP, errno.EXDEV,
                errno.EMLINK, errno.ENOSYS, errno.EACCES}


def _write_exclusive(target, data, mode):
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            os.unlink(target)
        except OSError:
            pass
        raise


def copy_link(source, target_dir):
    """Kopiert eine .desktop-Datei (Verweise aufgeloest) als NEUE Datei nach
    target_dir, ausfuehrbar. Liefert "angelegt", "vorhanden" oder einen
    Fehlertext."""
    target = os.path.join(target_dir, os.path.basename(source))
    try:
        data = open(os.path.realpath(source), "rb").read()
        if os.path.lexists(target):
            return "vorhanden"
        fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(target) + ".", suffix=".tmp",
                                   dir=target_dir)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(tmp, 0o755)
            try:
                os.link(tmp, target)
            except FileExistsError:
                return "vorhanden"
            except OSError as error:
                if error.errno not in _NO_HARDLINK:
                    raise
                try:
                    _write_exclusive(target, data, 0o755)
                except FileExistsError:
                    return "vorhanden"
            return "angelegt"
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except OSError as error:
        return str(error)


# --- Anlegen (vom Dialog aufgerufen) ----------------------------------------

ORDER_VERSION = 1


def create_layout(base, default_base, fences, order_path):
    """Legt Gruppenordner und Verknuepfungen an und schreibt den Auftrag fuer
    das Desklet (order_path), das danach die Fences anlegt.

    fences: Liste von {"key", "title", "apps": [Pfade der .desktop-Dateien]}
            in der Reihenfolge des Rasters.
    Ergebnis: (Auftrag oder None, Liste von Fehlertexten).

    Regel wie N13 (lib/config.js ensureOwnLinkDirectory): Fehlt der
    Basisordner, wird er nur angelegt, wenn es der Standard ist - ein
    eigener (z. B. auf einer NAS) nie.
    """
    base = os.path.normpath(base)
    if not os.path.isdir(base):
        if os.path.normpath(default_base) != base:
            return None, ["base-missing:" + base]
        os.makedirs(base, exist_ok=True)
    errors = []
    taken = set()
    entries = []
    for fence in fences:
        name = unique_folder(base, folder_name(fence["title"]), taken)
        if not name:
            errors.append("no-folder:" + fence["title"])
            continue
        taken.add(name)
        target = os.path.join(base, name)
        os.mkdir(target, 0o755)
        made = 0
        for source in fence.get("apps", []):
            result = copy_link(source, target)
            if result == "angelegt":
                made += 1
            elif result != "vorhanden":
                errors.append("link:%s:%s" % (os.path.basename(source), result))
        entries.append({"key": fence["key"], "title": fence["title"], "folder": name,
                        "path": target, "links": made})
    import datetime
    import json
    order = {"version": ORDER_VERSION,
             "created": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
             "base": base, "fences": entries}
    os.makedirs(os.path.dirname(order_path), exist_ok=True)
    tmp = order_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(order, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(tmp, order_path)
    return order, errors
