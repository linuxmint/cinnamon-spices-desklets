const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Params = imports.misc.params;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const uuid = "devTools@scollins";
const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function TabManager(tabArea, contentArea) {
    this._init(tabArea, contentArea);
}

TabManager.prototype = {
    _init: function(tabArea, contentArea) {
        if (tabArea) this.setTabContainer(tabArea);
        this.contentArea = contentArea;
        this.items = [];
        this.selectedIndex = -1;
    },

    setTabContainer: function(tabArea) {
        //to-do: add some handling for the case where it already has one
        this.tabArea = tabArea;

    },

    add: function(tab) {
        let info = { tabObject: tab };
        this.items.push(info);
        this.tabArea.addTab(tab.tab);
        this.contentArea.add(tab.content, { expand: true });

        info.selectId = tab.connect("select", Lang.bind(this, this.selectItem));
        info.closeId = tab.connect("close", Lang.bind(this, this.remove));
    },

    getItemForIndex: function(index) {
        if ( index >= this.items.length ) return null;
        return this.items[index].tabObject;
    },

    getIndexForItem: function(item) {
        for ( let i = 0; i < this.items.length; i++ )
            if ( item == this.items[i].tabObject ) return i;

        return -1;
    },

    getSelectedItem: function() {
        return this.getItemForIndex(this.selectedIndex);
    },

    getSelectedIndex: function() {
        return this.selectedIndex;
    },

    selectItem: function(item) {
        this.selectIndex(this.getIndexForItem(item));
    },

    selectIndex: function(index) {
        if ( index >= this.items.length ) return false;

        if ( this.selectedIndex >= 0 && this.selectedIndex < this.items.length )
            this.items[this.selectedIndex].tabObject.setSelect(false);

        this.selectedIndex = index;
        if ( this.selectedIndex >= 0 ) this.items[index].tabObject.setSelect(true);

        this.tabArea.onSelected(this, this.items[index]);
        this.emit("selection-changed");

        return true;
    },

    remove: function(tab) {
        this.tabArea.removeTab(tab.tab);
        this.contentArea.remove_actor(tab.content);

        let info = this.items[this.getIndexForItem(tab)];
        tab.disconnect(info.selectId);
        tab.disconnect(info.closeId);
        this.items.splice(this.getIndexForItem(tab),1);

        this.selectIndex(0);
    }
}
Signals.addSignalMethods(TabManager.prototype);

function TabItemBase() {
    this._init.apply(this, arguments);
}

TabItemBase.prototype = {
    _init: function(params) {
        this.params = Params.parse(params, {
            styleClass: "tab",
            canClose: false
        });

        this.tab = new St.Button({ style_class: this.params.styleClass });

        this.content = new St.Bin({ x_expand: true, x_fill: true, y_expand: true, y_fill: true });
        this.content.set_fill(true, true);
        this.content.hide();

        if ( this.params.canClose ) {
            this.actor = this.tab; //needed to make the menu work
            this.menu = new PopupMenu.PopupMenu(this.tab, 0.0, St.Side.BOTTOM);
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menuManager.addMenu(this.menu);
            Main.uiGroup.add_actor(this.menu.actor);
            this.menu.actor.hide();

            this.menu.addAction(_("Close Tab"), Lang.bind(this, function() {
                this.close();
            }));
        }

        this.tab.connect("button-press-event", Lang.bind(this, this.onTabClicked));
    },

    setSelect: function(state) {
        if ( state ) {
            this.selected = true;
            this.content.show();
            this.tab.add_style_pseudo_class("selected");
            this.onSelected();
        }
        else {
            this.selected = false;
            this.content.hide();
            this.tab.remove_style_pseudo_class("selected");
            this.onUnselected();
        }
    },

    onTabClicked:function(a, event) {
        this.emit("select");

        if ( this.params.canClose ) {
            if ( event.get_button() == 3 ) {

                if ( !this.menu ) return false;

                this.menu.toggle();
                // Check if menu gets out of monitor. Move menu to top if so

                // Find x-position of bottom edge of monitor
                let bottomEdge;
                for ( let i = 0; i < Main.layoutManager.monitors.length; i++ ) {
                    let monitor = Main.layoutManager.monitors[i];

                    if ( monitor.x <= this.tab.x && monitor.y <= this.tab.y &&
                         monitor.x + monitor.width > this.tab.x &&
                         monitor.y + monitor.height > this.tab.y ) {

                        bottomEdge = monitor.x + monitor.width;
                        break;
                    }
                }

                if ( this.tab.y + this.tab.height + this.menu.actor.height > bottomEdge ) {
                    this.menu.setArrowSide(St.Side.BOTTOM);
                }
                else {
                    this.menu.setArrowSide(St.Side.TOP);
                }

                return true;
            }
            else if ( this.menu.isOpen ) this.menu.toggle();
        }

        return false;
    },

    setContent: function(childContent) {
        this.content.add_actor(childContent);
    },

    setTabContent: function(tabContent) {
        this.tab.add_actor(tabContent);
    },

    onSelected: function() {

    },

    onUnselected: function() {

    },

    close: function() {
        this.emit("close");
    }
}
Signals.addSignalMethods(TabItemBase.prototype);

