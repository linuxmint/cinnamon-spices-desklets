const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const _httpSession = new Soup.SessionAsync();

function Covid19IndiaDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

Covid19IndiaDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,
    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.setupUI();
    },

    setupUI: function() {

        this.mainContainer = new St.BoxLayout({style_class: "CovidMainContainer"});
        this.titles = new St.BoxLayout({vertical: true});
        this.values = new St.BoxLayout({vertical: true});

        this.titleConfirmed = new St.Label({text: _("Confirmed : "), style_class: "CovidTitle"});
        this.titleActive = new St.Label({text: _("Active : "), style_class: "CovidTitle"});
        this.titleRecovered = new St.Label({text: _("Recovered : "), style_class: "CovidTitle"});
        this.titleDeceased = new St.Label({text: _("Deceased : "), style_class: "CovidTitle"});

        this.titles.add(this.titleConfirmed);
        this.titles.add(this.titleActive);
        this.titles.add(this.titleRecovered);
        this.titles.add(this.titleDeceased);

        this.titleConfirmedValue = new St.Label({text: "loading...", style_class: "CovidBValue"});
        this.titleActiveValue = new St.Label({text: "loading...", style_class: "CovidBValue"});
        this.titleRecoveredValue = new St.Label({text: "loading...", style_class: "CovidBValue"});
        this.titleDeceasedValue = new St.Label({text: "loading...", style_class: "CovidBValue"});

        this.values.add(this.titleConfirmedValue);
        this.values.add(this.titleActiveValue);
        this.values.add(this.titleRecoveredValue);
        this.values.add(this.titleDeceasedValue);

        this.mainContainer.add(this.titles);
        this.mainContainer.add(this.values);
        this.setContent(this.mainContainer);
        this._updateWidget();
    },

    getJSON: function(url) {

        let message = Soup.Message.new('GET', url);
        _httpSession.send_message (message);
        var match = "0";
        if (message.status_code!== Soup.KnownStatusCode.OK) {
            this._date.set_text("Server Unreachable.");
            var sleep = 30
        } else {
            let jp = new Json.Parser();
            jp.load_from_data(message.response_body.data.toString(), -1);
            match=jp.get_root().get_object();
        }
        return message.response_body.data.toString();
    },

    refreshStats: function() {
        var jsonData = this.getJSON("https://api.covid19india.org/data.json");
        this.titleConfirmedValue.set_text("hello");
        this.titleActiveValue.set_text("hello");
        this.titleRecoveredValue.set_text("hello");
        this.titleDeceasedValue.set_text("hello");
    },

    _updateWidget: function(){
        this.refreshStats();
        this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._updateWidget));
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    }
}

function main(metadata, desklet_id) {
    return new Covid19IndiaDesklet(metadata, desklet_id);
}
