// HuggingFace Hub source for AIFeed
// Fetches trending models, datasets, and/or spaces from the HF Hub API

const BASE_URL = 'https://huggingface.co/api';

// Format a raw number as a human-readable count string (e.g. 2400 -> '2.4k')
function _formatCount(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
}

// Escape XML/HTML special characters in a string for safe display
function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Convert a raw API item into a normalised feed item object
// type: 'Model' | 'Dataset' | 'Space'
function _toFeedItem(item, type) {
    let id = item.id || item.modelId || item.repoId || '';
    return {
        source: 'huggingface',
        title: _escapeHtml(id),
        subtitle: '',
        meta: _formatCount(item.likes || 0),
        metaLabel: 'likes',
        url: 'https://huggingface.co/' + id,
        extra: {
            type: type,
            downloads: item.downloads || 0
        },
        _trending: item.trendingScore || 0,
        _likes: item.likes || 0
    };
}

// Public fetch function following the AIFeed source contract:
//   fetch(httpClient, settings, callback)
//   callback(error, feedItems)
//
// settings keys used:
//   hfShowModels   {bool}   - include trending models
//   hfShowDatasets {bool}   - include trending datasets
//   hfShowSpaces   {bool}   - include trending spaces
//   hfCount        {number} - number of top items to return
//   hfToken        {string} - optional Bearer auth token
var fetch = function(httpClient, settings, callback) {
    let showModels   = settings.hfShowModels   !== false;
    let showDatasets = settings.hfShowDatasets !== false;
    let showSpaces   = settings.hfShowSpaces   === true;
    let count        = settings.hfCount        || 5;
    let token        = settings.hfToken        || '';

    // Build optional auth header
    let headers = {};
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }

    // Determine which endpoint types to fetch
    let types = [];
    if (showModels)   types.push({ endpoint: 'models',   label: 'Model' });
    if (showDatasets) types.push({ endpoint: 'datasets', label: 'Dataset' });
    if (showSpaces)   types.push({ endpoint: 'spaces',   label: 'Space' });

    if (types.length === 0) {
        callback(null, []);
        return;
    }

    let allItems  = [];
    let completed = 0;
    let failed    = 0;
    let total     = types.length;

    function onRequestDone(error, status, data, label) {
        completed++;

        if (!error && Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                allItems.push(_toFeedItem(data[i], label));
            }
        } else if (error) {
            failed++;
            // Log but do not abort; other requests may still succeed
            try { global.logError('[AIFeed] HuggingFace ' + label + ' error: ' + error.message); } catch (_) {}
        }

        if (completed < total) return;

        // All requests finished
        if (failed === total) {
            // Every request failed -- report the last error via a generic message
            callback(new Error('All HuggingFace requests failed'), []);
            return;
        }

        // Sort by trendingScore desc (fall back to likes if tied); take top N
        allItems.sort(function(a, b) {
            if (b._trending !== a._trending) return b._trending - a._trending;
            return b._likes - a._likes;
        });
        let topItems = allItems.slice(0, count);
        for (let i = 0; i < topItems.length; i++) {
            delete topItems[i]._likes;
            delete topItems[i]._trending;
        }

        callback(null, topItems);
    }

    for (let i = 0; i < types.length; i++) {
        (function(typeObj) {
            let url = BASE_URL + '/' + typeObj.endpoint
                + '?sort=trendingScore&direction=-1&limit=' + count;
            httpClient.getJson(url, headers, function(error, status, data) {
                onRequestDone(error, status, data, typeObj.label);
            });
        })(types[i]);
    }
};
