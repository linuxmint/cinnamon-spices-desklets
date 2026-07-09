import importlib.util
import json
import os

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

UUID = "thelauncher@sin-apps.com"

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


def _schema_path(desklet_dir):
    return os.path.join(desklet_dir, "settings-schema.json")


def load_schema(desklet_dir):
    with open(_schema_path(desklet_dir), "r", encoding="utf-8") as handle:
        return json.load(handle)


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


class DeskletCallbackButton(Button):
    def __init__(self, info, instance_id):
        super().__init__(info["description"])
        self.instance_id = str(instance_id)
        self.callback_name = str(info["callback"])

    def on_activated(self, *args):
        proxy = _get_proxy()
        if proxy is None:
            return

        proxy.call_sync(
            "activateCallback",
            GLib.Variant("(sss)", (self.callback_name, UUID, self.instance_id)),
            Gio.DBusCallFlags.NONE,
            -1,
            None)


def _load_custom_widget(info, key, settings, desklet_dir):
    file_name = info["file"]
    widget_name = info["widget"]
    file_path = os.path.join(desklet_dir, file_name)

    if file_name not in _custom_modules:
        spec = importlib.util.spec_from_file_location(
            "thelauncher." + file_name.replace(".py", ""),
            file_path
        )
        module = importlib.util.module_from_spec(spec)
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

        title = section_def.get("title", section_key)
        expander, rows = _create_collapsible_section(title, content_box)
        expanders.append(expander)

        for key in section_def.get("keys", []):
            item = schema.get(key)
            if not item:
                continue

            widget = build_widget(key, item, settings, desklet_dir)
            if widget is None:
                continue

            _add_row(rows, widget, settings, item)

    if len(expanders) == 1:
        expanders[0].set_expanded(True)
    elif len(expanders) > 1:
        _wire_accordion_expanders(expanders)
