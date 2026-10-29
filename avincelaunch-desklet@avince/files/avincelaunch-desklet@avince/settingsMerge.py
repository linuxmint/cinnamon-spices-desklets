# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 Angelo Vincenti, aVince Industrietechnik

"""Pruefung Phase 2, A4-3 (P12): Abgleich vor jedem Speichern im Dialog.

Cinnamons Einstellungsdialog (JsonSettingsWidgets.JSONSettingsHandler) haelt
eine Kopie der <ID>.json im Speicher und schreibt bei JEDER Aenderung die
ganze Kopie zurueck (save_settings). Aenderungen des laufenden Desklets
(einklappen, ziehen, sperren ...) liest er erst 2 s nach dem Dateiereignis
ein - und save_settings verwirft dieses anstehende Einlesen (pause_monitor).
Speichert der Dialog in diesen 2 s, ueberschreibt er die Aenderung des
Desklets mit seinem alten Stand; das Desklet uebernimmt ihn wieder (am Geraet
nachgestellt 09.10.2026: ein Fence klappte von selbst wieder auf).

Hier wird das Speicherobjekt EINES Fence im Dialog einmal ergaenzt: Vor jedem
Speichern liest es die Datei neu. Was dort seit dem letzten Abgleich anders
ist und im Dialog unveraendert blieb, wird uebernommen (und auch gleich
angezeigt) statt ueberschrieben. Haben beide denselben Wert geaendert, gilt
der Dialog - das ist der Klick, den der Nutzer gerade gemacht hat. Ist die
Datei gerade unlesbar, wird wie bisher gespeichert.

Cinnamons Code bleibt unveraendert; ergaenzt wird nur das Objekt dieses
Dialogs (Instanz-Attribute), also auch fuer Cinnamons eigene Schalter.
"""

import copy
import sys

_MARK = "_avincelaunch_merge_installed"


def _values(settings_data):
    values = {}
    for key, entry in (settings_data or {}).items():
        if isinstance(entry, dict) and "value" in entry:
            values[key] = copy.deepcopy(entry["value"])
    return values


def merge_from_disk(handler):
    """Uebernimmt fremde Aenderungen in handler.settings; liefert {Schluessel: Wert}."""
    try:
        disk = handler.get_settings()
    except Exception:
        return {}
    if not isinstance(disk, dict):
        return {}
    base = getattr(handler, "_avincelaunch_base", {})
    adopted = {}
    for key, entry in disk.items():
        if not isinstance(entry, dict) or "value" not in entry:
            continue
        mine_entry = handler.settings.get(key)
        if not isinstance(mine_entry, dict) or "value" not in mine_entry or key not in base:
            continue
        disk_value = entry["value"]
        if disk_value == base[key]:
            continue
        if mine_entry["value"] == base[key]:
            mine_entry["value"] = copy.deepcopy(disk_value)
            adopted[key] = disk_value
        elif mine_entry["value"] != disk_value:
            print("aVinceLaunch: %s changed in the dialog and in the fence - the dialog wins (%s)"
                  % (key, getattr(handler, "filepath", "?")), file=sys.stderr)
    return adopted


def _show_adopted(handler, adopted):
    """Wie check_settings: Anzeige und Zuhoerer fuer uebernommene Werte."""
    for key, value in adopted.items():
        for info in list(getattr(handler, "bindings", {}).get(key, [])):
            try:
                handler.set_object_value(info, value)
            except Exception:
                pass
        for callback in list(getattr(handler, "listeners", {}).get(key, [])):
            try:
                callback(key, value)
            except Exception:
                pass


def install(handler):
    """Einmal je Speicherobjekt; weitere Aufrufe tun nichts."""
    if handler is None or getattr(handler, _MARK, False):
        return handler
    if not all(hasattr(handler, name) for name in ("settings", "save_settings", "get_settings")):
        return handler
    setattr(handler, _MARK, True)
    handler._avincelaunch_base = _values(handler.settings)

    original_save = handler.save_settings
    original_check = getattr(handler, "check_settings", None)

    def save_settings(*args, **kwargs):
        adopted = merge_from_disk(handler)
        result = original_save(*args, **kwargs)
        handler._avincelaunch_base = _values(handler.settings)
        if adopted:
            _show_adopted(handler, adopted)
        return result

    handler.save_settings = save_settings

    if original_check is not None:
        def check_settings(*args, **kwargs):
            result = original_check(*args, **kwargs)
            handler._avincelaunch_base = _values(handler.settings)
            return result

        handler.check_settings = check_settings
    return handler
