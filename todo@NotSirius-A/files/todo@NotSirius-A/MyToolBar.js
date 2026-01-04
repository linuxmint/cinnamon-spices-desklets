
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Lang = imports.lang;
const ModalDialog = imports.ui.modalDialog;
const Tooltips = imports.ui.tooltips;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;


/**
* Encapsulates functionality regarding the toolbar
*/
class MyToolBar {
    constructor(desklet, container) {
        this.desklet = desklet;
        this.container = container;

        this.grid = new Clutter.GridLayout(); 
        this.grid.set_column_spacing(Math.round(2 * this.desklet.theme["scale"]));
        this.container.set_layout_manager(this.grid);

    }

    render (destroy_children = true){
        if (destroy_children) {
            this.container.destroy_all_children();
        }
        
        const th = this.desklet.theme["toolbar"];

        this.container.style = "background-color:" + th["background_color"] + ";"
                             + "color:" + th["font_color"] + ";"
                             + "border: solid " + th["border_width"] + "px " + th["border_color"] + ";";


        let checked_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let checked_icon = new St.Icon({ icon_name: "checkbox-checked-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        checked_icon_btn.set_child(checked_icon);

        let unchecked_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let unchecked_icon = new St.Icon({ icon_name: "checkbox-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        unchecked_icon_btn.set_child(unchecked_icon);

        let add_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let add_icon = new St.Icon({ icon_name: "list-add-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        add_icon_btn.set_child(add_icon);

        let remove_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let remove_icon = new St.Icon({ icon_name: "list-remove-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        remove_icon_btn.set_child(remove_icon);
        
        let mark_important_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let mark_important_icon = new St.Icon({ icon_name: "xapp-favorite-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        mark_important_icon_btn.set_child(mark_important_icon);
        
        let mark_unimportant_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let mark_unimportant_icon = new St.Icon({ icon_name: "xapp-unfavorite-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        mark_unimportant_icon_btn.set_child(mark_unimportant_icon);
        
        let edit_icon_btn = new St.Button({style_class:"toolbar-icon-btn"});
        let edit_icon = new St.Icon({ icon_name: "list-edit-symbolic", icon_type: St.IconType.APPLICATION, icon_size: th["icon_size"], style_class:"toolbar-icon" });
        edit_icon_btn.set_child(edit_icon);

        this.grid.attach(checked_icon_btn, 0, 0, 1, 1);
        this.grid.attach(unchecked_icon_btn, 1, 0, 1, 1);
        this.grid.attach(add_icon_btn, 2, 0, 1, 1);
        this.grid.attach(remove_icon_btn, 3, 0, 1, 1);
        this.grid.attach(mark_important_icon_btn, 4, 0, 1, 1);
        this.grid.attach(mark_unimportant_icon_btn, 5, 0, 1, 1);
        this.grid.attach(edit_icon_btn, 6, 0, 1, 1);
  

        checked_icon_btn.connect("clicked", Lang.bind(this, function(a, event) {

            this.desklet.TODOlist.markItemsDone(true, true);
            this.desklet.TODOlist.deselectAllItems();
            
            this.desklet.TODOlist.render();

        }));

        unchecked_icon_btn.connect("clicked", Lang.bind(this, function(a, event) {

            this.desklet.TODOlist.markItemsDone(false, true);
            this.desklet.TODOlist.deselectAllItems();
            
            this.desklet.TODOlist.render();

        }));

        add_icon_btn.connect("clicked", Lang.bind(this,() => {
            this.desklet.TODOlist.addItem(_("TODO"));
            this.desklet.TODOlist.render();
        }));

    
        remove_icon_btn.connect("clicked", Lang.bind(this,() => {
            const selected_num = this.desklet.TODOlist.getSelectedCount();


            if (selected_num > 0 && this.desklet.areDeleteToolbarDialogsEnabled) {
                let dialog = new ModalDialog.ConfirmDialog(
                    _(`Are you sure you want to remove ${selected_num} tasks?`),
                    () => {
                        this.desklet.TODOlist.removeItems(true);
                        this.desklet.TODOlist.render();
                    }
                );
                dialog.open();
            } else if (selected_num > 0){
                this.desklet.TODOlist.removeItems(true);
                this.desklet.TODOlist.render();
            }
        }));

        
        mark_important_icon_btn.connect("clicked", Lang.bind(this, function(a, event) {

            this.desklet.TODOlist.markItemsImportant(true, true);
            this.desklet.TODOlist.deselectAllItems();
            
            this.desklet.TODOlist.render();

        }));

        mark_unimportant_icon_btn.connect("clicked", Lang.bind(this, function(a, event) {

            this.desklet.TODOlist.markItemsImportant(false, true);
            this.desklet.TODOlist.deselectAllItems();
            
            this.desklet.TODOlist.render();

        }));

        edit_icon_btn.connect("clicked", Lang.bind(this,() => {

            const items = this.desklet.TODOlist.getSelected();

            items.forEach(item => {
                this.handleEditDialog(item);
            });
            this.desklet.TODOlist.deselectAllItems();

        }));


        if (this.desklet.areToolbarTooltipsEnabled) {
            new Tooltips.Tooltip(checked_icon_btn, "Mark selected tasks as done");
            new Tooltips.Tooltip(unchecked_icon_btn, "Mark selected tasks as not done");
            new Tooltips.Tooltip(add_icon_btn, "Add new task");
            new Tooltips.Tooltip(remove_icon_btn, "Remove selected tasks");
            new Tooltips.Tooltip(mark_important_icon_btn, "Mark selected tasks as important");
            new Tooltips.Tooltip(mark_unimportant_icon_btn, "Mark selected tasks as not important");
            new Tooltips.Tooltip(edit_icon_btn, "Edit selected tasks");
        }
    }


    handleEditDialog(item) {
        try {
            
            // Run an external Python script, to open a Gtk dialog which gives a more compatible input window
            // This is to allow different input methods like ibus/fcitx
            // I'm not sure if it's even possible to do this inside od JS, external Python solution is what I saw in a builtin cinnamon desklet launcher@cinnamon.org
            const [success_, command_argv] = GLib.shell_parse_argv(`python3 ${this.desklet.DESKLET_ROOT}/edit_dialog_gtk.py "${item.name}"`);

            const proc = Gio.Subprocess.new(
                command_argv,
                Gio.SubprocessFlags.STDOUT_PIPE
            );

            // Python script prints the output of the dialog when user accepts it, code here is retrieving this output from the stdout pipe
            proc.wait_async(null, () => {
                proc.communicate_utf8_async(null, null, (proc, result) => {

                    const [is_ok, name_out, _] = proc.communicate_utf8_finish(result);
                    if (is_ok) { 
                        // imports.ui.main.notifyError(name_out);
                        item.name = name_out;
                        this.desklet.TODOlist.saveItemsToSettings();

                        this.desklet.TODOlist.render();
                    }
                });
            });    
                
        } catch (e) {
            global.logError(e);
        } 
    }

}