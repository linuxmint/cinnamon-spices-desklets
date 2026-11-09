#!/usr/bin/env python3
# Notes and Calls - helper for the desklet notes-and-calls@ersenender
# Copyright (C) 2026 ersenender
# SPDX-License-Identifier: GPL-3.0-or-later
"""Helfer für das Notizen-Desklet: Fenster zum Schreiben eines Zettels oder einer Gesprächsnotiz.

  helper.py zettel     freier Notizzettel
  helper.py anruf      Gesprächsnotiz eines Telefonats

Auf stdin steht die bisherige Notiz als JSON ({} = neu). Ergebnis als JSON nach stdout:
  zettel: {"text": …}
  anruf:  {"wer": …, "nummer": …, "wegen": …, "text": …, "rueckruf": bool}
oder {"loeschen": true}. Abbruch = Rückgabewert 1, keine Ausgabe.
Speichern geht auch mit Strg+Eingabe – praktisch, wenn der Hörer in der anderen Hand ist.
(Tippen direkt im Desklet ist in Cinnamon unzuverlässig, deshalb ein eigenes Fenster.)
"""
import json
import sys

import gettext
import locale
import os

UUID = "notes-and-calls@ersenender"
_ = gettext.translation(UUID, os.path.expanduser("~/.local/share/locale"), fallback=True).gettext
# Sprache des Systems als Kürzel ("de", "en", "tr" …), z. B. für Ortsnamen eines Webdienstes
SPRACHE = (locale.getlocale(locale.LC_MESSAGES)[0] or os.environ.get("LANG") or "en")[:2].lower()

TEXTE = dict(
    zettel=_("Note"),
    anruf=_("Call note"),
    ok=_("Save"),
    abbr=_("Cancel"),
    loeschen=_("Delete"),
    wer=_("Who called?"),
    nummer=_("Phone number"),
    wegen=_("What is it about?"),
    rueckruf=_("Asks to be called back"),
    tipp=_("Save with Ctrl+Enter"),
    platz=_("Note …"),
    platz_anruf=_("What was discussed? What needs to be done?"),
)


def fenster(art, lang):
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, Gtk

    T = TEXTE
    try:
        alt = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        alt = {}
    vorhanden = bool(alt.get("id"))

    win = Gtk.Dialog(title=T[art], icon_name="accessories-text-editor")
    win.set_default_size(440, 340 if art == "zettel" else 420)
    win.set_keep_above(True)
    if vorhanden:
        knopf = win.add_button(T["loeschen"], Gtk.ResponseType.REJECT)
        knopf.get_style_context().add_class("destructive-action")
    win.add_button(T["abbr"], Gtk.ResponseType.CANCEL)
    ok = win.add_button(T["ok"], Gtk.ResponseType.OK)
    ok.get_style_context().add_class("suggested-action")
    win.set_default_response(Gtk.ResponseType.OK)

    inhalt = win.get_content_area()
    inhalt.set_border_width(12)
    inhalt.set_spacing(8)

    felder = {}
    if art == "anruf":
        for key in ("wer", "nummer", "wegen"):
            f = Gtk.Entry(text=alt.get(key) or "", placeholder_text=T[key])
            if key == "nummer":
                f.set_input_purpose(Gtk.InputPurpose.PHONE)
            felder[key] = f
            inhalt.pack_start(f, False, False, 0)

    text = Gtk.TextView(wrap_mode=Gtk.WrapMode.WORD_CHAR, left_margin=8, right_margin=8, top_margin=6, bottom_margin=6)
    text.get_buffer().set_text(alt.get("text") or "")
    rahmen = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, shadow_type=Gtk.ShadowType.IN)
    rahmen.add(text)
    inhalt.pack_start(rahmen, True, True, 0)

    rueckruf = None
    if art == "anruf":
        rueckruf = Gtk.CheckButton(label=T["rueckruf"], active=bool(alt.get("rueckruf")))
        inhalt.pack_start(rueckruf, False, False, 0)
    tipp = Gtk.Label(label=T["tipp"], xalign=0)
    tipp.get_style_context().add_class("dim-label")
    inhalt.pack_start(tipp, False, False, 0)

    # Strg+Eingabe speichert, Eingabe in den einzeiligen Feldern springt ins nächste Feld
    def taste(_w, ereignis):
        if ereignis.keyval in (Gdk.KEY_Return, Gdk.KEY_KP_Enter) and ereignis.state & Gdk.ModifierType.CONTROL_MASK:
            win.response(Gtk.ResponseType.OK)
            return True
        return False
    win.connect("key-press-event", taste)
    reihenfolge = [felder[k] for k in ("wer", "nummer", "wegen") if k in felder] + [text]
    for i, f in enumerate(reihenfolge[:-1]):
        f.connect("activate", lambda _f, n=reihenfolge[i + 1]: n.grab_focus())

    win.show_all()
    (reihenfolge[0] if not vorhanden else text).grab_focus()
    antwort = win.run()
    puffer = text.get_buffer()
    inhalt_text = puffer.get_text(puffer.get_start_iter(), puffer.get_end_iter(), False).strip()[:4000]
    werte = {k: " ".join(f.get_text().split())[:200] for k, f in felder.items()}
    will_rueckruf = rueckruf.get_active() if rueckruf is not None else False
    win.destroy()

    if antwort == Gtk.ResponseType.REJECT:
        print(json.dumps({"loeschen": True}))
        return 0
    if antwort != Gtk.ResponseType.OK:
        return 1
    if art == "zettel":
        if not inhalt_text:
            return 1
        print(json.dumps({"text": inhalt_text}, ensure_ascii=False))
        return 0
    if not (inhalt_text or werte["wer"] or werte["nummer"] or werte["wegen"]):
        return 1
    werte.update(text=inhalt_text, rueckruf=will_rueckruf)
    print(json.dumps(werte, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    argv = sys.argv[1:]
    if argv[:1] in (["zettel"], ["anruf"]):
        sys.exit(fenster(argv[0], argv[argv.index("--lang") + 1] if "--lang" in argv[:-1] else SPRACHE))
    print(__doc__)
    sys.exit(2)
