#!/usr/bin/python3

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os
import sys

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


BREADCRUMB_KEY = "order-breadcrumb-display"


def _load_order_folder_editor():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orderFolderEditor.py")
    spec = importlib.util.spec_from_file_location("thelauncher_order_folder_editor", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


_EDITOR = _load_order_folder_editor()
navigate_home = _EDITOR.navigate_home
apply_bar_button_width = _load_module("itemsBarButtons.py").apply_bar_button_width


class OrderFolderHeader(SettingsWidget):
    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.settings = settings

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
        row.set_margin_bottom(4)
        row.set_hexpand(True)

        left = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        left.set_halign(Gtk.Align.START)

        label = Gtk.Label(label=_("Current Folder"))
        label.set_halign(Gtk.Align.START)
        label.set_xalign(0)
        left.pack_start(label, False, False, 0)

        self.entry = Gtk.Entry()
        self.entry.set_editable(False)
        self.entry.set_width_chars(24)
        self.entry.set_halign(Gtk.Align.START)
        self.entry.set_tooltip_text(_("Updated automatically when you open folders or return home."))
        left.pack_start(self.entry, False, False, 0)

        row.pack_start(left, False, False, 0)

        self.home_button = Gtk.Button(label=_("Back to home"))
        self.home_button.set_sensitive(False)
        self.home_button.set_halign(Gtk.Align.END)
        self.home_button.set_tooltip_text(_("Return to the desklet root link folder."))
        self.home_button.connect("clicked", self.on_home_clicked)
        apply_bar_button_width(self.home_button)
        row.pack_end(self.home_button, False, False, 0)

        self.pack_start(row, True, True, 0)

        if settings.has_key(BREADCRUMB_KEY):
            settings.listen(BREADCRUMB_KEY, self.on_breadcrumb_changed)
            self.on_breadcrumb_changed(BREADCRUMB_KEY, settings.get_value(BREADCRUMB_KEY))

        if settings.has_key("order-in-subfolder"):
            settings.listen("order-in-subfolder", self.on_subfolder_changed)
            self.on_subfolder_changed(
                "order-in-subfolder",
                settings.get_value("order-in-subfolder")
            )

    def on_breadcrumb_changed(self, key, value):
        self.entry.set_text(value or "")

    def on_subfolder_changed(self, key, value):
        self.home_button.set_sensitive(bool(value))

    def on_home_clicked(self, *args):
        if not self.home_button.get_sensitive():
            return

        navigate_home(self.settings)
