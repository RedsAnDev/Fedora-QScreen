// SPDX-License-Identifier: GPL-2.0-or-later
//
// Pure layout logic: no GNOME Shell imports, so it can be unit-tested with
// plain node/gjs (see tests/layouts.test.js).
//
// A layout is identified by a compact spec string, which doubles as its id:
//
//   grid:CxR            uniform grid, e.g. grid:3x2
//   rows:a,b,c          rows holding a, b, c windows, e.g. rows:2,1,3
//   cols:a,b,c          columns holding a, b, c windows, e.g. cols:1,3
//   rects:c,r,w,h;...   explicit rectangles in grid units; a leading "CxR;"
//                       fixes the grid size, e.g. rects:12x6;0,0,9,2
//
// Any spec may end with "@Label" to give it a display name.

const MAX_COLS = 24;
const MAX_ROWS = 24;
// A zone needs at least one grid unit, so more cells than units is pointless.
const MAX_CELLS = MAX_COLS * MAX_ROWS;

/** Float-tolerant equality: zones can sit at fractional grid positions once edges are dragged. */
export const near = (a, b) => Math.abs(a - b) < 1e-6;

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

const toInts = (str, sep) => {
    const parts = str.split(sep).map(s => s.trim());
    if (parts.some(p => !/^\d+$/.test(p)))
        return null;
    return parts.map(Number);
};

const readingOrder = (a, b) => a.row - b.row || a.col - b.col;

function build(id, name, cols, rows, cells) {
    if (cols < 1 || rows < 1 || cols > MAX_COLS || rows > MAX_ROWS)
        return null;
    if (cells.length === 0)
        return null;
    cells.sort(readingOrder);
    return {id, name, cols, rows, cells};
}

/**
 * @param {string} spec layout spec
 * @returns {?{id: string, name: string, cols: number, rows: number,
 *     cells: {col: number, row: number, w: number, h: number}[]}}
 */
export function parseLayout(spec) {
    if (typeof spec !== 'string')
        return null;
    const [body, ...labelParts] = spec.trim().split('@');
    const label = labelParts.join('@').trim();
    const sep = body.indexOf(':');
    if (sep < 0)
        return null;
    const kind = body.slice(0, sep).trim();
    const arg = body.slice(sep + 1).trim();
    const id = label ? `${kind}:${arg}@${label}` : `${kind}:${arg}`;

    if (kind === 'grid') {
        const m = /^(\d+)\s*x\s*(\d+)$/i.exec(arg);
        if (!m)
            return null;
        const cols = Number(m[1]);
        const rows = Number(m[2]);
        if (cols < 1 || rows < 1 || cols > MAX_COLS || rows > MAX_ROWS)
            return null;
        const cells = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++)
                cells.push({col, row, w: 1, h: 1});
        }
        return build(id, label || `${cols}×${rows}`, cols, rows, cells);
    }

    if (kind === 'rows' || kind === 'cols') {
        const counts = toInts(arg, ',');
        if (!counts || counts.length === 0 || counts.some(n => n < 1 || n > 8))
            return null;
        const span = counts.reduce(lcm, 1);
        const cells = [];
        counts.forEach((n, line) => {
            const size = span / n;
            for (let i = 0; i < n; i++) {
                cells.push(kind === 'rows'
                    ? {col: i * size, row: line, w: size, h: 1}
                    : {col: line, row: i * size, w: 1, h: size});
            }
        });
        const dims = kind === 'rows'
            ? [span, counts.length]
            : [counts.length, span];
        const name = label || `${kind === 'rows' ? 'Rows' : 'Columns'} ${counts.join('/')}`;
        return build(id, name, dims[0], dims[1], cells);
    }

    if (kind === 'rects') {
        const cells = [];
        let declared = [0, 0];
        for (const chunk of arg.split(';')) {
            if (chunk.trim() === '')
                continue;
            const size = /^(\d+)\s*x\s*(\d+)$/i.exec(chunk.trim());
            if (size) {
                declared = [Number(size[1]), Number(size[2])];
                continue;
            }
            const n = toInts(chunk, ',');
            if (!n || n.length !== 4 || n[2] < 1 || n[3] < 1)
                return null;
            if (cells.length >= MAX_CELLS)
                return null;
            cells.push({col: n[0], row: n[1], w: n[2], h: n[3]});
        }
        // Without a declared size the grid is just big enough for the zones.
        const cols = cells.reduce((m, c) => Math.max(m, c.col + c.w), declared[0]);
        const rows = cells.reduce((m, c) => Math.max(m, c.row + c.h), declared[1]);
        return build(id, label || `Custom (${cells.length})`, cols, rows, cells);
    }

    return null;
}

