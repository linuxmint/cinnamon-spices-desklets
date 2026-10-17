#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk
from xapp.SettingsWidgets import SettingsPage
import importlib.util
import os
import sys


def _load_module(name):
    # Pruefung Phase 2, P60: jede Datei EINMAL je Dialog, unter einem Namen
    # (avincelaunch_<Datei>) - frueher teils doppelt (zwei Namen, je Seite neu).
    module_name = "avincelaunch_" + name.replace(".py", "")
    module = sys.modules.get(module_name)
    if module is not None:
        return module
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
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

        # Erst aufbauen, wenn die Seite zum ersten Mal sichtbar wird: Cinnamons
        # Dialog legt die Seiten ALLER Fences an (9 Fences x 5 Seiten), gezeigt
        # wird nur eine. Sofortiger Aufbau kostete ~1,8 s beim Oeffnen (AP17-2).
        self._content = content
        self._page_def = page_def
        self._settings = settings
        self._built = False
        # Pruefung Phase 2, P12: Abgleich vor jedem Speichern - hier, bevor
        # auf einer Seite dieses Fence etwas angeklickt werden kann.
        try:
            _load_module("settingsMerge.py").install(settings)
        except Exception as error:
            print("aVinceLaunch: list sync not set up: %s" % error, file=sys.stderr)
        self.connect("map", self._on_first_map)

    def _on_first_map(self, *_args):
        if self._built:
            return
        self._built = True
        builder = _load_module("settingsPageBuilder.py")
        builder.populate_page(
            self._content,
            self._page_def,
            self._settings,
            os.path.dirname(os.path.abspath(__file__))
        )
        self._content.show_all()
