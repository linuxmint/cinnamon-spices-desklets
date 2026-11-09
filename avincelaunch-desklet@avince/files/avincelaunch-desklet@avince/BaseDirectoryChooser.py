#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

"""Shared base directory picker: select or create the root for all instances."""

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk, Gio, GLib, Pango
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
load_shared_base_directory = _EDITOR.load_shared_base_directory
save_shared_base_directory = _EDITOR.save_shared_base_directory
resolve_shared_base = _EDITOR.resolve_shared_base
navigate_to_path = _EDITOR.navigate_to_path
set_value_safe = _EDITOR.set_value_safe




def _normalize_dir(path):
    # P11: nicht aufloesen - gleiche Regel wie lib/config.js und
    # orderFolderEditor.normalize_base_directory.
    if not path:
        return ""
    return os.path.normpath(os.path.abspath(os.path.expanduser(path)))


# Rote Hinweiszeile statt Warnfenster (Wunsch Angelo, A4-1).
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


# Value key must be type "generic" so the desklet can bind it on startup.
# This widget key is a separate "custom" UI-only entry in the schema.
VALUE_KEY = "base-directory"


class BaseDirectoryChooser(SettingsWidget):
    bind_dir = None

    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.key = VALUE_KEY
        self.settings = settings
        self.instance_id = str(getattr(settings, "instance_id", ""))
        self._updating = False

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)

        description = info.get("description") or _("Shared base directory")
        label = Gtk.Label(label=description)
        label.set_halign(Gtk.Align.START)
        label.set_xalign(0)
        box.pack_start(label, False, False, 0)

        help_label = Gtk.Label(
            label=_(
                "Applies to ALL fences, not only to this one. To change the folder of "
                "this fence, use Link subdirectory above."
            )
        )
        help_label.set_line_wrap(True)
        help_label.set_xalign(0)
        help_label.set_halign(Gtk.Align.FILL)
        help_label.get_style_context().add_class("dim-label")
        box.pack_start(help_label, False, False, 0)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

        # Display-only absolute path (no entry field).
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

        self.browse_button = Gtk.Button(label=_("Change for all fences…"))
        self.browse_button.set_tooltip_text(
            _("Select the base folder for the link groups of ALL fences. You will be asked to confirm.")
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

        # Auf den Wert-Schluessel hoeren, nicht auf den des Bausteins: der hat
        # keinen Wert, und Cinnamons check_settings bricht daran mit KeyError
        # ab - alle spaeter angemeldeten Bausteine erfuhren nichts (AP17).
        if settings.has_key(VALUE_KEY):
            settings.listen(VALUE_KEY, self._on_base_changed)

        self._refresh_display()

    def _configured_base(self):
        try:
            return (self.settings.get_value(self.key) or "").strip()
        except Exception:
            return ""

    def _effective_base(self):
        # Nur config.json - siehe resolve_shared_base (AP17).
        return _normalize_dir(load_shared_base_directory())

    def _set_display(self, absolute_path):
        absolute_path = (absolute_path or "").strip()
        if absolute_path:
            self.path_label.set_text(absolute_path)
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
        path = self._effective_base()
        self._set_display(path)
        if not path:
            self.status.set_text(_("No shared base directory selected."))
            return
        if os.path.isdir(path):
            self.status.set_text(_("Shared base ready."))
        else:
            self.status.set_text(_("Folder missing — use Browse to create or select one."))

    def _on_base_changed(self, key, value):
        if self._updating:
            return
        self._refresh_display()

    def _notify_desklet(self, callback_name):
        # P59: gemeinsame Meldung mit Fehlerbehandlung (orderFolderEditor).
        return _EDITOR.notify_desklet(self.settings, callback_name)

    def _folder_from_chooser(self, dialog):
        """Folder the user meant to Select (viewed folder or highlighted child)."""
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

        if selected and os.path.isdir(selected):
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
        chosen_path = _normalize_dir(chosen_path)
        if not chosen_path:
            self._show_error(_("No folder selected."))
            return False

        # Pruefung Phase 3 Teil 2 (T15): Der Wechsel liest die Liste neu - wie
        # im Unterordner-Dialog (P31) offene Aenderungen nicht still
        # verwerfen. Abbrechen aendert nichts (noch nichts angelegt, config.json unberuehrt).
        pending = sys.modules.get("avincelaunch_orderListPending")
        if pending is not None:
            pending.flush_order_list_now(str(getattr(self.settings, "instance_id", "")))
        toplevel = self.get_toplevel()
        if not _EDITOR.confirm_unapplied_changes(
                self.settings, toplevel if isinstance(toplevel, Gtk.Window) else None):
            self._refresh_display()
            return False

        try:
            os.makedirs(chosen_path, mode=0o755, exist_ok=True)
        except Exception as error:
            self._show_error(_("Could not create folder: %s") % error)
            return False

        if not os.path.isdir(chosen_path):
            self._show_error(_("Selected path is not a directory."))
            return False

        self._clear_error()
        self._set_display(chosen_path)
        self.status.set_text(_("Loading shared base: %s …") % chosen_path)

        # Pruefung Phase 2, P32: ZUERST config.json (atomar) - sie ist die
        # einzige Quelle fuer alle Fences (lib/config.js beobachtet sie, P33).
        # Scheitert das, bleibt alles wie es war. Frueher kam zuerst die Kopie
        # in der eigenen <ID>.json, teils ueber einen leeren Zwischenwert, und
        # der Fence schrieb daraus den Standardordner nach config.json.
        try:
            save_shared_base_directory(chosen_path)
        except Exception as error:
            self._refresh_display()
            self._show_error(
                _("Could not save the base folder (%s). Nothing was changed.") % error)
            return False

        # Danach die Kopie in der Instanz (nur Anzeige) - ohne Zwischenwert.
        self._updating = True
        try:
            if _normalize_dir(self._configured_base()) != chosen_path:
                set_value_safe(self.settings, self.key, chosen_path)
        finally:
            self._updating = False

        # Reload Items for this instance's subdirectory under the new base.
        instance_root = resolve_shared_base(self.settings)
        sub = "default"
        if self.settings.has_key("subdirectory"):
            try:
                sub = (self.settings.get_value("subdirectory") or "default").strip() or "default"
            except Exception:
                pass
        absolute = os.path.join(instance_root, sub.strip("/"))
        try:
            os.makedirs(absolute, mode=0o755, exist_ok=True)
        except Exception:
            pass

        try:
            loaded = navigate_to_path(self.settings, absolute) if os.path.isdir(absolute) else False
        except Exception as error:
            self.status.set_text(
                _("Shared base set to %s, but could not load items: %s") % (chosen_path, error)
            )
            self._notify_desklet("on_base_directory_selected_callback")
            return False

        self._notify_desklet("on_base_directory_selected_callback")
        self._refresh_display()
        if loaded:
            self.status.set_text(_("Loaded shared base: %s") % chosen_path)
        else:
            self.status.set_text(
                _("Shared base set to %s. Use Link subdirectory → Browse if Items are empty.")
                % chosen_path
            )
        return True

    def on_browse_clicked(self, *args):
        parent = self.get_toplevel()
        if not isinstance(parent, Gtk.Window):
            parent = None

        dialog = Gtk.FileChooserDialog(
            title=_("Select shared base directory"),
            transient_for=parent,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(_("_Select"), Gtk.ResponseType.OK)
        dialog.set_create_folders(True)
        dialog.set_local_only(True)

        start = self._effective_base()
        if start and os.path.isdir(start):
            dialog.set_current_folder(start)
        else:
            home = os.path.expanduser("~")
            dialog.set_current_folder(home if os.path.isdir(home) else "/")

        response = dialog.run()
        chosen = self._folder_from_chooser(dialog) if response == Gtk.ResponseType.OK else None
        dialog.destroy()

        if response != Gtk.ResponseType.OK:
            return

        if not chosen:
            self.status.set_text(_("No folder selected."))
            return

        if not self._confirm_change(chosen):
            self.status.set_text(_("Base folder unchanged."))
            return

        self._apply_chosen_path(chosen)

    def _confirm_change(self, chosen_path):
        """Rueckfrage, weil der Basisordner fuer ALLE Fences gilt (AP17).
        Beim 3x3-Umbau wurde er mit dem Unterordner verwechselt."""
        chosen_path = _normalize_dir(chosen_path)
        current = self._effective_base()
        if chosen_path and chosen_path == current:
            return True

        parent = self.get_toplevel()
        if not isinstance(parent, Gtk.Window):
            parent = None
        dialog = Gtk.MessageDialog(
            transient_for=parent,
            modal=True,
            message_type=Gtk.MessageType.WARNING,
            buttons=Gtk.ButtonsType.NONE,
            text=_("Change the base folder for ALL fences?"),
        )
        dialog.format_secondary_text(
            _("Every fence with a link group looks for its folder under this base folder. "
              "If you only want to change the folder of this fence, cancel and use "
              "Link subdirectory instead.\n\nCurrent: %s\nNew: %s")
            % (current or _("(none selected)"), chosen_path)
        )
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(_("Change for all fences"), Gtk.ResponseType.OK)
        dialog.set_default_response(Gtk.ResponseType.CANCEL)
        response = dialog.run()
        dialog.destroy()
        return response == Gtk.ResponseType.OK
