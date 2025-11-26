const GLib = imports.gi.GLib;
const Secret = imports.gi.Secret;
const ByteArray = imports.byteArray;

const Logger = require('./logger');

// Helper function to get GLib
function getGLib() {
    return GLib;
}

/**
 * AI Managers Module
 * Handles AI summarization, API calls, and provider management
 */

class AIManagers {
    constructor(desklet) {
        this.desklet = desklet;
        this._initializeSecretSchemas();
        this._lastRequestTime = 0;
        this._minRequestInterval = 2000; // Minimum 2 seconds between requests
    }

    _initializeSecretSchemas() {
        // Initialize Secret schema for API key storage (same as backup for compatibility)
        this.API_KEY_SCHEMA = new Secret.Schema("org.YarrDesklet.Schema", Secret.SchemaFlags.NONE, {});
    }

    async summarizeUri(dumptool, item, lineBox, sumIcon) {
        // Check for cached article data first to save costs
        if (item.link && this.desklet.databaseManager) {
            try {
                const articleHash = this.desklet.utilities.simpleHash(item.link);
                const cachedArticle = await this.desklet.databaseManager.getArticleFromCache(articleHash);

                if (cachedArticle && cachedArticle.aiResponse) {
                    Logger.info(`Using cached article data for: ${item.title || 'Untitled'} (saving API costs)`);

                    // Restore all cached attributes
                    item.title = cachedArticle.title || item.title;
                    item.description = cachedArticle.description || item.description;
                    item.category = cachedArticle.category || item.category;
                    item.channel = cachedArticle.channel || item.channel;
                    item.labelColor = cachedArticle.labelColor || item.labelColor;
                    item.pubDate = cachedArticle.pubDate || item.pubDate;
                    item.timestamp = cachedArticle.timestamp || item.timestamp;
                    item.aiResponse = cachedArticle.aiResponse;

                    // Update display to show cached data
                    if (this.desklet.safeDisplayUpdate) {
                        this.desklet.safeDisplayUpdate('AI response loaded');
                    }

                    // Update icon to show cached response
                    if (sumIcon) {
                        sumIcon.set_icon_name('document-edit-symbolic');
                    }

                    return cachedArticle.aiResponse;
                }
            } catch (e) {
                Logger.error('Error checking article cache: ' + e);
                // Continue with normal API call if cache check fails
            }
        }

        // Rate limiting to prevent overwhelming the system
        const now = Date.now();
        const timeSinceLastRequest = now - this._lastRequestTime;
        if (timeSinceLastRequest < this._minRequestInterval) {
            const waitTime = this._minRequestInterval - timeSinceLastRequest;
            Logger.debug(`Rate limiting: waiting ${waitTime}ms before next AI request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this._lastRequestTime = Date.now();

        Logger.info(`Starting AI summary for: ${item.title || 'Untitled'}`);

        // Update icon to show processing started
        if (sumIcon) {
            sumIcon.set_icon_name('process-working-symbolic');
        }

        // Add timeout wrapper to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI summary request timed out after 30 seconds')), 30000);
        });

        try {
            const result = await Promise.race([
                this._performSummarization(dumptool, item, lineBox, sumIcon),
                timeoutPromise
            ]);
            Logger.info(`AI summary completed successfully for: ${item.title || 'Untitled'}`);
            return result;
        } catch (error) {
            Logger.error(`AI summary failed for ${item.title || 'Untitled'}: ${error.message}`);
            if (sumIcon) {
                sumIcon.set_icon_name('dialog-error-symbolic');
            }
            throw error;
        }
    }

    async _performSummarization(dumptool, item, lineBox, sumIcon) {
        // Get API key using the common schema
        const apiKey = await Secret.password_lookup_sync(this.API_KEY_SCHEMA, {}, null);
        if (!apiKey) {
            throw new Error('No API key found. Please set your API key in settings.');
        }

        // Determine API endpoint and headers based on provider
        let apiUrl, apiHeaders;

        // Check if custom URL override is enabled
        if (this.desklet.ai_provider === 'custom' || (this.desklet.ai_use_custom_url && this.desklet.ai_url)) {
            // Use custom URL override
            apiUrl = this.desklet.ai_url;
        } else {
            // Use provider default URL
            switch (this.desklet.ai_provider) {
                case 'openai':
                    apiUrl = 'https://api.openai.com/v1/chat/completions';
                    break;
                case 'deepseek':
                    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
                    break;
                case 'anthropic':
                    apiUrl = 'https://api.anthropic.com/v1/messages';
                    break;
                default:
                    apiUrl = 'https://api.openai.com/v1/chat/completions';
            }
        }

        // Set headers based on provider (regardless of URL)
        switch (this.desklet.ai_provider) {
            case 'openai':
            case 'deepseek':
            case 'custom':
                apiHeaders = [
                    ['Content-Type', 'application/json'],
                    ['Authorization', `Bearer ${apiKey}`]
                ];
                break;
            case 'anthropic':
                apiHeaders = [
                    ['Content-Type', 'application/json'],
                    ['x-api-key', apiKey],
                    ['anthropic-version', '2023-06-01']
                ];
                break;
            default:
                apiHeaders = [
                    ['Content-Type', 'application/json'],
                    ['Authorization', `Bearer ${apiKey}`]
                ];
        }

        // Preserve the current favorite status before making changes
        const wasFavorite = item.isFavorite;

        // Use async command execution to prevent UI blocking
        Logger.info(`Fetching article content for: ${item.title || 'Untitled'}`);

        let articleContent;
        try {
            articleContent = await this._getArticleContentAsync(dumptool, item);
            Logger.info(`Article content fetched successfully via async method, length: ${articleContent.length} chars`);
        } catch (error) {
            Logger.debug(`Async content fetch failed, trying fallback: ${error.message}`);
            articleContent = await this._getArticleContentFallback(dumptool, item);
            Logger.info(`Article content fetched successfully via fallback method, length: ${articleContent.length} chars`);
        }

        // Limit content length to prevent API issues
        let finalContent = articleContent;
        if (finalContent.length > 16384) {
            finalContent = finalContent.substring(0, 16384);
        }

        // Determine which model to use
        let modelToUse;
        if (this.desklet.ai_use_standard_model === 'optionstandard') {
            // Use the selected standard model
            modelToUse = this.desklet.ai_model;
        } else if (this.desklet.ai_use_standard_model === 'optioncustom') {
            // Use custom model directly
            modelToUse = this.desklet.ai_custom_model;
        } else {
            // Fallback to standard model
            modelToUse = this.desklet.ai_model;
        }

        const requestBody = {
            model: modelToUse,
            messages: [
                {
                    role: "system",
                    content: this.desklet.ai_systemprompt
                },
                {
                    role: "user",
                    content: finalContent
                }
            ],
            temperature: this.desklet.temperature
        };

        Logger.info(`Sending API request to: ${apiUrl}`);
        const response = await this.desklet.feedCollection.httpRequest(
            'POST',
            apiUrl,
            apiHeaders,
            JSON.stringify(requestBody)
        );
        Logger.info(`API response received, processing...`);

        let jsonResponse;
        try {
            // Better response validation
            if (!response) {
                throw new Error('No response received from API');
            }

            let responseData;
            if (response.response_body && response.response_body.data) {
                responseData = response.response_body.data;
            } else if (typeof response === 'string') {
                responseData = response;
            } else if (response.data) {
                responseData = response.data;
            } else {
                throw new Error('Invalid response format from API');
            }

            // Validate response data before parsing
            if (!responseData || typeof responseData !== 'string') {
                throw new Error(`Invalid response data type: ${typeof responseData}`);
            }

            jsonResponse = JSON.parse(responseData);

            // Log the parsed JSON response for inspection if parsing is successful
            if (this.desklet.enableDebugLogs) {
                Logger.debug(`Parsed JSON Response: ${JSON.stringify(jsonResponse, null, 2)}`);
            }
        } catch (e) {
            if (this.desklet.enableDebugLogs) {
                Logger.debug(`ERROR: Failed to parse JSON response. Raw response: "${response}". Error: ${e.message}`);
            }
            throw new Error(`Failed to parse API response: ${e.message}`);
        }

        // Enhanced JSON structure validation
        if (!jsonResponse) {
            throw new Error('API response is null or undefined');
        }

        if (typeof jsonResponse !== 'object') {
            throw new Error(`API response is not an object: ${typeof jsonResponse}`);
        }

        if (!jsonResponse.choices) {
            throw new Error(`API response missing 'choices' field. Response: ${JSON.stringify(jsonResponse, null, 2)}`);
        }

        if (!Array.isArray(jsonResponse.choices)) {
            throw new Error(`API response 'choices' is not an array: ${typeof jsonResponse.choices}`);
        }

        if (jsonResponse.choices.length === 0) {
            throw new Error('API response choices array is empty');
        }

        if (!jsonResponse.choices[0]) {
            throw new Error('API response first choice is null or undefined');
        }

        if (!jsonResponse.choices[0].message) {
            throw new Error(`API response first choice missing 'message' field: ${JSON.stringify(jsonResponse.choices[0], null, 2)}`);
        }

        if (!jsonResponse.choices[0].message.content) {
            throw new Error(`API response message missing 'content' field: ${JSON.stringify(jsonResponse.choices[0].message, null, 2)}`);
        }

        // Preserve the favorite status while updating aiResponse
        item.aiResponse = "";

        if (this.desklet.ai_add_description_to_summary && item.description && typeof item.description === 'string' && item.description.trim()) {
            item.aiResponse = this.HTMLPartToTextPart(item.description).replace(/\n/ig, ' ') + '\n----\n';
        } else if (item.channel === 'Manual' && (!item.description || typeof item.description !== 'string' || !item.description.trim())) {
            // For manual entries without description, add a note
            item.aiResponse = '[Manual entry - summarized from URL content]\n----\n';
        } else {
            item.aiResponse = '';
        }

        item.aiResponse += jsonResponse.choices[0].message.content;

        // Cache the complete article data to save future API costs
        if (item.link && this.desklet.databaseManager) {
            try {
                const articleHash = this.desklet.utilities.simpleHash(item.link);
                const provider = this.desklet.ai_provider || 'unknown';
                const model = this.desklet.ai_model || this.desklet.ai_custom_model || 'unknown';

                // Prepare article data for comprehensive caching
                const articleData = {
                    title: item.title || '',
                    description: item.description || '',
                    category: item.category || '',
                    channel: item.channel || '',
                    labelColor: item.labelColor || '#ffffff',
                    pubDate: item.pubDate || '',
                    timestamp: item.timestamp || Date.now()
                };

                await this.desklet.databaseManager.saveArticleToCache(
                    articleHash,
                    item.link,
                    articleData,
                    item.aiResponse,
                    provider,
                    model
                );

                Logger.info(`Complete article data cached for: ${item.title || 'Untitled'} (will save future API costs)`);
            } catch (e) {
                Logger.error('Error caching article data: ' + e);
                // Don't fail the operation if caching fails
            }
        }

        // Ensure favorite status is preserved
        item.isFavorite = wasFavorite;

        // If the item was a favorite, ensure it's still in the favorites database
        if (wasFavorite && this.desklet.favoritesManagers) {
            try {
                await this.desklet.favoritesManagers.addFavorite(item);
                Logger.debug('Favorite status preserved via FavoritesManagers after AI summary');
            } catch (e) {
                Logger.error('Error preserving favorite status after AI summary: ' + e);
            }
        }

        // Ensure all required properties are defined before updating display
        if (typeof item.isFavorite === 'undefined') {
            item.isFavorite = false;
        }
        if (typeof item.key === 'undefined') {
            item.key = item.link || `ai_${Date.now()}`;
        }

        Logger.info('Updating display with AI summary result');

        // CRITICAL FIX: Direct UI update only - no display refresh needed
        // Just like the AI Summary icon updates, we update the UI directly
        if (this.desklet.uiDisplay && this.desklet.uiDisplay._insertAIResponseDirectly) {
            // Add small delay to ensure DOM is ready
            setTimeout(() => {
                try {
                    this.desklet.uiDisplay._insertAIResponseDirectly(item, item.aiResponse);
                    Logger.debug('AI response inserted directly into DOM - no display refresh needed');
                } catch (e) {
                    Logger.error('Error inserting AI response directly: ' + e);
                    // No fallback display update - just log the error
                    // The user will see the AI response on the next natural display update
                    Logger.debug('AI response will be visible on next natural display update');
                }
            }, 100); // 100ms delay to ensure DOM is ready
        } else {
            // No direct insertion method available - just log
            Logger.debug('Direct AI response insertion method not available');
            Logger.debug('AI response will be visible on next natural display update');
        }

        if (sumIcon) {
            sumIcon.set_icon_name('document-edit-symbolic');
        }
    }

    // New async method to get article content without blocking UI
    async _getArticleContentAsync(dumptool, item) {
        return new Promise((resolve, reject) => {
            try {
                Logger.debug(`AI Managers: Starting content fetch for: ${item.title || 'Untitled'}`);
                Logger.debug(`AI Managers: URL to fetch: "${item.link}"`);
                Logger.debug(`AI Managers: Dumptool: ${dumptool}`);

                // Validate URL before proceeding
                if (!item.link || typeof item.link !== 'string') {
                    throw new Error(`Invalid URL: ${item.link}`);
                }

                // Check if URL looks valid
                if (!item.link.startsWith('http://') && !item.link.startsWith('https://')) {
                    throw new Error(`Invalid URL scheme: ${item.link}`);
                }

                Logger.debug(`AI Managers: URL validation passed`);

                // Use a simpler approach with GLib.spawn_async_with_pipes
                const glib = getGLib();

                // Properly escape the URL for shell command
                const escapedUrl = item.link.replace(/'/g, "'\"'\"'");
                const command = `/usr/bin/timeout -k 15 15 /usr/bin/${dumptool} -dump '${escapedUrl}' || echo 'ERROR: TIMEOUT'`;

                Logger.debug(`AI Managers: Full command: ${command}`);

                let [success, argv] = glib.shell_parse_argv(command);
                if (!success) {
                    reject(new Error('Failed to parse command'));
                    return;
                }

                let [exit, pid, stdin, stdout, stderr] = glib.spawn_async_with_pipes(
                    null, argv, null,
                    glib.SpawnFlags.SEARCH_PATH,
                    null
                );

                if (!exit) {
                    reject(new Error('Failed to spawn process'));
                    return;
                }

                // Set up async reading with timeout
                const timeoutId = setTimeout(() => {
                    try {
                        glib.spawn_close_pid(pid);
                    } catch (e) {
                        Logger.error(`Error killing timed out process: ${e.message}`);
                    }
                    reject(new Error('Content fetch timed out after 15 seconds'));
                }, 15000);

                this._readProcessOutput(stdout, stderr, pid, (success, stdoutResult, stderrResult) => {
                    clearTimeout(timeoutId);
                    if (success && stdoutResult) {
                        Logger.debug(`AI Managers: Content fetch successful, got ${stdoutResult.length} chars`);
                        // Prepare article content
                        let descriptionText = '';
                        if (item.description && typeof item.description === 'string' && item.description.trim()) {
                            descriptionText = this.HTMLPartToTextPart(item.description);
                        } else if (item.channel === 'Manual') {
                            descriptionText = '';
                        }

                        const articleContent = `${item.title}\n${descriptionText}\n${stdoutResult}`;
                        resolve(articleContent);
                    } else {
                        Logger.error(`AI Managers: Content fetch failed: ${stderrResult || 'Unknown error'}`);
                        reject(new Error(`Failed to get article content: ${stderrResult || 'Unknown error'}`));
                    }
                });

            } catch (error) {
                Logger.error(`AI Managers: Error in content fetch: ${error.message}`);
                reject(error);
            }
        });
    }

    // Fallback method using synchronous approach if async fails
    async _getArticleContentFallback(dumptool, item) {
        try {
            Logger.info('AI Managers: Using fallback synchronous content fetch');
            Logger.debug(`AI Managers: Fallback URL to fetch: "${item.link}"`);
            Logger.debug(`AI Managers: Fallback dumptool: ${dumptool}`);

            // Validate URL before proceeding
            if (!item.link || typeof item.link !== 'string') {
                throw new Error(`Invalid URL: ${item.link}`);
            }

            // Check if URL looks valid
            if (!item.link.startsWith('http://') && !item.link.startsWith('https://')) {
                throw new Error(`Invalid URL scheme: ${item.link}`);
            }

            Logger.debug(`AI Managers: Fallback URL validation passed`);

            const escapedUrl = item.link.replace(/'/g, "'\"'\"'");
            const command = `/usr/bin/timeout -k 10 10 /usr/bin/${dumptool} -dump '${escapedUrl}' || echo 'ERROR: TIMEOUT'`;
            Logger.debug(`AI Managers: Fallback full command: ${command}`);

            const [success, stdout, stderr] = GLib.spawn_command_line_sync(command);

            if (!success) {
                throw new Error(`Fallback content fetch failed: ${stderr.toString()}`);
            }

            // Prepare article content
            let descriptionText = '';
            if (item.description && typeof item.description === 'string' && item.description.trim()) {
                descriptionText = this.HTMLPartToTextPart(item.description);
            } else if (item.channel === 'Manual') {
                descriptionText = '';
            }

            const articleContent = `${item.title}\n${descriptionText}\n${ByteArray.toString(stdout)}`;
            Logger.info(`AI Managers: Fallback content fetch successful, got ${articleContent.length} chars`);
            return articleContent;
        } catch (error) {
            Logger.error(`AI Managers: Fallback content fetch failed: ${error.message}`);
            throw error;
        }
    }

    // Helper method to read process output asynchronously
    _readProcessOutput(stdout, stderr, pid, callback) {
        const gio = imports.gi.Gio;
        const stdoutStream = new gio.UnixInputStream({ fd: stdout, close_fd: true });
        const stderrStream = new gio.UnixInputStream({ fd: stderr, close_fd: true });

        const stdoutData = new gio.DataInputStream({ base_stream: stdoutStream });
        const stderrData = new gio.DataInputStream({ base_stream: stderrStream });

        let stdoutResult = '';
        let stderrResult = '';
        let stdoutDone = false;
        let stderrDone = false;

        const checkComplete = () => {
            if (stdoutDone && stderrDone) {
                callback(true, stdoutResult, stderrResult);
            }
        };

        // Read stdout
        const readStdout = (stream, result) => {
            try {
                const bytes = stdoutData.fill_finish(result);
                if (bytes > 0) {
                    stdoutResult += stream.peek_buffer().toString();
                    stdoutData.fill_async(-1, imports.gi.GLib.PRIORITY_DEFAULT, null, readStdout);
                } else {
                    stdoutDone = true;
                    checkComplete();
                }
            } catch (e) {
                stdoutDone = true;
                checkComplete();
            }
        };

        // Read stderr
        const readStderr = (stream, result) => {
            try {
                const bytes = stderrData.fill_finish(result);
                if (bytes > 0) {
                    stderrResult += stream.peek_buffer().toString();
                    stderrData.fill_async(-1, imports.gi.GLib.PRIORITY_DEFAULT, null, readStderr);
                } else {
                    stderrDone = true;
                    checkComplete();
                }
            } catch (e) {
                stderrDone = true;
                checkComplete();
            }
        };

        // Start reading
        stdoutData.fill_async(-1, imports.gi.GLib.PRIORITY_DEFAULT, null, readStdout);
        stderrData.fill_async(-1, imports.gi.GLib.PRIORITY_DEFAULT, null, readStderr);
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

    // Get API key using the simple, old method
    async getProviderApiKey() {
        try {
            const apiKey = await Secret.password_lookup_sync(this.API_KEY_SCHEMA, {}, null);
            return apiKey;
        } catch (e) {
            Logger.error('Error getting API key: ' + e);
            return null;
        }
    }

    // Get the appropriate API endpoint for the current provider
    getProviderApiEndpoint() {
        // Check if custom URL override is enabled
        if (this.desklet.ai_use_custom_url && this.desklet.ai_url) {
            return this.desklet.ai_url;
        }

        // Use provider default URL
        switch (this.desklet.ai_provider) {
            case 'openai':
                return 'https://api.openai.com/v1/chat/completions';
            case 'deepseek':
                return 'https://api.deepseek.com/v1/chat/completions';
            case 'anthropic':
                return 'https://api.anthropic.com/v1/messages';
            case 'custom':
                return this.desklet.ai_url || 'https://api.openai.com/v1/chat/completions';
            default:
                return 'https://api.openai.com/v1/chat/completions';
        }
    }

    // AI prompt examples
    onAIPromptExample1() {
        this.desklet.ai_systemprompt = 'Summarize in four sentences.';
    }

    onAIPromptExample2() {
        this.desklet.ai_systemprompt = 'Foglald össze limerick-ben.';
    }

    onAIPromptExample3() {
        this.desklet.ai_systemprompt = '俳句のエッセンス\n日本語では';
    }

    onAIPromptExample4() {
        this.desklet.ai_systemprompt = 'Foglald össze 4 mondatban.';
    }

    onAIPromptExample5() {
        this.desklet.ai_systemprompt = 'Summarize in 4-8 short bullet points, separtate lines, English language.\nOmit other references and external links from the summary.';
    }

    onAIPromptExample6() {
        this.desklet.ai_systemprompt = 'Foglald össze 4-8 rövid bullet pontban, mind külön sorban, magyarul.\nHaggyd ki a többi az oldalon olvasható cikket és hivatkozást a felsorolásból.';
    }
}

module.exports = { AIManagers };
