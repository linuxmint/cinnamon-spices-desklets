#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md

"""Pending Items-list flush for Configure.

Up/Down and toggles update the Gtk model immediately. Writing the full
settings JSON is expensive (especially on network shares), so we keep a
flush callback here for Apply / delayed save.

Pruefung Phase 2, P30: one callback per fence (instance id). Before, every
newly built list replaced a single shared callback, so "Apply" could flush
the list of another fence, and closing one list cleared it for all.
"""

_flush_callbacks = {}


def set_order_list_flush_callback(callback, instance_id=""):
    """Register (callback) or remove (None) the flush of one fence's list."""
    key = str(instance_id or "")
    if callback is None:
        _flush_callbacks.pop(key, None)
    else:
        _flush_callbacks[key] = callback


def clear_order_list_flush_callback(callback, instance_id=""):
    """Remove the registration only if it is still this callback."""
    key = str(instance_id or "")
    if _flush_callbacks.get(key) is callback:
        _flush_callbacks.pop(key, None)


def flush_order_list_now(instance_id=""):
    callback = _flush_callbacks.get(str(instance_id or ""))
    if callback is None:
        return False
    try:
        callback()
        return True
    except Exception:
        return False
