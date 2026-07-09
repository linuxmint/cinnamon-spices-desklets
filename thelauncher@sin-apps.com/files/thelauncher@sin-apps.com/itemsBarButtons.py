#!/usr/bin/python3

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib

_BAR_BUTTONS = []
_SYNC_SOURCE_ID = None


def apply_bar_button_width(button):
    if button not in _BAR_BUTTONS:
        _BAR_BUTTONS.append(button)
    button.connect("realize", _schedule_width_sync)
    if button.get_realized():
        _schedule_width_sync()


def _schedule_width_sync(*_args):
    global _SYNC_SOURCE_ID
    if _SYNC_SOURCE_ID:
        GLib.source_remove(_SYNC_SOURCE_ID)
    _SYNC_SOURCE_ID = GLib.timeout_add(50, _sync_button_widths)


def _sync_button_widths():
    global _SYNC_SOURCE_ID
    _SYNC_SOURCE_ID = None

    target = 0
    for button in _BAR_BUTTONS:
        if button is None or not button.get_realized():
            continue
        allocated = button.get_allocated_width()
        _min_width, natural_width = button.get_preferred_width()
        target = max(target, allocated, _min_width, natural_width)

    if target <= 1:
        return GLib.SOURCE_REMOVE

    for button in _BAR_BUTTONS:
        if button is not None and button.get_realized():
            button.set_size_request(target, -1)

    return GLib.SOURCE_REMOVE
