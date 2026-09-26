#!/usr/bin/python3

"""Shared base directory picker: select or create the root for all instances."""

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gio, GLib, Pango
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os
import sys

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


UUID = "thelauncher@sin-apps.com"


def _load_module(name):
    module_name = "thelauncher_" + name.replace(".py", "")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    mtime = os.path.getmtime(path) if os.path.isfile(path) else 0
    existing = sys.modules.get(module_name)
    if existing is not None and getattr(existing, "_thelauncher_mtime", None) == mtime:
        return existing
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    module._thelauncher_mtime = mtime
    return module


_EDITOR = _load_module("orderFolderEditor.py")
load_shared_base_directory = _EDITOR.load_shared_base_directory
save_shared_base_directory = _EDITOR.save_shared_base_directory
resolve_shared_base = _EDITOR.resolve_shared_base
navigate_to_path = _EDITOR.navigate_to_path
set_value_safe = _EDITOR.set_value_safe


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


def _normalize_dir(path):
    if not path:
        return ""
    try:
        return os.path.realpath(path)
    except Exception:
        return os.path.abspath(path)


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
                "Open the folder you want (double-click to enter it), then click Select. "
                "This is the shared root for all TheLauncher instances."
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

        self.browse_button = Gtk.Button(label=_("Browse…"))
        self.browse_button.set_tooltip_text(
            _("Select or create the shared base directory for launcher content.")
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

        if settings.has_key(key):
            settings.listen(key, self._on_base_changed)

        self._refresh_display()

    def _configured_base(self):
        try:
            return (self.settings.get_value(self.key) or "").strip()
        except Exception:
            return ""

    def _effective_base(self):
        configured = self._configured_base()
        if configured:
            return _normalize_dir(configured)
        return _normalize_dir(load_shared_base_directory())

    def _set_display(self, absolute_path):
        absolute_path = (absolute_path or "").strip()
        if absolute_path:
            self.path_label.set_text(absolute_path)
        else:
            self.path_label.set_text(_("(none selected)"))
        self.path_label.queue_draw()
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)

    def _refresh_display(self):
        path = self._effective_base()
        self._set_display(path)
        if not path:
            self.status.set_text(_("No shared base directory selected."))
            return
        if os.path.isdir(path):
            if self._configured_base():
                self.status.set_text(_("Shared base ready."))
            else:
                self.status.set_text(_("Using default shared base."))
        else:
            self.status.set_text(_("Folder missing — use Browse to create or select one."))

    def _on_base_changed(self, key, value):
        if self._updating:
            return
        self._refresh_display()

    def _notify_desklet(self, callback_name):
        proxy = _get_proxy()
        if proxy is None:
            return
        try:
            proxy.call_sync(
                "activateCallback",
                GLib.Variant("(sss)", (callback_name, UUID, self.instance_id)),
                Gio.DBusCallFlags.NONE,
                -1,
                None)
        except Exception:
            pass

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
        chosen_path = _normalize_dir(chosen_path)
        if not chosen_path:
            self.status.set_text(_("No folder selected."))
            return False

        try:
            os.makedirs(chosen_path, mode=0o755, exist_ok=True)
        except Exception as error:
            self.status.set_text(_("Could not create folder: %s") % error)
            return False

        if not os.path.isdir(chosen_path):
            self.status.set_text(_("Selected path is not a directory."))
            return False

        self._set_display(chosen_path)
        self.status.set_text(_("Loading shared base: %s …") % chosen_path)

        self._updating = True
        try:
            current = self._configured_base()
            if current == chosen_path:
                set_value_safe(self.settings, self.key, "")
            if not set_value_safe(self.settings, self.key, chosen_path):
                self.status.set_text(_("Could not save shared base directory."))
                return False
        finally:
            self._updating = False

        try:
            save_shared_base_directory(chosen_path)
        except Exception as error:
            self.status.set_text(
                _("Saved for this instance, but shared config write failed: %s") % error
            )

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

        self._apply_chosen_path(chosen)
