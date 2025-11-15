#!/usr/bin/python3

# This code was copied from https://github.com/linuxmint/cinnamon/blob/master/files/usr/share/cinnamon/cinnamon-settings/bin/TreeListWidgets.py
# I modifed it to work for this desklet


import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
from xapp.SettingsWidgets import *


import os
import sys

import gettext
import json

from gi.repository import GLib

# i18n
gettext.install("cinnamon", "/usr/share/locale")


translations = {}


VARIABLE_TYPE_MAP = {
    "string"        :   str,
    "file"          :   str,
    "icon"          :   str,
    "sound"         :   str,
    "keybinding"    :   str,
    "integer"       :   int,
    "float"         :   float,
    "boolean"       :   bool
}

CLASS_TYPE_MAP = {
    "string"        :   Entry,
    "file"          :   FileChooser,
    "icon"          :   IconChooser,
    "integer"       :   SpinButton,
    "float"         :   SpinButton,
    "boolean"       :   Switch
}

PROPERTIES_MAP = {
    "title"         : "label",
    "min"           : "mini",
    "max"           : "maxi",
    "step"          : "step",
    "units"         : "units",
    "select-dir"    : "dir_select",
    "expand-width"  : "expand_width"
}

def list_edit_factory(options):
    kwargs = {}
    if 'options' in options:
        kwargs['valtype'] = VARIABLE_TYPE_MAP[options['type']]
        widget_type = ComboBox
        options_list = options['options']
        if isinstance(options_list, dict):
            kwargs['options'] = [(b, a) for a, b in options_list.items()]
        else:
            kwargs['options'] = zip(options_list, options_list)
    else:
        widget_type = CLASS_TYPE_MAP[options["type"]]
    class Widget(widget_type):
        def __init__(self, **kwargs):
            super(Widget, self).__init__(**kwargs)

            if self.bind_dir is None:
                self.connect_widget_handlers()

        def get_range(self):
            return None

        def set_value(self, value):
            self.widget_value = value

        def get_value(self):
            if hasattr(self, "widget_value"):
                return self.widget_value
            else:
                return None

        def set_widget_value(self, value):
            if self.bind_dir is None:
                self.widget_value = value
                self.on_setting_changed()
            else:
                if hasattr(self, "bind_object"):
                    self.bind_object.set_property(self.bind_prop, value)
                else:
                    self.content_widget.set_property(self.bind_prop, value)

        def get_widget_value(self):
            if self.bind_dir is None:
                try:
                    return self.widget_value
                except Exception as e:
                    return None
            else:
                if hasattr(self, "bind_object"):
                    return self.bind_object.get_property(self.bind_prop)
                return self.content_widget.get_property(self.bind_prop)

    for prop in options:
        if prop in PROPERTIES_MAP:
            kwargs[PROPERTIES_MAP[prop]] = options[prop]

    return Widget(**kwargs)


class List(SettingsWidget):
    bind_dir = None

    def __init__(self, label=None, columns=None, height=200, size_group=None, \
                 dep_key=None):
        super(List, self).__init__()
        self.columns = columns



    def open_add_edit_dialog(self, info=None):
        self.window = Gtk.Window()
        # self.tree.set_translation_domain('cinnamon') # let it translate!

        if info is None:
            title = _("Add new link")
        else:
            title = _("Edit link")
        dialog = Gtk.Dialog(title, self.window)

        dialog.add_buttons(
            Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
            Gtk.STOCK_OK, Gtk.ResponseType.OK
        )

        content_area = dialog.get_content_area()
        content_area.set_margin_right(30)
        content_area.set_margin_left(30)
        content_area.set_margin_top(20)
        content_area.set_margin_bottom(20)

        frame = Gtk.Frame()
        frame.set_shadow_type(Gtk.ShadowType.IN)
        frame_style = frame.get_style_context()
        frame_style.add_class("view")
        content_area.add(frame)

        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        frame.add(content)

        widgets = []
        for i in range(len(self.columns)):
            if len(widgets) != 0:
                content.add(Gtk.Separator(orientation=Gtk.Orientation.HORIZONTAL))

            widget = list_edit_factory(self.columns[i])
            widgets.append(widget)

            settings_box = Gtk.ListBox()
            settings_box.set_selection_mode(Gtk.SelectionMode.NONE)

            content.pack_start(settings_box, True, True, 0)
            settings_box.add(widget)

            if info is not None and info[i] is not None:
                widget.set_widget_value(info[i])
            elif "default" in self.columns[i]:
                widget.set_widget_value(self.columns[i]["default"])


        content_area.show_all()
        response = dialog.run()

        if response == Gtk.ResponseType.OK:
            values = {}
            for column, widget in zip(self.columns, widgets):
                values[column["id"]] = widget.get_widget_value()

            dialog.destroy()
            return values

        dialog.destroy()
        return {"error": "true"}


 
if __name__ == "__main__":

    rv = {"error": "true"}

    try:
        list = List(
            columns=json.loads(sys.argv[1])
        )
        out = list.open_add_edit_dialog()
        rv = json.dumps(out)

    except Exception as e:
        # print(e)
        pass

    print(rv)

    
    
    
# list = List(
#     columns = [
#         # {"id": "is-visible", "title": "Display", "type": "boolean", "default": True},
#         {"id": "name", "title": "Name", "type": "string", "default": "Name"},
#         {"id": "icon-name", "title": "Icon name", "type": "icon", "default": "folder"},
#         {"id": "command", "title": "Command", "type": "string", "default": "nemo /"},
#         {"id": "shell", "title": "Shell", "type": "boolean", "default": True, "align": 0}
#     ]
# )