const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

const Logger = require('./logger');

/**
 * Feed Collection Module
 * Handles feed collection, HTTP requests, and timer management
 */

class FeedCollection {
    constructor(desklet) {
        this.desklet = desklet;
        this._isRefreshing = false;
        this._uiUpdateTimer = null;
    }

    async collectFeeds() {
        Logger.debug('Starting feed collection...', false, 'basic');
        Logger.debug(`collectFeeds called - feeds array: ${this.desklet.feeds ? this.desklet.feeds.length : 'null'}`, false, 'basic');
        Logger.debug(`refreshEnabled: ${this.desklet.refreshEnabled}`, false, 'basic');

        // Set refreshing flag to prevent concurrent operations
        this._isRefreshing = true;

        // Get active feeds with proper filtering like backup version
        const feeds = [...this.desklet.feeds].filter(f => f?.active && f?.url?.length);
        Logger.debug(`Filtered active feeds: ${feeds.length}`, false, 'basic');
        if (!feeds?.length) {
            Logger.debug('No active feeds found, returning early', false, 'basic');
            this._isRefreshing = false;
            return;
        }

        Logger.debug(`Collecting ${feeds.length} feeds`, false, 'basic');

        // Update header to show collection starting
        if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
            this.desklet.uiDisplay.setSimpleHeaderTitle(`Starting refresh of ${feeds.length} feeds...`);
        }

        // Store current articles for comparison
        const beforeArticles = new Set();
        Array.from(this.desklet.items.values()).forEach(item => beforeArticles.add(item.link));

        // Use Math.floor like backup version for consistent timestamp
        const refreshTimestamp = Math.floor(Date.now());
        let newArticleCount = 0;
        let feedsRefreshed = 0;
        let feedsFailed = 0;

        // Process feeds in parallel to prevent blocking main thread
        const feedPromises = feeds.map((feed, index) => {
            return this._processFeedAsync(feed, index + 1, feeds.length);
        });

        // Wait for all feeds to complete (with individual timeouts)
        const results = await Promise.allSettled(feedPromises);

