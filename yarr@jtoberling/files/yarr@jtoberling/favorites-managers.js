const Logger = require('./logger');

/**
 * Favorites Managers Module
 * Handles favorites management and operations
 */

class FavoritesManagers {
    constructor(desklet) {
        this.desklet = desklet;
    }



    // Add method to load favorite articles
    async loadFavoriteArticles() {
        try {
            if (!this.desklet.databaseManager) {
                Logger.error('Database manager not available!');
                return;
            }

            const favorites = await this.desklet.databaseManager.loadFavoriteArticles();

            if (!favorites || favorites.length === 0) {
                Logger.debug('No favorites found');
                return;
            }
            Logger.debug('Parsed favorites count: ' + favorites.length);

            const now = Date.now();

            favorites.forEach((item, index) => {
                Logger.debug(`Processing favorite ${index + 1}: ${item.title}`);

                const key = this.desklet.utilities.simpleHash(item.link);
                const existingItem = this.desklet.items.get(key);
                const inferred = this.desklet.utilities.inferChannelFromLink(item.link, this.desklet.feeds);

                let tsMs = parseInt(item.timestamp);
                if (!tsMs || isNaN(tsMs)) tsMs = now;

                this.desklet.items.set(key, {
                    channel: item.channel || inferred.name,
                    timestamp: new Date(tsMs),
                    pubDate: item.pubDate || new Date(tsMs).toUTCString(),
                    title: item.title || '(no title)',
                    link: item.link,
                    category: item.category || '',
                    description: item.description || '',
                    labelColor: item.labelColor || inferred.color || '#ffffff',
                    aiResponse: item.aiResponse || '',
                    isFavorite: true,
                    downloadTimestamp: now,
                    key: key
                });

                Logger.debug(`Added favorite to items map: ${item.title} with key: ${key}`);

                if (this.desklet.favoriteKeys && typeof this.desklet.favoriteKeys.add === 'function') {
                    this.desklet.favoriteKeys.add(item.link);
                    Logger.debug(`Added to favoriteKeys: ${item.title}`);
                } else {
                    Logger.error('favoriteKeys not available or not a Set!');
                }
            });

            Logger.debug(`Total items in desklet after loading favorites: ${this.desklet.items.size}`);
            Logger.debug(`Total favoriteKeys after loading: ${this.desklet.favoriteKeys ? this.desklet.favoriteKeys.size : 'N/A'}`);

            // Save database after loading favorites
            if (this.desklet.databaseManager && this.desklet.databaseManager.saveDatabase) {
                this.desklet.databaseManager.saveDatabase();
            }

            // Don't refresh display when loading favorites - let the main display handle it
            Logger.debug('Favorites loaded, display will update naturally');
        } catch (e) {
            Logger.error('Error in loadFavoriteArticles: ' + e);
        }
    }

    // Add favorite to database and update state
    async addFavorite(item) {
        try {
            Logger.debug(`FavoritesManagers: Adding favorite: ${item.title || 'Untitled'}`);

            // Add to database
            const success = await this.desklet.databaseManager.addFavorite(item);
            if (!success) {
                Logger.error('Failed to add favorite to database');
                return false;
            }

            // Update favoriteKeys Set for consistency
            if (this.desklet.databaseManager && typeof this.desklet.databaseManager.saveDatabase === 'function') {
                this.desklet.databaseManager.saveDatabase();
            }

            // Update favoriteKeys Set
            if (this.desklet.favoriteKeys && typeof this.desklet.favoriteKeys.add === 'function') {
                this.desklet.favoriteKeys.add(item.link);
                Logger.debug(`Added to favoriteKeys: ${item.title}`);
            }

            Logger.debug(`Favorite added successfully: ${item.title}`);
            return true;
        } catch (e) {
            Logger.error('Error adding favorite: ' + e);
            return false;
        }
    }

    // Remove favorite from database and update state
    async removeFavorite(item) {
        try {
            Logger.debug(`FavoritesManagers: Removing favorite: ${item.title || 'Untitled'}`);

            // Remove from database
            const success = await this.desklet.databaseManager.removeFavorite(item.link);
            if (!success) {
                Logger.error('Failed to remove favorite from database');
                return false;
            }

            // Update favoriteKeys Set for consistency
            if (this.desklet.databaseManager && typeof this.desklet.databaseManager.saveDatabase === 'function') {
                this.desklet.databaseManager.saveDatabase();
            }

            // Update favoriteKeys Set
            if (this.desklet.favoriteKeys && typeof this.desklet.favoriteKeys.delete === 'function') {
                this.desklet.favoriteKeys.delete(item.link);
                Logger.debug(`Removed from favoriteKeys: ${item.title}`);
            }

            Logger.debug(`Favorite removed successfully: ${item.title}`);
            return true;
        } catch (e) {
            Logger.error('Error removing favorite: ' + e);
            return false;
        }
    }

