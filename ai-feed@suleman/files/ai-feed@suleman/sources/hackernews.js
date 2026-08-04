// Hacker News source -- Algolia API client
// GET https://hn.algolia.com/api/v1/{sortEndpoint}?query={keywords}&tags=story&hitsPerPage={count}

/**
 * Escape HTML special characters in a string.
 * @param {string} str
 * @returns {string}
 */
function _escape(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build the Algolia search URL from settings.
 * @param {object} settings
 * @returns {string}
 */
function _buildUrl(settings) {
    let sortEndpoint = (settings.hnSort === 'relevance') ? 'search' : 'search_by_date';
    let keywords = (settings.hnKeywords || '').trim();
    let count = settings.hnCount || 5;
    let minPoints = settings.hnMinPoints || 0;

    let url = 'https://hn.algolia.com/api/v1/' + sortEndpoint
        + '?query=' + encodeURIComponent(keywords)
        + '&tags=story'
        + '&hitsPerPage=' + count;

    if (minPoints > 0) {
        url += '&numericFilters=points%3E' + minPoints;
    }

    return url;
}

/**
 * Normalize a single Algolia hit to a FeedItem.
 * @param {object} hit
 * @returns {object}
 */
function _normalize(hit) {
    let url = hit.url;
    if (!url) {
        url = 'https://news.ycombinator.com/item?id=' + hit.objectID;
    }

    let numComments = (hit.num_comments != null) ? hit.num_comments : 0;
    let points = (hit.points != null) ? hit.points : 0;

    // Build a human-readable relative time string from created_at_i (unix timestamp)
    let timeAgo = '';
    if (hit.created_at_i) {
        let nowSec = Math.floor(Date.now() / 1000);
        let diffSec = nowSec - hit.created_at_i;
        if (diffSec < 3600) {
            let m = Math.floor(diffSec / 60);
            timeAgo = (m <= 1 ? '1m' : m + 'm') + ' ago';
        } else if (diffSec < 86400) {
            let h = Math.floor(diffSec / 3600);
            timeAgo = h + 'h ago';
        } else {
            let d = Math.floor(diffSec / 86400);
            timeAgo = d + 'd ago';
        }
    }

    return {
        source: 'hackernews',
        title: _escape(hit.title),
        subtitle: '',
        meta: numComments + ' comments',
        metaLabel: '',
        url: url,
        extra: {
            points: points,
            timeAgo: timeAgo
        }
    };
}

/**
 * Fetch Hacker News stories via the Algolia API.
 *
 * @param {object} httpClient  - HttpClient instance with a getJson(url, headers, callback) method
 * @param {object} settings    - Desklet settings object
 * @param {Function} callback  - callback(error, feedItems)
 */
var fetch = function(httpClient, settings, callback) {
    let url;
    try {
        url = _buildUrl(settings);
    } catch (e) {
        callback(new Error('[hackernews] URL build failed: ' + e.message), null);
        return;
    }

    httpClient.getJson(url, null, (error, _status, data) => {
        if (error) {
            callback(new Error('[hackernews] Request failed: ' + error.message), null);
            return;
        }
        if (!data || !Array.isArray(data.hits)) {
            callback(new Error('[hackernews] Unexpected response shape'), null);
            return;
        }

        let items;
        try {
            items = data.hits.map(_normalize);
        } catch (e) {
            callback(new Error('[hackernews] Normalisation error: ' + e.message), null);
            return;
        }

        callback(null, items);
    });
};
