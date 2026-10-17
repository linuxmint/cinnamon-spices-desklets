#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, Gio, GLib
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


UUID = "avincelaunch-desklet@avince"
# AP18-1b: setzt das Desklet, wenn sich der Ordner geaendert hat, die Liste
# hier aber noch nicht uebernommene Aenderungen traegt (dann wird sie nicht
# still ersetzt). "Uebernehmen" leuchtet dann im Akzentgruen: es speichert
# die Reihenfolge, danach ergaenzt der Fence die neuen Eintraege von selbst.
# "Aktualisieren" wuerde die offenen Aenderungen verwerfen.
# Hinweiszeile wie der Knopf auf Akzentgruen (Pruefung Phase 2, P69: dunkles
# Gruen als Schrift war auf dunklem Thema kaum lesbar).
STALE_KEY = "order-list-stale"
_STALE_CSS = b"""
button.avincelaunch-stale {
    background-image: none;
    background-color: #A8F348;
    color: #141C22;
    font-weight: bold;
}
label.avincelaunch-stale-hint {
    background-color: #A8F348;
    color: #141C22;
    font-weight: bold;
    padding: 2px 6px;
    border-radius: 3px;
}
"""
_css_installed = False


def _install_stale_css():
    global _css_installed
    if _css_installed:
        return
    provider = Gtk.CssProvider()
    provider.load_from_data(_STALE_CSS)
    Gtk.StyleContext.add_provider_for_screen(
        Gdk.Screen.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    _css_installed = True

SORT_OPTIONS = (
    (_("Alphabetical (mixed)"), "mixed"),
    (_("Folders first"), "folders-first"),
    (_("Folders last"), "folders-last"),
    # AP18-3: dieselben Arten wie die Sortierung im Fence.
    (_("Name Z–A"), "name-desc"),
    (_("Type (folders, programs, documents)"), "type"),
    (_("Date modified (newest first)"), "modified"),
    (_("Recently added (newest first)"), "added"),
)


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


_ITEMS_BAR_BUTTONS = _load_module("itemsBarButtons.py")
apply_bar_button_width = _ITEMS_BAR_BUTTONS.apply_bar_button_width
_EDITOR = _load_module("orderFolderEditor.py")
_PENDING = _load_module("orderListPending.py")
resort_settings_order_list = _EDITOR.resort_settings_order_list




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
        self.refresh_button = refresh_button

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
            _("Reorder the list once. Choose an option, click the check mark, then Apply.")
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
            _("Save order, enabled state, and folder styles to .avincelaunch.json and update the desklet.")
        )
        apply_button.set_halign(Gtk.Align.END)
        apply_button.connect("clicked", self.on_apply_clicked)
        apply_bar_button_width(apply_button)
        bar.pack_end(apply_button, False, False, 0)
        self.apply_button = apply_button

        _install_stale_css()
        self.stale_hint = Gtk.Label(
            label=_("The folder has changed. “Apply” saves your changes and adds the new items (“Refresh” would discard your changes)."))
        self.stale_hint.set_halign(Gtk.Align.START)
        self.stale_hint.set_line_wrap(True)
        self.stale_hint.get_style_context().add_class("avincelaunch-stale-hint")
        self.stale_hint.set_no_show_all(True)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        outer.set_hexpand(True)
        outer.pack_start(self.stale_hint, False, False, 0)
        outer.pack_start(bar, True, True, 0)
        self.pack_start(outer, True, True, 0)

        if self.settings.has_key(STALE_KEY):
            self.settings.listen(STALE_KEY, self._on_stale_changed)
            self._show_stale(self._get_stale())

    def _get_stale(self):
        try:
            return bool(self.settings.get_value(STALE_KEY))
        except Exception:
            return False

    def _on_stale_changed(self, key, value):
        self._show_stale(bool(value))

    def _show_stale(self, stale):
        context = self.apply_button.get_style_context()
        if stale:
            context.add_class("avincelaunch-stale")
            self.stale_hint.show()
        else:
            context.remove_class("avincelaunch-stale")
            self.stale_hint.hide()

    def _clear_stale(self):
        self._show_stale(False)
        if self.settings.has_key(STALE_KEY) and self._get_stale():
            _EDITOR.set_value_safe(self.settings, STALE_KEY, False)

    def _notify_desklet(self, callback_name):
        # P59: gemeinsame Meldung mit Fehlerbehandlung (orderFolderEditor).
        return _EDITOR.notify_desklet(self.settings, callback_name)

    def on_refresh_clicked(self, *args):
        _PENDING.flush_order_list_now(self.instance_id)
        browse_path = _EDITOR.get_browse_path(self.settings)
        if not browse_path:
            return
        # P31: Aktualisieren verwirft offene Aenderungen - vorher fragen.
        parent = self.get_toplevel()
        if not _EDITOR.confirm_unapplied_changes(
                self.settings, parent if isinstance(parent, Gtk.Window) else None):
            return
        # Rescan directory + .avincelaunch.json into settings, then notify desklet.
        _EDITOR.navigate_to_path(self.settings, browse_path)
        self._clear_stale()
        self._notify_desklet("on_items_changed_callback")

    def on_resort_apply_clicked(self, *args):
        _PENDING.flush_order_list_now(self.instance_id)
        sort_mode = self.sort_combo.get_active_id() or "mixed"
        resort_settings_order_list(self.settings, sort_mode)

    def on_apply_clicked(self, *args):
        # Persist any pending Up/Down / toggle edits before the desklet reads them.
        _PENDING.flush_order_list_now(self.instance_id)
        self._clear_stale()
        self._notify_desklet("on_apply_order_callback")