/** Whether two cells share at least one grid unit. */
export function overlaps(a, b) {
    return a.col < b.col + b.w && b.col < a.col + a.w &&
        a.row < b.row + b.h && b.row < a.row + a.h;
}

/** The optional "@Label" part of a spec ('' when there is none). */
export function labelOf(spec) {
    return spec.split('@').slice(1).join('@').trim();
}

/**
 * Spec string (a `rects:` layout) for a list of cells, the inverse of
 * parseLayout(). Cells are written in reading order, which is also the order
 * windows are assigned to them. `size` ({cols, rows}) is the grid the cells
 * were drawn on; it is only written when it is larger than the cells need.
 */
export function formatRects(cells, label = '', size = null) {
    const zones = [...cells]
        .sort(readingOrder)
        .map(c => `${c.col},${c.row},${c.w},${c.h}`);
    const needCols = Math.max(0, ...cells.map(c => c.col + c.w));
    const needRows = Math.max(0, ...cells.map(c => c.row + c.h));
    if (size && (size.cols > needCols || size.rows > needRows))
        zones.unshift(`${size.cols}x${size.rows}`);
    const body = zones.join(';');
    const name = label.trim();
    return name ? `rects:${body}@${name}` : `rects:${body}`;
}

/**
 * Pixel rectangle for a cell inside a work area.
 * `gap` separates neighbouring cells, `outer` is the margin to the area edge.
 */
export function cellRect(layout, cell, area, gap = 0, outer = 0) {
    const unitW = area.width / layout.cols;
    const unitH = area.height / layout.rows;
    const half = gap / 2;

    const left = near(cell.col, 0) ? outer : half;
    const top = near(cell.row, 0) ? outer : half;
    const right = near(cell.col + cell.w, layout.cols) ? outer : half;
    const bottom = near(cell.row + cell.h, layout.rows) ? outer : half;

    const x1 = Math.round(area.x + cell.col * unitW + left);
    const y1 = Math.round(area.y + cell.row * unitH + top);
    const x2 = Math.round(area.x + (cell.col + cell.w) * unitW - right);
    const y2 = Math.round(area.y + (cell.row + cell.h) * unitH - bottom);

    return {x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1)};
}

/**
 * Order windows (anything with a frame rect `{x, y, width, height}`) the way
 * the cells of `layout` are ordered, so each window lands in the cell nearest
 * to where it already is. Returns a new array of the same items.
 */
export function sortByPosition(items, rectOf, layout, area) {
    const rowHeight = area.height / layout.rows;
    const keyed = items.map(item => {
        const r = rectOf(item);
        const cy = r.y + r.height / 2 - area.y;
        const cx = r.x + r.width / 2 - area.x;
        const row = Math.min(layout.rows - 1, Math.max(0, Math.floor(cy / rowHeight)));
        return {item, row, cx};
    });
    keyed.sort((a, b) => a.row - b.row || a.cx - b.cx);
    return keyed.map(k => k.item);
}

const squares = [2, 3, 4, 5].map(n => `grid:${n}x${n}`);

// One row, N columns.
const lines = [2, 3, 4, 5].map(n => `grid:${n}x1`);

// Two columns: one window on the left, two or three stacked on the right.
const composite = ['cols:1,2', 'cols:1,3', 'cols:1,4', 'cols:1,5'];

/** Built-in layouts, grouped for menus and the overlay. */
export const BUILTIN_SECTIONS = [
    {id: 'grids', title: 'Grids', specs: squares},
    {id: 'lines', title: 'Rows and columns', specs: lines},
    {id: 'mixed', title: 'Combinations', specs: composite},
];
