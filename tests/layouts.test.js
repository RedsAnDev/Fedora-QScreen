// SPDX-License-Identifier: GPL-2.0-or-later
// Run with: node tests/layouts.test.js
import assert from 'node:assert/strict';
import {BUILTIN_SECTIONS, cellRect, parseLayout, sortByPosition} from '../qscreen@rossiandrea.dev/lib/layouts.js';

const area = {x: 0, y: 30, width: 1200, height: 600};

// Every built-in parses, and its cells tile the grid exactly (no overlap, no hole).
for (const section of BUILTIN_SECTIONS) {
    for (const spec of section.specs) {
        const l = parseLayout(spec);
        assert.ok(l, `built-in ${spec} must parse`);
        const covered = new Map();
        for (const c of l.cells) {
            for (let r = c.row; r < c.row + c.h; r++) {
                for (let k = c.col; k < c.col + c.w; k++) {
                    const key = `${k},${r}`;
                    assert.ok(!covered.has(key), `${spec}: overlap at ${key}`);
                    covered.set(key, true);
                }
            }
        }
        assert.equal(covered.size, l.cols * l.rows, `${spec}: grid not fully covered`);
    }
}

// Grids
let l = parseLayout('grid:4x4');
assert.equal(l.cells.length, 16);
assert.deepEqual(l.cells[5], {col: 1, row: 1, w: 1, h: 1});

// rows:2,1,3 -> lcm 6 columns, 3 rows
l = parseLayout('rows:2,1,3');
assert.equal(l.cols, 6);
assert.equal(l.rows, 3);
assert.equal(l.cells.length, 6);
assert.deepEqual(l.cells[2], {col: 0, row: 1, w: 6, h: 1});

// cols is the transpose
l = parseLayout('cols:1,3');
assert.equal(l.cols, 2);
assert.equal(l.rows, 3);
assert.deepEqual(l.cells[0], {col: 0, row: 0, w: 1, h: 3});

// Labels and rects
l = parseLayout('rects:0,0,1,2;1,0,1,1;1,1,1,1@Side');
assert.equal(l.name, 'Side');
assert.equal(l.id, 'rects:0,0,1,2;1,0,1,1;1,1,1,1@Side');

// Invalid input
for (const bad of ['', 'grid:0x2', 'grid:2', 'grid:99x99', 'rows:0', 'rows:a,b',
    'rects:0,0,0,1', 'rects:1,2,3', 'nope:1', 'rects:', null, 42])
    assert.equal(parseLayout(bad), null, `${bad} must be rejected`);

// Geometry: 2x2, gap 10, outer 20
l = parseLayout('grid:2x2');
const tl = cellRect(l, l.cells[0], area, 10, 20);
assert.deepEqual(tl, {x: 20, y: 50, width: 600 - 20 - 5, height: 300 - 20 - 5});
const br = cellRect(l, l.cells[3], area, 10, 20);
assert.equal(br.x + br.width, 1200 - 20);
assert.equal(br.y + br.height, 630 - 20);
// Gap between neighbours is exactly `gap`
const tr = cellRect(l, l.cells[1], area, 10, 20);
assert.equal(tr.x - (tl.x + tl.width), 10);

// Sorting by position
const wins = [
    {id: 'br', r: {x: 700, y: 400, width: 400, height: 200}},
    {id: 'tl', r: {x: 10, y: 40, width: 400, height: 200}},
    {id: 'bl', r: {x: 10, y: 400, width: 400, height: 200}},
    {id: 'tr', r: {x: 700, y: 40, width: 400, height: 200}},
];
assert.deepEqual(sortByPosition(wins, w => w.r, l, area).map(w => w.id), ['tl', 'tr', 'bl', 'br']);

console.log('layouts: all tests passed');
