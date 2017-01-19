//Hope you like it.i've done this mostly for myself
//Unfortunately i dont have an accuweather api key to get more info from it.


const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Cairo = imports.cairo;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const PangoCairo = imports.gi.PangoCairo; 
const Pango = imports.gi.Pango;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const Signals = imports.signals;



const Tweener = imports.ui.tweener;
const Main = imports.ui.main;
const Cinnamon = imports.gi.Cinnamon;



const UUID="accudesk@logan";
var counter=0;var cc;
//var graphic=false;

const STYLE_POPUP_SEPARATOR_MENU_ITEM = 'popup-separator-menu-item';
const STYLE_FORECAST = 'forecast';
const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;


const _httpSession = new Soup.SessionAsync();
_httpSession.timeout=60;
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());



function MyDesklet(metadata,desklet_id){
  this._init(metadata,desklet_id);
}

MyDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,
  
  
  _init: function(metadata,desklet_id){
    //############Variables###########
    this.switch="day";this.daynames={Monday: 'Mon',Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat', Sunday:'Sun'};
    this.owicons={'202d':'04','202n':'04','211d':'04','211n':'04','212d':'04','212n':'04','900d':'04','900n':'04','901d':'04','901n':'04','902d':'04',
      '902n':'04','511d':'10','511n':'10','200d':'11','200n':'11','201d':'11','201n':'11','210d':'11','210n':'11','230d':'11','230n':'11',
      '231d':'11','231n':'11','232d':'11','232n':'11','500d':'11','500n':'11','520d':'11','520n':'11','521d':'11','521n':'11','522d':'11',
      '522n':'11','502d':'40','502n':'40','503d':'40','503n':'40','504d':'40','504n':'40','600d':'14','600n':'14','601d':'14','601n':'14',
      '602d':'42','602n':'42','906d':'18','906n':'18','731d':'19','731n':'19','701d':'20','701n':'20','741d':'20','741n':'20','721d':'21',
      '721n':'21','711d':'22','711n':'22','905d':'24','905n':'24','903d':'25','903n':'25','804d':'26','804n':'26','802n':'27','803n':'27',
      '802d':'28','803d':'28','801n':'29','801d':'30','800n':'31','800d':'32','904d':'36','904n':'36','221d':'38','501d':'39','621d':'41',
      '501n':'45','621n':'46','221n':'47','611d':'06','611n':'06','300d':'09','300n':'09','301d':'09','301n':'09','302d':'09','302n':'09',
      '310d':'09','310n':'09','311d':'09','311n':'09','312d':'09','312n':'09','321d':'09','321n':'09'};
      this.dimensions={"openweather" : [203,139,0.343],
	"yahooweather" : [203,139,0.343],
	"weather.com" : [203,139,0.343],
	"accuweather" : [200,167,0.343],
	"accutest" : [200,167,0.343]
      };
      this.testblink=[];
      
      this.daynames1=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      this.fwicons=[];this.labels=[];this.tempd=[];this.tempn=[];this.eachday=[];
      this.switch="daytime"
      this.cc=[];this.days=[];
      this.fwtooltips=[];
      this.display = global.screen.get_display();
      this.metadata = metadata
      this.update_id = null;
      this.proces=null;
      this.test=0;
      this.desklet_id=desklet_id;
      
      //==========variables for graphic===========	  
      this.chartw=new St.BoxLayout();
      this._separatorArea1 = new St.DrawingArea({height:10});
      this._separatorArea1.opacity=0;
      this._separatorArea1.set_alpha=0;
      this.connection_error=0;
      
      this.readytodraw=false;
      
      
      //################################
      
      try {
	Desklet.Desklet.prototype._init.call(this, metadata);
	//#########################binding configuration file################
	this.settings = new Settings.DeskletSettings(this, UUID, this.desklet_id);		                
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"stationID","stationID",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"units","units",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"transparency","transparency",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"textcolor","textcolor",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"bgcolor","bgcolor",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"no","no",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"zoom","zoom",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"border","border",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"bordercolor","bordercolor",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"source","source",this._prerefresh,null);
	this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"graphic","graphic",this._prerefresh, null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"halignment","horizontal",this._onDragEnd, null);
	this.settings.bindProperty(Settings.BindingDirection.ONE_WAY,"valignment","vertical",this._onDragEnd, null);
	this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"initial_height","initial_height",null,null);
	this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"initial_width","initial_width",null,null);
	this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"fix_x","fix_x",null,null);
	this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,"fix_y","fix_y",null,null);
	
	this.helpFile = DESKLET_DIR+"/README";	
	this._menu.addAction(_("Help"), Lang.bind(this, function() {
	  Util.spawnCommandLine("xdg-open " + this.helpFile);
	}));
	
	this._draggable.connect('drag-begin', Lang.bind(this, this._onDragBegin));
	this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
	this._draggable.connect('drag-cancelled', Lang.bind(this, this._onDragEnd));
	//		this.connect('fixend', Lang.bind(this,this.testing));
	this.dragging=false;
	
	this.proces=true;
	this._refreshweathers();
	
	
      }
      catch (e) {
	global.logError(e);
	
      }
      
      return true;
      
  },
  
  //##########################Reposition#########################	
  _onDragBegin: function() {
    global.set_stage_input_mode(Cinnamon.StageInputMode.FULLSCREEN);
    this.dragging=true;
  },
  
  _onDragEnd: function(){
    global.set_stage_input_mode(Cinnamon.StageInputMode.NORMAL);
    this._trackMouse();
    this.fix_x=this.actor.x;this.initial_width=this.actor.width;
    this.fix_y=this.actor.y;this.initial_height=this.actor.height;
    this.dragging=false;
    this.fixposition();
    
    
  },
  
  fixposition: function() {
    if (!this.dragging)
    {
      
      switch (this.horizontal)
      {
	case 1: {
	  //nothing to do. default behavior      
	};break;
	case 2: {
	  this.actor.x=this.fix_x+this.initial_width/2-this.actor.width/2
	};break;
	case 3: {
	  this.actor.x=this.fix_x+this.initial_width-this.actor.width;
	};break;
      };
      switch (this.vertical)
      {
	case 1: {
	  //nothing to do. default behavior
	};break;
	case 2: {
	  this.actor.y=this.fix_y+this.initial_height/2-this.actor.height/2
	};break;
	case 3: {
	  this.actor.y=this.fix_y+this.initial_height-this.actor.height;
	};break;
      }
      
      let w=global.screen_width; let h=global.screen_height;
      if (this.actor.x<0) {this.actor.x=0};
      if (this.actor.y<0) {this.actor.y=0};
      if (this.actor.y+this.actor.height>h) {this.actor.y=h-this.actor.height};
      if (this.actor.x+this.actor.width>w) this.actor.x=w-this.actor.width;
    };
    
  },
  
  //########################################################################
  style_change: function() {
    this.cwicon.height=this.dimensions[this.source][1]*(this.no==1 ? 0.5: 1)*this.zoom;
    this.cwicon.width=this.dimensions[this.source][0]*(this.no==1 ? 0.5: 1)*this.zoom;
    this.weathertext.style= 'text-align : center; font-size:'+30*this.zoom+'px';
    this.table.style="spacing-rows: "+5*this.zoom+"px;spacing-columns: "+5*this.zoom+"px;padding: "+10*this.zoom+"px;";
    this.cityname.style="text-align: center;font-size: "+14*this.zoom+"px" ;		
    this.ctemp_captions.style = 'text-align : right;font-size: '+14*this.zoom+"px";
    this.ctemp_values.style = 'text-align : left; font-size: '+14*this.zoom+"px";
    // this._separatorArea.width = 200*this.zoom;
    if (this.border)
    {
      this.window.style="border: 2px solid "+this.bordercolor+"; border-radius: 12px; background-color: "+(this.bgcolor.replace(")",","+this.transparency+")")).replace('rgb','rgba')+"; color: "+this.textcolor;
      this.chartw.style="border: 2px solid "+this.bordercolor+"; border-radius: 12px;  color: "+this.textcolor;
      
    }
    else {
      this.window.style="border-radius: 12px; background-color: "+(this.bgcolor.replace(")",","+this.transparency+")")).replace('rgb','rgba')+"; color: "+this.textcolor;
      this.chartw.style="border-radius: 12px; color: "+this.textcolor;
    }
    this._separatorArea.height=5*this.zoom;
    if(this.no>4)	{
      this.temperature.style="font-size:"+30*this.zoom+"px;text-align:center";
    } else {
      this.temperature.style="font-size:"+14*this.zoom+"px;text-align:left";
    }
    
    for(let f=1;f<this.no;f++)
    {
      this.labels[f].style='text-align : center;font-size: '+14*this.zoom+"px";
      this.fwicons[f].height=(this.dimensions[this.source][1]*this.zoom)*this.dimensions[this.source][2]
      this.fwicons[f].width=(this.dimensions[this.source][0]*this.zoom)*this.dimensions[this.source][2]
      this.tempd[f].style= 'text-align : center;font-size: '+14*this.zoom+"px";
      
    }
    
    this.buttons.style="padding-top:"+3*this.zoom+"px;padding-bottom:"+3*this.zoom+"px";
    
    this.iconbutton.icon_size=20*this.zoom;
    this.icongraphic.icon_size=20*this.zoom;
    this.banner.style='font-size: '+14*this.zoom+"px";
    if(this.no!=6)
    {
      
      this.city.style = "padding:"+10*this.zoom+"px";
      
    }
    
  },
  
  createwindow: function(){
    //global.log("creating window and test="+this.test);
    //global.log("no="+this.no);
    this.window=new St.BoxLayout({vertical: false});
    
    this.buttons=new St.BoxLayout({vertical: false,style: "padding-top:"+3*this.zoom+"px;padding-bottom:"+3*this.zoom+"px",x_align:2});
    this.iconbutton=new St.Icon({ icon_name: 'weather-clear-symbolic',
      icon_size: 20*this.zoom+'',
      icon_type: St.IconType.SYMBOLIC});
    this.icongraphic=new St.Icon({ icon_name: 'mail-send-receive-symbolic',
      icon_size: 20*this.zoom+'',
      icon_type: St.IconType.SYMBOLIC});
    this.but=new St.Button();
    this.graphicbut=new St.Button();
    this.labels=[]; this.fwicons=[];this.tempd=[]; this.eachday=[];
    this._forecasticons = new St.BoxLayout({vertical: false,x_align:2}); //---zii/iconita/temperaturi
    this._separatorArea = new St.DrawingArea({ style_class: STYLE_POPUP_SEPARATOR_MENU_ITEM });
    this.temperature = new St.Label();
    this.feelslike = new St.Label();
    this.humidity=new St.Label();
    this.pressure=new St.Label();
    this.windspeed=new St.Label();
    this.ctemp_values = new St.BoxLayout({vertical: true, style : 'text-align : left; font-size: '+14*this.zoom+"px"});
    this.ctemp_captions = new St.BoxLayout({vertical: true,style : 'text-align : right'});
    this.ctemp = new St.BoxLayout({vertical: false,x_align: 2});
    this.cityname=new St.Label({style: "text-align: center;font-size: "+14*this.zoom+"px" });
    this.city=new St.BoxLayout({vertical:true,style: "align: center;"});
    this.table=new St.Table({style: "spacing-rows: "+5*this.zoom+"px;spacing-columns: "+5*this.zoom+"px;padding: "+10*this.zoom+"px;"});
    this.container= new St.BoxLayout({vertical: true, x_align: St.Align.MIDDLE});//definire coloana dreapta
    this.cweather = new St.BoxLayout({vertical: true,y_align:2}); //definire coloana stanga
    this.cwicon = new St.Bin({height: (this.dimensions[this.source][1]*this.zoom), width: (this.dimensions[this.source][0]*this.zoom), x_fill:false, y_fill: false}); //icoana mare cu starea vremii
    this.weathertext=new St.Label({style: 'text-align : center; font-size:'+30*this.zoom+'px'}); //-textul cu starea vremii de sub ditamai icoana :)
    
    this.cweather.add_actor(this.cwicon); //--adauga icoana
    this.cweather.add_actor(this.weathertext); //-adauga textul
    
    this.weathertext.clutter_text.line_wrap = true
    
    this.city.add_actor(this.cityname); 
    
    if (this.no!=6) {
      this.ctemp_captions.add_actor(new St.Label({text: _('Temperature: ')}));
      
    };
    this.realfeel=new St.Label();
    //this.ctemp_captions.add_actor(new St.Label({text: _('Feels like: ')}));
    this.ctemp_captions.add_actor(this.realfeel);
    this.ctemp_captions.add_actor(new St.Label({text: _('Humidity: ')}));
    this.ctemp_captions.add_actor(new St.Label({text: _('Pressure: ')}));
    this.ctemp_captions.add_actor(new St.Label({text: _('Wind: ')}));
    if (this.no!=6) {
      this.ctemp_values.add_actor(this.temperature); //###adauga valori in coloana din dreapta a informatiilor despre temperatura
      
    };
    
    this.ctemp_values.add_actor(this.feelslike);
    this.ctemp_values.add_actor(this.humidity);
    this.ctemp_values.add_actor(this.pressure);
    this.ctemp_values.add_actor(this.windspeed);
    this.ctemp.add_actor(this.ctemp_captions); //-adauga coloana din stanga la informatii
    this.ctemp.add_actor(this.ctemp_values);  //adauga coloana din dreapta la informatii
    if(this.no>4) {
      this.temperature.style="font-size:"+30*this.zoom+"px;text-align:center";//this.temperature.style+="; border: 1px solid rgb(255,255,255)";
      this.feelslike.style="text-align:left";//this.feelslike.style+="; border: 1px solid rgb(255,255,255)";
      this.table.add(this.city,{row:0,col:0, col_span:2});
      this.table.add(this.temperature,{row:5,col:0});
      this.table.add(this.ctemp,{row:1,col:1, row_span:4,x_align:0});
      
    };		  
    for(let f=1;f<this.no;f++) {
      
      this.labels[f]=new St.Label({style: 'text-align : center;font-size: '+14*this.zoom+"px"});
      this.fwicons[f]=new St.Bin({height: (this.dimensions[this.source][1]*this.zoom)*this.dimensions[this.source][2], width: (this.dimensions[this.source][0]*this.zoom)*this.dimensions[this.source][2], reactive: true});
      //this.fwicons[f].set_child(this._getIconImage(days[f]['weathericon']));
      this.fwtooltips[f]=new Tooltips.Tooltip(this.fwicons[f]);
      this.tempd[f]=new St.Label({style: 'text-align : center;font-size: '+14*this.zoom+"px"});
      this.eachday[f]=new St.BoxLayout({vertical: true });
      this.eachday[f].add_actor(this.labels[f]);
      this.eachday[f].add_actor(this.fwicons[f]);
      this.eachday[f].add_actor(this.tempd[f]);
      this._forecasticons.add_actor(this.eachday[f]);		  
      
    }
    
    this.but.set_child(this.iconbutton);
    this.graphicbut.set_child(this.icongraphic);
    this.but.connect('clicked', Lang.bind(this, this.forecastchange));
    this.graphicbut.connect('clicked', Lang.bind(this, this.graphicsvisibility));
    this.banner=new St.Label;//({text: _('      AccuWeather.com'),style: 'font-size: '+14*this.zoom+"px"});
    //               Weather.Yahoo.com
    
    this.buttons.add_actor(this.but);
    this.buttons.add_actor(this.banner);
    this.buttons.add_actor(this.graphicbut);
    if(this.no>4)  {
      this.container.add_actor(this.table);
      
    }
    else {
      this.city.style = "padding:"+10*this.zoom+"px";
      this.container.add_actor(this.city); //--adauga label cu orasul
      this.container.add_actor(this.ctemp);//-- adauga tabelul cu informatiile depsre vreme
      
    }
    this.container.add_actor(this._separatorArea);//--adauga separatorul
    this.container.add_actor(this._forecasticons); //--adauga zii/iconite/temperaturi
    this.container.add_actor(this.buttons); //adauga butonul de jos si probabil si un banner cu accuweather
    switch (this.no) 
    {
      case "1" :
      {
	this.cwicon = new St.Bin({height: (this.dimensions[this.source][1]*(this.no==1 ? 0.5: 1)*this.zoom), width: (this.dimensions[this.source][0]*(this.no==1 ? 0.5: 1)*this.zoom), x_fill:false, y_fill: false}); //icoana mare cu starea vremii
	this.ctemp_values = new St.BoxLayout({vertical: true, style : 'text-align : left; font-size: '+14*this.zoom+"px"});
	this.temperature = new St.Label();
	this.window.add_actor(this.cwicon);
	this.window.add_actor(this.temperature);
	
      }; break;
      default: 
      {
	this.window.add_actor(this.cweather);
	this.window.add_actor(this.container);
	
      }
    }
    
    this.setContent(this.window);
  },	
  
  compassDirection: function(deg) {
    let directions = ['N', 'N-NE','NE','E-NE','E', 'E-SE','SE','S-SE','S','S-SW','SW','W-SW','W','W-NW','NW','N-NW']
    return directions[Math.round(deg / 22.5) % directions.length]
    
  },
  
  on_desklet_added_to_desktop: function ()
  {
    if (typeof this.fix_x==="boolean") this.fix_x=this.actor.x;
    if (typeof this.fix_y==="boolean") this.fix_y=this.actor.y;
    if (typeof this.initial_height==="boolean") this.initial_height=this.actor.height;
    if (typeof this.initial_width==="boolean") this.initial_width=this.actor.width;
    /*	  global.log("fix x="+this.fix_x+" fix y="+this.fix_y);
     *	  global.log("actor x="+this.actor.x+" actor y="+this.actor.y);
     *	  global.log("initial_width="+this.initial_width+ "initial_height="+this.initial_height);
     *	  global.log("actor w="+this.actor.width+" actor h="+this.actor.height);
     */
  },
  
  blinkblink: function(checkstatus) {
    if (typeof this.a==='undefined') this.a=20;
    if (typeof this.sign==='undefined') this.sign=1;
    if (this.testblink[checkstatus]=='test ok')
    {
      
      this.cityname.opacity=255;this.a=20;this.sign=1;
      if (typeof this._timeoutblink!=='undefined' && this._timeoutblink!=0) Mainloop.source_remove(this._timeoutblink);
      this._timeoutblink=0;
      return
    }
    else 
    {
      if (checkstatus!='graphic') this.cityname.text='Refreshing data';
      if (this.cityname.opacity<=100 || this.cityname.opacity >=255) this.sign*=-1;
      this.cityname.opacity +=this.a*this.sign;
      
      
    }
    if (typeof this._timeoutblink!=='undefined' && this._timeoutblink!=0)
    {
      Mainloop.source_remove(this._timeoutblink);
      this._timeoutblink=0;
      
    }
    this._timeoutblink=Mainloop.timeout_add(100, Lang.bind(this, this.blinkblink,checkstatus));
  },
  
  //##############################################3
  _refreshweathers: function() {
    this.chk=0; //due to openweathermap way of querying data in two steps i might end up drawing graphic before the main window gets populated with data. in this case the graphic end up with a different width than the main window
    let counter=new Date().toLocaleFormat('%H%M');
    let url;
    global.log("AccuWeather desklet "+this.desklet_id+" refreshed @"+counter);
    this.stationID=this.stationID.trim();
    
    if (this.proces)
    {
      if(this.test!=this.no)
      {
	this.test=this.no;
	this.createwindow();
	
      }
      this.style_change();
      switch(this.source)
      {
	//case "accuweather" : url = 'http://wwwa.accuweather.com/adcbin/forecastfox/weather_data.asp?location='+this.stationID+'&metric='+this.units+'&format=json'+counter; break;
	case "accuweather" : 
	{
	  url = 'http://forecastfox.accuweather.com/adcbin/forecastfox/weather_data.asp?location='+this.stationID+'&metric='+this.units+'&format=json'+counter; 
	  this.getData(url,"accuweather");
	};break;
	case "yahooweather" : 
	{
	  url = "http://query.yahooapis.com/v1/public/yql?format=json&counter="+counter+"&q=select%20*%20from%20feednormalizer%20where%20url=%22http://xml.weather.yahoo.com/forecastrss/"+this.stationID+"_"+(this.units==1 ? "c":"f")+".xml%22"; 
	  this.getData(url,"yahooweather");
	};break;
	//case "weather.com" : url = "http://xoap.weather.com/weather/local/"+this.stationID+"?cc=*&dayf=10&prod=xoap&par=1003666583&key=4128909340a9b2fc&link=xoap&unit="+(this.units==1 ? "m":"s")+"&c="+counter; break;
	case "weather.com" : 
	{
	  url = "http://dsx.weather.com/%28wxd/v2/loc/MORecord/en_US/;/wxd/v2/MORecord/en_US/;wxd/v2/DFRecord/en_US/%29/"+this.stationID+"?api=7bb1c920-7027-4289-9c96-ae5e263980bc";
	  this.getData(url,"weather.com");
	};break;	  
	case "openweather" : 
	{
	  url = 'http://api.openweathermap.org/data/2.5/weather?'+((/^\d+$/.test(this.stationID.split(' ')[0])) ? "id="+this.stationID.split(' ')[0] : "q="+this.stationID.split(' ')[0])+/*id=6697994*/'&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'lang='+this.stationID.split(' ')[1]:'lang=en')+'&units='+(this.units==1 ? "metric":"imperial");
	  this.getData(url,'openweather')
	  url='http://api.openweathermap.org/data/2.5/forecast/daily?'+((/^\d+$/.test(this.stationID.split(' ')[0])) ? "id="+this.stationID.split(' ')[0] : "q="+this.stationID.split(' ')[0])+'&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'lang='+this.stationID.split(' ')[1]+'&':'lang=en')+'&units='+(this.units==1 ? "metric":"imperial")+'&cnt=7';
	  this.getData(url,'openweather-daily')
	  //url = 'http://api.openweathermap.org/data/2.5/weather?'+((/^\d+$/.test(this.stationID.split(' ')[0])) ? "id="+this.stationID.split(' ')[0] : "q="+this.stationID.split(' ')[0])+/*id=6697994*/'&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'lang='+this.stationID.split(' ')[1]:'lang=en')+'&units='+(this.units==1 ? "metric":"imperial");break;
	};
	break;
	case "accutest" : 
	{
	  url = 'http://apidev.accuweather.com/currentconditions/v1/'+this.stationID.split(' ')[0]+'.json?apikey=hAilspiKe&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'language='+this.stationID.split(' ')[1]+'&':'')+'details=true&metric='+(this.units==1 ? "true":"false");
	  this.getData(url,"accutest");
	};break;
	//  case "openweather" : url ="http://127.0.0.1/";
	
      }
      this.drawgraphic();
      this._timeoutId=Mainloop.timeout_add_seconds(600+ Math.round(Math.random()*120), Lang.bind(this, this._prerefresh));
    }
  },
  
  
  errormessage: function(message) {
    this.cityname.text=message;
    this.temperature.text="-";
    this.humidity.text= "-";
    this.pressure.text="-";
    this.windspeed.text="-";
    this.weathertext.text="-";
    this.cwicon.set_child(this._getIconImage("na"));
    this.feelslike.text="-";
    for(let f=1;f<this.no;f++)
    {
      this.labels[f].text= "-";
      this.fwicons[f].set_child(this._getIconImage('na'));
      this.tempd[f].text=  "-";
      
    }
  },
  
  isNumber: function (o) {
    return ! isNaN (o-0) && o !== null && o !== "" && o !== false;
    
  },
  
  drawgraphic: function()
  {
    let url1;
    if (this.graphic && (this.source=="openweather" || this.source=="weather.com" || this.source=="accutest"))
    {
      if (this.readytodraw)
      {
	switch(this.source)
	{
	  //case "weather.com" :  url1='http://www.weather.com/weather/hourbyhour/graph/'+this.stationID+'?pagenum=2&nextbeginIndex=0';break
	  case 'weather.com' : url1='http://dsx.weather.com/%28x/v2/web/WebDHRecord/en_US/%29/'+this.stationID+'?api=7bb1c920-7027-4289-9c96-ae5e263980bc';break
	  case "openweather" : url1='http://api.openweathermap.org/data/2.5/forecast?'+((/^\d+$/.test(this.stationID.split(' ')[0])) ? "id="+this.stationID.split(' ')[0] : "q="+this.stationID.split(' ')[0])+/*id=6697994*/'&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'lang='+this.stationID.split(' ')[1]:'lang=en')+"&units="+(this.units==1 ? "metric":"imperial");break;
	  case "accutest" :  url1='http://apidev.accuweather.com/forecasts/v1/hourly/24hour/'+this.stationID.split(' ')[0]+'?apikey=hAilspiKe&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'language='+this.stationID.split(' ')[1]+'&':'')+'metric='+(this.units==1 ? "true":"false")+'&details=true';break;
	    
	}
	if(typeof this._timeoutdrawgraphic!=='undefined' && this._timeoutdrawgraphic!=0) Mainloop.source_remove(this._timeoutdrawgraphic);
	this._timeoutdrawgraphic=0;
	this.readytodraw=false;
	this.getData(url1,'graphic')
      }
      else
      {
	if(typeof this._timeoutdrawgraphic!=='undefined' && this._timeoutdrawgraphic!=0)
	{
	  Mainloop.source_remove(this._timeoutdrawgraphic);
	  this._timeoutdrawgraphic=0;
	}
	this._timeoutdrawgraphic=Mainloop.timeout_add(100, Lang.bind(this, this.drawgraphic));
      }
      
      
    }
    
    else
    {
      this.removeGraphic();
    }
  },
  removeGraphic: function()
  {
    this._separatorArea1.visible=false
    this.chartw.visible=false
  },
  
  populateGraphic : function(data)
  {
    let hour=[];let temp=[];let url1;let draw=false;let bins=[];let texttips=[];let tips=[];
    
    let fchours=data;
    switch(this.source)
    {
      case "weather.com" : 
      {
	let jp=new Json.Parser();
	jp.load_from_data(fchours,-1);
	
	fchours=jp.get_root().get_array().get_element(0).get_object();
	if (fchours.get_member('status').get_value()==200)
	{
	  let lista=fchours.get_object_member('doc').get_array_member('WebDHData').get_elements();
	  let date;let f=0; let g=0;
	  while (f<(this.no>4 ? 15 : 12))
	  {
	    date=new Date(lista[g].get_object().get_string_member('fcstDateTimeISO'));
	    temp[f]=lista[g].get_object().get_member((this.units==1) ? 'tmpC' : 'tmpF').get_value();
	    hour[f]=date;
	    texttips[f]="Feels like: "+lista[g].get_object().get_member(((this.units==1) ? 'feelsLikeC' : 'feelsLikeF')).get_value()+(this.units==1 ? " C" : " F") +
	    "\nHumidity: "+ lista[g].get_object().get_member("rH").get_value()+'%\n'+"Wind: "+ this.compassDirection(lista[g].get_object().get_member('wDir').get_value()) +" " +
	    lista[g].get_object().get_member((this.units==1) ? 'wSpdK' : 'wSpdM').get_value()+" " + ((this.units==1) ? 'km/h' : 'm/h')+"\n"+lista[g].get_object().get_string_member("snsblWx");
	    if((hour[f]-hour[f-1])>=(3*3600*1000) || typeof hour[f-1]==="undefined") f++;
	    g++;
	    if (g>=lista.length) f=20;
	  }
	  for (f=0;f<hour.length;f++) 
	    hour[f]=hour[f].getHours();
	  
	  this._separatorArea1.visible=true;
	  this.chartw.visible=true;
	  draw=true;
	  
	}
	else this.removeGraphic();
	
      };break;
      case "openweather" : 
      {
	let jp=new Json.Parser();
	jp.load_from_data(fchours,-1);
	fchours=jp.get_root().get_object();
	if(fchours.get_member("cod").get_value().toString()=="200")
	{
	  let lista=fchours.get_array_member('list').get_elements();
	  let f=1,index=0;let tempv;let j=true;
	  let chour=Date.now();
	  while (j) //f<(this.no>4 ? 15 : 12)){
	  {
	    //this.no>4 ? f=15 : f=12
	    let date=new Date(lista[index].get_object().get_member('dt').get_value()*1000);
	    if (date>chour) 
	    {
	      tempv=lista[index].get_object().get_object_member("main").get_member("temp").get_value();
	      temp[f]=tempv;
	      hour[f]=date.getHours();
	      let desc=lista[index].get_object().get_array_member("weather").get_elements()[0].get_object().get_string_member("description");
	      desc=desc[0].toUpperCase()+desc.slice(1);
	      texttips[f]="Humidity: "+lista[index].get_object().get_object_member("main").get_member("humidity").get_value()+"%\nPressure: ";
	      tempv=lista[index].get_object().get_object_member("main").get_member("pressure").get_value();
	      texttips[f]+=tempv+(this.units==1 ? " mb" : " inHg")+"\nWind: "+this.compassDirection(lista[index].get_object().get_object_member('wind').get_member('deg').get_value())+' ';
	      tempv=lista[index].get_object().get_object_member('wind').get_member('speed').get_value();
	      texttips[f]+=Math.round(tempv)+(this.units==1 ? " km/h" : " mph")+"\n"+desc;
	      f++;
	      
	    }
	    else
	    {
	      tempv=lista[index].get_object().get_object_member("main").get_member("temp").get_value();
	      temp[0]=tempv;
	      hour[0]=date.getHours();
	      let desc=lista[index].get_object().get_array_member("weather").get_elements()[0].get_object().get_string_member("description");
	      desc=desc[0].toUpperCase()+desc.slice(1);
	      texttips[0]="Humidity: "+lista[index].get_object().get_object_member("main").get_member("humidity").get_value()+"%\nPressure: ";
	      tempv=lista[index].get_object().get_object_member("main").get_member("pressure").get_value();
	      texttips[0]+=tempv+(this.units==1 ? " mb" : " inHg")+"\nWind: "+this.compassDirection(lista[index].get_object().get_object_member('wind').get_member('deg').get_value())+' '
	      tempv=lista[index].get_object().get_object_member('wind').get_member('speed').get_value();
	      texttips[0]+=Math.round(tempv)+lista[index].get_object().get_object_member('wind').get_member('speed').get_value()+(this.units==1 ? " km/h" : " mph")+"\n"+desc;
	      
	    }
	    index++;
	    if ((index>fchours.get_member('cnt').get_value()-1) || (index>(this.no>4 ? 14 : 11))) {j=false;}
	    
	  }
	  this._separatorArea1.visible=true;
	  this.chartw.visible=true;
	  draw=true;
	  
	}
	else this.removeGraphic();
	
      };break;
      case "accutest" :
      {
	let jp = new Json.Parser()
	jp.load_from_data(fchours, -1)
	let lista=jp.get_root().get_array().get_elements();
	for (let f=0;f<(this.no>4 ? 15 : 12);f++)
	{
	  let date=new Date(lista[f].get_object().get_member('EpochDateTime').get_value()*1000);
	  temp[f]=lista[f].get_object().get_object_member("Temperature").get_member("Value").get_value();
	  hour[f]=date.getHours();
	  texttips[f]="Feels like: "+lista[f].get_object().get_object_member('RealFeelTemperature').get_member('Value').get_value()+(this.units==1 ? " C" : " F") +"\nHumidity: "+ lista[f].get_object().get_member("RelativeHumidity").get_value()+'%\nPrecipitation: '+lista[f].get_object().get_member("PrecipitationProbability").get_value()+'%\n'+"Wind: "+ this.compassDirection(lista[f].get_object().get_object_member('Wind').get_object_member('Direction').get_member('Degrees').get_value()) +" " +lista[f].get_object().get_object_member("Wind").get_object_member('Speed').get_member("Value").get_value()+" " + lista[f].get_object().get_object_member("Wind").get_object_member('Speed').get_string_member("Unit")+"\n"+lista[f].get_object().get_string_member("IconPhrase");
	  
	}
	this._separatorArea1.visible=true;
	this.chartw.visible=true;
	draw=true;
	
      };break
      
    }
    if(draw) this.draw(hour,temp,texttips);
    else 
      if(!this.dragging) this.fixposition(); 
  },
  
  draw: function(hour,temp,texttips)
  {
    let arie=null;
    let bins=[];let tips=[];
    this._separatorArea1.width=this.window.width;
    arie=new St.DrawingArea({style:"border-radius: 12px; background-color: "+(this.bgcolor.replace(")",","+this.transparency+")")).replace('rgb','rgba')});
    arie.width=this.window.width;
    this.chartw.width=0;
    this._separatorArea1.width=0;
    this._separatorArea1.height=10;
    arie.height=135*this.zoom;
    arie.set_alpha=this.window.alpha;
    let zz=[temp,hour];
    let zoom=this.zoom;let tcolor=this.textcolor
    if (this.actor.contains(this.chartw))
    {
      this.chartw.width=0;
      this.actor.remove_actor(this.chartw);
      this.actor.remove_actor(this._separatorArea1);
      if (this.chartw.get_children().length>0)
      {
	this.chartw.destroy_all_children();
	this.chartw.add_actor(arie);
	
      } 
      else 
      {
	this.chartw.add_actor(arie);
	
      }
      this.actor.add_actor(this._separatorArea1);
      this.actor.add_actor(this.chartw);
      
    }
    else
    {
      this.actor.add_actor(this._separatorArea1);
      this.chartw.add_actor(arie);
      this.actor.add_actor(this.chartw);
      
    }
    arie.connect('repaint', Lang.bind(this, function() {
      bins=drawline(arie, zz,zoom,tcolor); 
      for (let f=0;f<bins.length;f++)
      {
	tips[f]=new Tooltips.Tooltip(bins[f]);
	tips[f].set_text(texttips[f]);
	this.chartw.add_actor(bins[f]);
	
      }
      if(!this.dragging) this.fixposition(); 
				      
    }));
    if(!this.dragging) this.fixposition(); 
  },
  
  _prerefresh: function()
  {
    if(typeof this._timeoutId !== 'undefined' && this._timeoutId!=0) {
      Mainloop.source_remove(this._timeoutId);
      this._timeoutId=0;
    }
    if (typeof this._timeoutblink!=='undefined' && this._timeoutblink!=0)
    {
      Mainloop.source_remove(this._timeoutblink);
      this._timeoutblink=0;
      
    }
    if(typeof this._timeoutdrawgraphic!=='undefined' && this._timeoutdrawgraphic!=0)
    {
      Mainloop.source_remove(this._timeoutdrawgraphic);
      this._timeoutdrawgraphic=0;
    }
    this._refreshweathers();
  },
  
  _getIconImage: function(icon_name) {
    switch(this.source)
    {
      case "accuweather" : this.icon_paths =DESKLET_DIR+'/icons/'; break;
      case "yahooweather": this.icon_paths =DESKLET_DIR+'/icons2/';break;
      case "weather.com" : this.icon_paths =DESKLET_DIR+'/icons2/';break;
      case "openweather" : this.icon_paths =DESKLET_DIR+'/icons2/';break;
      case "accutest" : this.icon_paths =DESKLET_DIR+'/icons/'; break;
      
    }
    let icon_file = this.icon_paths + icon_name + '.PNG';//((this.source=="weather.com") ? '.svg' : ".PNG");
    let file = Gio.file_new_for_path(icon_file);
    let icon_uri = file.get_uri();
    let image=St.TextureCache.get_default().load_uri_async(icon_uri, -1,-1)//200*this.zoom, 200*this.zoom);
    let x=this.dimensions[this.source][0];
    let y=this.dimensions[this.source][1];
    image.set_size(x*(this.no==1 ? 0.5: 1)*this.zoom, y*(this.no==1 ? 0.5: 1)*this.zoom)
    return image;
  },
  
  set_vars: function (doc) {
    let cc=[]
    if(doc.split('failure')!=doc)
    {
      cc['city'] = doc.split('failure')[1].substr(1,doc.split('failure')[1].length - 3);
      this.cityname.text=cc['city'];
    }
    else
    {
      
      cc['city'] = doc.split('city')[1].substr(1,doc.split('city')[1].length - 3);
      cc['state']= doc.split('state')[1].substr(1,doc.split('state')[1].length - 3);
      cc['time']=doc.split('time')[1].substr(1,doc.split('time')[1].length - 3);
      let currentconditions=doc.split('currentconditions')[1];
      cc['temperature'] = currentconditions.split('temperature')[1]; cc['temperature']=cc['temperature'].substr(1,cc['temperature'].length - 3);
      cc['pressure'] = currentconditions.split('pressure')[1];//cc['pressure']=(cc['pressure'].substr(16,cc['pressure'].length - 7)).replace("</","");
      cc['pressure']=(cc['pressure'].split('>'))[1];cc['pressure']=cc['pressure'].substr(0,cc['pressure'].length-2);
      cc['realfeel']= currentconditions.split('realfeel')[1];cc['realfeel']=cc['realfeel'].substr(1,cc['realfeel'].length - 3);
      cc['humidity']= currentconditions.split('humidity')[1];cc['humidity']=cc['humidity'].substr(1,cc['humidity'].length - 3);
      cc['weathertext']= currentconditions.split('weathertext')[1];cc['weathertext']=cc['weathertext'].substr(1,cc['weathertext'].length - 3);
      cc['weathericon']= currentconditions.split('weathericon')[1];cc['weathericon']=cc['weathericon'].substr(1,cc['weathericon'].length - 3);
      cc['windgusts'] = currentconditions.split('windgusts')[1];cc['windgusts']=cc['windgusts'].substr(1,cc['windgusts'].length - 3);
      cc['windspeed'] =currentconditions.split('windspeed')[1];cc['windspeed']=cc['windspeed'].substr(1,cc['windspeed'].length - 3);
      cc['winddirection'] = currentconditions.split('winddirection')[1];cc['winddirection']=cc['winddirection'].substr(1,cc['winddirection'].length - 3);
      cc['visibility'] = currentconditions.split('visibility')[1];cc['visibility']=cc['visibility'].substr(1,cc['visibility'].length - 3);
      cc['precip'] = currentconditions.split('precip')[1];cc['precip']=cc['precip'].substr(1,cc['precip'].length - 3);
      cc['uvindex']= currentconditions.split('uvindex')[1];cc['uvindex']=cc['uvindex'].substr(1,cc['uvindex'].length - 3);
    }
    return cc;
  },
  
  load_days: function (doc,what) {
    let ziua=[];let noaptea=[];      
    var days=[];var nights=[];
    let docs=doc.split('forecast>');
    docs=(docs[1]+"").split('<day number=');
    for (let f=1;f<docs.length;f++)
    {
      let d=(docs[f]+"").split('obsdate')[1]+"";d=d.substr(1,d.length-3);
      let dd=(docs[f]+"").split('daycode')[1]+"";dd=dd.substr(1,dd.length-3);
      ziua['date']=d;noaptea['date']=d;
      ziua['daycode']=dd;noaptea['daycode']=dd;
      let td=(docs[f]+"").split(what)[1]+"";
      ziua['txtshort']=td.split('txtshort')[1]; ziua['txtshort']=ziua['txtshort'].substr(1,ziua['txtshort'].length-3);
      ziua['txtlong']=td.split('txtlong')[1]; ziua['txtlong']=ziua['txtlong'].substr(1,ziua['txtlong'].length-3);
      ziua['weathericon']=td.split('weathericon')[1]; ziua['weathericon']=ziua['weathericon'].substr(1,ziua['weathericon'].length-3);
      ziua['hightemperature']=td.split('hightemperature')[1]; ziua['hightemperature']=ziua['hightemperature'].substr(1,ziua['hightemperature'].length-3);
      ziua['lowtemperature']=td.split('lowtemperature')[1]; ziua['lowtemperature']=ziua['lowtemperature'].substr(1,ziua['lowtemperature'].length-3);
      ziua['realfeelhigh']=td.split('realfeelhigh')[1]; ziua['realfeelhigh']=ziua['realfeelhigh'].substr(1,ziua['realfeelhigh'].length-3);
      ziua['realfeellow']=td.split('realfeellow')[1]; ziua['realfeellow']=ziua['realfeellow'].substr(1,ziua['realfeellow'].length-3);
      ziua['windspeed']=td.split('windspeed')[1]; ziua['windspeed']=ziua['windspeed'].substr(1,ziua['windspeed'].length-3);
      ziua['winddirection']=td.split('winddirection')[1]; ziua['winddirection']=ziua['winddirection'].substr(1,ziua['winddirection'].length-3);
      ziua['windgust']=td.split('windgust')[1]; ziua['windgust']=ziua['windgust'].substr(1,ziua['windgust'].length-3);
      ziua['maxuv']=td.split('maxuv')[1]; ziua['maxuv']=ziua['maxuv'].substr(1,ziua['maxuv'].length-3);
      ziua['rainamount']=td.split('rainamount')[1]; ziua['rainamount']=ziua['rainamount'].substr(1,ziua['rainamount'].length-3);
      ziua['snowamount']=td.split('snowamount')[1]; ziua['snowamount']=ziua['snowamount'].substr(1,ziua['snowamount'].length-3);
      ziua['precipamount']=td.split('precipamount')[1]; ziua['precipamount']=ziua['precipamount'].substr(1,ziua['precipamount'].length-3);
      ziua['tstormprob']=td.split('tstormprob')[1]; ziua['tstormprob']=ziua['tstormprob'].substr(1,ziua['tstormprob'].length-3);
      days[f]=ziua;
      ziua=[];
      
      
    }
    
    
    return days;
  },
  
  getData: function(url,checkstatus) {
    let here = this;
    let message = Soup.Message.new('GET', url);
    _httpSession.queue_message(message, Lang.bind(here, here.on_response, checkstatus));
    this.testblink[checkstatus]=null;
    Mainloop.timeout_add_seconds(10, Lang.bind(this, this.blinkblink,checkstatus))
    return false;
  },
  
  on_response: function(session, message, checkstatus) {
    this.readytodraw=false;
    this.testblink[checkstatus]='test ok'
    if (message.status_code===Soup.KnownStatusCode.OK) 
      switch (checkstatus)
      {
	case 'graphic' :  this.populateGraphic(message.response_body.data.toString());break;
	default :  Mainloop.timeout_add(200, Lang.bind(this, this.populateData,checkstatus,message.response_body.data.toString()));break; //wait for blinkblink to finish blinkblinking
      }
      else 
      {
	if (checkstatus!='graphic') this.errormessage ('Error code: '+message.status_code);
	else this.removeGraphic();
	global.log("AWDesklet "+this.desklet_id+"  Error: " + message.status_code+ " - " + message.reason_phrase);
	if(!this.dragging) this.fixposition();
      }
      
      
  },
  
  populateData: function(provider,data)
  {
    let weather=data;
    this.feelslike.visible=true;
    this.realfeel.visible=true;
    
    switch (provider)
    {
      case "weather.com" :
      {
	this.errormessage('');
	let jp=new Json.Parser();
	jp.load_from_data(weather, -1);
	this.but.visible=false;
	this.graphicbut.visible=true;
	this.banner.text='weather.com ';
	this.banner.style='font-size: '+14*this.zoom+"px";
	this.realfeel.text="Feels like: ";
	
	if (jp.get_root().get_array().get_element(0).get_object().get_member('status').get_value()==200)
	{
	  try
	  {
	    this.cityname.text=jp.get_root().get_array().get_element(0).get_object().get_object_member('doc').get_string_member('cityNm');
	    weather=jp.get_root().get_array().get_element(1).get_object().get_object_member('doc').get_object_member('MOData');
	    let daily=jp.get_root().get_array().get_element(2).get_object().get_object_member('doc').get_array_member('DFData').get_elements();
	    let temp=weather.get_member((this.units==1) ? "tmpC" : "tmpF").get_value();
	    this.temperature.text=Math.round(temp) +((this.units==1) ? " \u2103" : " F");
	    temp=weather.get_member((this.units==1) ? "flsLkIdxC" : "flsLkIdxF").get_value();
	    this.feelslike.text=Math.round(temp) +((this.units==1) ? " \u2103" : " F");
	    this.humidity.text=weather.get_member('rH').get_value()+' %';
	    this.pressure.text=(this.units==1 ? (weather.get_member('alt').get_value()*33.8637526).toFixed(2) : weather.get_member('alt').get_value().toFixed(2)) + " " + ((this.units==1) ? ' mb' : " inHg");
	    this.windspeed.text=this.compassDirection(weather.get_member("wDir").get_value())+" "+weather.get_member((this.units==1) ? "wSpdK" : "wSpdM").get_value().toFixed(2)+ ((this.units==1) ? ' km/h' : " mph");
	    this.weathertext.text=weather.get_string_member('wx');
	    this.cwicon.set_child(this._getIconImage(weather.get_member('sky').get_value()));
	    let icon;
	    let tmin,tmax; 
	    for(let f=1;f<this.no;f++)
	    {
	      this.labels[f].text=this.daynames[daily[f].get_object().get_string_member('dow')];
	      icon=daily[f].get_object().get_member('sky').get_value();
	      this.fwicons[f].set_child(this._getIconImage((icon<10 ? "0"+icon : icon)));
	      this.fwtooltips[f].set_text(daily[f].get_object().get_string_member('snsblWx12'));
	      this.tempd[f].text=daily[f].get_object().get_member((this.units==1) ? 'loTmpC' : 'loTmpF').get_value() + " - " +daily[f].get_object().get_member((this.units==1) ? 'hiTmpC' : 'hiTmpF').get_value()
	      
	    }
	  }
	  catch (e)
	  {
	    global.log(e);
	  }
	  this.chk=2;
	}
	else this.errormessage('Bad data');
	
	
      };
      break;
      case "openweather" :	
      {	     
	
	this.cityname.text='-';
	this.temperature.text="-";
	this.humidity.text= "-";
	this.pressure.text="-";
	this.windspeed.text="-";
	this.weathertext.text="-";
	this.cwicon.set_child(this._getIconImage("na"));
	this.feelslike.text="-";
	
	let jp = new Json.Parser();
	jp.load_from_data(weather, -1)
	if (jp.get_root().get_object().get_member('cod').get_value().toString()=="200")
	{
	  weather=jp.get_root().get_object();
	  this.but.visible=false;
	  this.graphicbut.visible=true;
	  this.banner.text='openweathermap.com ';
	  this.feelslike.visible=false;
	  this.realfeel.visible=false;
	  
	  
	  if(weather.get_string_member("cod")=="404")
	  {
	    this.errormessage("Error");
	    this._separatorArea1.visible=false
	    this.chartw.visible=false
	    
	  }
	  else
	  {
	    
	    this.cityname.text=weather.get_string_member("name")+" - "+ weather.get_object_member("sys").get_string_member("country");
	    let temp=weather.get_object_member("main").get_member("temp").get_value();
	    this.temperature.text=Math.round(temp) +((this.units==1) ? " \u2103" : " F");
	    this.humidity.text= weather.get_object_member("main").get_member("humidity").get_value()+" %";
	    this.pressure.text= weather.get_object_member("main").get_member("pressure").get_value().toFixed(2) + ((this.units==1) ? ' mb' : " inHg");
	    this.windspeed.text=this.compassDirection(weather.get_object_member("wind").get_string_member("deg"))+" "+ weather.get_object_member("wind").get_member("speed").get_value().toFixed(2)+ ((this.units==1) ? ' km/h' : " mph");
	    let t=weather.get_array_member('weather').get_elements();
	    let sunrise=weather.get_object_member('sys').get_member('sunrise').get_value()*1000;
	    let sunset=weather.get_object_member('sys').get_member('sunset').get_value()*1000;
	    let now=new Date();
	    this.cwicon.set_child(this._getIconImage(this.owicons[t[0].get_object().get_int_member("id")+(now.getTime()>=sunrise && now.getTime()<sunset ? "d": "n")])); //--refresh
	    let weathertext=t[0].get_object().get_string_member("description");
	    this.weathertext.text=weathertext[0].toUpperCase() + weathertext.slice(1);
	    
	  }
	}
	this.chk+=1
	
      };
      break;
      case 'openweather-daily' :
      {	
	this.feelslike.visible=false;
	this.realfeel.visible=false;
	
	let fc=data;
	for(let f=1;f<this.no;f++)
	{
	  this.labels[f].text= "-";
	  this.fwicons[f].set_child(this._getIconImage('na'));
	  this.tempd[f].text=  "-";
	  
	}
	let jp = new Json.Parser();
	jp.load_from_data(fc, -1)
	if (jp.get_root().get_object().get_member('cod').get_value().toString()=="200")
	{
	  if(this.no!='1')
	  {	    
	    fc=jp.get_root().get_object();
	    let lista=fc.get_array_member('list').get_elements();
	    let tmin,tmax; 
	    for(let f=1;f<this.no;f++)
	    {
	      let date=new Date(lista[f-1].get_object().get_member('dt').get_value()*1000);
	      this.labels[f].text=this.daynames1[date.getDay()];
	      let tt=lista[f-1].get_object().get_array_member('weather').get_elements();
	      let xx=this.owicons[tt[0].get_object().get_member("id").get_value()+"d"];
	      this.fwicons[f].set_child(this._getIconImage(xx));
	      this.fwtooltips[f].set_text(tt[0].get_object().get_string_member('description'));
	      tmin=lista[f-1].get_object().get_object_member("temp").get_member("min").get_value();
	      tmax=lista[f-1].get_object().get_object_member("temp").get_member("max").get_value();
	      this.tempd[f].text=Math.round(tmin)+"-"+Math.round(tmax);
	    }
	  }
	  
	}
	this.chk+=1
      };
      break;
      case "accuweather": 
      {
	this.errormessage('');
	this.but.visible=true;
	this.graphicbut.visible=false;
	this.realfeel.text="Feels Like: ";
	this.banner.text='      AccuWeather.com';
	this.banner.style='font-size: '+14*this.zoom+"px";
	this.cc=this.set_vars(weather);
	if (this.cc['city']=="Location does not exist.")
	{
	  this.errormessage("Location not found");
	  
	}
	else 
	{
	  this.days=this.load_days(weather,this.switch);
	  this.cwicon.set_child(this._getIconImage(this.cc['weathericon'])); //--refresh
	  this.weathertext.text=this.cc['weathertext'];
	  //sfarsit coloana stanga lol lol lol      
	  //coloana dreapta
	  this.cityname.text=this.cc['city']+' - '+this.cc['state'];
	  this.temperature.text = this.cc['temperature']+((this.units==1) ? " \u2103" : " F");
	  this.feelslike.text=this.cc['realfeel']+((this.units==1) ? " \u2103" : " F");
	  this.humidity.text= this.cc['humidity'].replace("%"," %");
	  this.pressure.text=this.cc['pressure']+ ((this.units==1) ? ' mb' : " inHg");
	  let wd=this.cc['winddirection'];(wd.length>2)? wd=wd.replace(wd[0]+wd[1],wd[0]+'-'+wd[1]):wd;
	  this.windspeed.text=wd+" "+this.cc['windspeed']+ ((this.units==1) ? ' km/h' : " mph");
	  for(let f=1;f<this.no;f++)
	  {
	    this.labels[f].text=this.daynames[this.days[f]['daycode']];
	    this.fwicons[f].set_child(this._getIconImage(this.days[f]['weathericon']));
	    this.fwtooltips[f].set_text(this.days[f]['txtshort']);
	    this.tempd[f].text=this.days[f]['realfeellow']+"-"+this.days[f]['realfeelhigh'];
	    
	  }
	  
	}
	
      };
      break;
      case "yahooweather" :
      {
	this.errormessage('');
	let jp = new Json.Parser();
	jp.load_from_data(weather, -1)
	weather=jp.get_root().get_object();
	
	this.but.visible=false;
	this.graphicbut.visible=false
	this.realfeel.text="Wind Chill: ";
	this.banner.text='    Weather.Yahoo.com';
	this.banner.style='font-size: '+14*this.zoom+"px";
	if (weather.get_object_member('query').get_object_member('results').has_member("error"))
	{
	  this.errormessage("Error");
	  
	}
	else
	{
	  let info=weather.get_object_member('query').get_object_member('results').get_object_member('rss').get_object_member('channel');
	  if (info.get_string_member('title')!="Yahoo! Weather - Error" && info!=null)
	  {
	    this.cityname.text=info.get_object_member('location').get_string_member("city")+" "+info.get_object_member('location').get_string_member("country");
	    this.temperature.text=info.get_object_member('item').get_object_member('condition').get_string_member('temp')+" "+((this.units==1) ? " \u2103" : " F");
	    this.humidity.text= info.get_object_member("atmosphere").get_string_member("humidity")+" %";
	    this.pressure.text=info.get_object_member("atmosphere").get_string_member("pressure") + ((this.units==1) ? ' mb' : " inHg");
	    this.windspeed.text=this.compassDirection(info.get_object_member("wind").get_string_member("direction"))+" "+info.get_object_member("wind").get_string_member("speed")+ ((this.units==1) ? ' km/h' : " mph");
	    this.weathertext.text=info.get_object_member('item').get_object_member('condition').get_string_member('text').split("/")[0];
	    let cwicon=info.get_object_member('item').get_object_member('condition').get_string_member('code');
	    if (cwicon.length<2) cwicon="0"+cwicon;
	    this.cwicon.set_child(this._getIconImage(cwicon));
	    this.feelslike.text=info.get_object_member("wind").get_string_member("chill") + ((this.units==1) ? " \u2103" : " F");
	    let fc=info.get_object_member('item').get_array_member("forecast").get_elements();
	    for(let f=1;f<this.no;f++)
	    {
	      this.labels[f].text=fc[f-1].get_object().get_string_member("day");//this.daynames1[1+((date.getDay()+6)%7)];
	      cwicon=fc[f-1].get_object().get_string_member("code")
	      if(cwicon.length<2) cwicon="0"+cwicon
		this.fwicons[f].set_child(this._getIconImage(cwicon));
	      this.tempd[f].text=fc[f-1].get_object().get_string_member("low")+"-"+fc[f-1].get_object().get_string_member("high");
	      
	    }
	    this.chk=2
	    
	  }
	  else
	  {
	    this.errormessage(info.get_object_member("item").get_string_member('title'));
	    
	  }
	  
	}
	
      };break;
      case "accutest" : 
      {
	this.but.visible=true;
	this.graphicbut.visible=true;
	this.realfeel.text="Feels Like: ";
	this.banner.text='  AccuWeather.com  ';
	this.banner.style='font-size: '+14*this.zoom+"px";
	//city info       http://apidev.accuweather.com/locations/v1/+this.stationID+.json?apikey=1&details=false
	//hourlyinfo (24) http://apidev.accuweather.com/forecasts/v1/hourly/24hour/272938?apikey=Aq6PdcG0ddlLSi7wf0mYGDjlpBEIMjicZ38F6t9jlRdb1B0Y2tKgE&metric=true
	//cc info         apidev.accuweather.com/currentconditions/v1/+this.stationID+.json?apikey=1&details=true
	//daily info (10) http://apidev.accuweather.com/forecasts/v1/daily/10day/+this.stationID+?apikey=2&metric=true		  
	//		  global.log(weather);
	//city info
	let url1="http://apidev.accuweather.com/locations/v1/"+this.stationID.split(' ')[0]+".json?apikey=hAilspiKe&details=false";
	//+this.stationID.split(' ')[0]+'.json?apikey='+counter+'&'+(this.stationID.split(' ')[1]!=="undefined" ? 'language='+this.stationID.split(' ')[1]+'&':'')		  
	let tmp=this.getData(url1,function(data){
	  let jp1=new Json.Parser();
	  jp1.load_from_data(data,-1);
	  let js=jp1.get_root().get_object();
	  this.cityname.text=js.get_string_member("LocalizedName")+" - "+js.get_object_member("AdministrativeArea").get_string_member("LocalizedName")+", "+js.get_object_member("AdministrativeArea").get_string_member("CountryID");
	});
	//end city info
	let jp = new Json.Parser();
	jp.load_from_data(weather, -1)
	let data = jp.get_root().get_array().get_element(0);
	let units=(this.units==1 ? 'Metric' : 'Imperial');
	this.cwicon.set_child(this._getIconImage(data.get_object().get_member('WeatherIcon').get_value()<10 ? "0"+data.get_object().get_member('WeatherIcon').get_value() : data.get_object().get_member('WeatherIcon').get_value()+"" )); //--refresh
	this.weathertext.text=data.get_object().get_string_member('WeatherText');
	this.temperature.text=Math.round(data.get_object().get_object_member('Temperature').get_object_member(units).get_member('Value').get_value())+((this.units==1) ? " \u2103" : " F");
	this.feelslike.text=Math.round(data.get_object().get_object_member('RealFeelTemperature').get_object_member(units).get_member('Value').get_value())+((this.units==1) ? " \u2103" : " F");
	this.humidity.text= data.get_object().get_member('RelativeHumidity').get_value()+" %";
	this.pressure.text=data.get_object().get_object_member('Pressure').get_object_member(units).get_member('Value').get_value() +" "+ data.get_object().get_object_member('Pressure').get_object_member(units).get_string_member('Unit');
	this.windspeed.text=this.compassDirection(data.get_object().get_object_member('Wind').get_object_member('Direction').get_member('Degrees').get_value())+" "+data.get_object().get_object_member('Wind').get_object_member('Speed').get_object_member(units).get_member('Value').get_value()+" "+data.get_object().get_object_member('Wind').get_object_member('Speed').get_object_member(units).get_string_member('Unit');
	//daily info
	url1="http://apidev.accuweather.com/forecasts/v1/daily/10day/"+this.stationID.split(' ')[0]+'?apikey=hAilspiKe&'+(typeof this.stationID.split(' ')[1]!=="undefined" ? 'language='+this.stationID.split(' ')[1]+'&':'')+"metric="+(this.units==1 ? "true":"false");
	let tmp2=this.getData(url1,function(data){
	  let jp1=new Json.Parser();
	  jp1.load_from_data(data,-1);
	  let temp=jp1.get_root().get_object();
	  let js=temp.get_array_member('DailyForecasts').get_elements();let icon;
	  for(let f=1;f<this.no;f++)
	  {
	    
	    let date=new Date(js[f-1].get_object().get_member('EpochDate').get_value()*1000);
	    this.labels[f].text=this.daynames1[date.getDay()];
	    // let tt=lista[f-1].get_object().get_array_member('weather').get_elements();
	    icon=js[f-1].get_object().get_object_member((this.switch=="daytime" ? 'Day' : 'Night')).get_member('Icon').get_value();
	    this.fwicons[f].set_child(this._getIconImage((icon<10 ? "0"+icon: icon+"")));
	    this.fwtooltips[f].set_text(js[f-1].get_object().get_object_member((this.switch=="daytime" ? 'Day' : 'Night')).get_string_member("IconPhrase"));
	    this.tempd[f].text=Math.round(js[f-1].get_object().get_object_member('Temperature').get_object_member('Minimum').get_member('Value').get_value())+"-"+Math.round(js[f-1].get_object().get_object_member('Temperature').get_object_member('Maximum').get_member('Value').get_value());
	    
	  }
	  
	});
	//end daily info		  
	
      };
      break
    }
    if(!this.dragging) this.fixposition();
    if (this.chk==2) this.readytodraw=true;
  },
  
  forecastchange: function() {
    if (this.source=="accuweather" || this.source=="weather.com" || this.source=='accutest')
    {
      if(this.switch=='daytime') {
	this.switch='nighttime';}
	else
	{this.switch='daytime';};
	this._prerefresh();
    }
  },
  
  graphicsvisibility: function()
  {
    
    this.graphic=!this.graphic;
    this._prerefresh();
  },
  
  
  
  
  
  on_desklet_removed: function() {
    if (typeof this._timeoutId!=='undefined' && this._timeoutId!=0)  Mainloop.source_remove(this._timeoutId);
    if (typeof this._timeoutblink!=='undefined' && this._timeoutblink!=0) Mainloop.source_remove(this._timeoutblink);
    if (typeof this._timeoutdrawgraphic!=='undefined' && this._timeoutdrawgraphic!=0) Mainloop.source_remove(this._timeoutdrawgraphic);
													     
  }
  
  
  
}



