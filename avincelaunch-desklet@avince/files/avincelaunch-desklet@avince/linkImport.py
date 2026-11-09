# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

import errno
import os
import re
import stat
import sys
import tempfile

from gi.repository import GLib

# Uebersetzung (AP09c): eigene Domaene = UUID, Kataloge unter
# ~/.local/share/locale - dorthin legt sie Cinnamon bzw.
# "cinnamon-xlet-makepot -i". Fehlt eine Uebersetzung, bleibt es Englisch.
import gettext as _gettext
import os as _os

_DOMAIN = "avincelaunch-desklet@avince"
_gettext.bindtextdomain(_DOMAIN, _os.path.join(_os.path.expanduser("~"), ".local/share/locale"))


def _(text):
    return _gettext.dgettext(_DOMAIN, text)


def _load_module(name):
    # Pruefung Phase 2, P60: einmal je Dialog (avincelaunch_<Datei>) - so
    # teilen alle Bausteine z. B. denselben Meldestand von safeJson.
    import importlib.util
    module_name = "avincelaunch_" + name.replace(".py", "")
    module = sys.modules.get(module_name)
    if module is not None:
        return module
    path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


# AP10b-1: Schutzschicht fuer Portale (reine Ansicht), siehe portalGuard.py.
_PORTAL_GUARD = _load_module("portalGuard.py")


def _unique_destination_path(dest_dir, base_name):
    # Pruefung Phase 3 Teil 2 (T7): lexists - ein toter Verweis gleichen Namens
    # gilt als belegt (exists() folgte ihm, und os.link meldete zehnmal EEXIST).
    candidate = os.path.join(dest_dir, base_name)
    if not os.path.lexists(candidate):
        return candidate

    stem = base_name
    suffix = ""
    if base_name.endswith(".desktop"):
        stem = base_name[:-8]
        suffix = ".desktop"

    for index in range(1, 1000):
        candidate = os.path.join(dest_dir, f"{stem}-{index}{suffix}")
        if not os.path.lexists(candidate):
            return candidate

    raise RuntimeError(_("Could not find a unique destination name for %s") % base_name)


# P1 (Pruefung 07.10.): Starter werden mit GLib.KeyFile gelesen und
# geschrieben - nur der Abschnitt [Desktop Entry], nur geaenderte Schluessel.
# Uebersetzungen, Aktionen, MimeType usw. bleiben erhalten (Rundlauf an allen
# 81 Live-Starten byte-gleich geprueft). Geschrieben wird atomar; ein Symlink
# wird dabei durch die bearbeitete Kopie ersetzt, sein Ziel bleibt unberuehrt.
_ENTRY_GROUP = "Desktop Entry"
_KEYFILE_FLAGS = GLib.KeyFileFlags.KEEP_COMMENTS | GLib.KeyFileFlags.KEEP_TRANSLATIONS
_DEFAULT_ICON = "utilities-terminal"

# Pruefung Phase 3, N2: eine Regel fuer "%" im Befehl, beim Anlegen und beim
# Bearbeiten gleich. Die Platzhalter der Desktop-Spezifikation (%f %F %u %U
# %i %c %k, etwa in "firefox %u") bleiben Platzhalter; jedes andere "%" ist
# ein Prozentzeichen und steht in der Datei als "%%" (P53: "date +%Y").
# Grenze: "%u" als Prozentzeichen (z. B. "date +%u") gilt als Platzhalter.
_FIELD_CODES = "fFuUick"


def command_to_exec(command):
    """Befehl, wie ihn der Dialog zeigt -> Exec-Wert der Datei."""
    out = []
    i = 0
    while i < len(command):
        if command[i] == "%":
            if i + 1 < len(command) and command[i + 1] in _FIELD_CODES:
                out.append(command[i:i + 2])
                i += 2
                continue
            out.append("%%")
        else:
            out.append(command[i])
        i += 1
    return "".join(out)


def exec_to_command(exec_value):
    """Exec-Wert der Datei -> Befehl, wie ihn der Dialog zeigt."""
    out = []
    i = 0
    while i < len(exec_value):
        if exec_value.startswith("%%", i):
            out.append("%")
            i += 2
            continue
        out.append(exec_value[i])
        i += 1
    return "".join(out)


def entry_path(directory, name):
    """Pfad eines Listeneintrags; None, wenn name kein einzelner Dateiname ist
    (P7: eine umbenannte ID wie "../x" darf nicht aus dem Ordner fuehren)."""
    if not directory or not name or name in (".", "..") or "/" in name or "\0" in name:
        return None
    return os.path.join(directory, name)


def _refuse_entry(path, what):
    # P54: Massgeblich ist der Ordner, in dem der Eintrag liegt. Ein Verweis,
    # der in ein Portal zeigt, darf bearbeitet bzw. entfernt werden - das
    # aendert nur den Verweis. Ein echter Ordner, der selbst Portal ist, nicht.
    path = os.path.abspath(path)
    if _PORTAL_GUARD.refuse(os.path.dirname(path), what):
        return True
    if not os.path.islink(path) and _PORTAL_GUARD.refuse(path, what):
        return True
    return False


