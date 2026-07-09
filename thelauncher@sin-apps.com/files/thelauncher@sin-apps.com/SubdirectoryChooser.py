#!/usr/bin/python3

"""Link subdirectory picker: select or create a folder under the shared base."""

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


def _resolve_base(settings):
    return resolve_shared_base(settings)


def _normalize_dir(path):
    if not path:
        return ""
    try:
        return os.path.realpath(path)
    except Exception:
        return os.path.abspath(path)


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

        if settings.has_key(key):
            settings.listen(key, self._on_subdirectory_changed)
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
        # Force a redraw — settings I/O on slow mounts can leave the label stale.
        self.path_label.queue_draw()
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)

    def _refresh_display(self):
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

    def _clear_selection(self, warning_message):
        self._updating = True
        try:
            self.settings.set_value(self.key, "")
        except Exception:
            pass
        finally:
            self._updating = False
        self._set_display("")
        self.status.set_text(warning_message)

    def _warn_outside_base(self, base):
        message = _(
            "Only folders inside the shared base directory are allowed.\n\nShared base:\n%s"
        ) % base
        parent = self.get_toplevel()
        if not isinstance(parent, Gtk.Window):
            parent = None
        dialog = Gtk.MessageDialog(
            transient_for=parent,
            modal=True,
            message_type=Gtk.MessageType.WARNING,
            buttons=Gtk.ButtonsType.OK,
            text=_("Invalid folder selected"),
        )
        dialog.format_secondary_text(message)
        dialog.run()
        dialog.destroy()
        self._clear_selection(_("Selection cleared — choose a folder under the shared base."))

    def _on_subdirectory_changed(self, key, value):
        if self._updating:
            return
        self._refresh_display()

    def _on_base_changed(self, key, value):
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
            # Force a listener-visible write even when re-selecting the same path.
            # Use set_value_safe so a stale DBus instance after desklet reload
            # cannot abort before Items / local listeners update.
            current = self._current_subdirectory()
            if current == rel:
                set_value_safe(self.settings, self.key, "")
            if not set_value_safe(self.settings, self.key, rel):
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
