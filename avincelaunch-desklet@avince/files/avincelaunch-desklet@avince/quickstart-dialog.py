#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""Schnellstart fuer aVinceLaunch (AP09d).

Sieben Punkte mit Symbol und ein bis zwei Saetzen, dazu ein Knopf zur
ausfuehrlichen Hilfe (help/<sprache>.html im Standardbrowser). Gestartet
ueber Rechtsklick -> Schnellstart ... und einmal von selbst bei einer
Neuinstallation (lib/layoutManager.js).
"""

import gettext
import os
import sys

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gio, GLib, GdkPixbuf

HOME = os.path.expanduser("~")
UUID = "avincelaunch-desklet@avince"
DESKLET_DIR = os.path.dirname(os.path.abspath(__file__))

gettext.bindtextdomain(UUID, os.path.join(HOME, ".local/share/locale"))


def _(text):
    return gettext.dgettext(UUID, text)


# (Symbol, Ueberschrift, Text). Begriffe genau wie im Kontextmenue und im
# Einstellungsdialog, damit man sie dort wiederfindet.
POINTS = [
    ("folder-symbolic",
     _("Content"),
     _("Each fence shows one folder. Put applications, documents or folders "
       "there – or use Configure → Items.")),
    # Pruefung Phase 2, A8-2: weitere Fences (Angelo 09.10.).
    ("edit-copy-symbolic",
     _("More fences"),
     _("Right-click → Duplicate fence: same look, a folder of its own. Or "
       "System Settings → Desklets → aVinceLaunch → +.")),
    ("input-mouse-symbolic",
     _("Launch"),
     _("A click starts an application or opens a document. Folders open "
       "inside the fence.")),
    ("changes-prevent-symbolic",
     _("Move and resize"),
     _("New fences are locked. Right-click → Lock ▸ Position off, then "
       "drag the title row; resize at an edge or the corner. Hold Ctrl to "
       "move freely, without snapping.")),
    ("view-grid-symbolic",
     _("Arrangement"),
     _("Right-click → Align all fences, or Restore arrangement (recent "
       "changes).")),
    ("preferences-desktop-appearance-symbolic",
     _("Look"),
     _("Right-click → Configure… for colours and font. Reset appearance… "
       "brings back the standard look.")),
    ("dialog-warning-symbolic",
     _("Caution"),
     _("“Reset to defaults” (☰ in Configure) also resets folder, name, size "
       "and position. “–” in System Settings → Desklets removes ALL fences – "
       "to remove one, use “Remove this fence…” (right-click a free spot).")),
]


def help_page():
    """help/<sprache>.html nach Systemsprache, sonst Englisch."""
    for var in ("LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"):
        value = os.environ.get(var, "")
        for lang in value.split(":"):
            code = lang[:2].lower()
            if len(code) == 2 and code.isalpha():
                path = os.path.join(DESKLET_DIR, "help", code + ".html")
                if os.path.isfile(path):
                    return path
    return os.path.join(DESKLET_DIR, "help", "en.html")


class QuickStartDialog(Gtk.Dialog):
    RESPONSE_HELP = 1
    # N17: "Startaufstellung ..." - der Dialog endet mit Code 2, das Desklet
    # oeffnet dann startaufstellung-dialog.py.
    RESPONSE_START_LAYOUT = 2

    def __init__(self):
        super().__init__(title=_("Quick start – aVinceLaunch"))
        self.result = 0
        self.set_default_size(560, -1)
        self.set_resizable(False)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.add_button(_("Starter layout…"), self.RESPONSE_START_LAYOUT)
        self.add_button(_("Detailed help"), self.RESPONSE_HELP)
        self.add_button(_("_Close"), Gtk.ResponseType.CLOSE)
        self.set_default_response(Gtk.ResponseType.CLOSE)

        content = self.get_content_area()
        content.set_spacing(14)
        content.set_margin_top(18)
        content.set_margin_bottom(12)
        content.set_margin_start(20)
        content.set_margin_end(20)

        # Kopf wie im Ueber-Dialog: Symbol, Name, darunter "Schnellstart".
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        header.set_halign(Gtk.Align.CENTER)
        icon_path = os.path.join(DESKLET_DIR, "icon.png")
        if os.path.isfile(icon_path):
            header.pack_start(Gtk.Image.new_from_pixbuf(
                GdkPixbuf.Pixbuf.new_from_file_at_size(icon_path, 48, 48)),
                False, False, 0)
        heading = Gtk.Label()
        heading.set_markup(
            '<span size="x-large" weight="bold">aVinceLaunch</span>\n'
            '<span size="large">%s</span>'
            % GLib.markup_escape_text(_("Quick start")))
        heading.set_xalign(0.5)
        heading.set_justify(Gtk.Justification.CENTER)
        header.pack_start(heading, False, False, 0)
        content.pack_start(header, False, False, 0)

        grid = Gtk.Grid(column_spacing=14, row_spacing=12)
        content.pack_start(grid, False, False, 0)

        for row, (icon_name, title, text) in enumerate(POINTS):
            icon = Gtk.Image.new_from_icon_name(icon_name, Gtk.IconSize.DND)
            icon.set_valign(Gtk.Align.START)
            grid.attach(icon, 0, row, 1, 1)

            label = Gtk.Label()
            label.set_markup("<b>%s</b>\n%s" % (GLib.markup_escape_text(title),
                                               GLib.markup_escape_text(text)))
            label.set_line_wrap(True)
            label.set_max_width_chars(62)
            label.set_xalign(0.0)
            label.set_hexpand(True)
            grid.attach(label, 1, row, 1, 1)

        self.connect("response", self._on_response)

    def _on_response(self, dialog, response_id):
        if response_id == self.RESPONSE_HELP:
            try:
                Gio.AppInfo.launch_default_for_uri(
                    GLib.filename_to_uri(help_page(), None), None)
            except GLib.Error as e:
                print("aVinceLaunch: help could not be opened: %s" % e.message,
                      file=sys.stderr)
            return
        if response_id == self.RESPONSE_START_LAYOUT:
            self.result = 2
        self.destroy()
        Gtk.main_quit()


def main():
    dialog = QuickStartDialog()
    dialog.connect("delete-event", lambda *a: Gtk.main_quit())
    dialog.show_all()
    Gtk.main()
    return dialog.result


if __name__ == "__main__":
    sys.exit(main())
