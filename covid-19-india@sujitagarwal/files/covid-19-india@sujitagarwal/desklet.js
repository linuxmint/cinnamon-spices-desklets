const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Json = imports.gi.Json;
const Soup = imports.gi.Soup;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const _httpSession = new Soup.SessionAsync();

const LINE_WIDTH = 1;
const MARGIN = 5;

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

        this.mainContainer = new St.BoxLayout({vertical: true});
        this.widgetContainer   = new St.BoxLayout({style_class: "CovidMainContainer"});
        this.titles = new St.BoxLayout({vertical: true});
        this.values = new St.BoxLayout({vertical: true});

        this.titleHeading = new St.Label({text: _("30 Day Graph"), style_class: "CovidHeading"});
        this.titleUpdated = new St.Label({text: _("Updated on "), style_class: "CovidTime"});
        this.titleConfirmed = new St.Label({text: _("Confirmed "), style_class: "CovidTitle"});
        this.titleActive = new St.Label({text: _("Active "), style_class: "CovidTitle"});
        this.titleRecovered = new St.Label({text: _("Recovered "), style_class: "CovidTitle"});
        this.titleDeceased = new St.Label({text: _("Deceased "), style_class: "CovidTitle"});

        this.titles.add(this.titleConfirmed);
        this.titles.add(this.titleActive);
        this.titles.add(this.titleRecovered);
        this.titles.add(this.titleDeceased);

        this.titleConfirmedValue = new St.Label({text: "loading...", style_class: "CovidValue1"});
        this.titleActiveValue = new St.Label({text: "loading...", style_class: "CovidValue2"});
        this.titleRecoveredValue = new St.Label({text: "loading...", style_class: "CovidValue3"});
        this.titleDeceasedValue = new St.Label({text: "loading...", style_class: "CovidValue4"});

        this.values.add(this.titleConfirmedValue);
        this.values.add(this.titleActiveValue);
        this.values.add(this.titleRecoveredValue);
        this.values.add(this.titleDeceasedValue);

        this.drawingArea = new St.DrawingArea();
        this.drawingArea.height=230;
        this.drawingArea.width=230;
        this.drawingArea.connect('repaint', Lang.bind(this, this._onDrawingAreaRepaint));

        this.mainContainer.add(this.titleHeading);
        this.widgetContainer.add(this.titles);
        this.widgetContainer.add(this.values);
        this.mainContainer.add(this.drawingArea);
        this.mainContainer.add(this.widgetContainer);
        this.mainContainer.add(this.titleUpdated);
        this.setContent(this.mainContainer);
        this._updateWidget();
    },

    plotData: function(dataSet) {
        context.beginPath();
        context.moveTo(0, dataSet[0]);
        for (i=1;i<sections;i++) {
            context.lineTo(i * xScale, dataSet[i]);
        }
        context.stroke();
    },

    _onDrawingAreaRepaint: function(area) {
        let cr = area.get_context();
        let themeNode = this.actor.get_theme_node();
        let [area_width, area_height] = area.get_surface_size();
        var baseColor = this.drawingArea.get_theme_node().get_foreground_color();
        baseColor.red = 150;
        baseColor.blue = 150;
        baseColor.green = 150;
        baseColor.alpha = 120;
        Clutter.cairo_set_source_color(cr, baseColor);
        cr.setOperator(Cairo.Operator.OVER);    

        this.getGraphData("https://api.covid19india.org/data.json");
        var confirmed = this.confirmed;
        var recovered = this.recovered;
        var deaths = this.deaths;

        var sections = confirmed.length;
        var Val_max = this.highest;
        var Val_min = this.lowest;
        var stepSize = 10;
        var columnSize = 10;
        var rowSize = 10;
        var margin = 0;
        var yScale = (area_width - columnSize) / (Val_max - Val_min);
        var xScale = (area_height - rowSize) / sections;
        // print Parameters on X axis, and grid lines on the graph
        for (let i=0;i<sections;i++) {
            var x = i * xScale;
            cr.moveTo(x, columnSize);
            cr.lineTo(x, area_height - margin);
            cr.stroke();
        }

        for (let i=0;i<sections+2;i++) {
            var y = i * xScale + 10;
            cr.moveTo(0, y);
            cr.lineTo(area_width - 18, y);
            cr.stroke();
        }

        baseColor.red = 0;
        baseColor.green = 35;
        baseColor.blue = 102;
        baseColor.alpha = 255;
        Clutter.cairo_set_source_color(cr, baseColor);

        cr.moveTo(0, area_height - confirmed[0] * yScale);
        for (let y=1;y<sections;y++) {
            cr.lineTo(y * xScale, area_height - confirmed[y] * yScale);
            cr.stroke();
            cr.moveTo(y * xScale, area_height - confirmed[y] * yScale);
        }

        baseColor.red = 14;
        baseColor.green = 107;
        baseColor.blue = 14;
        Clutter.cairo_set_source_color(cr, baseColor);

        cr.moveTo(0, area_height - recovered[0] * yScale);
        for (let y=1;y<sections;y++) {
            cr.lineTo(y * xScale, area_height - recovered[y] * yScale);
            cr.stroke();
            cr.moveTo(y * xScale, area_height - recovered[y] * yScale);
        }

        baseColor.red = 196;
        baseColor.green = 2;
        baseColor.blue = 51;
        Clutter.cairo_set_source_color(cr, baseColor);

        cr.moveTo(0, area_height - deaths[0] * yScale);
        for (let y=1;y<sections;y++) {
            cr.lineTo(y * xScale, area_height - deaths[y] * yScale);
            cr.stroke();
            cr.moveTo(y * xScale, area_height - deaths[y] * yScale);
        }
    },

    getJSON: function(url) {

        var jsonData = "EMPTY";
        let message = Soup.Message.new('GET', url);
        _httpSession.send_message (message);
        if (message.status_code!== Soup.KnownStatusCode.OK) {
            jsonData = "Unreachable";
        } else {
            jsonData = JSON.parse(message.response_body.data.toString());
        }
        if (typeof jsonData == "string")
            return jsonData;
        return jsonData.statewise[0];
    },

    getGraphData: function(url) {
        var jsonData = "EMPTY";
        let message = Soup.Message.new('GET', url);
        _httpSession.send_message (message);
        if (message.status_code!== Soup.KnownStatusCode.OK) {
            jsonData = "Unreachable";
        } else {
            jsonData = JSON.parse(message.response_body.data.toString());
        }
        if (typeof jsonData == "string")
            return jsonData;
        var confirmed = [];
        var deaths = [];
        var recovered = [];
        var x = 0;
        var highest = 0;
        var lowest = 10000000;
        for (var i = 70; i <= 100; i++) {
            confirmed[x] = jsonData.cases_time_series[i].dailyconfirmed; 
            if (parseInt(confirmed[x])>highest) {highest = parseInt(confirmed[x]);}
            if (parseInt(confirmed[x])<lowest) {lowest = parseInt(confirmed[x]);}
            deaths[x]    = jsonData.cases_time_series[i].dailydeceased; 
            if (parseInt(deaths[x])>highest) {highest = parseInt(deaths[x]);}
            if (parseInt(deaths[x])<lowest) {lowest = parseInt(deaths[x]);}
            recovered[x]  = jsonData.cases_time_series[i].dailyrecovered; 
            if (parseInt(recovered[x])>highest) {highest = parseInt(recovered[x]);}
            if (parseInt(recovered[x])<lowest) {lowest = parseInt(recovered[x]);}
            x++;
        }
        this.confirmed = confirmed;
        this.recovered = recovered;
        this.deaths = deaths;
        this.highest = highest;
        this.lowest = lowest;
    },


    refreshStats: function() {
        var jsonData = this.getJSON("https://api.covid19india.org/data.json");
        if (typeof jsonData == "string") 
        {
            this.titleUpdated.set_text("Updated on " + jsonData);
            this.titleConfirmedValue.set_text(jsonData);
            this.titleActiveValue.set_text(jsonData);
            this.titleRecoveredValue.set_text(jsonData);
            this.titleDeceasedValue.set_text(jsonData);
        }
        else
        {
            this.titleUpdated.set_text("Updated on " + jsonData.lastupdatedtime);
            this.titleConfirmedValue.set_text(jsonData.confirmed.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,"));
            this.titleActiveValue.set_text(jsonData.active.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,"));
            this.titleRecoveredValue.set_text(jsonData.recovered.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,"));
            this.titleDeceasedValue.set_text(jsonData.deaths.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,"));
        }
        this.drawingArea.queue_repaint();
    },

    _updateWidget: function(){
        this.refreshStats();
        this.timeout = Mainloop.timeout_add_seconds(300, Lang.bind(this, this._updateWidget));
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    }
}

function main(metadata, desklet_id) {
    return new Covid19IndiaDesklet(metadata, desklet_id);
}
