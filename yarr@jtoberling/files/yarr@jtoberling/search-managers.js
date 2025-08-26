const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Logger = require('./logger');
const { AsyncCommandExecutor } = require('./async-managers');

/**
 * Search Managers Module
 * Handles RSS feed search and discovery
 */

class SearchManagers {
    constructor(desklet) {
        this.desklet = desklet;
    }

    onSearchRssFeeds() {
        // Add detailed logging
        Logger.debug('onSearchRssFeeds called - creating RSS search dialog');

        // Create and show the RSS search dialog
        let rssSearchDialog = this.desklet.uiComponents.createRssSearchDialog(
            this.desklet._("Search for RSS Feeds"),
            this.desklet._onRssSearchResult.bind(this.desklet),
            this.desklet
        );
        rssSearchDialog.open();
    }

    _onRssSearchResult(baseUrl) {
        Logger.debug('_onRssSearchResult called with URL: ' + baseUrl);

        if (!baseUrl) {
            Logger.debug('No URL provided, aborting search');
            return;
        }

        // Show a notification that search is in progress using the simple notification
        this.desklet.articleManagement._showSimpleNotification(this.desklet._("Searching for RSS feeds at ") + baseUrl);

        // Start the search process
        this._searchForRssFeeds(baseUrl);
    }

    _testCommand() {
        try {
            Logger.debug("Starting basic command test...");

            // Test 1: Can we run a simple echo command?
            AsyncCommandExecutor.executeCommand('echo "Hello World"', (success1, stdout1, stderr1) => {
                if (success1) {
                    Logger.debug("Echo test successful: " + stdout1);
                } else {
                    Logger.debug("Echo test failed: " + (stderr1 || "Unknown error"));
                }

                // Test 2: Can we run the which command to find curl?
                AsyncCommandExecutor.executeCommand('which curl', (success2, stdout2, stderr2) => {
                    if (success2 && stdout2 && stdout2.length > 0) {
                        Logger.debug("Curl found at: " + stdout2);
                    } else {
                        Logger.debug("Curl not found: " + (stderr2 || "Not in PATH"));
                    }

                    // Test 3: Can we try a very simple curl command?
                    AsyncCommandExecutor.executeCommand('curl --version', (success3, stdout3, stderr3) => {
                        if (success3) {
                            Logger.debug("Curl version test successful");
                        } else {
                            Logger.debug("Curl version test failed: " + (stderr3 || "Unknown error"));
                        }

                        Logger.debug("Basic command test completed");
                    });
                });
            });
        } catch (e) {
            Logger.debug("Error in _testCommand: " + e.message);
        }
    }

