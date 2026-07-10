#!/usr/bin/python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


def _load_order_folder_editor():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orderFolderEditor.py")
    spec = importlib.util.spec_from_file_location("thelauncher_order_folder_editor", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_EDITOR = _load_order_folder_editor()
navigate_home = _EDITOR.navigate_home


class BackHomeButton(SettingsWidget):
    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.settings = settings

        self.button = Gtk.Button(label=_("Back to home"))
        self.button.set_sensitive(False)
        self.button.connect("clicked", self.on_clicked)
        self.pack_start(self.button, False, False, 0)

        if settings.has_key("order-in-subfolder"):
            settings.listen("order-in-subfolder", self.on_subfolder_changed)
            self.on_subfolder_changed(
                "order-in-subfolder",
                settings.get_value("order-in-subfolder")
            )

    def on_subfolder_changed(self, key, value):
        self.button.set_sensitive(bool(value))

    def on_clicked(self, *args):
        if not self.button.get_sensitive():
            return

        navigate_home(self.settings)
