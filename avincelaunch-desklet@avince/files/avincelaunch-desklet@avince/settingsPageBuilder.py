# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

import importlib.util
import copy
import gettext as _gettext
import json
import os
import sys

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gio, GLib

from JsonSettingsWidgets import (
    JSONSettingsColorChooser,
    JSONSettingsComboBox,
    JSONSettingsDateChooser,
    JSONSettingsEntry,
    JSONSettingsFileChooser,
    JSONSettingsFontButton,
    JSONSettingsIconChooser,
    JSONSettingsKeybinding,
    JSONSettingsList,
    JSONSettingsRange,
    JSONSettingsRevealer,
    JSONSettingsSoundFileChooser,
    JSONSettingsSpinButton,
    JSONSettingsSwitch,
    JSONSettingsTextView,
    JSONSettingsTimeChooser,
    Text,
)
from xapp.SettingsWidgets import Button

UUID = "avincelaunch-desklet@avince"

JSON_WIDGETS = {
    "entry": JSONSettingsEntry,
    "textview": JSONSettingsTextView,
    "checkbox": JSONSettingsSwitch,
    "switch": JSONSettingsSwitch,
    "spinbutton": JSONSettingsSpinButton,
    "filechooser": JSONSettingsFileChooser,
    "scale": JSONSettingsRange,
    "radiogroup": JSONSettingsComboBox,
    "combobox": JSONSettingsComboBox,
    "colorchooser": JSONSettingsColorChooser,
    "fontchooser": JSONSettingsFontButton,
    "soundfilechooser": JSONSettingsSoundFileChooser,
    "iconfilechooser": JSONSettingsIconChooser,
    "datechooser": JSONSettingsDateChooser,
    "timechooser": JSONSettingsTimeChooser,
    "keybinding": JSONSettingsKeybinding,
    "list": JSONSettingsList,
}

_custom_modules = {}


# Uebersetzung (AP09c). Diese Seiten bauen Abschnitte und Einstellungen
# selbst aus settings-schema.json - an Cinnamons Uebersetzung im
# Einstellungsdialog (xlet-settings.py) vorbei. Deshalb hier selbst
# uebersetzen, mit derselben Domaene und denselben Regeln.
_DOMAIN = "avincelaunch-desklet@avince"
_gettext.bindtextdomain(_DOMAIN, os.path.join(os.path.expanduser("~"), ".local/share/locale"))
# Katalog einmal laden: dgettext sucht ihn bei jedem Text neu (Dateisystem-
# Abfragen) - beim Oeffnen des Dialogs ~1700 Aufrufe, 0,4 s (AP17-2).
_CATALOG = _gettext.translation(
    _DOMAIN, os.path.join(os.path.expanduser("~"), ".local/share/locale"), fallback=True)


def _(text):
    if not isinstance(text, str) or not text.strip():
        return text
    return _CATALOG.gettext(text)


# Optionen mit dem Wert "custom" nimmt cinnamon-xlet-makepot nicht in die
# Vorlage auf - hier ausdruecklich nennen, damit sie uebersetzt werden.
_EXTRA_LABELS = (_("Custom"),)


def _translated_item(item):
    """Kopie eines Schema-Eintrags mit uebersetzten Texten:
    Beschreibung, Tooltip, Einheit, Optionen, Spaltentitel.

    Anders als xlet-settings.py:310 bleiben Optionen mit dem Wert
    "custom" stehen - bei uns ist das der Farbmodus "Eigene". Ohne ihn
    ueberschreibt die Vorlage jede eigene Farbe und Transparenz
    (Befund 02.10.)."""
    result = copy.deepcopy(item)
    for field in ("description", "tooltip", "units"):
        if field in result:
            result[field] = _(result[field])
    options = result.get("options")
    if isinstance(options, dict):
        result["options"] = {_(label): value for label, value in options.items()}
    columns = result.get("columns")
    if isinstance(columns, list):
        for column in columns:
            if isinstance(column, dict) and "title" in column:
                column["title"] = _(column["title"])
    return result


def _schema_path(desklet_dir):
    return os.path.join(desklet_dir, "settings-schema.json")


_schema_cache = {}


def load_schema(desklet_dir):
    if desklet_dir in _schema_cache:
        return _schema_cache[desklet_dir]
    _schema_cache[desklet_dir] = _load_schema_file(desklet_dir)
    return _schema_cache[desklet_dir]


