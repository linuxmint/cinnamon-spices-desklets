const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.metadata = metadata;
        this.isConnected = false;

        // Context Menu Items
        this._setupContextMenu();

        // Create main container (transparent wrapper)
        this._container = new St.Bin({
            style_class: "warp-root" 
        });

        // Create the actual button
        this._button = new St.Button({
            style_class: "warp-button warp-disconnected",
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        // Layout for Icon + Label
        this._layout = new St.BoxLayout({
            style_class: "warp-layout",
            vertical: false
        });

        // Icon
        let iconFile = Gio.File.new_for_path(this.metadata.path + "/warp-symbolic.svg");
        this._icon = new St.Icon({
            gicon: new Gio.FileIcon({ file: iconFile }),
            style_class: "warp-icon",
            icon_size: 24,
            icon_type: St.IconType.SYMBOLIC
        });

        // Label
        this._label = new St.Label({
            text: "OFF",
            style_class: "warp-label"
        });
        
        // Add to box layout
        this._layout.add_actor(this._icon);
        this._layout.add_actor(this._label);
        
        // Button holds the layout
        this._button.set_child(this._layout);
        
        // Container holds the button
        this._container.set_child(this._button);

        this.setContent(this._container);

        // Click event - St.Button uses 'clicked'
        this._button.connect('clicked', Lang.bind(this, this._onClicked));

        // Start checking status
        this._checkStatus();
        this._timeoutId = Mainloop.timeout_add_seconds(5, Lang.bind(this, this._checkStatus));
    },

    _setupContextMenu: function() {
        // Separator
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Toggle Item
        let toggleItem = new PopupMenu.PopupMenuItem("Toggle Connection");
        toggleItem.connect('activate', Lang.bind(this, this._onClicked));
        this._menu.addMenuItem(toggleItem);

        // View Logs Item
        let logItem = new PopupMenu.PopupMenuItem("View Logs (Looking Glass)");
        logItem.connect('activate', Lang.bind(this, function() {
            Main.createLookingGlass().open();
        }));
        this._menu.addMenuItem(logItem);

        // Separator
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Decoration Toggle (Window Frame)
        let decoItem = new PopupMenu.PopupMenuItem("Toggle Decorations (Frame)");
        decoItem.connect('activate', Lang.bind(this, function() {
            this.metadata["prevent-decorations"] = !this.metadata["prevent-decorations"];
            this._updateDecoration();
        }));
        this._menu.addMenuItem(decoItem);
    },

    _runCommand: function(args, callback) {
        try {
            let proc = new Gio.Subprocess({
                argv: args,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
            
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                    if (callback) callback(ok, stdout, stderr);
                } catch (e) {
                    global.logError("WARP Desklet Async Error: " + e.message);
                    if (callback) callback(false, "", e.message);
                }
            });
        } catch (e) {
            global.logError("WARP Desklet Spawn Error: " + e.message);
            if (callback) callback(false, "", e.message);
        }
    },

    _onClicked: function() {
        // user interaction
        global.log("WARP Desklet: Button Clicked. Current state: " + this.isConnected);
        
        // This visual feedback helps confirm the click was registered
        this._updateUI(this.isConnected, true); 

        // Toggle logic
        let action = this.isConnected ? "disconnect" : "connect";
        let expectConnected = !this.isConnected;
        
        global.log("WARP Desklet: Attempting to run: warp-cli " + action);

        let cmdStartTime = new Date().getTime();

        this._runCommand(['/usr/bin/warp-cli', action], (ok, out, err) => {
            let cmdEndTime = new Date().getTime();
            let elapsed = cmdEndTime - cmdStartTime;
            
            if (!ok) {
                 global.logError("WARP Toggle Command Failed after " + elapsed + "ms: " + err);
                 this._label.set_text("Error");
                 this._button.style_class = "warp-button warp-error";
            } else {
                global.log("WARP Desklet: CLI Command finished in " + elapsed + "ms. Waiting for state change...");
                
                // Now we poll for the actual state change
                this._pollForStateChange(expectConnected, cmdStartTime);
            }
        });
    },

    _pollForStateChange: function(expectConnected, startTime, attempt = 1) {
        if (attempt > 10) { // Timeout after ~10 seconds
             global.log("WARP Desklet: State change timed out.");
             this._checkStatus(); // Revert to normal check
             return;
        }

        this._runCommand(['/usr/bin/warp-cli', 'status'], (ok, out, err) => {
            if (ok && out) {
                let output = out.toString();
                let isNowConnected = output.includes("Connected");
                
                if (isNowConnected === expectConnected) {
                    let totalTime = new Date().getTime() - startTime;
                    global.log("WARP Desklet: SUCCESS! State changed to " + (isNowConnected ? "Connected" : "Disconnected") + " in " + totalTime + "ms.");
                    this.isConnected = isNowConnected;
                    this._updateUI(this.isConnected, false);
                } else {
                    // Not ready yet, check again in 1s
                    Mainloop.timeout_add(1000, Lang.bind(this, () => {
                        this._pollForStateChange(expectConnected, startTime, attempt + 1);
                    }));
                }
            } else {
                 this._checkStatus(); // Fallback
            }
        });
    },

    _checkStatus: function() {
        this._runCommand(['/usr/bin/warp-cli', 'status'], (ok, out, err) => {
             if (ok && out) {
                 let output = out.toString();
                 if (output.includes("Connected")) {
                     this.isConnected = true;
                     this._updateUI(true, false);
                 } else if (output.includes("Disconnected")) {
                     this.isConnected = false;
                     this._updateUI(false, false);
                 } else if (output.includes("Registration Missing")) {
                     this._label.set_text("Reg");
                     this._button.style_class = "warp-button warp-error";
                 }
             } else {
                 if (err && err.includes("not found")) {
                     this._label.set_text("No CLI");
                 } else {
                     // Could be transient
                     global.log("WARP Status Check Error: " + err);
                 }
             }
        });

        return true; // Keep the loop running
    },

    _updateUI: function(connected, working) {
        if (working) {
            this._label.set_text("...");
            return;
        }

        if (connected) {
            this._label.set_text("WARP ON");
            this._button.style_class = "warp-button warp-connected";
        } else {
            this._label.set_text("WARP OFF");
            this._button.style_class = "warp-button warp-disconnected";
        }
    },

    on_desklet_removed: function() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }
};

function main(metadata, desklet_id) {
  return new MyDesklet(metadata, desklet_id);
}
