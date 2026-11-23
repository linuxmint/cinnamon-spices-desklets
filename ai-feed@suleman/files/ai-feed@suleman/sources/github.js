// GitHub Trending source module for AIFeed
//
// Dual-source strategy:
//   Primary:  https://github-trending-api.waite.me/repositories
//   Fallback: https://api.github.com/search/repositories
//
// Export contract:
//   var fetch = function(httpClient, settings, callback)
//   callback(error, feedItems)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _escapeText(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function _formatStars(count) {
    if (!count && count !== 0) return '?';
    count = Number(count);
    if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'k';
    }
    return String(count);
}

// Return an ISO date string N days ago (YYYY-MM-DD), used for REST Search fallback.
function _daysAgoDate(days) {
    let d = new Date();
    d.setDate(d.getDate() - days);
    let yyyy = d.getFullYear();
    let mm = String(d.getMonth() + 1).padStart(2, '0');
    let dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
}

// ---------------------------------------------------------------------------
// Primary source — unofficial trending API
// ---------------------------------------------------------------------------

function _buildPrimaryUrl(settings) {
    let period = (settings.githubPeriod || 'daily').trim();
    let lang = '';
    if (settings.githubLanguages) {
        let langs = settings.githubLanguages.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (langs.length > 0) {
            lang = encodeURIComponent(langs[0]);
        }
    }
    let url = 'https://github-trending-api.waite.me/repositories?since=' + period;
    if (lang) {
        url += '&language=' + lang;
    }
    return url;
}

function _parsePrimaryResponse(data, count) {
    let items = [];
    let repos = Array.isArray(data) ? data : (data.repositories || data.repos || []);
    let limit = Math.min(repos.length, count || 5);
    for (let i = 0; i < limit; i++) {
        let repo = repos[i];
        if (!repo) continue;
        let author = _escapeText(repo.author || repo.username || '');
        let name = _escapeText(repo.name || repo.repoName || '');
        let fullName = author && name ? author + '/' + name : _escapeText(repo.full_name || '');
        let url = repo.url || repo.html_url || ('https://github.com/' + (repo.full_name || (author + '/' + name)));
        items.push({
            source: 'github',
            title: fullName,
            subtitle: _escapeText(repo.description || ''),
            meta: _formatStars(repo.stars || repo.stargazers_count || 0),
            metaLabel: 'stars',
            url: url,
            timestamp: Math.floor(Date.now() / 1000),
            extra: {
                language: _escapeText(repo.language || ''),
                currentPeriodStars: repo.currentPeriodStars || repo.added_stars || 0
            }
        });
    }
    return items;
}

// ---------------------------------------------------------------------------
// Fallback source — GitHub REST Search API
// ---------------------------------------------------------------------------

function _buildFallbackUrl(settings) {
    let period = (settings.githubPeriod || 'daily').trim();
    let days = (period === 'weekly') ? 7 : 1;
    let since = _daysAgoDate(days);
    let count = settings.githubCount || 5;
    let query = 'created:>' + since + '+stars:>5';

    if (settings.githubLanguages) {
        let langs = settings.githubLanguages.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (langs.length > 0) {
            query += '+language:' + encodeURIComponent(langs[0]);
        }
    }

    return 'https://api.github.com/search/repositories?q=' + query +
        '&sort=stars&order=desc&per_page=' + count;
}

function _parseFallbackResponse(data, count) {
    let items = [];
    let repos = (data && data.items) ? data.items : (Array.isArray(data) ? data : []);
    let limit = Math.min(repos.length, count || 5);
    for (let i = 0; i < limit; i++) {
        let repo = repos[i];
        if (!repo) continue;
        items.push({
            source: 'github',
            title: _escapeText(repo.full_name || ''),
            subtitle: _escapeText(repo.description || ''),
            meta: _formatStars(repo.stargazers_count || 0),
            metaLabel: 'stars',
            url: repo.html_url || ('https://github.com/' + (repo.full_name || '')),
            timestamp: Math.floor(Date.now() / 1000),
            extra: {
                language: _escapeText(repo.language || ''),
                currentPeriodStars: 0
            }
        });
    }
    return items;
}

// ---------------------------------------------------------------------------
// Fallback fetch — GitHub REST Search
// ---------------------------------------------------------------------------

function _fetchFallback(httpClient, settings, callback) {
    let url = _buildFallbackUrl(settings);
    let headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    if (settings.githubToken) {
        headers['Authorization'] = 'Bearer ' + settings.githubToken;
    }

    httpClient.getJson(url, headers, function(error, status, data) {
        try {
            if (error) {
                callback(error, []);
                return;
            }
            let items = _parseFallbackResponse(data, settings.githubCount || 5);
            callback(null, items);
        } catch (e) {
            callback(e, []);
        }
    });
}

// ---------------------------------------------------------------------------
// Public fetch — primary with auto-fallback
// ---------------------------------------------------------------------------

var fetch = function(httpClient, settings, callback) {
    let primaryUrl = _buildPrimaryUrl(settings);

    httpClient.getJson(primaryUrl, {}, function(error, status, data) {
        try {
            if (!error && data) {
                let repos = Array.isArray(data) ? data : (data.repositories || data.repos || []);
                if (repos.length > 0) {
                    let items = _parsePrimaryResponse(data, settings.githubCount || 5);
                    callback(null, items);
                    return;
                }
            }
            // Primary failed or returned empty — fall back to REST Search API
            _fetchFallback(httpClient, settings, callback);
        } catch (e) {
            // Parse/logic error in primary handler — fall back
            _fetchFallback(httpClient, settings, callback);
        }
    });
};
