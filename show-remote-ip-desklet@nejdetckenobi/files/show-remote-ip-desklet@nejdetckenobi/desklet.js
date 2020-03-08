/* Cinnamon desklet for seeing remote IP address when available.

Copyright (C) 2014, 2015 Nejdet Çağdaş Yücesoy

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

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Util = imports.misc.util;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;

const _httpSession = new Soup.SessionAsync();
_httpSession.timeout = 5;

Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

function ShowRemoteIPDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

ShowRemoteIPDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);
        this.configFile = GLib.get_home_dir() + "/.local/share/cinnamon/desklets/show-remote-ip-desklet@nejdetckenobi/metadata.json";
        this._menu.addAction("Edit Config", Lang.bind(this, function() {
            Util.spawnCommandLine("xdg-open " + this.configFile);
        }));

        this.window = new St.Bin();
        this.text = new St.Label();
        this.text.style = "font-size: " + metadata["font-size"];
        this.window.add_actor(this.text);
        this.setContent(this.window);

        this._update_ip();
    },
    _tick: function() {
        this._update_ip();
        this.timeout = Mainloop.timeout_add_seconds(60, this._tick.bind(this));
    },
    _update_ip: function() {
        var that = this;
        let message = Soup.Message.new("GET", "https://icanhazip.com/");
        _httpSession.queue_message(message, function(session, message) {
            if (message.status_code === 200) {
                let ip = message.response_body.data.toString();
                that.text.set_text(ip);
            } else {
                that.text.set_text("");
            }
        });
    },
    on_desklet_clicked: function(event) {
        this.text.set_text("Getting IP address..");
        this._update_ip();
    },
    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
    }
};

function main(metadata, deskletId) {
    return new ShowRemoteIPDesklet(metadata, deskletId);
}
