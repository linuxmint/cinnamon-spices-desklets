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

const Clutter = imports.gi.Clutter;
const fromXML = require('./fromXML');

const uuid = "yarr@jtoberling";

const ByteArray = imports.byteArray;

class YarrDesklet extends Desklet.Desklet {

    statusOk = false;
    
    delay = 300;
    
    refreshEnabled = true;
    
    httpSession = null;
    
    xmlutil = null;
    
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
        this.settings.bind("backgroundColor", "backgroundColor", this.onDisplayChanged);
        this.settings.bind("font", "font", this.onDisplayChanged);
        this.settings.bind("text-color", "color", this.onDisplayChanged);
        this.settings.bind("numberofitems", "itemlimit", this.onSettingsChanged, 50);
        this.settings.bind("listfilter", "listfilter", this.onSetttingChanged);
        
        if (Soup.MAJOR_VERSION === 2) {
            this.httpSession = new Soup.SessionAsync();
        } else {
            this.httpSession = new Soup.Session();
        }

        this._signals = new SignalManager.SignalManager(null);

        this.buildInitialDisplay();
        this.onDisplayChanged();
        this.onSettingsChanged();

        this.setUpdateTimer(1);

    }

    invertbrightness(rgb) {
        rgb = Array.prototype.join.call(arguments).match(/(-?[0-9\.]+)/g);
        let brightness = 255 * 3
        for (var i = 0; i < rgb.length && i < 3; i++) {
            brightness -= rgb[i];
        }
        if (brightness > 255 * 1.5)
            return '255, 255, 255';
        return '0, 0, 0';
    }


    onSettingsChanged() {
        this.setUpdateTimer(1);
    }

    onDisplayChanged() {

        let fontprep = this.font.split(' ');
        let fontsize = fontprep.pop();
        let fontweight = '';
        let fontstyle = '';
        let fontname = fontprep.join(' ').replace(/,/g, ' ');
        ['Italic', 'Oblique'].forEach(function(item, i) {
            if (fontname.includes(item)) {
                fontstyle = item;
                fontname = fontname.replace(item, '');
            }
        });

        ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function(item, i) {
            if (fontname.includes(item)) {
                fontweight = item;
                fontname = fontname.replace(item, '');
            }
        });

        this.fontstyle = ("font-family: " + fontname + "; " +
            "font-size: " + fontsize + "pt; " +
            (fontstyle ? "font-style: " + fontstyle + "; " : "") +
            (fontweight ? "font-weight: " + fontweight + "; " : "") +
            "color: " + this.color + "; " +
            "text-shadow: " + "0px 1px 6px rgba(" + this.invertbrightness(this.color) + ", 0.2); " +
            "padding: 2px 2px;").toLowerCase();

        this.mainBox.set_size(this.width, this.height);

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

    onClickedToggleRefresh(selfObj, p2, context) {
    
        if (context.refreshEnabled) {
            context.toggleRefresh.set_label(_('Enable refresh'));
            context.toggleRefresh.set_style_class_name('toggleButtonOff');
            context.refreshEnabled = false;
        } else {
            context.toggleRefresh.set_label(_('Disable refresh'));
            context.toggleRefresh.set_style_class_name('toggleButtonOn');
            context.refreshEnabled = true;
            context.setUpdateTimer(3);
        }
    }
    
    buildInitialDisplay() {
    
        this.setHeader(_('Yarr'));
        
        this.mainBox = new St.BoxLayout({
            vertical: true,
            width: this.width,
            height: this.height,
            style_class: "desklet"
        });
        

        this.headBox = new St.BoxLayout({ vertical: false });
            
        this.headTitle = new St.Label({});
        
        this.headTitle.set_text(_('Loading: feeds ...' ));
        
        let paddingBox = new St.Bin({ width: 10 });
    
        this.refreshButton = new St.Button({style_class: 'feedRefreshButton'});
        this.refreshIcon = new St.Icon({
                          icon_name: 'reload',
                          icon_size: 20, 
                          icon_type: St.IconType.SYMBOLIC
        });
        this.refreshButton.set_child(this.refreshIcon);
        this.refreshButton.connect("clicked", Lang.bind(this, this.onRefreshClicked));
                        
        this.toggleRefresh = new St.Button({ label: _("Disable refresh"), style_class: 'toggleButtonOn'});    
        let context = this;
        this._signals.connect( this.toggleRefresh, 'clicked', (...args) => this.onClickedToggleRefresh(...args, this) );
        
        this.headBox.add(this.headTitle);
        this.headBox.add(paddingBox, { expand: true });
        this.headBox.add_actor(this.toggleRefresh);
        this.headBox.add_actor(this.refreshButton);
        
        this.mainBox.add(this.headBox);

        
        this.dataBox = new St.ScrollView(); //St.BoxLayout({ vertical: true });
        this.dataBox.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);

        this.tableContainer = new St.BoxLayout({ vertical: true });
        this.dataBox.add_actor(this.tableContainer);

        this.mainBox.add(this.dataBox, { expand: true });

        this.setContent(this.mainBox);
        
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
            if (i > context.itemlimit) {
                context.items.delete(key);
            }
        }        
    }
    
    inGlobalFilter(context, title, catStr, description) {
    
        let found = false;
        
        let itemRegexArr = [];
        
        
        for(let i=0; i < context.listfilter.length ; i++ ) {
        
            let filterElem = context.listfilter[i];
            
            if (filterElem.active) {
                if (filterElem.unmatch) {
                    found = true;
                }
            
                let itemRegexp = new RegExp(filterElem.filter);

                if (filterElem.inTitle) {
                    if (itemRegexp.test(title)) {
                        found = (filterElem.unmatch)?false:true;
                        break;
                    }
                }

                if (filterElem.inCategory) {
                    if (itemRegexp.test(catStr)) {
                        found = (filterElem.unmatch)?false:true;
                        break;
                    }
                }

                if (filterElem.inDescription) {
                    if (itemRegexp.test(description)) {
                        found = (filterElem.unmatch)?false:true;
                        break;
                    }
                }
            }
        }
        return found;
    }
    
    collectFeeds() {
    
        if (!this.refreshEnabled) {
            return;
        }
    
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
                                    
                                    if (context.listfilter.length > 0 && context.inGlobalFilter(context, item.title, catStr, item.description)) {
                                        doInsert = false;
                                    }
                                    
                                    if (doInsert) {
                                        let parsedDate = new Date(item.pubDate);
                                        context.additems(
                                            context,
                                            { 
                                                'channel': 	feed.name,
                                                'timestamp': 	parsedDate,
                                                'pubDate':	item.pubDate, 
                                                'title':	item.title, 
                                                'link':		item.link,
                                                'category': 	catStr,
                                                'description': 	item.description, 
                                                "labelColor": 	feed.labelcolor
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
    
    _formatedDate( pDate, withYear = true ) {
        let retStr = '';
        if (withYear) {
            retStr += pDate.getFullYear().toString() + '-';
        }
        retStr +=(pDate.getMonth()+1).toString().padStart(2,'0') + '-' + pDate.getDate().toString().padStart(2,'0') + ' ' +
                 pDate.getHours().toString().padStart(2,'0') + ':' +  pDate.getMinutes().toString().padStart(2, '0');
        return retStr;
    }
    
    onClickedButton(selfObj, p2, uri) {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
    }
    
    
    displayItems(context) {
    
        let updated= new Date();
        context.headTitle.set_text(_('Updated:') + context._formatedDate(new Date()));
    
        context.tableContainer.destroy_all_children();
        
        for(let [key, item] of context.items ) {

            const lineBox = new St.BoxLayout({ vertical: false });

            const feedButton = new St.Button({ label: "["+item.channel +"]" , style_class: 'channelbutton', style: 'width: 80px; background-color: ' + item.labelColor });

            let toolTipText = 
                '<big><b><u>' + this.formatTextWrap(item.channel + ': ' + item.title, 100) + '</u></b></big>'
                +'\n<small>[ ' + item.category.toString().substring(0,80) + ' ]</small>\n\n'
                + this.formatTextWrap(this.HTMLPartToTextPart(item.description ?? '-' ),100) 
                ;
                
                
            let toolTip = new Tooltips.Tooltip(feedButton, toolTipText );
            toolTip._tooltip.style = 'text-align: left;';
            toolTip._tooltip.clutter_text.set_use_markup(true);
            toolTip._tooltip.clutter_text.allocate_preferred_size(Clutter.AllocationFlags.NONE);
            toolTip._tooltip.queue_relayout();

            lineBox.add(feedButton);

            this._signals.connect( feedButton, 'clicked', (...args) => this.onClickedButton(...args, item.link) ); 
            
            const dateLabel = new St.Label({  text: ' ' + context._formatedDate(item.timestamp, false) + ' ', style: 'text-align: center;'   });
            lineBox.add(dateLabel);
            
            let panelButton = new St.Button({});
  
            const itemLabel = new St.Label({
                    text: item.title,
            });
            itemLabel.style = context.fontstyle;

            panelButton.set_child(itemLabel);

            let toolTip2 = new Tooltips.Tooltip(panelButton, toolTipText );
            toolTip2._tooltip.style = 'text-align: left;';
            toolTip2._tooltip.clutter_text.set_use_markup(true);
            toolTip2._tooltip.clutter_text.allocate_preferred_size(Clutter.AllocationFlags.NONE);
            toolTip2._tooltip.queue_relayout();
            
            lineBox.add_actor( panelButton );
            
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
