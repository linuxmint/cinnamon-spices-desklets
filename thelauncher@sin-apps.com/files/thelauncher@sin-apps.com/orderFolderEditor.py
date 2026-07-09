import json
import os
import re

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


SIDECAR_NAME = ".thelauncher.json"
DATA_KEY = "link-order-list-data"


def _xdg_config_home():
    return os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")


def _xdg_data_home():
    return os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")


CONFIG_FILE = os.path.join(_xdg_config_home(), "thelauncher", "config.json")


def load_shared_base_directory():
    default = os.path.join(_xdg_data_home(), "thelauncher")
    if not os.path.isfile(CONFIG_FILE):
        return default
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return (data.get("baseDirectory") or default).strip() or default
    except Exception:
        return default


def save_shared_base_directory(base_directory):
    """Persist the shared base for all TheLauncher instances."""
    base = (base_directory or "").strip() or os.path.join(_xdg_data_home(), "thelauncher")
    config_dir = os.path.dirname(CONFIG_FILE)
    os.makedirs(config_dir, mode=0o755, exist_ok=True)
    payload = {
        "version": 1,
        "baseDirectory": base,
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    return base


def resolve_shared_base(settings):
    configured = ""
    if settings.has_key("base-directory"):
        try:
            configured = (settings.get_value("base-directory") or "").strip()
        except Exception:
            configured = ""
    return os.path.realpath(configured or load_shared_base_directory())


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


def read_sidecar(directory_path):
    defaults = {"version": 1, "order": [], "disabled": [], "itemStyles": {}}
    sidecar_path = os.path.join(directory_path, SIDECAR_NAME)
    if not os.path.isfile(sidecar_path):
        return defaults
    try:
        with open(sidecar_path, "r", encoding="utf-8") as handle:
            parsed = json.load(handle)
        if isinstance(parsed.get("order"), list):
            defaults["order"] = parsed["order"]
        if isinstance(parsed.get("disabled"), list):
            defaults["disabled"] = parsed["disabled"]
        if parsed.get("version"):
            defaults["version"] = parsed["version"]
        if isinstance(parsed.get("itemStyles"), dict):
            defaults["itemStyles"] = parsed["itemStyles"]
    except Exception:
        pass
    return defaults


def write_sidecar(directory_path, sidecar):
    payload = {
        "version": sidecar.get("version") or 1,
        "order": sidecar.get("order") or [],
        "disabled": sidecar.get("disabled") or [],
    }
    item_styles = sidecar.get("itemStyles") or {}
    if item_styles:
        payload["itemStyles"] = item_styles
    with open(os.path.join(directory_path, SIDECAR_NAME), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


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
    write_sidecar(directory_path, sidecar)
    return True


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


def ensure_sidecar(directory_path, items):
    sidecar_path = os.path.join(directory_path, SIDECAR_NAME)
    item_ids = [item["id"] for item in items]
    disabled_ids = [item["id"] for item in items if not item.get("enabled", True)]

    if not os.path.isfile(sidecar_path):
        write_sidecar(directory_path, {
            "version": 1,
            "order": item_ids,
            "disabled": disabled_ids,
        })
        return

    sidecar = read_sidecar(directory_path)
    merged = merge_order(sidecar.get("order"), item_ids)
    if merged != sidecar.get("order"):
        sidecar["order"] = merged
        write_sidecar(directory_path, sidecar)


def _desktop_display_name(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            contents = handle.read()
        match = re.search(r"^\s*Name\s*=\s*(.+)$", contents, re.MULTILINE)
        if match and match.group(1).strip():
            return match.group(1).strip()
    except Exception:
        pass

    try:
        from gi.repository import Gio
        info = Gio.DesktopAppInfo.new_from_filename(path)
        if info is not None:
            return info.get_display_name() or info.get_name() or os.path.basename(path)
    except Exception:
        pass
    return os.path.basename(path)


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


def sort_order_list_rows(rows, folder_sort="mixed"):
    return sorted(rows or [], key=lambda row: _order_row_sort_key(row, folder_sort))


def resort_settings_order_list(settings, folder_sort="mixed"):
    if not settings.has_key(DATA_KEY):
        return False

    try:
        rows = settings.get_value(DATA_KEY) or []
    except Exception:
        rows = []

    if not rows:
        return False

    sorted_rows = sort_order_list_rows(rows, folder_sort)
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
        elif name.endswith(".desktop") and os.path.isfile(full):
            item_id = "app:" + name
            items.append({
                "id": item_id,
                "type": "app",
                "name": _desktop_display_name(full),
                "enabled": item_id not in disabled,
            })
        elif os.path.isfile(full):
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

    target_path = os.path.realpath(target_path)
    # Allow any folder under the shared base (Browse may switch sibling
    # instance directories). Instance "Home" is still the configured subdirectory.
    base = resolve_shared_base(settings)
    if target_path != base and not target_path.startswith(base + os.sep):
        return False

    root = os.path.realpath(resolve_root_path(settings))
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

    # Always notify Configure listeners — JsonSettingsHandler.set_value skips
    # callbacks when the value compares equal, which left the Items list stale
    # after Refresh (and sometimes after Add).
    force_set_order_list(settings, rows)
    _set_setting(settings, "order-folder-path", target_path)
    _set_setting(settings, "order-breadcrumb-display", label)
    _set_setting(settings, "order-in-subfolder", in_subfolder)
    _set_setting(settings, "order-open-folder-id", "")
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
