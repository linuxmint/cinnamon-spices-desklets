const Settings = imports.ui.settings;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

const SU = require("./style_utils");
const Translation = require("./translation");
const CONSTANTS = require("./constants");
const _ = Translation._;
const OK = -1;

// REST API workflow based on https://github.com/linuxmint/cinnamon-spices-desklets/blob/master/bbcwx%2540oak-wood.co.uk/files/bbcwx%2540oak-wood.co.uk/3.0/desklet.js
let _httpSession;
if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
    _httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
} else { //version 3
    _httpSession = new Soup.Session();
}

class WeatherAPISource {
    constructor(uuid, desklet_id) {
        this.cached_response = undefined;
        this.last_error = OK;
        this.reset_time_of_last_weather_update();
        this.uuid = uuid;

        this.settings = new Settings.DeskletSettings(this, uuid, desklet_id);

        this.settings.bind("wapi-enable", "wapi_enabled_switch", this._onWAPISettingsChanged);
        this.settings.bind("wapi-key", "wapi_key", this._onWAPISettingsChanged);
        this.settings.bind("wapi-query", "wapi_query", this._onWAPISettingsChanged);
        this.settings.bind("wapi-update-period-minutes", "wapi_update_period", this._onWAPISettingsChanged);

        this.settings.bind("bottom-emoji-type", "emoji_type", this._onWAPISettingsChanged);
        this.settings.bind("bottom-caption-type", "caption_type", this._onWAPISettingsChanged);
    }

    _onWAPISettingsChanged() {
        this.requestWAPIUpdate();
    }

    requestWAPIUpdate() {
        // this.next_weather_update_is_fast = true;
    }

    reset_time_of_last_weather_update() {
        this.time_of_last_weather_update = new Date(0);  // epoch means "never updated before"
    }

    make_weatherAPI_request(back_reference, emoji_callback, caption_callback, number_callback, head_callback, unit_callback, mini_errormoji_callback) {
        let now = new Date();
        const NORMAL_WAIT_TIME = this.wapi_update_period*60*1000;  // from minutes to milliseconds
        const FAST_WAIT_TIME = 20*1000;  // very few seconds in milliseconds
        let cooldown = this.next_weather_update_is_fast ? FAST_WAIT_TIME : NORMAL_WAIT_TIME;
        if (now - this.time_of_last_weather_update > cooldown) {
            // global.log("YEEEEEEEEEEEEEEEEEAAAAAAH");
            this.time_of_last_weather_update = now;
            this.next_weather_update_is_fast = false;
            this._getWeather(
                "http://api.weatherapi.com/v1/forecast.json?key="+this.wapi_key+"&q="+this.wapi_query,
                (response, status_code) => {
                    if (response) {
                        this.last_error = OK;
                        this.cached_response = JSON.parse(response);
                    }
                    else {
                        this.last_error = status_code;
                        if (status_code == 0 || status_code == 2) {  // may add more status codes here with ||
                            this.next_weather_update_is_fast = true;
                            global.log("["+this.uuid+"] Fast retry activated");
                        }
                    }
                    this._call_callbacks(back_reference, emoji_callback, caption_callback, number_callback, head_callback, unit_callback, mini_errormoji_callback);
                }
            )
        }
        else {
            // global.log("cached");
            this._call_callbacks(back_reference, emoji_callback, caption_callback, number_callback, head_callback, unit_callback, mini_errormoji_callback);
        }
    }

    _call_callbacks(back_reference, emoji_callback, caption_callback, number_callback, head_callback, unit_callback, mini_errormoji_callback) {
        if (this.cached_response) {
            emoji_callback.call(back_reference, this._make_emoji_text(this.cached_response));
            caption_callback.call(back_reference, this._make_caption_text(this.cached_response));
            number_callback.call(back_reference, this._make_number_text(this.cached_response));
            head_callback.call(back_reference, this._get_head_text());
            unit_callback.call(back_reference, this._get_unit_text());
            if (this.last_error == OK) {
                mini_errormoji_callback.call(back_reference, "");
            }
            else {
                mini_errormoji_callback.call(back_reference, "⚠️");
            }
        }
        else {
            mini_errormoji_callback.call(back_reference, "");
            if (this.last_error != OK) {
                emoji_callback.call(back_reference, "⚠️");
                if (this.last_error == 0 || this.last_error == 2) {
                    caption_callback.call(back_reference, _("No network,\nretrying..."));
                }
                else {
                    caption_callback.call(back_reference, _("Error: see log\nSuper + L"));
                }
                number_callback.call(back_reference, "");
                head_callback.call(back_reference, "");
                unit_callback.call(back_reference, "");
            }
        }
    }

