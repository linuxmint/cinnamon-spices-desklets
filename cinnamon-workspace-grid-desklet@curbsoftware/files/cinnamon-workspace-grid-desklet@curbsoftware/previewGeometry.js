/* Pure workspace preview geometry. No Cinnamon or St dependency. */

function _number(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRect(rect) {
    rect = rect || {};
    return {
        x: _number(rect.x, 0),
        y: _number(rect.y, 0),
        width: Math.max(0, _number(rect.width, 0)),
        height: Math.max(0, _number(rect.height, 0))
    };
}

/** Returns the smallest rectangle containing every non-empty rectangle. */
function boundingRect(rects) {
    const areas = (rects || []).map(normalizeRect).filter(function (rect) {
        return rect.width > 0 && rect.height > 0;
    });
    if (!areas.length)
        return null;

    let left = areas[0].x;
    let top = areas[0].y;
    let right = areas[0].x + areas[0].width;
    let bottom = areas[0].y + areas[0].height;
    for (let index = 1; index < areas.length; index++) {
        const rect = areas[index];
        left = Math.min(left, rect.x);
        top = Math.min(top, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Fits source inside the target size without changing its aspect ratio. */
function fitRect(source, targetWidth, targetHeight) {
    const area = normalizeRect(source);
    const width = Math.max(0, _number(targetWidth, 0));
    const height = Math.max(0, _number(targetHeight, 0));
    if (!area.width || !area.height || !width || !height)
        return null;

    const scale = Math.min(width / area.width, height / area.height);
    const fittedWidth = Math.max(1, Math.round(area.width * scale));
    const fittedHeight = Math.max(1, Math.round(area.height * scale));
    return {
        x: Math.round((width - fittedWidth) / 2),
        y: Math.round((height - fittedHeight) / 2),
        width: fittedWidth,
        height: fittedHeight
    };
}

/**
 * projectRect maps a desktop rectangle into a preview and clips it to bounds.
 * Returns null when source or intersection has no area.
 */
function projectRect(rect, desktop, previewWidth, previewHeight) {
    return projectRectInto(rect, desktop, {
        x: 0,
        y: 0,
        width: previewWidth,
        height: previewHeight
    });
}

/** Maps and clips a desktop rectangle into an offset target rectangle. */
function projectRectInto(rect, desktop, target) {
    const source = normalizeRect(rect);
    const area = normalizeRect(desktop);
    const output = normalizeRect(target);

    if (!source.width || !source.height || !area.width || !area.height ||
            !output.width || !output.height)
        return null;

    const left = Math.max(source.x, area.x);
    const top = Math.max(source.y, area.y);
    const right = Math.min(source.x + source.width, area.x + area.width);
    const bottom = Math.min(source.y + source.height, area.y + area.height);
    if (right <= left || bottom <= top)
        return null;

    return {
        x: output.x + Math.round((left - area.x) * output.width / area.width),
        y: output.y + Math.round((top - area.y) * output.height / area.height),
        width: Math.max(1, Math.round((right - left) * output.width / area.width)),
        height: Math.max(1, Math.round((bottom - top) * output.height / area.height))
    };
}

/** Returns centered icon geometry only when icon fully fits inside window. */
function iconRect(windowRect, iconSize) {
    if (!windowRect)
        return null;
    const size = Math.max(0, _number(iconSize, 0));
    if (!size || windowRect.width < size || windowRect.height < size)
        return null;
    return {
        x: Math.round(windowRect.x + (windowRect.width - size) / 2),
        y: Math.round(windowRect.y + (windowRect.height - size) / 2),
        width: size,
        height: size
    };
}
