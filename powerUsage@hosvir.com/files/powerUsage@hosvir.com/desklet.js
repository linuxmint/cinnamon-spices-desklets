//Imports
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Util = imports.misc.util;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const Soup = imports.gi.Soup;
const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());


const _reading = new St.Label({ text: "0.00 kW",
								style_class: "reading" });

//Main function, used to access Desklet
function main(metadata, desklet_id) {
    return new PowerUsageDesklet(metadata, desklet_id);
}

//Used to initialise Desklet
function PowerUsageDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

//Desklet constructor
PowerUsageDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        
        
        //Bind Settings
        this._bindSettings();
                           
		//Setup Gui
        this._setupGui();
        
        //Loop
        this._updateLoop();
    },
    
    
    //Bind Settings
     _bindSettings: function() {
		 try {
			//Construct settings
			this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instance_id);

			//Bind setting values
			this.settings.bindProperty(Settings.BindingDirection.IN, "apikey", "apikey", function() {}, null);
			this.settings.bindProperty(Settings.BindingDirection.IN, "refresh", "refresh", function() {}, null);
        }catch(e) {
			global.logError(e);
        }
    },    

	//Setup GUI
    _setupGui: function() {        
        //Main wrapper
        this.wrapper = new St.BoxLayout( {vertical: true,
                                             width: 270,
                                             height: 70,
                                             style_class: "wrapper"} );
                                             
                                             
		//Gauge
		this._gauge = new St.BoxLayout( {vertical: true,
                                             width: 270,
                                             height: 70,
                                             style_class: "gauge-wrapper"} );
										
		//Add label to gauge
		this._gauge.add(_reading);
	
		//Add gauge to wrapper
		this.wrapper.add(this._gauge);
        
        //Set main content
        this.setContent(this.wrapper);
    },
    
	//Update loop
    _updateLoop: function(){
        this._update();
        
		let timeout = (this.refresh * 1000);
		
        this.update_id = Mainloop.timeout_add(
			timeout,
			Lang.bind(this, this._updateLoop)
		);
    },
    
    //Update method
    _update: function(){
		 //Get URL data
        let message = Soup.Message.new('GET', 'https://engage.efergy.com/mobile_proxy/getInstant?token=' + this.apikey);
        
        //Add message to queue
        _httpSession.queue_message(message, function(session, message) {
			if(message.status_code == 200) {
				
				//Update text label
				try{
					let resultJSON = message.response_body.data;
					let result = JSON.parse(resultJSON);
					_reading.set_text((result['reading'] / 1000) + " kW");
				}catch(e){
					global.logError(e);
				}
			}
		});
	 },
   
    //On remove
	on_desklet_removed: function() {
		Mainloop.source_remove(this.update_id);
    },
}


