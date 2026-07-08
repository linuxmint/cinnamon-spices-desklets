import os
import re
import shutil

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


def _is_launchable_desktop(path):
    try:
        from gi.repository import Gio
        info = Gio.DesktopAppInfo.new_from_filename(path)
        if info is not None and info.should_show():
            return True
    except Exception:
        pass

    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            return re.search(r"^\s*Exec\s*=", handle.read(), re.MULTILINE) is not None
    except Exception:
        return False


def _unique_destination_path(dest_dir, base_name):
    candidate = os.path.join(dest_dir, base_name)
    if not os.path.exists(candidate):
        return candidate

    stem = base_name
    suffix = ""
    if base_name.endswith(".desktop"):
        stem = base_name[:-8]
        suffix = ".desktop"

    for index in range(1, 1000):
        candidate = os.path.join(dest_dir, f"{stem}-{index}{suffix}")
        if not os.path.exists(candidate):
            return candidate

    raise RuntimeError(_("Could not find a unique destination name for %s") % base_name)


def read_desktop_link(path):
    defaults = {
        "name": "",
        "command": "",
        "icon": "utilities-terminal",
        "terminal": False,
    }
    if not path or not os.path.isfile(path):
        return defaults

    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if key == "Name":
                    defaults["name"] = value
                elif key == "Exec":
                    defaults["command"] = value
                elif key == "Icon":
                    defaults["icon"] = value
                elif key == "Terminal":
                    defaults["terminal"] = value.lower() == "true"
    except Exception:
        pass

    return defaults


def update_desktop_link(path, name, command, icon="", terminal=True):
    if not path or not name or not command:
        return {"ok": False, "error": _("Name and command are required.")}

    if not os.path.isfile(path):
        return {"ok": False, "error": _("Launcher file not found.")}

    icon_value = icon.strip() or "utilities-terminal"
    terminal_value = "true" if terminal else "false"
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        "Name=%s" % name.strip(),
        "Exec=%s" % command.strip(),
        "Icon=%s" % icon_value,
        "Terminal=%s" % terminal_value,
        "NoDisplay=false",
    ]

    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
        os.chmod(path, 0o755)
        return {"ok": True, "path": path, "type": "app"}
    except Exception:
        return {"ok": False, "error": _("Could not update launcher file.")}


def create_desktop_link(dest_dir, name, command, icon="", terminal=True):
    if not dest_dir or not name or not command:
        return {"ok": False, "error": _("Name and command are required.")}

    if not os.path.isdir(dest_dir):
        return {"ok": False, "error": _("Link directory not found.")}

    safe_stem = re.sub(r"[^\w\-]+", "-", name.strip()).strip("-") or "launcher"
    base_name = safe_stem + ".desktop"
    try:
        dest_path = _unique_destination_path(dest_dir, base_name)
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}

    icon_value = icon.strip() or "utilities-terminal"
    terminal_value = "true" if terminal else "false"
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        "Name=%s" % name.strip(),
        "Exec=%s" % command.strip(),
        "Icon=%s" % icon_value,
        "Terminal=%s" % terminal_value,
        "NoDisplay=false",
    ]

    try:
        with open(dest_path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
        os.chmod(dest_path, 0o755)
        return {"ok": True, "path": dest_path, "type": "app"}
    except Exception:
        return {"ok": False, "error": _("Could not create launcher file.")}


def import_path_into_directory(source_path, dest_dir):
    if not source_path or not dest_dir:
        return {"ok": False, "error": _("Invalid path.")}

    if not os.path.isdir(dest_dir):
        return {"ok": False, "error": _("Link directory not found.")}

    source_path = os.path.abspath(source_path)
    if not os.path.exists(source_path):
        return {"ok": False, "error": _("File not found.")}

    base_name = os.path.basename(source_path)
    if base_name.startswith("."):
        return {"ok": False, "error": _("Hidden files are not supported.")}

    try:
        dest_path = _unique_destination_path(dest_dir, base_name)
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}

    if os.path.isdir(source_path):
        try:
            shutil.copytree(source_path, dest_path)
            return {"ok": True, "path": dest_path, "type": "folder"}
        except Exception:
            return {"ok": False, "error": _("Could not copy folder.")}

    if source_path.endswith(".desktop"):
        if not _is_launchable_desktop(source_path):
            return {"ok": False, "error": _("Not a launchable .desktop file.")}

        try:
            shutil.copy2(source_path, dest_path)
            return {"ok": True, "path": dest_path, "type": "app"}
        except Exception:
            return {"ok": False, "error": _("Could not copy .desktop file.")}

    try:
        shutil.copy2(source_path, dest_path)
        return {"ok": True, "path": dest_path, "type": "document"}
    except Exception:
        return {"ok": False, "error": _("Could not copy file.")}


def trash_path(path):
    if not path or not os.path.exists(path):
        return {"ok": False, "error": _("Item not found.")}

    try:
        from gi.repository import Gio
        Gio.File.new_for_path(path).trash(None)
        return {"ok": True}
    except Exception:
        return {"ok": False, "error": _("Could not remove item.")}
