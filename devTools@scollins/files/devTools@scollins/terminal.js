const Main = imports.ui.main;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Util = imports.misc.util;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const uuid = "devTools@scollins";
let TabPanel, CollapseButton;
if (typeof require !== 'undefined') {
    TabPanel = require('./tabPanel');
    CollapseButton = require('./collapseButton');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    TabPanel = DeskletDir.tabPanel;
    CollapseButton = DeskletDir.collapseButton;
}

const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function CommandItem(command, pId, inId, outId, errId, output) {
    this._init(command, pId, inId, outId, errId, output);
}

CommandItem.prototype = {
    _init: function(command, pId, inId, outId, errId) {
        this.pId = pId;
        this.inId = inId;
        this.outId = outId;
        this.errId = errId;
        
        this.actor = new St.BoxLayout({ vertical: true, style_class: "devtools-terminal-processBox" });
        
        /**header**/
        let headerBox = new St.BoxLayout();
        this.actor.add_actor(headerBox);
        
        /*info*/
        let infoBox = new St.BoxLayout({ vertical: true });
        headerBox.add(infoBox, { expand: true });
        let table = new St.Table({ homogeneous: false, clip_to_allocation: true });
        infoBox.add(table, { y_align: St.Align.MIDDLE, y_expand: false });
        
        //command
        table.add(new St.Label({ text: _("Command") + ":   " }), { row: 0, col: 0, col_span: 1,  x_expand: false, x_align: St.Align.START });
        let commandLabel = new St.Label({ text: command });
        table.add(commandLabel, { row: 0, col: 1, col_span: 1, x_expand: false, x_align: St.Align.START });
        
        //status
        table.add(new St.Label({ text: _("Status") + ":   " }), { row: 1, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START });
        this.status = new St.Label({ text: _("Running") });
        table.add(this.status, { row: 1, col: 1, col_span: 1, y_expand: true, x_expand: false, x_align: St.Align.START });
        
        /*command options*/
        let buttonBox = new St.BoxLayout({ vertical: true });
        headerBox.add_actor(buttonBox);
        
        //clear button
        let clearButton = new St.Button({ label: _("Clear"), x_align: St.Align.END, style_class: "devtools-contentButton" });
        buttonBox.add_actor(clearButton);
        clearButton.connect("clicked", Lang.bind(this, this.clear));
        
        //end process button
        this.stopButton = new St.Button({ label: _("End Process"), x_align: St.Align.END, style_class: "devtools-contentButton" });
        buttonBox.add_actor(this.stopButton);
        this.stopButton.connect("clicked", Lang.bind(this, this.endProcess));
        
        /*output*/
        //output toggle
        let toggleBox = new St.BoxLayout();
        this.actor.add_actor(toggleBox);
        this.showOutput = true;
        let outputButton = new CollapseButton.CollapseButton(_("Output"), true);
        toggleBox.add_actor(outputButton.actor);
        
        //output
        this.output = new St.Label();
        outputButton.setChild(this.output);
        this.output.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.output.clutter_text.line_wrap = true;
        
        /*open streams and start reading*/
        let uiStream = new Gio.UnixInputStream({ fd: this.outId });
        this.input = new Gio.DataInputStream({ base_stream: uiStream });
        Mainloop.idle_add(Lang.bind(this, this.readNext));
    },
    
    readNext: function() {
        this.input.read_line_async(0, null, Lang.bind(this, this.finishRead));
    },
    
    finishRead: function(stream, res) {
        let [out, size] = stream.read_line_finish(res);
        if ( out ) {
            this.output.text += out + "\n";
            this.readNext();
        }
        else {
            this.status.text = _("Stopped");
            this.stopButton.hide();
            this.closed = true;
        }
    },
    
    endProcess: function() {
        Util.spawnCommandLine("kill " + this.pId);
    },
    
    clear: function() {
        this.actor.destroy();
    }
}


function Terminal() {
    this._init();
}

Terminal.prototype = {
    _init: function() {
        
        this.processes = [];
        this.workingDirectory = GLib.get_home_dir();
        
        this.actor = new St.BoxLayout({ vertical: true, style_class: "devtools-terminal-mainBox" });
        
        let inputBox = new St.BoxLayout({ style_class: "devtools-terminal-entry" });
        this.actor.add_actor(inputBox);
        
        this.prompt = new St.Label({ text: this.workingDirectory+"# "});
        inputBox.add_actor(this.prompt);
        
        this.input = new St.Entry({ track_hover: false, can_focus: true });
        inputBox.add(this.input, { expand: true });
        this.input.set_name("terminalInput");
        
        let scrollBox = new St.ScrollView();
        this.actor.add_actor(scrollBox);
        
        this.output = new St.BoxLayout({ vertical: true, style_class: "devtools-terminal-processesBox" });
        scrollBox.add_actor(this.output);
        
        this.input.clutter_text.connect("button_press_event", Lang.bind(this, this.enter));
        this.input.clutter_text.connect("key_press_event", Lang.bind(this, this.onKeyPress));
        
    },
    
    runInput: function() {
        try {
            
            let input = this.input.get_text();
            this.input.text = "";
            if ( input == "" ) return;
            input = input.replace("~/", GLib.get_home_dir() + "/"); //replace all ~/ with path to home directory
            
            if ( input.substr(0, 3) == "cd " ) {
                let dir;
                if ( input[3] == "/" ) {
                    dir = input.substr(3);
                }
                else {
                    dir = this.workingDirectory + "/" + input.substr(3);
                }
                if ( dir.substr(-1) == "/" ) dir = dir.slice(0, -1);
                if ( GLib.file_test(dir, GLib.FileTest.IS_DIR) ) {
                    this.workingDirectory = dir;
                    this.prompt.text = dir + " #";
                }
                return;
            }
            
            let [success, argv] = GLib.shell_parse_argv(input);
            if ( !success ) {
                Main.notify("Unable to parse \"" + input + "\"");
                return;
            }
            
            let result, pId, inId, outId, errId;
            try {
                let flags = GLib.SpawnFlags.SEARCH_PATH;
                [result, pId, inId, outId, errId] = GLib.spawn_async_with_pipes(this.workingDirectory, argv, null, flags, null, null);
            } catch(e) {
                Main.notify("Error while trying to run \"" + input + "\"", e.message);
                return;
            }
            
            let command = new CommandItem(input, pId, inId, outId, errId);
            this.output.add_actor(command.actor);
            this.processes.push(command);
            
        } catch(e) {
            global.logError(e);
        }
    },
    
    onKeyPress: function(actor, event) {
        let symbol = event.get_key_symbol();
        if ( symbol == Clutter.Return || symbol == Clutter.KP_Enter ) {
            this.runInput();
            return true;
        }
        
        return false;
    },
    
    enter: function() {
        if ( global.stage_input_mode == Cinnamon.StageInputMode.FULLSCREEN ) return;
        global.set_stage_input_mode(Cinnamon.StageInputMode.FOCUSED);
        this.input.grab_key_focus();
        global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    }
}


function TerminalInterface(parent) {
    this._init(parent);
}

TerminalInterface.prototype = {
    __proto__: TabPanel.TabPanelBase.prototype,
    
    name: _("Run"),
    
    _init: function(parent) {
        
        TabPanel.TabPanelBase.prototype._init.call(this, true);
        
        this.terminal = new Terminal();
        this.panel.add_actor(this.terminal.actor);
        
    },
    
    onSelected: function() {
        this.terminal.enter();
    }
}
