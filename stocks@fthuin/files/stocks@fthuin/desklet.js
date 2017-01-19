/* Author : Florian Thuin */
/* jshint moz : true */
/***************
 * Libs imports
 ***************/

const Desklet = imports.ui.desklet; // cinnamon desklet user interface
const St = imports.gi.St; // Shell toolkit library from GNOME
const Gio = imports.gi.Gio; // URL-IO-Operations
const GLib = imports.gi.GLib; // Files operations
const Gtk = imports.gi.Gtk; // Gtk library (policies for scrollview)
const Mainloop = imports.mainloop; // For repeated updating
const Lang = imports.lang; // Binding desklet to mainloop function
const Settings = imports.ui.settings; // Load settings-schema.json file
const Soup = imports.gi.Soup;

/************
 * Variables
 ************/

var session = new Soup.SessionAsync();
var stocksFilePath = '/stocks.list';
var dirPath = 'stocks@fthuin';
var deskletDir = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/" + dirPath;
var comparray = read_file(); /* Companies array */
var mainBox; // BoxLayout integrating whole UI
var quotes = [];
var console = global;

/************
 * Functions
 ************/

/* Desklet constructor */
function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

function Quote(dict) {
    this.AfterHoursChangeRealtime = dict.AfterHoursChangeRealtime;
    this.AnnualizedGain = dict.AnnualizedGain;
    this.Ask = dict.Ask;
    this.AskRealtime = dict.AskRealtime;
    this.AverageDailyVolume = dict.AverageDailyVolume;
    this.Bid = dict.Bid;
    this.BidRealtime = dict.BidRealtime;
    this.BookValue = dict.BookValue;
    this.Change = dict.Change;
    this.ChangeFromFiftyDayMovingAverage = dict.ChangeFromFiftydayMovingAverage;
    this.ChangeFromTwoHundreDayMovingAverage = dict.ChangeFromTwoHundreddayMovingAverage;
    this.ChangeFromYearHigh = dict.ChangeFromYearHigh;
    this.ChangeFromYearLow = dict.ChangeFromYearLow;
    this.ChangeInPercent = dict.ChangeinPercent;
    this.ChangePercentRealtime = dict.ChangePercentRealtime;
    this.ChangeRealtime = dict.ChangeRealtime;
    this.Change_PercentChange = dict.Change_PercentChange;
    this.Commission = dict.Commission;
    this.Currency = dict.Currency;
    this.DaysHigh = dict.DaysHigh;
    this.DaysLow = dict.DaysLow;
    this.DaysRange = dict.DaysRange;
    this.DaysRangeReatime = dict.DaysRangeRealtime;
    this.DaysValueChange = dict.DaysValueChange;
    this.DaysValueChangeRealtime = dict.DaysValueChangeRealtime;
    this.DividendPayDate = dict.DividendPayDate;
    this.DividendShare = dict.DividendShare;
    this.DividendYield = dict.DividendYield;
    this.EarningShare = dict.EarningShare;
    this.EBITDA = dict.EBITDA;
    this.EPSEstimateCurrentYear = dict.EPSEstimateCurrentYear;
    this.EPSEstimateNextQuarter = dict.EPSEstimateNextQuarter;
    this.EPSEstimateNextYear = dict.EPSEstimateNextYear;
    this.ExDividendDate = dict.ExDividendDate;
    this.FiftydayMovingAverage = dict.FiftydayMovingAverage;
    this.HighLimit = dict.HighLimit;
    this.HoldingsGain = dict.HoldingsGaiin;
    this.HoldingsGainPercent = dict.HoldingGainPercent;
    this.HoldingGainPercentRealtime = dict.HoldingGainPercentRealtime;
    this.HoldingsGainRealtime = dict.HoldingsGainRealtime;
    this.HoldingsValue = dict.HoldingsValue;
    this.HoldingsValueRealtime = dict.HoldingsValueRealtime;
    this.LastTradeDate = dict.LastTradeDate;
    this.LastTradePriceOnly = dict.LastTradePriceOnly;
    this.LastTradeRealtimeWithTime = dict.LastTradeREaltimeWithTime;
    this.LastTradeTime = dict.LastTradeTime;
    this.LastTradeWithTime = dict.LastTradeWithTime;
    this.LowLimit = dict.LowLimit;
    this.MarketCapitalization = dict.MarketCapitalization;
    this.MarketCapRealtime = dict.MarketCapRealtime;
    this.MoreInfo = dict.MoreInfo;
    this.name = dict.Name;
    this.notes = dict.Notes;
    this.OneyrTargetPrice = dict.OneyrTargetPrice;
    this.open = dict.Open;
    this.OrderBookRealtime = dict.OrderBookRealtime;
    this.PEGRatio = dict.PEGRatio;
    this.PERatio = dict.PERatio;
    this.PERatioRealtime = dict.PERatioRealtime;
    this.PercentChange = dict.PercentChange;
    this.PercentChangeFromFiftyDayMovingAverage = dict.PercentChangeFromFiftydayMovingAverage;
    this.PercentChangeFromTwoHundredDayMovingAverage = dict.PercentChangeFromTwoHundreddayMovingAverage;
    this.PercentChangeFromYearLow = dict.PercentChangeFromYearLow;
    this.PercentChangeFromYearHigh = dict.PercebtChangeFromYearHigh;
    this.PreviousClose = dict.PreviousClose;
    this.PriceBook = dict.PriceBook;
    this.PriceEPSEstimateCurrentYear = dict.PriceEPSEsstimateCurrentYear;
    this.PriceEPSEstimateNextYear = dict.PriceEPSEstimateNextYear;
    this.PricePaid = dict.PricePaid;
    this.PriceSales = dict.PriceSales;
    this.SharesOwned = dict.SharesOwned;
    this.ShortRatio = dict.ShortRatio;
    this.StockExchange = dict.StockExchange;
    this.symbol = dict.symbol;
    this.Symbol = dict.Symbol;
    this.TradeDate = dict.TradeDate;
    this.TickerTrend = dict.TickerTrend;
    this.TwoHundredDayMovingAverage = dict.TwoHundreddayMovingAverage;
    this.Volume = dict.Volume;
    this.YearHigh = dict.YearHigh;
    this.YearLow = dict.YearLow;
    this.YearRange = dict.YearRange;
}

