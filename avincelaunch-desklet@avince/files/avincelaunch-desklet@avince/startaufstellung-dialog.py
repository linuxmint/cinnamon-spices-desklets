#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""Startaufstellung fuer aVinceLaunch (N17, Angelo 13.10.).

Neun Fences mit Titel; die installierten Programme werden nach ihrer
Kategorie vorgeschlagen (appSort.py) - der Nutzer waehlt ab, schiebt in
einen anderen Fence oder laesst ganze Fences weg. "Anlegen" legt Ordner
und Verknuepfungen an und schreibt einen Auftrag; die Fences selbst legt
danach das Desklet an (desklet.js _runStartLayout).

Aufruf (vom Desklet): startaufstellung-dialog.py PLAN AUFTRAG
  PLAN     JSON vom Desklet: {"places": n, "size": [w, h], "reuse": bool}
  AUFTRAG  wohin der Auftrag geschrieben wird
Rueckgabe: 0 = angelegt (Auftrag liegt bereit), 1 = abgebrochen, 2 = Fehler.
"""

import gettext
import json
import os
import sys

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gio, GLib, Pango

sys.dont_write_bytecode = True
DESKLET_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DESKLET_DIR)
import appSort  # noqa: E402
import portalGuard  # noqa: E402

UUID = "avincelaunch-desklet@avince"
gettext.bindtextdomain(UUID, os.path.join(os.path.expanduser("~"), ".local/share/locale"))


def _(text):
    return gettext.dgettext(UUID, text)


# Titel der neun Fences - hier ausgeschrieben, damit makepot sie findet.
TITLES = {
    "internet": _("Internet"),
    "communication": _("Communication"),
    "office": _("Office"),
    "graphics": _("Graphics & Photos"),
    "multimedia": _("Multimedia"),
    "games": _("Games"),
    "development": _("Development"),
    "tools": _("Tools"),
    "system": _("System"),
}
# Entscheidung 13.10.: Titel in Grossbuchstaben; der Ordnername folgt daraus
# (GRAFIK & FOTOS -> GRAFIK_FOTOS).
TITLES = {key: title.upper() for key, title in TITLES.items()}


class StartLayoutDialog(Gtk.Dialog):

    def __init__(self, plan, order_path):
        super().__init__(title=_("Starter layout – aVinceLaunch"))
        self.plan = plan
        self.order_path = order_path
        self.result = 1
        self.set_default_size(720, 680)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.add_button(_("_Cancel"), Gtk.ResponseType.CANCEL)
        self.create_button = self.add_button(_("Create"), Gtk.ResponseType.OK)
        self.set_default_response(Gtk.ResponseType.CANCEL)

        apps = appSort.collect()
        # Je Programm: Haekchen und Ziel-Fence. Einstellungsseiten nur
        # aufgelistet, nicht vorgeschlagen (E: Angelo 13.10.).
        self.apps = apps
        self.app_check = {}
        self.app_target = {}
        self.fence_check = {}
        self.fence_count = {}
        self.app_rows = {}

        content = self.get_content_area()
        content.set_spacing(10)
        for side in ("top", "bottom", "start", "end"):
            getattr(content, "set_margin_" + side)(14)

        intro = Gtk.Label()
        intro.set_line_wrap(True)
        intro.set_xalign(0.0)
        intro.set_max_width_chars(80)
        intro.set_text(_("aVinceLaunch can set up nine fences with a title and sort your installed "
                         "applications into them. Untick what you do not want, or choose another "
                         "fence for an application. Nothing is created until you click “Create”."))
        content.pack_start(intro, False, False, 0)
        # Vor den Haekchen anlegen - deren "toggled" schreibt hinein.
        self.summary = Gtk.Label()
        self.summary.set_xalign(0.0)
        self.summary.set_line_wrap(True)

        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroller.set_vexpand(True)
        content.pack_start(scroller, True, True, 0)
        self.sections = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        scroller.add(self.sections)

        self.fence_boxes = {}
        for key, _title in appSort.FENCES:
            header = Gtk.CheckButton()
            header_label = Gtk.Label()
            header_label.set_xalign(0.0)
            header.add(header_label)
            header.connect("toggled", lambda *a: self._update_summary())
            self.fence_check[key] = header
            self.fence_count[key] = header_label
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            box.set_margin_start(28)
            self.fence_boxes[key] = box
            self.sections.pack_start(header, False, False, 4)
            self.sections.pack_start(box, False, False, 0)

        self.extra_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        self.extra_box.set_margin_start(28)
        settings_pages = [a for a in apps if a["settings_page"]]
        if settings_pages:
            expander = Gtk.Expander(label=_("Cinnamon settings pages (not suggested): %d") % len(settings_pages))
            expander.add(self.extra_box)
            self.sections.pack_start(expander, False, False, 8)

        for app in apps:
            self._make_row(app)
        for key, _title in appSort.FENCES:
            count = sum(1 for a in apps if self.app_target[a["id"]] == key and self.app_check[a["id"]].get_active())
            # E4: Fence ohne vorgeschlagenes Programm vorab nicht anlegen.
            self.fence_check[key].set_active(count > 0)

        content.pack_start(self.summary, False, False, 0)
        self._update_summary()
        self.connect("response", self._on_response)

    def _make_row(self, app):
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        check = Gtk.CheckButton()
        check.set_active(not app["settings_page"])
        check.connect("toggled", lambda *a: self._update_summary())
        row.pack_start(check, False, False, 0)
        if app["icon"] is not None:
            # N20 (Tower 14.10., Skalierung 2): Fehlt ein Symbol im Thema (Mint-Y
            # ohne Flameshot/PDF Arranger), nimmt GTK das hicolor-Bild in seiner
            # eigenen Groesse (128 statt 24). Feste Groesse erzwingen.
            image = Gtk.Image.new_from_gicon(app["icon"], Gtk.IconSize.LARGE_TOOLBAR)
            image.set_pixel_size(24)
            row.pack_start(image, False, False, 0)
        name = Gtk.Label(label=app["name"])
        name.set_xalign(0.0)
        name.set_ellipsize(Pango.EllipsizeMode.END)
        name.set_hexpand(True)
        row.pack_start(name, True, True, 0)
        combo = Gtk.ComboBoxText()
        for key, _title in appSort.FENCES:
            combo.append(key, TITLES[key])
        combo.set_active_id(app["fence"])
        combo.connect("changed", self._on_target_changed, app)
        row.pack_start(combo, False, False, 0)
        self.app_check[app["id"]] = check
        self.app_target[app["id"]] = app["fence"]
        self.app_rows[app["id"]] = row
        (self.extra_box if app["settings_page"] else self.fence_boxes[app["fence"]]).pack_start(row, False, False, 0)

    def _on_target_changed(self, combo, app):
        key = combo.get_active_id()
        if not key or key == self.app_target[app["id"]]:
            return
        old_key = self.app_target[app["id"]]
        self.app_target[app["id"]] = key
        # Wer das letzte Programm wegschiebt, will den leeren Fence meist
        # nicht (wie E4 beim Oeffnen).
        if not any(self.app_target[a["id"]] == old_key and self.app_check[a["id"]].get_active()
                   for a in self.apps):
            self.fence_check[old_key].set_active(False)
        row = self.app_rows[app["id"]]
        row.get_parent().remove(row)
        self.fence_boxes[key].pack_start(row, False, False, 0)
        self.app_check[app["id"]].set_active(True)
        self.fence_check[key].set_active(True)
        row.show_all()
        self._update_summary()

    def _selection(self):
        fences = []
        for key, _title in appSort.FENCES:
            if not self.fence_check[key].get_active():
                continue
            paths = [a["path"] for a in self.apps
                     if self.app_target[a["id"]] == key and self.app_check[a["id"]].get_active()]
            fences.append({"key": key, "title": TITLES[key], "apps": paths})
        return fences

    def _update_summary(self):
        for key, _title in appSort.FENCES:
            n = sum(1 for a in self.apps if self.app_target[a["id"]] == key and self.app_check[a["id"]].get_active())
            self.fence_count[key].set_markup("<b>%s</b>  (%s)" % (
                GLib.markup_escape_text(TITLES[key]),
                GLib.markup_escape_text(_("%d applications") % n)))
        fences = self._selection()
        links = sum(len(f["apps"]) for f in fences)
        places = int(self.plan.get("places", 0))
        w, h = self.plan.get("size", [360, 210])
        text = _("Creates %(fences)d fences with %(links)d launchers, each %(w)d × %(h)d, locked.") % {
            "fences": len(fences), "links": links, "w": w, "h": h}
        if self.plan.get("reuse"):
            text += " " + _("The empty fence you started from becomes the first one.")
        ok = 0 < len(fences) <= places
        if len(fences) > places:
            text = "<span foreground='red' weight='bold'>%s</span>" % GLib.markup_escape_text(
                _("There is only room for %d fences on your screens. Please untick some fences.") % places)
        else:
            text = GLib.markup_escape_text(text)
        self.summary.set_markup(text)
        self.create_button.set_sensitive(ok)

    def _on_response(self, dialog, response_id):
        if response_id == Gtk.ResponseType.OK:
            base = portalGuard.base_directory()
            default = os.path.join(portalGuard._xdg_data_home(), portalGuard.APP_DIR_NAME)
            try:
                order, errors = appSort.create_layout(base, default, self._selection(), self.order_path)
            except Exception as e:
                order, errors = None, [str(e)]
            if order is None:
                self._error(_("Nothing was created."),
                            _("The base folder %s is missing (e.g. a NAS that is not mounted).") % base
                            if errors and errors[0].startswith("base-missing:") else "\n".join(errors))
                self.result = 2
            else:
                if errors:
                    print("aVinceLaunch: starter layout: " + "; ".join(errors), file=sys.stderr)
                self.result = 0
        self.destroy()
        Gtk.main_quit()

    def _error(self, title, text):
        box = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.ERROR,
                                buttons=Gtk.ButtonsType.OK, text=title)
        box.format_secondary_text(text)
        box.run()
        box.destroy()


def main(argv):
    if len(argv) < 3:
        print("Usage: startaufstellung-dialog.py PLAN ORDER", file=sys.stderr)
        return 2
    try:
        with open(argv[1], "r", encoding="utf-8") as handle:
            plan = json.load(handle)
    except Exception as e:
        print("aVinceLaunch: starter layout plan unreadable: %s" % e, file=sys.stderr)
        return 2
    dialog = StartLayoutDialog(plan, argv[2])
    dialog.connect("delete-event", lambda *a: Gtk.main_quit())
    dialog.show_all()
    Gtk.main()
    return dialog.result


if __name__ == "__main__":
    sys.exit(main(sys.argv))
