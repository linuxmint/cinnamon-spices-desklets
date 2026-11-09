#!/usr/bin/env python3
# Weather - helper for the desklet weather-forecast@ersenender
# Copyright (C) 2026 ersenender
# SPDX-License-Identifier: GPL-3.0-or-later
"""Helfer für das Wetter-Desklet.

  helper.py fetch <breite> <länge> [metrisch|imperial] [luft|ohne]     Wetter laden -> Cache
  helper.py choose      Ortssuche, Ergebnis als JSON auf stdout

Daten: Open-Meteo (open-meteo.com) – frei nutzbar, ohne Konto und ohne
Schlüssel. Das Wetter liegt im Cache, damit das Desklet auch ohne Netz
den letzten Stand zeigt.
"""
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

import gettext
import locale

UUID = "weather-forecast@ersenender"
_ = gettext.translation(UUID, os.path.expanduser("~/.local/share/locale"), fallback=True).gettext
# Sprache des Systems als Kürzel ("de", "en", "tr" …), z. B. für Ortsnamen eines Webdienstes
SPRACHE = (locale.getlocale(locale.LC_MESSAGES)[0] or os.environ.get("LANG") or "en")[:2].lower()

WETTER = "https://api.open-meteo.com/v1/forecast"
LUFT = "https://air-quality-api.open-meteo.com/v1/air-quality"
ORTE = "https://geocoding-api.open-meteo.com/v1/search"
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")),
                     "weather-forecast@ersenender")
KOORD = re.compile(r"^-?\d{1,3}(\.\d{1,4})?$")