function TabBoxBase() {
    this._init.apply(this, arguments);
}

TabBoxBase.prototype = {
    _init: function(params) {
        this.params = Params.parse(params, {
            styleClass: "tabBox",
            vertical: false,
        });

        this.isVertical = params.vertical;

        this.actor = new St.BoxLayout({style_class: this.params.styleClass, vertical: this.params.vertical});
    },

    addTab: function(tabActor) {
        this.actor.add_actor(tabActor);
    },

    removeTab: function(tabActor) {
        this.actor.remove_actor(tabActor);
    },

    onSelected: function(tabManager, selected) {
        // implemented by subclasses as needed
    }
}

function ScrolledTabBox() {
    this._init.apply(this, arguments);
}

ScrolledTabBox.prototype = {
    __proto__: TabBoxBase.prototype,

    _init: function(params) {

        TabBoxBase.prototype._init.call(this, params);

        let stack = new Cinnamon.Stack();
        this.actor.add_actor(stack);

        this.scrollBox = new St.ScrollView();
        this.scrollBox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.NEVER);
        this.scrollBox.set_auto_scrolling(true);
        stack.add_actor(this.scrollBox);
        this.adjustment = this.scrollBox.hscroll.adjustment;

        this.tabContainer = new St.BoxLayout({vertical: this.isVertical});
        this.scrollBox.add_actor(this.tabContainer);

        let scrollButtonBox = new St.BoxLayout();
        stack.add_actor(scrollButtonBox);

        this.backButton = new St.Button({label: "&lt;", style_class: "devtools-tab-scrollButton"});
        scrollButtonBox.add_actor(this.backButton);
        this.backButton.connect("clicked", Lang.bind(this, this.scrollBack));

        scrollButtonBox.add(new St.Bin(), { expand: true });

        this.forwardButton = new St.Button({label: "&gt;", style_class: "devtools-tab-scrollButton"});
        scrollButtonBox.add_actor(this.forwardButton);
        this.forwardButton.connect("clicked", Lang.bind(this, this.scrollForward));

        this.adjustment.connect("changed", Lang.bind(this, this.updateScrollbuttonVisibility));
        this.adjustment.connect("notify::value", Lang.bind(this, this.updateScrollbuttonVisibility));
        this.queScrollButtonUpdate();
    },

    addTab: function(tabActor) {
        this.tabContainer.add_actor(tabActor);
        this.queScrollButtonUpdate();
    },

    removeTab: function(tabActor) {
        this.tabContainer.remove_actor(tabActor);
        this.queScrollButtonUpdate();
    },

    scrollBack: function() {
        this.adjustment.set_value(this.adjustment.value - this.adjustment.step_increment);
    },

    scrollForward: function() {
        this.adjustment.set_value(this.adjustment.value + this.adjustment.step_increment);
    },

    queScrollButtonUpdate: function() {
        if (this.updateQueued) return;
        this.updateQueued = true;
        Mainloop.idle_add(Lang.bind(this,this.updateScrollbuttonVisibility));
    },

    updateScrollbuttonVisibility: function() {
        this.updateQueued = false;
        let innerWidth = this.tabContainer.get_preferred_width(this.tabContainer.height)[1];
        let scrollWidth = this.scrollBox.allocation.get_width();
        if (innerWidth <= scrollWidth) {
            this.forwardButton.hide();
            this.backButton.hide();
            return;
        }

        if ( this.adjustment.value <= 0 ) this.backButton.hide();
        else this.backButton.show();

        if (this.adjustment.value >= innerWidth - scrollWidth) this.forwardButton.hide();
        else this.forwardButton.show();
    },

    onSelected: function(tabManager, selected) {
        Mainloop.idle_add(Lang.bind(this, this.setVisible, selected.tabObject.tab));
    },

    setVisible: function(actor) {
        let allocation = actor.allocation;

        if (allocation.x1 < this.adjustment.value) {
            if (allocation.x1 == 0) this.adjustment.value = 0;
            else this.adjustment.value = allocation.x1 - this.backButton.width - 5;
        }
        else if (allocation.x2 > this.adjustment.value + this.scrollBox.allocation.get_width() ) {
            if (allocation.x2 == this.tabContainer.get_preferred_width(0))
                this.adjustment.value = this.tabContainer.get_preferred_width(0) - this.scrollBox.allocation.get_width();
            else this.adjustment.value = allocation.x2 - this.scrollBox.allocation.get_width() + this.forwardButton.width + 5;
        }
        this.queScrollButtonUpdate();
    }
}
