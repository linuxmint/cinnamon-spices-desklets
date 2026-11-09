# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

import os
import re
import sys
import time

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

# Pruefung Phase 2, A3-2: kaputte JSON-Dateien sichern statt ueberschreiben,
# atomar schreiben - siehe safeJson.py (gleiche Regel wie lib/safeJson.js).
_SAFE_JSON = _load_module("safeJson.py")


# Eigener Name seit aVinceLaunch. Die Dateien aus TheLauncher-Zeiten werden
# weiterhin GELESEN; geschrieben wird immer unter dem neuen Namen. Diese
# Namen muessen mit lib/config.js und lib/sidecar.js uebereinstimmen, sonst
# arbeiten Desklet und Einstellungsdialog mit verschiedenen Dateien.
APP_DIR_NAME = "avincelaunch"
LEGACY_DIR_NAME = "thelauncher"

SIDECAR_NAME = ".avincelaunch.json"
LEGACY_SIDECAR_NAME = ".thelauncher.json"
DATA_KEY = "link-order-list-data"


def _xdg_config_home():
    return os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")


def _xdg_data_home():
    return os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")


CONFIG_FILE = os.path.join(_xdg_config_home(), APP_DIR_NAME, "config.json")
LEGACY_CONFIG_FILE = os.path.join(_xdg_config_home(), LEGACY_DIR_NAME, "config.json")


def normalize_base_directory(value):
    """Regel wie lib/config.js normalizeBaseDirectory (P11): "~" erweitern,
    nur absolute Pfade, Verweise NICHT aufloesen; sonst ""."""
    text = value.strip() if isinstance(value, str) else ""
    if text == "~" or text.startswith("~/"):
        text = os.path.expanduser("~") + text[1:]
    if not text.startswith("/"):
        return ""
    return os.path.normpath(text)


def load_shared_base_directory():
    # Rueckfallregel wie lib/config.js loadConfig (P11): die eigene Datei,
    # wenn lesbar, sonst die aus TheLauncher-Zeiten, sonst der Standard.
    # Eine kaputte Datei wird gesichert und gemeldet (A3-2). Die erste lesbare
    # entscheidet; ohne gueltigen Wert gilt der Standard.
    default = os.path.join(_xdg_data_home(), APP_DIR_NAME)
    for path in (CONFIG_FILE, LEGACY_CONFIG_FILE):
        state, data, raw = _SAFE_JSON.read_json(path)
        if state == _SAFE_JSON.STATE_BROKEN:
            _SAFE_JSON.secure_broken(path, raw)
            continue
        if state == _SAFE_JSON.STATE_OK:
            return normalize_base_directory(data.get("baseDirectory")) or default
    return default


def save_shared_base_directory(base_directory):
    """Persist the shared base for all aVinceLaunch instances."""
    base = (base_directory or "").strip() or os.path.join(_xdg_data_home(), APP_DIR_NAME)
    config_dir = os.path.dirname(CONFIG_FILE)
    os.makedirs(config_dir, mode=0o755, exist_ok=True)
    payload = {
        "version": 1,
        "baseDirectory": base,
    }
    # Bewusste Wahl des Nutzers: eine kaputte config.json wird vorher
    # gesichert und dann ersetzt (sie enthaelt nur diesen einen Wert).
    _SAFE_JSON.may_write(CONFIG_FILE)
    _SAFE_JSON.write_json_atomic(CONFIG_FILE, payload, trailing_newline=True)
    return base


def resolve_shared_base(settings):
    # Der Basisordner gilt fuer ALLE Fences und kommt nur aus config.json, wie
    # im Fence selbst (AP17). Die Kopie "base-directory" der Instanz kann
    # veraltet sein, wenn er in einem anderen Fence geaendert wurde.
    # P11: wie das Desklet (lib/pathSource.js) nicht aufloesen - sonst
    # arbeiten Dialog und Fence bei einem Verweis in verschiedenen Pfaden.
    return _normalize_path(load_shared_base_directory())


def _normalize_path(path):
    return os.path.normpath(os.path.abspath(os.path.expanduser(path or "")))


def resolve_root_path(settings):
    base = resolve_shared_base(settings)
    sub = "default"
    if settings.has_key("subdirectory"):
        try:
            sub = (settings.get_value("subdirectory") or "default").strip() or "default"
        except Exception:
            pass
    return os.path.join(base, sub.strip("/"))


