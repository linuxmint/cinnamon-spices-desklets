const Gio = imports.gi.Gio;
const St = imports.gi.St;

const Desklet = imports.ui.desklet;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

function MyDesklet(metadata){
    this._init(metadata);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata){
        Desklet.Desklet.prototype._init.call(this, metadata);
        this._clockContainer = new St.BoxLayout({vertical:true, style_class: 'clock-container'});
        this._hourContainer =  new St.BoxLayout({vertical:false, style_class: 'hour-container'});
        this._dateContainer =  new St.BoxLayout({vertical:false, style_class: 'date-container'});


        this._hour = new St.Label({style_class: "clock-hour-label"});
        this._min = new St.Label({style_class: "clock-min-label"});
        this._sec = new St.Label({style_class: "clock-sec-label"});
        this._date = new St.Label();

        this._hourContainer.add(this._hour);
        this._hourContainer.add(this._min);
        this._hourContainer.add(this._sec);
        this._dateContainer.add(this._date);
        this._clockContainer.add(this._hourContainer);
        this._clockContainer.add(this._dateContainer);
        this.setContent(this._clockContainer);
        this.setHeader(_("Clock"));
        //this._dateSettings = new Gio.Settings({schema: 'org.cinnamon.desklets.clock'});
        //this._dateSettings.connect("changed::font-size", Lang.bind(this, this._onFontSizeChanged));
        //this._onFontSizeChanged();
        this._updateDate();
    },

    //_onFontSizeChanged: function(){
        //this._date.style="font-size: " + this._dateSettings.get_int("font-size") + "pt";
    //},
        
    on_desklet_removed: function() {
	Mainloop.source_remove(this.timeout);
    },

    _updateDate: function(){
       //let dateFormat = this._dateSettings.get_string('date-format');
       let hourFormat = '%H';
       let minFormat = '%M';
       let secFormat = '%S';
       let dateFormat = '%A,%e %B';
       let displayDate = new Date();
       this._hour.set_text(displayDate.toLocaleFormat(hourFormat));
       this._min.set_text(displayDate.toLocaleFormat(minFormat));
       this._sec.set_text(displayDate.toLocaleFormat(secFormat));
       this._date.set_text(displayDate.toLocaleFormat(dateFormat));
       this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateDate));
    }
}

function main(metadata, desklet_id){
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
