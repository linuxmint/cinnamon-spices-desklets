const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Lang = imports.lang;
const Cinnamon = imports.gi.Cinnamon;
const Main = imports.ui.main;
const Tooltips = imports.ui.tooltips;
const ModalDialog = imports.ui.modalDialog;


let TODOItem;
if (typeof require !== 'undefined') {
    TODOItem = require('./TODOItem');
} else {
    TODOItem = DESKLET_ROOT.TODOItem;
}


const TODO_LIST_SETTING_NAME = "todo-list";


/**
* Encapsulates functionality regarding TODO task list and its rendering
*/
class TODOList {
    constructor(desklet, is_selection_enabled = true, is_sort_enabled = true, is_sort_reversed = false) {
        this.desklet = desklet;
        this.settings = desklet.settings;
        this._items = [];
        this.container = null;
        this.is_sort_enabled = is_sort_enabled;
        this.is_sort_reversed = is_sort_reversed;
        this.is_selection_enabled = is_selection_enabled;
    }

    get length() {
        return this._items.length;
    }

    get items() {
        return this._items;
    }

    getItem(index) {
        if (index < this._items.length && index >= 0) {
            return this._items[index];
        } else {
            return false;
        }
    }

    getSelectedCount() {
        return this._items.filter((item) => {return item.is_selected}).length;
    }

    loadItemsFromSettings() {
        // Make sure to create a deepcopy of item list, otherwise you could modify actual desklet settings using this variable
        const items_deepcopy = JSON.parse(JSON.stringify(
            this.settings.getValue(TODO_LIST_SETTING_NAME)
        ));

        // Clear array
        this._items.length = 0;

        // Add a placeholder item to let to user know there are no items to be displayed
        if (items_deepcopy.length < 1) {
            this._items.push(
                new TODOItem.TODOItem(
                    "Add some tasks",
                )
            );
            return;
        } 

        items_deepcopy.forEach(item => {
            // Replace escaped newlines with actual newlines to allow user to split name into multiple lines
            item["name"] = item["name"].replaceAll("\\n", "\n");

            this.addItem(item["name"], item["is-marked-done"]);
            
        })

    }

    addItem(name, is_marked_done=false) {
        this._items.push(
            new TODOItem.TODOItem(
                name,
                is_marked_done,
                this.is_selection_enabled,
            )
        );

        this.saveItemsToSettings();
    }

    removeItems(only_selected=true) {
        if (only_selected) {
            this._items = this._items.filter((item) => {return !item.is_selected});
        } else {
            // Clear array
            this._items.length = 0;
        }     
    }

    removeItem(index) {
        if (index < this._items.length && index >= 0) {
            this._items.splice(index, 1);
            return true;
        } else {
            return false;
        }
    }

    markItemsDone(done = true, only_selected=true) {
        for(let i = 0; i < this._items.length; ++i) {
            const item = this.getItem(i); 
            if (item.is_selected || !only_selected) {
                item.is_marked_done = done;
            }
        }  
    }
    

    deselectAllItems() {
        for(let i = 0; i < this._items.length; ++i) {
            const item = this.getItem(i);
            item.is_selected = false;
        }  
    }

    saveItemsToSettings() {
        let new_settings_list = [];

        for(let i = 0; i < this._items.length; ++i) {
            const item_attrs = this.getItem(i).getSettingsAttrs(); 
            new_settings_list.push(item_attrs);
        }                 
     
        this.settings.setValue(TODO_LIST_SETTING_NAME, new_settings_list);
    }

    sortItems(reversed = false) {
        if (this._items.length > 1) {
            this._items.sort((x, y) => Number(x.is_marked_done) - Number(y.is_marked_done));

            if (reversed) {
                this._items = this._items.reverse();
            }
        }

    }

    setParentContainer(container) {
        this.container = container;
    } 

    render (destroy_children = true) {
        if (this.container === null || this.container === undefined) {
            Main.notifyError("Use setParentContainer() before rendering TODOList");
            return;
        }

        if (destroy_children) {
            this.container.destroy_all_children();
        }

        const default_row_spacing = 1;
        const default_column_spacing = 5;

        const row_spacing = default_row_spacing * this.desklet.theme["scale"];
        const column_spacing = default_column_spacing * this.desklet.theme["scale"];

        this.grid = new Clutter.GridLayout(); 
        this.grid.set_row_spacing(Math.round(row_spacing));
        this.grid.set_column_spacing(Math.round(column_spacing));
        this.container.set_layout_manager(this.grid);

        if (this.is_sort_enabled) {
            this.sortItems(this.is_sort_reversed);
        }

        for (let i = 0; i < this._items.length; ++i) {
            this._renderItem(i, false);
        }

    }



