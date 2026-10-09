#!/usr/bin/env python3
# Rates and Metals - helper for the desklet rates-and-metals@ersenender
# Copyright (C) 2026 ersenender
# SPDX-License-Identifier: GPL-3.0-or-later
"""Helfer für das Kurse-Desklet.

  helper.py fetch     Wechselkurse und Edelmetallpreise laden -> Cache

Quellen (beide frei nutzbar, ohne Konto und ohne Schlüssel):
  Währungen   Referenzkurse der Europäischen Zentralbank über api.frankfurter.dev
              (ein Kurs je Bankarbeitstag, erscheint gegen 16 Uhr)
  Edelmetalle api.gold-api.com, laufende Preise in US-Dollar je Feinunze

Fällt eine Quelle aus, bleibt ihr letzter Stand im Cache stehen.
"""
import datetime
import json
import os
import sys
import tempfile
import time
import urllib.request

KURSE = "https://api.frankfurter.dev/v1/{start}..?base=EUR"
METALL = "https://api.gold-api.com/price/{code}"
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "rates-and-metals@ersenender")
DATEI = os.path.join(CACHE, "kurse.json")


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "rates-and-metals@ersenender/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _lesen():
    try:
        with open(DATEI, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _schreiben(daten):
    os.makedirs(CACHE, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=CACHE, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(daten, fh, ensure_ascii=False)
    os.replace(tmp, DATEI)


def waehrungen():
    """Letzter EZB-Kurs, der des Arbeitstags davor und der Verlauf der letzten Wochen
    (tage = Datumsliste, reihe = je Währung die Kurse dazu) für Verlaufslinie und Veränderung."""
    start = (datetime.date.today() - datetime.timedelta(days=45)).isoformat()
    tage = _get(KURSE.format(start=start))["rates"]
    daten = sorted(tage)
    if not daten:
        raise ValueError("keine Kurse")
    codes = sorted(tage[daten[-1]])
    return {"datum": daten[-1], "kurse": tage[daten[-1]],
            "vortag": tage[daten[-2]] if len(daten) > 1 else {},
            "tage": daten, "reihe": {c: [tage[d].get(c) for d in daten] for c in codes}}


def metalle(alt, codes):
    """Preise in USD je Feinunze. Die Quelle kennt keinen Vortag, deshalb merkt sich der Cache
    je Tag den letzten Preis; verglichen wird mit dem letzten Tag davor."""
    heute = datetime.date.today().isoformat()
    tage = dict((alt or {}).get("tage") or {})
    preise = {}
    for code in codes:
        try:
            preis = float(_get(METALL.format(code=code))["price"])
            if preis > 0:
                preise[code] = preis
        except Exception:
            pass
    if not preise:
        raise ValueError("keine Metallpreise")
    tage[heute] = dict(tage.get(heute) or {}, **preise)
    tage = {d: tage[d] for d in sorted(tage)[-45:]}      # reicht für Verlaufslinie und Monatsvergleich
    frueher = [d for d in sorted(tage) if d < heute]
    return {"tage": tage, "preise": tage[heute], "vortag": tage[frueher[-1]] if frueher else {}}


def fetch():
    alt = _lesen()
    neu = dict(alt)
    fehler = 0
    codes = ["XAU", "XAG", "XPT", "XPD"]
    try:
        neu["waehrungen"] = waehrungen()
        neu["stand_waehrungen"] = int(time.time())
    except Exception as e:
        fehler += 1
        print(f"Währungen: {e}", file=sys.stderr)
    try:
        neu["metalle"] = metalle(alt.get("metalle"), codes)
        neu["stand_metalle"] = int(time.time())
    except Exception as e:
        fehler += 1
        print(f"Metalle: {e}", file=sys.stderr)
    if fehler < 2:
        _schreiben(neu)
    print("ok" if not fehler else "teilweise" if fehler < 2 else "fehler")
    return 0 if fehler < 2 else 1


if __name__ == "__main__":
    if sys.argv[1:2] == ["fetch"]:
        sys.exit(fetch())
    print(__doc__)
    sys.exit(2)
