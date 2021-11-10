const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

class EvalError {
    constructor(message) {
        this.message = message;
    }

    toString() {
        return this.message;
    }
}

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
        if (result === undefined) return new EvalError("undefined");
        if (result === null) return new EvalError("null");
        return JSON.stringify(result);
    } catch (e) {
        return new EvalError("error: " + e.message);
    }
}

function MiniCalcDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MiniCalcDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    /**
     * history of past expressions
     * @type {*[]}
     */
    history: [],

    _init(metadata, desklet_id) {
        // todo I guess there is a reason why I can't simply call super._init(metadata, desklet_id)?
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.buildLayout();
    },

    buildLayout() {
        // log("MiniCalcDesklet.buildLayout")
        // main container for the desklet
        this.widgets = {}
        this.widgets.mainBox = new St.BoxLayout({style_class: "calc-mainBox", vertical: true});
        this.setContent(this.widgets.mainBox);

        this.widgets.text = new St.Label();
        this.widgets.text.set_text("Mini-Calc");
        this.widgets.mainBox.add_actor(this.widgets.text);

        this.widgets.expressionBox = new St.BoxLayout({vertical: true})
        this.widgets.mainBox.add_actor(this.widgets.expressionBox);

        this.widgets.input = new St.Entry();
        this.widgets.input.connect('key-release-event', (widget, event) => {
            const input = widget.get_text();
            this.handleKeyPress(event, input);
            return true; // event has been handled
        });
        this.widgets.expressionBox.add_actor(this.widgets.input);

        this.widgets.result = new St.Label();
        this.widgets.expressionBox.add_actor(this.widgets.result);
        this.updateExpression("1 + 2")

        this.historyExpanded = false;
        this.buildHistory();
        this.widgets.expressionBox.add_actor(this.widgets.historyBox);
    },

    handleKeyPress(event, input) {
        const result = this.updateResult(input)
        const keySymbol = event.get_key_symbol();
        if (keySymbol === Clutter.Return || keySymbol === Clutter.KP_Enter) {
            this.pushToHistory(input, result)
            this.updateExpression("")
        }
    },

    updateExpression(input) {
        this.widgets.input.set_text(input);
        this.updateResult(input)
    },

    updateResult(input) {
        const result = evalExpression(input);
        if (result instanceof EvalError && result.toString().startsWith("error: expected expression, got '}'")) {
            // this.widgets.result.set_text("...");
        } else {
            this.widgets.result.set_text((result instanceof EvalError ? " ? " : " = ") + result);
        }
        return result
    },

    buildHistory: function () {
        log("MiniCalcDesklet.buildHistory!!")
        if (!this.widgets.historyBox) this.widgets.historyBox = new St.BoxLayout({vertical: true, style_class: "history-box"})
        this.widgets.historyBox.remove_all_children()
        if (!this.history) return

        const histList = [...this.history]

        const first = histList.shift()
        if (!first) return
        this.addHistoryItemUI(first, this.widgets.historyBox)

        const button = new St.Button({style_class: "collapse-expand-button"});
        this.widgets.historyBox.add_actor(button)
        button.connect("clicked", (/*widget, event*/) => {
            this.toggleHistoryExpanded()
        });

        if (!this.historyExpanded) {
            // button.set_child(new St.Icon({icon_name: "go-up"}))
            button.set_child(new St.Label({text: "show more", style_class: "calc-displayText-primary"}))
            return
        }
        // button.set_child(new St.Icon({icon_name: "go-down"}))
        button.set_child(new St.Label({text: "hide", style_class: "calc-displayText-primary"}))

        for (const item of histList) {
            this.addHistoryItemUI(item, this.widgets.historyBox)
        }
    },

    addHistoryItemUI: function (item, historyBox) {
        historyBox.add_actor(new St.Label({
            text: item.input
        }));
        historyBox.add_actor(new St.Label({
            text: "= " + item.result
        }));
    },

    pushToHistory: function (input, result) {
        if (result instanceof EvalError) return
        const item = {input, result};
        this.history.unshift(item);
        this.buildHistory();
    },

    toggleHistoryExpanded() {
        this.historyExpanded = !this.historyExpanded
        this.buildHistory()
    }
}

function main(metadata, desklet_id) {
    log("MiniCalcDesklet.main!!");
    return new MiniCalcDesklet(metadata, desklet_id);
}