def get_browse_path(settings):
    root = resolve_root_path(settings)
    if settings.has_key("order-folder-path"):
        try:
            configured = (settings.get_value("order-folder-path") or "").strip()
        except Exception:
            configured = ""
        if configured and os.path.isdir(configured):
            if configured == root or configured.startswith(root + os.sep):
                return configured
    return root


def breadcrumb_label(path, root):
    if not path or path == root:
        return _("Home")
    prefix = root + os.sep
    if path.startswith(prefix):
        return path[len(prefix):].replace(os.sep, " / ")
    return path


def sidecar_path_for_reading(directory_path):
    """Rueckfallregel: zuerst die eigene Datei, sonst die aus TheLauncher-Zeiten."""
    own = os.path.join(directory_path, SIDECAR_NAME)
    if os.path.isfile(own):
        return own
    legacy = os.path.join(directory_path, LEGACY_SIDECAR_NAME)
    if os.path.isfile(legacy):
        return legacy
    return None


def sidecar_source_broken(directory_path):
    """A3-2 (P4), wie sidecarSourceBroken in lib/sidecar.js: Die Datei, die
    read_sidecar zuerst nimmt, ist kaputt - dann wird nicht geschrieben."""
    own = os.path.join(directory_path, SIDECAR_NAME)
    state, _data, raw = _SAFE_JSON.read_json(own)
    if state == _SAFE_JSON.STATE_BROKEN:
        _SAFE_JSON.secure_broken(own, raw)
        return True
    # Teil 2 (T13): entfernte kaputte Datei -> neu beginnen, die alte zaehlt nicht.
    if state == _SAFE_JSON.STATE_MISSING and not _SAFE_JSON.has_broken_copy(own):
        legacy = os.path.join(directory_path, LEGACY_SIDECAR_NAME)
        state, _data, raw = _SAFE_JSON.read_json(legacy)
        if state == _SAFE_JSON.STATE_BROKEN:
            _SAFE_JSON.secure_broken(legacy, raw)
            return True
    return False


# Wie lib/sidecar.js (AP18-3): unbekannte Felder (z. B. "pinned" aus dem
# Desklet) werden unveraendert mitgeschrieben, nie verworfen.
_KNOWN_SIDECAR_FIELDS = ("version", "order", "disabled", "itemStyles", "folderClickMode",
                         "missingSince")


def read_sidecar(directory_path):
    defaults = {"version": 1, "order": [], "disabled": [], "itemStyles": {}, "missingSince": {},
                "_extra": {}}
    # A3-2 (P4): kaputte eigene Datei -> sichern, melden, die alte lesen.
    parsed = None
    for name in (SIDECAR_NAME, LEGACY_SIDECAR_NAME):
        path = os.path.join(directory_path, name)
        state, data, raw = _SAFE_JSON.read_json(path)
        if state == _SAFE_JSON.STATE_OK:
            parsed = data
            break
        if state == _SAFE_JSON.STATE_BROKEN:
            _SAFE_JSON.secure_broken(path, raw)
            defaults["_broken"] = True
        # Teil 2 (T13), wie lib/sidecar.js: fehlt die eigene Datei und liegt
        # ihre .broken-Kopie daneben, wurde sie entfernt - neu beginnen statt
        # still die aeltere .thelauncher.json zu nehmen.
        if (name == SIDECAR_NAME and state == _SAFE_JSON.STATE_MISSING
                and _SAFE_JSON.has_broken_copy(path)):
            break
    if parsed is not None:
        if isinstance(parsed.get("order"), list):
            defaults["order"] = parsed["order"]
        if isinstance(parsed.get("disabled"), list):
            defaults["disabled"] = parsed["disabled"]
        if parsed.get("version"):
            defaults["version"] = parsed["version"]
        if isinstance(parsed.get("itemStyles"), dict):
            defaults["itemStyles"] = parsed["itemStyles"]
        if parsed.get("folderClickMode"):
            defaults["folderClickMode"] = parsed["folderClickMode"]
        if isinstance(parsed.get("missingSince"), dict):
            defaults["missingSince"] = parsed["missingSince"]
        for key, value in parsed.items():
            if key not in _KNOWN_SIDECAR_FIELDS:
                defaults["_extra"][key] = value
    return defaults