    _make_emoji_text(resp_json) {
        switch (this.emoji_type) {
            case "weather":
                let weather_code = resp_json.current.condition.code;
                return CONSTANTS.WEATHER_EMOJIS_BY_CONDITION_CODE[weather_code];
            default:
                return "";
        }
    }

    _make_caption_text(resp_json) {
        switch (this.caption_type) {
            case "weather":
                let weather_code = resp_json.current.condition.code;
                let weather_emoji = CONSTANTS.WEATHER_EMOJIS_BY_CONDITION_CODE[weather_code];
                return CONSTANTS.WEATHER_LABELS_BY_EMOJI[weather_emoji];
            default:
                return "";
        }
    }

    _make_number_text(resp_json) {
        switch (this.caption_type) {
            case "rain":
                let rain_chance = resp_json.forecast.forecastday[0].day.daily_chance_of_rain;
                return SU.countdown_formatting(rain_chance);
            case "temp-c":
                let temp_c = resp_json.current.temp_c;
                return SU.countdown_formatting(temp_c);
            case "temp-f":
                let temp_f = resp_json.current.temp_f;
                return SU.countdown_formatting(temp_f);
            default:
                return "";
        }
    }

    _get_head_text() {
        switch (this.caption_type) {
            case "rain":
                return _("Rain") + ":";
            case "temp-c":
            case "temp-f":
                return _("Temp") + ":";
            default:
                return "";
        }
    }

    _get_unit_text() {
        switch (this.caption_type) {
            case "rain":
                return "%";
            case "temp-c":
                return " °C"
            case "temp-f":
                return " °F";
            default:
                return "";
        }
    }

    _getWeather(url, callback) {
        var here = this;
        let message = Soup.Message.new('GET', url);
        if (Soup.MAJOR_VERSION === undefined || Soup.MAJOR_VERSION === 2) {
            _httpSession.timeout = 10;
            _httpSession.idle_timeout = 10;
            _httpSession.queue_message(message, function (session, message) {
                if( message.status_code == 200) {
                    try {
                        callback.call(here, message.response_body.data.toString(), message.status_code);
                    } catch(e) {
                        global.logError(e)
                        callback.call(here, false, message.status_code);
                    }
                } else {
                    global.logWarning("["+here.uuid+"] Error retrieving address " + url + ". Status: " + message.status_code + ": " + message.reason_phrase);
                    if (message.status_code == 0) {
                        global.logWarning("["+here.uuid+"] (You may be disconnected from the network)");
                    }
                    callback.call(here, false, message.status_code);
                }
            });
        } else { //version 3
            _httpSession.timeout = 10;
            _httpSession.idle_timeout = 10;
            _httpSession.send_and_read_async(message, Soup.MessagePriority.NORMAL, null, function (session, result) {
                if( message.get_status() === 200) {
                    try {
                        const bytes = _httpSession.send_and_read_finish(result);
                        callback.call(here, ByteArray.toString(bytes.get_data()), message.get_status());
                    } catch(e) {
                        global.logError(e)
                        callback.call(here, false, message.get_status());
                    }
                } else {
                    global.logWarning("["+here.uuid+"] Error retrieving address " + url + ". Status: " + message.get_status() + ": " + message.get_reason_phrase());
                    if (message.get_status() == 0) {
                        global.logWarning("["+here.uuid+"] (You may be disconnected from the network)");
                    }
                    callback.call(here, false, message.get_status());
                }
            });
        }
    }
}