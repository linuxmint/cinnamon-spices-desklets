const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const {
  timeout_add_seconds,
  source_remove,
  remove_all_sources
} = require("./lib/mainloopTools");

function BinClockDesklet(metadata, desklet_id) {
  this._init(metadata, desklet_id);
}

BinClockDesklet.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function(metadata, desklet_id) {
    Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
    this.isRunning = true;
    this.timeout = timeout_add_seconds(1, () => {
      this.updateUI();
      return this.isRunning;
    });
    this.setupUI();
  },

  setupUI: function() {
    this._text = new St.Label({ text: "00000 : 000000 : 000000", style: 'font-size: 22px;' });
    this.setContent(this._text);
  },
  updateUI: function() {
    let now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    let seconds = now.getSeconds();
    let bin_hours = hours.toString(2).padStart(5, "0");
    let bin_mins = minutes.toString(2).padStart(6, "0");
    let bin_secs = seconds.toString(2).padStart(6, "0");
    this._text.set_text(
      bin_hours + " : " +
      bin_mins + " : " +
      bin_secs
    );
  },
  on_desklet_removed: function() {
    this.isRunning = false;
    if (this.timeout)
      source_remove(this.timeout);
    remove_all_sources();
  }
}

function main(metadata, desklet_id) {
  return new BinClockDesklet(metadata, desklet_id);
}
