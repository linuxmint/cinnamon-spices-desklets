#!/usr/bin/python3

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("XApp", "1.0")
from gi.repository import Gtk, XApp

try:
    from gettext import gettext as _
except ImportError:
    def _(text):
        return text


_ICON_CHOOSER = None


def _get_icon_chooser():
    global _ICON_CHOOSER
    if _ICON_CHOOSER is None:
        chooser = XApp.IconChooserDialog.new()
        chooser.set_destroy_with_parent(False)
        _ICON_CHOOSER = chooser
    return _ICON_CHOOSER


def _resolve_parent_window(parent_window):
    if isinstance(parent_window, Gtk.Window):
        return parent_window
    if parent_window is not None:
        toplevel = parent_window.get_toplevel()
        if isinstance(toplevel, Gtk.Window):
            return toplevel
    return None


def pick_icon(parent_window, current_icon="", default_icon=""):
    """Open the Cinnamon/XApp icon chooser without linking it to Configure."""
    chooser = _get_icon_chooser()
    parent = _resolve_parent_window(parent_window)
    chooser.set_transient_for(parent)
    chooser.set_destroy_with_parent(False)
    chooser.set_modal(True)

    icon = (current_icon or default_icon).strip() or default_icon
    response = chooser.run_with_icon(icon)
    if response != Gtk.ResponseType.OK:
        return None

    selected = (chooser.get_icon_string() or chooser.get_icon_name() or "").strip()
    return selected or None


def create_icon_picker_row(parent_window, initial_icon="", default_icon="folder-symbolic"):
    """Build icon preview + name entry. Returns (box, entry)."""
    box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
    preview = Gtk.Image()
    preview.set_pixel_size(24)
    entry = Gtk.Entry()
    entry.set_hexpand(True)
    entry.set_placeholder_text(default_icon)
    initial = (initial_icon or default_icon).strip() or default_icon
    entry.set_text(initial)

    def update_preview():
        name = entry.get_text().strip() or default_icon
        preview.set_from_icon_name(name, Gtk.IconSize.BUTTON)

    def on_pick_clicked(*args):
        selected = pick_icon(parent_window or box, entry.get_text(), default_icon)
        if selected:
            entry.set_text(selected)
        update_preview()

    preview_button = Gtk.Button()
    preview_button.set_relief(Gtk.ReliefStyle.NONE)
    preview_button.add(preview)
    preview_button.set_tooltip_text(_("Choose icon"))
    preview_button.connect("clicked", on_pick_clicked)
    entry.connect("changed", lambda *args: update_preview())

    box.pack_start(preview_button, False, False, 0)
    box.pack_start(entry, True, True, 0)
    update_preview()
    return box, entry


def get_icon_text(entry, default_icon=""):
    return entry.get_text().strip() or default_icon