def write_sidecar(directory_path, sidecar):
    """Liefert True, wenn geschrieben wurde."""
    if _PORTAL_GUARD.refuse(directory_path, "writing the order file"):
        return False
    if sidecar_source_broken(directory_path):
        return False
    payload = dict(sidecar.get("_extra") or {})
    payload.update({
        "version": sidecar.get("version") or 1,
        "order": sidecar.get("order") or [],
        "disabled": sidecar.get("disabled") or [],
    })
    # Wie lib/sidecar.js: das Ordner-Klickverhalten mitschreiben, sonst
    # loescht jedes Speichern eines Ordnerstils es (AP17).
    if sidecar.get("folderClickMode"):
        payload["folderClickMode"] = sidecar["folderClickMode"]
    item_styles = sidecar.get("itemStyles") or {}
    if item_styles:
        payload["itemStyles"] = item_styles
    missing_since = sidecar.get("missingSince") or {}
    if missing_since:
        payload["missingSince"] = missing_since
    # P5: atomar - ein Abbruch hinterlaesst nie eine leere oder halbe Datei.
    # P29: ein Schreibfehler (Rechte, voller Datentraeger) heisst "nicht
    # gespeichert" - der Aufrufer zeigt es an, statt Erfolg zu melden.
    try:
        _SAFE_JSON.write_json_atomic(os.path.join(directory_path, SIDECAR_NAME), payload)
    except OSError as error:
        print("aVinceLaunch: order file not written: %s (%s)" % (directory_path, error),
              file=sys.stderr)
        return False
    return True


DEFAULT_FOLDER_ICON = "folder-symbolic"


def get_folder_style(directory_path, folder_id):
    sidecar = read_sidecar(directory_path)
    style = (sidecar.get("itemStyles") or {}).get(folder_id) or {}
    return {
        "icon": style.get("icon") or DEFAULT_FOLDER_ICON,
        "bgColor": style.get("bgColor") or "",
    }


def save_folder_style(settings, folder_id, icon, bg_color):
    directory_path = get_browse_path(settings)
    if not directory_path or not folder_id:
        return False

    sidecar = read_sidecar(directory_path)
    styles = dict(sidecar.get("itemStyles") or {})

    icon = (icon or "").strip() or DEFAULT_FOLDER_ICON
    bg_color = (bg_color or "").strip()

    entry = {}
    if icon and icon != DEFAULT_FOLDER_ICON:
        entry["icon"] = icon
    if bg_color:
        entry["bgColor"] = bg_color

    if entry:
        styles[folder_id] = entry
    else:
        styles.pop(folder_id, None)

    sidecar["itemStyles"] = styles
    return write_sidecar(directory_path, sidecar)


def merge_order(existing_order, item_ids):
    merged = []
    seen = set()
    for item_id in existing_order or []:
        if item_id in item_ids and item_id not in seen:
            merged.append(item_id)
            seen.add(item_id)
    for item_id in item_ids:
        if item_id not in seen:
            merged.append(item_id)
            seen.add(item_id)
    return merged


# Pruefung Phase 2, B10 (P25): fehlende Eintraege behalten ihren Platz -
# gleiche Regel wie keepMissingEntries in lib/sidecar.js.
MISSING_KEEP_SECONDS = 30 * 24 * 60 * 60
_now_for_tests = None


def _now_seconds():
    return _now_for_tests if _now_for_tests is not None else int(time.time())


def keep_missing_entries(old_order, new_order, missing_since):
    """(Reihenfolge, missingSince, behalten) - IDs aus old_order, die in
    new_order fehlen, bleiben 30 Tage an ihrem Platz (hinter dem naechsten
    Vorgaenger, der noch da ist)."""
    now = _now_seconds()
    order = list(new_order or [])
    in_new = set(order)
    since = {}
    kept = []
    old = old_order if isinstance(old_order, list) else []
    for index, item_id in enumerate(old):
        if item_id in in_new:
            continue
        try:
            first = int((missing_since or {}).get(item_id, now))
        except (TypeError, ValueError):
            first = now
        if now - first > MISSING_KEEP_SECONDS:
            continue
        position = 0
        for previous in reversed(old[:index]):
            if previous in order:
                position = order.index(previous) + 1
                break
        order.insert(position, item_id)
        in_new.add(item_id)
        since[item_id] = first
        kept.append(item_id)
    return order, since, kept


