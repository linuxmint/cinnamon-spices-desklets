const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const uuid = "commandOfTheDay@logg";

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function MyDesklet(metadata, desklet_id){
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    
    _init: function(metadata, desklet_id)
    {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        
        this.metadata = metadata;
        this.update_id = null;
        
        try
        {
            this.settings = new Settings.DeskletSettings(
                this, this.metadata["uuid"], this.instance_id);
            
            this.settings.bindProperty(Settings.BindingDirection.IN, "theCommand", "theCommand", this.on_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "delay", "delay", this.on_setting_changed, null);
        } 
        catch (e)
        {
            global.logError(e);
        } 
        
        this.sep = "%"; // SPACE
        this.maxSize = 7000; // Cinnamon can crash if this int is too high
        
        this.setHeader(_("Command of the day"));
        this.setup_display();
    },
    
    on_setting_changed: function()
    {
        if (this.update_id > 0)
        {
            Mainloop.source_remove(this.update_id);
        }
        this.update_id = null;
        this.setup_display();
    },
    
    on_desklet_removed: function()
    {
        Mainloop.source_remove(this.update_id);
    },
    
    setup_display: function()
    {
        this._commandContainer = 
        new St.BoxLayout({vertical:true, style_class: 'command-container'});
        this._command = new St.Label();
        
        this._commandContainer.add(this._command);
        this.setContent(this._commandContainer);
        
        this.updateInProgress = false;
        this.theCommand = this.theCommand.replace('~', GLib.get_home_dir()).replace(/\"/g,'\\\"'); //don't quote me on this
        this.mainDir = GLib.get_home_dir()+'/.local/share/cinnamon/desklets/commandOfTheDay@logg/';
        this.file = this.mainDir + "output.txt";
        
        
        this._update_loop();
    },
    
    /**
    * Updates every user set secconds
    **/
    _update_loop: function()
    {
        this._update();
        this.update_id = Mainloop.timeout_add_seconds(this.delay*60, Lang.bind(this, this._update_loop));
    },
    
    /**
    * Method to update the text/reading of the file
    **/
    _update: function(){
        if (this.updateInProgress)
        {
            return;
        }
        this.updateInProgress = true;
        try
        {
            //This is the magic that runs the command
            //Unfortunately, it seems piping doesn't work with imports.misc.util, and also the documentation didn't tell me how to grab output from the command, so "writeCommandOutput.sh" is the work around.
            Util.spawnCommandLine("bash " + this.mainDir + "writeCommandOutput.sh \""+this.theCommand+"\"");
            
            let commandFileContents = Cinnamon.get_file_contents_utf8_sync(this.file).toString();

            // Parse chosen command for display
            let commandOutput = commandFileContents.substring(0, Math.min(commandFileContents.length, this.maxSize)); // truncate if needed
            
            this._command.set_text(commandOutput);
            
        }
        catch (e)
        {
            global.logError(e);
        }
        finally
        {
            this.updateInProgress = false;
        }   
    },
    
    on_desklet_clicked: function(event)
    {  
        this._update();
    }
}

function main(metadata, desklet_id)
{
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