def _get(url, parameter):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(parameter),
                                 headers={"User-Agent": "weather-forecast@ersenender/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _schreiben(name, daten):
    os.makedirs(CACHE, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=CACHE, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(daten, fh, ensure_ascii=False)
    os.replace(tmp, os.path.join(CACHE, name))


def fetch(breite, laenge, einheit="metrisch", luft=True):
    if not (KOORD.match(breite) and KOORD.match(laenge)):
        sys.exit("ungültige Koordinaten")
    parameter = {
        "latitude": breite, "longitude": laenge, "timezone": "auto", "forecast_days": 8, "forecast_hours": 48,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,"
                   "wind_direction_10m,wind_gusts_10m,precipitation",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,"
                 "precipitation_sum,wind_speed_10m_max,uv_index_max",
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
    }
    if einheit == "imperial":
        parameter.update(temperature_unit="fahrenheit", wind_speed_unit="mph", precipitation_unit="inch")
    daten = _get(WETTER, parameter)
    if "current" not in daten or "daily" not in daten:
        raise ValueError("unvollständige Antwort")
    # Luftqualität ist eine eigene Abfrage; fällt sie aus, kommt das Wetter trotzdem
    daten["luft"] = None
    if luft:
        try:
            daten["luft"] = _get(LUFT, {"latitude": breite, "longitude": laenge, "timezone": "auto",
                                        "current": "european_aqi,pm2_5,pm10"}).get("current")
        except Exception:
            pass
    daten["stand"] = int(time.time())
    _schreiben(f"wetter-{breite}_{laenge}.json", daten)
    print("ok")


# ---------------------------------------------------------------- Ortssuche

TEXTE = dict(
    titel=_("Choose the place for the weather"),
    suchen=_("Place or postal code …"),
    ok=_("Apply"),
    abbr=_("Cancel"),
    laden=_("searching …"),
    nichts=_("No place found"),
    fehler=_("Search not possible (no connection?)"),
    hinweis=_("Type a place name – the matches appear as you type."),
)


def choose(lang):
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk

    T = TEXTE
    zustand = {"lauf": 0, "warten": 0}

    win = Gtk.Dialog(title=T["titel"], icon_name="weather-few-clouds")
    win.set_default_size(480, 420)
    win.add_button(T["abbr"], Gtk.ResponseType.CANCEL)
    ok = win.add_button(T["ok"], Gtk.ResponseType.OK)
    ok.get_style_context().add_class("suggested-action")
    ok.set_sensitive(False)

    store = Gtk.ListStore(str, str, str, str)          # Name, Zusatz, Breite, Länge
    view = Gtk.TreeView(model=store, headers_visible=False, enable_search=False)
    zelle = Gtk.CellRendererText()
    spalte = Gtk.TreeViewColumn("", zelle)
    spalte.set_cell_data_func(zelle, lambda _s, z, m, it, _d: z.set_property(
        "markup", "<b>%s</b>\n<small>%s</small>" % (GLib.markup_escape_text(m[it][0]),
                                                     GLib.markup_escape_text(m[it][1]))))
    view.append_column(spalte)
    view.get_selection().connect("changed", lambda sel: ok.set_sensitive(sel.get_selected()[1] is not None))
    view.connect("row-activated", lambda *_: win.response(Gtk.ResponseType.OK))
    suche = Gtk.SearchEntry(placeholder_text=T["suchen"])
    status = Gtk.Label(xalign=0)
    status.get_style_context().add_class("dim-label")
    hinweis = Gtk.Label(label=T["hinweis"], xalign=0)
    hinweis.get_style_context().add_class("dim-label")
    sw = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, shadow_type=Gtk.ShadowType.IN)
    sw.add(view)

    def suchen():
        zustand["warten"] = 0
        zustand["lauf"] += 1
        lauf = zustand["lauf"]
        text = suche.get_text().strip()
        if len(text) < 2:
            store.clear()
            status.set_text("")
            return False
        status.set_text(T["laden"])

        def arbeit():
            try:
                treffer = _get(ORTE, {"name": text, "count": 20, "language": lang}).get("results") or []
            except Exception:
                treffer = None
            GLib.idle_add(fertig, treffer)

        def fertig(treffer):
            if lauf != zustand["lauf"]:             # inzwischen weitergetippt
                return False
            store.clear()
            if treffer is None:
                status.set_text(T["fehler"])
                return False
            status.set_text("" if treffer else T["nichts"])
            for t in treffer:
                zusatz = [t.get(k) for k in ("admin3", "admin1", "country") if t.get(k) and t.get(k) != t["name"]]
                if t.get("postcodes") and re.match(r"^\d", text):
                    zusatz.insert(0, t["postcodes"][0])
                store.append((t["name"], " · ".join(dict.fromkeys(zusatz)),
                              "%.4f" % t["latitude"], "%.4f" % t["longitude"]))
            if treffer:
                view.get_selection().select_path(0)
            return False

        threading.Thread(target=arbeit, daemon=True).start()
        return False

    def getippt(*_):
        if zustand["warten"]:
            GLib.source_remove(zustand["warten"])
        zustand["warten"] = GLib.timeout_add(350, suchen)

    suche.connect("search-changed", getippt)
    inhalt = win.get_content_area()
    inhalt.set_border_width(12)
    inhalt.set_spacing(8)
    inhalt.pack_start(hinweis, False, False, 0)
    inhalt.pack_start(suche, False, False, 0)
    inhalt.pack_start(sw, True, True, 0)
    inhalt.pack_start(status, False, False, 0)
    win.show_all()
    antwort = win.run()
    model, it = view.get_selection().get_selected()
    win.destroy()
    if antwort == Gtk.ResponseType.OK and it is not None:
        print(json.dumps({"name": model[it][0], "breite": model[it][2], "laenge": model[it][3]},
                         ensure_ascii=False))
        return 0
    return 1


def main(argv):
    if len(argv) >= 3 and argv[0] == "fetch":
        fetch(argv[1], argv[2], "imperial" if "imperial" in argv[3:] else "metrisch", "ohne" not in argv[3:])
        return 0
    if argv and argv[0] == "choose":
        lang = SPRACHE
        for i, a in enumerate(argv):
            if a == "--lang" and i + 1 < len(argv):
                lang = argv[i + 1]
        return choose(lang)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
