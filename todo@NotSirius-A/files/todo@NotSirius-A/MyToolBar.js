
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Lang = imports.lang;
const ModalDialog = imports.ui.modalDialog;
const Tooltips = imports.ui.tooltips;

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
                             + "color:" + th["font_color"] + ";";


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

        this.grid.attach(checked_icon_btn, 0, 0, 1, 1);
        this.grid.attach(unchecked_icon_btn, 1, 0, 1, 1);
        this.grid.attach(add_icon_btn, 2, 0, 1, 1);
        this.grid.attach(remove_icon_btn, 3, 0, 1, 1);
  

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

            if (selected_num > 0) {
                let dialog = new ModalDialog.ConfirmDialog(
                    _(`Are you sure you want to remove ${selected_num} tasks?`),
                    () => {
                        this.desklet.TODOlist.removeItems(true);
                        this.desklet.TODOlist.saveItemsToSettings();
                        this.desklet.TODOlist.render();
                    }
                );
                dialog.open();
            }
        }));

        new Tooltips.Tooltip(checked_icon_btn, "Mark selected tasks done");
        new Tooltips.Tooltip(unchecked_icon_btn, "Mark selected tasks not done");
        new Tooltips.Tooltip(add_icon_btn, "Add new task");
        new Tooltips.Tooltip(remove_icon_btn, "Remove selected tasks");


    }


}