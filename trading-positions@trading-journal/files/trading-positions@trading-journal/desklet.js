// Trading Positions Desklet
// Shows open positions from the Crypto Trading Journal
// Requires: Cinnamon 5.0+

const Desklet   = imports.ui.desklet;
const St        = imports.gi.St;
const GLib      = imports.gi.GLib;
const Gio       = imports.gi.Gio;
const Mainloop  = imports.mainloop;
const Settings  = imports.ui.settings;
const Gettext   = imports.gettext;

// Soup version detection: Cinnamon < 5.8 uses Soup 2, newer ones Soup 3
let Soup;
try {
    imports.gi.versions.Soup = '3.0';
    Soup = imports.gi.Soup;
    var SOUP_VERSION = 3;
} catch(e) {
    Soup = imports.gi.Soup;
    var SOUP_VERSION = 2;
}

const UUID         = "trading-positions@trading-journal";
const APP_NAME     = "Crypto Trading Journal";

// --- Translation support -------------------------------------------------
Gettext.bindtextdomain(UUID, GLib.get_user_data_dir() + "/locale");

function _(str) {
    let translation = Gettext.dgettext(UUID, str);
    if (translation !== str && translation !== "") return translation;
    return Gettext.gettext(str);
}

class TradingPositionsDesklet extends Desklet.Desklet {

    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this._metadata = metadata;

        // Settings
        this._settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this._settings.bind("server-host",      "serverHost",      this._onSettingChanged.bind(this));
        this._settings.bind("server-port",      "serverPort",      this._onSettingChanged.bind(this));
        this._settings.bind("api-key",          "apiKey",          this._onSettingChanged.bind(this));
        this._settings.bind("refresh-interval", "refreshInterval", this._onSettingChanged.bind(this));
        this._settings.bind("show-leverage",    "showLeverage",    this._onSettingChanged.bind(this));
        this._settings.bind("show-mark-price",  "showMarkPrice",   this._onSettingChanged.bind(this));
        this._settings.bind("show-realized-pnl","showRealizedPnl", this._onSettingChanged.bind(this));
        this._settings.bind("show-bots",        "showBots",        this._onSettingChanged.bind(this));
        this._settings.bind("show-github-link", "showGithubLink",  this._onFooterChanged.bind(this));
        this._settings.bind("font-size",        "fontSize",        this._onStyleChanged.bind(this));
        this._settings.bind("font-size-ui",    "fontSizeUi",      this._onStyleChanged.bind(this));
        this._settings.bind("bg-opacity",       "bgOpacity",       this._onStyleChanged.bind(this));
        this._settings.bind("min-width",        "minWidth",        this._onStyleChanged.bind(this));

        this._cookieAcquired = false;
        this._timeoutId      = null;
        this._appVersion     = null;

