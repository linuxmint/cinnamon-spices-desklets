#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only AND MIT
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik
# Portions copyright (c) MHK924 (TheLauncher), MIT - see THIRD-PARTY-NOTICES.md
# Structure follows Cinnamon's xlet-about-dialog (Linux Mint, GPL-2.0-or-later).

import argparse
import datetime
import gettext
import json
import os
import sys

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GdkPixbuf, GLib

gettext.install("cinnamon", "/usr/share/locale")

UUID = "avincelaunch-desklet@avince"
# Dieselbe Ko-fi-Seite wie in README.md und .github/FUNDING.yml.
KOFI_URL = "https://ko-fi.com/avince"


def _split_lead(text):
    """Trennt "Stichwort – Rest" (auch mit " - "); sonst (None, text).

    V4d: auch "Stichwort: Rest" - die englische Beschreibung in metadata.json
    muss fuer Spices ASCII sein ("Organize, access, launch: ...").
    """
    for sep in (" – ", " - ", ": "):
        head, found, tail = text.partition(sep)
        if found:
            return head.strip(), tail.strip()
    return None, text


def body_markup(description, comments):
    """Beschreibung und Kommentar als gegliederter Text (AP09c).

    Slogan fett und groesser in eigener Zeile, darunter die Beschreibung;
    Aufzaehlungen mit Punkt und fettem Stichwort; der letzte Absatz
    (Herkunft) klein und gedaempft.
    """
    esc = GLib.markup_escape_text
    parts = []
    if description:
        slogan, rest = _split_lead(description)
        if slogan:
            parts.append('<span size="large" weight="bold">%s</span>' % esc(slogan))
            parts.append(esc(rest[:1].upper() + rest[1:]))
        else:
            parts.append(esc(description))
    if comments:
        paragraphs = [p.strip() for p in comments.split("\n\n") if p.strip()]
        for index, paragraph in enumerate(paragraphs):
            lines = paragraph.split("\n")
            if all(line.startswith("- ") for line in lines):
                items = []
                for line in lines:
                    head, tail = _split_lead(line[2:])
                    if head:
                        items.append("•  <b>%s</b> – %s" % (esc(head), esc(tail)))
                    else:
                        items.append("•  " + esc(line[2:]))
                # V4d (Angelo 14.10.): Leerzeile zwischen den Punkten.
                parts.append("\n\n".join(items))
            elif index == len(paragraphs) - 1 and len(paragraphs) > 1:
                parts.append('<span size="small" alpha="70%%">%s</span>' % esc(paragraph))
            else:
                parts.append(esc(paragraph))
    return "\n\n".join(parts)


def translate(uuid, message):
    # Pruefung Phase 3, N4: wie desklet.js - Cinnamon (Spices.py) und
    # cinnamon-xlet-makepot legen die Uebersetzung fest unter
    # ~/.local/share/locale ab, auch wenn $XDG_DATA_HOME gesetzt ist.
    try:
        gettext.bindtextdomain(
            uuid, os.path.join(GLib.get_home_dir(), ".local", "share", "locale"))
        translated = gettext.dgettext(uuid, message)
        if translated != message:
            return translated
    except Exception:
        pass
    return _(message)


def find_desklet_path(xlet_type, uuid):
    # P61/N4: Cinnamon laedt Desklets aus $XDG_DATA_HOME/cinnamon, Spices
    # installiert sie fest nach ~/.local/share/cinnamon - beide pruefen,
    # danach die Systemordner.
    suffix = os.path.join("cinnamon", xlet_type, uuid)
    prefixes = [GLib.get_user_data_dir(), os.path.join(GLib.get_home_dir(), ".local", "share")]
    prefixes += list(GLib.get_system_data_dirs())
    for prefix in dict.fromkeys(prefixes):
        path = os.path.join(prefix, suffix)
        if os.path.isdir(path):
            return path
    return None