/* Prototype */
MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    /* Initialisation of the desklet */
    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        /* Load settings-schema.json file */
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "delay", "delay", this._onSettingsChanged, null);

        this.get_stocks();
    },

    _onDisplayChanged : function() {
        mainBox.set_size(this.width, this.height);
    },

     _onSettingsChanged : function() {
        mainBox.destroy_all_children();
        mainBox.destroy();
        Mainloop.source_remove(this.mainloop);
        this.get_stocks();
     },

     on_desklet_removed: function() {
         mainBox.destroy_all_children();
         mainBox.destroy();
         Mainloop.source_remove(this.mainloop);
     },

     update_stocks : function() {
        /* Render the values onto the desklet */
        // Main box (stores everything)
        mainBox = new St.BoxLayout({
                vertical : true,
                width : this.width,
                height : this.height,
                style_class: "stocks-reader"});
        // ScrollView will be put in the main box
        var scrollView = new St.ScrollView();
        scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        // Table in which we store every stocks
        var stockTable = new St.Table({
            homogeneous: false
        });
        // Box in which we will store the table
        var stocksBox = new St.BoxLayout({
                vertical : true,
        });
        for (var i = 0, l = quotes.length ; i < l ; i++) {
            var myStock = quotes[i];
            var cur = "";

            cur = get_currency_symbol(myStock.Currency);

            /* Set the change icon, last char is % so must be ignored : */
            if (myStock.PercentChange === null) {
                continue;
            }

            var binIcon = new St.Bin( {height : "20px", width : "20px" });
            binIcon.set_child(getChangeIcon(myStock.PercentChange));

            // Second column is the name of the company
            var stockName = createLabel(myStock.name);

            // Third thing is the stock symbol
            var stockSymbol = createLabel(myStock.symbol);

            var stockPrice = createLabel(cur + '' + myStock.LastTradePriceOnly);

            // Fifth thing is the percent change
            var stockPerChange = createLabel(myStock.PercentChange);

            addToTable(stockTable, i, [binIcon, stockName, stockSymbol, stockPrice, stockPerChange]);
        }

        stocksBox.add_actor(stockTable);
        var updatedLabel = createLabel("Updated at " + this.date.toString());
        stocksBox.add_actor(updatedLabel);
        scrollView.add_actor(stocksBox);
        mainBox.add(scrollView, {expand: true});

        this.setContent(mainBox);
        /* Update every X milliseconds */
        this.mainloop = Mainloop.timeout_add(this.delay * 60 * 1000, Lang.bind(this, this.get_stocks));
     },

     _onResponse: function(session, message) {
         var response = message.response_body.data.toString();
         var jsonObject = JSON.parse(response);

         quotes = [];
         var cnt = jsonObject.query.count;
         if (cnt == 1) {
             quotes.push(new Quote(jsonObject.query.results.quote));
         }
         else {
             for (var i = 0; i < cnt ; i++) {
                 quotes.push(new Quote(jsonObject.query.results.quote[i]));
             }
         }
         this.date = new Date();
         this.update_stocks();
     },

     /* Get all the stocks at once from Yahoo */
     get_stocks: function() {
         var allcompanies = '';
         var i = 0;
         for (var limit = comparray.length - 1 ; i < limit ; i++) {
             allcompanies += comparray[i] + '%22%2C%22';
         }
         allcompanies += '' + comparray[i];

         /* Retrieving data from Yahoo */
         var url = "https://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20yahoo.finance.quotes%20where%20symbol%20in%20(%22"+ allcompanies +"%22)&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
         var urlcatch = Soup.Message.new("GET", url);
         session.queue_message(urlcatch, Lang.bind(this, this._onResponse));
     }
};

