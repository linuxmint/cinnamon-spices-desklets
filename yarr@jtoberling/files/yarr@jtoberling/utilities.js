const Logger = require('./logger');

/**
 * Utilities Module
 * Common helper functions used across the application
 */

class Utilities {
    constructor() { }

    // Simple synchronous hash function for generating keys
    simpleHash(str) {
        let hash = 0;
        if (typeof str !== 'string') return '0';
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString();
    }

    // Invert brightness for text shadow
    invertBrightness(rgb) {
        rgb = Array.prototype.join.call(arguments).match(/(-?[0-9.]+)/g);
        let brightness = 255 * 3;
        for (let i = 0; i < rgb.length && i < 3; i++) {
            brightness -= rgb[i];
        }
        return brightness > 255 * 1.5 ? '255, 255, 255' : '0, 0, 0';
    }

    // Format date with optional year
    formatDate(pDate, withYear = true) {
        let retStr = '';
        if (withYear) {
            retStr += pDate.getFullYear().toString() + '-';
        }
        retStr += (pDate.getMonth() + 1).toString().padStart(2, '0') + '-' + pDate.getDate().toString().padStart(2, '0') + ' ' +
            pDate.getHours().toString().padStart(2, '0') + ':' + pDate.getMinutes().toString().padStart(2, '0');
        return retStr;
    }

    // Generate random color for feed labels
    generateRandomColor() {
        const r = Math.floor(Math.random() * 200);
        const g = Math.floor(Math.random() * 200);
        const b = Math.floor(Math.random() * 200);
        return "#" + r.toString(16).padStart(2, '0') +
            g.toString(16).padStart(2, '0') +
            b.toString(16).padStart(2, '0');
    }

    // Safe URL parsing
    safeParseUrl(raw) {
        try {
            return new URL(String(raw));
        } catch (_e) {
            return null;
        }
    }

    // Check if hostnames match (including subdomains)
    hostnameMatches(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        return a.endsWith('.' + b) || b.endsWith('.' + a);
    }

    // Escape markup for safe display
    static escapeMarkup(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Infer channel information from link
    inferChannelFromLink(link, feeds) {
        try {
            const urlObj = this.safeParseUrl(link);
            const host = urlObj?.hostname || null;

            if (Array.isArray(feeds) && host) {
                for (const feed of feeds) {
                    try {
                        const feedHost = this.safeParseUrl(feed?.url)?.hostname;
                        if (!feedHost) continue;
                        if (this.hostnameMatches(host, feedHost)) {
                            return { name: feed.name || host, color: feed.labelcolor || '#ffffff' };
                        }
                    } catch (_ignored) { }
                }
            }

            return { name: host || 'Unknown', color: '#ffffff' };
        } catch (_e) {
            return { name: 'Unknown', color: '#ffffff' };
        }
    }

    // Clean up old items to reduce memory pressure
    cleanupOldItems(items, itemlimit) {
        try {
            if (items.size <= itemlimit) return items;

            // Keep only the newest items up to itemlimit
            const sortedItems = Array.from(items.entries())
                .sort((a, b) => b[1].timestamp - a[1].timestamp);

            // Create a new map with only the items we want to keep
            return new Map(sortedItems.slice(0, itemlimit));
        } catch (e) {
            Logger.debug('Error in cleanupOldItems:', e);
            return items;
        }
    }

    // Clean up individual item references
    cleanupItem(item) {
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
}

module.exports = { Utilities };
