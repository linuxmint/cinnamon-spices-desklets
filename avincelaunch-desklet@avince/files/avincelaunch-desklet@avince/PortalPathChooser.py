#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""Folder Portal (AP10b-1): choose the folder a portal fence shows.

The portal is a view only. This widget writes nothing but the setting
"portal-path" - no folder is created, the chooser offers no "create folder".
"""

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk, Pango
from xapp.SettingsWidgets import SettingsWidget
import importlib.util
import os
import re
import sys

# Uebersetzung (AP09c): eigene Domaene = UUID, Kataloge unter
# ~/.local/share/locale.
import gettext as _gettext

_DOMAIN = "avincelaunch-desklet@avince"
_gettext.bindtextdomain(_DOMAIN, os.path.join(os.path.expanduser("~"), ".local/share/locale"))


def _(text):
    return _gettext.dgettext(_DOMAIN, text)


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
_GUARD = _load_module("portalGuard.py")
set_value_safe = _EDITOR.set_value_safe

# Rote Hinweiszeile statt Warnfenster (Wunsch Angelo, A4-1) - wie
# SubdirectoryChooser.
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

# Value key is type "generic" so the desklet binds it; this widget is a
# separate "custom" UI-only entry in the schema.
VALUE_KEY = "portal-path"


def _normalize_dir(path):
    """Absolute path without resolving links - like pathSource.js."""
    if not path:
        return ""
    return os.path.normpath(os.path.abspath(path))


# AP10b-2: Die Ordnerauswahl liefert NAS-Ordner, die ueber die Seitenleiste
# gewaehlt wurden, als gvfs-Pfad der Dateiverwaltung
# (/run/user/<uid>/gvfs/smb-share:server=...,share=.../...). Der besteht nur,
# solange die Freigabe in der Dateiverwaltung eingehaengt ist - nach einem
# Neustart waere das Portal "nicht erreichbar". Ist dieselbe Freigabe fest
# eingehaengt (fstab bzw. Einhaengetabelle, cifs), wird deren Pfad genommen.
_GVFS_SMB = re.compile(r"^/run/user/\d+/gvfs/smb-share:([^/]+)(/.*)?$")


def _cifs_mounts():
    """{'//server/share' (klein): Einhaengepunkt} aus fstab und mountinfo."""
    mounts = {}
    sources = []
    try:
        with open("/etc/fstab", "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                fields = line.split()
                if len(fields) >= 3 and not fields[0].startswith("#") and fields[2] in ("cifs", "smb3"):
                    sources.append((fields[0], fields[1]))
    except Exception:
        pass
    try:
        with open("/proc/self/mountinfo", "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                left, sep, right = line.partition(" - ")
                if not sep:
                    continue
                right_fields = right.split()
                if len(right_fields) >= 2 and right_fields[0] in ("cifs", "smb3"):
                    sources.append((right_fields[1], left.split()[4]))
    except Exception:
        pass
    for source, mount_point in sources:
        mount_point = mount_point.replace("\\040", " ")
        mounts[source.rstrip("/").lower()] = mount_point
    return mounts


def prefer_fixed_mount(path):
    """gvfs-SMB-Pfad -> Pfad der fest eingehaengten Freigabe, wenn vorhanden."""
    match = _GVFS_SMB.match(path or "")
    if not match:
        return path
    params = {}
    for part in match.group(1).split(","):
        key, sep, value = part.partition("=")
        if sep:
            params[key.strip().lower()] = value.strip()
    server, share = params.get("server"), params.get("share")
    if not server or not share:
        return path
    mount_point = _cifs_mounts().get(("//%s/%s" % (server, share)).lower())
    if not mount_point:
        return path
    rest = (match.group(2) or "").lstrip("/")
    return os.path.normpath(os.path.join(mount_point, rest)) if rest else mount_point


def _is_gvfs_path(path):
    return "/gvfs/" in (path or "")


class PortalPathChooser(SettingsWidget):
    bind_dir = None

    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)
        self.key = VALUE_KEY
        self.settings = settings

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)

        label = Gtk.Label(label=info.get("description") or _("Portal folder"))
        label.set_halign(Gtk.Align.START)
        label.set_xalign(0)
        box.pack_start(label, False, False, 0)

        help_label = Gtk.Label(label=_(
            "Any existing folder, local or on the NAS. It is shown as a view "
            "only - aVinceLaunch never changes anything in it."))
        help_label.set_line_wrap(True)
        help_label.set_xalign(0)
        help_label.get_style_context().add_class("dim-label")
        box.pack_start(help_label, False, False, 0)

        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.path_label = Gtk.Label()
        self.path_label.set_halign(Gtk.Align.START)
        self.path_label.set_xalign(0)
        self.path_label.set_hexpand(True)
        self.path_label.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
        self.path_label.set_selectable(True)
        attrs = Pango.AttrList()
        attrs.insert(Pango.attr_weight_new(Pango.Weight.BOLD))
        self.path_label.set_attributes(attrs)
        if info.get("tooltip"):
            self.path_label.set_tooltip_text(info.get("tooltip"))
        row.pack_start(self.path_label, True, True, 0)

        self.browse_button = Gtk.Button(label=_("Choose…"))
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

        if settings.has_key(VALUE_KEY):
            settings.listen(VALUE_KEY, self._on_path_changed)
        self._refresh_display()

    def _configured(self):
        try:
            return _normalize_dir((self.settings.get_value(VALUE_KEY) or "").strip())
        except Exception:
            return ""

    def _set_status(self, text, warning=False):
        context = self.status.get_style_context()
        if warning:
            _install_error_css()
            context.remove_class("dim-label")
            context.add_class("avincelaunch-error")
        else:
            context.remove_class("avincelaunch-error")
            context.add_class("dim-label")
        self.status.set_text(text)

    def _refresh_display(self):
        path = self._configured()
        self.path_label.set_text(path or _("(none selected)"))
        if not path:
            self._set_status(_("No folder chosen yet."))
        elif _GUARD.contains_base_directory(path):
            # Pruefung Phase 2, P10/P27: erlaubt, aber sichtbar erklaert.
            self._set_status(_(
                "This folder contains the aVinceLaunch base folder. The link "
                "groups stay writable; the portal only shows them. Everything "
                "else in it is view only."), warning=True)
        elif _is_gvfs_path(path):
            self._set_status(_(
                "Network share of the file manager: only reachable while it is "
                "mounted there. A permanently mounted path (e.g. /mnt/…) is more "
                "reliable."))
        elif _GUARD.is_network_path(path):
            # P28: auf der NAS hier nicht nachsehen - der Dialog fror sonst ein,
            # wenn sie nicht erreichbar ist. Das prueft der Fence im Hintergrund.
            self._set_status(_(
                "View only – nothing in this folder is changed. Network drive: "
                "the fence checks it in the background."))
        elif os.path.isdir(path):
            self._set_status(_("View only – nothing in this folder is changed."))
        else:
            self._set_status(_("Folder not reachable at the moment."))

    def _on_path_changed(self, key, value):
        self._refresh_display()

    def on_browse_clicked(self, *args):
        parent = self.get_toplevel()
        if not isinstance(parent, Gtk.Window):
            parent = None

        dialog = Gtk.FileChooserDialog(
            title=_("Choose the folder to show"),
            transient_for=parent,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        dialog.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        dialog.add_button(_("_Select"), Gtk.ResponseType.OK)
        # Portal = reine Ansicht: hier wird nie ein Ordner angelegt.
        dialog.set_create_folders(False)
        dialog.set_local_only(True)

        start = self._configured()
        if not (start and os.path.isdir(start)):
            start = os.path.expanduser("~")
        dialog.set_current_folder(start)

        response = dialog.run()
        chosen = None
        if response == Gtk.ResponseType.OK:
            name = dialog.get_filename() or dialog.get_current_folder()
            if name and os.path.isdir(name):
                chosen = _normalize_dir(prefer_fixed_mount(_normalize_dir(name)))
                if not os.path.isdir(chosen):
                    chosen = _normalize_dir(name)
        dialog.destroy()

        if response != Gtk.ResponseType.OK:
            return
        if not chosen:
            self._set_status(_("No folder selected."))
            return

        set_value_safe(self.settings, VALUE_KEY, chosen)
        self._refresh_display()