    _renderItem (item_index, destroy = true) {
        const Item = this.getItem(item_index);
        // Main.notifyError("Rendering item: " + Item.name, " "); // debug

        const th = this.desklet.theme["TODOlist"];

        if (Item.actor !== null && Item.actor !== undefined && destroy) {
            Item.actor.destroy_all_children();
            Item.actor.destroy();
        } 

        const style_classes = (Item.is_selected ? "todo-item selected" : "todo-item not-selected"); 

        let parent_button = new St.Button({style_class:style_classes});
        parent_button.set_width(Math.round(th["item_width"]));

        Item.actor = parent_button;

        parent_button.style = "font-family: '" + th["font_family"] + "';"
                            + "font-size: " + th["font_size"] + "px;"
                            + "color:" + th["font_color"] + ";"
                            + "font-weight:" + (th["font_bold"] ? "bold" : "normal") + ";"
                            + "font-style:" + (th["font_italic"] ? "italic" : "normal") + ";"
                            + "text-shadow:" + (th["text_shadow_enabled"] ? "1px 1px 6px " + th["text_shadow_color"] : "none") + ";"
                            + "background-color:" + (th["is_transparent_bg"] ? "unset" : th["background_color"]) + ";";


        const opacity = (Item.is_marked_done ? th["marked_opacity"]: th["unmarked_opacity"]);
        parent_button.set_opacity(opacity);


        const row = item_index % th["num_of_columns"];
        const column = Math.floor(item_index / th["num_of_columns"]);
        this.grid.attach(parent_button, row, column, 1, 1);

        let btn_content_container = new St.Group({style_class:"btn-content-container"});
        parent_button.set_child(btn_content_container)

        let content_grid = new Clutter.GridLayout(); 
        btn_content_container.set_layout_manager(content_grid);


        let icon_btn = new St.Button({style_class:"todo-item-icon-btn"});

        let icon_name = th["not_marked_icon_name"];
        if (Item.is_marked_done) {
            icon_name = th["marked_icon_name"];
        }

        // Render icon
        if (th["icon_size"] >= 1) {
            let icon = new St.Icon({ 
                icon_name: icon_name, 
                icon_type: St.IconType.APPLICATION, 
                icon_size: th["icon_size"], 
                style_class:"todo-item-icon" 
            });

            icon_btn.set_child(icon);
            content_grid.attach(icon_btn, 0, 0, 1, 1);
        }

        icon_btn.connect("button_press_event", Lang.bind(this, (actor, button)=> {
            const item = this.getItem(item_index);

            if (button.get_button() === Clutter.BUTTON_SECONDARY) {
                item.toggleSelection();
                this._renderItem(item_index);
                return;
            }

            if (button.get_button() === Clutter.BUTTON_MIDDLE) {
                let dialog = new ModalDialog.ConfirmDialog(
                    _(`Are you sure you want to remove this task?`),
                    () => {
                        this.removeItem(item_index);
                        this.saveItemsToSettings()
                        this.render();
                        return;
                    }
                );
                dialog.open();
            }

            item.toggleMarkedDone();
            this.saveItemsToSettings();
            this.render();  
        }));



        // I found that St.Entry produces an unexpected error in .xsession-errors:
        // Clutter-Critical: clutter_input_focus_set_input_panel_state: assertion 'clutter_input_focus_is_focused (focus)' failed or similar.
        // I observed several triggers for this error: 
        // - rendering St.entry after setting text while clutter_text is editable -- I've minimized number of error by setting text editable only after user interaction 
        // - right clicking on St.Entry 
        // I've tried setting text in many weird ways. I've tried making a desklet with just one St.Entry element to check if it's not triggered by my app, but it always gives errors.
        // Maybe this is a bug in St.Entry implementation? Maybe not?
        // I don't know exactly why this error occurs, but it doesn't seem to affect any functionality here, so im ignoring it for now.
        // If you happen to know the solution to this problem please let me know, I've already looked everywhere I could.
        let entry = new St.Entry({ style_class: "todo-item-entry"});


        // This minimizes the number of errors explained in a comment above
        entry.clutter_text.set_editable(false);
        entry.set_text(Item.name);

        Item.StEntry = entry;


        entry.clutter_text.connect("button_press_event", Lang.bind(this, (actor, event) => {
            const item = this.getItem(item_index);

            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                item.toggleSelection();
                this._renderItem(item_index);
                return;
            }

            if (event.get_button() === Clutter.BUTTON_MIDDLE) {
                let dialog = new ModalDialog.ConfirmDialog(
                    _(`Are you sure you want to remove this task?`),
                    () => {
                        this.removeItem(item_index);
                        this.saveItemsToSettings();
                        this.render();
                        return;
                    }
                );
                dialog.open();
            }

            // Set editable when users click on St.Entry, this is needed to minimize errors, see comments above
            entry.clutter_text.set_editable(true);

            if ( global.stage_input_mode == Cinnamon.StageInputMode.FULLSCREEN ) return;
            global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
            item.StEntry.grab_key_focus();
            global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);  

        }));
        entry.clutter_text.connect("key_release_event", Lang.bind(this, ()=> {
            const item = this.getItem(item_index);
            item.loadText();
        }));
        entry.clutter_text.connect("key_focus_out", Lang.bind(this, ()=> {
            this.saveItemsToSettings();
        }));

        entry.style = "text-decoration:" + (Item.is_marked_done ? "line-through": "none") + ";";

        // Calculate the max width of a label based on current layout and icon size
        // Multipliers are based on experimentation
        let label_width = Math.round(th["item_width"] - th["icon_size"] * 2.4 - th["font_size"] * 2.7);
        label_width = Math.max(label_width, 0);
        
        entry.set_width(label_width);


        
        let label_container = new St.Group({style_class:"label-container"});
        label_container.add_child(entry);
        
        // Layout to center the label
        let label_box = new Clutter.BoxLayout();
        label_box.set_homogeneous(true);
        label_container.set_layout_manager(label_box);

        content_grid.attach(label_container, 1, 0, 1, 1);



        parent_button.connect("button-press-event", Lang.bind(this, function(a, event) {
            if (event.get_button() === Clutter.BUTTON_MIDDLE) {
                let dialog = new ModalDialog.ConfirmDialog(
                    _(`Are you sure you want to remove this task?`),
                    () => {
                        this.removeItem(item_index);
                        this.saveItemsToSettings()
                        this.render();
                        return;
                    }
                );
                dialog.open();
            }

            let item = this.getItem(item_index);
            item.toggleSelection();
            this._renderItem(item_index);

        }));

   
        const command_line = Item.name;
        new Tooltips.Tooltip(parent_button, command_line);

    }   

};