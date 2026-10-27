// SPDX-License-Identifier: GPL-2.0-or-later
// Run with: node tests/reflow.test.js
import assert from 'node:assert/strict';
import {cellRect, near, parseLayout} from '../qscreen@rossiandrea.dev/lib/layouts.js';
import {balancedSpec, expandInto, moveLine} from '../qscreen@rossiandrea.dev/lib/reflow.js';

const z = (col, row, w, h, extra = {}) => ({col, row, w, h, ...extra});
// Rounded, so float noise (0.6000000000000001) does not matter.
const round = n => Math.round(n * 1e6) / 1e6;
const geo = zones => zones.map(({col, row, w, h}) => [col, row, w, h].map(round));

// --- expandInto -----------------------------------------------------------

// 2x2: freeing top-right is absorbed by the zone on its left
let zones = parseLayout('grid:2x2').cells;
assert.deepEqual(geo(expandInto(zones, 1)), [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1]]);

// "big left + two right": freeing the top-right one lets the bottom-right grow up,
// the tall left zone cannot take it (it is taller than the hole)
zones = parseLayout('cols:1,2').cells;
assert.deepEqual(geo(expandInto(zones, 1)), [[0, 0, 1, 2], [1, 0, 1, 2]]);

// freeing the big one: both stacked neighbours grow left, each over its own half
assert.deepEqual(geo(expandInto(zones, 0)), [[0, 0, 2, 1], [0, 1, 2, 1]]);

// extra properties travel with the zone
const tagged = [z(0, 0, 1, 1, {window: 'a'}), z(1, 0, 1, 1, {window: 'b'})];
assert.deepEqual(expandInto(tagged, 1), [z(0, 0, 2, 1, {window: 'a'})]);

// a single remaining zone takes everything
assert.deepEqual(geo(expandInto([z(0, 0, 1, 1), z(1, 0, 1, 1)], 0)), [[0, 0, 2, 1]]);

// no side can take the hole: two tall zones around a small one
zones = [z(0, 0, 1, 3), z(2, 0, 1, 3), z(1, 1, 1, 1)];
assert.equal(expandInto(zones, 2), null);

// the input is not modified
zones = parseLayout('grid:2x2').cells;
const before = JSON.stringify(zones);
expandInto(zones, 0);
assert.equal(JSON.stringify(zones), before);

// whatever is freed, what remains still covers the grid with no overlap
for (const spec of ['grid:3x3', 'rows:2,1,3', 'cols:1,3', 'grid:4x2']) {
    const layout = parseLayout(spec);
    for (let i = 0; i < layout.cells.length; i++) {
        const next = expandInto(layout.cells, i);
        if (!next)
            continue;
        const covered = next.reduce((sum, c) => sum + c.w * c.h, 0);
        assert.ok(near(covered, layout.cols * layout.rows), `${spec} minus ${i}: area preserved`);
    }
}

// --- balancedSpec ---------------------------------------------------------

assert.equal(balancedSpec(1), 'rows:1');
assert.equal(balancedSpec(2), 'rows:2');
assert.equal(balancedSpec(3), 'rows:2,1');
assert.equal(balancedSpec(4), 'rows:2,2');
assert.equal(balancedSpec(5), 'rows:3,2');
assert.equal(balancedSpec(7), 'rows:3,2,2');
for (let n = 1; n <= 16; n++) {
    const l = parseLayout(balancedSpec(n));
    assert.ok(l, `balancedSpec(${n}) must parse`);
    assert.equal(l.cells.length, n);
}

// --- moveLine -------------------------------------------------------------

// 2x2: the vertical divider moves as a whole, from either top window's edge
zones = parseLayout('grid:2x2').cells;
let r = moveLine(zones, 'x', 1, [0, 1], 1.25, 0.3);
assert.deepEqual(geo(r.zones), [[0, 0, 1.25, 1], [1.25, 0, 0.75, 1], [0, 1, 1.25, 1], [1.25, 1, 0.75, 1]]);
assert.deepEqual(r.moved, [0, 1, 2, 3]);

// squeezing is limited by the minimum size
r = moveLine(zones, 'x', 1, [0, 1], 1.95, 0.3);
assert.ok(near(r.zones[0].w, 1.7));
r = moveLine(zones, 'x', 1, [0, 1], 0.05, 0.3);
assert.ok(near(r.zones[0].w, 0.3));

// a screen edge is not a shared line
assert.equal(moveLine(zones, 'x', 0, [0, 1], 0.5, 0.3), null);
assert.equal(moveLine(zones, 'x', 2, [0, 1], 1.5, 0.3), null);
// nothing to do when it would not move
assert.equal(moveLine(zones, 'x', 1, [0, 1], 1, 0.3), null);

// "big left + two right": the horizontal divider only exists on the right
zones = parseLayout('cols:1,2').cells;
r = moveLine(zones, 'y', 1, [1, 2], 0.5, 0.2);
assert.deepEqual(geo(r.zones), [[0, 0, 1, 2], [1, 0, 1, 0.5], [1, 0.5, 1, 1.5]]);
assert.deepEqual(r.moved, [1, 2]);

// the vertical divider there touches all three zones
r = moveLine(zones, 'x', 1, [0, 2], 1.4, 0.2);
assert.deepEqual(geo(r.zones), [[0, 0, 1.4, 2], [1.4, 0, 0.6, 1], [1.4, 1, 0.6, 1]]);

// a divider made of two separate, non-touching segments moves only the one dragged
zones = [z(0, 0, 1, 1), z(1, 0, 1, 1), z(0, 2, 1, 1), z(1, 2, 1, 1)];
r = moveLine(zones, 'x', 1, [0, 1], 1.2, 0.2);
assert.deepEqual(r.moved, [0, 1]);
assert.deepEqual(geo(r.zones).slice(2), [[0, 2, 1, 1], [1, 2, 1, 1]]);

// the input is not modified
zones = parseLayout('grid:2x2').cells;
const snapshot = JSON.stringify(zones);
moveLine(zones, 'x', 1, [0, 1], 1.3, 0.3);
assert.equal(JSON.stringify(zones), snapshot);

// --- fractional zones in cellRect ----------------------------------------

const area = {x: 0, y: 0, width: 1000, height: 500};
const dims = {cols: 2, rows: 1};
const left = cellRect(dims, z(0, 0, 1.2, 1), area, 10, 20);
const right = cellRect(dims, z(1.2, 0, 0.8, 1), area, 10, 20);
assert.equal(left.x, 20);
assert.equal(right.x - (left.x + left.width), 10, 'gap between neighbours stays exact');
assert.equal(right.x + right.width, 1000 - 20, 'outer gap applies to the last zone');

console.log('reflow: all tests passed');
