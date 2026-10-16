"""Big Calendar's settings controls, loaded only by Cinnamon's settings UI.

Reuse Cinnamon's bindings and native controls; only wheel/touchpad scrolling
is redirected to the containing page. No global GTK or Cinnamon patching.
"""
from gi.repository import Gtk
from xapp.SettingsWidgets import SettingsWidget
from JsonSettingsWidgets import (
    JSONSettingsRange, JSONSettingsSpinButton, JSONSettingsComboBox,
)


def scroll_page(widget, event):
    parent = widget.get_parent()
    while parent is not None:
        if isinstance(parent, Gtk.ScrolledWindow):
            parent.event(event)
            break
        parent = parent.get_parent()
    # Always consume the original event, even at the page's scroll limit.
    # Returning False would let the control change its value instead.
    return True


class ScrollSafeRange(JSONSettingsRange):
    def on_scroll_event(self, widget, event):
        # Range connects this handler during construction. Override it before
        # that happens, rather than installing a second, too-late handler.
        return scroll_page(widget, event)


def ScrollSafeControl(info, key, settings):
    setting = info["setting"]
    properties = settings.settings[setting]
    control_type = properties["type"]
    constructors = {
        "scale": ScrollSafeRange,
        "spinbutton": JSONSettingsSpinButton,
        "combobox": JSONSettingsComboBox,
    }
    row = constructors[control_type](setting, settings, properties)
    if control_type != "scale":
        row.content_widget.connect("scroll-event", scroll_page)
    return row


class ResetSettings(SettingsWidget):
    def __init__(self, info, key, settings):
        super().__init__()
        self.content_widget = Gtk.Button(label=info["description"])
        self.content_widget.set_tooltip_text(info["tooltip"])
        self.content_widget.connect("clicked", lambda button: settings.reset_to_defaults())
        self.pack_start(self.content_widget, False, False, 0)
