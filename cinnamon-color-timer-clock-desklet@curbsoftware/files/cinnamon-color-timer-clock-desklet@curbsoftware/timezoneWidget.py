#!/usr/bin/python3
"""Filterable timezone chooser for Color Timer Clock settings.

Cinnamon xlet-settings loads this via settings-schema.json:
    type=custom, file=timezoneWidget.py, widget=TimezoneChooser
"""

import os

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


def _display_name(tz):
    if not tz:
        return "Local"
    parts = str(tz).split("/")
    return parts[-1].replace("_", " ")


def timezone_label(tz, empty_label="Local (system timezone)"):
    if not tz:
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


class TimezoneChooser(SettingsWidget):
    """Searchable timezone list bound to a string settings key.

    Empty string means the desklet should use the system local timezone.
    Extra schema keys:
        empty-label  - row text for the empty/local option
    """

    bind_dir = None

    def __init__(self, info, key, settings):
        super(TimezoneChooser, self).__init__()
        self.set_orientation(Gtk.Orientation.VERTICAL)
        self.set_spacing(8)
        self.fill_row()

        self.settings = settings
        self.key = key
        self._saving = False
        self.empty_label = info.get("empty-label", "Local (system timezone)")
        self._zones = [""] + list_iana_timezones()

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        self.label = SettingsLabel(info.get("description", "Timezone"))
        header.pack_start(self.label, False, False, 0)
        self.pack_start(header, False, False, 0)

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

        if info.get("tooltip"):
            self.set_tooltip_text(info["tooltip"])
            self.search.set_tooltip_text(info["tooltip"])

        self._rebuild_list("")
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
            value = ""
        if value is None:
            value = ""
        value = str(value).strip()
        if value.lower() == "local":
            value = ""
        self._select_timezone(value, write=False)

    def _visible_zones(self, query):
        empty = [""]
        zones = [z for z in self._zones if z]
        return empty + filter_timezones(zones, query)

    def _rebuild_list(self, query, keep_tz=None):
        selection = self.tree.get_selection()
        self._updating = True
        try:
            self.store.clear()
            for tz in self._visible_zones(query):
                self.store.append([tz, timezone_label(tz, self.empty_label)])
        finally:
            self._updating = False
        if keep_tz is not None:
            self._select_timezone(keep_tz, write=False)

    def _on_query_changed(self, *args):
        current = self._current_value()
        self._rebuild_list(self.search.get_text(), keep_tz=current)

    def _on_search_activate(self, *args):
        if len(self.store) > 0:
            self.tree.set_cursor(Gtk.TreePath.new_first())
            tz = self.store[0][0]
            self._select_timezone(tz, write=True)

    def _on_selection_changed(self, selection):
        if getattr(self, "_updating", False):
            return
        model, row = selection.get_selected()
        if row is None:
            return
        self._select_timezone(model[row][0], write=True)

    def _current_value(self):
        try:
            value = self.settings.get_value(self.key)
        except Exception:
            value = ""
        value = "" if value is None else str(value).strip()
        if value.lower() == "local":
            return ""
        return value

    def _select_timezone(self, tz, write=True):
        tz = "" if tz is None else str(tz).strip()
        if tz.lower() == "local":
            tz = ""
        self._updating = True
        try:
            found = False
            for i, row in enumerate(self.store):
                if row[0] == tz:
                    self.tree.get_selection().select_iter(row.iter)
                    self.tree.scroll_to_cell(Gtk.TreePath.new_from_indices([i]))
                    found = True
                    break
            if not found and tz:
                self.store.prepend([tz, timezone_label(tz, self.empty_label)])
                self.tree.get_selection().select_iter(self.store.get_iter_first())
        finally:
            self._updating = False

        self.selected.set_text("Selected: %s" % timezone_label(tz, self.empty_label))
        if write:
            self._write(tz)

    def _write(self, tz):
        current = self._current_value()
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
