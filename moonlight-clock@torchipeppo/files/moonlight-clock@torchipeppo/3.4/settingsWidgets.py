#!/usr/bin/python3

# for SettingsWidget and the _() function
# pyright: reportMissingImports=false
# pyright: reportUndefinedVariable=false

import gi
gi.require_version('Gtk', '3.0')
gi.require_version("GLib", "2.0")
from gi.repository import Gtk, GLib
from xapp.SettingsWidgets import *
from SettingsWidgets import SoundFileChooser, Keybinding, DateChooser
import sys
import json
import datetime
import traceback

import gettext
# hardcoded UUID for translation purposes only,
# fails silently w/ no ill effects if not exists
UUID = "moonlight-clock@torchipeppo"
gettext.install(UUID, GLib.get_home_dir() + '/.local/share/locale')

VARIABLE_TYPE_MAP = {
    "string"        :   str,
    "file"          :   str,
    "icon"          :   str,
    "sound"         :   str,
    "keybinding"    :   str,
    "integer"       :   int,
    "float"         :   float,
    "boolean"       :   bool,
    "date"          :   str,
}

CLASS_TYPE_MAP = {
    "string"        :   Entry,
    "file"          :   FileChooser,
    "icon"          :   IconChooser,
    "sound"         :   SoundFileChooser,
    "keybinding"    :   Keybinding,
    "integer"       :   SpinButton,
    "float"         :   SpinButton,
    "boolean"       :   Switch,
    "date"          :   DateChooser,
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

def log(message):
    with open("/tmp/ListOfDates-log.txt", "a") as f:
        f.write(str(message) + "\n")
    print(message, file=sys.stderr)

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
                # log("set " + str(self.widget_value) + " as type " + str(type(self.widget_value)) + ", on to on_setting_changed...")
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


class ListOfDates(SettingsWidget):
    bind_dir = None

    def __init__(self, info, key, settings):
        self.info = info
        self.key = key
        self.settings = settings

        columns=[
            {"id": "enabled",    "title": _("Enabled"),    "type": "boolean", "default": True},
            {"id": "persistent", "title": _("Persistent"), "type": "boolean", "default": False},
            {"id": "date",       "title": _("Date"),       "type": "date"},
            {"id": "name",       "title": _("Name"),       "type": "string"},
        ]
        show_buttons=True
        label=info.get("label", None)
        height=info.get("height", 200)
        tooltip=info.get("tooltip", "")
        # I thought this was "dependency", but it seems to work anyway?
        # Maybe it's for some advanced behavior I don't care about.
        dep_key=None

        self.storage = info["storage"]

        super(ListOfDates, self).__init__(dep_key=dep_key)

        self.columns = columns
        self.show_buttons = show_buttons

        self.set_orientation(Gtk.Orientation.VERTICAL)
        self.set_spacing(0)
        self.set_margin_left(0)
        self.set_margin_right(0)
        self.set_border_width(0)

        if label is not None:
            self.label = Gtk.Label(label)

        self.content_widget = Gtk.TreeView()

        scrollbox = Gtk.ScrolledWindow()
        scrollbox.set_size_request(-1, height)
        scrollbox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        self.pack_start(scrollbox, True, True, 0)
        scrollbox.add(self.content_widget)

        types = []
        tv_columns = []
        for i in range(len(columns)):
            column_def = columns[i]
            types.append(VARIABLE_TYPE_MAP[column_def['type']])

            has_option_map = 'options' in column_def and isinstance(column_def['options'], dict)
            render_type = 'string' if has_option_map else column_def['type']

            if render_type == 'boolean':
                renderer = Gtk.CellRendererToggle()

                def toggle_checkbox(renderer, path, column):
                    self.model[path][column] = not self.model[path][column]
                    self.list_changed()

                renderer.connect('toggled', toggle_checkbox, i)
                prop_name = 'active'
            elif render_type == 'icon':
                renderer = Gtk.CellRendererPixbuf()
                prop_name = 'icon_name'
            else:
                renderer = Gtk.CellRendererText()
                prop_name = 'text'

            column = Gtk.TreeViewColumn(column_def['title'], renderer)

            if column_def['type'] == "date":
                def map_func(col, rend, model, row_iter, data):
                    date_dict = json.loads(model[row_iter][data])
                    if date_dict is None:
                        date = datetime.date.today()
                    else:
                        date = datetime.date(date_dict["y"], date_dict["m"], date_dict["d"])
                    date_str = date.strftime("%x")
                    rend.set_property('text', date_str)

                column.set_cell_data_func(renderer, map_func, i)
            if has_option_map:
                def map_func(col, rend, model, row_iter, data):
                    value = model[row_iter][data[1]]
                    for key, val in data[0].items():
                        if val == value:
                            rend.set_property('text', key)

                column.set_cell_data_func(renderer, map_func, [column_def['options'],i])
            else:
                column.add_attribute(renderer, prop_name, i)

            if 'align' in column_def:
                renderer.set_alignment(column_def['align'], 0.5)
                column.set_alignment(column_def['align'])

            column.set_resizable(True)
            self.content_widget.append_column(column)
        self.model = Gtk.ListStore(*types)
        self.content_widget.set_model(self.model)

        if show_buttons:
            button_toolbar = Gtk.Toolbar()
            button_toolbar.set_icon_size(1)
            Gtk.StyleContext.add_class(Gtk.Widget.get_style_context(button_toolbar), \
                                       "inline-toolbar")
            self.pack_start(button_toolbar, False, False, 0)

            self.add_button = Gtk.ToolButton(None, None)
            self.add_button.set_icon_name("list-add-symbolic")
            self.add_button.set_tooltip_text(_("Add new entry"))
            self.add_button.connect("clicked", self.add_item)
            self.remove_button = Gtk.ToolButton(None, None)
            self.remove_button.set_icon_name("list-remove-symbolic")
            self.remove_button.set_tooltip_text(_("Remove selected entry"))
            self.remove_button.connect("clicked", self.remove_item)
            self.remove_button.set_sensitive(False)
            self.edit_button = Gtk.ToolButton(None, None)
            self.edit_button.set_icon_name("list-edit-symbolic")
            self.edit_button.set_tooltip_text(_("Edit selected entry"))
            self.edit_button.connect("clicked", self.edit_item)
            self.edit_button.set_sensitive(False)
            self.move_up_button = Gtk.ToolButton(None, None)
            self.move_up_button.set_icon_name("go-up-symbolic")
            self.move_up_button.set_tooltip_text(_("Move selected entry up"))
            self.move_up_button.connect("clicked", self.move_item_up)
            self.move_up_button.set_sensitive(False)
            self.move_down_button = Gtk.ToolButton(None, None)
            self.move_down_button.set_icon_name("go-down-symbolic")
            self.move_down_button.set_tooltip_text(_("Move selected entry down"))
            self.move_down_button.connect("clicked", self.move_item_down)
            self.move_down_button.set_sensitive(False)
            button_toolbar.insert(self.add_button, 0)
            button_toolbar.insert(self.remove_button, 1)
            button_toolbar.insert(self.edit_button, 2)
            button_toolbar.insert(self.move_up_button, 3)
            button_toolbar.insert(self.move_down_button, 4)

        self.content_widget.get_selection().connect("changed", self.update_button_sensitivity)
        self.content_widget.set_activate_on_single_click(False)
        self.content_widget.connect("row-activated", self.on_row_activated)

        self.set_tooltip_text(tooltip)

        self.restore_list()

        #self.settings.listen(self.key, self.valid_backup_restore)
        self.settings.listen(self.storage, self.valid_backup_restore)

    def update_button_sensitivity(self, *args):
        if not self.show_buttons:
            return
        model, selected = self.content_widget.get_selection().get_selected()
        if selected is None:
            self.remove_button.set_sensitive(False)
            self.edit_button.set_sensitive(False)
        else:
            self.remove_button.set_sensitive(True)
            self.edit_button.set_sensitive(True)

        if selected is None or model.iter_previous(selected) is None:
            self.move_up_button.set_sensitive(False)
        else:
            self.move_up_button.set_sensitive(True)

        if selected is None or model.iter_next(selected) is None:
            self.move_down_button.set_sensitive(False)
        else:
            self.move_down_button.set_sensitive(True)

    def on_row_activated(self, *args):
        self.edit_item()

    def add_item(self, *args):
        data = self.open_add_edit_dialog()
        if data is not None:
            self.model.append(data)
            # log("Appended " + str(data))
            self.list_changed()

    def remove_item(self, *args):
        model, t_iter = self.content_widget.get_selection().get_selected()
        model.remove(t_iter)

        self.list_changed()

    def edit_item(self, *args):
        model, t_iter = self.content_widget.get_selection().get_selected()
        data = self.open_add_edit_dialog(model[t_iter])
        if data is not None:
            for i in range(len(data)):
                self.model[t_iter][i] = data[i]
            self.list_changed()

    def move_item_up(self, *args):
        model, t_iter = self.content_widget.get_selection().get_selected()
        model.swap(t_iter, model.iter_previous(t_iter))
        self.list_changed()

    def move_item_down(self, *args):
        model, t_iter = self.content_widget.get_selection().get_selected()
        model.swap(t_iter, model.iter_next(t_iter))
        self.list_changed()

    def open_add_edit_dialog(self, info=None):
        if info is None:
            title = _("Add new entry")
        else:
            title = _("Edit entry")
        dialog = Gtk.Dialog(title, self.get_toplevel(), Gtk.DialogFlags.MODAL,
                            (Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
                             Gtk.STOCK_OK, Gtk.ResponseType.OK))

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
                the_info = info[i]
                if isinstance(widget, DateChooser):
                    the_info = json.loads(the_info)
                # log("Loading " + str(the_info) + " as type " + str(type(the_info)))
                widget.set_widget_value(the_info)
                # log("Loaded.")
            elif "default" in self.columns[i]:
                widget.set_widget_value(self.columns[i]["default"])

        content_area.show_all()
        response = dialog.run()

        if response == Gtk.ResponseType.OK:
            values = []
            for widget in widgets:
                value = widget.get_widget_value()
                if isinstance(widget, DateChooser):
                    if value is None:
                        today = datetime.date.today()
                        value = {"y": today.year, "m": today.month, "d": today.day}
                    value = json.dumps(value)
                values.append(value)

            dialog.destroy()
            return values

        dialog.destroy()
        return None

    def list_changed(self, *args):
        data = []
        for row in self.model:
            # log("Found row " + str(row))
            i = 0
            row_info = {}
            for column in self.columns:
                row_info[column["id"]] = row[i]
                i += 1
            data.append(row_info)
        self.stored_entries = data
        # log("Writing " + str(self.stored_entries))
        self.settings.set_value(self.storage, self.stored_entries)
        self.update_button_sensitivity()

    def on_setting_changed(self, *args):
        self.model.clear()
        rows = self.get_value()
        for row in rows:
            row_info = []
            for column in self.columns:
                cid = column["id"]
                if cid in row:
                    row_info.append(row[column["id"]])
                elif "default" in column:
                    row_info.append(column["default"])
                else:
                    row_info.append(None)
            self.model.append(row_info)

        self.content_widget.columns_autosize()

    def connect_widget_handlers(self, *args):
        pass

    def valid_backup_restore(self, key, changed_entries):
        ''' restore list only if there are changes between internally 
            stored dates and saved dates in applet settings
        '''
        if not changed_entries == self.stored_entries:
            self.restore_list()

    def restore_list(self):
        # Don't modify from callback
        self.dontModify = True
        
        self.model.clear()
        try:
            #self.stored_entries = self.settings.get_value(self.key)
            self.stored_entries = self.settings.get_value(self.storage)
        except KeyError:
            self.stored_entries = ()
        
        for entry in self.stored_entries:
            entry_value_list = []
            
            for i, col in enumerate(self.columns):
                if col["id"] in entry:
                    entry_value_list.append(entry[col["id"]])
                elif "default" in col:
                    entry_value_list.append(col["default"])
                else:
                    raise ValueError("Entry of column "+str(i)+" doesn't contain key: "+col["id"])
                    continue
            
            self.model.append(entry_value_list)
        
        self.dontModify = False
