#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os
import sys

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


_EDITOR = _load_module("orderFolderEditor.py")
navigate_home = _EDITOR.navigate_home

def _confirm_reload(settings, widget):
    """P31: vor "Zurueck zum Anfang" offene Listenaenderungen nicht verwerfen."""
    import sys as _sys
    pending = _sys.modules.get("avincelaunch_orderListPending")
    if pending is not None:
        pending.flush_order_list_now(str(getattr(settings, "instance_id", "")))
    parent = widget.get_toplevel()
    return _EDITOR.confirm_unapplied_changes(
        settings, parent if isinstance(parent, Gtk.Window) else None)


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
        if not _confirm_reload(self.settings, self):
            return

        navigate_home(self.settings)
