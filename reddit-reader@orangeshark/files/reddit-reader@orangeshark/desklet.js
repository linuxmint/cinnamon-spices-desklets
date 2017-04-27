/* Cinnamon desklet for reading reddit.com

Copyright (C) 2014, 2015 Erik Edrosa

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>. */

const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const St = imports.gi.St;
const Util = imports.misc.util;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const MIN_TO_MS = 60 * 1000;
const USER_AGENT = "reddit-reader-desklet/0.4";

let UUID;
function _(str) {
    return Gettext.dgettext(UUID, str);
}

function Post(data) {
    this._init(data);
}

Post.prototype = {
    _init: function(data) {
        this.id = data.id;
        this.subreddit = data.subreddit;
        this.domain = data.domain
        this.stickied = data.stickied;
        this.author = data.author;
        this.title = data.title;
        this.url = data.url;
        this.num_comments = data.num_comments;
        this.permalink = data.permalink;
        this.score = data.score;
    }
}

function Subreddit(session, sub) {
    this._init(session, sub);
}

Subreddit.prototype = {
    _init: function(session, sub) {
        this.session = session;
        this.sub = sub;
        this.url = "http://www.reddit.com/r/%s/.json".format(sub);
        this.posts = [];
    },

    get: function() {
        let message = Soup.Message.new("GET", this.url);

        this.session.queue_message(message, Lang.bind(this, this._onResponse));
    },

    _onResponse: function(session, message) {
        if(message.status_code != 200) {
            this._processResponse(message.status_code, null);
        } else {
            let resultJSON = message.response_body.data;
            let result = JSON.parse(resultJSON);
            this._processResponse(null, result);
        }
    },

    _processResponse: function(error, result) {
        if(error !== null) {
            this.posts = [];
            global.logError("reddit-reader: Recieved a %d from %s".format(
                        error, this.url));
        } else {
            let resultPosts = result.data.children;
            this.posts =
                resultPosts.map(function(c) { return new Post(c.data); });
        }

        if(this.onLoad) {
            this.onLoad();
        }
    }

}

function RedditModel(subs) {
    this._init(subs);
}

RedditModel.prototype = {
    _init: function(subs) {
        this.session = new Soup.Session({user_agent: USER_AGENT});
        this.subs = new Subreddit(this.session, subs);
    },

    getPosts: function() {
        return this.subs.posts;
    },

    refresh: function() {
        this.subs.get();
    },

    setOnLoad: function(callback) {
        this.onLoad = callback;
        this.subs.onLoad = callback;
    },

    setSubs: function(subs) {
        this.subs = new Subreddit(this.session, subs);
        this.subs.onLoad = this.onLoad;
    }
}

function RedditDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

RedditDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.metadata = metadata;
        UUID = this.metadata.uuid;
        Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

        try {
            this.settings = new Settings.DeskletSettings(
                    this, this.metadata.uuid, this.instance_id);

            this.settings.bindProperty(
                    Settings.BindingDirection.IN,
                    "subreddit",
                    "subreddit",
                    this._onSubredditChange,
                    null);
            this.settings.bindProperty(
                    Settings.BindingDirection.IN,
                    "width",
                    "width",
                    this._onSizeChange,
                    null);
            this.settings.bindProperty(
                    Settings.BindingDirection.IN,
                    "height",
                    "height",
                    this._onSizeChange,
                    null);
            this.settings.bindProperty(
                    Settings.BindingDirection.IN,
                    "refreshRate",
                    "refreshRate",
                    this._onRefreshChange,
                    null);
        } catch (e) {
            global.logError(e);
        }

        this.setupUI();
        this.model = new RedditModel(this.subreddit);
        this.model.setOnLoad(Lang.bind(this, this.draw));
        this._updateLoop();
    },

    setupUI: function() {
        // main container of the desklet
        this._redditBox = new St.BoxLayout( {vertical: true,
                                             width: this.width,
                                             height: this.height,
                                             style_class: "reddit-reader"} );

        let titlebar = new St.BoxLayout({vertical: false,
                                         style_class: "reddit-title-bar"});

        let icon = new St.Icon({
            icon_name: "web-browser-symbolic",
            style_class: "reddit-header-icon"});

        let headerButton = new St.Button();
        headerButton.add_actor(icon);
        headerButton.connect("clicked", function(button, event) {
            Util.spawnCommandLine("xdg-open http://www.reddit.com");
        });

        let name = new St.Label({ text: "reddit",
                                  style_class: "reddit-title" });

        this._subButton = new St.Button()

        this._subname = new St.Label( {text: "loading...",
                                       style_class: "reddit-subtitle" });

        this._subButton.add_actor(this._subname);

        this._subButton.connect("clicked", Lang.bind(this, function(button, event) {
            Util.spawnCommandLine("xdg-open http://www.reddit.com/r/" + this.subreddit);
        }));

        titlebar.add(headerButton);
        titlebar.add(name);
        titlebar.add(this._subButton);
        this._redditBox.add(titlebar);

        this._view = new St.ScrollView();
        this._view.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        this._postsBox = new St.BoxLayout( { vertical: true,
                                            style_class: "reddit-posts-box"} );
        this._view.add_actor(this._postsBox);

        this._redditBox.add(this._view, { expand: true });

        this.setContent(this._redditBox);
    },

    draw: function() {
        this._postsBox.destroy_all_children();

        this._subname.set_text(this.subreddit);

        let posts = this.model.getPosts();
        for(let i = 0; i < posts.length; i++) {
            let postBox = new St.BoxLayout( { vertical: true,
                                              style_class: "reddit-post-box"} );

            // St buttons are used as containers for the clicked event
            let postButton = new St.Button({style_class: "reddit-post",
                                            x_align: St.Align.START});
            // bind to post to have access to the url
            postButton.connect("clicked", Lang.bind(posts[i], function(b, e) {
                Util.spawnCommandLine("xdg-open %s".format(this.url));
            }));
            let postLabel = new St.Label( {text: posts[i].title} );
            postButton.add_actor(postLabel);
            postBox.add(postButton);
            // infobox
            let infoBox = new St.BoxLayout({vertical: false,
                                            style_class: "reddit-info-box"});

            // points
            let scoreLabel = new St.Label( {text: Gettext.dngettext(UUID, "%d point", "%d points", posts[i].score).format(posts[i].score)} );
            infoBox.add(scoreLabel);
             // author
            let authorButton = new St.Button();

            authorButton.connect("clicked", Lang.bind(posts[i], function(b, e) {
                Util.spawnCommandLine("xdg-open %s".format("https://www.reddit.com/u/" + this.author));
            }));

            let authorLabel = new St.Label( {text: _("by") + " " + posts[i].author} );
            authorButton.add_actor(authorLabel);
            infoBox.add(authorButton);

            // subreddit
            let subButton = new St.Button();
            subButton.connect("clicked", Lang.bind(posts[i], function(b, e) {
                Util.spawnCommandLine("xdg-open %s".format("https://www.reddit.com/r/" + this.subreddit));
            }));

            let subLabel = new St.Label( {text: _("to") + " " + posts[i].subreddit} );
            subButton.add_actor(subLabel);
            infoBox.add(subButton);

            // comments
            let commentButton = new St.Button();

            commentButton.connect("clicked", Lang.bind(posts[i], function(b, e) {
                Util.spawnCommandLine("xdg-open %s".format("https://www.reddit.com" + this.permalink));
            }));

            let commentLabel = new St.Label( {text: Gettext.dngettext(UUID, "%d comment", "%d comments", posts[i].num_comments).format(posts[i].num_comments)} );
            commentButton.add_actor(commentLabel);
            infoBox.add(commentButton);

            postBox.add(infoBox);
            this._postsBox.add(postBox);
        }
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.update_id);
    },

    _onSubredditChange: function() {
        this.model.setSubs(this.subreddit);
        this.model.refresh();
    },

    _onSizeChange: function() {
        // destory UI and reset it
        this._redditBox.destroy();
        this.setupUI();
        this.draw();
    },

    _onRefreshChange: function() {
        if(this.update_id > 0) {
            Mainloop.source_remove(this.update_id);
        }
        this.update_id = null;
        this._updateLoop();
    },

    _updateLoop: function() {
        //global.log("[%s] update".format(this.metadata.uuid));
        this.model.refresh();
        let timeout = this.refreshRate * MIN_TO_MS;
        this.update_id =
            Mainloop.timeout_add(timeout,
                                 Lang.bind(this, this._updateLoop));
    }
}

function main(metadata, desklet_id) {
    return new RedditDesklet(metadata, desklet_id);
}