function addToTable(table, rowIndex, elemList) {
    for (var i = 0; i < elemList.length ; i++) {
        table.add(elemList[i], {
            row : rowIndex,
            col: i,
            style_class: "stocks-table-item"
        });
    }
}

function getChangeIcon(percentChange) {
    var icon_path = "";
    if (parseFloat(percentChange.slice(0,-1)) > 0) icon_path = "/icons/up.svg";
    else if (parseFloat(percentChange.slice(0,-1)) < 0) icon_path = "/icons/down.svg";
    else icon_path = "/icons/eq.svg";
    // First thing will be the icon of the result
    var file = Gio.file_new_for_path(deskletDir + ''+ icon_path);
    var icon_uri = file.get_uri();
    var image = St.TextureCache.get_default().load_uri_async(icon_uri, -1, -1);
    image.set_size(20,20);
    return image;
}

function createLabel(string) {
    var label = new St.Label({
            text : string,
            style_class : "stocks-label"
    });
    return label;
}

/* Takes in input the abrev name of a currency, output the related
 * symbol */
function get_currency_symbol(curName) {
    var cursymb;
    switch (curName) {
        case "USD" : cursymb = "$";
            break;
        case "EUR" : cursymb = "\u20AC";
            break;
        case "JPY" : cursymb = "\u00A5";
            break;
        case "GBP" : cursymb = "\u00A3";
            break;
        case "INR" : cursymb = "\u20A8";
            break;
        default : cursymb = curName;
    }
    return cursymb;

}

/* Read file containing stocks symbol line by line */
function read_file() {
    var file = deskletDir + '' + stocksFilePath ;

    if (GLib.file_test(file, GLib.FileTest.EXISTS)) {
        var content = GLib.file_get_contents(file);
        var stocklist = content.toString().split('\n').slice(0,-1);
        /* Get rid of 'true,' in the first field */
        stocklist[0] = stocklist[0].replace("true,", "");
        return stocklist;
    } else {
        return ['No Companies defined in: ' + this.file];
    }
}

/* Main function, called by default, returns our desklet */
function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