    _searchForRssFeeds(baseUrl) {
        try {
            Logger.debug('Starting simplified RSS feed search for: ' + baseUrl);

            // Make sure the URL has a protocol prefix
            if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
                baseUrl = 'https://' + baseUrl;
            }

            Logger.debug('Processed URL: ' + baseUrl);

            // Just check the base URL and maybe a couple of common paths
            const pathsToCheck = [
                '', // base URL itself
                '/feed',
                '/feedburner',
                '/rss',
                '/atom',
                '/json',
                '/xml',
                '/rss.xml',
                '/atom.xml',
                '/json.xml',
                '/blog/feed',
                '/blog/atom',
                '/blog/rss',
                '/blog/feed.xml',
                '/blog/atom.xml',
                '/news/feed',
                '/news/rss',
                '/news/atom',
                '/news.xml',
                '/news/feed.xml',
                '/news/rss.xml',
                '/news/atom.xml',
                '/articles/feed',
                '/articles/rss',
                '/articles/atom',
                '/articles.xml',
                '/articles/feed.xml',
                '/articles/rss.xml',
                '/articles/atom.xml',
                '/updates/feed',
                '/updates/rss',
                '/updates/atom',
                '/updates.xml',
                '/updates/feed.xml',
                '/updates/rss.xml',
                '/updates/atom.xml',
                '/content/feed',
                '/content/rss',
                '/content/atom',
                '/content.xml',
                '/content/feed.xml',
                '/content/rss.xml',
                '/content/atom.xml',
                '/posts/feed',
                '/posts/rss',
                '/posts/atom',
                '/posts.xml',
                '/posts/feed.xml',
                '/posts/rss.xml',
                '/posts/atom.xml',
                '/feed/rss',
                '/feed/atom',
                '/feed/rss2',
                '/feed/rdf',
                '/feed/feed',
                '/feed/index.xml',
                '/feed/rss.xml',
                '/feed/atom.xml',
                // Additional Atom-specific paths
                '/feed.xml',
                '/index.xml',
                '/node/feed',
                '/node/rss',
                '/node/atom',
                '/node/json',
                '/node/xml',
                '/node/rss.xml',
                '/node/atom.xml',
                '/node/json.xml',
                '/node/feed.xml',
                '/node/rss.xml',
                '/node/atom.xml'
            ];

            let foundFeeds = [];

            Logger.debug('Will check ' + pathsToCheck.length + ' URLs');

            // Use async approach - check URLs in parallel
            let completedChecks = 0;
            const totalChecks = pathsToCheck.length;

            for (let i = 0; i < pathsToCheck.length; i++) {
                let path = pathsToCheck[i];
                let url = baseUrl;
                if (path && !path.startsWith('/')) {
                    url += '/';
                }
                url += path;

                Logger.debug('Checking URL: ' + url);

                // Use a more basic curl command that's more reliable
                let command = 'curl -s -L --max-time 10 --connect-timeout 5 "' + url + '"';
                Logger.debug('Running command: ' + command);

                AsyncCommandExecutor.executeCommand(command, (success, stdout, stderr) => {
                    completedChecks++;
                    Logger.debug(`Command completed for ${url}: success=${success}, stdout length=${stdout ? stdout.length : 0}, stderr=${stderr || 'none'}`);

                    if (!success) {
                        Logger.debug('Command failed for ' + url + ' - stderr: ' + (stderr || 'none'));
                    } else {
                        let content = '';
                        if (stdout && stdout.length > 0) {
                            content = stdout;
                            Logger.debug('Got content of length: ' + content.length);
                            // Log first 200 characters for debugging
                            Logger.debug('Content preview: ' + content.substring(0, 200));
                        } else {
                            Logger.debug('No content received from stdout');
                            // Sometimes curl outputs content to stderr, check there too
                            if (stderr && stderr.length > 0) {
                                Logger.debug('Checking stderr for content, length: ' + stderr.length);
                                content = stderr;
                                Logger.debug('Using stderr content of length: ' + content.length);
                                Logger.debug('Stderr content preview: ' + content.substring(0, 200));
                            }
                        }

                        // Check for both RSS and Atom feeds
                        if (content.includes('<rss') || content.includes('<feed') || content.includes('<channel')) {
                            Logger.debug('Found potential feed at: ' + url);

                            // Determine feed type
                            let feedType = 'Unknown';
                            if (content.includes('<rss')) {
                                feedType = 'RSS';
                            } else if (content.includes('<feed')) {
                                feedType = 'Atom';
                            } else if (content.includes('<channel')) {
                                feedType = 'RSS';
                            }

                            // Extract title with better parsing
                            let title = this._extractBetterTitle(content, url);
                            Logger.debug('Feed title: ' + title);

                            // Extract category/description if available
                            let category = this._extractCategory(content);
                            let description = this._extractDescription(content);
                            let contentLength = content.length;
                            let lastUpdated = this._extractLastUpdated(content);

                            foundFeeds.push({
                                url: url,
                                title: title,
                                type: feedType,
                                category: category,
                                description: description,
                                contentLength: contentLength,
                                lastUpdated: lastUpdated
                            });
                        } else {
                            Logger.debug('Not a feed: ' + url);
                        }
                    }

                    // Check if all URLs have been processed
                    if (completedChecks === totalChecks) {
                        Logger.debug('Search completed, found ' + foundFeeds.length + ' feeds');

                        // Show results
                        if (foundFeeds.length > 0) {
                            Logger.debug('Showing feed selection dialog with ' + foundFeeds.length + ' feeds');
                            this._showFeedSelectionDialog(foundFeeds);
                        } else {
                            Logger.debug('No feeds found, showing notification');
                            this.desklet.articleManagement._showSimpleNotification(this.desklet._("No RSS feeds found at ") + baseUrl);
                        }
                    }
                });
            }

        } catch (err) {
            Logger.debug('Error in simplified _searchForRssFeeds: ' + err);
            this.desklet.articleManagement._showSimpleNotification(this.desklet._("Error searching for RSS feeds: ") + err.message);
        }
    }

    _extractBetterTitle(content, url) {
        // Try multiple title extraction methods
        let title = null;

        // Method 1: Standard title tag
        const titleMatch = content.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
        }

        // Method 2: RSS channel title
        if (!title || title === url) {
            const channelTitleMatch = content.match(/<channel[^>]*>.*?<title>(.*?)<\/title>/is);
            if (channelTitleMatch && channelTitleMatch[1]) {
                title = channelTitleMatch[1].trim();
            }
        }

        // Method 3: Atom feed title
        if (!title || title === url) {
            const atomTitleMatch = content.match(/<feed[^>]*>.*?<title>(.*?)<\/title>/is);
            if (atomTitleMatch && atomTitleMatch[1]) {
                title = atomTitleMatch[1].trim();
            }
        }

        // Method 4: Extract from URL if no title found
        if (!title || title === url) {
            title = this._extractTitleFromUrl(url);
        }

        return title || 'Untitled Feed';
    }

    _extractTitleFromUrl(url) {
        try {
            // Remove protocol and www
            let cleanUrl = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
            // Remove trailing slash and get domain
            cleanUrl = cleanUrl.replace(/\/$/, '');

            // If it's just a domain, return it
            if (!cleanUrl.includes('/')) {
                return cleanUrl;
            }

            // Extract the last meaningful part of the path
            const pathParts = cleanUrl.split('/').filter(part => part.length > 0);
            if (pathParts.length > 1) {
                const lastPart = pathParts[pathParts.length - 1];
                // Clean up the last part (remove .xml, .rss, etc.)
                return lastPart.replace(/\.(xml|rss|atom|json)$/i, '');
            }

            return cleanUrl;
        } catch (e) {
            return url;
        }
    }

    _extractCategory(content) {
        try {
            // Try RSS category
            const rssCategoryMatch = content.match(/<category>(.*?)<\/category>/i);
            if (rssCategoryMatch && rssCategoryMatch[1]) {
                return rssCategoryMatch[1].trim();
            }

            // Try Atom category
            const atomCategoryMatch = content.match(/<category[^>]*term="([^"]*)"[^>]*>/i);
            if (atomCategoryMatch && atomCategoryMatch[1]) {
                return atomCategoryMatch[1].trim();
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    _extractDescription(content) {
        try {
            // Try RSS description
            const rssDescMatch = content.match(/<description>(.*?)<\/description>/i);
            if (rssDescMatch && rssDescMatch[1]) {
                let desc = rssDescMatch[1].trim();
                // Remove HTML tags and limit length
                desc = desc.replace(/<[^>]*>/g, '').substring(0, 100);
                return desc + (desc.length === 100 ? '...' : '');
            }

            // Try Atom subtitle
            const atomSubtitleMatch = content.match(/<subtitle>(.*?)<\/subtitle>/i);
            if (atomSubtitleMatch && atomSubtitleMatch[1]) {
                let desc = atomSubtitleMatch[1].trim();
                desc = desc.replace(/<[^>]*>/g, '').substring(0, 100);
                return desc + (desc.length === 100 ? '...' : '');
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    _extractLastUpdated(content) {
        try {
            // Try RSS lastBuildDate
            const rssLastBuildMatch = content.match(/<lastBuildDate>(.*?)<\/lastBuildDate>/i);
            if (rssLastBuildMatch && rssLastBuildMatch[1]) {
                return this._formatDate(rssLastBuildMatch[1].trim());
            }

            // Try RSS pubDate
            const rssPubDateMatch = content.match(/<pubDate>(.*?)<\/pubDate>/i);
            if (rssPubDateMatch && rssPubDateMatch[1]) {
                return this._formatDate(rssPubDateMatch[1].trim());
            }

            // Try Atom updated
            const atomUpdatedMatch = content.match(/<updated>(.*?)<\/updated>/i);
            if (atomUpdatedMatch && atomUpdatedMatch[1]) {
                return this._formatDate(atomUpdatedMatch[1].trim());
            }

            // Try Atom published
            const atomPublishedMatch = content.match(/<published>(.*?)<\/published>/i);
            if (atomPublishedMatch && atomPublishedMatch[1]) {
                return this._formatDate(atomPublishedMatch[1].trim());
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    _formatDate(dateString) {
        try {
            // Try to parse various date formats
            let date = new Date(dateString);
            if (isNaN(date.getTime())) {
                // Try RFC 822 format
                date = new Date(dateString.replace(/,/, ''));
            }

            if (!isNaN(date.getTime())) {
                const now = new Date();
                const diffMs = now - date;
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffDays === 0) {
                    return 'Today';
                } else if (diffDays === 1) {
                    return 'Yesterday';
                } else if (diffDays < 7) {
                    return `${diffDays} days ago`;
                } else if (diffDays < 30) {
                    const weeks = Math.floor(diffDays / 7);
                    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
                } else {
                    return date.toLocaleDateString();
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    _showFeedSelectionDialog(feeds) {
        let feedSelectionDialog = this.desklet.uiComponents.createFeedSelectionDialog(
            this.desklet._("Select RSS Feeds to Add"),
            feeds,
            this.desklet._onFeedSelectionResult.bind(this.desklet),
            this.desklet
        );
        feedSelectionDialog.open();
    }

    _onFeedSelectionResult(selectedFeeds) {
        if (!selectedFeeds || selectedFeeds.length === 0) return;

        // Add the selected feeds to the configuration
        let currentFeeds = this.desklet.settings.getValue('feeds');

        for (let feed of selectedFeeds) {
            // Generate a random color for the label
            let color = this.desklet.utilities.generateRandomColor();

            // Add the feed to the config
            currentFeeds.push({
                name: feed.title || feed.url.split('/').pop(),
                active: true,
                url: feed.url,
                labelcolor: color,
                filter: "",
                type: feed.type || 'Unknown'
            });
        }

        // Update settings and refresh
        this.desklet.settings.setValue('feeds', currentFeeds);
        this.desklet.onRefreshSettings();
        this.desklet.articleManagement._showSimpleNotification(this.desklet._("Added ") + selectedFeeds.length + this.desklet._(" new RSS feeds"));
    }
}

module.exports = { SearchManagers };
