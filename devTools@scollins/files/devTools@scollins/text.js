const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Params = imports.misc.params;
const Lang = imports.lang;
const Mainloop = imports.mainloop;


function TextAllocator() {
    this._init.apply(this, arguments);
}

TextAllocator.prototype = {
    _init: function(textObj, params) {
        this.params = Params.parse (params, { text: "",
                                         style_class: "multiline-text",
                                         style: null,
                                         height: null,
                                         width: null,
                                         lines: null });

        this.textObj = textObj;
        this.outerWidth = 0;

        this.actor = new St.Bin({ reactive: true, track_hover: true, x_expand: true, x_align: St.Align.START, y_expand: true, y_align: St.Align.START });
        this.actor.set_fill(true, true);
        this.actor._delegate = this;

        this._outerWrapper = new Cinnamon.GenericContainer();
        this.actor.add_actor(this._outerWrapper);
        this._outerWrapper.connect("allocate", Lang.bind(this, this.allocateOuter));
        this._outerWrapper.connect("get-preferred-height", Lang.bind(this, this.getPreferedOuterHeight));
        this._outerWrapper.connect("get-preferred-width", Lang.bind(this, this.getPreferedOuterWidth));

        this.scroll = new St.ScrollView({style_class: this.params.style_class, style: this.params.style});
        this._outerWrapper.add_actor(this.scroll);
        this.scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this.scroll._delegate = this;

        this.scrolledContent = new St.BoxLayout();
        this.scroll.add_actor(this.scrolledContent);

        this._innerWrapper = new Cinnamon.GenericContainer({style_class:"test"});
        this.scrolledContent.add_actor(this._innerWrapper);
        this._innerWrapper.add_actor(textObj);

        this.text = textObj.clutter_text;
        this.text.set_single_line_mode(false);
        this.text.set_activatable(false);
        this.text.ellipsize = Pango.EllipsizeMode.NONE;
        this.text.line_wrap = true;
        this.text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        this.text.set_selectable(true);
        textObj.text = this.params.text;

        this._innerWrapper.connect("allocate", Lang.bind(this, this.allocateInner));
        this._innerWrapper.connect("get-preferred-height", Lang.bind(this, this.getPreferedInnerHeight));
        this._innerWrapper.connect("get-preferred-width", Lang.bind(this, this.getPreferedInnerWidth));
    },

    allocateOuter: function(actor, box, flags) {
        this.outerWidth = box.x2 - box.x1;
        this.outerHeight = box.y2 - box.y1;

        let childBox = new Clutter.ActorBox();

        childBox.x1 = box.x1;
        childBox.x2 = box.x2;
        childBox.y1 = box.y1;
        childBox.y2 = box.y2;
        this.scroll.allocate(childBox, flags);
    },

    getPreferedOuterHeight: function(actor, forWidth, alloc) {
        let height;
        let lineHeight = this.text.get_layout().get_line(0).get_pixel_extents()[1].height;
        if ( this.params.height ) height = this.params.height;
        else {
            if ( this.params.lines ) {
                height = lineHeight * this.params.lines;
            }
            else {
                height = lineHeight * 2;
            }
            height = this.scroll.get_theme_node().adjust_preferred_height(height, height)[1];
        }
        alloc.min_size = alloc.natural_size = height;
    },

    getPreferedOuterWidth: function(actor, forHeight, alloc) {
        let width;
        if ( this.params.width ) width = this.params.width;
        else width = 50;
        alloc.min_size = alloc.natural_size = width;
    },

    allocateInner: function(actor, box, flags) {
        let childBox = new Clutter.ActorBox();

        childBox.x1 = box.x1;
        childBox.x2 = box.x2;
        childBox.y1 = box.y1;
        let height = this.text.get_preferred_height(this.getInnerWidth())[1];
        childBox.y2 = box.y1+height;
        this.textObj.allocate(childBox, flags);
    },

    getPreferedInnerHeight: function(actor, forWidth, alloc) {
        let [minHeight, natHeight] = this.text.get_preferred_height(this.getInnerWidth());
        alloc.min_size = minHeight;
        alloc.natural_size = natHeight;
    },

    getPreferedInnerWidth: function(actor, forHeight, alloc) {
        let width = this.getInnerWidth();
        alloc.min_size = width;
        alloc.natural_size = width;
    },

    getInnerHeight: function() {
        let sNode = this.scroll.get_theme_node();
        let height = sNode.adjust_for_height(this.outerHeight);
        return height;
    },

    getInnerWidth: function() {
        let sNode = this.scroll.get_theme_node();
        let width = sNode.adjust_for_width(this.outerWidth);
        if ( this.scroll.vscrollbar_visible ) width -= this.scroll.vscroll.width;
        return width;
    }
}

function Label(params) {
    this._init(params);
}

Label.prototype = {
    __proto__: TextAllocator.prototype,

    _init: function(params) {
        this.label = new St.Label();

        TextAllocator.prototype._init.call(this, this.label, params);
    }
}

function Entry(params) {
    this._init(params);
}

Entry.prototype = {
    __proto__: TextAllocator.prototype,

    _init: function(params) {
        this.entry = new St.Entry({ reactive: true, track_hover: true });

        TextAllocator.prototype._init.call(this, this.entry, params);

        this.previousMode = null;

        this.text.connect("button-press-event", Lang.bind(this, this.onButtonPress));
        this.actor.connect("button-press-event", Lang.bind(this, this.onButtonPress));
        this.text.connect("cursor-event", Lang.bind(this, this.handleScrollPosition));
    },

    onButtonPress: function(actor, event) {
        if ( this.capturedEventId ) return;
        this.buttonReleaseId = this.text.connect("button-release-event", Lang.bind(this, this.onButtonRelease));
        if ( event.get_source() != this.text ) {
            this.text.cursor_position = this.text.selection_bound = this.text.text.length;
        }

        if ( !this.previousMode ) this.previousMode = global.stage_input_mode;
        global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
        this.entry.grab_key_focus();
        global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
        Clutter.grab_pointer(this.text);
        this.pointerGrabbed = true;
    },

    onButtonRelease: function(actor, event) {
        if ( this.capturedEventId ) {
            this.text.disconnect(this.buttonReleaseId);
            this.capturedEventId = null;
        }
        if ( this.pointerGrabbed ) {
            Clutter.ungrab_pointer();
            this.pointerGrabbed = false;
        }

        if ( this.previousMode ) {
            global.set_stage_input_mode(this.previousMode);
            this.previousMode = null;
        }

        return false;
    },

    handleScrollPosition: function(text, geometry) {
        let textHeight = this.entry.height;
        let scrollHeight = this.getInnerHeight();

        if ( textHeight <= scrollHeight ) return;

        let lineHeight = this.text.get_layout().get_line(0).get_pixel_extents()[1].height;
        let adjustment = this.scrolledContent.vadjustment;
        let adj = adjustment.value;

        let line = Math.floor(geometry.y/lineHeight);
        let cursorPos = line * lineHeight;
        let topLine = Math.floor(adj/lineHeight);
        let bottomLine = Math.floor((scrollHeight+adj)/lineHeight);

        if (cursorPos < adj) {
            this.newCursorPosition = cursorPos;
        }
        else if (cursorPos+lineHeight > adj+scrollHeight) {
            this.newCursorPosition = cursorPos+lineHeight-scrollHeight;
        }
        else return;

        //For some reason setting the adjustment within
        //this function causes the update to get 'stuck'
        //until something else causes to to trigger such as
        //setting the value again.
        Mainloop.idle_add(Lang.bind(this, function() {
            adjustment.set_value(this.newCursorPosition);
        }));
    }
}
