#!/usr/bin/python3

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

HOME = os.path.expanduser("~")
UUID = "thelauncher@sin-apps.com"


def translate(uuid, message):
    try:
        gettext.bindtextdomain(uuid, os.path.join(HOME, ".local/share/locale"))
        translated = gettext.dgettext(uuid, message)
        if translated != message:
            return translated
    except Exception:
        pass
    return _(message)


def find_desklet_path(xlet_type, uuid):
    suffix = f"share/cinnamon/{xlet_type}/{uuid}"
    for prefix in (os.path.join(HOME, ".local"), "/usr"):
        path = os.path.join(prefix, suffix)
        if os.path.isdir(path):
            return path
    return None


class TheLauncherAboutDialog(Gtk.Dialog):
    def __init__(self, metadata, xlet_type):
        name = translate(metadata.get("uuid", UUID), metadata.get("name", "TheLauncher"))
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

        body_parts = []
        description = translate(metadata.get("uuid", UUID), metadata.get("description", ""))
        if description:
            body_parts.append(description)
        comments = metadata.get("comments")
        if comments:
            body_parts.append(translate(metadata.get("uuid", UUID), comments))

        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.set_min_content_height(220)
        content.pack_start(scroll, True, True, 0)

        body = Gtk.Label()
        body.set_text("\n\n".join(body_parts))
        body.set_line_wrap(True)
        body.set_xalign(0.0)
        body.set_yalign(0.0)
        body.set_halign(Gtk.Align.START)
        body.set_valign(Gtk.Align.START)
        body.set_justify(Gtk.Justification.LEFT)
        body.set_selectable(True)
        scroll.add(body)

        self.connect("response", self._on_response)

    def _on_response(self, dialog, response_id):
        self.destroy()
        Gtk.main_quit()


def main():
    parser = argparse.ArgumentParser(description="About dialog for TheLauncher")
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

    dialog = TheLauncherAboutDialog(metadata, args.xlet_type)
    dialog.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
