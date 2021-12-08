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

    /**
     * value of the current result
     * @type string
     */
    currentResult: "",

    _init(metadata, desklet_id) {
        // todo I guess there is a reason why I can't simply call super._init(metadata, desklet_id)?
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.buildLayout();
    },

    buildLayout() {
        // log("MiniCalcDesklet.buildLayout")
        // main container for the desklet
        this.widgets = {}
        this.widgets.mainBox = new St.BoxLayout({style_class: "calc-main-box", vertical: true});
        this.setContent(this.widgets.mainBox);

        this.widgets.text = new St.Label();
        this.widgets.text.set_text("Mini-Calc");
        this.widgets.mainBox.add_actor(this.widgets.text);

        this.widgets.expressionBox = new St.BoxLayout({style_class: "expression-box", vertical: true})
        this.widgets.mainBox.add_actor(this.widgets.expressionBox);

        this.widgets.input = new St.Entry();
        this.widgets.input.connect('key-release-event', (widget, event) => {
            const input = widget.get_text();
            this.handleKeyPress(event, input);
            return true; // event has been handled
        });
        this.widgets.expressionBox.add_actor(this.widgets.input);

        this.widgets.result = new St.Label();
        this.widgets.resultButton = new St.Button({});
        this.widgets.resultButton.set_child(this.widgets.result);
        this.widgets.resultButton.connect("clicked", (/*widget, event*/) => {
            this.appendExpression(this.currentResult);
            return true; // event has been handled
        });
        this.widgets.expressionBox.add_actor(this.widgets.resultButton);
        this.updateExpression("1 + 2")

        this.historyExpanded = false;
        this.buildHistory();
        this.widgets.mainBox.add_actor(this.widgets.historyBox);
    },

    handleKeyPress(event, input) {
        const result = this.updateResult(input);
        const keySymbol = event.get_key_symbol();
        if (keySymbol === Clutter.Return || keySymbol === Clutter.KP_Enter) {
            this.pushToHistory(input, result);
            this.updateExpression("");
        }
    },

    updateExpression(newInput) {
        this.widgets.input.set_text(newInput);
        this.updateResult(newInput);
    },
    appendExpression(newInput) {
        if (!newInput) return;
        const input = this.widgets.input.get_text();
        this.updateExpression(input + (input ? " " : "") + newInput);
    },

    updateResult(input) {
        const result = evalExpression(input);
        if (result instanceof EvalError && result.toString().startsWith("error: expected expression, got '}'")) {
            // this.widgets.result.set_text("...");
        } else {
            this.currentResult = result instanceof EvalError ? "" : result;
            this.widgets.result.set_text(input
                ? ((result instanceof EvalError ? " ? " : " = ") + result)
                : ""
            );
        }
        return result;
    },

    buildHistory: function () {
        log("MiniCalcDesklet.buildHistory!!")
        if (!this.widgets.historyBox) this.widgets.historyBox = new St.BoxLayout({
            vertical: true,
            style_class: "history-box"
        })
        this.widgets.historyBox.remove_all_children()
        if (!this.history) return

        const histList = [...this.history]

        const first = histList.shift()
        if (!first) return
        this.addHistoryItemUI(first, this.widgets.historyBox)

        if (!histList.length) return;

        const button = new St.Button({style_class: "collapse-expand-button"});
        this.widgets.historyBox.add_actor(button)
        button.connect("clicked", (/*widget, event*/) => {
            this.toggleHistoryExpanded()
            return true; // event has been handled
        });

        if (!this.historyExpanded) {
            // button.set_child(new St.Icon({icon_name: "go-up"}))
            button.set_child(new St.Label({text: "expand history", style_class: "calc-displayText-primary"}))
            return
        }
        // button.set_child(new St.Icon({icon_name: "go-down"}))
        button.set_child(new St.Label({text: "hide history", style_class: "calc-displayText-primary"}))

        let count = 0;
        for (const item of histList) {
            if (count++ > 10) break;
            this.addHistoryItemUI(item, this.widgets.historyBox)
        }
    },

    addHistoryItemUI: function (item, historyBox) {
        const inputButton = new St.Button({
            label: item.input
        });
        inputButton.connect('clicked', (/*widget, event*/) => {
            this.appendExpression(item.input);
            return true; // event has been handled
        });
        historyBox.add_actor(inputButton);

        const resultButton = new St.Button({
            label: "= " + item.result
        });
        resultButton.connect('clicked', (/*widget, event*/) => {
            this.appendExpression(item.result);
            return true; // event has been handled
        });
        historyBox.add_actor(resultButton);
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
