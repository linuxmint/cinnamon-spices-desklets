const Desklet = imports.ui.desklet;
const St = imports.gi.St;


/** avoid `eval()`
 *
 * @param input
 */
function evalExpression(input) {
    try {
        const helper_functions =
            "var degToRad = (degrees) => degrees * (Math.PI / 180);" +
            "var radToDeg = (rad) => rad / (Math.PI / 180);"
        const result = Function(helper_functions + "with (Math) return " + input)();
        if (result === undefined) return "undefined";
        if (result === null) return "null";
        return result;
    } catch (e) {
        return "error: " + e.message;
    }
}

function HelloDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

HelloDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.setupUI();
    },

    setupUI: function () {
        log("JSEvaluator.setupUI")
        // main container for the desklet
        this.mainBox = new St.BoxLayout({style_class: "calc-mainBox", vertical: true});

        this.text = new St.Label();
        this.text.set_text("Mini-Calc");
        this.mainBox.add_actor(this.text);

        this.input = new St.Entry();
        this.input.set_text("1 + 2");
        this.input.connect('key-release-event', (widget /*, event */) => {
            const input = widget.get_text();
            this.result.set_text(" = " + evalExpression(input));
            return true; // event has been handled
        });
        this.mainBox.add_actor(this.input);

        this.result = new St.Label();
        this.result.set_text(evalExpression(this.input.get_text()).toString());
        this.mainBox.add_actor(this.result);

        this.setContent(this.mainBox);
    }
}

function main(metadata, desklet_id) {
    log("JSEvaluator.main!!");
    return new HelloDesklet(metadata, desklet_id);
}
