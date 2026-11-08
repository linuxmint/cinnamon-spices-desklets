#!/usr/bin/python3

import os
import gettext

import gi
gi.require_version("Gtk", "3.0")

from gi.repository import Gtk, GLib
from xapp.SettingsWidgets import SettingsWidget


UUID = "speedpup@taskpuppynatani"
LOCALE_DIR = os.path.join(
    GLib.get_user_data_dir(),
    "locale"
)

gettext.bindtextdomain(UUID, LOCALE_DIR)
_ = gettext.translation(
    UUID,
    LOCALE_DIR,
    fallback=True
).gettext

MODE_KEY = "network-interface-mode"
INTERFACE_KEY = "custom-network-interface"


def _read_default_interface():
    try:
        with open("/proc/net/route", "r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return None

    for line in lines[1:]:
        parts = line.split()

        if len(parts) < 4:
            continue

        interface = parts[0]
        destination = parts[1]

        try:
            flags = int(parts[3], 16)
        except ValueError:
            continue

        if destination == "00000000" and flags & 0x1:
            return interface

    return None


def _interface_kind(interface):
    base = os.path.join("/sys/class/net", interface)

    if os.path.isdir(os.path.join(base, "wireless")):
        return _("Wi-Fi")

    return _("Ethernet")


def _physical_interfaces():
    root = "/sys/class/net"

    try:
        names = sorted(os.listdir(root))
    except OSError:
        return []

    interfaces = []

    for name in names:
        if name == "lo":
            continue

        base = os.path.join(root, name)

        # Real hardware interfaces normally expose a device link.
        # This filters Docker bridges, veth pairs, loopback, etc.
        if not os.path.exists(os.path.join(base, "device")):
            continue

        interfaces.append(
            (name, _interface_kind(name))
        )

    return interfaces


class NetworkInterfaceChooser(SettingsWidget):
    bind_dir = None

    def __init__(self, info, key, settings):
        SettingsWidget.__init__(self)

        self.settings = settings
        self._changing = False
        self._available_ids = set()

        self.set_orientation(Gtk.Orientation.HORIZONTAL)
        self.set_spacing(12)

        label = Gtk.Label(
            label=info.get(
                "description",
                _("Network interface")
            )
        )

        label.set_halign(Gtk.Align.START)
        label.set_xalign(0)
        label.set_hexpand(True)

        self.combo = Gtk.ComboBoxText()
        self.combo.set_hexpand(False)

        self.pack_start(label, True, True, 0)
        self.pack_end(self.combo, False, False, 0)

        self._populate()

        self.combo.connect(
            "changed",
            self._on_changed
        )

    def _get_setting(self, key, fallback):
        try:
            value = self.settings.get_value(key)
        except Exception:
            return fallback

        if value is None:
            return fallback

        return value

    def _set_setting(self, key, value):
        if not self.settings.has_key(key):
            return

        try:
            self.settings.set_value(key, value)
        except Exception:
            pass

    def _populate(self):
        self._changing = True

        try:
            self.combo.remove_all()
            self._available_ids = set()

            interfaces = _physical_interfaces()
            default_interface = _read_default_interface()

            auto_label = _("Auto (default route)")

            if default_interface:
                kind = _interface_kind(
                    default_interface
                )

                auto_label = _("Auto (%(kind)s — %(interface)s)") % {
                    "kind": kind,
                    "interface": default_interface
                }

            self.combo.append(
                "auto",
                auto_label
            )

            self._available_ids.add("auto")

            for interface, kind in interfaces:
                item_id = f"interface:{interface}"

                self.combo.append(
                    item_id,
                    _("%(kind)s — %(interface)s") % {
                        "kind": kind,
                        "interface": interface
                    }
                )

                self._available_ids.add(item_id)

            self.combo.append(
                "all",
                _("All interfaces")
            )

            self._available_ids.add("all")

            mode = str(
                self._get_setting(
                    MODE_KEY,
                    "auto"
                )
            )

            custom = str(
                self._get_setting(
                    INTERFACE_KEY,
                    ""
                )
            ).strip()

            if mode == "all":
                active_id = "all"

            elif mode == "custom" and custom:
                active_id = f"interface:{custom}"

                # Preserve an interface that is temporarily unavailable.
                if active_id not in self._available_ids:
                    self.combo.append(
                        active_id,
                        _("Unavailable — %(interface)s") % {"interface": custom}
                    )

                    self._available_ids.add(
                        active_id
                    )

            else:
                active_id = "auto"

            self.combo.set_active_id(
                active_id
            )

        finally:
            self._changing = False

    def _on_changed(self, combo):
        if self._changing:
            return

        selected = combo.get_active_id()

        if not selected:
            return

        if selected == "auto":
            self._set_setting(
                MODE_KEY,
                "auto"
            )

            return

        if selected == "all":
            self._set_setting(
                MODE_KEY,
                "all"
            )

            return

        prefix = "interface:"

        if selected.startswith(prefix):
            interface = selected[len(prefix):]

            self._set_setting(
                INTERFACE_KEY,
                interface
            )

            self._set_setting(
                MODE_KEY,
                "custom"
            )