class AboutDialog(Gtk.Dialog):
    def __init__(self, metadata, xlet_type):
        name = translate(metadata.get("uuid", UUID), metadata.get("name", "aVinceLaunch"))
        super().__init__(
            title=_("About %s") % name,
            modal=True,
            destroy_with_parent=True
        )
        self.set_default_size(520, 420)
        self.add_button(_("_Close"), Gtk.ResponseType.CLOSE)

        content = self.get_content_area()
        content.set_spacing(12)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        content.set_margin_start(16)
        content.set_margin_end(16)

        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        header.set_halign(Gtk.Align.START)
        content.pack_start(header, False, False, 0)

        icon_path = os.path.join(metadata["path"], "icon.png")
        if os.path.isfile(icon_path):
            icon = Gtk.Image.new_from_pixbuf(
                GdkPixbuf.Pixbuf.new_from_file_at_size(icon_path, 48, 48)
            )
            header.pack_start(icon, False, False, 0)

        title_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        title_box.set_halign(Gtk.Align.START)

        title = Gtk.Label()
        title.set_markup("<b>%s</b>" % GLib.markup_escape_text(name))
        title.set_halign(Gtk.Align.START)
        title.set_xalign(0.0)
        title_box.pack_start(title, False, False, 0)

        uuid_label = Gtk.Label(label=metadata.get("uuid", UUID))
        uuid_label.set_halign(Gtk.Align.START)
        uuid_label.set_xalign(0.0)
        uuid_label.get_style_context().add_class("dim-label")
        title_box.pack_start(uuid_label, False, False, 0)

        if metadata.get("version"):
            version = metadata["version"]
            if "last-edited" in metadata:
                timestamp = datetime.datetime.fromtimestamp(
                    metadata["last-edited"]
                ).isoformat(" ")
                version_text = _("Version %s (%s)") % (version, timestamp)
            else:
                version_text = _("Version %s") % version
            version_label = Gtk.Label(label=version_text)
            version_label.set_halign(Gtk.Align.START)
            version_label.set_xalign(0.0)
            version_label.get_style_context().add_class("dim-label")
            title_box.pack_start(version_label, False, False, 0)

        header.pack_start(title_box, False, False, 0)

        description = translate(metadata.get("uuid", UUID), metadata.get("description", ""))
        comments = metadata.get("comments")
        if comments:
            comments = translate(metadata.get("uuid", UUID), comments)

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.set_min_content_height(220)
        content.pack_start(scroll, True, True, 0)

        body = Gtk.Label()
        body.set_markup(body_markup(description, comments))
        body.set_line_wrap(True)
        body.set_xalign(0.0)
        body.set_yalign(0.0)
        body.set_halign(Gtk.Align.START)
        body.set_valign(Gtk.Align.START)
        body.set_justify(Gtk.Justification.LEFT)
        body.set_selectable(True)
        scroll.add(body)

        # Schritt 4, V2: Unterstuetzung ueber Ko-fi - ein schlichter Verweis,
        # der die Seite im Browser oeffnet; kein eigenes Fenster, keine
        # Nachfrage.
        kofi = Gtk.LinkButton.new_with_label(
            KOFI_URL, translate(metadata.get("uuid", UUID), _("Support aVinceLaunch on Ko-fi")))
        kofi.set_halign(Gtk.Align.START)
        content.pack_start(kofi, False, False, 0)

        self.connect("response", self._on_response)

    def _on_response(self, dialog, response_id):
        self.destroy()
        Gtk.main_quit()


def main():
    parser = argparse.ArgumentParser(description="About dialog for aVinceLaunch")
    parser.add_argument(
        "xlet_type",
        nargs="?",
        default="desklets",
        choices=["applets", "desklets", "extensions", "actions", "themes"],
    )
    parser.add_argument("uuid", nargs="?", default=UUID)
    args = parser.parse_args()

    path = find_desklet_path(args.xlet_type, args.uuid)
    if not path:
        print(_("Unable to locate %s %s") % (args.xlet_type, args.uuid))
        sys.exit(1)

    with open(os.path.join(path, "metadata.json"), encoding="utf-8") as handle:
        metadata = json.load(handle)

    metadata["path"] = path
    metadata["type"] = args.xlet_type

    dialog = AboutDialog(metadata, args.xlet_type)
    dialog.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
