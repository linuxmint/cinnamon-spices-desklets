/*
 * Vienna Weather Information
 */

"use strict";
const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const Lang = imports.lang;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext;
const uuid = "ViennaTextBasedWeather@f-istvan";

var session = new Soup.SessionAsync();

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function ViennaTextBasedWeather(metadata, deskletId) {
    this._init(metadata, deskletId);
}

let insertNewLines = function(text) {
  let numOfCharsToSkip = 80;
  for (let i = 1; i < text.length / numOfCharsToSkip; i++) {
    var position = text.indexOf(" ", numOfCharsToSkip * i) + 1;
    text = [text.slice(0, position), "\n", text.slice(position)].join("");
  }

  return text;
};

let getWeatherObjectByRegex = function(text, regex) {
  let match = text.match(regex);
  let weatherLabel = match[1];
  let weatherText = match[2]
    .toString()
    .trim()
    .replace(/<\/?p>/g, "");

  return {
    name: weatherLabel,
    text: weatherText
  };
};

let createLabel = function(label, cssClass) {
  return new St.Label({
    text: label,
    styleClass: cssClass
  });
};

let createWeatherContainer = function (weatherObject) {
  let heuteWeatherName = createLabel(weatherObject.name, "vie-weather-name");
  let text = insertNewLines(weatherObject.text);
  let heuteWeatherText = createLabel(text, "vie-weather-text");
  
  let widgetLayout = new St.BoxLayout({
    vertical: true,
    styleClass: "vie-weather-container"
  });

  widgetLayout.add(heuteWeatherName);
  widgetLayout.add(heuteWeatherText);

  return widgetLayout;
};

let createMainLayoutWithItems = function (config) {
  let window = new St.BoxLayout({
    vertical: true,
    width: config.width,
    height: config.height,
    styleClass: "vie-window"
  });

  config.items.forEach((item) => window.add(item));
  return window;
};

let getDateText = function () {
  let now = new Date();
  return "Last weather update: " + 
    now.getFullYear() + 
    "-" + (now.getMonth() + 1) + 
    "-" + now.getDate() + 
    " " + now.getHours() + 
    ":" + now.getMinutes() +
    ":" + now.getSeconds();
};

ViennaTextBasedWeather.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init(metadata, deskletId) {
        Desklet.Desklet.prototype._init.call(this, metadata, deskletId);

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, deskletId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "height", "height", this.onSettingsChanged, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "width", "width", this.onSettingsChanged, null);
        
        let config = {
          height: this.height,
          width: this.width,
          items: [
            createLabel("Loading...", "vie-weather-label")
          ]
        };

        this.window = createMainLayoutWithItems(config);
        this.setContent(this.window);
        this.getWeather();
    },

    handleResponse(session, message) {
      let fulltextWrapper = message.response_body.data.toString();
      
      let heuteRegex = /<h2>(Heute[^]*)<\/h2>[^]*(<p>[^]*<\/p>)<h2>Morgen+/;
      let morgenRegex = /<h2>(Morgen[^]*)<\/h2>([^]*<p>[^]*<\/p>)<h2>Übermorgen/;
      let uberMorgenRegex = /<h2>(Übermorgen[^]*)<\/h2>([^]*<p>[^]*<\/p>)<h2>/;

      let heuteWeather = getWeatherObjectByRegex(fulltextWrapper, heuteRegex);
      let morgenWeather = getWeatherObjectByRegex(fulltextWrapper, morgenRegex);
      let uberMorgenWeather = getWeatherObjectByRegex(fulltextWrapper, uberMorgenRegex);

      let config = {
        height: this.height,
        width: this.width,
        items: [
          createLabel("Wien Wetter", "vie-title"),
          createLabel(getDateText(), "vie-last-modified"),
          createWeatherContainer(heuteWeather),
          createWeatherContainer(morgenWeather),
          createWeatherContainer(uberMorgenWeather)
        ]
      };

      this.window = createMainLayoutWithItems(config);

      this.setContent(this.window);
      this.mainloop = Mainloop.timeout_add(10 * 1000, Lang.bind(this, this.getWeather));
    },

    getWeather() {
      var url = "https://wetter.orf.at/wien/prognose";
      var getUrl = Soup.Message.new("GET", url);
      session.queue_message(getUrl, Lang.bind(this, this.handleResponse));
    },

    onSettingsChanged() {
      this.window.set_size(this.width, this.height);
    },

    /**
     * Called when the desklet is removed.
     */
    on_desklet_removed() {
      this.window.destroy_all_children();
      this.window.destroy();
      Mainloop.source_remove(this.mainloop);
    }
};

function main(metadata, deskletId) {
    return new ViennaTextBasedWeather(metadata, deskletId);
}

