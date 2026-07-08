#!/usr/bin/python3

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gio, GLib
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os
import sys

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


UUID = "thelauncher@sin-apps.com"

SORT_OPTIONS = (
    (_("Alphabetical (mixed)"), "mixed"),
    (_("Folders first"), "folders-first"),
    (_("Folders last"), "folders-last"),
)


def _load_module(name):
    module_name = "thelauncher_" + name.replace(".py", "")
    if module_name in sys.modules:
        return sys.modules[module_name]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_ITEMS_BAR_BUTTONS = _load_module("itemsBarButtons.py")
apply_bar_button_width = _ITEMS_BAR_BUTTONS.apply_bar_button_width
_EDITOR = _load_module("orderFolderEditor.py")
resort_settings_order_list = _EDITOR.resort_settings_order_list


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


class ItemsActionBar(SettingsWidget):
    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.settings = settings
        self.instance_id = str(getattr(settings, "instance_id", ""))

        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        bar.set_margin_top(4)
        bar.set_margin_bottom(4)
        bar.set_hexpand(True)

        refresh_button = Gtk.Button(label=_("Refresh"))
        refresh_button.set_tooltip_text(_("Reload the list from the current link folder."))
        refresh_button.set_halign(Gtk.Align.START)
        refresh_button.connect("clicked", self.on_refresh_clicked)
        apply_bar_button_width(refresh_button)
        bar.pack_start(refresh_button, False, False, 0)

        center = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
        center.set_hexpand(True)

        left_spacer = Gtk.Box()
        center.pack_start(left_spacer, True, True, 0)

        resort_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        resort_box.set_halign(Gtk.Align.CENTER)

        self.sort_combo = Gtk.ComboBoxText()
        for label, sort_mode in SORT_OPTIONS:
            self.sort_combo.append(sort_mode, label)
        self.sort_combo.set_active_id("mixed")
        self.sort_combo.set_tooltip_text(
            _("Reorder the list using the same options as Automatic folder sort.")
        )
        resort_box.pack_start(self.sort_combo, False, False, 0)

        self.resort_apply_button = Gtk.Button()
        resort_icon = Gtk.Image.new_from_icon_name("object-select-symbolic", Gtk.IconSize.BUTTON)
        self.resort_apply_button.add(resort_icon)
        self.resort_apply_button.set_tooltip_text(_("Apply selected resort order"))
        self.resort_apply_button.connect("clicked", self.on_resort_apply_clicked)
        resort_box.pack_start(self.resort_apply_button, False, False, 0)

        center.pack_start(resort_box, False, False, 0)

        right_spacer = Gtk.Box()
        center.pack_start(right_spacer, True, True, 0)

        bar.pack_start(center, True, True, 0)

        apply_button = Gtk.Button(label=_("Apply"))
        apply_button.set_tooltip_text(
            _("Save order, enabled state, and folder styles to .thelauncher.json and update the desklet.")
        )
        apply_button.set_halign(Gtk.Align.END)
        apply_button.connect("clicked", self.on_apply_clicked)
        apply_bar_button_width(apply_button)
        bar.pack_end(apply_button, False, False, 0)

        self.pack_start(bar, True, True, 0)

    def _notify_desklet(self, callback_name):
        proxy = _get_proxy()
        if proxy is None:
            return

        proxy.call_sync(
            "activateCallback",
            GLib.Variant("(sss)", (callback_name, UUID, self.instance_id)),
            Gio.DBusCallFlags.NONE,
            -1,
            None)

    def on_refresh_clicked(self, *args):
        browse_path = _EDITOR.get_browse_path(self.settings)
        if not browse_path:
            return
        _EDITOR.navigate_to_path(self.settings, browse_path)

    def on_resort_apply_clicked(self, *args):
        sort_mode = self.sort_combo.get_active_id() or "mixed"
        resort_settings_order_list(self.settings, sort_mode)

    def on_apply_clicked(self, *args):
        self._notify_desklet("on_apply_order_callback")
