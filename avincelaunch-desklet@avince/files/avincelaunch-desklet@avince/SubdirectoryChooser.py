#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

"""Link subdirectory picker: select or create a folder under the shared base."""

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, Gio, GLib, Pango
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
resolve_shared_base = _EDITOR.resolve_shared_base
navigate_to_path = _EDITOR.navigate_to_path
set_value_safe = _EDITOR.set_value_safe




def _resolve_base(settings):
    return resolve_shared_base(settings)


# Rote Hinweiszeile statt Warnfenster (Angelo, 07.10.2026, A4-1).
_ERROR_CSS = b"""
.avincelaunch-error { color: #E01B24; font-weight: bold; }
"""
_error_css_installed = False


def _install_error_css():
    global _error_css_installed
    if _error_css_installed:
        return
    provider = Gtk.CssProvider()
    provider.load_from_data(_ERROR_CSS)
    Gtk.StyleContext.add_provider_for_screen(
        Gdk.Screen.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    _error_css_installed = True


def _normalize_dir(path):
    # P8/P11: nicht aufloesen (wie Desklet und Basisordner) - ein
    # Gruppenordner, der ein Verweis ist, bleibt waehlbar.
    if not path:
        return ""
    return os.path.normpath(os.path.abspath(os.path.expanduser(path)))


def _relative_subdirectory(base, chosen):
    base = _normalize_dir(base)
    chosen = _normalize_dir(chosen)
    if not base or not chosen:
        return None
    if chosen == base:
        return None
    prefix = base + os.sep
    if not chosen.startswith(prefix):
        return None
    rel = chosen[len(prefix):].strip("/")
    return rel or None


# Value key must be type "generic" so the desklet can bind it on startup.
# This widget key is a separate "custom" UI-only entry in the schema.
VALUE_KEY = "subdirectory"


class SubdirectoryChooser(SettingsWidget):
    bind_dir = None

    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.key = VALUE_KEY
        self.settings = settings
        self.instance_id = str(getattr(settings, "instance_id", ""))
        self._updating = False

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)

        description = info.get("description") or _("Link subdirectory")
        label = Gtk.Label(label=description)
        label.set_halign(Gtk.Align.START)
        label.set_xalign(0)
        box.pack_start(label, False, False, 0)

        help_label = Gtk.Label(
            label=_(
                "Open the folder you want (double-click to enter it), then click Select. "
                "Only folders under the shared base directory are allowed."
            )
        )
        help_label.set_line_wrap(True)
        help_label.set_xalign(0)
        help_label.set_halign(Gtk.Align.FILL)
        help_label.get_style_context().add_class("dim-label")
        box.pack_start(help_label, False, False, 0)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

        # Display-only relative path (no entry field).
        self.path_label = Gtk.Label()
        self.path_label.set_halign(Gtk.Align.START)
        self.path_label.set_xalign(0)
        self.path_label.set_hexpand(True)
        self.path_label.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
        self.path_label.set_selectable(True)
        attrs = Pango.AttrList()
        attrs.insert(Pango.attr_weight_new(Pango.Weight.BOLD))
        self.path_label.set_attributes(attrs)
        tooltip = info.get("tooltip")
        if tooltip:
            self.path_label.set_tooltip_text(tooltip)
        row.pack_start(self.path_label, True, True, 0)

        self.browse_button = Gtk.Button(label=_("Browse…"))
        self.browse_button.set_tooltip_text(
            _("Select or create a link folder under the shared base directory.")
        )
        self.browse_button.connect("clicked", self.on_browse_clicked)
        row.pack_start(self.browse_button, False, False, 0)
        box.pack_start(row, False, False, 0)

        self.status = Gtk.Label()
        self.status.set_halign(Gtk.Align.START)
        self.status.set_xalign(0)
        self.status.set_line_wrap(True)
        self.status.get_style_context().add_class("dim-label")
        box.pack_start(self.status, False, False, 0)

        self.pack_start(box, True, True, 0)

        # Wert-Schluessel statt Baustein-Schluessel (KeyError, siehe
        # BaseDirectoryChooser.py, AP17).
        if settings.has_key(VALUE_KEY):
            settings.listen(VALUE_KEY, self._on_subdirectory_changed)
        if settings.has_key("base-directory"):
            settings.listen("base-directory", self._on_base_changed)

        self._refresh_display()

    def _current_subdirectory(self):
        try:
            text = (self.settings.get_value(self.key) or "").strip()
            return text
        except Exception:
            return ""

    def _target_path(self):
        base = _resolve_base(self.settings)
        sub = self._current_subdirectory().strip("/")
        return os.path.join(base, sub) if sub else ""

    def _set_display(self, relative_name):
        relative_name = (relative_name or "").strip("/")
        if relative_name:
            self.path_label.set_text(relative_name)
        else:
            self.path_label.set_text(_("(none selected)"))
        # P35: keine verschachtelte Hauptschleife mehr (frueher
        # Gtk.main_iteration_do) - waehrend des Wechsels konnten sonst Klicks,
        # Schliessen oder check_settings dazwischenlaufen.
        self.path_label.queue_draw()

    def _show_error(self, text):
        _install_error_css()
        context = self.status.get_style_context()
        context.remove_class("dim-label")
        context.add_class("avincelaunch-error")
        self.status.set_text(text)

    def _clear_error(self):
        context = self.status.get_style_context()
        context.remove_class("avincelaunch-error")
        context.add_class("dim-label")

    def _refresh_display(self):
        self._clear_error()
        sub = self._current_subdirectory().strip("/")
        self._set_display(sub)
        if not sub:
            self.status.set_text(_("No link subdirectory selected."))
            return
        path = self._target_path()
        if os.path.isdir(path):
            self.status.set_text(_("Ready under shared base."))
        else:
            self.status.set_text(_("Folder missing — use Browse to create or select one."))

    def _warn_outside_base(self, base):
        # P8: Eine ungueltige Wahl aendert nichts - frueher wurde der
        # Verknuepfungsordner geleert und der Fence sprang auf "default".
        # Hinweis als rote Zeile statt eigenem Fenster (Angelo, 07.10.).
        self._refresh_display()
        self._show_error(_("Not inside the shared base folder – selection not changed."))

    def _on_subdirectory_changed(self, key, value):
        if self._updating:
            return
        self._refresh_display()

    def _on_base_changed(self, key, value):
        self._refresh_display()

    def _notify_desklet(self, callback_name):
        # P59: gemeinsame Meldung mit Fehlerbehandlung (orderFolderEditor).
        return _EDITOR.notify_desklet(self.settings, callback_name)

    def _folder_from_chooser(self, dialog):
        """Folder the user meant to Select.

        Gtk SELECT_FOLDER is inconsistent:
        - Highlight a child + Select → get_filename() is that child
        - Enter a folder + Select → get_filename() is often empty; the folder
          being viewed is get_current_folder()

        Prefer the viewed folder when nothing is explicitly selected, otherwise
        prefer the highlighted selection when it is a directory.
        """
        current = _normalize_dir(dialog.get_current_folder() or "")
        selected = ""
        try:
            name = dialog.get_filename()
            if name:
                selected = _normalize_dir(name)
        except Exception:
            selected = ""

        if not selected:
            try:
                chosen = dialog.get_file()
                if chosen is not None:
                    path = chosen.get_path()
                    if path:
                        selected = _normalize_dir(path)
            except Exception:
                selected = ""

        # Explicit child selection (highlighted, not entered).
        if selected and os.path.isdir(selected):
            if not current or selected != current:
                return selected
            return selected

        if current and os.path.isdir(current):
            return current
        return None

    def _apply_chosen_path(self, chosen_path):
        # P35: Knopf gesperrt, solange gearbeitet wird (kein Doppelstart).
        self.browse_button.set_sensitive(False)
        try:
            return self._apply_chosen_path_locked(chosen_path)
        finally:
            self.browse_button.set_sensitive(True)

    def _apply_chosen_path_locked(self, chosen_path):
        base = _resolve_base(self.settings)
        try:
            os.makedirs(base, mode=0o755, exist_ok=True)
        except Exception as error:
            self.status.set_text(_("Could not prepare base directory: %s") % error)
            return False

        chosen_path = _normalize_dir(chosen_path)
        rel = _relative_subdirectory(base, chosen_path)
        if not rel:
            self._warn_outside_base(base)
            return False

        # P31: Wechsel des Ordners liest die Liste neu - offene Aenderungen
        # nicht still verwerfen.
        pending = sys.modules.get("avincelaunch_orderListPending")
        if pending is not None:
            pending.flush_order_list_now(str(getattr(self.settings, "instance_id", "")))
        toplevel = self.get_toplevel()
        if not _EDITOR.confirm_unapplied_changes(
                self.settings, toplevel if isinstance(toplevel, Gtk.Window) else None):
            self._refresh_display()
            return False

        absolute = os.path.join(base, rel)
        try:
            os.makedirs(absolute, mode=0o755, exist_ok=True)
        except Exception as error:
            self.status.set_text(_("Could not create folder: %s") % error)
            return False

        # Update the bold label immediately so Select always feels responsive,
        # even before slow settings JSON writes finish.
        self._set_display(rel)
        self.status.set_text(_("Loading link folder: %s …") % rel)

        self._updating = True
        try:
            # P32: kein leerer Zwischenwert mehr (frueher "" vor dem gleichen
            # Ordner, damit "etwas passiert") - der Fence sah kurz "default".
            # Bei gleichem Ordner nur neu laden und benachrichtigen (unten).
            # set_value_safe: ein veralteter D-Bus-Eintrag nach einem Neuaufbau
            # bricht nicht ab, bevor Items / lokale Listener aktualisiert sind.
            current = self._current_subdirectory()
            if current != rel and not set_value_safe(self.settings, self.key, rel):
                self.status.set_text(_("Could not save subdirectory setting."))
                return False
        finally:
            self._updating = False

        # Confirm what settings actually stored.
        stored = self._current_subdirectory().strip("/")
        self._set_display(stored or rel)

        try:
            loaded = navigate_to_path(self.settings, absolute)
        except Exception as error:
            self.status.set_text(_("Selected %s, but could not load items: %s") % (rel, error))
            self._notify_desklet("on_subdirectory_selected_callback")
            return False

        if not loaded:
            self.status.set_text(
                _("Selected %s, but could not load items from that folder.") % rel
            )
            self._notify_desklet("on_subdirectory_selected_callback")
            return False

        self._notify_desklet("on_subdirectory_selected_callback")
        self._refresh_display()
        self.status.set_text(_("Loaded link folder: %s") % rel)
        return True

    def on_browse_clicked(self, *args):
        # Hinweis einer frueheren Wahl ganz zuruecksetzen (Text und Farbe).
        self._refresh_display()
        base = _resolve_base(self.settings)
        try:
            os.makedirs(base, mode=0o755, exist_ok=True)
        except Exception as error:
            self.status.set_text(_("Could not prepare base directory: %s") % error)
            return

        parent = self.get_toplevel()
        if not isinstance(parent, Gtk.Window):
            parent = None

        dialog = Gtk.FileChooserDialog(
            title=_("Select link subdirectory"),
            transient_for=parent,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(_("_Select"), Gtk.ResponseType.OK)
        dialog.set_create_folders(True)
        dialog.set_local_only(True)
        # Do not attach current-folder-changed handlers — they re-enter and
        # fight Gtk navigation, which made Select feel flaky.

        start = self._target_path()
        if start and os.path.isdir(start):
            dialog.set_current_folder(start)
        else:
            dialog.set_current_folder(base)

        response = dialog.run()
        chosen = self._folder_from_chooser(dialog) if response == Gtk.ResponseType.OK else None
        dialog.destroy()

        if response != Gtk.ResponseType.OK:
            return

        if not chosen:
            self.status.set_text(_("No folder selected."))
            return

        self._apply_chosen_path(chosen)
