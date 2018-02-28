const GLib = imports.gi.GLib;
const St = imports.gi.St;
const uuid = "devTools@scollins";
let Tab;
if (typeof require !== 'undefined') {
    Tab = require('./tab');
} else {
    const DeskletDir = imports.ui.deskletManager.desklets[uuid];
    Tab = DeskletDir.tab;
}
const Gettext = imports.gettext;
Gettext.bindtextdomain(uuid, GLib.get_home_dir() + "/.local/share/locale")

function _(str) {
  return Gettext.dgettext(uuid, str);
}

function TabPanelBase(canClose) {
    this._init(canClose);
}

TabPanelBase.prototype = {
    __proto__: Tab.TabItemBase.prototype,
    
    name: _("Untitled"),
    
    _init: function(canClose) {
        Tab.TabItemBase.prototype._init.call(this, { canClose: canClose, styleClass: "devtools-tab" });
        
        this.panel = new St.BoxLayout({ style_class: "devtools-panel", vertical: true });
        this.setContent(this.panel);
        
        let label = new St.Label({ text: this.name });
        this.setTabContent(label);
    },
    
    _formatTime: function(d) {
        function pad(n) { return n < 10 ? "0" + n : n; }
        return (d.getMonth()+1)+"/"
            + pad(d.getDate())+" "
            + (d.getHours())+":"
            + pad(d.getMinutes())+":"
            + pad(d.getSeconds())+"  ";
    }
}

