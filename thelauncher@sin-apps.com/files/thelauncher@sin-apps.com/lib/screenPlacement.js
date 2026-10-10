var SCREEN_ANCHORS = {
    "top-left": [0, 0], "top-center": [0.5, 0], "top-right": [1, 0],
    "center-left": [0, 0.5], "center": [0.5, 0.5], "center-right": [1, 0.5],
    "bottom-left": [0, 1], "bottom-center": [0.5, 1], "bottom-right": [1, 1]
};

function isScreenAnchored(anchor) {
    return Object.prototype.hasOwnProperty.call(SCREEN_ANCHORS, anchor);
}

// Use the origin, not the center of the expanding panel, to select a monitor.
function monitorForPosition(monitors, x, y) {
    let nearest = null;
    let distance = Infinity;
    monitors.forEach(monitor => {
        const dx = Math.max(monitor.x - x, 0, x - (monitor.x + monitor.width - 1));
        const dy = Math.max(monitor.y - y, 0, y - (monitor.y + monitor.height - 1));
        const nextDistance = dx * dx + dy * dy;
        if (nextDistance < distance) {
            nearest = monitor;
            distance = nextDistance;
        }
    });
    return nearest;
}

function positionInWorkArea(area, width, height, anchor, x, y) {
    const freeWidth = Math.max(0, area.width - width);
    const freeHeight = Math.max(0, area.height - height);
    const alignment = isScreenAnchored(anchor) ? SCREEN_ANCHORS[anchor] : null;
    return {
        x: Math.round(alignment ? area.x + freeWidth * alignment[0]
            : Math.max(area.x, Math.min(x, area.x + freeWidth))),
        y: Math.round(alignment ? area.y + freeHeight * alignment[1]
            : Math.max(area.y, Math.min(y, area.y + freeHeight)))
    };
}

function viewportSize(width, height, area, chrome, maxWidth, maxHeight, fixed) {
    const availableWidth = Math.max(1, area.width - chrome.width);
    const availableHeight = Math.max(1, area.height - chrome.height);
    return {
        width: Math.max(1, Math.min(availableWidth, maxWidth > 0 ? maxWidth : Infinity,
            fixed && maxWidth > 0 ? maxWidth : width)),
        height: Math.max(1, Math.min(availableHeight, maxHeight > 0 ? maxHeight : Infinity,
            fixed && maxHeight > 0 ? maxHeight : height))
    };
}

