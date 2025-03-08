#!/usr/bin/python3

import sys
import json
import traceback

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("GLib", "2.0")
from gi.repository import Gtk, GLib

import gettext
# hardcoded UUID for translation purposes only,
# fails silently w/ no ill effects if not exists
UUID = "moonlight-clock@torchipeppo"
gettext.install(UUID, GLib.get_home_dir() + '/.local/share/locale')



def log(message):
    with open("/tmp/saveDialog-log.txt", "a") as f:
        f.write(str(message) + "\n")
    print(message, file=sys.stderr)

def main():
    to_save = json.loads(sys.argv[1])

    json_filter = Gtk.FileFilter()
    json_filter.add_mime_type("application/json")
    json_filter.set_name(_("JSON files"))

    saver = Gtk.FileChooserDialog(
        _('Save'),
        None,
        Gtk.FileChooserAction.SAVE,
        (
            Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
            Gtk.STOCK_SAVE, Gtk.ResponseType.OK
        ),
    )
    saver.add_filter(json_filter)
    saver.set_do_overwrite_confirmation(True)
    response = saver.run()
    if response == Gtk.ResponseType.OK:
        file_path = saver.get_filename()
        if not file_path.endswith(".json"):
            file_path += ".json"
        with open(file_path, "w") as f:
            json.dump(to_save, f, indent=4)

    saver.destroy()

main()
