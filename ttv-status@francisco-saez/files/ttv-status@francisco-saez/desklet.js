const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Soup = imports.gi.Soup
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Util = imports.misc.util;

const UUID = 'ttv-status@francisco-saez';

const _dev = false;

function devLog (fnc, msg) {
    if (_dev) {
        global.log(UUID + ' ['+fnc+']', msg);
    }
}


let httpSession;
if (Soup.MAJOR_VERSION == 2) {
    httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());
} else {
    httpSession = new Soup.Session();
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        try {

            this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, this.instance_id);

            this.settings.bindProperty(Settings.BindingDirection.IN, "channel", "channel", this._onChannelChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "channel_name", "channel_name", this._onChannelNameChange, null);

            this.settings.bindProperty(Settings.BindingDirection.IN, "refresh_rate", "refresh_rate", this._onRefreshIntervalChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "refresh_rate_option", "refresh_rate_option", this._onRefreshIntervalChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "refresh_rate_online", "refresh_rate_online", this._onRefreshIntervalChanged, null);

            this.settings.bindProperty(Settings.BindingDirection.IN, "use_custom_size", "use_custom_size", this._onSizeChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this._onSizeChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this._onSizeChange, null);

            this.settings.bindProperty(Settings.BindingDirection.IN, "hide_decorations", "hide_decorations", this._onDecoChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "border_radius", "border_radius", this._onDecoChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "padding_vertical", "padding_vertical", this._onDecoChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "padding_horizontal", "padding_horizontal", this._onDecoChange, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "bg_color", "bg_color", this._onDecoChange, null);

        } catch (e) {
            global.logError(e);
        }

        this.status = false;
        
        this.metadata['prevent-decorations'] = this.hide_decorations;
        this._updateDecoration();

        this.iconColor = [1, 1, 1, 1];

        this.iconStatus = new St.DrawingArea({ style_class: "icon-status" });
        this.iconStatus.set_width(20);
        this.iconStatus.set_height(20);
        this.iconStatus.set_style("margin-right: 10px;");

        let angle = 0;
        const donutThickness = 5;
        const arcLength = Math.PI / 2;
        const gapLength = Math.PI / 1;
        this.isLoading = true;
        
        this.iconStatus.connect('repaint', (area) => {
            if (!this.isLoading) {
                let cr = area.get_context();
                let [width, height] = area.get_surface_size();
                cr.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, 2 * Math.PI);
                cr.setSourceRGBA(...this.iconColor);
                cr.fill();
            } else {
                let cr = area.get_context();
                let [width, height] = area.get_surface_size();
                let radius = Math.min(width, height) / 2;
                let innerRadius = radius - donutThickness;
            
                cr.save();
                cr.translate(width / 2, height / 2);
                cr.rotate(angle);
                cr.translate(-width / 2, -height / 2);
            
                for (let i = 0; i < 3; i++) {
                    let startAngle = i * (arcLength + gapLength);
                    let endAngle = startAngle + arcLength;
            
                    cr.arc(width / 2, height / 2, radius, startAngle, endAngle);
                    cr.arcNegative(width / 2, height / 2, innerRadius, endAngle, startAngle);
                    cr.setSourceRGBA(...this.iconColor);
                    cr.fill();
                }
            
                cr.restore();
                angle += 0.1;
                if (angle >= 2 * Math.PI) {
                    angle = 0;
                }
            
                area.queue_repaint();
            }


        });

        this.iconStatusWrapper = new St.Button();
        this.iconStatusWrapper.connect("clicked", () => {
            this._onRefreshIntervalChanged();
            return true;
        });

        this.iconStatusWrapper.add_actor(this.iconStatus);

        let labelButton = new St.Button();
        labelButton.connect("clicked", () => {
            Util.spawnCommandLine("xdg-open https://www.twitch.tv/" + this.channel);
        });

        this.label = new St.Label({ text: this.channel_name, y_align: St.Align.START});
        labelButton.add_actor(this.label);

        this.box = new St.BoxLayout({
            vertical: false,
            // x_expand: false,
            // y_expand: false,
            // x_align: St.Align.START,
            // y_align: St.Align.START
        });

        if (this.hide_decorations) {
            this.box.style = "background-color: "+this.bg_color+"; border-radius: "+this.border_radius+"px; margin:0; border:0; padding: "+this.padding_vertical+"px "+this.padding_horizontal+"px;";
        }
        
        if (this.use_custom_size) {
            this.box.set_width(this.width);
            this.box.set_height(this.height);
        }
        
        this.box.add_child(this.iconStatusWrapper);
        this.box.add_child(labelButton);

        this.setContent(this.box);

        this.fetchData();
    },

    fetchData: function () {
        devLog('fetchData', 'Fetching data.');
        this.isLoading = true;
        this.iconStatus.queue_repaint();

        let url = 'https://www.twitch.tv/' + this.channel;
        
        devLog('fetchData.url', url);

        var message = Soup.Message.new('GET', url);

        const isLive = result => {
            this.status = false;
            if (result.includes('isLiveBroadcast')) {
                this.status = true;
            }
            this.changeIconColor(this.status);
        };

        if (Soup.MAJOR_VERSION === 2) {
            devLog('fetchData.Soup-version', 2);
              httpSession.queue_message(message,
                Lang.bind(this, function(session, response) {
                  if (response.status_code !== Soup.KnownStatusCode.OK) {
                    devLog('fetchData.queue_message', 'Error: response code ' + response.status_code + ': ' + response.reason_phrase + ' - ' + response.response_body.data)
                    return;
                  }
                  isLive(message.response_body.data);
                })
              );
        } else { //version 3
            httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, (session, response) => {
                if (message.get_status() !== Soup.Status.OK) {
                    devLog('fetchData.send_and_read_async', 'Error: '+ message.get_status() + ': ' + message.get_reason_phrase());
                    return;
                }
                const bytes = httpSession.send_and_read_finish(response);
                isLive(bytes.get_data().toString());
            });
        }

        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
        }

        let refresh_rate = this.refresh_rate;
        if (this.status && this.refresh_rate_option) {
            refresh_rate = this.refresh_rate_online;
        }

        devLog('fetchData.this.status', this.status);
        devLog('fetchData.this.refresh_rate_option', this.refresh_rate_option);
        devLog('fetchData.this.refresh_rate', this.refresh_rate);

        this.mainloop = Mainloop.timeout_add_seconds(
            refresh_rate * 60,
            Lang.bind(this, this.fetchData)
        );
    },
    //parse_rgba_settings: credits to @rcassani
    parse_rgba_settings: function(color_str) {
        let colors = color_str.match(/\((.*?)\)/)[1].split(","); // get contents inside brackets: "rgb(...)"
        let r = parseInt(colors[0])/255;
        let g = parseInt(colors[1])/255;
        let b = parseInt(colors[2])/255;
        let a = 1;
        if (colors.length > 3) a = colors[3];
        return [r, g, b, a];
    },
    changeIconColor(status) {
        this.isLoading = false;
        if (status) {
            this.iconColor = [0, 1, 0, 1];
        } else {
            this.iconColor = [1, 0, 0, 1];
        }
        this.iconStatus.queue_repaint();
    },
    _onChannelChange() {
        this.fetchData();
    },
    _onChannelNameChange() {
        this.label.set_text(this.channel_name);
    },
    _onSizeChange() {
        if (this.use_custom_size) {
            this.box.set_width(this.width);
            this.box.set_height(this.height);
        } else {
            this.box.set_width('auto');
            this.box.set_height('auto');
        }
    },
    _onDecoChange() {
        this.metadata['prevent-decorations'] = this.hide_decorations;
        if (this.hide_decorations) {
            this.box.style = "background-color: "+this.bg_color+"; border-radius: "+this.border_radius+"px; margin:0; border:0; padding: "+this.padding_vertical+"px "+this.padding_horizontal+"px;";
        } else {
            this.box.style = "";
        }
        this._updateDecoration();
    },
    _onRefreshIntervalChanged: function () {
        if (this.mainloop) {
            Mainloop.source_remove(this.mainloop);
        }

        let refresh_rate = this.refresh_rate;
        if (this.status && this.refresh_rate_option) {
            refresh_rate = this.refresh_rate_online;
        }

        devLog('_onRefreshIntervalChanged.refresh_rate', refresh_rate);

        this.mainloop = Mainloop.timeout_add_seconds(
            refresh_rate * 60,
            Lang.bind(this, this.fetchData())
        );
    },
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
