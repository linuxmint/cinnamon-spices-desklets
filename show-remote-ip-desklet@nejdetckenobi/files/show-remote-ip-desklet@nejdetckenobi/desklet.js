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
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;

var _httpSession;
if (Soup.MAJOR_VERSION === 2) {
    _httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
} else {
    _httpSession = new Soup.Session();
}

_httpSession.timeout = 5;

function ShowRemoteIPDesklet(metadata, deskletId) {
    this._init(metadata, deskletId);
}

ShowRemoteIPDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, metadata["uuid"], deskletId);

        // account configs
        this.settings.bind("iptype", "iptype", () => this._do_updates(), null);
        this.settings.bind("font_size", "font_size", () => this._do_updates(), null);

        this.window = new St.BoxLayout({ vertical: true });

        this.ip4_button = new St.Button({ style_class: "ip-button" });
        this.ip4_button.connect("clicked", () => this._copy_ip4());
        this.window.add(this.ip4_button);

        this.ip6_button = new St.Button({ style_class: "ip-button" });
        this.ip6_button.connect("clicked", () => this._copy_ip6());
        this.window.add(this.ip6_button);

        const refresh_button = new St.Button({ });
        refresh_button.connect("clicked", () => this._do_updates());
        const icon = new St.Icon({ style_class: "refresh-icon", icon_type: St.IconType.SYMBOLIC, icon_name: "view-refresh-symbolic", icon_size: 16 })
        refresh_button.child = icon;
        this.window.add(refresh_button);

        this.setContent(this.window);
    },

    on_desklet_added_to_desktop: function() {
        this._do_updates();
        this.timeout = Mainloop.timeout_add_seconds(60, this._tick.bind(this));
    },

    _copy_ip4: function() {
        const ip4 = this.ip4_button.get_label();

        const clip = St.Clipboard.get_default();
        clip.set_text(St.ClipboardType.CLIPBOARD, ip4);
    },

    _copy_ip6: function() {
        const ip6 = this.ip6_button.get_label();

        const clip = St.Clipboard.get_default();
        clip.set_text(St.ClipboardType.CLIPBOARD, ip6);
    },

    _tick: function() {
        this._do_updates();
        return GLib.SOURCE_CONTINUE;
    },

    _do_updates: function() {
        this.ip4_button.hide();
        this.ip6_button.hide();

        if (["ipv4", "both"].includes(this.iptype)) {
            this.ip4_button.show();
            // this.ip4_button.set_label("kkk...");
            this._update_ip("http://ipv4.icanhazip.com/", this.ip4_button);
        }
        if (["ipv6", "both"].includes(this.iptype)) {
            this.ip6_button.show();
            // this.ip6_button.set_label(".kkk..");
            this._update_ip("http://ipv6.icanhazip.com/", this.ip6_button);
        }
    },

    _update_ip: function(uri, button) {
        this.ip4_button.style = `font-size: ${this.font_size}pt`;
        this.ip6_button.style = `font-size: ${this.font_size}pt`;

        let message = Soup.Message.new("GET", uri);

        if (Soup.MAJOR_VERSION === 2) {
            _httpSession.queue_message(message, (session, message) => {
                if (message.status_code === 200) {
                    let ip = message.response_body.data.toString();
                    button.set_label(ip.replace("\n", ""));
                } else {
                    button.set_label(_("Unknown"));
                }
            });
        } else {
            _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, result) => {
                if (message.get_status() === 200) {
                    const bytes = _httpSession.send_and_read_finish(result);
                    const ip = ByteArray.toString(bytes.get_data());
                    button.set_label(ip.replace("\n", ""));
                    return;
                }

                button.set_label(_("Unknown"));
            })
        }
    },

    on_desklet_clicked: function(event) {
        // this.ip4.set_text("Getting IP address..");
        // this.ip6text.set_text("");
        // this._do_updates();
    },

    on_desklet_removed: function() {
        if (this.timeout > 0) {
            Mainloop.source_remove(this.timeout);
            this.timeout = 0;
        }
    }
};

function main(metadata, deskletId) {
    return new ShowRemoteIPDesklet(metadata, deskletId);
}
