// arXiv Papers Source -- Atom XML feed client for AIFeed
// Queries export.arxiv.org for recent papers in configured categories
// Parses Atom XML by splitting on <entry> blocks (no XML DOM in GJS)

function _escapeText(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _extractTag(entry, tagName) {
    // Match <tagName>content</tagName> or <ns:tagName>content</ns:tagName>
    // tagName may already include a namespace prefix like 'arxiv:primary_category'
    let pattern = '<' + tagName + '[^>]*>([\\s\\S]*?)</' + tagName + '>';
    let re = new RegExp(pattern);
    let m = entry.match(re);
    if (!m) return '';
    // Collapse internal whitespace
    return m[1].replace(/\s+/g, ' ').trim();
}

function _extractAttr(entry, tagName, attrName) {
    // Match <tagName attrName="value" ... /> or <tagName attrName="value" ...>
    // tagName may include namespace prefix
    let pattern = '<' + tagName + '[^>]*\\s' + attrName + '="([^"]*)"';
    let re = new RegExp(pattern);
    let m = entry.match(re);
    if (!m) return '';
    return m[1];
}

function _timeAgo(dateStr) {
    if (!dateStr) return '';
    let then;
    try {
        then = new Date(dateStr).getTime();
    } catch (e) {
        return '';
    }
    let now = Date.now();
    let diffMs = now - then;
    if (isNaN(diffMs) || diffMs < 0) return '';

    let diffSec = Math.floor(diffMs / 1000);
    let diffMin = Math.floor(diffSec / 60);
    let diffHr  = Math.floor(diffMin / 60);
    let diffDay = Math.floor(diffHr / 24);

    if (diffDay >= 1) return diffDay + 'd ago';
    if (diffHr  >= 1) return diffHr  + 'h ago';
    if (diffMin >= 1) return diffMin + 'm ago';
    return 'just now';
}

var fetch = function(httpClient, settings, callback) {
    let categoriesStr  = settings.arxivCategories  || 'cs.AI, cs.LG';
    let maxResults     = settings.arxivMaxResults  || 10;
    let displayCount   = settings.arxivCount       || 5;

    // Build query: "cs.AI, cs.LG" -> "cat:cs.AI+OR+cat:cs.LG"
    let cats = categoriesStr.split(',').map(function(c) {
        return 'cat:' + c.trim();
    }).filter(function(c) {
        return c.length > 4; // skip empty entries after trim
    });

    if (cats.length === 0) {
        callback(new Error('arxiv: no categories configured'), null);
        return;
    }

    let catQuery = cats.join('+OR+');
    let url = 'https://export.arxiv.org/api/query'
        + '?search_query=' + catQuery
        + '&sortBy=submittedDate'
        + '&sortOrder=descending'
        + '&start=0'
        + '&max_results=' + maxResults;

    httpClient.get(url, null, function(error, status, body) {
        if (error) {
            callback(error, null);
            return;
        }
        if (!body) {
            callback(new Error('arxiv: empty response'), null);
            return;
        }

        let items = [];
        try {
            // Split on <entry> to get individual entry blocks
            // The feed preamble is before the first <entry>
            let parts = body.split('<entry>');
            // parts[0] is the feed header; parts[1..n] are entry + trailing content
            for (let i = 1; i < parts.length; i++) {
                let entry = parts[i];
                // Strip everything from </entry> onwards in this slice
                let endIdx = entry.indexOf('</entry>');
                if (endIdx !== -1) {
                    entry = entry.substring(0, endIdx);
                }

                // Title
                let rawTitle = _extractTag(entry, 'title');
                let title    = _escapeText(rawTitle);

                // Published date
                let published = _extractTag(entry, 'published');

                // Primary category: <arxiv:primary_category term="cs.AI" .../>
                let category = _extractAttr(entry, 'arxiv:primary_category', 'term');
                if (!category) {
                    // Fallback: first <category term="..."/>
                    category = _extractAttr(entry, 'category', 'term');
                }

                // Prefer abs link over PDF link
                // Links look like:
                //   <link href="http://arxiv.org/abs/2501.00001v1" rel="alternate" type="text/html"/>
                //   <link href="http://arxiv.org/pdf/2501.00001v1" rel="related" type="application/pdf"/>
                let url = '';
                // Find all <link ... /> blocks in entry
                let linkRe = /<link([^>]*)\/>/g;
                let linkMatch;
                let absUrl = '';
                let anyUrl = '';
                while ((linkMatch = linkRe.exec(entry)) !== null) {
                    let attrs = linkMatch[1];
                    let hrefM = attrs.match(/href="([^"]*)"/);
                    if (!hrefM) continue;
                    let href = hrefM[1];
                    let relM = attrs.match(/rel="([^"]*)"/);
                    let rel  = relM ? relM[1] : '';
                    if (rel === 'alternate' || href.indexOf('/abs/') !== -1) {
                        absUrl = href;
                    }
                    if (!anyUrl) anyUrl = href;
                }
                url = absUrl || anyUrl;

                if (!title || !url) continue;

                items.push({
                    source:    'arxiv',
                    title:     title,
                    subtitle:  '',
                    meta:      _timeAgo(published),
                    metaLabel: '',
                    url:       url,
                    extra:     { category: category }
                });

                if (items.length >= displayCount) break;
            }
        } catch (parseErr) {
            callback(new Error('arxiv: XML parse error: ' + parseErr.message), null);
            return;
        }

        callback(null, items);
    });
};
