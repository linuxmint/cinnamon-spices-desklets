/*
 * Temperature
 * Copyright 2016 Samuel Walladge
 * Distributed under the terms of the GNU GPLv3
 *
 * with inspiration and code help from the following desklets:
 * - xkcd@rjanja
 * - stocks@fthuin
 *
 */
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const ByteArray = imports.byteArray;
const uuid = "temperature@swalladge";

var session;
if (Soup.MAJOR_VERSION === 2) {
  session = new Soup.SessionAsync();
} else {
  session = new Soup.Session();
}

Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function TheDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

TheDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._onDisplayChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "server", "server", this._onSettingsChanged, null);

        this.current_temp = null;
        this.setupUI();
        this.get_temp();
    },


    _onDisplayChanged : function() {
        this.window.set_size(this.width, this.height);
    },

     _onSettingsChanged : function() {
        // this.window.destroy_all_children();
        // this.window.destroy();
        Mainloop.source_remove(this.mainloop);
        this.get_temp();
     },

    on_desklet_remove: function() {
      this.window.destroy_all_children();
      this.window.destroy();
      Mainloop.source_remove(this.mainloop);
    },

    setupUI: function() {
        // main container for the desklet
        global.log('setting up ui');
        this.window = new St.BoxLayout({
          vertical: true,
          width: this.width,
          height: this.height,
          style_class: 'temp-box'
        });
        this.text = new St.Label();
        if (this.current_temp !== null && this.current_temp !== undefined) {
          this.text.set_text(this.current_temp.toFixed(1).toString() + '°C');
        } else {
          this.text.set_text(_("error"));
        }

        this.window.add(this.text);
        this.setContent(this.window);
        this.mainloop = Mainloop.timeout_add(5 * 60 * 1000, Lang.bind(this, this.get_temp));
    },

    get_temp: function() {
      // var server = this.server || 'http://localhost:8888';
      var url = this.server + '/api/temperature/current';
      var urlcatch = Soup.Message.new('GET', url);
      if (Soup.MAJOR_VERSION === 2) {
        session.queue_message(urlcatch, (session_, message) => {
          global.log('status: ' + message.status_code);

          if (message.status_code === 200) {
            var response = message.response_body.data.toString();
            var data = JSON.parse(response).data;
            this.current_temp = data.temperature;
          } else {
            this.current_temp = null;
          }
          this.setupUI();
        });
      } else {
        session.send_and_read_async(urlcatch, 0, null, (session_, res) => {
          global.log('status: ' + urlcatch.get_status());

          if (urlcatch.get_status() === 200) {
            try {
              const bytes = session.send_and_read_finish(res);
              var data = JSON.parse(ByteArray.toString(bytes.get_data()));
              this.current_temp = data.temperature;
            } catch (e) {
              global.log(e);
              this.current_temp = null;
            }
          } else {
            this.current_temp = null;
          }
          this.setupUI();
        });
      }
    }
};

function main(metadata, desklet_id) {
    return new TheDesklet(metadata, desklet_id);
}