def ensure_sidecar(directory_path, items):
    # Gilt als vorhanden, sobald eine der beiden Dateien existiert. Sonst
    # wuerde in einem bereits geordneten Verzeichnis die Reihenfolge neu
    # erfunden.
    sidecar_path = sidecar_path_for_reading(directory_path)
    item_ids = [item["id"] for item in items]
    disabled_ids = [item["id"] for item in items if not item.get("enabled", True)]

    if sidecar_path is None:
        write_sidecar(directory_path, {
            "version": 1,
            "order": item_ids,
            "disabled": disabled_ids,
        })
        return

    sidecar = read_sidecar(directory_path)
    merged, since, _kept = keep_missing_entries(
        sidecar.get("order"), merge_order(sidecar.get("order"), item_ids),
        sidecar.get("missingSince"))
    if merged != sidecar.get("order") or since != (sidecar.get("missingSince") or {}):
        sidecar["order"] = merged
        sidecar["missingSince"] = since
        write_sidecar(directory_path, sidecar)


def _readable_file(path):
    """Wie isRegularFilePath in lib/linkScanner.js: laesst sich oeffnen."""
    try:
        with open(path, "rb"):
            return True
    except OSError:
        return False


def _new_desktop_app_info(path):
    try:
        import gi
        gi.require_version("GioUnix", "2.0")
        from gi.repository import GioUnix
        if hasattr(GioUnix, "DesktopAppInfo"):
            return GioUnix.DesktopAppInfo.new_from_filename(path)
    except Exception:
        pass
    try:
        from gi.repository import Gio
        return Gio.DesktopAppInfo.new_from_filename(path)
    except Exception:
        return None


