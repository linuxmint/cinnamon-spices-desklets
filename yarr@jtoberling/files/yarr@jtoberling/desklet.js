const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Gettext = imports.gettext;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const Signals = imports.signals;
const SignalManager = imports.misc.signalManager;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Tooltips = imports.ui.tooltips

const fromXML = require('./fromXML');

const YarrLinkButton = require('./linkbutton');

const uuid = "yarr@jtoberling";

class YarrDesklet extends Desklet.Desklet {

    statusOk = false;
    
    delay = 300;
    
    httpSession = null;
    
    xmlutil = null;
    
    ITEMLIMIT = 100;
    items = new Map();
    
    dataBox = null;	// Object holder for display
    headTitle = null;
    
    timerInProgress = false;		// Semaphore
    _setUpdateTimerInProgress = false; 	// Semaphore
    

    constructor (metadata, desklet_id) {
        super(metadata, desklet_id);
        this.metadata = metadata;

        this.uuid = this.metadata["uuid"];
        
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instance_id);

        this.settings.bind('refreshInterval-spinner', 'delay', this.onSettingsChanged);
        this.settings.bind('feeds', 'feeds', this.onSettingsChanged);
        this.settings.bind("height", "height", this.onDisplayChanged);
        this.settings.bind("width", "width", this.onDisplayChanged);
        this.settings.bind("transparency", "transparency", this.onDisplayChanged);
        this.settings.bind("backgroundColor", "backgroundColor", this.backgroundColor);
        
        if (Soup.MAJOR_VERSION === 2) {
            this.httpSession = new Soup.SessionAsync();
        } else {
            this.httpSession = new Soup.Session();
        }

        this._signals = new SignalManager.SignalManager(null);

        this.buildDisplay();