        // Count results
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                feedsRefreshed++;
            } else {
                feedsFailed++;
                Logger.error(`Feed processing failed: ${result.reason}`);
            }
        });

        // Count new articles by comparing before and after URLs
        const afterArticles = new Set();
        Array.from(this.desklet.items.values()).forEach(item => afterArticles.add(item.link));

        // Count items that exist after but didn't exist before
        afterArticles.forEach(url => {
            if (!beforeArticles.has(url)) {
                newArticleCount++;
            }
        });

        Logger.info(`Found ${newArticleCount} new articles in this refresh`);

        // Record refresh event
        if (this.desklet.databaseManager) {
            try {
                const refreshEvent = {
                    timestamp: refreshTimestamp,
                    articleCount: newArticleCount,
                    feedsRefreshed: feedsRefreshed,
                    feedsFailed: feedsFailed,
                    totalArticles: this.desklet.items.size
                };
                Logger.debug(`Recording refresh event: ${JSON.stringify(refreshEvent)}`);
                await this.desklet.databaseManager.recordRefresh(newArticleCount, feedsRefreshed);

                // Update refresh history
                if (this.desklet.refreshHistory) {
                    this.desklet.refreshHistory.unshift(refreshEvent);
                    // Keep only last 50 refresh events
                    if (this.desklet.refreshHistory.length > 50) {
                        this.desklet.refreshHistory.slice(0, 50);
                    }
                    Logger.debug(`Updated refreshHistory array: ${this.desklet.refreshHistory.length} events`);
                } else {
                    Logger.debug(`refreshHistory not available for update`);
                }
            } catch (e) {
                Logger.error('Error recording refresh event: ' + e);
            }
        } else {
            Logger.debug(`Database manager not available for recording refresh event`);
        }

        // Update last refresh timestamp
        this.desklet.lastRefresh = new Date();

        // Update header to show completion with summary
        if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
            const now = new Date();
            const timeString = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            let summaryText = `Yarr (${newArticleCount} new, ${this.desklet.items.size} total)`;
            if (feedsFailed > 0) {
                summaryText += ` - ${feedsRefreshed}/${feeds.length} feeds OK, ${feedsFailed} failed`;
            }
            summaryText += ` - ${timeString}`;

            this.desklet.uiDisplay.setSimpleHeaderTitle(summaryText);
        }

        Logger.debug(`Feed collection completed: ${newArticleCount} new articles, ${feedsRefreshed} feeds refreshed, ${feedsFailed} feeds failed`, false, 'basic');

        // Force display update after feed collection completes
        if (this.desklet.uiDisplay && this.desklet.uiDisplay.displayItems) {
            Logger.info('Forcing display update after feed collection completion');
            setTimeout(() => {
                try {
                    this.desklet.uiDisplay.displayItems();
                    Logger.info('Display update completed successfully');
                } catch (e) {
                    Logger.error('Error in direct display update: ' + e);
                }
            }, 100);
        }

        // Get total articles count for logging and display updates
        const totalArticles = this.desklet.items.size;

        // Always update the display to show current state, even if some feeds failed
        // This is especially important for initial load after restart when there might be existing articles
        if (this.desklet.uiDisplay) {
            Logger.debug(`Updating display after feed collection - ${newArticleCount} new articles, ${feedsFailed} feeds failed, total articles: ${totalArticles}`);

            // Update display even if no new articles but we have existing ones (important for restart)
            if (newArticleCount > 0 || totalArticles > 0) {
                setTimeout(() => {
                    try {
                        Logger.debug(`Calling safeDisplayUpdate() to update UI`);
                        this.desklet.safeDisplayUpdate('feed collection completed');
                        Logger.debug(`safeDisplayUpdate() completed successfully`);
                    } catch (error) {
                        Logger.error(`[DEBUG] Error calling displayItems(): ${error}`);

                        // Fallback: try to force a display update
                        try {
                            Logger.debug(`Attempting fallback display update`);
                            if (this.desklet.uiDisplay && this.desklet.uiDisplay.displayItems) {
                                this.desklet.safeDisplayUpdate('feed collection UI update');
                                Logger.debug(`Fallback display update completed`);
                            }
                        } catch (fallbackError) {
                            Logger.error(`[DEBUG] Fallback display update also failed: ${fallbackError}`);
                        }
                    }
                }, 1);
            } else {
                Logger.debug(`No articles to display, skipping display update`);
            }
        } else {
            Logger.debug(`uiDisplay not available, cannot update display`);
        }

        // If we have articles but some feeds failed, log a warning but don't treat it as a complete failure
        if (totalArticles > 0 && feedsFailed > 0) {
            Logger.debug(`Feed collection completed with ${feedsFailed} failed feeds, but ${totalArticles} articles are available for display`);
        }

        // If no articles at all and some feeds failed, this might indicate a serious problem
        if (totalArticles === 0 && feedsFailed > 0) {
            Logger.error(`No articles available after feed collection - ${feedsFailed} feeds failed. This might indicate a configuration issue.`);
        }

        // Schedule retry of failed feeds after a delay (if any failed)
        if (feedsFailed > 0) {
            Logger.info(`Scheduling retry of ${feedsFailed} failed feeds in 5 minutes`);
            setTimeout(() => {
                Logger.info(`Retrying failed feeds...`);
                this._retryFailedFeeds();
            }, 5 * 60 * 1000); // 5 minutes
        }

        // Clear refreshing flag
        this._isRefreshing = false;

        // Ensure the desklet is ready for the next collection cycle
        Logger.debug(`Feed collection cycle completed. Ready for next update.`, false, 'basic');
    }



    async _fetchFeed(url) {
        try {
            return await this.httpRequest('GET', url);
        } catch (error) {
            Logger.error(`Error fetching feed from ${url}: ${error}`);
            throw error;
        }
    }

    _addProcessedItems(processedItems, feed, refreshTimestamp) {
        try {
            Logger.debug(`_addProcessedItems called with ${processedItems.length} items from feed ${feed.name}`);

            processedItems.forEach((itemData, index) => {
                // Generate map key using simple hash
                const key = this._simpleHash(itemData.link);
                Logger.debug(`Processing item ${index + 1}: ${itemData.title} with key: ${key}`);

                // Check if this item already exists as a favorite
                const existingItem = Array.from(this.desklet.items.values())
                    .find(existing =>
                        existing.isFavorite &&
                        existing.link === itemData.link
                    );

                // Skip if item exists as a favorite
                if (existingItem) {
                    Logger.debug(`Skipping item ${itemData.title} - already exists as favorite`);
                    return;
                }

                // Check if the item already exists in our map
                const existingNonFavorite = this.desklet.items.get(key);

                // NEVER overwrite existing favorites - preserve the saved favorite version
                if (existingNonFavorite && existingNonFavorite.isFavorite) {
                    Logger.debug(`Skipping feed update for favorite item: ${itemData.title} - preserving saved version`);
                    return;
                }

                if (existingNonFavorite) {
                    Logger.debug(` Item ${itemData.title} already exists, updating...`);
                }

                // Check for cached article data to save costs
                let cachedArticleData = null;
                if (itemData.link && this.desklet.databaseManager && !existingNonFavorite?.aiResponse) {
                    // Only check cache if we don't already have an AI response
                    this.desklet.databaseManager.getArticleFromCache(key).then(cachedArticle => {
                        if (cachedArticle && cachedArticle.aiResponse) {
                            Logger.info(`Found cached article data for feed item: ${itemData.title} (saving API costs)`);

                            // Update the item with all cached data
                            const currentItem = this.desklet.items.get(key);
                            if (currentItem) {
                                // Restore all cached attributes
                                currentItem.title = cachedArticle.title || currentItem.title;
                                currentItem.description = cachedArticle.description || currentItem.description;
                                currentItem.category = cachedArticle.category || currentItem.category;
                                currentItem.channel = cachedArticle.channel || currentItem.channel;
                                currentItem.labelColor = cachedArticle.labelColor || currentItem.labelColor;
                                currentItem.pubDate = cachedArticle.pubDate || currentItem.pubDate;
                                currentItem.timestamp = cachedArticle.timestamp || currentItem.timestamp;
                                currentItem.aiResponse = cachedArticle.aiResponse;

                                // Trigger display update to show cached data
                                setTimeout(() => {
                                    if (this.desklet.safeDisplayUpdate) {
                                        this.desklet.safeDisplayUpdate('cached feed data loaded');
                                    }
                                }, 1);
                            }
                        } else {
                            // Cache this article data for future use (even without AI response)
                            this.desklet.databaseManager.cacheArticleData(key, itemData.link, {
                                title: itemData.title || '',
                                description: itemData.description || '',
                                category: itemData.category || '',
                                channel: itemData.channel || '',
                                labelColor: itemData.labelColor || '#ffffff',
                                pubDate: itemData.pubDate || '',
                                timestamp: itemData.timestamp || Date.now()
                            }).catch(e => {
                                Logger.error('Error caching feed article data: ' + e);
                            });
                        }
                    }).catch(e => {
                        Logger.error('Error checking article cache for feed item: ' + e);
                    });
                }

                // Add new item or update existing one
                this.desklet.items.set(key, {
                    channel: itemData.channel,
                    timestamp: itemData.timestamp,
                    pubDate: itemData.pubDate,
                    title: itemData.title,
                    link: itemData.link,
                    category: itemData.category,
                    description: itemData.description,
                    labelColor: itemData.labelColor,
                    // CRITICAL FIX: Preserve existing aiResponse and isFavorite status
                    aiResponse: existingNonFavorite?.aiResponse || '',
                    isFavorite: existingNonFavorite?.isFavorite || false,  // Preserve existing favorite status
                    key: key,
                    downloadTimestamp: refreshTimestamp
                });

            });

            Logger.debug(` _addProcessedItems completed. Desklet now has ${this.desklet.items.size} items`);
        } catch (e) {
            Logger.error('Error adding processed items: ' + e);
        }
    }

    // Simple synchronous hash function for generating keys
    _simpleHash(str) {
        let hash = 0;
        if (typeof str !== 'string') return '0';
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString();
    }

    setUpdateTimer(timeOut) {
        Logger.debug(`setUpdateTimer called with timeout: ${timeOut} seconds`, false, 'basic');
        Logger.debug(`Current feeds count: ${this.desklet.feeds ? this.desklet.feeds.length : 'null'}`, false, 'basic');
        Logger.debug(`Active feeds count: ${this.desklet.feeds ? this.desklet.feeds.filter(f => f?.active).length : 'null'}`, false, 'basic');

        if (this.desklet._setUpdateTimerInProgress) {
            Logger.debug('setUpdateTimer: timer already in progress, returning', false, 'basic');
            return;
        }
        this.desklet._setUpdateTimerInProgress = true;

        try {
            // Clear existing timer if any
            if (this.desklet.timerInProgress) {
                try {
                    Mainloop.source_remove(this.desklet.timerInProgress);
                } catch (e) {
                    Logger.error('Error removing existing timer: ' + e);
                }
                this.desklet.timerInProgress = 0;
            }

            // Set delay: respect the requested timeout for immediate updates, otherwise use user-defined delay
            Logger.debug(`setUpdateTimer - timeOut: ${timeOut}, this.delay: ${this.desklet.delay}`, false, 'basic');
            const delay = (timeOut <= 60)
                ? timeOut  // Allow immediate updates (up to 60 seconds)
                : Math.max(300, this.desklet.delay);  // Use user-defined delay for regular updates
            Logger.info(`setUpdateTimer - calculated delay: ${delay}`);

            // Create new timer
            Logger.debug(`Creating timer with delay: ${delay} seconds`, false, 'basic');

            this.desklet.timerInProgress = Mainloop.timeout_add_seconds(delay, () => {
                Logger.debug(`Timer callback executed for timer ID: ${this.desklet.timerInProgress}`, false, 'basic');
                Logger.debug(`About to call onTimerEvent...`, false, 'basic');
                Logger.debug(`Current feeds count: ${this.desklet.feeds ? this.desklet.feeds.length : 'null'}`, false, 'basic');
                // Clear timer ID since it's about to fire
                this.desklet.timerInProgress = 0;

                // Execute timer event
                this.onTimerEvent();

                // Return false to prevent auto-repeat
                return false;
            });

            if (!this.desklet.timerInProgress) {
                Logger.error('Failed to create timer');
            } else {
                Logger.info(`Timer created successfully with ID: ${this.desklet.timerInProgress}`);
            }

        } catch (e) {
            Logger.error('Error in setUpdateTimer: ' + e);
            this.desklet.timerInProgress = 0;
        } finally {
            this.desklet._setUpdateTimerInProgress = false;
        }
    }

    onTimerEvent() {
        Logger.debug(`onTimerEvent called - _updateInProgress: ${this.desklet._updateInProgress}`, false, 'basic');
        Logger.debug(`refreshEnabled: ${this.desklet.refreshEnabled}`, false, 'basic');
        Logger.debug(`feeds count: ${this.desklet.feeds ? this.desklet.feeds.length : 'null'}`, false, 'basic');

        // Prevent concurrent updates
        if (this.desklet._updateInProgress) {
            Logger.debug('onTimerEvent: update in progress, rescheduling timer', false, 'basic');
            this.setUpdateTimer(this.desklet.delay);
            return;
        }

        Logger.debug(`Setting _updateInProgress to true and starting feed collection...`, false, 'basic');
        this.desklet._updateInProgress = true;

        try {
            // Execute feed collection with timeout to avoid hangs
            if (this.desklet.asyncErrorHandler) {
                this.desklet.asyncErrorHandler.withTimeout(() => this.collectFeeds(), 60000) // Increased to 60 seconds for parallel processing
                    .then(() => {
                        Logger.debug('Feed collection completed successfully via timer', false, 'basic');
                    })
                    .catch(error => {
                        Logger.error('Error collecting feeds via timer: ' + error);
                    })
                    .finally(() => {
                        this.desklet._updateInProgress = false;
                        Logger.debug('Feed collection completed, scheduling next update', false, 'basic');
                        // Schedule next update
                        if (this.desklet.refreshEnabled) {
                            this.setUpdateTimer(this.desklet.delay);
                        }
                    });
            } else {
                // Fallback if async error handler is not available
                this.collectFeeds()
                    .then(() => {
                        Logger.debug('Feed collection completed successfully via timer (fallback)', false, 'basic');
                    })
                    .catch(error => {
                        Logger.error('Error collecting feeds via timer (fallback): ' + error);
                    })
                    .finally(() => {
                        this.desklet._updateInProgress = false;
                        if (this.desklet.refreshEnabled) {
                            this.setUpdateTimer(this.desklet.delay);
                        }
                    });
            }
        } catch (e) {
            Logger.error('Error in timer event: ' + e);
            this.desklet._updateInProgress = false;
            if (this.desklet.refreshEnabled) {
                this.setUpdateTimer(this.desklet.delay);
            }
        }
    }

    onRefreshClicked() {
        Logger.debug('Manual refresh button clicked - starting feed collection', false, 'basic');

        // Set refresh icon to indicate loading
        if (this.desklet.refreshIcon) {
            this.desklet.refreshIcon.set_icon_name('process-working');
        }

        // Update header to show manual refresh starting
        if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
            this.desklet.uiDisplay.setSimpleHeaderTitle('Manual refresh starting...');
        }

        // If feed collection is already in progress, wait for it to complete
        if (this._isRefreshing || this.desklet._updateInProgress) {
            Logger.info('Feed collection already in progress, waiting for completion...');
            return;
        }

        // Set both flags to prevent concurrent operations
        this._isRefreshing = true;
        this.desklet._updateInProgress = true;
        Logger.debug('Starting manual feed collection with asyncErrorHandler', false, 'basic');

        if (this.desklet.asyncErrorHandler) {
            Logger.debug('Using asyncErrorHandler for manual refresh', false, 'basic');
            this.desklet.asyncErrorHandler.withTimeout(() => this.collectFeeds(), 60000) // Increased to 60 seconds for parallel processing
                .then(() => {
                    // Reset icon after successful refresh
                    if (this.desklet.refreshIcon) {
                        this.desklet.refreshIcon.set_icon_name('reload');
                    }

                    // Update header to show refresh completed
                    if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
                        const totalArticles = this.desklet.items.size;
                        const now = new Date();
                        const timeString = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                        this.desklet.uiDisplay.setSimpleHeaderTitle(`Yarr (${totalArticles} articles) - ${timeString}`);
                    }
                })
                .catch(error => {
                    // Reset icon and log error
                    if (this.desklet.refreshIcon) {
                        this.desklet.refreshIcon.set_icon_name('reload');
                    }
                    Logger.debug('Error refreshing feeds:', error);

                    // Update header to show error
                    if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
                        this.desklet.uiDisplay.setSimpleHeaderTitle('Refresh failed - check logs');
                    }
                })
                .finally(() => {
                    this.desklet._updateInProgress = false;
                    this._isRefreshing = false;
                });
        } else {
            // Fallback with timeout
            Logger.debug('Using fallback method for manual refresh', false, 'basic');
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Manual refresh timed out after 60 seconds')), 60000);
            });

            Promise.race([this.collectFeeds(), timeoutPromise])
                .then(() => {
                    if (this.desklet.refreshIcon) {
                        this.desklet.refreshIcon.set_icon_name('reload');
                    }

                    // Update header to show refresh completed
                    if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
                        const totalArticles = this.desklet.items.size;
                        const now = new Date();
                        const timeString = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                        this.desklet.uiDisplay.setSimpleHeaderTitle(`Yarr (${totalArticles} articles) - ${timeString}`);
                    }
                })
                .catch(error => {
                    if (this.desklet.refreshIcon) {
                        this.desklet.refreshIcon.set_icon_name('reload');
                    }
                    Logger.debug('Error refreshing feeds:', error);

                    // Update header to show error
                    if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
                        this.desklet.uiDisplay.setSimpleHeaderTitle('Refresh failed - check logs');
                    }
                })
                .finally(() => {
                    this.desklet._updateInProgress = false;
                    this._isRefreshing = false;
                });
        }

        // Don't reset the timer - manual refresh should not interfere with automatic refresh schedule
    }

    // HTTP request creator function
    httpRequest(method, url, headers = null, body = null) {
        return new Promise((resolve, reject) => {
            try {
                // Check if httpSession is null and reinitialize if needed
                if (!this.desklet.httpSession) {
                    Logger.info('HTTP session is null, reinitializing...');
                    if (Soup.MAJOR_VERSION === 2) {
                        this.desklet.httpSession = new Soup.SessionAsync();
                        Soup.Session.prototype.add_feature.call(this.desklet.httpSession, new Soup.ProxyResolverDefault());
                    } else {
                        this.desklet.httpSession = new Soup.Session();
                    }
                    this.desklet.httpSession.timeout = 60;
                    this.desklet.httpSession.idle_timeout = 60;
                    this.desklet.httpSession.user_agent = 'Mozilla/5.0 YarrDesklet/1.0';
                    Logger.info('HTTP session reinitialized successfully');
                }

                const message = Soup.Message.new(method, url);
                if (!message) {
                    throw new Error(`Failed to create message for URL: ${url}`);
                }

                // Add headers
                message.request_headers.append('User-Agent', 'Mozilla/5.0 YarrDesklet/1.0');
                if (headers) {
                    headers.forEach(([key, value]) => {
                        message.request_headers.append(key, value);
                    });
                }

                // Add body for POST requests
                if (method === 'POST' && body) {
                    if (Soup.MAJOR_VERSION === 2) {
                        message.set_request('application/json', 2, body);
                    } else {
                        message.set_request_body_from_bytes('application/json',
                            new GLib.Bytes(body));
                    }
                }

                // Add a hard timeout as a safety net - use 15 seconds like backup version
                let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
                    reject(new Error('HTTP request timed out after 15 seconds'));
                    return GLib.SOURCE_REMOVE;
                });

                const clearTimeout = () => {
                    if (timeoutId) {
                        try { GLib.source_remove(timeoutId); } catch (e) { }
                        timeoutId = 0;
                    }
                };

                // Handle Soup v2 vs v3
                if (Soup.MAJOR_VERSION === 2) {
                    this.desklet.httpSession.queue_message(message, (session, response) => {
                        clearTimeout();
                        if (response.status_code !== 200) {
                            reject(new Error(`HTTP ${response.status_code}: ${response.reason_phrase}`));
                            return;
                        }
                        resolve(message.response_body.data);
                    });
                } else {
                    this.desklet.httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
                        (session, result) => {
                            try {
                                const bytes = session.send_and_read_finish(result);
                                clearTimeout();
                                if (!bytes) {
                                    reject(new Error('No response data'));
                                    return;
                                }
                                const response = ByteArray.toString(bytes.get_data());
                                resolve(response);
                            } catch (error) {
                                clearTimeout();
                                reject(error);
                            }
                        });
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    // Throttle expensive full list rebuilds to keep UI responsive while downloading
    _scheduleThrottledDisplay(intervalMs = 1000) {
        try {
            // During bulk refresh, avoid heavy rebuilds entirely; final update will happen at the end
            if (this._isRefreshing) return;
            if (this._uiUpdateTimer && this._uiUpdateTimer !== 0) return;
            this._uiUpdateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, intervalMs, () => {
                this._uiUpdateTimer = 0;
                // Don't refresh during bulk feed collection - wait for final update
                if (!this._isRefreshing) {
                    try { this.desklet.displayItems(); } catch (_e) { }
                }
                return GLib.SOURCE_REMOVE;
            });
        } catch (_ignored) { }
    }

    // Yield control to main loop to keep UI responsive
    _yieldToMainLoop() {
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    // Abort current feed collection
    abortFeedCollection() {
        if (this._isRefreshing) {
            Logger.info('Aborting feed collection...');
            this._isRefreshing = false;
        }
    }

    // Check if feed collection is in progress
    isRefreshing() {
        return this._isRefreshing;
    }

    _cancelThrottledDisplay() {
        try {
            if (this._uiUpdateTimer && this._uiUpdateTimer !== 0) {
                Mainloop.source_remove(this._uiUpdateTimer);
                this._uiUpdateTimer = 0;
            }
        } catch (_ignored) { this._uiUpdateTimer = 0; }
    }

    _formatTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 0) {
            return 'in the future';
        }

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const months = Math.floor(days / 30);
        const years = Math.floor(months / 12);

        if (seconds < 60) {
            return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
        } else if (minutes < 60) {
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (hours < 24) {
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else if (days < 30) {
            return `${days} day${days > 1 ? 's' : ''} ago`;
        } else if (months < 12) {
            return `${months} month${months > 1 ? 's' : ''} ago`;
        } else {
            return `${years} year${years > 1 ? 's' : ''} ago`;
        }
    }

    async _processFeedAsync(feed, feedIndex, totalFeeds) {
        return new Promise((resolve, reject) => {
            // Use setTimeout to make this truly asynchronous and non-blocking
            setTimeout(async () => {
                try {
                    Logger.debug(`Processing feed ${feedIndex}/${totalFeeds}: ${feed.name} from URL: ${feed.url}`);

                    // Update header to show progress for this specific feed
                    if (this.desklet.uiDisplay && this.desklet.uiDisplay.setSimpleHeaderTitle) {
                        const percentage = Math.round((feedIndex / totalFeeds) * 100);
                        this.desklet.uiDisplay.setSimpleHeaderTitle(`Refreshing: ${feed.name} (${percentage}%)`);
                    }

                    const xmlData = await this.httpRequest('GET', feed.url);
                    Logger.debug(`Got response for ${feed.name}: ${xmlData ? 'success' : 'failed'}`);

                    if (xmlData && xmlData.length > 0) {
                        Logger.debug(`Processing feed using feed processor: ${feed.name}`);

                        // Use the feed processor
                        if (this.desklet.feedProcessor) {
                            const processedItems = this.desklet.feedProcessor.processFeedResult(feed, xmlData, this.desklet.enableDebugLogs);
                            Logger.debug(`Feed processor result for ${feed.name}:`, processedItems);

                            if (processedItems && Array.isArray(processedItems) && processedItems.length > 0) {
                                Logger.debug(`Found ${processedItems.length} processed items from ${feed.name}`);

                                // Add processed items to the desklet using the proper method
                                Logger.debug(`Adding ${processedItems.length} processed items to desklet from ${feed.name}`);
                                this._addProcessedItems(processedItems, feed, Date.now());
                                Logger.debug(`After _addProcessedItems, desklet has ${this.desklet.items.size} total items`);

                                Logger.debug(`Successfully processed ${processedItems.length} items from ${feed.name}`);
                            } else {
                                Logger.debug(`No processed items found for ${feed.name}:`, processedItems);
                            }
                        } else {
                            Logger.debug(`Feed processor not available for ${feed.name}`);
                        }
                    } else {
                        Logger.debug(`No XML data received for ${feed.name}`);
                    }

                    resolve();
                } catch (error) {
                    Logger.error(`Error processing feed ${feed.name}: ${error}`);
                    reject(error);
                }
            }, 1);
        });
    }

    async _retryFailedFeeds() {
        try {
            Logger.info('Starting retry of failed feeds...');

            // Get active feeds that might have failed
            const feeds = this.desklet.feeds ? this.desklet.feeds.filter(f => f.active) : [];
            if (feeds.length === 0) {
                Logger.debug('No active feeds to retry', false, 'basic');
                return;
            }

            // Try to process each feed individually in parallel
            const retryPromises = feeds.map(feed => {
                return this._processFeedAsync(feed, 1, 1).catch(error => {
                    Logger.error(`Failed to retry feed ${feed.name}: ${error}`);
                    return null;
                });
            });

            // Wait for all retries to complete
            await Promise.allSettled(retryPromises);

            // Update display after retry only if not in bulk refresh
            if (this.desklet.uiDisplay && !this._isRefreshing) {
                setTimeout(() => {
                    try {
                        this.desklet.safeDisplayUpdate('feed retry completed');
                        Logger.debug('Display updated after retry attempt', false, 'basic');
                    } catch (error) {
                        Logger.error('Error updating display after retry: ' + error);
                    }
                }, 1);
            }
        } catch (error) {
            Logger.error('Error in retry attempt: ' + error);
        }
    }


}

module.exports = { FeedCollection };