def _desktop_entry_name(path, file_name):
    """Pruefung Phase 2, P36: dieselbe Regel wie parseDesktopEntry in
    lib/linkScanner.js. Liefert den angezeigten Namen oder None (wird im
    Fence nicht gezeigt). Frueher nahm der Dialog die erste Name=-Zeile -
    englisch ("Calendar" statt "Kalender") - und zeigte auch Starter, die der
    Fence weglaesst; die Liste sprang, "veraltet" schlug falsch an."""
    info = _new_desktop_app_info(path)
    if info is not None:
        try:
            if info.should_show():
                return info.get_display_name() or info.get_name() or file_name
        except Exception:
            pass
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            contents = handle.read()
    except Exception:
        return None
    if not re.search(r"^\s*Exec\s*=", contents, re.MULTILINE):
        return None
    match = re.search(r"^\s*Name\s*=\s*(.+)$", contents, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return file_name[:-len(".desktop")] if file_name.endswith(".desktop") else file_name


def _document_display_name(file_name):
    stem, _ext = os.path.splitext(file_name)
    return stem if stem else file_name


def apply_ordering(items, order, folder_sort):
    if not order:
        return sorted(items, key=lambda item: _item_sort_key(item, folder_sort))

    by_id = {item["id"]: item for item in items}
    ordered = []
    for item_id in order:
        if item_id in by_id:
            ordered.append(by_id.pop(item_id))
    remaining = sorted(by_id.values(), key=lambda item: _item_sort_key(item, folder_sort))
    return ordered + remaining


def _item_sort_key(item, folder_sort):
    item_type = item.get("type") or "app"
    if folder_sort == "folders-first":
        type_rank = 0 if item_type == "folder" else 1
    elif folder_sort == "folders-last":
        type_rank = 1 if item_type == "folder" else 0
    else:
        type_rank = 0
    return (type_rank, (item.get("name") or "").lower())


def _order_row_type(row):
    icon = row.get("type-icon") or ""
    if icon == "folder-symbolic":
        return "folder"
    if icon == "x-office-document-symbolic":
        return "document"
    return "app"


def _order_row_sort_key(row, folder_sort):
    row_type = _order_row_type(row)
    if folder_sort == "folders-first":
        type_rank = 0 if row_type == "folder" else 1
    elif folder_sort == "folders-last":
        type_rank = 1 if row_type == "folder" else 0
    else:
        type_rank = 0
    return (type_rank, (row.get("name") or "").lower())


_TYPE_RANK = {"folder": 0, "app": 1, "document": 2}


def _row_times(row, directory):
    # lstat: Zeit des Eintrags selbst (bei Verweisen nicht das Ziel).
    try:
        info = os.lstat(os.path.join(directory, row.get("id-short") or ""))
        return info.st_mtime, info.st_ctime
    except Exception:
        return 0, 0


def sort_order_list_rows(rows, folder_sort="mixed", directory=None):
    """Einmaliges Neu-Sortieren der Liste (AP18-3: dieselben Arten wie die
    Sortierung im Fence). folder_sort ist hier die gewaehlte Art."""
    rows = list(rows or [])
    name = lambda row: (row.get("name") or "").lower()
    if folder_sort == "name-desc":
        return sorted(rows, key=name, reverse=True)
    if folder_sort == "type":
        return sorted(rows, key=lambda row: (_TYPE_RANK.get(_order_row_type(row), 1), name(row)))
    if folder_sort in ("modified", "added") and directory:
        index = 0 if folder_sort == "modified" else 1
        return sorted(rows, key=lambda row: (-_row_times(row, directory)[index], name(row)))
    return sorted(rows, key=lambda row: _order_row_sort_key(row, folder_sort))


def resort_settings_order_list(settings, folder_sort="mixed"):
    if not settings.has_key(DATA_KEY):
        return False

    try:
        rows = settings.get_value(DATA_KEY) or []
    except Exception:
        rows = []

    if not rows:
        return False

    sorted_rows = sort_order_list_rows(rows, folder_sort, get_browse_path(settings))
    _set_setting(settings, DATA_KEY, sorted_rows)
    return True


def scan_directory(directory_path, folder_sort="mixed"):
    if not os.path.isdir(directory_path):
        return []

    sidecar = read_sidecar(directory_path)
    disabled = set(sidecar.get("disabled") or [])
    items = []

    try:
        names = os.listdir(directory_path)
    except OSError:
        return []

    for name in names:
        if name.startswith("."):
            continue
        full = os.path.join(directory_path, name)
        if os.path.isdir(full):
            item_id = "folder:" + name
            items.append({
                "id": item_id,
                "type": "folder",
                "name": name,
                "enabled": item_id not in disabled,
            })
        elif name.endswith(".desktop") and os.path.isfile(full) and _readable_file(full):
            display = _desktop_entry_name(full, name)
            if display is None:
                continue
            item_id = "app:" + name
            items.append({
                "id": item_id,
                "type": "app",
                "name": display,
                "enabled": item_id not in disabled,
            })
        elif os.path.isfile(full) and _readable_file(full):
            item_id = "document:" + name
            items.append({
                "id": item_id,
                "type": "document",
                "name": _document_display_name(name),
                "enabled": item_id not in disabled,
            })

    return apply_ordering(items, sidecar.get("order"), folder_sort)


def items_to_order_list(items):
    rows = []
    for item in items:
        item_id = item["id"]
        short_id = item_id.split(":", 1)[1] if ":" in item_id else item_id
        rows.append({
            "enabled": item.get("enabled", True),
            "name": item.get("name") or short_id,
            "type-icon": (
                "folder-symbolic" if item.get("type") == "folder"
                else "x-office-document-symbolic" if item.get("type") == "document"
                else "application-x-executable-symbolic"
            ),
            "id-short": short_id,
        })
    return rows


def navigate_to_path(settings, target_path):
    if not target_path or not os.path.isdir(target_path):
        return False

    # P11: unaufgeloest wie resolve_shared_base (der Portal-Schutz prueft
    # selbst beide Formen).
    target_path = _normalize_path(target_path)
    if _PORTAL_GUARD.is_portal_path(target_path):
        return False
    # Allow any folder under the shared base (Browse may switch sibling
    # instance directories). Instance "Home" is still the configured subdirectory.
    base = resolve_shared_base(settings)
    if target_path != base and not target_path.startswith(base + os.sep):
        return False

    root = _normalize_path(resolve_root_path(settings))
    folder_sort = "mixed"
    if settings.has_key("folder-sort"):
        try:
            folder_sort = settings.get_value("folder-sort") or "mixed"
        except Exception:
            pass

    items = scan_directory(target_path, folder_sort)
    ensure_sidecar(target_path, items)
    rows = items_to_order_list(items)
    label = breadcrumb_label(target_path, root)
    in_subfolder = target_path != root

    # Pruefung Phase 2, P12: alles in EINEM Speichern - frueher bis zu sechs
    # (mit leerer Liste als Zwischenstand), jedes ein Fenster, in dem eine
    # Aenderung des Fence ueberschrieben werden konnte. Die Liste meldet sich
    # immer bei ihren Zuhoerern, auch wenn sie gleich ist (sonst blieb sie
    # nach "Aktualisieren" stehen).
    set_values_bundled(settings, [
        (DATA_KEY, rows),
        ("order-folder-path", target_path),
        ("order-breadcrumb-display", label),
        ("order-in-subfolder", in_subfolder),
        ("order-open-folder-id", ""),
    ], force_keys=(DATA_KEY,))
    return True


def set_values_bundled(settings, pairs, force_keys=()):
    """Mehrere Werte mit einem Speichern, danach Fence, Anzeige und Zuhoerer
    wie bei set_value. pairs = [(Schluessel, Wert), ...] in Meldereihenfolge."""
    store = getattr(settings, "settings", None)
    if not isinstance(store, dict) or not hasattr(settings, "save_settings"):
        # Kein Cinnamon-Speicherobjekt (Tests): einzeln wie bisher.
        for key, value in pairs:
            if key == DATA_KEY and key in force_keys:
                force_set_order_list(settings, value)
            else:
                _set_setting(settings, key, value)
        return True

    changed = False
    report = []
    for key, value in pairs:
        if not settings.has_key(key):
            continue
        if store[key].get("value") != value:
            store[key]["value"] = value
            changed = True
            report.append(key)
        elif key in force_keys:
            report.append(key)
    if changed:
        try:
            settings.save_settings()
        except Exception as error:
            print("aVinceLaunch: settings not saved: %s" % error, file=sys.stderr)
            return False
        # Der Fence liest bei jeder Meldung die ganze Datei neu
        # (settings.js remoteUpdate) - eine Meldung genuegt.
        notify = getattr(settings, "notify_callback", None)
        first = next((k for k, _v in pairs if k in report), None)
        if notify is not None and first is not None:
            try:
                notify(settings, first, store[first]["value"])
            except Exception:
                pass
    for key in report:
        value = store[key]["value"]
        for info in list(getattr(settings, "bindings", {}).get(key, [])):
            try:
                settings.set_object_value(info, value)
            except Exception:
                pass
        for callback in list(getattr(settings, "listeners", {}).get(key, [])):
            try:
                callback(key, value)
            except Exception:
                pass
    return True


def set_value_safe(settings, key, value):
    """Write a setting and always run local listeners.

    JSONSettingsHandler.set_value saves the file, then DBus-notifies Cinnamon
    via updateSetting. After a desklet reload that notify can throw
    (settingsManager.uuids[uuid][instance_id] is null) and abort before local
    Configure listeners run — leaving Items / labels stale even though the
    JSON on disk was updated. Isolate the remote notify so UI updates finish.
    """
    if not settings.has_key(key):
        return False

    notify = getattr(settings, "notify_callback", None)
    settings.notify_callback = None
    try:
        settings.set_value(key, value)
    except Exception:
        return False
    finally:
        settings.notify_callback = notify

    if notify is not None:
        try:
            notify(settings, key, value)
        except Exception:
            # Desklet still picks up the file change; Configure already updated.
            pass
    return True


def force_set_order_list(settings, rows):
    """Write link-order-list-data and always fire settings listeners."""
    if not settings.has_key(DATA_KEY):
        return
    try:
        current = settings.get_value(DATA_KEY)
    except Exception:
        current = None

    try:
        if current == rows:
            # Nudge inequality so listeners run, then write the real rows.
            set_value_safe(settings, DATA_KEY, [])
        set_value_safe(settings, DATA_KEY, rows)
    except Exception:
        pass


def _set_setting(settings, key, value):
    try:
        set_value_safe(settings, key, value)
    except Exception:
        pass


def navigate_into_folder(settings, folder_name):
    parent = get_browse_path(settings)
    target = os.path.join(parent, folder_name)
    return navigate_to_path(settings, target)


def navigate_home(settings):
    return navigate_to_path(settings, resolve_root_path(settings))


# --- Pruefung Phase 2, P31: offene Aenderungen der Liste nicht still verwerfen
# Die Liste im Dialog (link-order-list-data) ist erst nach "Uebernehmen" im
# Ordner gespeichert. Hinzufuegen, Bearbeiten, Ordnerwechsel und Aktualisieren
# lesen den Ordner neu ein und ersetzten bisher die Liste ohne Rueckfrage.

def _row_entry_id(row):
    short_id = row.get("id-short") or ""
    if ":" in short_id:
        return short_id
    return _order_row_type(row) + ":" + short_id


def list_has_unapplied_changes(settings):
    """True, wenn Reihenfolge oder Haken der Liste vom gespeicherten Stand
    des Ordners abweichen (gleiche Regel wie _syncDialogListIfClean im
    Desklet: verglichen werden die Eintraege, die es in beiden gibt)."""
    if not settings.has_key(DATA_KEY):
        return False
    try:
        rows = settings.get_value(DATA_KEY) or []
    except Exception:
        return False
    if not rows:
        return False
    browse_path = get_browse_path(settings)
    if not browse_path or not os.path.isdir(browse_path):
        return False
    folder_sort = "mixed"
    if settings.has_key("folder-sort"):
        try:
            folder_sort = settings.get_value("folder-sort") or "mixed"
        except Exception:
            pass
    saved = scan_directory(browse_path, folder_sort)
    saved_enabled = {item["id"]: bool(item.get("enabled", True)) for item in saved}
    list_enabled = {}
    list_ids = []
    for row in rows:
        entry_id = _row_entry_id(row)
        list_ids.append(entry_id)
        list_enabled[entry_id] = row.get("enabled") is not False
    common_list = [i for i in list_ids if i in saved_enabled]
    common_saved = [item["id"] for item in saved if item["id"] in list_enabled]
    if common_list != common_saved:
        return True
    return any(list_enabled[i] != saved_enabled[i] for i in common_list)


def notify_desklet(settings_or_id, callback_name):
    """Ruft einen Rueckruf des Fence ueber D-Bus (activateCallback).

    Pruefung Phase 2, P59: EINE Stelle statt sechs Kopien, Fehler (Cinnamon
    nicht erreichbar, Fence gerade neu aufgebaut) werden abgefangen und als
    False gemeldet statt den Dialogablauf abzubrechen.
    settings_or_id: das Speicherobjekt des Dialogs oder die Instanz-ID."""
    if isinstance(settings_or_id, str):
        instance_id = settings_or_id
    else:
        instance_id = str(getattr(settings_or_id, "instance_id", ""))
    try:
        from gi.repository import Gio, GLib
        proxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None,
            "org.Cinnamon", "/org/Cinnamon", "org.Cinnamon", None)
        proxy.call_sync(
            "activateCallback",
            GLib.Variant("(sss)", (callback_name, UUID, instance_id)),
            Gio.DBusCallFlags.NONE, -1, None)
        return True
    except Exception as error:
        print("aVinceLaunch: fence %s not reachable (%s): %s"
              % (instance_id, callback_name, error), file=sys.stderr)
        return False


