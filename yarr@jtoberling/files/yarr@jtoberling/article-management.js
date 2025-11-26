const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

const Logger = require('./logger');

/**
 * Article Management Module
 * Handles article operations, adding, and cleanup
 */

class ArticleManagement {
    constructor(desklet) {
        this.desklet = desklet;
    }

    additems(context, itemobj) {
        try {
            // Generate unique key using the same strategy as feed processing
            const key = this.desklet._simpleHash(itemobj.link);

            // Check if item already exists to preserve favorite status
            const existingItem = context.items.get(key);
            const isFavorite = existingItem ? existingItem.isFavorite : false;

            // Add new item to map with isFavorite property
            context.items.set(key, {
                ...itemobj,  // spread operator to clone
                key: key,    // store key for later use
                isFavorite: isFavorite,  // preserve existing favorite status or default to false
                downloadTimestamp: Date.now() // when this article was downloaded
            });

            // Schedule display update using Promise to avoid UI blocking
            Promise.resolve().then(() => {
                // Limit size and clean old elements if needed
                if (context.items.size > context.itemlimit) {
                    const sortedItems = Array.from(context.items.entries())
                        .sort((a, b) => b[1].timestamp - a[1].timestamp);

                    // Keep only the newest items
                    context.items = new Map(sortedItems.slice(0, context.itemlimit));
                }

                // Schedule UI update
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this.desklet.safeDisplayUpdate('article management update');
                    return GLib.SOURCE_REMOVE;
                });
            }).catch(e => {
                Logger.debug('Error in additems:', e);
            });

        } catch (e) {
            Logger.debug('Error in additems:', e);
        }
    }

    async _addArticleFromUrl(url) {
        try {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            // Fetch the content
            let response = await this.desklet.feedCollection.httpRequest('GET', url);
            let content = response && response.response_body ? response.response_body.data : response;
            if (!content) throw new Error(_('No content received from URL.'));

            // Try to parse as RSS/Atom
            let parsed = null;
            try {
                if (this.desklet.feedProcessor) {
                    // Create a dummy feed object for parsing
                    const dummyFeed = { name: 'Manual', url: url };
                    parsed = this.desklet.feedProcessor.processFeedResult(dummyFeed, content);
                }
            } catch (e) {
                parsed = null;
            }

            let item = null;
            if (parsed && parsed.length > 0) {
                // Use first processed item
                const processedItem = parsed[0];
                item = {
                    channel: _('Manual'),
                    timestamp: processedItem.timestamp,
                    pubDate: processedItem.pubDate,
                    title: processedItem.title,
                    link: processedItem.link,
                    category: processedItem.category,
                    description: processedItem.description,
                    labelColor: '#007bff',
                    aiResponse: '',
                };
            } else {
                // Try to extract from HTML with improved description extraction
                let titleMatch = content.match(/<title>(.*?)<\/title>/i);
                let title = titleMatch ? titleMatch[1].trim() : url;

                // Try multiple description extraction methods
                let description = '';

                // Method 1: Standard meta description
                let descMatch = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
                if (descMatch) {
                    description = descMatch[1].trim();
                }

                // Method 2: Alternative meta description patterns
                if (!description) {
                    descMatch = content.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
                    if (descMatch) {
                        description = descMatch[1].trim();
                    }
                }

                // Method 3: Open Graph description
                if (!description) {
                    descMatch = content.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
                    if (descMatch) {
                        description = descMatch[1].trim();
                    }
                }

                // Method 4: Extract first paragraph content as fallback
                if (!description) {
                    let pMatch = content.match(/<p[^>]*>(.*?)<\/p>/i);
                    if (pMatch) {
                        description = pMatch[1].replace(/<[^>]*>/g, '').trim();
                        // Limit length to avoid very long descriptions
                        if (description.length > 200) {
                            description = description.substring(0, 200) + '...';
                        }
                    }
                }

                // Method 5: Use title as description if nothing else found
                if (!description && title && title !== url) {
                    description = title;
                }

                item = {
                    channel: _('Manual'),
                    timestamp: new Date(),
                    pubDate: new Date().toISOString(),
                    title: title,
                    link: url,
                    category: '',
                    description: description,
                    labelColor: '#007bff',
                    aiResponse: '',
                };
            }
            if (!item.title) item.title = _('No Title');
            if (!item.timestamp || isNaN(item.timestamp.getTime())) item.timestamp = new Date();

            // Add to top of list
            this.additems(this.desklet, item);
            this._showSimpleNotification(_('Article added!'));
        } catch (e) {
            this._showSimpleNotification(_('Failed to add article: ') + e.message);
        }
    }

    _showAddArticleDialog() {
        let dialog = new this.desklet.ModalDialog.ModalDialog();
        let titleBin = new this.desklet.St.Bin({
            style_class: 'add-article-title',
            style: 'margin-bottom: 10px;'
        });
        let titleLabel = new this.desklet.St.Label({
            text: _('Add Article by URL'),
            style_class: 'add-article-title-text',
            style: 'font-size: 16px; font-weight: bold;'
        });
        titleBin.set_child(titleLabel);
        dialog.contentLayout.add(titleBin);
        let entry = new this.desklet.St.Entry({
            name: 'addArticleEntry',
            hint_text: _('Paste article or feed URL...'),
            track_hover: true,
            reactive: true,
            can_focus: true,
            style: 'width: 350px; min-width: 250px;'
        });
        dialog.contentLayout.add(entry);
        entry.clutter_text.connect('key-press-event', (actor, event) => {
            let symbol = event.get_key_symbol();
            if (symbol === this.desklet.Clutter.KEY_Return || symbol === this.desklet.Clutter.KEY_KP_Enter) {
                let url = entry.get_text();
                if (url) {
                    dialog.close();
                    this._addArticleFromUrl(url);
                }
                return this.desklet.Clutter.EVENT_STOP;
            }
            return this.desklet.Clutter.EVENT_PROPAGATE;
        });
        dialog.setButtons([
            {
                label: _('Cancel'),
                action: () => dialog.close(),
                key: this.desklet.Clutter.KEY_Escape
            },
            {
                label: _('Add'),
                action: () => {
                    let url = entry.get_text();
                    if (url) {
                        dialog.close();
                        this._addArticleFromUrl(url);
                    }
                },
                key: this.desklet.Clutter.KEY_Return
            }
        ]);
        dialog.open();
        global.stage.set_key_focus(entry);
    }

    // Clean up old items to reduce memory pressure
    _cleanupOldItems() {
        try {
            if (this.desklet.items.size <= this.desklet.itemlimit) return;

            // Keep only the newest items up to itemlimit
            const sortedItems = Array.from(this.desklet.items.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp);

            // Create a new map with only the items we want to keep
            this.desklet.items = new Map(sortedItems.slice(0, this.desklet.itemlimit));

            Logger.debug(`Cleaned up items. Reduced to ${this.desklet.items.size} items.`);
        } catch (e) {
            Logger.debug('Error in _cleanupOldItems:', e);
        }
    }

    _cleanupItem(item) {
        if (!item) return;

        // Clear references
        if (item.aiResponse) {
            item.aiResponse = '';
        }
        if (item.description) {
            item.description = '';
        }
        // Clean other fields...
    }

    _showSimpleNotification(message) {
        try {
            Logger.debug('Showing simple notification: ' + message);

            // Create a simple notification using a normal dialog
            let dialog = new this.desklet.ModalDialog.ModalDialog();

            let contentBox = new this.desklet.St.BoxLayout({
                vertical: true,
                style_class: 'simple-notification-content',
                style: 'spacing: 10px; padding: 10px;'
            });

            let messageLabel = new this.desklet.St.Label({
                text: message,
                style: 'font-size: 14px; text-align: center;'
            });

            contentBox.add(messageLabel);
            dialog.contentLayout.add(contentBox);

            dialog.setButtons([
                {
                    label: _("OK"),
                    action: () => dialog.close()
                }
            ]);

            dialog.open();
            Logger.debug('Simple notification shown');

            return dialog;
        } catch (e) {
            Logger.debug('Error showing simple notification: ' + e);
            return null;
        }
    }

    // Helper function to check if text matches filter
    _checkMatch(filter, title, category, description) {
        const regexp = new RegExp(filter.filter, 'i');

        return (filter.inTitle && title && regexp.test(title)) ||
            (filter.inCategory && category && regexp.test(category)) ||
            (filter.inDescription && description && regexp.test(description));
    }

    // Simplified main filter function
    inGlobalFilter(self, title, category, description) {
        if (!self?.listfilter?.length) return true;

        for (const filter of self.listfilter) {
            if (!filter?.active) continue;

            try {
                const matches = this._checkMatch(filter, title, category, description);
                if (filter.unmatch ? !matches : matches) return false;
            } catch {
                continue;
            }
        }
        return true;
    }

    // Check if article should be displayed based on feed runtime display state
    shouldDisplayArticle(self, item) {
        // If header feed buttons are disabled, show all articles
        if (!self.enableHeaderFeedButtons) return true;

        // Find the feed for this article and check its runtime display state
        if (self.feeds && item.channel) {
            const feed = self.feeds.find(f => f.name === item.channel);
            if (feed && typeof feed.runtimeDisplayEnabled !== 'undefined') {
                return feed.runtimeDisplayEnabled;
            }
        }

        // Default to showing if we can't determine the feed state
        return true;
    }

    // Copy button functionality
    onClickedCopyButton(selfObj, p2, item, lineBox) {
        const message = item.channel + ' ' + item.category + ' @' + item.pubDate + '\n' +
            item.title + '\n' +
            '---------------------------\n' +
            (item.description || '') + '\n' +
            '---------------------------\n' +
            (item.aiResponse || '') + '\n' +
            '---------------------------\n' +
            'URL: ' + item.link + '\n'
            ;

        this.desklet.clipboard.set_text(this.desklet.St.ClipboardType.CLIPBOARD, message);
    }

    // Open article in browser
    onClickedButton(selfObj, p2, uri) {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
    }
}

module.exports = { ArticleManagement };
