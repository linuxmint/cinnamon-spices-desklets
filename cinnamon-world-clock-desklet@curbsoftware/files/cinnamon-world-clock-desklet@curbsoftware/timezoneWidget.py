#!/usr/bin/python3
"""Filterable timezone widgets for the World Clock desklet settings."""

import os
import uuid as uuidlib

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib

from xapp.SettingsWidgets import SettingsWidget, SettingsLabel

FALLBACK_ZONES = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "America/Honolulu",
    "America/Toronto",
    "America/Mexico_City",
    "America/Sao_Paulo",
    "America/Argentina/Buenos_Aires",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/Moscow",
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Sydney",
    "Pacific/Auckland",
]

MIN_CLOCKS = 1
MAX_CLOCKS = 36
LOCAL_ID = "local"


def _display_name(tz):
    if not tz or tz == LOCAL_ID:
        return "Local"
    parts = str(tz).split("/")
    return parts[-1].replace("_", " ")


def timezone_label(tz, empty_label="Local (system timezone)"):
    if not tz or tz == LOCAL_ID:
        return empty_label
    pretty = _display_name(tz)
    if pretty == tz:
        return tz
    return "%s (%s)" % (pretty, tz)


def list_iana_timezones():
    zones = []
    try:
        from zoneinfo import available_timezones
        zones = [
            z for z in available_timezones()
            if z and z not in ("localtime",)
            and not z.startswith("SystemV/")
            and not z.startswith("Etc/")
        ]
    except Exception:
        zones = []

    if not zones:
        zone_tab = "/usr/share/zoneinfo/zone.tab"
        if os.path.isfile(zone_tab):
            try:
                with open(zone_tab, "r", encoding="utf-8", errors="replace") as handle:
                    for line in handle:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = line.split("\t")
                        if len(parts) >= 3:
                            zones.append(parts[2])
            except OSError:
                zones = []

    if not zones:
        zones = list(FALLBACK_ZONES)

    seen = set()
    out = []
    for zone in sorted(zones):
        if zone in seen:
            continue
        seen.add(zone)
        out.append(zone)
    if "UTC" not in seen:
        out.insert(0, "UTC")
    return out


def filter_timezones(zones, query):
    if not query:
        return list(zones)
    q = query.strip().lower()
    if not q:
        return list(zones)
    hits = []
    for tz in zones:
        blob = " ".join([
            str(tz),
            str(tz).replace("_", " "),
            _display_name(tz),
            timezone_label(tz),
        ]).lower()
        if q in blob:
            hits.append(tz)
    return hits


def _normalize_tz(tz, empty_value=LOCAL_ID):
    if tz is None:
        return empty_value
    value = str(tz).strip()
    if not value or value.lower() == "local":
        return empty_value
    return value


