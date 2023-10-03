const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Soup = imports.gi.Soup;
const Clutter = imports.gi.Clutter;
const Cairo = imports.cairo;
const Signals = imports.signals;
const SignalManager = imports.misc.signalManager;
const ModalDialog = imports.ui.modalDialog;
const Secret = imports.gi.Secret;
const ByteArray = imports.byteArray;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const PangoCairo = imports.gi.PangoCairo;

class GrowattDesklet extends Desklet.Desklet {
    login = false;
    statusOk = false;
    
    cookieStore = null;
    
    onePlantId = null;
    
    dataBox = null;
    gridBox = null;
    
    _nominalPower = 0;
    
    _emptyGridBoxInProgress = false;
    _updateInProgress = false;
    

    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.metadata = metadata;

        if (Soup.MAJOR_VERSION === 2) {
            this.httpSession = new Soup.SessionAsync();
        } else {
            this.httpSession = new Soup.Session();
        }

        this._signals = new SignalManager.SignalManager(null);


        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instance_id);

        this.settings.bind('delay', 'delay', this.on_setting_changed);

        this.settings.bind('server', 'server', this.on_setting_changed);
        this.settings.bind('plantId', 'plantId', this.on_setting_changed);
        this.settings.bind('account', 'account', this.on_setting_changed);
        this.settings.bind('starttime', 'starttime', this.on_setting_changed);
        this.settings.bind('endtime', 'endtime', this.on_setting_changed);

        this.STORE_SCHEMA = new Secret.Schema("org.GrowattMonitorDesklet.Schema",Secret.SchemaFlags.NONE,{});
        
        this.render();
        
        this.setUpdateTimer();
    }
    
    on_setting_changed() {
        this.setUpdateTimer(3);
    }

    on_password_stored(source, result) {
        Secret.password_store_finish(result);
    }
    
    onPasswordSave() {

            let dialog = new PasswordDialog (
                _("'%s' settings..\nPlease enter password:").format(this._(this._meta.name)),
                (password) => {
                    Secret.password_store(this.STORE_SCHEMA, {}, Secret.COLLECTION_DEFAULT,
                      "GrowattMonitor_Desklet_password", password, null, this.on_password_stored);
                }
            );
            dialog.open();
            
    }    
    
    onRefreshClicked() {
        log("clicked");
        this.setUpdateTimer(3);
    }

    render() {
        this.setHeader(_('Growatt Monitor'));
      
        this.headBox = new St.BoxLayout({ vertical: false });
            
            this.updated = new St.Label({});
            this.updated.set_text('Loading: ' + this.server + ' ...' );
            
            let paddingBox = new St.Bin({ width: 10 });
        
            this.refreshButton = new St.Button();
            this.refreshIcon = new St.Icon({
                              icon_name: 'reload',
                              icon_size: 20, 
                              icon_type: St.IconType.SYMBOLIC
            });
            this.refreshButton.set_child(this.refreshIcon);
            this.refreshButton.connect("clicked", Lang.bind(this, this.onRefreshClicked));
            
        
        this.headBox.add(this.updated);
        this.headBox.add(paddingBox, { expand: true });
        this.headBox.add_actor(this.refreshButton);
        
        this.dataBox = new St.BoxLayout({ vertical: true });
        this.gridBox = new St.BoxLayout({ vertical: true });
        
        this.mainBox = new St.BoxLayout({ vertical: true });
        this.mainBox.add_actor(this.headBox);
        this.mainBox.add(this.dataBox);
        this.mainBox.add(this.gridBox);
        
        this.setContent(this.mainBox);        

        this.headBox.connect( 'enter-event', () => {
            global.log('enter...');
        } );  

    }

    on_desklet_removed() {
      if (this.updateLoopId) {
        Mainloop.source_remove(this.updateLoopId);
      }
    }
    
    
    __padTo2Digits(num) {
      return num.toString().padStart(2, '0');
    }

    __formatDate(date) {
      return (
        'GrowattMonitor@' + 
        [
          date.getFullYear(),
          this.__padTo2Digits(date.getMonth() + 1),
          this.__padTo2Digits(date.getDate()),
        ].join('-') +
        ' ' +
        [
          this.__padTo2Digits(date.getHours()),
          this.__padTo2Digits(date.getMinutes()),
          this.__padTo2Digits(date.getSeconds()),
        ].join(':')
      );
    }    

    onUpdate() {
    
        if (this._updateInProgress) {
            return;
        } else {
        
            this._updateInProgress = true;
    
            this.updated.set_text(this.__formatDate(new Date()));
            
            this.performStatusCheck();
            this.performStatusCheckDataGrid();
            
            this.setUpdateTimer();
            
            this._updateInProgress = false;
        }
    
    }
        

    setUpdateTimer(setTimer = -1) {

        if (this.updateLoopId) {
          Mainloop.source_remove(this.updateLoopId);
        }

        let timeOut = this.delay 
        if (!this.statusOk) {
          timeOut = 15;
        }
        
        if (setTimer > 0)  {
          timeOut = setTimer;
        }
        
        this.updateLoopId = Mainloop.timeout_add_seconds(timeOut, Lang.bind(this, this.onUpdate));
    }
    
    
    //------------------------

    //HTTP request creator function
    /*
        This function creates all of our HTTP requests.
    */
    httpRequest(method,url,headers,postParameters,callbackF) {
    
        var message = Soup.Message.new(
            method,
            url
        );

        if (headers !== null) {
            for (let i = 0;i < headers.length;i++) {
                message.request_headers.append(headers[i][0],headers[i][1]);
            }
        }

        if (this.cookieStore !== null) {
            Soup.cookies_to_request( this.cookieStore, message );
        }

        if (Soup.MAJOR_VERSION === 2) {
            if (postParameters !== null) {
                message.set_request("application/x-www-form-urlencoded",2,postParameters);
            }

            this.httpSession.queue_message(message,

                Lang.bind(this, function(session, response) {

                  let body = response.response_body.data;

                  if (response.status_code==300) {
                    global.log('UrlData: ', message.response_body.data);
                  }

                  this.statusOk = false;
                  let result = {
                    result: '0'
                  }; 
                  try {
                      result = JSON.parse(message.response_body.data);

                      if ( (typeof result.result =='undefined') || result.result !='1') {
                          this.statusOk = true;
                      }

                  } catch(e) {
                  }
                  
                  if (result.result=='0') {
                    this._failedLogin(this);
                  }

                  callbackF(this, message, result);
                  return;
                })
            );
        } else {
            if (postParameters !== null) {
                const bytes = GLib.Bytes.new(ByteArray.fromString(postParameters));
                message.set_request_body_from_bytes('application/x-www-form-urlencoded', bytes);
            }

            this.httpSession.send_and_read_async(message, 0, null, (session, res) => {
                this.statusOk = false;
                let result = {
                    result: '0'
                };
                try {
                    const bytes = session.send_and_read_finish(res);
                    result = JSON.parse(ByteArray.toString(bytes.get_data()));
                    if ( (typeof result.result =='undefined') || result.result !='1') {
                        this.statusOk = true;
                    }
                } catch (e) {}
                if (result.result == '0') {
                    this._failedLogin(this);
                }

                callbackF(this, message, result);
            });
        }
    }

    _emptyGridBox(context) {
      
      if (context._emptyGridBoxInProgress) {
        return;
      } else {
        context._emptyGridBoxInProgress = true;
        context.gridBox.destroy_all_children();
        context._emptyGridBoxInProgress = false;
      }
    
    }


    _failedLogin(context) {
        context.login = false;
        context.cookieStore = null;
        global.log('growattMonitor: Login: FALSE');    
        
        context._emptyGridBox(context);
        
        const errorLabel = new St.Label({ text: _('LOGIN_ERROR: Check credentials configuration!'), style: 'color: red;' });
        
        context.gridBox.add( errorLabel );
    }
    
        

    performLogin() {
      
        if (this.lockPerformLogin) {
          return;
        }

        this.lockPerformLogin = true;

        this.password = Secret.password_lookup_sync(this.STORE_SCHEMA, {}, null );

        const url = this.server + '/login' ; 
        const data = 'account=' + this.account + '&password=' + this.password + '&validateCode=&isReadPact=0';

        this.httpRequest(
            'POST', 
            url, 
            null, 		// headers
            data, 		// postParams
            function(context, message, result) {
                    context.lockPerformLogin = false;
                    if (result.result=='1' ) {

                            context.login = true;
                  
                            const list = Soup.cookies_from_response(message);
                  
                            context.cookieStore = list;
                  
                            context.cookieStore.forEach( function(c) {
                                 if (c.get_name()=='onePlantId') {
                                    context.onePlantId = c.get_value();
                                 }
                            }); // forEach
                            
                     }
            } 
        ); 
    }
    
    
    _displayText(area, cr, str, x, y, width, height) {
        var pangolayout = area.create_pango_layout(str);
        pangolayout.set_alignment(Pango.Alignment.CENTER);
        pangolayout.set_width(width);
        var fontsize_px = height;
        var fontdesc = Pango.font_description_from_string("Sans Normal " + fontsize_px + "px");
        pangolayout.set_font_description(fontdesc);
        cr.moveTo(x, y);
        PangoCairo.layout_path(cr, pangolayout);
        cr.fill(); 
    }
    
    _displayGrid(area, cr, width, height, st, et, maxW) {
    
        cr.setSourceRGBA ( 0.3,  0.3,  0.1, 0.5); // RGBa        
        cr.rectangle(0,0,width,height);
        cr.stroke();
    
        var hours = [6,9,12,15,18,21];        
        hours.forEach( function(hh, i){
            var hhX = width * ( (hh - st) / (et - st));
            cr.setSourceRGBA ( 0.3,  0.3,  0.1, 0.5); // RGBa        
            cr.rectangle(hhX,0,1,height);
            cr.stroke();
            
            cr.setSourceRGBA ( 0.7,  0.7,  0.4,  0.5); // RGBa        
            this._displayText(area, cr, hh.toString() + 'h', hhX+10, 5, 100, 10);
        }, this);
        

        for(let w=2000; w < maxW ; w+= 2000) {
            var wY = height - (height * ( w / maxW ));
            
            cr.setSourceRGBA ( 0.3,  0.3,  0.1, 0.5); // RGBa        
            cr.rectangle(0 ,wY,width,1);
            cr.stroke();
            
            cr.setSourceRGBA ( 0.7,  0.7,  0.4,  0.5); // RGBa        
            this._displayText(area, cr, (w/1000).toString() + 'kW', 15, wY+1, 100, 10);
        }
        
    
    }

    
    repaintDataGrid(area) { 
        
        let pacArr = this._daychartresult;
        let nominalPower = this._nominalPower;
        
        let st = this.starttime;
        let et = this.endtime;
        
        let cr = area.get_context();
        let [width, height] = area.get_surface_size();
        let color = area.get_theme_node().get_foreground_color();

        
        this._displayGrid(area, cr, width, height, st, et, nominalPower);
        
        cr.setSourceRGBA ( 0.3,  1.0,  0.3, 0.7); // RGBa
        pacArr.forEach( function(pac, i) {
            if (pac > 0) {
              let iTimeHrs = 24 * ( i / pacArr.length );
              let xx = width * ( (iTimeHrs - st) / (et - st) );

              // Display only if xx in range
              if (xx > 0 && xx < width) {
                  let y = height - ( height * (  pac / nominalPower  ) );
 
                  cr.rectangle(xx, y, 2, height);
                  cr.stroke();
              }
            }
        });
        
        var now = new Date();
        var nowHH = now.getHours() + now.getMinutes() / 60;
        var nowXX = width * ( (nowHH - st) / (et - st) );
        
        cr.setSourceRGBA ( 1.0,  1.0,  0.3, 0.7); // RGBa
        cr.rectangle(nowXX, 0, 0, height);
        cr.stroke();
                

        cr.$dispose();     
        
    }
    
    onStatusCheckDataGrid(context, pacarr) {
      
      context._emptyGridBox(context);;
     
      context._drawingArea = new St.DrawingArea({width: 400, height: 80});
      context.gridBox.add_actor(  context._drawingArea, { span: -1, expand: true } );
      context._signals.connect( context._drawingArea, 'repaint',     Lang.bind(context, context.repaintDataGrid) );  
      

    }
    
    
    performStatusCheckDataGrid() {  
    
      if (!this.login) {
          return;
       }      

      let plantId = this.plantId;
      if (plantId.length==0) {
        plantId = this.onePlantId;
      }
      let date = new Date();  
      let today = date.getFullYear().toString();
      today += '-';
      today +=  (date.getMonth() + 1).toString().padStart(2, '0');
      today += '-';
      today += date.getDate().toString().padStart(2, '0');

       const url = this.server + '/panel/max/getMAXDayChart';
       const data = 'date=' + today + '&plantId=' + plantId;
       
       this.httpRequest(
          'POST', 
          url, 
          null, 		// headers
          data, 		// postParams
          function(context, message, result) {            
               if (result.result=='1') {                
                    context.statusOk = true;
                    context._daychartresult = result.obj.pac;
                    context.onStatusCheckDataGrid(context,result.obj.pac);
               }
          }
        );     
      
    }
    
    onStatusCheckData(context, dataobj) {

      context.dataBox.destroy_all_children();
      
      dataobj.datas.forEach( function(d, i) {      
        
          let color = 'lightgreen';
          if (d.status == '-1') {
            color = 'red';
          }
          context._nominalPower = d.nominalPower;
          
          const updateArr = d.lastUpdateTime.split(" ");
          
          const labelPlantModel =  new St.Label({
            text : d.plantName + ' ('+d.deviceModel+' ' + (parseInt(d.nominalPower)/1000) +'kW, Id:'+d.plantId+') @' + updateArr[1],
            style : "width: 35em; color: "+color+"; text-decoration-line: underline; text-shadow: 1px 1px;"
          });  
          context.dataBox.add(labelPlantModel);
          
          const labelPacToday =  new St.Label({
            text : '  - Actual: ' + d.pac +'W   Today: ' + d.eToday + 'kWh    Month: ' + d.eMonth +'kWh   Total: '+d.eTotal +'kWh'   ,
            style : "width: 30em;"
          });  
          context.dataBox.add(labelPacToday);
                    
      });
          
    }    
    
    performStatusCheck() {
    
        if (!this.login) {
          this.performLogin();
          return;
        }

        let plantId = this.plantId;
        if (plantId.length==0) {
          plantId = this.onePlantId;
        }

        const url = this.server + '/panel/getDevicesByPlantList?currPage=1&plantId=' + plantId; //1487530';
        
        this.httpRequest(
          'POST', 
          url, 
          null, 		// headers
          null, 		// postParams
          function(context, message, result) {
              if (result.result=='1') {
                context.statusOk = true;
                
                context.onStatusCheckData(context,result.obj);
                
              } 
          }
        );
    
    }
}


function main(metadata, deskletId) {
  let grwDesklet = new GrowattDesklet(metadata, deskletId);
  return grwDesklet;
}


//--------------------------------------------

class PasswordDialog extends ModalDialog.ModalDialog {

    constructor(label, callback){
        super();

        this.contentLayout.add(new St.Label({ text: label }));
        this.callback = callback;
        this.entry = new St.Entry({ style: 'background: green; color:yellow;' });
        this.entry.clutter_text.set_password_char('\u25cf');
        this.contentLayout.add(this.entry);
        this.setInitialKeyFocus( this.entry.clutter_text );

        this.setButtons([
          {
              label: "Save", 
              action: ()  => {
                  const pwd = this.entry.get_text();
                  this.callback( pwd );
                  this.destroy();
              }, 
              key: Clutter.KEY_Return, 
              focused: false
          },
          {
              label: "Cancel", 
              action: ()  => {
                  this.destroy();
              },  
              key: null, 
              focused: false
          }
        ]);

    }
}