    // Legacy method - kept for backward compatibility but not used
    async onClickedFavoriteButton(selfObj, p2, item, lineBox, favIcon) {
        Logger.debug('Legacy onClickedFavoriteButton called - this method is deprecated');
        // This method is no longer used - UI display handles button clicks directly
        return false;
    }

    onClickedSumButton(selfObj, p2, item, lineBox, sumIcon) {
        if (sumIcon) {
            sumIcon.set_icon_name('process-working-symbolic');
        }

        this.desklet._markItemAsRead(item, this.desklet.showReadStatusCheckbox ? null : null, null);
        this.desklet.aiManagers.summarizeUri(this.desklet.ai_dumptool, item, lineBox, sumIcon)
            .then(() => {
                if (sumIcon) {
                    sumIcon.set_icon_name('document-edit-symbolic');
                }
            })
            .catch(() => {
                if (sumIcon) {
                    sumIcon.set_icon_name('dialog-error-symbolic');
                }
            });
    }

    // Unified read toggle function
    async _toggleReadStatus(item, readIcon, titleLabel) {
        try {
            // Ensure readArticleIds is a Set
            if (!(this.desklet.readArticleIds instanceof Set)) {
                Logger.debug('readArticleIds is not a Set in _toggleReadStatus, reinitializing...', true);
                this.desklet.readArticleIds = new Set();
            }

            // Check current read status
            let isCurrentlyRead = false;
            try {
                if (this.desklet.readArticleIds && typeof this.desklet.readArticleIds.has === 'function') {
                    isCurrentlyRead = this.desklet.readArticleIds.has(item.key);
                }
            } catch (e) {
                Logger.error(`Error checking read status in toggle: ${e}`);
                isCurrentlyRead = false;
            }

            if (!isCurrentlyRead) {
                // Mark as read - add to read set
                this.desklet.readArticleIds.add(item.key);
                await this.desklet.databaseManager.markRead(item.key);
                if (readIcon) {
                    readIcon.set_icon_name('checkbox-checked-symbolic');
                    readIcon.style = 'color: #4a90e2;';
                }
                if (titleLabel && titleLabel.style) {
                    const baseFont = this.desklet.fontstyle.replace(/font-weight:[^;]+;/i, '');
                    let newStyle = baseFont + ' font-weight: normal;';
                    if (this.desklet.dimReadTitles) newStyle += ` color: ${this.desklet.readTitleColor}; opacity: 0.85;`;
                    titleLabel.style = newStyle;
                }
                Logger.debug(`Marked article as read: ${item.title}`);
            } else {
                // Mark as unread - remove from read set
                this.desklet.readArticleIds.delete(item.key);
                await this.desklet.databaseManager.markUnread(item.key);
                if (readIcon) {
                    readIcon.set_icon_name('checkbox-symbolic');
                    readIcon.style = 'color: #888888;';
                }
                if (titleLabel && titleLabel.style) {
                    const baseFont = this.desklet.fontstyle.replace(/font-weight:[^;]+;/i, '');
                    titleLabel.style = baseFont + ' font-weight: bold;';
                }
                Logger.debug(`Marked article as unread: ${item.title}`);
            }

            // Save database after toggling read status
            if (this.desklet.databaseManager && this.desklet.databaseManager.saveDatabase) {
                this.desklet.databaseManager.saveDatabase();
            }
        } catch (e) {
            Logger.error(`Error in _toggleReadStatus: ${e}`);
        }
    }

    // Mark as read (idempotent)
    async _markItemAsRead(item, readIcon, titleLabel) {
        // Ensure readArticleIds is a Set
        if (!(this.desklet.readArticleIds instanceof Set)) {
            Logger.error('readArticleIds is not a Set in _markItemAsRead, reinitializing...');
            this.desklet.readArticleIds = new Set();
        }

        let isCurrentlyRead = false;
        try {
            if (this.desklet.readArticleIds && typeof this.desklet.readArticleIds.has === 'function') {
                isCurrentlyRead = this.desklet.readArticleIds.has(item.key);
            }
        } catch (e) {
            Logger.error(`Error checking read status in markAsRead: ${e}`);
            isCurrentlyRead = false;
        }

        if (!isCurrentlyRead) {
            this.desklet.readArticleIds.add(item.key);
            await this.desklet.databaseManager.markRead(item.key);
            if (readIcon) {
                readIcon.set_icon_name('checkbox-checked-symbolic');
                readIcon.style = 'color: #4a90e2;';
            }
            if (titleLabel && titleLabel.style) {
                const baseFont = this.desklet.fontstyle.replace(/font-weight:[^;]+;/i, '');
                let newStyle = baseFont + ' font-weight: normal;';
                if (this.desklet.dimReadTitles) newStyle += ` color: ${this.desklet.readTitleColor}; opacity: 0.85;`;
                titleLabel.style = newStyle;
            }
        }
    }
}

module.exports = { FavoritesManagers };
