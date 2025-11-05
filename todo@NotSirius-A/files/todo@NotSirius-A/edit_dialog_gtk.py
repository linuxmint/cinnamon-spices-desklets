import sys

import gi
gi.require_version('Gtk', '3.0')
gi.require_version("GLib", "2.0")
from gi.repository import Gtk, Gio, GLib



UUID = "todo@NotSirius-A"
DIALOG_UI_PATH = GLib.get_home_dir() + '/.local/share/cinnamon/desklets/' + UUID + "/edit_dialog_gtk.ui"


class EditorDialog:
    def __init__(self, text=""):
        self.out_text = text


        self.tree = Gtk.Builder()
        self.tree.set_translation_domain('cinnamon') # let it translate!
        self.tree.add_from_file(DIALOG_UI_PATH)

        self.dialog = self.tree.get_object("dialog")

        self.name_entry = self.tree.get_object("name_entry")

        self.name_entry.set_text(text)


        self.tree.connect_signals(self)

        self.dialog.show_all()
        self.dialog.connect("destroy", Gtk.main_quit)
        self.dialog.connect("key_release_event", self.on_key_release_event)
        Gtk.main()



    def on_key_release_event(self, widget, event):
        if event.keyval == 65293: # Enter button
            self.on_edit_ok_clicked(widget)

    def on_edit_close_clicked(self, widget):
        self.dialog.destroy()

    def on_edit_ok_clicked(self, widget):
        out_text = self.name_entry.get_text()

        if len(out_text) > 1:
            self.out_text = out_text
        else:
            self.out_text = " "


        self.dialog.destroy()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        dialog = EditorDialog(sys.argv[1])
    else:
        dialog = EditorDialog()

    
    print(dialog.out_text, end="")