def _load_desktop_keyfile(path):
    keyfile = GLib.KeyFile()
    keyfile.load_from_file(path, _KEYFILE_FLAGS)
    if not keyfile.has_group(_ENTRY_GROUP):
        raise ValueError("no [Desktop Entry]")
    return keyfile


def _entry_string(keyfile, key, localized=False):
    try:
        if localized:
            return keyfile.get_locale_string(_ENTRY_GROUP, key, None)
        return keyfile.get_string(_ENTRY_GROUP, key)
    except GLib.Error:
        return None


def _entry_boolean(keyfile, key):
    try:
        return keyfile.get_boolean(_ENTRY_GROUP, key)
    except GLib.Error:
        return None


def _write_atomic(path, data, mode):
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(
        prefix="." + os.path.basename(path) + ".", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _shown_by_fence(path):
    """Teil 2 (BT2/T8): zeigt der Fence den Namen ueber DesktopAppInfo
    (get_display_name) oder - bei NoDisplay usw. - ueber die erste
    Name=-Zeile? Dieselbe Regel wie lib/linkScanner.js parseDesktopEntry."""
    try:
        from gi.repository import Gio
        info = Gio.DesktopAppInfo.new_from_filename(path)
        return bool(info is not None and info.should_show())
    except Exception:
        return False


def _name_key(keyfile, shown):
    """(Schluessel, sprachabhaengig) des Namens, den der Fence zeigt:
    get_display_name() nimmt X-GNOME-FullName vor Name; ohne Anzeige ueber
    DesktopAppInfo gilt die unuebersetzte Name=-Zeile."""
    if shown:
        if _entry_string(keyfile, "X-GNOME-FullName", localized=True):
            return "X-GNOME-FullName", True
        return "Name", True
    return "Name", False


def read_desktop_link(path):
    defaults = {
        "name": "",
        "command": "",
        "icon": _DEFAULT_ICON,
        "terminal": False,
    }
    if not path or not os.path.isfile(path):
        return defaults

    try:
        keyfile = _load_desktop_keyfile(path)
    except Exception:
        return defaults

    key, localized = _name_key(keyfile, _shown_by_fence(path))
    defaults["name"] = (_entry_string(keyfile, key, localized=localized)
                        or _entry_string(keyfile, "Name", localized=True) or "")
    defaults["command"] = exec_to_command(_entry_string(keyfile, "Exec") or "")
    defaults["icon"] = _entry_string(keyfile, "Icon") or _DEFAULT_ICON
    defaults["terminal"] = bool(_entry_boolean(keyfile, "Terminal"))
    return defaults


def update_desktop_link(path, name, command, icon="", terminal=True, confirmed=False):
    """Schreibt nur geaenderte Schluessel (P1). Teil 2 (BT2): Ist die Datei
    ein Verweis oder schreibgeschuetzt, wird ohne confirmed=True nichts
    geschrieben, sondern {"ok": False, "confirm": "symlink"|"readonly", ...}
    geliefert - der Dialog fragt nach und ruft dann mit confirmed=True."""
    if not path or not (name or "").strip() or not (command or "").strip():
        return {"ok": False, "error": _("Name and command are required.")}

    if not os.path.isfile(path):
        return {"ok": False, "error": _("Launcher file not found.")}

    if _refuse_entry(path, "editing the launcher"):
        return {"ok": False, "error": _("This fence is a folder portal (view only).")}

    try:
        keyfile = _load_desktop_keyfile(path)
    except Exception:
        return {"ok": False, "error": _("Could not update launcher file.")}

    changed = False

    name_value = name.strip()
    # BT2: den Schluessel aendern, den der Fence anzeigt (X-GNOME-FullName
    # vor Name; ohne Anzeige ueber DesktopAppInfo die unuebersetzte Zeile).
    name_key, localized = _name_key(keyfile, _shown_by_fence(path))
    if name_value != (_entry_string(keyfile, name_key, localized=localized) or ""):
        # Die Sprachvariante, die GLib fuer die aktuelle Sprache waehlt,
        # sonst den Schluessel selbst.
        locale = keyfile.get_locale_for_key(_ENTRY_GROUP, name_key, None) if localized else None
        if locale:
            keyfile.set_locale_string(_ENTRY_GROUP, name_key, locale, name_value)
        else:
            keyfile.set_string(_ENTRY_GROUP, name_key, name_value)
        changed = True

    # N2: Vergleich in der Form, die der Dialog zeigt - ein unveraenderter
    # Befehl wird nie neu geschrieben (auch nicht "%%u" -> "%u").
    command_value = command.strip()
    if command_value != exec_to_command(_entry_string(keyfile, "Exec") or ""):
        keyfile.set_string(_ENTRY_GROUP, "Exec", command_to_exec(command_value))
        changed = True

    icon_value = icon.strip() or _DEFAULT_ICON
    current_icon = _entry_string(keyfile, "Icon")
    if icon_value != (current_icon or _DEFAULT_ICON):
        keyfile.set_string(_ENTRY_GROUP, "Icon", icon_value)
        changed = True

    current_terminal = _entry_boolean(keyfile, "Terminal")
    if bool(terminal) != bool(current_terminal):
        keyfile.set_boolean(_ENTRY_GROUP, "Terminal", bool(terminal))
        changed = True

    if not changed:
        return {"ok": True, "path": path, "type": "app"}

    # BT2 (T8): vor dem Ersetzen eines Verweises bzw. einer
    # schreibgeschuetzten Datei nachfragen (os.replace ersetzt beides still).
    if not confirmed:
        if os.path.islink(path):
            return {"ok": False, "confirm": "symlink", "target": os.path.realpath(path),
                    "error": _("This launcher is a link to %s.") % os.path.realpath(path)}
        if not os.access(path, os.W_OK):
            return {"ok": False, "confirm": "readonly",
                    "error": _("This launcher file is write-protected.")}

    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
        _write_atomic(path, keyfile.to_data()[0], mode)
        return {"ok": True, "path": path, "type": "app"}
    except Exception:
        return {"ok": False, "error": _("Could not update launcher file.")}


# Teil 2 (T7): Fehler von os.link, die "keine harten Verweise hier" bedeuten
# (vfat/exFAT, manche CIFS-/sshfs-Freigaben) - wie avincelaunch_rules.py.
_NO_HARDLINK = {errno.EPERM, errno.EOPNOTSUPP, errno.ENOTSUP, errno.EXDEV,
                errno.EMLINK, errno.ENOSYS, errno.EACCES}


def _write_new_exclusive(path, text, mode):
    """Legt path exklusiv neu an (O_EXCL) und schreibt text; scheitert das
    Schreiben, wird die neue Datei wieder entfernt - nie eine halbe."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def create_desktop_link(dest_dir, name, command, icon="", terminal=True):
    if not dest_dir or not (name or "").strip() or not (command or "").strip():
        return {"ok": False, "error": _("Name and command are required.")}

    if not os.path.isdir(dest_dir):
        return {"ok": False, "error": _("Link directory not found.")}

    if _PORTAL_GUARD.refuse(dest_dir, "creating or copying"):
        return {"ok": False, "error": _("This fence is a folder portal (view only).")}

    keyfile = GLib.KeyFile()
    keyfile.set_string(_ENTRY_GROUP, "Type", "Application")
    keyfile.set_string(_ENTRY_GROUP, "Name", name.strip())
    # P53/N2: Prozentzeichen als "%%", Platzhalter bleiben (command_to_exec).
    keyfile.set_string(_ENTRY_GROUP, "Exec", command_to_exec(command.strip()))
    keyfile.set_string(_ENTRY_GROUP, "Icon", icon.strip() or _DEFAULT_ICON)
    keyfile.set_boolean(_ENTRY_GROUP, "Terminal", bool(terminal))
    keyfile.set_boolean(_ENTRY_GROUP, "NoDisplay", False)
    data = keyfile.to_data()[0]

    safe_stem = re.sub(r"[^\w\-]+", "-", name.strip()).strip("-") or "launcher"
    base_name = safe_stem + ".desktop"

    # P53: erst vollstaendig in eine Zwischendatei, dann per os.link exklusiv
    # an den Zielnamen - eine gleichnamige Datei wird nie ueberschrieben.
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(prefix="." + base_name + ".", suffix=".tmp", dir=dest_dir)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, 0o755)
        for _attempt in range(10):
            try:
                dest_path = _unique_destination_path(dest_dir, base_name)
            except RuntimeError as exc:
                return {"ok": False, "error": str(exc)}
            try:
                os.link(tmp_path, dest_path)
            except FileExistsError:
                continue
            except OSError as error:
                if error.errno not in _NO_HARDLINK:
                    raise
                # T7: Basisordner auf einem Dateisystem ohne harte Verweise
                # (frei waehlbar, z. B. USB-Stick) - exklusiv neu anlegen.
                try:
                    _write_new_exclusive(dest_path, data, 0o755)
                except FileExistsError:
                    continue
            return {"ok": True, "path": dest_path, "type": "app"}
        return {"ok": False, "error": _("Could not create launcher file.")}
    except Exception:
        return {"ok": False, "error": _("Could not create launcher file.")}
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def trash_path(path):
    if not path or not os.path.exists(path):
        return {"ok": False, "error": _("Item not found.")}

    if _refuse_entry(path, "moving to the trash"):
        return {"ok": False, "error": _("This fence is a folder portal (view only).")}

    try:
        from gi.repository import Gio
        Gio.File.new_for_path(path).trash(None)
        return {"ok": True}
    except Exception:
        return {"ok": False, "error": _("Could not remove item.")}
