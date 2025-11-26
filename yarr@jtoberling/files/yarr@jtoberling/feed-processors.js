const Logger = require('./logger');

/**
 * Feed Processors Module
 * Handles RSS and Atom feed parsing and processing
 */

class FeedProcessor {
    constructor() {
        this.fromXML = null;
        this._initializeXMLParser();
    }

    _initializeXMLParser() {
        try {
            const fromXMLModule = require('./fromXML');
            this.fromXML = fromXMLModule.fromXML;
            if (typeof this.fromXML !== 'function') {
                throw new Error('fromXML export is not a function');
            }
        } catch (e) {
            Logger.error('XML parser failed: ' + e);
            Logger.error('Using fallback XML parser');
            // Fallback: try to extract content manually
            result = this._extractContentManually(rawContent);
        }
    }

    /**
     * Process feed result - supports both RSS and Atom feed formats
     * RSS: <rss><channel><item>...</item></channel></rss>
     * Atom: <feed><entry>...</entry></feed>
     */
    processFeedResult(feed, result, enableDebugLogs = false) {
        try {
            if (!result) {
                Logger.debug(`No result data for feed: ${feed.name}`);
                return;
            }

            Logger.debug(`Parsing XML for feed: ${feed.name}`);

            // Debug: Log the first part of the XML content to see what we're working with
            if (enableDebugLogs) {
                const previewLength = Math.min(500, result.length);
                Logger.debug(`XML preview (first ${previewLength} chars): ${result.substring(0, previewLength)}`);

                // Check for feed type indicators in the raw XML
                if (result.includes('<feed')) {
                    Logger.debug('Raw XML contains <feed> tag - likely Atom feed');
                }
                if (result.includes('<rss')) {
                    Logger.debug('Raw XML contains <rss> tag - likely RSS feed');
                }
                if (result.includes('<channel')) {
                    Logger.debug('Raw XML contains <channel> tag - likely RSS feed');
                }
                if (result.includes('<entry')) {
                    Logger.debug('Raw XML contains <entry> tag - likely Atom feed');
                }
                if (result.includes('<item')) {
                    Logger.debug('Raw XML contains <item> tag - likely RSS feed');
                }
            }

            let resJSON;
            try {
                resJSON = this.fromXML(result);
            } catch (e) {
                Logger.error(`fromXML parsing failed for ${feed.name}: ${e}`);
                return;
            }

            if (!resJSON) {
                Logger.debug(`fromXML returned null/undefined for feed: ${feed.name}`);
                return;
            }

            Logger.debug(`Parsed XML structure keys: ${Object.keys(resJSON).join(', ')}`);

            // Check if this is an RSS feed
            if (resJSON.rss && resJSON.rss.channel) {
                Logger.debug(`Processing RSS feed: ${feed.name}`);
                return this._processRSSFeed(feed, resJSON.rss.channel);
            }
            // Check if this is an Atom feed
            else if (resJSON.feed) {
                Logger.debug(`Processing Atom feed: ${feed.name}`);
                return this._processAtomFeed(feed, resJSON.feed);
            }
            // Check if the feed element is nested under other keys
            else if (resJSON.html && resJSON.html.feed) {
                Logger.debug(`Processing Atom feed (nested under html): ${feed.name}`);
                return this._processAtomFeed(feed, resJSON.html.feed);
            }
            else if (resJSON.html && resJSON.html.rss) {
                Logger.debug(`Processing RSS feed (nested under html): ${feed.name}`);
                return this._processRSSFeed(feed, resJSON.html.rss);
            }
            else {
                Logger.debug(`Unsupported feed format for ${feed.name}, keys: ${Object.keys(resJSON).join(', ')}`);
                if (enableDebugLogs) {
                    Logger.debug(`Full parsed structure: ${JSON.stringify(resJSON, null, 2)}`);
                }

                // Try to extract feed content from nested structures
                Logger.debug('Attempting to extract feed content from nested structure...');
                const extractedFeed = this._extractNestedFeed(resJSON);
                if (extractedFeed) {
                    Logger.debug(`Successfully extracted feed from nested structure: ${extractedFeed.type}`);
                    if (extractedFeed.type === 'atom') {
                        return this._processAtomFeed(feed, extractedFeed.data);
                    } else if (extractedFeed.type === 'rss') {
                        return this._processRSSFeed(feed, extractedFeed.data);
                    }
                } else {
                    Logger.debug('Could not extract feed content from nested structure');
                    return null;
                }
            }

        } catch (error) {
            Logger.error('Error in processFeedResult: ' + error);
            throw error;
        }
    }

    /**
     * Process RSS feed structure
     * RSS format: <rss><channel><item>...</item></channel></rss>
     */
    _processRSSFeed(feed, channel) {
        try {
            if (!channel.item) {
                Logger.debug(`No items in RSS feed: ${feed.name}`);
                return null;
            }

            const items = Array.isArray(channel.item)
                ? channel.item
                : [channel.item];

            Logger.debug(`Processing ${items.length} RSS items from feed: ${feed.name}`);
            return this._processFeedItems(feed, items, 'rss');
        } catch (error) {
            Logger.error('Error processing RSS feed: ' + error);
            return null;
        }
    }

    /**
     * Process Atom feed structure
     * Atom format: <feed><entry>...</entry></feed>
     * Handles complex Atom structures like link objects and content objects
     */
    _processAtomFeed(feed, atomFeed) {
        try {
            Logger.debug(`Atom feed structure: ${Object.keys(atomFeed).join(', ')}`);

            if (!atomFeed.entry) {
                Logger.debug(`No entries in Atom feed: ${feed.name}`);
                return null;
            }

            const entries = Array.isArray(atomFeed.entry)
                ? atomFeed.entry
                : [atomFeed.entry];

            Logger.debug(`Processing ${entries.length} Atom entries from feed: ${feed.name}`);

            // Log first entry structure for debugging
            if (entries.length > 0) {
                Logger.debug(`First Atom entry structure: ${JSON.stringify(Object.keys(entries[0]))}`);
            }

            return this._processFeedItems(feed, entries, 'atom');
        } catch (error) {
            Logger.error('Error processing Atom feed: ' + error);
            return null;
        }
    }

