#!/usr/bin/python3

"""Pending Items-list flush for Configure.

Up/Down and toggles update the Gtk model immediately. Writing the full
settings JSON is expensive (especially on network shares), so we keep a
flush callback here for Apply / delayed save.
"""

_flush_callback = None


def set_order_list_flush_callback(callback):
    global _flush_callback
    _flush_callback = callback


def flush_order_list_now():
    callback = _flush_callback
    if callback is None:
        return False
    try:
        callback()
        return True
    except Exception:
        return False