UUID = "avincelaunch-desklet@avince"


def confirm_unapplied_changes(settings, parent=None):
    """Vor einer Aktion, die die Liste neu einliest: bei offenen Aenderungen
    fragen. True = weitermachen (uebernommen oder verworfen), False = abbrechen."""
    try:
        if not list_has_unapplied_changes(settings):
            return True
    except Exception:
        return True

    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import Gtk
    dialog = Gtk.MessageDialog(
        transient_for=parent,
        modal=True,
        message_type=Gtk.MessageType.QUESTION,
        buttons=Gtk.ButtonsType.NONE,
        text=_("The list has changes that have not been applied yet."),
    )
    dialog.format_secondary_text(
        _("Order or checkmarks differ from the folder. Apply them first, "
          "or discard them?"))
    dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
    dialog.add_button(_("_Discard"), Gtk.ResponseType.NO)
    dialog.add_button(_("_Apply first"), Gtk.ResponseType.YES)
    dialog.set_default_response(Gtk.ResponseType.YES)
    response = dialog.run()
    dialog.destroy()

    if response == Gtk.ResponseType.YES:
        if not notify_desklet(settings, "on_apply_order_callback"):
            return False
        if settings.has_key("order-list-stale"):
            _set_setting(settings, "order-list-stale", False)
        return True
    return response == Gtk.ResponseType.NO