    _processFeedItems(feed, items, feedType) {
        try {
            const processedItems = [];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                try {
                    // Extract data based on feed type
                    const itemData = this._extractItemData(item, feedType);
                    if (!itemData) continue;

                    processedItems.push({
                        channel: feed.name,
                        timestamp: itemData.timestamp,
                        pubDate: itemData.pubDate,
                        title: itemData.title,
                        link: itemData.link,
                        category: itemData.category,
                        description: itemData.description,
                        labelColor: feed.labelcolor || '#ffffff'
                    });
                } catch (e) {
                    Logger.error('Error processing feed item: ' + e);
                }
            }

            return processedItems;
        } catch (error) {
            Logger.error('Error in _processFeedItems: ' + error);
            return [];
        }
    }

    /**
     * Extract feed content from nested XML structures
     * Handles cases where feeds are wrapped in HTML or other XML elements
     */
    _extractNestedFeed(parsedXML) {
        try {
            // Recursively search for feed or rss elements
            const findFeedElement = (obj, depth = 0) => {
                if (depth > 5) return null; // Prevent infinite recursion

                if (!obj || typeof obj !== 'object') return null;

                // Check if this object contains feed elements
                if (obj.feed && obj.feed.entry) {
                    return { type: 'atom', data: obj.feed };
                }
                if (obj.rss && obj.rss.channel) {
                    return { type: 'rss', data: obj.rss };
                }

                // Recursively search through all properties
                for (const key in obj) {
                    if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
                        const result = findFeedElement(obj[key], depth + 1);
                        if (result) return result;
                    }
                }

                return null;
            };

            return findFeedElement(parsedXML);
        } catch (e) {
            Logger.error('Error extracting nested feed: ' + e);
            return null;
        }
    }

    _extractItemData(item, feedType) {
        try {
            if (feedType === 'rss') {
                // RSS format: item.link, item.title, item.description, item.pubDate
                if (!item.link) return null;

                const timestamp = new Date(item.pubDate);
                if (isNaN(timestamp.getTime())) return null;

                return {
                    link: item.link,
                    title: item.title || 'No Title',
                    description: item.description || '',
                    pubDate: item.pubDate,
                    timestamp: timestamp,
                    category: this.getCategoryString(item)
                };
            } else if (feedType === 'atom') {
                // Atom format: entry.link, entry.title, entry.summary/content, entry.updated/published
                // Atom links can be complex objects with @href attribute
                let link = item.link;
                if (typeof link === 'object' && link['@href']) {
                    link = link['@href'];
                } else if (Array.isArray(link)) {
                    // Find the first link with rel="alternate" or just the first link
                    const alternateLink = link.find(l => l.rel === 'alternate');
                    link = (alternateLink && alternateLink['@href']) || (link[0] && link[0]['@href']) || '';
                }

                if (!link) {
                    return null;
                }

                // Atom uses updated or published for timestamp
                const pubDate = item.updated || item.published || item.pubDate;
                const timestamp = new Date(pubDate);
                if (isNaN(timestamp.getTime())) {
                    return null;
                }

                // Atom can have title as text or as an object with #text
                let title = item.title;
                if (typeof title === 'object' && title['#text']) {
                    title = title['#text'];
                }

                // Atom can have content or summary
                let description = item.content || item.summary || '';
                if (typeof description === 'object' && description['#text']) {
                    description = description['#text'];
                }

                // Atom categories can be complex objects
                let category = '';
                if (item.category) {
                    if (Array.isArray(item.category)) {
                        category = item.category.map(cat => {
                            if (typeof cat === 'object' && cat.term) {
                                return cat.term;
                            } else if (typeof cat === 'string') {
                                return cat;
                            }
                            return '';
                        }).filter(cat => cat).join(' / ');
                    } else if (typeof item.category === 'object' && item.category.term) {
                        category = item.category.term;
                    } else if (typeof item.category === 'string') {
                        category = item.category;
                    }
                }

                return {
                    link: link,
                    title: title || 'No Title',
                    description: description,
                    pubDate: pubDate,
                    timestamp: timestamp,
                    category: category
                };
            }
            return null;
        } catch (e) {
            Logger.error('Error extracting item data: ' + e);
            return null;
        }
    }

    getCategoryString(item) {
        if (typeof item.category === 'string') {
            return item.category.toString();
        }

        if (typeof item.category === 'object') {
            let catArr = Array.from(item.category);
            let arrText = catArr.map(elem =>
                typeof elem === 'string' ? elem : elem['#']
            );
            return arrText.join(' / ');
        }

        return '';
    }

    HTMLPartToTextPart(HTMLPart) {
        // Safety check for null/undefined input
        if (!HTMLPart || typeof HTMLPart !== 'string') {
            return '';
        }

        return HTMLPart
            .replace(/\n/ig, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style[^>]*>/ig, '')
            .replace(/<head[^>]*>[\s\S]*?<\/head[^>]*>/ig, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script[^>]*>/ig, '')
            .replace(/<\/\s*(?:p|div)>/ig, '\n\n')
            .replace(/<br[^>]*\/?>/ig, '\n')
            .replace(/<[^>]*>/ig, '')
            .replace('&nbsp;', ' ')
            .replace(/[^\S\r\n][^\S\r\n]+/ig, ' ');
    }
}

module.exports = { FeedProcessor };
