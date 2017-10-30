const St = imports.gi.St;
const Lang = imports.lang;


function CollapseButton(label, startState, child) {
    this._init(label, startState, child);
}

CollapseButton.prototype = {
    _init: function(label, startState, child) {
        this.state = startState;
        if ( label ) this.labelShowHide = false;
        else {
            label = "show";
            this.labelShowHide = true;
        }

        this.actor = new St.BoxLayout({ vertical: true });

        let button = new St.Button({ x_align: St.Align.START, x_expand: false, x_fill: false, style_class: "devtools-contentButton" });
        this.actor.add_actor(button);
        let buttonBox = new St.BoxLayout();
        button.set_child(buttonBox);
        this.label = new St.Label({ text: label })
        buttonBox.add_actor(this.label);

        this.arrowIcon = new St.Icon({ icon_type: St.IconType.SYMBOLIC, icon_size: 8, style: "padding: 4px;" });
        buttonBox.add_actor(this.arrowIcon);

        this.childBin = new St.Bin({ x_align: St.Align.START, visible: startState, style: "padding: 5px 0px 0px 25px;" });
        this.actor.add_actor(this.childBin);
        if ( child ) this.childBin.set_child(child);

        this._updateState();

        button.connect("clicked", Lang.bind(this, this.toggleState));
    },

    setChild: function(child) {
        this.childBin.set_child(child);
    },

    toggleState: function() {
        if ( this.state ) this.state = false;
        else this.state = true;
        this._updateState();
    },

    _updateState: function() {
        let path;
        if ( this.state ) {
            this.childBin.show();
            this.arrowIcon.icon_name = "open";
            if ( this.labelShowHide ) this.label.text = "hide";
        }
        else {
            this.childBin.hide();
            this.arrowIcon.icon_name = "closed";
            if ( this.labelShowHide ) this.label.text = "show";
        }
    }
}
