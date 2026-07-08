#!/usr/bin/python3

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gio, GLib
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


UUID = "thelauncher@sin-apps.com"


def _load_order_folder_editor():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orderFolderEditor.py")
    spec = importlib.util.spec_from_file_location("thelauncher_order_folder_editor", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_EDITOR = _load_order_folder_editor()
resolve_root_path = _EDITOR.resolve_root_path


def _get_proxy():
    try:
        return Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            None,
            "org.Cinnamon",
            "/org/Cinnamon",
            "org.Cinnamon",
            None)
    except Exception:
        return None


class CreateLinkDirectoryButton(SettingsWidget):
    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.settings = settings
        self.instance_id = str(getattr(settings, "instance_id", ""))
        self.callback_name = str(info.get("callback", "on_create_link_directory_callback"))

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)

        label = Gtk.Label(
            label=_("Creates the link subdirectory under the shared base directory if it does not exist yet, then loads .thelauncher.json for this instance.")
        )
        label.set_line_wrap(True)
        label.set_xalign(0)
        label.set_halign(Gtk.Align.FILL)
        box.pack_start(label, False, False, 0)

        self.button = Gtk.Button(label=_("Create link directory"))
        tooltip = info.get("tooltip")
        if tooltip:
            self.button.set_tooltip_text(tooltip)
        self.button.set_sensitive(False)
        self.button.connect("clicked", self.on_clicked)
        box.pack_start(self.button, False, False, 0)

        self.pack_start(box, False, False, 0)

        for setting_key in ("base-directory", "subdirectory", "order-folder-path"):
            if settings.has_key(setting_key):
                settings.listen(setting_key, self.on_storage_setting_changed)

        self.on_storage_setting_changed(None, None)

    def _target_path(self):
        try:
            return resolve_root_path(self.settings)
        except Exception:
            return ""

    def on_storage_setting_changed(self, key, value):
        path = self._target_path()
        exists = bool(path and os.path.isdir(path))
        self.button.set_sensitive(bool(path) and not exists)

    def on_clicked(self, *args):
        if not self.button.get_sensitive():
            return

        proxy = _get_proxy()
        if proxy is None:
            return

        proxy.call_sync(
            "activateCallback",
            GLib.Variant("(sss)", (self.callback_name, UUID, self.instance_id)),
            Gio.DBusCallFlags.NONE,
            -1,
            None)

        GLib.timeout_add(300, self._refresh_sensitivity)

    def _refresh_sensitivity(self):
        self.on_storage_setting_changed(None, None)
        return GLib.SOURCE_REMOVE