function main(metadata, desklet_id){
  let desklet = new MyDesklet(metadata,desklet_id);
  return desklet;
}

function drawline(area,puncte,zoom,textcolor) {
  // set variables
  textcolor=textcolor.split(",");
  textcolor[0]=parseInt(textcolor[0].split("(")[1])/255;textcolor[1]=parseInt(textcolor[1])/255;
  textcolor[2]=parseInt(textcolor[2].split(")")[0])/255;textcolor[3]=1;
  let [width, height] = area.get_surface_size ();
  let cr = area.get_context();
  let min=Math.min.apply(Math,puncte[0]);let max=Math.max.apply(Math,puncte[0]);
  let interval=Math.abs(max-min);
  let bordertop=15;let borderbottom=17;
  // let borderleft=20;
  let borderright=14*zoom;
  let borderleft=0;  
  let FONT = "DejaVu Sans Mono "+12*zoom; //keep your fingers crossed
  let layout=PangoCairo.create_layout(cr);
  let desc = Pango.FontDescription.from_string(FONT);
  layout.set_font_description(desc);
  
  cr.setLineWidth(1.0);
  cr.setSourceRGBA(textcolor[0],textcolor[1],textcolor[2],textcolor[3]);
  //layout.set_textColor(textcolor);
  layout.set_text("Hourly Forecast",-1);
  let box=layout.get_extents()[1]
  cr.moveTo(width/2-box.width/1000/2,2);
  borderbottom=bordertop=box.height/1000+5;
  PangoCairo.show_layout(cr,layout);
  
  
  
  
  let ratio=(height-bordertop-borderbottom)/(interval==0 ? 0.0001 : interval);
  let sir=xvalues(min,max,(height-borderbottom*2),ratio);
  let sirheight=0;
  for (let sp=0;sp<sir.length;sp++)
  {
    layout.set_text(sir[sp]+"",-1);
    if (layout.get_extents()[1].width>borderleft) borderleft=layout.get_extents()[0].width;
  }
  borderleft=borderleft/1000+6;
  let y0points=interval/2+min;
  let y0graphic=Math.floor((height-bordertop-borderbottom)/2+bordertop);
  let step=Math.floor((width-(borderleft+10)-(borderright+5))/(puncte[0].length-1));
  
  let bins=[];
  //let color=new Clutter.Color();color.red=255;color.blue=0;color.green=0;color.alpha=255;
  // end of variables    
  
  
  
  for (let k=0;k<1;k++)
  {      
    let x=borderleft+10;
    let y=y0graphic-(puncte[k][0]-y0points)*ratio;
    cr.moveTo(x,y);
    cr.arc(x,y, 2.0*zoom, 0, 2.0*zoom*Math.PI);
    bins[0]=new St.Bin({width:10*zoom,height:10*zoom,x:x-10/2*zoom,y:y-10/2*zoom,reactive:true,x_align:2});
    //      bins[0].background_color=color
    
    cr.moveTo(x,y);
    for (let f=1;f<puncte[k].length;f++)
    {
      
      y=y0graphic-(puncte[k][f]-y0points)*ratio;
      cr.lineTo(x+step,y);
      bins[f]=new St.Bin({width:10*zoom,height:10*zoom,x:x+step-10/2*zoom,y:y-10/2*zoom,reactive:true,x_align:2});
      //bins[f].background_color=color
      
      cr.arc(x+step,y, 2.67*zoom, 0, 2.0*zoom*Math.PI);
      cr.moveTo(x+step,y);
      x+=step;
    }
    
    
    for (let z=14.*zoom;z>0;z-=2.7*zoom)
    {
      cr.setLineWidth(z);
      cr.setSourceRGBA(1/255,144/255,1,1/z);
      cr.strokePreserve();
    }
    
    cr.setSourceRGBA(1,1,1,1);
    cr.setLineWidth(2.7*zoom);
    cr.strokePreserve()
    
    //=====temp labels
    
    
    let fontheight=bordertop-5; 
    for (let f=0;f<4;f++)
    {
      y=y0graphic-(sir[f]-y0points)*ratio
      cr.setSourceRGBA(textcolor[0],textcolor[1],textcolor[2],textcolor[3]);
      layout.set_text(sir[f]+"",-1);
      box=layout.get_extents()[1]
      cr.moveTo(borderleft-box.width/1000-2,y-Math.round(fontheight/2));
      PangoCairo.show_layout(cr,layout);
      cr.setSourceRGBA(1,1,1,1);
      cr.moveTo(borderleft,y);
      cr.setLineWidth(1);
      cr.lineTo(width-borderright,y);
      
    }
    
    let xlow=borderleft+10, ylow=height-fontheight-2;
    for (let f=0;f<puncte[0].length;f++)
    {
      cr.setSourceRGBA(textcolor[0],textcolor[1],textcolor[2],textcolor[3]);
      layout.set_text(puncte[1][f]+"",-1);
      box=layout.get_extents()[1]
      cr.moveTo(xlow-Math.round(box.width/1000)/2,ylow);
      PangoCairo.show_layout(cr,layout);
      
      xlow+=step;
    }
    cr.setSourceRGBA(1,1,1,1/2);
    cr.stroke();
    
    //======end temp lables
  }
  cr=null;
  return bins;
  
}  

function xvalues(min,max,height,ratio) {
  let fixed,arr=[],interval=Math.abs(max-min);
  (interval<2 ? fixed=2 :fixed=1)
  for (let f=0;f<4;f++)
  {
    arr[f]=(min+interval/3*f).toFixed(fixed)+"";
  }
  return arr;
}
