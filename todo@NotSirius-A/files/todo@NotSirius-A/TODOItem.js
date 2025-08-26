const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;


/**
* Represent a task item in a TODO list
*/
class TODOItem {
    constructor(name, is_marked_done=false, is_selection_enabled = true) {
        this.is_selected = false;
        this.name = name;
        this.is_marked_done = is_marked_done;
        this.actor = null;
        this.StEntry = null;
        this.is_selection_enabled = is_selection_enabled;
    }


    getSettingsAttrs () {
        return {
            "name": this.name,
            "is-marked-done": this.is_marked_done
        };
    }

    toggleSelection () {
        if (!this.is_selection_enabled) {
            this.is_selected = false;
            return null;
        }

        this.is_selected = !this.is_selected;
        return this.is_selected;
    }

    toggleMarkedDone () {
        this.is_marked_done = !this.is_marked_done;
        return this.is_marked_done;
    }

    loadText() {

        if (this.StEntry !== null && this.StEntry !== undefined) {
            this.name = this.StEntry.get_text();
        }
        return this.name;
    }

};