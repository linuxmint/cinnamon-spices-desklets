const Main = imports.ui.main;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Clutter = imports.gi.Clutter;
const Tweener = imports.ui.tweener;
const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Tooltips = imports.ui.tooltips;
const Soup = imports.gi.Soup
const DeskletManager = imports.ui.deskletManager;

let DIRECTORY_PICTURES = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);

function invertbrightness(rgb) {
    rgb = Array.prototype.join.call(arguments).match(/(-?[0-9\.]+)/g);
    let brightness = 255 * 3
    for (var i = 0; i < rgb.length && i < 3; i++) {
        brightness -= rgb[i];
    }
    if (brightness > 255 * 1.5)
        return '255, 255, 255';
    return '0, 0, 0';
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata);

        this.session = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(this.session, new Soup.ProxyResolverDefault());

        this.actor.text_direction = Clutter.TextDirection.RTL;
        this.box = new St.BoxLayout({ vertical: true });

        this.verse = new St.Label({
            style_class: "desklet-label",
            text_direction: Clutter.TextDirection.RTL
        });

        this.poet = new St.Label({
            reactive: true,
            style_class: "desklet-label",
            text_direction: Clutter.TextDirection.RTL,
            opacity: 100
        });

        this.poet.connect('motion-event', Lang.bind(this, function() {
            if (this._cursorChanged || !this.poet.link)
                return;
            global.set_cursor(Cinnamon.Cursor.POINTING_HAND);
            this.actor.reactive = false;
            this._cursorChanged = true;
        }));

        this.poet.connect('leave-event', Lang.bind(this, function() {
            if (this._cursorChanged) {
                this._cursorChanged = false;
                global.unset_cursor();
                this.actor.reactive = true;
            }
        }));

        this.poet.connect('button-release-event', Lang.bind(this, function() {
            if (this.poet.link)
                Gio.app_info_launch_default_for_uri(this.poet.link, global.create_app_launch_context());
            return true;
        }));

        this.box.add(this.verse);
        this.box.add(this.poet);
        this.setContent(this.box);
        this.setHeader("گنجینه");

        this.actor.effect = new Clutter.DesaturateEffect({ factor: 0 });

        this.settings = new Settings.DeskletSettings(this, this.metadata["uuid"], desklet_id);

        this.settings.bind("font", "font", this._onSettingsChanged);
        this.settings.bind("text-color", "color", this._onSettingsChanged);
        this.settings.bind("decoration", "show_decoration", this._onSettingsChanged);
        this.settings.bind("interval-minutes", "interval", this._onIntervalChanged);
        this.settings.bind("limit-poems", "limited", this._updateBeyt);
        this.settings.bind("selected-poet", "selected_poet", this._updateBeyt);
        this.settings.bind("x-l", "XL", null);
        this.settings.bind("poem-history", "PoemHistory", null);

        this._clipboard = St.Clipboard.get_default();

        let openLinkMenuItem = new PopupMenu.PopupIconMenuItem("View on ganjoor.net", "web-browser", St.IconType.SYMBOLIC);
        openLinkMenuItem.connect('activate', Lang.bind(this, function(menuItem, event) {
            if (this.poet.link)
                Gio.app_info_launch_default_for_uri(this.poet.link, global.create_app_launch_context());
        }));

        let previousPoemMenuItem = new PopupMenu.PopupIconMenuItem("Previous", "go-previous", St.IconType.SYMBOLIC);
        previousPoemMenuItem.connect('activate', Lang.bind(this, function(menuItem, event) {
            if (this.history.length) {
                if (this.timeout)
                    Mainloop.source_remove(this.timeout);
                this.prev = null;
                this.setText(this.history.pop(), false);
            }
        }));

        let copyMenuItem = new PopupMenu.PopupIconMenuItem("Copy", "edit-copy", St.IconType.SYMBOLIC);
        copyMenuItem.connect('activate', Lang.bind(this, function(menuItem, event) {
            this._clipboard.set_text(this.verse.text + '\n' + this.poet.poetname);
        }));

        let copyLinkMenuItem = new PopupMenu.PopupIconMenuItem("Copy link", "insert-link", St.IconType.SYMBOLIC);
        copyLinkMenuItem.connect('activate', Lang.bind(this, function(menuItem, event) {
            this._clipboard.set_text(this.poet.link);
        }));

        let takeShotMenuItem = new PopupMenu.PopupIconMenuItem("Take screenshot", "image-x-generic", St.IconType.SYMBOLIC);
        takeShotMenuItem.connect('activate', Lang.bind(this, this.takeScreenShot));

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 0);
        this._menu.addMenuItem(takeShotMenuItem, 0);
        this._menu.addMenuItem(copyLinkMenuItem, 0);
        this._menu.addMenuItem(copyMenuItem, 0);
        this._menu.addMenuItem(previousPoemMenuItem, 0);
        this._menu.addMenuItem(openLinkMenuItem, 0);

        this.history = [];

        this._draggable.connect('drag-end', Lang.bind(this, this._onPositionChanged));
        this._onSettingsChanged();
        this.timeout = 0;
        this._updateBeyt();
        global.ltg = this;
    },

    on_desklet_clicked: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
        this._updateBeyt();
    },

    _onPositionChanged: function() {
        this.XL = this.actor.x + this.actor.width / 2;
    },

    _onSettingsChanged: function() {
        let fontprep = this.font.split(' ');
        let fontsize = fontprep.pop();
        let fontweight = '';
        let fontstyle = '';
        let fontname = fontprep.join(' ').replace(/,/g, ' ');
        ['Italic', 'Oblique'].forEach(function(item, i) {
            if (fontname.contains(item)) {
                fontstyle = item;
                fontname = fontname.replace(item, '');
            }
        });

        ['Bold', 'Light', 'Medium', 'Heavy'].forEach(function(item, i) {
            if (fontname.contains(item)) {
                fontweight = item;
                fontname = fontname.replace(item, '');
            }
        });

        this.verse.style = ("font-family: " + fontname + ", Amiri, IranNastaliq, Noto Nastaliq Urdu, Noto Naskh Arabic; " +
            "text-align: center;" +
            "font-size: " + fontsize + "pt; " +
            (fontstyle ? "font-style: " + fontstyle + "; " : "") +
            (fontweight ? "font-weight: " + fontweight + "; " : "") +
            "color: " + this.color + "; " +
            "text-shadow: " + "0px 1px 6px rgba(" + invertbrightness(this.color) + ", 0.2); " +
            "padding: 10px 20px;").toLowerCase();

        this.poet.style = ("font-family: Noto Naskh Arabic;" +
            "text-align: center;" +
            "font-size: " + (fontsize / 2.5) + "pt;" +
            "color: " + this.color + ";" +
            "text-shadow: " + "0px 1px 6px rgba(" + invertbrightness(this.color) + ", 0.2);").toLowerCase();

        this.metadata['prevent-decorations'] = !this.show_decoration;
        this._updateDecoration();
    },

    _onIntervalChanged: function() {
        if (this.timeout) {
            Mainloop.source_remove(this.timeout);
        }
        this.timeout = Mainloop.timeout_add_seconds(this.interval * 60, Lang.bind(this, this._updateBeyt));
    },

    on_desklet_removed: function() {
        Mainloop.source_remove(this.timeout);
        this.settings.finalize();
    },

    _updateBeyt: function() {
        let url = 'http://c.ganjoor.net/beyt.php?a=1';
        if (this.limited)
            url += '&p=' + this.selected_poet;
        this.request = Soup.Message.new('GET', url);
        this.session.queue_message(this.request, Lang.bind(this, this._get_data));
    },

    _get_data: function(session, response) {
        let html = response.response_body.data;
        if (html != null && html.contains("ganjoor-m1")) {
            let lines = html.split('\n');
            this.abyat = [];
            let poetname = '';
            let poemlink = '';
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].contains('-m1') || lines[i].contains('-m2'))
                    this.abyat.push(lines[i].substring(lines[i].indexOf('>') + 1, lines[i].lastIndexOf('<')));
                if (lines[i].contains('ganjoor-poet')) {
                    let href_st = lines[i].indexOf('<a href="') + 9;
                    let href_end = lines[i].indexOf('"', href_st);
                    poemlink = lines[i].substring(href_st, href_end);
                    let name_st = lines[i].indexOf('>', href_st) + 1;
                    let name_end = lines[i].indexOf('<', name_st);
                    poetname = lines[i].substring(name_st, name_end);
                }
            }

            let text = '';
            if (this.abyat.length == 2)
                text = this.abyat.join('\n');
            else if (this.abyat.length == 4)
                text = this.abyat[0] + '\t\t' + this.abyat[1] + '\n' + this.abyat[2] + '\t\t' + this.abyat[3];
            text = text + '||' + poetname + '||' + poemlink;
            this.setText(text, true);

            if (this.PoemHistory.length > 99)
                this.PoemHistory.splice(Math.floor(Math.random() * this.PoemHistory.length), this.PoemHistory.length - 99);
            this.PoemHistory.push(text);
            this.settings._saveToFile();
        } else {
            this.setText(this.PoemHistory[Math.floor(Math.random() * this.PoemHistory.length)], false);
        }
    },

    setText: function(verse_data, isnew) {
        let sp = verse_data.split('||');

        Tweener.addTween(this.actor, {
            opacity: 0,
            time: 0.750,
            transition: "easeOutExpo",
            onComplete: Lang.bind(this, function() {
                this.poet.link = null;
                this.poet.set_text('');
                this.verse.set_text('');
                this.verse.set_text(sp[0]);
                if (sp[1]) {
                    this.poet.set_text('.........................  ' + sp[1] + '  .........................');
                    this.poet.poetname = sp[1];
                }
                if (sp[2])
                    this.poet.link = sp[2];

                this.actor.x = this.XL - this.actor.width / 2;

                Tweener.addTween(this.actor, {
                    opacity: isnew ? 255 : 180,
                    time: 0.750,
                    transition: "easeOutExpo"
                });
            })

        });

        if (this.prev)
            this.history.push(this.prev);
        this.prev = verse_data;

        this.timeout = Mainloop.timeout_add_seconds(this.interval * 60, Lang.bind(this, this._updateBeyt));
    },

    takeScreenShot: function(menuItem, event) {
        let screenshot = new Cinnamon.Screenshot();
        let padding = 100;
        let x = this.actor.x - 1.5 * padding;
        let y = this.actor.y - 1.3 * padding;
        let w = this.actor.width + 3 * padding;
        let h = this.actor.height + 3 * padding;

        let xwmax = this.actor.get_parent().get_parent().width;
        let yhmax = this.actor.get_parent().get_parent().height;

        if (x < 0) {
            w += 2 * x;
            x = 0;
        }
        if (y < 0) {
            h += 2 * y;
            y = 0;
        }
        if (x + w > xwmax) {
            x -= xwmax - (w + x);
            w = xwmax - x;
        }
        if (y + h > yhmax) {
            y -= Math.floor(1.3 / 1.5 * (yhmax - (h + y)));
            h = yhmax - y;
        }

        let filename = DIRECTORY_PICTURES + '/g-' + this.poet.link.substr(20).replaceAll('/', '-') + Math.random() + '.png';
        this.actor.origopacity = this.actor.opacity;
        this.actor.opacity = 255;
        global.window_group.opacity = 0;
        global.bottom_window_group.opacity = 0;
        Main.panelManager.getPanels().forEach(function(panel, i) {
            if (panel) panel.actor.opacity = 0;
        });
        screenshot.screenshot_area(false, x, y, w, h, filename, Lang.bind(this, function() {
            global.window_group.opacity = 255;
            global.bottom_window_group.opacity = 255;
            Main.panelManager.getPanels().forEach(function(panel, i) {
                if (panel) panel.actor.opacity = 255;
            });
            this.actor.opacity = this.actor.origopacity;
            Gio.app_info_launch_default_for_uri('file://' + filename, global.create_app_launch_context());
        }));

    }
}

function main(metadata, desklet_id) {
    let desklet = new MyDesklet(metadata, desklet_id);
    return desklet;
}
