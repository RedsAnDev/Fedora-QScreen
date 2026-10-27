// SPDX-License-Identifier: GPL-2.0-or-later
//
// Pure geometry for keeping tiled windows linked: what happens to the zones
// when one goes away, and when a shared edge is dragged. No GNOME Shell
// imports, so it is unit-tested with plain node (tests/reflow.test.js).
//
// A zone is {col, row, w, h} in grid units (possibly fractional once edges
// have been dragged); any other property, like the window it holds, is kept.

import {near} from './layouts.js';

// Order matters: it breaks ties, so the zone before/above wins.
const SIDES = [
    {
        touches: (n, f) => near(n.col + n.w, f.col),
        along: c => [c.row, c.row + c.h],
        grow: (n, f) => ({...n, w: n.w + f.w}),
    },
    {
        touches: (n, f) => near(n.row + n.h, f.row),
        along: c => [c.col, c.col + c.w],
        grow: (n, f) => ({...n, h: n.h + f.h}),
    },
    {
        touches: (n, f) => near(n.col, f.col + f.w),
        along: c => [c.row, c.row + c.h],
        grow: (n, f) => ({...n, col: f.col, w: n.w + f.w}),
    },
    {
        touches: (n, f) => near(n.row, f.row + f.h),
        along: c => [c.col, c.col + c.w],
        grow: (n, f) => ({...n, row: f.row, h: n.h + f.h}),
    },
];

const overlap = ([a0, a1], [b0, b1]) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;
const overlapOrTouch = ([a0, a1], [b0, b1]) => Math.max(a0, b0) <= Math.min(a1, b1) + 1e-6;

// Whether `spans` lie inside [start, end] and tile it exactly, without gaps or overlaps.
function tiles(spans, [start, end]) {
    if (spans.length === 0)
        return false;
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    let at = start;
    for (const [from, to] of sorted) {
        if (!near(from, at))
            return false;
        at = to;
    }
    return near(at, end);
}

/**
 * Remove zone `index` and let its neighbours grow over the space it held.
 *
 * Neighbours on one side take over when their edges line up with the freed
 * zone exactly (one zone, or several stacked ones that together span it).
 * The side with the fewest neighbours wins, then the one with the most area.
 *
 * @returns {?object[]} the remaining zones (same order), or null when no side
 *     can take the space without leaving a hole or overlapping another zone
 */
export function expandInto(zones, index) {
    const freed = zones[index];
    let best = null;

    for (const side of SIDES) {
        const neighbours = zones.filter((z, i) => i !== index && side.touches(z, freed) &&
            overlap(side.along(z), side.along(freed)));
        if (!tiles(neighbours.map(side.along), side.along(freed)))
            continue;
        const area = neighbours.reduce((sum, z) => sum + z.w * z.h, 0);
        if (!best || neighbours.length < best.neighbours.length ||
            (neighbours.length === best.neighbours.length && area > best.area))
            best = {side, neighbours, area};
    }
    if (!best)
        return null;

    return zones
        .map(z => (best.neighbours.includes(z) ? best.side.grow(z, freed) : z))
        .filter((_z, i) => i !== index);
}

/**
 * A `rows:` spec that fits `n` windows in a near-square arrangement, e.g.
 * 5 -> rows:3,2.
 */
export function balancedSpec(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const counts = [];
    let left = n;
    for (let r = 0; r < rows; r++) {
        const count = Math.ceil(left / (rows - r));
        counts.push(count);
        left -= count;
    }
    return `rows:${counts.join(',')}`;
}

/**
 * Drag the line shared by zones to a new position, moving every zone edge that
 * lies on the same continuous line (so a divider moves as a whole).
 *
 * @param {object[]} zones
 * @param {'x'|'y'} axis 'x' for a vertical line, 'y' for a horizontal one
 * @param {number} at where the line is now, in grid units
 * @param {number[]} span [start, end] of the dragged window's edge along the line
 * @param {number} target where the line should go
 * @param {number} min smallest size a zone may be squeezed to, in grid units
 * @returns {?{zones: object[], moved: number[]}} the new zones and the indexes
 *     of the ones that changed; null if there is no line there (a screen edge)
 *     or it cannot move
 */
export function moveLine(zones, axis, at, span, target, min) {
    const x = axis === 'x';
    const start = z => (x ? z.col : z.row);
    const size = z => (x ? z.w : z.h);
    const cross = z => (x ? [z.row, z.row + z.h] : [z.col, z.col + z.w]);

    const before = i => near(start(zones[i]) + size(zones[i]), at);
    const after = i => near(start(zones[i]), at);
    const onLine = zones.map((_z, i) => i).filter(i => before(i) || after(i));

    // The line segment around the dragged edge, grown through zones that continue it.
    const members = new Set(onLine.filter(i => overlap(cross(zones[i]), span)));
    for (let grew = true; grew;) {
        grew = false;
        for (const i of onLine) {
            if (members.has(i))
                continue;
            if ([...members].some(m => overlapOrTouch(cross(zones[m]), cross(zones[i])))) {
                members.add(i);
                grew = true;
            }
        }
    }

    const firsts = [...members].filter(before);
    const seconds = [...members].filter(after);
    if (firsts.length === 0 || seconds.length === 0)
        return null;

    const lower = Math.max(...firsts.map(i => start(zones[i]) + min));
    const upper = Math.min(...seconds.map(i => start(zones[i]) + size(zones[i]) - min));
    if (lower > upper)
        return null;
    const to = Math.min(upper, Math.max(lower, target));
    if (near(to, at))
        return null;

    const out = zones.map(z => ({...z}));
    const set = (z, from, length) => {
        if (x) {
            z.col = from;
            z.w = length;
        } else {
            z.row = from;
            z.h = length;
        }
    };
    for (const i of firsts)
        set(out[i], start(zones[i]), to - start(zones[i]));
    for (const i of seconds)
        set(out[i], to, start(zones[i]) + size(zones[i]) - to);

    return {zones: out, moved: [...members].sort((a, b) => a - b)};
}
