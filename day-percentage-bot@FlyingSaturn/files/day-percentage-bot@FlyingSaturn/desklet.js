const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const UUID = "day-percentage-bot@FlyingSaturn";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
  return Gettext.dgettext(UUID, str);
}

class MyDesklet extends Desklet.Desklet {
  constructor(metadata, deskletId) {
    super(metadata, deskletId);

    this.setHeader(_("Day percentage"));
    this._setupUI();
    this._update();
  }

  _setupUI() {
    this.window = new St.Bin();
    this.text = new St.Label();
    this.text.set_text("... %");

    this.window.add_actor(this.text);
    this.setContent(this.window);
  }

  _update() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }

    const dayPercent = this._calcPercent();
    this.text.set_text(dayPercent.toFixed(1) + " %");

    // update every second
    this.timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._update));
  }

  _calcPercent() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const secondsPassed = (now.getTime() - startOfDay.getTime()) / 1000;
    const totalSecondsInDay = 24 * 60 * 60;
    return (secondsPassed / totalSecondsInDay) * 100;
  }

  on_desklet_removed() {
    if (this.timeout) {
      Mainloop.source_remove(this.timeout);
    }
  }
}

function main(metadata, deskletId) {
  return new MyDesklet(metadata, deskletId);
}
