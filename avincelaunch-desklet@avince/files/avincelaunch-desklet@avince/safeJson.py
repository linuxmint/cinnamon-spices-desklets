# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""Pruefung Phase 2, A3-2 (P4, P5, P80): dieselbe Regel wie lib/safeJson.js
fuer die Python-Seite (Einrichten-Dialog).

  - fehlt      -> Vorgaben, Schreiben erlaubt
  - in Ordnung -> Inhalt
  - kaputt     -> Datei bleibt liegen, Kopie <Datei>.broken-<Zeit> (gleicher
                  Inhalt nur einmal), Meldung auf stderr; nichts automatisch
                  darueberschreiben, bis sie repariert oder entfernt ist.

Geschrieben wird atomar: Zwischendatei im selben Ordner, fsync, os.replace.
"""

import datetime
import json
import os
import sys
import tempfile

STATE_MISSING = "missing"
STATE_OK = "ok"
STATE_BROKEN = "broken"

_reported = set()


def read_json(path):
    """Liefert (state, data, raw). data ist immer ein dict, sonst kaputt."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read()
    except FileNotFoundError:
        return STATE_MISSING, None, None
    except OSError:
        return STATE_BROKEN, None, None
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return STATE_BROKEN, None, raw
    if not isinstance(data, dict):
        return STATE_BROKEN, None, raw
    return STATE_OK, data, raw


def has_broken_copy(path):
    """Teil 2 (T13), wie hasBrokenCopy in lib/safeJson.js: liegt neben path
    eine Kopie <Datei>.broken-<Zeit>?"""
    directory = os.path.dirname(path) or "."
    prefix = os.path.basename(path) + ".broken-"
    try:
        return any(name.startswith(prefix) for name in os.listdir(directory))
    except OSError:
        return False


def _find_backup(path, raw):
    directory = os.path.dirname(path) or "."
    prefix = os.path.basename(path) + ".broken-"
    try:
        names = os.listdir(directory)
    except OSError:
        return None
    for name in sorted(names):
        if not name.startswith(prefix):
            continue
        candidate = os.path.join(directory, name)
        try:
            with open(candidate, "rb") as handle:
                if handle.read() == raw:
                    return candidate
        except OSError:
            continue
    return None


def secure_broken(path, raw=None):
    """Kaputte Datei sichern (einmal je Inhalt) und einmal je Prozess melden.
    Liefert den Pfad der Kopie oder None."""
    if raw is None:
        state, _data, raw = read_json(path)
        if state != STATE_BROKEN:
            return None
    backup = None
    if raw is not None:
        backup = _find_backup(path, raw)
        if backup is None:
            base = path + ".broken-" + datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            for number in range(1, 100):
                candidate = base if number == 1 else "%s-%d" % (base, number)
                try:
                    # "xb": nie eine vorhandene Datei ueberschreiben.
                    with open(candidate, "xb") as handle:
                        handle.write(raw)
                    backup = candidate
                    break
                except FileExistsError:
                    continue
                except OSError:
                    break
    if path not in _reported:
        _reported.add(path)
        print("aVinceLaunch: %s cannot be read; it is left unchanged%s. No changes are saved "
              "there until it is repaired." % (path, (", copy: " + backup) if backup else ""),
              file=sys.stderr)
    return backup


def may_write(path):
    """False (und sichern/melden), solange die Datei kaputt ist."""
    state, _data, raw = read_json(path)
    if state == STATE_BROKEN:
        secure_broken(path, raw)
        return False
    return True


def write_json_atomic(path, payload, trailing_newline=False):
    """JSON atomar schreiben; Rechte einer vorhandenen Datei bleiben."""
    directory = os.path.dirname(os.path.abspath(path))
    try:
        mode = os.stat(path).st_mode & 0o7777
    except OSError:
        umask = os.umask(0)
        os.umask(umask)
        mode = 0o666 & ~umask
    text = json.dumps(payload, indent=2)
    if trailing_newline:
        text += "\n"
    fd, tmp_path = tempfile.mkstemp(
        prefix="." + os.path.basename(path) + ".", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _reset_for_tests():
    _reported.clear()
