#!/usr/bin/python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gio, GLib, Gdk
from TreeListWidgets import List
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
    if module_name in sys.modules:
        return sys.modules[module_name]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _load_order_folder_editor():
    return _load_module("orderFolderEditor.py")


def _notify_desklet(settings, callback_name):
    try:
        proxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            None,
            "org.Cinnamon",
            "/org/Cinnamon",
            "org.Cinnamon",
            None)
        instance_id = str(getattr(settings, "instance_id", ""))
        proxy.call_sync(
            "activateCallback",
            GLib.Variant("(sss)", (callback_name, UUID, instance_id)),
            Gio.DBusCallFlags.NONE,
            -1,
            None)
    except Exception:
        pass


_EDITOR = _load_order_folder_editor()
_IMPORT = _load_module("linkImport.py")
_ICON_PICKER = _load_module("iconPicker.py")
_PENDING = _load_module("orderListPending.py")
DATA_KEY = _EDITOR.DATA_KEY
navigate_into_folder = _EDITOR.navigate_into_folder


class OrderListWidget(List):
    bind_dir = None

    def __init__(self, info, key, settings):
        self.key = key
        self.settings = settings
        self.info = info
        self._saving = False
        self._initializing = True
        self._save_timeout_id = 0
        self._dirty = False
        self._column_ids = [column["id"] for column in info["columns"]]
        try:
            self._type_icon_col = self._column_ids.index("type-icon")
        except ValueError:
            self._type_icon_col = -1

        List.__init__(
            self,
            label=info.get("description"),
            columns=info["columns"],
            height=info.get("height", 280),
            show_buttons=info.get("show-buttons", True),
            tooltip=info.get("tooltip", "")
        )
        self.attach_data_binding()

        if self.show_buttons and self._type_icon_col >= 0:
            self.open_folder_button = Gtk.ToolButton.new()
            self.open_folder_button.set_icon_name("folder-symbolic")
            self.open_folder_button.set_tooltip_text(_("Open directory"))
            self.open_folder_button.set_sensitive(False)
            self.open_folder_button.connect("clicked", self.on_open_folder_clicked)
            toolbar = self.edit_button.get_parent()
            toolbar.insert(self.open_folder_button, 3)

        # Do not write settings on every selection change — that lagged Configure.
        _PENDING.set_order_list_flush_callback(self.flush_pending_now)
        self.connect("destroy", self._on_destroy)
        self._initializing = False

    def _on_destroy(self, *args):
        if self._dirty:
            self.flush_pending_now()
        _PENDING.set_order_list_flush_callback(None)
        if self._save_timeout_id:
            GLib.source_remove(self._save_timeout_id)
            self._save_timeout_id = 0


    def _get_settings_window(self):
        widget = self
        while widget is not None:
            if isinstance(widget, Gtk.Window):
                return widget
            widget = widget.get_parent()
        return None

    def _present_settings_window(self):
        parent = self._get_settings_window()
        if parent is None:
            return

        def _present():
            parent.set_skip_taskbar_hint(False)
            parent.set_skip_pager_hint(False)
            parent.show_all()
            parent.deiconify()
            parent.present()
            window = parent.get_window()
            if window is not None:
                window.raise_()
                window.focus(Gdk.CURRENT_TIME)
            return False

        GLib.idle_add(_present)

    def _resolve_entry_id(self, row):
        short_id = row.get("id-short") or ""
        type_icon = row.get("type-icon") or ""
        if type_icon == "folder-symbolic":
            return "folder:" + short_id
        if type_icon == "x-office-document-symbolic":
            return "document:" + short_id
        return "app:" + short_id

    def get_value(self):
        if not self.settings.has_key(DATA_KEY):
            return []
        try:
            return self.settings.get_value(DATA_KEY) or []
        except Exception:
            return []

    def attach_data_binding(self):
        self.settings.listen(DATA_KEY, self._on_data_changed)
        self._populate_model(self.get_value())

    def _populate_model(self, rows):
        self.model.clear()
        for row in rows or []:
            row_info = []
            for column in self.columns:
                column_id = column["id"]
                if column_id in row:
                    row_info.append(row[column_id])
                elif "default" in column:
                    row_info.append(column["default"])
                else:
                    row_info.append(None)
            self.model.append(row_info)

        self.content_widget.columns_autosize()
        self.update_button_sensitivity()

    def _reload_items_from_settings(self):
        """Rebuild the tree from current settings (Add/Refresh must not wait for reopen)."""
        self._populate_model(self.get_value() or [])

    def _on_data_changed(self, key, value):
        if self._saving:
            return
        # Always rebuild so Add/Refresh updates are visible without reopening Configure.
        self._populate_model(value or [])

    def update_button_sensitivity(self, *args):
        if not self.show_buttons:
            return

        # Use path indices — Gtk.TreeModel.iter_previous/next mutate the iter in
        # place, which broke Up/Down sensitivity after a move in the stock List.
        model, selected = self.content_widget.get_selection().get_selected()
        if selected is None:
            self.remove_button.set_sensitive(False)
            self.edit_button.set_sensitive(False)
            self.move_up_button.set_sensitive(False)
            self.move_down_button.set_sensitive(False)
            self.update_folder_button_sensitivity()
            return

        self.remove_button.set_sensitive(True)
        self.edit_button.set_sensitive(True)

        path = model.get_path(selected)
        index = path.get_indices()[0] if path is not None else 0
        count = len(model)
        self.move_up_button.set_sensitive(index > 0)
        self.move_down_button.set_sensitive(index < count - 1)
        self.update_folder_button_sensitivity()

    def _move_selected_row(self, delta):
        model, selected = self.content_widget.get_selection().get_selected()
        if selected is None:
            return

        path = model.get_path(selected)
        if path is None:
            return

        index = path.get_indices()[0]
        target_index = index + delta
        if target_index < 0 or target_index >= len(model):
            return

        other = model.get_iter(Gtk.TreePath.new_from_indices([target_index]))
        if other is None:
            return

        model.swap(selected, other)
        self.list_changed()

    def move_item_up(self, *args):
        self._move_selected_row(-1)

    def move_item_down(self, *args):
        self._move_selected_row(1)

    def update_folder_button_sensitivity(self, *args):
        if not self.show_buttons or not hasattr(self, "open_folder_button"):
            return

        model, selected = self.content_widget.get_selection().get_selected()
        if selected is None or self._type_icon_col < 0:
            self.open_folder_button.set_sensitive(False)
            return

        type_icon = model[selected][self._type_icon_col]
        self.open_folder_button.set_sensitive(type_icon == "folder-symbolic")

    def _selected_folder_name(self):
        model, selected = self.content_widget.get_selection().get_selected()
        if selected is None:
            return None

        row = {}
        for index, column_id in enumerate(self._column_ids):
            row[column_id] = model[selected][index]

        if row.get("type-icon") != "folder-symbolic":
            return None

        return row.get("id-short") or None

    def on_open_folder_clicked(self, *args):
        folder_name = self._selected_folder_name()
        if not folder_name:
            return

        navigate_into_folder(self.settings, folder_name)

    def _open_command_link_dialog(self, title, current=None, ok_label=_("_Add")):
        dialog = Gtk.Dialog(
            title=title,
            transient_for=None,
            flags=Gtk.DialogFlags.MODAL,
        )
        dialog.set_destroy_with_parent(False)
        dialog.set_modal(True)
        dialog.set_position(Gtk.WindowPosition.CENTER)
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(ok_label, Gtk.ResponseType.OK)

        content = dialog.get_content_area()
        content.set_spacing(8)
        content.set_margin_top(12)
        content.set_margin_bottom(12)
        content.set_margin_start(12)
        content.set_margin_end(12)

        name_entry = Gtk.Entry()
        name_entry.set_placeholder_text(_("Terminal"))
        command_entry = Gtk.Entry()
        command_entry.set_placeholder_text(_("x-terminal-emulator -e htop"))
        icon_row, icon_entry = _ICON_PICKER.create_icon_picker_row(
            dialog,
            current.get("icon") if current else "",
            "utilities-terminal",
        )
        terminal_switch = Gtk.Switch()
        terminal_switch.set_active(True)
        terminal_switch.set_halign(Gtk.Align.START)
        terminal_switch.set_valign(Gtk.Align.CENTER)

        if current:
            name_entry.set_text(current.get("name") or "")
            command_entry.set_text(current.get("command") or "")
            terminal_switch.set_active(bool(current.get("terminal")))

        grid = Gtk.Grid(column_spacing=12, row_spacing=8)
        labels = [
            (_("Name"), name_entry),
            (_("Command"), command_entry),
            (_("Icon"), icon_row),
        ]
        for row, (label_text, widget) in enumerate(labels):
            label = Gtk.Label(label=label_text, xalign=0)
            grid.attach(label, 0, row, 1, 1)
            grid.attach(widget, 1, row, 1, 1)
            widget.set_hexpand(True)

        terminal_label = Gtk.Label(label=_("Run in terminal"), xalign=0)
        grid.attach(terminal_label, 0, len(labels), 1, 1)
        grid.attach(terminal_switch, 1, len(labels), 1, 1)

        content.pack_start(grid, True, True, 0)
        content.show_all()
        response = dialog.run()
        values = None
        if response == Gtk.ResponseType.OK:
            name = name_entry.get_text().strip()
            command = command_entry.get_text().strip()
            if name and command:
                values = {
                    "name": name,
                    "command": command,
                    "icon": _ICON_PICKER.get_icon_text(icon_entry, "utilities-terminal"),
                    "terminal": terminal_switch.get_active(),
                }
        dialog.destroy()
        self._present_settings_window()
        return values

    def add_item(self, *args):
        values = self._open_command_link_dialog(_("Add launcher"))
        if values is None:
            return

        target_dir = _EDITOR.get_browse_path(self.settings)
        if not target_dir:
            return

        result = _IMPORT.create_desktop_link(
            target_dir,
            values["name"],
            values["command"],
            values["icon"],
            values["terminal"],
        )
        if not result.get("ok"):
            self._show_message(result.get("error") or _("Could not create launcher."))
            return

        _EDITOR.navigate_to_path(self.settings, target_dir)
        self._reload_items_from_settings()
        _notify_desklet(self.settings, "on_items_changed_callback")

    def _edit_app_link(self, row):
        browse_path = _EDITOR.get_browse_path(self.settings)
        short_id = row.get("id-short") or ""
        if not browse_path or not short_id:
            return

        desktop_path = os.path.join(browse_path, short_id)
        if not os.path.isfile(desktop_path):
            self._show_message(_("Launcher file not found."))
            return

        current = _IMPORT.read_desktop_link(desktop_path)
        values = self._open_command_link_dialog(
            _("Edit launcher"),
            current=current,
            ok_label=_("_Save"),
        )
        if values is None:
            return

        result = _IMPORT.update_desktop_link(
            desktop_path,
            values["name"],
            values["command"],
            values["icon"],
            values["terminal"],
        )
        if not result.get("ok"):
            self._show_message(result.get("error") or _("Could not update launcher."))
            return

        _EDITOR.navigate_to_path(self.settings, browse_path)
        self._reload_items_from_settings()
        _notify_desklet(self.settings, "on_items_changed_callback")

    def _open_folder_style_dialog(self, row):
        folder_id = self._resolve_entry_id(row)
        browse_path = _EDITOR.get_browse_path(self.settings)
        if not browse_path or not folder_id:
            return None

        current = _EDITOR.get_folder_style(browse_path, folder_id)
        # Do not set transient_for on the settings window: XApp.GtkWindow can
        # hide when a transient child dialog closes (Cancel / Esc).
        dialog = Gtk.Dialog(
            title=_("Edit folder appearance"),
            transient_for=None,
            flags=Gtk.DialogFlags.MODAL,
        )
        dialog.set_destroy_with_parent(False)
        dialog.set_modal(True)
        dialog.set_position(Gtk.WindowPosition.CENTER)
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(_("_Save"), Gtk.ResponseType.OK)
        dialog.set_default_response(Gtk.ResponseType.OK)

        content = dialog.get_content_area()
        content.set_spacing(12)
        content.set_margin_top(12)
        content.set_margin_bottom(12)
        content.set_margin_start(12)
        content.set_margin_end(12)

        grid = Gtk.Grid(column_spacing=12, row_spacing=10)

        icon_label = Gtk.Label(label=_("Folder icon"), xalign=0)
        icon_row, icon_entry = _ICON_PICKER.create_icon_picker_row(
            dialog,
            current.get("icon") or "",
            _EDITOR.DEFAULT_FOLDER_ICON,
        )

        color_label = Gtk.Label(label=_("Folder color"), xalign=0)
        color_button = Gtk.ColorButton()
        color_button.set_use_alpha(True)
        color_button.set_size_request(36, 22)
        color_button.set_halign(Gtk.Align.START)
        bg_color = (current.get("bgColor") or "").strip()
        unset = Gdk.RGBA()
        unset.alpha = 0
        if bg_color:
            rgba = Gdk.RGBA()
            if rgba.parse(bg_color):
                color_button.set_rgba(rgba)
            else:
                color_button.set_rgba(unset)
        else:
            color_button.set_rgba(unset)

        grid.attach(icon_label, 0, 0, 1, 1)
        grid.attach(icon_row, 1, 0, 1, 1)
        grid.attach(color_label, 0, 1, 1, 1)
        grid.attach(color_button, 1, 1, 1, 1)
        content.pack_start(grid, False, False, 0)
        content.show_all()

        dialog.connect(
            "response",
            self._on_folder_style_response,
            folder_id,
            icon_entry,
            color_button,
        )
        dialog.show()

    def _on_folder_style_response(self, dialog, response, folder_id, icon_entry, color_button):
        saved = False
        if response == Gtk.ResponseType.OK:
            icon_name = _ICON_PICKER.get_icon_text(icon_entry, _EDITOR.DEFAULT_FOLDER_ICON)
            rgba = color_button.get_rgba()
            color_value = rgba.to_string() if rgba.alpha > 0 else ""
            saved = _EDITOR.save_folder_style(
                self.settings,
                folder_id,
                icon_name,
                color_value,
            )
            if saved:
                _notify_desklet(self.settings, "on_items_changed_callback")
        dialog.destroy()
        self._present_settings_window()
        return saved

    def _idle_open_folder_style_dialog(self, row):
        self._open_folder_style_dialog(row)
        return False

    def edit_item(self, *args):
        model, selected, row = self._selected_row()
        if selected is None:
            return

        type_icon = row.get("type-icon") or ""
        if type_icon == "folder-symbolic":
            GLib.idle_add(self._idle_open_folder_style_dialog, dict(row))
            return

        if type_icon == "application-x-executable-symbolic":
            self._edit_app_link(row)
            return

        List.edit_item(self, *args)

    def _show_message(self, message, message_type=Gtk.MessageType.ERROR):
        dialog = Gtk.MessageDialog(
            transient_for=self._get_settings_window(),
            modal=True,
            message_type=message_type,
            buttons=Gtk.ButtonsType.OK,
            text=message
        )
        dialog.set_destroy_with_parent(False)
        dialog.run()
        dialog.destroy()
        self._present_settings_window()

    def _selected_row(self):
        model, selected = self.content_widget.get_selection().get_selected()
        if selected is None:
            return None, None, None

        row = {}
        for index, column_id in enumerate(self._column_ids):
            row[column_id] = model[selected][index]
        return model, selected, row

    def remove_item(self, *args):
        model, selected, row = self._selected_row()
        if selected is None:
            return

        entry_id = self._resolve_entry_id(row)
        label = row.get("name") or row.get("id-short") or entry_id

        dialog = Gtk.MessageDialog(
            transient_for=self._get_settings_window(),
            modal=True,
            message_type=Gtk.MessageType.QUESTION,
            buttons=Gtk.ButtonsType.NONE,
            text=_("Remove \"%s\" from the list?") % label
        )
        dialog.set_destroy_with_parent(False)
        dialog.format_secondary_text(
            _("You can also delete the file or folder from the link directory.")
        )
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(_("Remove from _list only"), Gtk.ResponseType.NO)
        dialog.add_button(_("Remove and _delete"), Gtk.ResponseType.YES)
        dialog.set_default_response(Gtk.ResponseType.CANCEL)

        response = dialog.run()
        dialog.destroy()

        if response == Gtk.ResponseType.CANCEL:
            return

        if response == Gtk.ResponseType.YES:
            browse_path = _EDITOR.get_browse_path(self.settings)
            if browse_path and entry_id:
                separator = entry_id.find(":")
                if separator > 0:
                    name = entry_id[separator + 1:]
                    target_path = os.path.join(browse_path, name)
                    result = _IMPORT.trash_path(target_path)
                    if not result.get("ok"):
                        self._show_message(
                            result.get("error") or _("Could not delete item."),
                            Gtk.MessageType.ERROR
                        )
                        return

        model.remove(selected)
        self.list_changed()

        if response == Gtk.ResponseType.YES:
            _notify_desklet(self.settings, "on_items_changed_callback")

    def list_changed(self, *args):
        # Keep the tree + buttons snappy. Defer the full settings JSON rewrite —
        # that delete+rewrite is slow on network shares and blocked every move.
        self._dirty = True
        self.update_button_sensitivity()
        if self._save_timeout_id:
            GLib.source_remove(self._save_timeout_id)
            self._save_timeout_id = 0
        self._save_timeout_id = GLib.timeout_add(750, self._flush_list_to_settings)

    def _collect_model_data(self):
        data = []
        for row in self.model:
            row_info = {}
            for index, column in enumerate(self.columns):
                row_info[column["id"]] = row[index]
            data.append(row_info)
        return data

    def flush_pending_now(self):
        if self._save_timeout_id:
            GLib.source_remove(self._save_timeout_id)
            self._save_timeout_id = 0
        if not self._dirty:
            return
        self._flush_list_to_settings()

    def _flush_list_to_settings(self):
        self._save_timeout_id = 0
        data = self._collect_model_data()
        self._saving = True
        try:
            self.settings.set_value(DATA_KEY, data)
            self._dirty = False
        finally:
            self._saving = False
        return GLib.SOURCE_REMOVE