def _load_schema_file(desklet_dir):
    with open(_schema_path(desklet_dir), "r", encoding="utf-8") as handle:
        return json.load(handle)




class DeskletCallbackButton(Button):
    def __init__(self, info, instance_id):
        super().__init__(info["description"])
        self.instance_id = str(instance_id)
        self.callback_name = str(info["callback"])

    def on_activated(self, *args):
        # P59: gemeinsame Meldung mit Fehlerbehandlung (orderFolderEditor).
        _load_editor().notify_desklet(self.instance_id, self.callback_name)


def _load_editor():
    module = sys.modules.get("avincelaunch_orderFolderEditor")
    if module is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orderFolderEditor.py")
        spec = importlib.util.spec_from_file_location("avincelaunch_orderFolderEditor", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["avincelaunch_orderFolderEditor"] = module
        spec.loader.exec_module(module)
    return module


def _load_custom_widget(info, key, settings, desklet_dir):
    file_name = info["file"]
    widget_name = info["widget"]
    file_path = os.path.join(desklet_dir, file_name)

    # P60: einmal je Dialog unter demselben Namen wie in den Bausteinen
    # selbst (avincelaunch_<Datei>) - frueher je Seite neu.
    module_name = "avincelaunch_" + file_name.replace(".py", "")
    if file_name not in _custom_modules:
        module = sys.modules.get(module_name)
        if module is None:
            spec = importlib.util.spec_from_file_location(module_name, file_path)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
        _custom_modules[file_name] = module

    return getattr(_custom_modules[file_name], widget_name)(info, key, settings)


def build_widget(key, item, settings, desklet_dir):
    settings_type = item.get("type")
    if settings_type == "label":
        return Text(item.get("description", ""))
    if settings_type == "button":
        return DeskletCallbackButton(item, getattr(settings, "instance_id", ""))
    if settings_type == "custom":
        return _load_custom_widget(item, key, settings, desklet_dir)
    if settings_type in JSON_WIDGETS:
        widget_class = JSON_WIDGETS[settings_type]
        return widget_class(key, settings, item)
    return None


def _add_row(container, widget, settings, item):
    wrapper = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)

    if "dependency" in item:
        revealer = JSONSettingsRevealer(settings, item["dependency"])
        row_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        row_box.pack_start(widget, False, False, 0)
        revealer.add(row_box)
        wrapper.pack_start(revealer, False, False, 0)
    else:
        wrapper.pack_start(widget, False, False, 0)

    container.pack_start(wrapper, False, False, 0)


def _create_collapsible_section(title, parent_box, expanded=False):
    expander = Gtk.Expander()
    expander.set_label(title)
    expander.set_expanded(expanded)

    section_outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
    frame = Gtk.Frame()
    frame.set_shadow_type(Gtk.ShadowType.IN)
    frame.get_style_context().add_class("view")

    rows = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
    rows.set_margin_top(4)
    rows.set_margin_bottom(4)
    frame.add(rows)
    section_outer.pack_start(frame, False, False, 0)
    expander.add(section_outer)
    parent_box.pack_start(expander, False, False, 0)

    return expander, rows


def _wire_accordion_expanders(expanders):
    if len(expanders) <= 1:
        return

    def on_expanded_changed(expander, _param):
        if not expander.get_expanded():
            return

        for other in expanders:
            if other is not expander:
                other.set_expanded(False)

    for expander in expanders:
        expander.connect("notify::expanded", on_expanded_changed)


def populate_page(content_box, page_def, settings, desklet_dir):
    schema = load_schema(desklet_dir)
    layout = schema.get("layout", {})
    expanders = []

    for section_key in page_def.get("sections", []):
        section_def = layout.get(section_key)
        if not section_def:
            continue

        title = _(section_def.get("title", section_key))
        expander, rows = _create_collapsible_section(title, content_box)
        expanders.append(expander)

        for key in section_def.get("keys", []):
            item = schema.get(key)
            if not item:
                continue
            item = _translated_item(item)

            widget = build_widget(key, item, settings, desklet_dir)
            if widget is None:
                continue

            _add_row(rows, widget, settings, item)

    if len(expanders) == 1:
        expanders[0].set_expanded(True)
    elif len(expanders) > 1:
        _wire_accordion_expanders(expanders)
