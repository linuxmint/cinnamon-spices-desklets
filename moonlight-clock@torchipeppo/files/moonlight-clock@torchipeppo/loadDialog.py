#!/usr/bin/python3

import sys
import traceback

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("GLib", "2.0")
from gi.repository import Gtk, GLib

import gettext
UUID = "moonlight-clock@torchipeppo"
gettext.install(UUID, GLib.get_home_dir() + '/.local/share/locale')



def log(message):
    with open("/tmp/loadDialog-log.txt", "a") as f:
        f.write(str(message) + "\n")
    print(message, file=sys.stderr)

def main():
    json_filter = Gtk.FileFilter()
    json_filter.add_mime_type("application/json")
    json_filter.set_name(_("JSON files"))

    loader = Gtk.FileChooserDialog(
        _('Load'),
        None,
        Gtk.FileChooserAction.OPEN,
        (
            Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
            Gtk.STOCK_OPEN, Gtk.ResponseType.OK
        ),
    )
    loader.add_filter(json_filter)
    response = loader.run()
    if response == Gtk.ResponseType.OK:
        file_path = loader.get_filename()
        with open(file_path, "r") as f:
            # don't really care that it's JSON here, the JS side can handle it.
            # stdout is received by spawnAsync there, btw.
            print(f.read())

    loader.destroy()

main()