class _TimezonePicker(Gtk.Box):
    """Standalone searchable timezone list used by chooser and clock editor."""

    def __init__(self, empty_value=LOCAL_ID, empty_label="Local (system timezone)"):
        super(_TimezonePicker, self).__init__(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.empty_value = empty_value
        self.empty_label = empty_label
        self._zones = [empty_value] + list_iana_timezones()
        self._updating = False
        self.timezone = empty_value

        self.search = Gtk.SearchEntry()
        self.search.set_placeholder_text("Search city or region")
        self.search.connect("search-changed", self._on_query_changed)
        self.search.connect("activate", self._on_search_activate)
        self.pack_start(self.search, False, False, 0)

        self.store = Gtk.ListStore(str, str)
        self.tree = Gtk.TreeView(model=self.store)
        self.tree.set_headers_visible(False)
        self.tree.set_search_column(-1)
        renderer = Gtk.CellRendererText()
        column = Gtk.TreeViewColumn("Timezone", renderer, text=1)
        self.tree.append_column(column)
        self.tree.get_selection().connect("changed", self._on_selection_changed)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        scroll.set_min_content_height(180)
        scroll.set_shadow_type(Gtk.ShadowType.IN)
        scroll.add(self.tree)
        self.pack_start(scroll, True, True, 0)

        self.selected = Gtk.Label(xalign=0)
        self.selected.set_line_wrap(True)
        self.selected.get_style_context().add_class("dim-label")
        self.pack_start(self.selected, False, False, 0)

        self._rebuild_list("")
        self.set_timezone(empty_value, notify=False)

    def _visible_zones(self, query):
        rest = [z for z in self._zones if z != self.empty_value]
        return [self.empty_value] + filter_timezones(rest, query)

    def _rebuild_list(self, query):
        self._updating = True
        try:
            self.store.clear()
            for tz in self._visible_zones(query):
                self.store.append([tz, timezone_label(tz, self.empty_label)])
        finally:
            self._updating = False

    def _on_query_changed(self, *args):
        current = self.timezone
        self._rebuild_list(self.search.get_text())
        self.set_timezone(current, notify=False)

    def _on_search_activate(self, *args):
        if len(self.store) > 0:
            tz = self.store[0][0]
            self.set_timezone(tz, notify=True)

    def _on_selection_changed(self, selection):
        if self._updating:
            return
        model, row = selection.get_selected()
        if row is None:
            return
        self.set_timezone(model[row][0], notify=True)

    def set_timezone(self, tz, notify=True):
        tz = _normalize_tz(tz, self.empty_value)
        self.timezone = tz
        self._updating = True
        try:
            found = False
            for i, row in enumerate(self.store):
                if row[0] == tz:
                    self.tree.get_selection().select_iter(row.iter)
                    self.tree.scroll_to_cell(Gtk.TreePath.new_from_indices([i]))
                    found = True
                    break
            if not found:
                self.store.prepend([tz, timezone_label(tz, self.empty_label)])
                self.tree.get_selection().select_iter(self.store.get_iter_first())
        finally:
            self._updating = False
        self.selected.set_text("Selected: %s" % timezone_label(tz, self.empty_label))



class TimezoneChooser(SettingsWidget):
    bind_dir = None

    def __init__(self, info, key, settings):
        super(TimezoneChooser, self).__init__()
        self.set_orientation(Gtk.Orientation.VERTICAL)
        self.set_spacing(8)
        self.fill_row()

        self.settings = settings
        self.key = key
        self._saving = False
        empty_value = info.get("empty-value", LOCAL_ID)
        empty_label = info.get("empty-label", "Local (system timezone)")

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.label = SettingsLabel(info.get("description", "Timezone"))
        header.pack_start(self.label, False, False, 0)
        self.pack_start(header, False, False, 0)

        self.picker = _TimezonePicker(empty_value=empty_value, empty_label=empty_label)
        self.picker.search.connect("search-changed", lambda *a: None)
        self.pack_start(self.picker, True, True, 0)

        if info.get("tooltip"):
            self.set_tooltip_text(info["tooltip"])

        self.picker.tree.get_selection().connect("changed", self._on_picked)
        try:
            self.settings.listen(self.key, self._on_setting)
        except Exception:
            pass
        self._load_from_settings()

    def _on_setting(self, *args):
        if self._saving:
            return
        self._load_from_settings()

    def _load_from_settings(self):
        try:
            value = self.settings.get_value(self.key)
        except Exception:
            value = LOCAL_ID
        self.picker.set_timezone(value, notify=False)

    def _on_picked(self, *args):
        tz = self.picker.timezone
        try:
            current = self.settings.get_value(self.key)
        except Exception:
            current = None
        if tz == current:
            return
        self._saving = True
        try:
            self.settings.set_value(self.key, tz)
        finally:
            GLib.idle_add(self._clear_saving)

    def _clear_saving(self):
        self._saving = False
        return False


class ClockListEditor(SettingsWidget):
    """Editable clock list with a filterable timezone search on add/edit."""

    bind_dir = None

    def __init__(self, info, key, settings):
        super(ClockListEditor, self).__init__()
        self.set_orientation(Gtk.Orientation.VERTICAL)
        self.set_spacing(8)
        self.fill_row()

        self.settings = settings
        self.key = key
        self._saving = False

        self.label = SettingsLabel(info.get("description", "Clocks"))
        self.pack_start(self.label, False, False, 0)

        self.store = Gtk.ListStore(str, str, str)
        self.tree = Gtk.TreeView(model=self.store)
        self.tree.set_headers_visible(True)
        self.tree.append_column(Gtk.TreeViewColumn("Name", Gtk.CellRendererText(), text=1))
        self.tree.append_column(Gtk.TreeViewColumn("Timezone", Gtk.CellRendererText(), text=2))
        self.tree.connect("row-activated", lambda *a: self._edit_item())

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        scroll.set_min_content_height(160)
        scroll.set_shadow_type(Gtk.ShadowType.IN)
        scroll.add(self.tree)
        self.pack_start(scroll, True, True, 0)

        buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.add_btn = Gtk.Button.new_with_label("Add")
        self.edit_btn = Gtk.Button.new_with_label("Edit")
        self.remove_btn = Gtk.Button.new_with_label("Remove")
        self.add_btn.connect("clicked", lambda *a: self._add_item())
        self.edit_btn.connect("clicked", lambda *a: self._edit_item())
        self.remove_btn.connect("clicked", lambda *a: self._remove_item())
        buttons.pack_start(self.add_btn, False, False, 0)
        buttons.pack_start(self.edit_btn, False, False, 0)
        buttons.pack_start(self.remove_btn, False, False, 0)
        self.pack_start(buttons, False, False, 0)

        hint = Gtk.Label(xalign=0)
        hint.set_line_wrap(True)
        hint.get_style_context().add_class("dim-label")
        hint.set_text("Add or edit a clock, then search the timezone list by city or region.")
        self.pack_start(hint, False, False, 0)

        if info.get("tooltip"):
            self.set_tooltip_text(info["tooltip"])

        self.tree.get_selection().connect("changed", self._update_buttons)
        try:
            self.settings.listen(self.key, self._on_setting)
        except Exception:
            pass
        self._load_from_settings()
        self._update_buttons()

    def _on_setting(self, *args):
        if self._saving:
            return
        self._load_from_settings()

    def _clocks(self):
        try:
            value = self.settings.get_value(self.key)
        except Exception:
            value = []
        if not isinstance(value, list):
            return []
        clocks = []
        for item in value:
            if not isinstance(item, dict):
                continue
            clocks.append({
                "id": str(item.get("id") or uuidlib.uuid4()),
                "name": str(item.get("name") or "").strip(),
                "timezone": _normalize_tz(item.get("timezone")),
            })
        if not clocks:
            clocks = [{"id": str(uuidlib.uuid4()), "name": "Local", "timezone": LOCAL_ID}]
        return clocks

    def _load_from_settings(self):
        self.store.clear()
        for clock in self._clocks():
            self.store.append([
                clock["id"],
                clock["name"] or _display_name(clock["timezone"]),
                timezone_label(clock["timezone"]),
            ])
        self._update_buttons()

    def _write(self, clocks):
        self._saving = True
        try:
            self.settings.set_value(self.key, clocks)
        finally:
            GLib.idle_add(self._clear_saving)
        self._load_from_settings()

    def _clear_saving(self):
        self._saving = False
        return False

    def _selected_id(self):
        model, row = self.tree.get_selection().get_selected()
        if row is None:
            return None
        return model[row][0]

    def _update_buttons(self, *args):
        n = len(self.store)
        has = self._selected_id() is not None
        self.add_btn.set_sensitive(n < MAX_CLOCKS)
        self.edit_btn.set_sensitive(has)
        self.remove_btn.set_sensitive(has and n > MIN_CLOCKS)

    def _prompt_clock(self, title, initial):
        dialog = Gtk.Dialog(title=title, transient_for=self.get_toplevel())
        dialog.set_modal(True)
        dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL)
        dialog.add_button(Gtk.STOCK_OK, Gtk.ResponseType.OK)
        dialog.set_default_size(420, 420)
        box = dialog.get_content_area()
        box.set_spacing(8)
        box.set_margin_top(12)
        box.set_margin_bottom(12)
        box.set_margin_left(12)
        box.set_margin_right(12)

        name_label = Gtk.Label(label="Name", xalign=0)
        name_entry = Gtk.Entry()
        name_entry.set_placeholder_text("Clock name")
        name_entry.set_text(initial.get("name") or "")
        box.pack_start(name_label, False, False, 0)
        box.pack_start(name_entry, False, False, 0)

        tz_label = Gtk.Label(label="Timezone", xalign=0)
        picker = _TimezonePicker()
        picker.set_timezone(initial.get("timezone") or LOCAL_ID, notify=False)
        box.pack_start(tz_label, False, False, 0)
        box.pack_start(picker, True, True, 0)

        box.show_all()
        response = dialog.run()
        name = name_entry.get_text().strip()
        timezone = picker.timezone
        dialog.destroy()
        if response != Gtk.ResponseType.OK:
            return None
        if not name:
            name = _display_name(timezone)
        return {"name": name, "timezone": timezone}

    def _add_item(self):
        clocks = self._clocks()
        if len(clocks) >= MAX_CLOCKS:
            return
        result = self._prompt_clock("Add Clock", {"name": "", "timezone": LOCAL_ID})
        if not result:
            return
        clocks.append({
            "id": str(uuidlib.uuid4()),
            "name": result["name"],
            "timezone": result["timezone"],
        })
        self._write(clocks)

    def _edit_item(self):
        clock_id = self._selected_id()
        if not clock_id:
            return
        clocks = self._clocks()
        current = None
        for clock in clocks:
            if clock["id"] == clock_id:
                current = clock
                break
        if not current:
            return
        result = self._prompt_clock("Edit Clock", current)
        if not result:
            return
        next_clocks = []
        for clock in clocks:
            if clock["id"] == clock_id:
                next_clocks.append({
                    "id": clock_id,
                    "name": result["name"],
                    "timezone": result["timezone"],
                })
            else:
                next_clocks.append(clock)
        self._write(next_clocks)

    def _remove_item(self):
        clock_id = self._selected_id()
        if not clock_id:
            return
        clocks = [c for c in self._clocks() if c["id"] != clock_id]
        if len(clocks) < MIN_CLOCKS:
            return
        self._write(clocks)
