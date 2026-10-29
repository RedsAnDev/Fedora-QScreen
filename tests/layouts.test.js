// SPDX-License-Identifier: GPL-2.0-or-later
// Run with: node tests/layouts.test.js
import assert from 'node:assert/strict';
import {BUILTIN_SECTIONS, cellRect, formatRects, labelOf, overlaps, parseLayout, sortByPosition} from '../qscreen@rossiandrea.dev/lib/layouts.js';

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

// Overlap detection
const cell = (col, row, w, h) => ({col, row, w, h});
assert.ok(overlaps(cell(0, 0, 2, 2), cell(1, 1, 2, 2)));
assert.ok(!overlaps(cell(0, 0, 1, 2), cell(1, 0, 1, 2)), 'touching edges do not overlap');
assert.ok(!overlaps(cell(0, 0, 1, 1), cell(0, 1, 1, 1)));

// formatRects round-trips through parseLayout, in reading order
const drawn = [cell(1, 1, 1, 1), cell(0, 0, 1, 2), cell(1, 0, 1, 1)];
const spec = formatRects(drawn, '  Side  ');
assert.equal(spec, 'rects:0,0,1,2;1,0,1,1;1,1,1,1@Side');
l = parseLayout(spec);
assert.equal(l.id, spec);
assert.deepEqual(l.cells, [cell(0, 0, 1, 2), cell(1, 0, 1, 1), cell(1, 1, 1, 1)]);
assert.equal(formatRects(drawn), 'rects:0,0,1,2;1,0,1,1;1,1,1,1');
assert.equal(formatRects([cell(0, 0, 1, 1)], 'a@b;c'), 'rects:0,0,1,1@a@b;c');
assert.equal(parseLayout('rects:0,0,1,1@a@b;c').name, 'a@b;c');
assert.equal(labelOf('rects:0,0,1,1@a@b;c'), 'a@b;c');
assert.equal(labelOf('grid:2x2'), '');

// A declared grid size is kept even when the zones do not fill it
l = parseLayout('rects:12x6;0,0,9,2');
assert.equal(l.cols, 12);
assert.equal(l.rows, 6);
assert.deepEqual(l.cells, [cell(0, 0, 9, 2)]);
assert.equal(formatRects([cell(0, 0, 9, 2)], '', {cols: 12, rows: 6}), 'rects:12x6;0,0,9,2');
assert.equal(formatRects([cell(0, 0, 9, 2)], 'A', {cols: 12, rows: 6}), 'rects:12x6;0,0,9,2@A');
// ...but nothing extra is written when the zones already span the grid
assert.equal(formatRects([cell(0, 0, 2, 1)], '', {cols: 2, rows: 1}), 'rects:0,0,2,1');
// a zone sticking out of the declared size wins over it
assert.equal(parseLayout('rects:2x2;0,0,3,1').cols, 3);
assert.equal(parseLayout('rects:99x99;0,0,1,1'), null);
l = parseLayout(formatRects([cell(1, 1, 2, 1)], 'x', {cols: 5, rows: 4}));
assert.equal(l.cols, 5);
assert.equal(l.rows, 4);

// Too many zones are rejected instead of exhausting the stack or the picker
const manyZones = n => `rects:${Array(n).fill('0,0,1,1').join(';')}`;
assert.equal(parseLayout(manyZones(576)).cells.length, 576);
assert.equal(parseLayout(manyZones(577)), null);
assert.doesNotThrow(() => parseLayout(manyZones(200000)));
assert.equal(parseLayout(manyZones(200000)), null);

console.log('layouts: all tests passed');