        this.setUpdateTimer(1);

    }

    onDisplayChanged() {
        this.mainBox.set_size(this.width, this.height);
        this.setTransparency();
    }

    setTransparency() {
        this.mainBox.style = "background-color: rgba(" + (this.backgroundColor.replace('rgb(', '').replace(')', '')) + "," + this.transparency + ")";
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

        if (Soup.MAJOR_VERSION === 2) {
            if (postParameters !== null) {
                message.set_request("application/x-www-form-urlencoded",2,postParameters);
            }

            this.httpSession.queue_message(message,

                Lang.bind(this, function(session, response) {

                  let body = response.response_body.data;

                  let result = {
                    result: ''
                  }; 
                  try {
                      result = message.response_body.data;
                  } catch(e) {
                      global.log('ERROR', e);
                  }
                  
                  callbackF(this, message, result);
                })
            );
        } else {
            if (postParameters !== null) {
                const bytes = GLib.Bytes.new(ByteArray.fromString(postParameters));
                message.set_request_body_from_bytes('application/x-www-form-urlencoded', bytes);
            }

            this.httpSession.send_and_read_async(message, 0, null, (session, res) => {
                let result = {
                    result: ''
                };
                try {
                    const bytes = session.send_and_read_finish(res);
                    result = ByteArray.toString(bytes.get_data());
                } catch (e) {
                    global.log('ERROR', e);
                }

                callbackF(this, message, result);
            });
        }
    }



    onSettingsChanged() {
        this.setUpdateTimer(this.delay);
    }


    setUpdateTimer(timeOut) {
    
        if (this._setUpdateTimerInProgress) {
            return;
        }
        this._setUpdateTimerInProgress = true;
    

        if (this.timerInProgress) {
            Mainloop.source_remove(this.timerInProgress);
        }
        
        this.timerInProgress = Mainloop.timeout_add_seconds(timeOut, Lang.bind(this, this.onTimerEvent));
        
        this._setUpdateTimerInProgress = false;
    }


    onRefreshClicked() {
        this.setUpdateTimer(3);
    }

    buildDisplay() {
    
        this.setHeader(_('Yarr'));
        
        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "desklet"
        });
        

        this.headBox = new St.BoxLayout({ vertical: false });
            
        this.headTitle = new St.Label({});
        
        this.headTitle.set_text('Loading: feeds ...' );
        
        let paddingBox = new St.Bin({ width: 10 });
    
        this.refreshButton = new St.Button();
        this.refreshIcon = new St.Icon({
                          icon_name: 'reload',
                          icon_size: 20, 
                          icon_type: St.IconType.SYMBOLIC
        });
        this.refreshButton.set_child(this.refreshIcon);
        this.refreshButton.connect("clicked", Lang.bind(this, this.onRefreshClicked));
            
        
        this.headBox.add(this.headTitle);
        this.headBox.add(paddingBox, { expand: true });
        this.headBox.add_actor(this.refreshButton);

        this.mainBox.add(this.headBox);

        
        this.dataBox = new St.ScrollView(); //St.BoxLayout({ vertical: true });
        this.dataBox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);

        this.tableContainer = new St.BoxLayout({ vertical: true });
        this.dataBox.add_actor(this.tableContainer);

        this.mainBox.add(this.dataBox, { expand: true });

        this.setContent(this.mainBox);
        
        this.setTransparency();


    }

    hashCode(str) {
         return str.split('').reduce((prevHash, currVal) =>
             (((prevHash << 5) - prevHash) + currVal.charCodeAt(0))|0, 0);
    }

    
    additems(context, itemobj ) {
        
        let key = itemobj.title + '|' + itemobj.link;
        let hash = context.hashCode(key);
        
        if (!context.items.has(hash)) {
            context.items.set( hash, itemobj);
        }
        
        const newMap = Array.from(context.items).sort(
            (a,b)	=> { return Number(b[1].timestamp) - Number(a[1].timestamp); }
        );
        
        context.items = new Map(newMap);

        const itemsize = context.items.size;
    
        let i=0;
        for( let [key, value] of context.items ) {
            i++;
            if (i > context.ITEMLIMIT) {
                context.items.delete(key);
            }
        }        
    }
    
    collectFeeds() {
    
        let freshItems = [];
        
        for(let i=0; i < this.feeds.length; i++ ) {
            
            let feed = this.feeds[i];
            let feedRegexp = new RegExp(feed.filter);
            
            if (feed.active && feed.url.length > 0) {
                    
                    this.httpRequest('GET', feed.url, 
                        null,  // headers
                        null,  // post
                        function(context, message, result) {

                            let resJSON = null;
                            try {
                                resJSON = fromXML(result);
                                
                                let channel = resJSON.rss.channel.title;
                                
                                for(let j=0; j < resJSON.rss.channel.item.length ; j++ ) {
                                
                                    let item = resJSON.rss.channel.item[j];
                                    
                                    let catStr = context.getCategoryString(item);
                                    
                                    let doInsert = true;
                                    if (feed.filter.length > 0)  {
                                        doInsert = feedRegexp.test(catStr);                                    
                                    }
                                    
                                    if (doInsert) {
                                        let parsedDate = new Date(item.pubDate);
                                        context.additems(
                                            context,
                                            { 
                                                'channel': 	feed.name,
                                                'timestamp': parsedDate,
                                                'pubDate':	item.pubDate, 
                                                'title':	item.title, 
                                                'link':	item.link,
                                                'category': catStr,
                                                'description': item.description, 
                                                "labelColor": feed.labelcolor
                                             }
                                        );
                                    }
                                }
                                
                                context.displayItems(context);
                                
                            } catch (e) {
                                global.log('PARSEERROR');
                                global.log(e);
                            }
                            
                        }
                    );                                    
            }            
        }

    }
    
    HTMLPartToTextPart(HTMLPart) {
      return HTMLPart
        .replace(/\n/ig, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style[^>]*>/ig, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head[^>]*>/ig, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script[^>]*>/ig, '')
        .replace(/<\/\s*(?:p|div)>/ig, '\n\n')
        .replace(/<br[^>]*\/?>/ig, '\n')
        .replace(/<[^>]*>/ig, '')
        .replace('&nbsp;', ' ')
        .replace(/[^\S\r\n][^\S\r\n]+/ig, ' ')
      ;
    }    
     
    formatTextWrap(text, maxLineLength) {
          const words = text.replace(/[\r\n]+/g, ' ').split(' ');
          let lineLength = 0;
          
          // use functional reduce, instead of for loop 
          return words.reduce((result, word) => {
            if (lineLength + word.length >= maxLineLength) {
              lineLength = word.length;
              return result + `\n${word}`; // don't add spaces upfront
            } else {
              lineLength += word.length + (result ? 1 : 0);
              return result ? result + ` ${word}` : `${word}`; // add space only when needed
            }
          }, '');
    } 
     
    getCategoryString(item) {
            let catStr = '';

            if (typeof item.category === 'string') {
                catStr = item.category.toString();
            } else {
                if (typeof item.category === 'object') {
                    let catArr = Array.from(item.category);
                    let arrText = [];
                    for(let i=0; i < catArr.length ; i++ ) {
                        if (typeof catArr[i] === 'string' ) {
                            arrText.push( catArr[i] );
                        } else {
                            arrText.push( catArr[i]['#'] );
                        }
                    }
                    catStr = arrText.join(' / ');
                }
            }
            
            return catStr;
    } 
    
    displayItems(context) {
    
        let updated= new Date();
        context.headTitle.set_text(_('Updated:') + new Date().toISOString().replace('T', ' ').split('.')[0] );
    
        context.tableContainer.destroy_all_children();
        
        for(let [key, item] of context.items ) {

            const lineBox = new St.BoxLayout({ vertical: false });
            
            const feedButton = new YarrLinkButton.YarrLinkButton({ label: "["+item.channel +"]" , style_class: 'channelbutton', style: 'background-color: ' + item.labelColor });
            feedButton.setUri(item.link);

            let toolTipText = 
                item.category
                + '\n_________________________________________\n' 
                + this.formatTextWrap(this.HTMLPartToTextPart(item.description),80);

            let toolTip = new Tooltips.Tooltip(feedButton, toolTipText );
            

            lineBox.add_actor( feedButton );
            feedButton.connect("clicked", Lang.bind(this, function(p1, p2) {
                Gio.app_info_launch_default_for_uri(p1.getUri(), global.create_app_launch_context());
            }));
            
            const itemDate = new Date(item.timestamp);
            const dateLabel = new St.Label({  text: ' ' + itemDate.toISOString().replace('T', ' ').split('.')[0].slice(5) + ' '    });
            lineBox.add(dateLabel);
            
            const itemLabel = new St.Label({
                    text: item.title, 
            });
            
            
            lineBox.add( itemLabel );
            
            
            context.tableContainer.add( lineBox );
        
        }
        
                
    }

    onTimerEvent() {
    
        this.timerInProgress = false;

        if (this._updateInProgress) {
            this.setUpdateTimer(this.delay);
            return;
        } else {

            this._updateInProgress = true;

            this.collectFeeds();	// ReShedule this...
            
            this.setUpdateTimer(this.delay);

            this._updateInProgress = false;
        }

    }


}

function main(metadata, desklet_id) {
    let desklet = new YarrDesklet(metadata, desklet_id);
    return desklet;
}
