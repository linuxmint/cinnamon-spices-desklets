const Desklet = imports.ui.desklet; // needed by default for prototype init call
const Mainloop = imports.mainloop; // needed to run methods every X minutes
const Soup = imports.gi.Soup; // needed to load ressources asynchronoulsy
const Lang = imports.lang; // needed to bind methods to other methodes
const St = imports.gi.St; // layout, label, button, ...
const Gtk = imports.gi.Gtk; // some useful properties
const Settings = imports.ui.settings; // to manage settings
const Util = imports.misc.util; // to get command line working
const Gio = imports.gi.Gio;
const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;

var MAX_NEWS = 100;
var session = new Soup.SessionAsync();
var news = [];
var next_news = -1;

function NewsDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

NewsDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init : function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.setHeader(_("Le Monde.fr Newspaper"));

        this.settings = new Settings.DeskletSettings(this, this.metadata['uuid'], desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "newsRefreshDelay" , "newsRefreshDelay", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "newsDisplayRefreshDelay", "newsDisplayRefreshDelay", this._onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "displayImages", "displayImages", this._onDisplayChanged, null);
        this.save_path = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/lemondenewspaper@fthuin/icon.jpg" ;
        this.update_news();
    },

    update_news : function() {
        this.get_news();
        this.update_news_loop = Mainloop.timeout_add(this.newsRefreshDelay * 60 * 1000, Lang.bind(this, this.update_news));
    },

    _onDisplayChanged : function() {
        Mainloop.source_remove(this.next_news_loop);
        this.mainBox.destroy();
        this.show_next_news();
    },

    _onSettingsChanged : function() {
        Mainloop.source_remove(this.update_news_loop);
        update_news();
    },

    show_next_news : function() {
        next_news = (next_news + 1) % news.length;
        this.draw(next_news);
        this.next_news_loop = Mainloop.timeout_add(this.newsDisplayRefreshDelay * 1000, Lang.bind(this, this.show_next_news));
    },

    get_news : function() {
        var url = "https://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20feednormalizer%20where%20url%3D%27http%3A%2F%2Frss.lemonde.fr%2Fc%2F205%2Ff%2F3050%2Findex.rss%27%20and%20output%3D%27atom_1.0%27&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
        var urlcatch = Soup.Message.new("GET", ""+url);
        session.queue_message(urlcatch, Lang.bind(this, this._onMessageResponse));
    },

    draw : function(newsNumber) {
        if (newsNumber > news.length) { // Not needed but if their is unhandled changes it could be useful
            newsNumber = 0;
        }
        this.mainBox = new St.BoxLayout({
                vertical : true,
                width : this.width,
                height : this.height,
                style_class : "news-reader"});

        this._view = new St.ScrollView({
        });
        this._view.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);

        this._newsBox = new St.BoxLayout({
                vertical : false
        });

        var newsTitleBox = new St.BoxLayout({
                vertical : true
        });
        var newsTitle = new St.Label({
                text : news[newsNumber]['title'],
                style_class : "news-title"
        });
        newsTitle.clutter_text.set_line_wrap(true);
        newsTitle.clutter_text.set_line_wrap_mode(imports.gi.Pango.WrapMode.WORD_CHAR);
        newsTitleBox.add_actor(newsTitle);

        var endOfSummary = news[newsNumber]['summary']['content'].indexOf("<br");
        var contentSnippet = news[newsNumber]['summary']['content'].slice(0, endOfSummary);
        var newsContentSnippet = new St.Label({
                text : contentSnippet,
                style_class : "news-content",
        });
        newsContentSnippet.clutter_text.set_line_wrap(true);
        newsContentSnippet.clutter_text.set_line_wrap_mode(imports.gi.Pango.WrapMode.WORD_CHAR);
        newsContentSnippet.clutter_text.set_single_line_mode(false);
        newsContentSnippet.clutter_text.set_offscreen_redirect(imports.gi.Clutter.OffscreenRedirect.ALWAYS);
        newsTitleBox.add_actor(newsContentSnippet);

        if (this.displayImages) {
            this.newsIcon = new St.Bin({
                    height : this.width/3,
                    width : this.heigth/3
            });
            var iconURL = news[newsNumber]['link']['1']['href'];
            var iconUrlcatch = Soup.Message.new("GET", ""+ iconURL);
            session.queue_message(iconUrlcatch, Lang.bind(this, this._onIconLoaded));
            newsTitleBox.add_actor(this.newsIcon);
        }

        var readMoreButton = new St.Button();
        var readMoreLabel = new St.Label({
                text : "Lire plus sur le site web",
        });
        readMoreButton.add_actor(readMoreLabel);
        readMoreButton.connect("clicked", function(button, event) {
            Util.spawnCommandLine("xdg-open " + news[newsNumber]['id']);
        });

        newsTitleBox.add(readMoreButton, {
                x_fill : false,
                y_fill : false,
                expand : true,
                x_align : St.Align.END,
                y_align : St.Align.START
        });
        this._newsBox.add_actor(newsTitleBox);

        this._view.add_actor(this._newsBox);
        this.mainBox.add(this._view, {
                expand: true
        });

        this.setContent(this.mainBox);
    },

    _onIconLoaded : function(session, message) {
        try {
            var outFile = Gio.file_new_for_path(this.save_path);
            var outStream = new Gio.DataOutputStream({
                    base_stream : outFile.replace(null, false, Gio.FileCreateFlags.NONE, null)
            });
            Cinnamon.write_soup_message_to_stream(outStream, message);
            outStream.close(null);
            var iconFile = Gio.file_new_for_path(this.save_path);
            if (iconFile != undefined) {
                var icon_uri = iconFile.get_uri();
                this.icon = St.TextureCache.get_default().load_uri_async(icon_uri, -1, -1);
                var heightRatio = (this.height/3)/this.icon.height;
                var widthRatio = (this.width/3)/this.icon.width;
                var iconWidth = this.icon.width * widthRatio;
                var iconHeight = this.icon.height * heightRatio;
                this.icon.set_size(iconWidth, iconHeight);
                this.newsIcon.add_actor(this.icon);
            }
        } catch(e) {
            global.log("error");
        }
    },

    _onMessageResponse : function(session, message) {
        news = [];
        var response = message.response_body.data.toString();
        var jsonObject = JSON.parse(response);

        news = jsonObject['query']['results']['feed']['entry'];
        if (next_news === -1) {
            this.show_next_news();
        }
    }
}

function main(metadata, desklet_id) {
    return new NewsDesklet(metadata, desklet_id);
}
