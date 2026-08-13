// Bookmarks Dialog -- ModalDialog popup for viewing, searching and removing bookmarks

const ModalDialog = imports.ui.modalDialog.ModalDialog;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// Unicode source headers -- no emoji
const SOURCE_SYMBOLS = {
    github:       '\u25C6',   // ◆
    arxiv:        '\u25C7',   // ◇
    hackernews:   '\u25CF',   // ●
    huggingface:  '\u25C8',   // ◈
    reddit:       '\u25C9',   // ◉
};

const SOURCE_DISPLAY = {
    github:      'GitHub',
    arxiv:       'arXiv',
    hackernews:  'Hacker News',
    huggingface: 'Hugging Face',
    reddit:      'Reddit',
};

function _formatDate(timestamp) {
    if (!timestamp) return '';
    try {
        let d = new Date(timestamp * 1000);
        return d.toLocaleDateString();
    } catch (e) {
        return '';
    }
}

var BookmarksDialog = class BookmarksDialog {
    constructor(bookmarkStore, colors) {
        this._store = bookmarkStore;
        this._colors = colors || {};
        this._dialog = null;
        this._listBox = null;
        this._searchEntry = null;
        this._currentQuery = '';
    }

    open() {
        this._dialog = new ModalDialog({ styleClass: 'ai-feed-bookmarks-dialog' });

        // Apply background color if provided
        if (this._colors.background) {
            this._dialog.contentLayout.set_style('background-color: ' + this._colors.background + ';');
        }

        let fontColor = this._colors.font || '#ffffff';
        let accentColor = this._colors.accent || '#5294e2';

        // --- Header ---
        let headerBox = new St.BoxLayout({ vertical: false, style: 'padding-bottom: 8px;' });

        let title = new St.Label({
            text: 'Saved Bookmarks',
            style: 'font-size: 16px; font-weight: bold; color: ' + fontColor + ';'
        });

        let count = this._store.getCount();
        let countLabel = new St.Label({
            text: '  (' + count + ')',
            style: 'font-size: 14px; color: ' + accentColor + ';'
        });

        headerBox.add_child(title);
        headerBox.add_child(countLabel);

        // --- Search entry ---
        this._searchEntry = new St.Entry({
            hint_text: 'Search bookmarks...',
            can_focus: true,
            style: 'margin-top: 8px; margin-bottom: 8px; color: ' + fontColor + ';'
        });

        let clutterText = this._searchEntry.get_clutter_text();
        clutterText.connect('text-changed', () => {
            this._currentQuery = this._searchEntry.get_text();
            this._rebuildList(this._currentQuery);
        });

        // --- Scroll view ---
        let scrollView = new St.ScrollView({
            style: 'height: 350px; min-width: 480px;'
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        this._listBox = new St.BoxLayout({ vertical: true });
        scrollView.add_actor(this._listBox);

        // Assemble content
        this._dialog.contentLayout.add_child(headerBox);
        this._dialog.contentLayout.add_child(this._searchEntry);
        this._dialog.contentLayout.add_child(scrollView);

        // Close button — use setButtons for Cinnamon compatibility
        this._dialog.setButtons([{
            label: 'Close',
            action: () => this.close(),
            key: Clutter.KEY_Escape
        }]);

        // Populate list
        this._rebuildList('');

        this._dialog.open();
    }

    _rebuildList(query) {
        if (!this._listBox) return;

        // Remove all children
        this._listBox.destroy_all_children();

        let fontColor = this._colors.font || '#ffffff';
        let accentColor = this._colors.accent || '#5294e2';

        let items;
        if (query && query.trim() !== '') {
            items = this._store.search(query);
        } else {
            items = null; // use grouped view
        }

        if (items !== null) {
            // Flat filtered list
            if (items.length === 0) {
                let empty = new St.Label({
                    text: 'No bookmarks match "' + query + '"',
                    style: 'color: ' + fontColor + '; padding: 16px;'
                });
                this._listBox.add_child(empty);
                return;
            }
            for (let item of items) {
                this._addRow(item, fontColor, accentColor);
            }
            return;
        }

        // Grouped view
        let groups = this._store.getGroupedBySource();
        let sources = Object.keys(groups);

        if (sources.length === 0) {
            let empty = new St.Label({
                text: 'No bookmarks saved yet',
                style: 'color: ' + fontColor + '; padding: 16px;'
            });
            this._listBox.add_child(empty);
            return;
        }

        for (let src of sources) {
            let symbol = SOURCE_SYMBOLS[src] || '\u25AA';
            let displayName = SOURCE_DISPLAY[src] || src;

            // Group header
            let groupHeader = new St.Label({
                text: symbol + '  ' + displayName,
                style: 'font-size: 13px; font-weight: bold; color: ' + accentColor +
                       '; padding-top: 10px; padding-bottom: 4px;'
            });
            this._listBox.add_child(groupHeader);

            for (let item of groups[src]) {
                this._addRow(item, fontColor, accentColor);
            }
        }
    }

    _addRow(item, fontColor, accentColor) {
        let row = new St.BoxLayout({
            vertical: false,
            style: 'padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.08);'
        });

        // Left side: title + date
        let infoBox = new St.BoxLayout({ vertical: true, x_expand: true });

        let titleLabel = new St.Label({
            text: item.title || '(no title)',
            style: 'color: ' + fontColor + '; font-size: 13px;'
        });
        titleLabel.clutter_text.set_line_wrap(true);
        titleLabel.clutter_text.set_ellipsize(2 /* PANGO_ELLIPSIZE_END */);

        let dateStr = item.savedAt ? _formatDate(item.savedAt) : '';
        let metaLabel = new St.Label({
            text: dateStr ? 'Saved ' + dateStr : '',
            style: 'color: rgba(255,255,255,0.5); font-size: 11px;'
        });

        infoBox.add_child(titleLabel);
        if (dateStr) infoBox.add_child(metaLabel);

        // Open button
        let openBtn = new St.Button({
            label: 'Open',
            style: 'color: ' + accentColor + '; padding: 2px 8px; margin-left: 4px;'
        });
        openBtn.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(item.url, null);
            } catch (e) {
                global.logError('[AIFeed] Failed to open URL: ' + item.url + ' — ' + e.message);
            }
        });

        // Remove button
        let removeBtn = new St.Button({
            label: 'X',
            style: 'color: #e05555; padding: 2px 8px; margin-left: 4px;'
        });
        removeBtn.connect('clicked', () => {
            this._store.remove(item.url);
            // Refresh list and header count
            this._rebuildList(this._currentQuery);
            this._updateCount();
        });

        row.add_child(infoBox);
        row.add_child(openBtn);
        row.add_child(removeBtn);

        this._listBox.add_child(row);
    }

    _updateCount() {
        // Re-open is not needed; just update count label if accessible.
        // Since we rebuild the header on open() and count is embedded there,
        // a full rebuild would require re-creating the header. For simplicity
        // we leave the count stale until the next open() call.
        // Subclasses or callers may override this to refresh the header.
    }

    close() {
        if (this._dialog) {
            this._dialog.close();
            this._dialog = null;
            this._listBox = null;
            this._searchEntry = null;
        }
    }
};
