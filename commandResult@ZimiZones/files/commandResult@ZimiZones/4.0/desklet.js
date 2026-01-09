/* global imports */
const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const uuid = "commandResult@ZimiZones";

// l10n/translation support

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function MyDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.setHeader(_("Command result"));
        this.updateId = null;
        this.updateInProgress = false;

        try {
            this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], this.instance_id);

            this.settings.bind("delay", "delay", this.onSettingChanged);
            this.settings.bind("timeout", "timeout", this.onSettingChanged);
            this.settings.bind("commands", "commands", this.onSettingChanged);
            this.settings.bind("render-ansi", "renderAnsi", this.onSettingChanged);

            this.settings.bind("font", "font", this.onStyleSettingChanged);
            this.settings.bind("font-color", "fontColor", this.onStyleSettingChanged);
            this.settings.bind("background-color", "backgroundColor", this.onStyleSettingChanged);
            this.settings.bind("background-transparency", "backgroundTransparency", this.onStyleSettingChanged);
            this.settings.bind("border-width", "borderWidth", this.onStyleSettingChanged);
            this.settings.bind("border-color", "borderColor", this.onStyleSettingChanged);
        } 
        catch (e) {
            global.logError(e);
        } 

        this.onSettingChanged();
    },

    onSettingChanged() {
        // Avoid accidently having more than one Mainloop timeout active at a time
        if (this.updateInProgress) {
            return;
        }
        this.updateInProgress = true;

        if (this.updateId > 0) {
            Mainloop.source_remove(this.updateId);
        }

        this._content = new St.BoxLayout({
            vertical: true
        });
        this.onStyleSettingChanged();
        this.setContent(this._content);

        for(let command of this.commands) {
            command.loading = false;
            this._addLabel(command, command.label, command["label-align-right"], "Loading...", command["command-align-right"]);
        }

        this._update();
        this.updateInProgress = false;
    },

    onStyleSettingChanged() {
        let fontProperties = this.getCssFont(this.font);
        this._content.style = (fontProperties.names.length === 0 ? "" : ("font-family: " + fontProperties.names.join(", ") + ";\n")) + 
                                (fontProperties.size === "" ? "" : ("font-size: " + fontProperties.size + "px;\n")) +
                                (fontProperties.style === "" ? "" : ("font-style: " + fontProperties.style + ";\n")) +
                                (fontProperties.weight === "" ? "" : ("font-weight: " + fontProperties.weight + ";\n")) +
                                "color: " + this.fontColor + ";\n" +
                                "background-color: " + this.getCssColor(this.backgroundColor, this.backgroundTransparency) + ";\n" +
                                "border-width: " + this.borderWidth + "px;\n" +
                                "border-color: " + this.getCssColor(this.borderColor, this.backgroundTransparency) + ";\n" +
                                "border-radius: 10pt;\n" +
                                "padding: 5px 10px;";
    },

    getCssFont(font){
        let names = [];
        let namesTmp;
        let fontSplitted = font.split(" ");
        let size = fontSplitted.pop();
        let style = "";
        let weight = "";
        let defaultFont = "";

        names.push(fontSplitted.join(" ").replace(/,/g, " "));

        namesTmp = [];
        ["italic", "oblique"].forEach(function(item, i) {
            names.forEach(function(item2, i2) {
                if (item2.toLowerCase().includes(item)) {
                    if (style === "") {
                        style = item;
                    }
                    namesTmp.push(item2.replace(new RegExp(item, "ig"), "").trim());
                }
            });
        });

        namesTmp.forEach(function(item, i) {
            names.push(item);
        });

        namesTmp = [];
        [            
            { weight: "100", names: ["ultra-light", "extra-light"] }, 
            { weight: "200", names: ["light", "thin"] }, 
            { weight: "300", names: ["book", "demi"] },
            { weight: "400", names: ["normal", "regular"] },
            { weight: "500", names: ["medium"] },
            { weight: "600", names: ["semibold", "demibold"] },
            { weight: "900", names: ["extra-black", "fat", "poster", "ultra-black"] },
            { weight: "800", names: ["black", "extra-bold", "heavy"] },
            { weight: "700", names: ["bold"] }
        ].forEach(function(item, i) {
            item.names.forEach(function(item2, i2) {
                names.forEach(function(item3, i3) {        
                    if (item3.toLowerCase().includes(item2)) {
                        if (weight === "") {
                            weight = item.weight;
                        }
                        namesTmp.push(item3.replace(new RegExp(item2, "ig"), "").trim());
                    }
                });
            });
        });

        namesTmp.forEach(function(item, i) {
            names.push(item);
        });

        [            
            { generic: "monospace", names: ["mono", "console"] }, 
            { generic: "cursive", names: ["brush", "script", "calligraphy", "handwriting"] }, 
            { generic: "sans-serif", names: ["sans"] },
            { generic: "serif", names: ["lucida"] }
        ].forEach(function(item, i) {
            item.names.forEach(function(item2, i2) {
                names.forEach(function(item3, i3) {        
                    if (item3.toLowerCase().includes(item2)) {
                        if (defaultFont === "") {
                            defaultFont = item.generic;
                        }
                    }
                });
            });
        });

        if (defaultFont === "") {
            defaultFont = "monospace";
        }

        namesTmp = [];
        names.forEach(function(item, i) {        
            namesTmp.push("\"" + item + "\"");
        });
        names = namesTmp;

        names.push(defaultFont);
        
        return {
            names,
            size,
            style,
            weight
        };
    },

    getCssColor(color, transparency){
        return color.replace(")", "," + (1.0 - transparency) + ")").replace("rgb", "rgba");
    },

    onDeskletClicked(event) {  
        this._update();
    },

    onDeskletRemoved() {
        if (this.updateId > 0) {
            Mainloop.source_remove(this.updateId);
        }
    },

    /**
     * Parse ANSI escape sequences and convert to CSS styles
     */
    _parseAnsi(result) {
    if (!this.renderAnsi) {
        let stripped = result.replace(/\x1B\[[\d;]*?m/g, '');
        return stripped;
    }

    const ansiColors = {
        '30': 'black',
        '31': 'red',
        '32': 'green',
        '33': 'yellow',
        '34': 'blue',
        '35': 'magenta',
        '36': 'cyan',
        '37': 'white',
        '90': 'gray',
        '91': '#ff5555',
        '92': '#55ff55',
        '93': '#ffff55',
        '94': '#5555ff',
        '95': '#ff55ff',
        '96': '#55ffff',
        '97': 'white'
    };

    let openSpans = 0;
    let styledResult = result.replace(/\x1B\[([\d;]*?)m/g, (match, codes) => {
        const codeList = codes.split(';');
        let attributes = [];

        for (let code of codeList) {
            if (ansiColors[code]) {
                attributes.push(`foreground="${ansiColors[code]}"`);
            } else if (code === '1') {
                attributes.push('weight="bold"');
            } else if (code === '4') {
                attributes.push('underline="single"');
            } else if (code === '0') {
                let reset = '</span>'.repeat(openSpans);
                openSpans = 0;
                return reset;
            }
        }

        if (attributes.length > 0) {
            openSpans++;
            return `<span ${attributes.join(' ')}>`;
        }
        return '';
    });

    styledResult += '</span>'.repeat(openSpans);
    return styledResult;
},

    /**
     * Display new command results
     **/
    _update() {
        this._getCommandResult();
        this.updateId = Mainloop.timeout_add_seconds(this.delay * 1, Lang.bind(this, this._update));
    },

    /**
     * Call command from settings
     **/
    _getCommandResult() {
        for(let command of this.commands){
            if(!command.loading){
                command.labels.label.set_text(command.label);
                //command.labels.result.set_text("Loading...");
                command.loading = true;

                Util.spawn_async(["/bin/bash", "-c", "timeout -k " + this.timeout + " " + this.timeout + " " + command.command + " || echo \"Timeout or error occured.\""], Lang.bind(this, this._setNewCommandResult, command));
            }
        }
    },

    /**
     * Callback for _getCommandResult to set the command result when spawn_async returns
     **/
     /**
 * Callback for _getCommandResult to set the command result
 */
_setNewCommandResult(result, command) {
    if (result[result.length - 1] === "\n") {
        result = result.slice(0, -1);
    }

    command.loading = false;
    command.labels.label.set_text(command.label);
    if (this.renderAnsi) {
        // Use clutter_text.set_markup for ANSI-styled output
        command.labels.result.clutter_text.set_markup(this._parseAnsi(result));
    } else {
        command.labels.result.set_text(this._parseAnsi(result));
    }
},

    _addLabel(command, left, labelAlignRight, right, commandAlignRight) {          
        command.labels = {
            label: new St.Label({
                text: left,
                style_class: labelAlignRight ? "command-result-label-align-right" : "command-result-label-align-left"
            }),
            result: new St.Label({
                text: right,
                style_class: commandAlignRight ? "command-result-label-align-right" : "command-result-label-align-left"
            })
        };

        let box = new St.BoxLayout({
        });
        box.add(command.labels.label, {
            expand: labelAlignRight
        });
        box.add(command.labels.result, {
            expand: !labelAlignRight
        });

        this._content.add(box, { 
        });
    }
};

function main(metadata, deskletId) {
    return new MyDesklet(metadata, deskletId);
}
