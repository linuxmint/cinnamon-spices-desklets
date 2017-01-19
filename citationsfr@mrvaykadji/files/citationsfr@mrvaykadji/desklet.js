const Cinnamon = imports.gi.Cinnamon;
const Desklet = imports.ui.desklet;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const St = imports.gi.St;

function MyDesklet(metadata, desklet_id){
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id){
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

	this.metadata = metadata;
	this.update_id = null;

	 try {
            this.settings = new Settings.DeskletSettings(
			this, this.metadata["uuid"], this.instance_id);

            this.settings.bindProperty(Settings.BindingDirection.IN, "file", "file", this.on_setting_changed, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "delay", "delay", this.on_setting_changed, null);
	} 
	catch (e) {
            global.logError(e);
        } 

		this.sep = "%"; // SPACE
		this.maxSize = 7000; // Cinnamon can crash if this int is too high

        this.setHeader(_("Citation"));
		this.setup_display();
    },

    on_setting_changed: function() {
        if (this.update_id > 0) {
            Mainloop.source_remove(this.update_id);
		}
        this.update_id = null;
        this.setup_display();
    },

    on_desklet_removed: function() {
	Mainloop.source_remove(this.update_id);
    },
   
    setup_display: function() {
        this._quoteContainer = 
		new St.BoxLayout({vertical:true, style_class: 'quote-container'});
        this._quote = new St.Label();

		this._quoteContainer.add(this._quote);
        this.setContent(this._quoteContainer);

		this.updateInProgress = false;
        this.file = this.file.replace('~', GLib.get_home_dir());
	
		this._update_loop();
    },

	/**
	 * Updates every user set secconds?
	 **/
    _update_loop: function(){
        this._update();
        this.update_id = Mainloop.timeout_add_seconds(
	    this.delay*60, Lang.bind(this, this._update_loop));
    },

	/**
	 * Method to update the text/reading of the file
	 **/
    _update: function(){
       if (this.updateInProgress) {
			return;
       }
       this.updateInProgress = true;

      try {
		  
	  // Since we update infrequently, reread the file in case it has changed
	  if (!GLib.file_test(this.file, GLib.FileTest.EXISTS))
	       return;
	  let quoteFileContents = Cinnamon.get_file_contents_utf8_sync(this.file);
	  let allQuotes = quoteFileContents.toString();

	  // Ensure first and last chars are 'sep', for symmetry
	  if (allQuotes.charAt(0) !== this.sep) {
	     allQuotes = this.sep + allQuotes;
	  }
	  if (allQuotes.lastIndexOf(this.sep) !== allQuotes.length - 1) {
	     allQuotes = allQuotes + this.sep;
	  }

	  // Now find the beginning and end of each quotation
	  this._findSeparators(allQuotes);

	  // Choose a quote randomly, subtract 1 so we don't select the ending separator 
	  let index = Math.floor(Math.random() * (this.separators.length - 1));

	  // Parse chosen quote for display
	  let currentQuote = allQuotes.substring(
		this.separators[index] + 1, this.separators[index+1]);
	  currentQuote = currentQuote.substring(0, 
		Math.min(currentQuote.length, this.maxSize)); // truncate if needed
	  this._quote.set_text(currentQuote);

	} catch (e) {
			global.logError(e);
        } finally {
            this.updateInProgress = false;
        }   
    },

    on_desklet_clicked: function(event){  
       this._update();
    },
    
    _findSeparators: function(allQuotes){
       this.separators = [];
       let index = 0;

      while (index < allQuotes.length) {
		index = allQuotes.indexOf(this.sep, index);
		if (index === -1) {
			break;  // no more separator
		}
		this.separators.push(index);
		index++;
      }
   }
}

function main(metadata, desklet_id){
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