        this._initSoup();
        this._buildUI();
        this._applyStyle();
        this._startPolling();
    }

    get _baseUrl() {
        let host = (this.serverHost || 'localhost').trim();
        return `http://${host}:${this.serverPort}`;
    }

    // ------------------------------------------------------------------ Style

    _applyStyle() {
        let opacity = Math.max(0, Math.min(100, this.bgOpacity ?? 88)) / 100;
        let fs      = this.fontSize    ?? 12;
        let fsUi    = this.fontSizeUi  ?? 11;
        let mw      = this.minWidth    ?? 480;
        this._outer.set_style(
            `background-color: rgba(15,20,28,${opacity.toFixed(2)});` +
            `min-width: ${mw}px;`
        );
        // Scaling factor for column widths (base: fs=12)
        let scale = fs / 12;
        this._colWidths = {
            symbol:   Math.round(90  * scale),
            side:     Math.round(55  * scale),
            leverage: Math.round(36  * scale),
            price:    Math.round(78  * scale),
            pnl:      Math.round(95  * scale),
            realized: Math.round(85  * scale),
        };
        // Positions
        this._posFs        = fs;
        // UI elements (title, footer, total, header)
        this._headerFs     = fs;  // header same size as positions
        this._titleStyle   = `font-size: ${fsUi + 3}px;`;
        this._subtitleStyle = `font-size: ${fsUi}px;`;
        this._totalStyle   = `font-size: ${fsUi}px;`;  // same as subtitle
        this._footerStyle  = `font-size: ${Math.max(8, fsUi - 1)}px;`;
    }

    _onStyleChanged() {
        this._applyStyle();
        // Update static UI elements
        if (this._titleLabel)    this._titleLabel.set_style(this._titleStyle);
        if (this._subtitleLabel) this._subtitleLabel.set_style(this._subtitleStyle);
        if (this._footerTime)    this._footerTime.set_style(this._footerStyle);
        if (this._footerRight)   this._footerRight.set_style(this._footerStyle);
        // Re-render so the position font size takes effect immediately
        this._refresh();
    }

    // ------------------------------------------------------------------ Soup

    _initSoup() {
        if (SOUP_VERSION === 3) {
            this._session = new Soup.Session();
            this._session.add_feature(new Soup.CookieJar());
        } else {
            this._session = new Soup.SessionAsync();
            this._session.add_feature(new Soup.CookieJar());
        }
    }

    _soupGet(url, callback, headers) {
        if (SOUP_VERSION === 3) {
            let msg = Soup.Message.new('GET', url);
            if (headers) {
                let h = msg.get_request_headers();
                for (let name in headers) h.append(name, headers[name]);
            }
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    let bytes  = session.send_and_read_finish(result);
                    let status = msg.get_status();
                    let body   = bytes ? new TextDecoder().decode(bytes.get_data()) : '';
                    callback(status, body);
                } catch(e) {
                    global.logError('[' + UUID + '] soup GET ' + url + ': ' + e.message);
                    callback(0, '');
                }
            });
        } else {
            let msg = Soup.Message.new('GET', url);
            if (headers) {
                for (let name in headers) msg.request_headers.append(name, headers[name]);
            }
            this._session.queue_message(msg, (session, response) => {
                let status = response.status_code;
                let body   = response.response_body ? response.response_body.data : '';
                callback(status, body);
            });
        }
    }

    // ------------------------------------------------------------------ UI

    _buildUI() {
        // Outer frame
        let outer = new St.BoxLayout({ vertical: true, style_class: 'trading-desklet' });
        this._outer = outer;
        this.setContent(outer);

        // --- Logo-Header ---
        let headerRow = new St.BoxLayout({ style_class: 'desklet-header-row' });

        // Logo
        let iconPath = this._metadata.path + '/icon.png';
        try {
            let gicon = Gio.icon_new_for_string(iconPath);
            let logo  = new St.Icon({ gicon: gicon, icon_size: 42, style_class: 'desklet-logo' });
            headerRow.add_child(logo);
        } catch(_) {}

        // Title
        let titleBox = new St.BoxLayout({ vertical: true, style_class: 'desklet-title-box' });
        this._titleLabel    = new St.Label({ text: APP_NAME, style_class: 'desklet-title' });
        this._subtitleLabel = new St.Label({ text: _('Open positions & bots'), style_class: 'desklet-subtitle' });
        titleBox.add_child(this._titleLabel);
        titleBox.add_child(this._subtitleLabel);
        headerRow.add_child(titleBox);
        outer.add_child(headerRow);

        // Separator after header
        outer.add_child(new St.Label({ text: '\u2500'.repeat(44), style_class: 'separator' }));

        // --- Content area (positions / status) ---
        this._content = new St.BoxLayout({ vertical: true, style_class: 'desklet-content' });
        outer.add_child(this._content);

        // --- Footer ---
        outer.add_child(new St.Label({ text: '\u2500'.repeat(44), style_class: 'separator' }));
        let footer = new St.BoxLayout({ style_class: 'desklet-footer' });
        this._footerTime  = new St.Label({ text: '', style_class: 'footer-time' });
        this._footerRight = new St.Label({ text: '', style_class: 'footer-right' });
        this._updateFooterRight();
        footer.add_child(this._footerTime);
        let spacer = new St.Widget({ x_expand: true });
        footer.add_child(spacer);
        footer.add_child(this._footerRight);
        outer.add_child(footer);

        this._showStatus(_("Connecting…"));
    }

    // ------------------------------------------------------------------ Polling

    _startPolling() {
        this._stopPolling();
        this._refresh();
        this._timeoutId = Mainloop.timeout_add_seconds(this.refreshInterval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _refresh() {
        this._fetchDisplay();
    }

    // Single read-only call to the public, key-authenticated endpoint
    // (X-ESP32-Key header — no session cookie). Works even with the journal's
    // optional password gate enabled. Returns futures (openPositions) + bots.
    _fetchDisplay() {
        if (!this.apiKey) {
            this._showStatus(_("No API key set.\nEnter it in the desklet settings."));
            return;
        }
        this._soupGet(this._baseUrl + '/api/esp32/display', (status, body) => {
            if (status === 401) {
                this._showStatus(_("Invalid API key (401)"));
                return;
            }
            if (status !== 200) {
                this._showStatus(_("Server not reachable") + `\n${this.serverHost}:${this.serverPort}`);
                return;
            }
            let data;
            try {
                data = JSON.parse(body);
            } catch(e) {
                this._showStatus(_("Parse error:") + "\n" + e.message);
                return;
            }
            this._futures = data.openPositions || [];
            let bots = (this.showBots !== false) ? (data.bots || []) : [];
            this._renderAll(this._futures, bots);
            this._updateFooterTime();
        }, { 'X-ESP32-Key': this.apiKey });
    }

    _updateFooterTime() {
        let now = new Date();
        let hh  = String(now.getHours()).padStart(2, '0');
        let mm  = String(now.getMinutes()).padStart(2, '0');
        let ss  = String(now.getSeconds()).padStart(2, '0');
        if (this._footerTime) {
            this._footerTime.set_text(_("Updated: %s").format(`${hh}:${mm}:${ss}`));
        }
    }

    _updateFooterRight() {
        if (!this._footerRight) return;
        let text = this._appVersion ? `v${this._appVersion}` : '';
        if (this.showGithubLink !== false) {
            if (text) text += '  \u2022  ';
            text += 'github.com/Mouses007/Crypto-Trading-Journal';
        }
        this._footerRight.set_text(text);
    }

    _onFooterChanged() {
        this._updateFooterRight();
    }

    // ------------------------------------------------------------------ Render

    _renderAll(positions, bots) {
        this._content.destroy_all_children();

        positions = positions || [];
        bots      = bots || [];

        if (positions.length === 0 && bots.length === 0) {
            this._content.add_child(
                new St.Label({ text: _("No open positions"), style_class: 'no-positions-label' })
            );
            return;
        }

        if (positions.length > 0) this._renderFuturesSection(positions);

        if (bots.length > 0) {
            if (positions.length > 0) {
                this._content.add_child(new St.Label({ text: '─'.repeat(44), style_class: 'separator-thin' }));
            }
            this._renderBotSection(bots);
        }
    }

    _renderFuturesSection(positions) {
        // Total PnL
        let totalPnl   = positions.reduce((sum, p) => sum + (parseFloat(p.unrealizedPNL) || 0), 0);
        let totalClass = totalPnl >= 0 ? 'pnl-profit' : 'pnl-loss';
        let totalSign  = totalPnl >= 0 ? '+' : '';
        let totalRow   = new St.BoxLayout({ style_class: 'total-row' });
        let posWord = positions.length === 1 ? _("position") : _("positions");
        let totalLbl = new St.Label({
            text: _("Total:") + `  ${totalSign}${totalPnl.toFixed(2)} USDT   (${positions.length} ${posWord})`,
            style_class: 'total-label ' + totalClass
        });
        if (this._totalStyle) totalLbl.set_style(this._totalStyle);
        totalRow.add_child(totalLbl);
        this._content.add_child(totalRow);
        this._content.add_child(new St.Label({ text: '\u2500'.repeat(44), style_class: 'separator-thin' }));

        // Header row — same column widths as the position rows
        let headerCells = [
            { text: _('Symbol'), width: this._colWidths.symbol },
            { text: _('Side'),   width: this._colWidths.side },
        ];
        if (this.showLeverage)  headerCells.push({ text: _('Lvg'),  width: this._colWidths.leverage });
        headerCells.push({ text: _('Entry'), width: this._colWidths.price });
        if (this.showMarkPrice) headerCells.push({ text: _('Mark'), width: this._colWidths.price });
        headerCells.push({ text: _('unr. PnL'), width: this._colWidths.pnl });
        if (this.showRealizedPnl !== false) headerCells.push({ text: _('real. PnL'), width: this._colWidths.realized });
        this._content.add_child(this._makeHeaderRow(headerCells));

        for (let pos of positions) {
            this._content.add_child(this._makePositionRow(pos));
        }
    }

    // Dedicated section for running Pionex bots. PnL/margin is in the
    // respective margin coin (e.g. SOL for Coin-M) — therefore NO USDT total
    // (coins are not summable), just the count + liquidation price per bot.
    _renderBotSection(bots) {
        let titleRow = new St.BoxLayout({ style_class: 'total-row' });
        let titleLbl = new St.Label({
            text: _("Bots:") + `  ${bots.length} ` + _("running"),
            style_class: 'total-label'
        });
        if (this._totalStyle) titleLbl.set_style(this._totalStyle);
        titleRow.add_child(titleLbl);
        this._content.add_child(titleRow);
        this._content.add_child(new St.Label({ text: '─'.repeat(44), style_class: 'separator-thin' }));

        let headerCells = [
            { text: _('Symbol'), width: this._colWidths.symbol },
            { text: _('Side'),   width: this._colWidths.side },
        ];
        if (this.showLeverage) headerCells.push({ text: _('Lvg'), width: this._colWidths.leverage });
        headerCells.push({ text: _('Ø Entry'), width: this._colWidths.price });
        headerCells.push({ text: _('Liq'),     width: this._colWidths.price });
        headerCells.push({ text: _('PnL'),     width: this._colWidths.pnl });
        this._content.add_child(this._makeHeaderRow(headerCells));

        for (let bot of bots) {
            this._content.add_child(this._makeBotRow(bot));
        }
    }

    _makeBotRow(pos) {
        let coin     = pos.marginCoin || 'USDT';
        let dec      = coin === 'USDT' ? 2 : 4;
        let pnl      = parseFloat(pos.unrealizedPNL) || 0;
        let isProfit = pnl >= 0;
        let pnlClass = isProfit ? 'pnl-profit' : 'pnl-loss';
        let pnlText  = (isProfit ? '+' : '') + pnl.toFixed(dec) + ' ' + coin;
        let sideLower = (pos.side || '').toLowerCase();
        let sideClass = (sideLower === 'long' || sideLower === 'buy') ? 'side-long'
                      : (sideLower === 'neutral') ? 'side-neutral' : 'side-short';

        let liq = pos.liqPrice;
        if (!liq && pos.bitunixData) {
            try {
                let bd = typeof pos.bitunixData === 'string' ? JSON.parse(pos.bitunixData) : pos.bitunixData;
                liq = bd.liqPrice || null;
            } catch(e) {
                global.logError('[' + UUID + '] bot bitunixData parse: ' + e.message);
            }
        }

        let fmt = (v) => {
            if (!v) return '-';
            let n = parseFloat(v);
            if (isNaN(n)) return '-';
            return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
                 : n >= 1    ? n.toFixed(4)
                             : n.toFixed(6);
        };

        let cw = this._colWidths;
        let cells = [
            { text: pos.symbol || '-', cls: 'symbol-cell',            width: cw.symbol },
            { text: pos.side   || '-', cls: 'side-cell ' + sideClass, width: cw.side },
        ];
        if (this.showLeverage) cells.push({ text: (pos.leverage ? pos.leverage + 'x' : '-'), cls: 'leverage-cell', width: cw.leverage });
        cells.push({ text: fmt(pos.entryPrice), cls: 'price-cell', width: cw.price });
        cells.push({ text: fmt(liq),            cls: 'price-cell', width: cw.price });
        cells.push({ text: pnlText, cls: 'pnl-cell ' + pnlClass, width: cw.pnl });

        let fs  = this._posFs || 12;
        let row = new St.BoxLayout({ style_class: 'position-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: c.cls });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _makePositionRow(pos) {
        let pnl       = parseFloat(pos.unrealizedPNL) || 0;
        let isProfit  = pnl >= 0;
        let pnlClass  = isProfit ? 'pnl-profit' : 'pnl-loss';
        let pnlText   = (isProfit ? '+' : '') + pnl.toFixed(2) + ' USDT';
        let sideLower = (pos.side || '').toLowerCase();
        let sideClass = (sideLower === 'long' || sideLower === 'buy') ? 'side-long'
                      : (sideLower === 'neutral') ? 'side-neutral' : 'side-short';

        let markPrice = pos.markPrice;
        if (!markPrice && pos.bitunixData) {
            try {
                let bd = typeof pos.bitunixData === 'string' ? JSON.parse(pos.bitunixData) : pos.bitunixData;
                markPrice = bd.markPrice || bd.liqPrice || null;
            } catch(e) {
                global.logError('[' + UUID + '] bitunixData parse: ' + e.message);
            }
        }

        let fmt = (v) => {
            if (!v) return '-';
            let n = parseFloat(v);
            if (isNaN(n)) return '-';
            return n >= 1000 ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
                 : n >= 1    ? n.toFixed(4)
                             : n.toFixed(6);
        };

        let cw = this._colWidths;
        let cells = [
            { text: pos.symbol || '-', cls: 'symbol-cell',            width: cw.symbol },
            { text: pos.side   || '-', cls: 'side-cell ' + sideClass, width: cw.side },
        ];
        if (this.showLeverage)  cells.push({ text: (pos.leverage ? pos.leverage + 'x' : '-'), cls: 'leverage-cell', width: cw.leverage });
        cells.push({ text: fmt(pos.entryPrice), cls: 'price-cell', width: cw.price });
        if (this.showMarkPrice) cells.push({ text: fmt(markPrice), cls: 'price-cell', width: cw.price });
        cells.push({ text: pnlText, cls: 'pnl-cell ' + pnlClass, width: cw.pnl });

        if (this.showRealizedPnl !== false) {
            let realized = parseFloat(
                pos.realizedPNL ?? pos.realized_pnl ?? pos.realizedPnl ?? pos.realizedPL ?? 0
            ) || 0;
            let realClass = realized >= 0 ? 'pnl-profit' : 'pnl-loss';
            let realText  = (realized >= 0 ? '+' : '') + realized.toFixed(2) + ' USDT';
            cells.push({ text: realText, cls: 'pnl-cell ' + realClass, width: cw.realized });
        }

        let fs  = this._posFs || 12;
        let row = new St.BoxLayout({ style_class: 'position-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: c.cls });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _makeHeaderRow(cells) {
        let fs  = this._headerFs || 12;
        let row = new St.BoxLayout({ style_class: 'header-row' });
        for (let c of cells) {
            let lbl = new St.Label({ text: c.text, style_class: 'header-cell' });
            lbl.set_style(`font-size: ${fs}px; min-width: ${c.width}px;`);
            row.add_child(lbl);
        }
        return row;
    }

    _showStatus(text) {
        this._content.destroy_all_children();
        this._content.add_child(new St.Label({ text, style_class: 'status-label' }));
    }

    // ------------------------------------------------------------------ Lifecycle

    _onSettingChanged() {
        this._cookieAcquired = false;
        this._appVersion     = null;  // server change → fetch version again
        this._startPolling();
    }

    on_desklet_removed() {
        this._stopPolling();
    }
}

function main(metadata, desklet_id) {
    return new TradingPositionsDesklet(metadata, desklet_id);
}
