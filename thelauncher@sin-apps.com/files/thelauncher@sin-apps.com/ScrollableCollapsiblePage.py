#!/usr/bin/python3

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk
from xapp.SettingsWidgets import SettingsPage
import importlib.util
import os


def _load_page_builder():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "settingsPageBuilder.py")
    spec = importlib.util.spec_from_file_location("thelauncher_settings_page_builder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ScrollableCollapsiblePage(SettingsPage):
    def __init__(self, page_def, settings):
        Gtk.Box.__init__(self)
        self.set_orientation(Gtk.Orientation.VERTICAL)
        self.set_spacing(0)
        self.set_margin_left(0)
        self.set_margin_right(0)
        self.set_margin_top(0)
        self.set_margin_bottom(0)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.set_kinetic_scrolling(True)
        self.pack_start(scroll, True, True, 0)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        content.set_margin_left(60)
        content.set_margin_right(60)
        content.set_margin_top(12)
        content.set_margin_bottom(24)
        scroll.add(content)

        builder = _load_page_builder()
        builder.populate_page(
            content,
            page_def,
            settings,
            os.path.dirname(os.path.abspath(__file__))
        )
