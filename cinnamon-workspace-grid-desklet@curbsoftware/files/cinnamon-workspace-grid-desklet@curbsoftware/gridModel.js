/* Pure grid layout and scroll model. No Cinnamon or St dependency. */

function _positiveInt(value, fallback) {
    const number = parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function computeGridDims(cellCount, mode, fixedRows, fixedCols) {
    const count = _positiveInt(cellCount, 1);
    if (mode === "fixed") {
        const cols = _positiveInt(fixedCols, 1);
        return {
            rows: Math.max(_positiveInt(fixedRows, 1), Math.ceil(count / cols)),
            cols: cols
        };
    }
    const cols = Math.ceil(Math.sqrt(count));
    return { rows: Math.ceil(count / cols), cols: cols };
}

function planCells(workspaceCount, showAddTile) {
    let count = parseInt(workspaceCount, 10);
    if (!Number.isFinite(count) || count < 0)
        count = 0;
    const cells = [];
    for (let index = 0; index < count; index++)
        cells.push({ kind: "workspace", index: index });
    if (showAddTile)
        cells.push({ kind: "add", index: -1 });
    return cells;
}

function computeScrollTarget(active, count, cols, mode, direction) {
    const total = parseInt(count, 10);
    const current = parseInt(active, 10);
    const columnCount = _positiveInt(cols, 1);
    const delta = direction < 0 ? -1 : 1;
    if (!Number.isFinite(total) || total < 1 ||
        !Number.isFinite(current) || current < 0 || current >= total)
        return current;

    if (mode === "row") {
        const target = current + delta * columnCount;
        if (target < 0)
            return current;
        if (target >= total && delta > 0) {
            const finalRowStart = Math.floor((total - 1) / columnCount) * columnCount;
            return current < finalRowStart ? total - 1 : current;
        }
        return target;
    }

    const target = current + delta;
    return target >= 0 && target < total ? target : current;
}
