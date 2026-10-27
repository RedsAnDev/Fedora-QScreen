// SPDX-License-Identifier: GPL-2.0-or-later
// Exercises SessionManager against fake windows. Needs gjs and the Mutter
// typelib (tiler.js imports gi://Meta):
//   GI_TYPELIB_PATH=/usr/lib64/mutter-18 gjs -m tests/session.test.js
import GLib from 'gi://GLib';

// gjs has no node:assert.
const fail = (message, detail = '') => {
    throw new Error(`${message}${detail ? `\n${detail}` : ''}`);
};
const assert = {
    ok: (value, message = 'expected a truthy value') => value || fail(message),
    equal: (a, b, message = '') => a === b || fail(message || 'not equal', `${a} !== ${b}`),
    deepEqual: (a, b, message = '') => JSON.stringify(a) === JSON.stringify(b) ||
        fail(message || 'not deep equal', `actual:   ${JSON.stringify(a)}\nexpected: ${JSON.stringify(b)}`),
};

const AREA = {x: 0, y: 0, width: 1200, height: 600};
const workspace = {get_work_area_for_monitor: () => AREA};
const handlers = {};
globalThis.global = {
    display: {
        connect: (name, cb) => {
            handlers[name] = cb;
            return name;
        },
        disconnect: () => {},
    },
    workspace_manager: {get_active_workspace: () => workspace},
};

const {cellRect, parseLayout} = await import('../qscreen@rossiandrea.dev/lib/layouts.js');
const {SessionManager} = await import('../qscreen@rossiandrea.dev/lib/session.js');
const {placeWindow} = await import('../qscreen@rossiandrea.dev/lib/tiler.js');

class FakeWindow {
    constructor(name) {
        this.name = name;
        this.frame = {x: 0, y: 0, width: 100, height: 100};
        this.minimized = false;
        this._handlers = new Map();
        this._next = 1;
    }

    connect(signal, cb) {
        const id = this._next++;
        this._handlers.set(id, {signal, cb});
        return id;
    }

    disconnect(id) {
        assert.ok(this._handlers.delete(id), `${this.name}: disconnect of unknown handler`);
    }

    emit(signal) {
        for (const h of [...this._handlers.values()]) {
            if (h.signal === signal)
                h.cb();
        }
    }

    get listeners() {
        return this._handlers.size;
    }

    is_fullscreen() { return false; }
    is_maximized() { return false; }
    allows_resize() { return true; }
    get_monitor() { return 0; }
    get_workspace() { return workspace; }
    get_frame_rect() { return {...this.frame}; }
    move_resize_frame(_u, x, y, width, height) { this.frame = {x, y, width, height}; }
    move_frame(_u, x, y) { this.frame = {...this.frame, x, y}; }
}

const settle = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const rect = w => [w.frame.x, w.frame.y, w.frame.width, w.frame.height];
const options = {gap: 0, outerGap: 0, linked: true, onClose: 'expand'};

async function scenario(spec, count, mode, body) {
    const manager = new SessionManager(() => ({...options, onClose: mode}));
    const layout = parseLayout(spec);
    const windows = Array.from({length: count}, (_, i) => new FakeWindow(`w${i}`));
    // tile() has already put each window in its zone when a session starts.
    windows.forEach((w, i) => {
        const r = cellRect(layout, layout.cells[i], AREA, 0, 0);
        w.frame = {x: r.x, y: r.y, width: r.width, height: r.height};
    });
    const zones = layout.cells.map((cell, i) => ({...cell, window: windows[i] ?? null}));
    manager.start(workspace, 0, layout, zones);
    await body(windows, manager);
    manager.destroy();
}

const drag = (win, change) => {
    handlers['grab-op-begin'](null, win, 0);
    change(win.frame);
    handlers['grab-op-end'](null, win, 0);
};

// 2x2, closing top-right: top-left grows across the top row
await scenario('grid:2x2', 4, 'expand', async ([a, b, c, d]) => {
    b.emit('unmanaged');
    await settle();
    assert.deepEqual(rect(a), [0, 0, 1200, 300]);
    assert.equal(b.listeners, 0, 'closed window is no longer watched');
    assert.deepEqual(rect(c), [0, 300, 600, 300], 'untouched windows stay put');
    assert.equal(d.listeners, 2);
});

// closing windows one after another keeps everything covered
await scenario('grid:2x2', 4, 'expand', async ([a, b, c, d]) => {
    b.emit('unmanaged');
    c.emit('unmanaged');
    await settle();
    assert.deepEqual(rect(a), [0, 0, 1200, 300]);
    assert.deepEqual(rect(d), [0, 300, 1200, 300]);
});

// "big left + two right": closing the big one stacks the others full width
await scenario('cols:1,2', 3, 'expand', async ([big, top, bottom]) => {
    big.emit('unmanaged');
    await settle();
    assert.deepEqual(rect(top), [0, 0, 1200, 300]);
    assert.deepEqual(rect(bottom), [0, 300, 1200, 300]);
});

// re-tile: three left of four -> two on top, one full width below
await scenario('grid:2x2', 4, 'retile', async ([a, b, c, d]) => {
    d.emit('unmanaged');
    await settle();
    assert.deepEqual(rect(a), [0, 0, 600, 300]);
    assert.deepEqual(rect(b), [600, 0, 600, 300]);
    assert.deepEqual(rect(c), [0, 300, 1200, 300]);
});

// keep: nothing moves
await scenario('grid:2x2', 4, 'keep', async ([a, b, c, d]) => {
    const before = [a, c, d].map(rect);
    b.emit('unmanaged');
    await settle();
    assert.deepEqual([a, c, d].map(rect), before);
});

// the last window closing ends the session cleanly
await scenario('grid:2x2', 1, 'expand', async ([a]) => {
    a.emit('unmanaged');
    await settle();
    assert.equal(a.listeners, 0);
});

// leaving the workspace releases a window too
await scenario('grid:2x2', 4, 'expand', async ([a, b]) => {
    b.emit('workspace-changed');
    await settle();
    assert.deepEqual(rect(a), [0, 0, 1200, 300]);
});

// dragging the divider resizes the neighbours with it
await scenario('grid:2x2', 4, 'expand', async ([a, b, c, d]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    drag(a, f => { f.width = 700; });
    await settle();
    assert.deepEqual(rect(a), [0, 0, 700, 300]);
    assert.deepEqual(rect(b), [700, 0, 500, 300]);
    assert.deepEqual(rect(c), [0, 300, 700, 300], 'the whole divider moves');
    assert.deepEqual(rect(d), [700, 300, 500, 300]);
});

// a corner drag moves both dividers
await scenario('grid:2x2', 4, 'expand', async ([a, b, c, d]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    drag(a, f => { f.width = 700; f.height = 400; });
    await settle();
    assert.deepEqual(rect(a), [0, 0, 700, 400]);
    assert.deepEqual(rect(b), [700, 0, 500, 400]);
    assert.deepEqual(rect(c), [0, 400, 700, 200]);
    assert.deepEqual(rect(d), [700, 400, 500, 200]);
});

// dragging past the minimum size is clamped
await scenario('grid:2x2', 4, 'expand', async ([a, b]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    drag(a, f => { f.width = 1190; });
    await settle();
    assert.equal(b.frame.width, 120, 'neighbour keeps its minimum size');
    assert.equal(a.frame.width, 1080);
});

// dragging a screen edge snaps the window back
await scenario('grid:2x2', 4, 'expand', async ([a]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    drag(a, f => { f.x = -40; f.width = 640; });
    await settle();
    assert.deepEqual(rect(a), [0, 0, 600, 300]);
});

// drop on another zone: the two swap
await scenario('grid:2x2', 4, 'expand', async ([a, b]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    b.frame = {x: 600, y: 0, width: 600, height: 300};
    drag(a, f => { f.x = 650; f.y = 20; });
    await settle();
    assert.deepEqual(rect(a), [600, 0, 600, 300]);
    assert.deepEqual(rect(b), [0, 0, 600, 300]);
});

// drop inside its own zone: snaps back
await scenario('grid:2x2', 4, 'expand', async ([a]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    drag(a, f => { f.x = 30; f.y = 10; });
    await settle();
    assert.deepEqual(rect(a), [0, 0, 600, 300]);
});

// drop outside every zone: released, the others fill in
await scenario('grid:2x2', 4, 'expand', async ([a, b]) => {
    a.frame = {x: 0, y: 0, width: 600, height: 300};
    drag(a, f => { f.x = 0; f.y = -800; });
    await settle();
    assert.equal(a.listeners, 0, 'released window is no longer watched');
    assert.deepEqual(rect(b), [0, 0, 1200, 300], 'its neighbour took the whole row');
});

// linking disabled: nothing is watched
{
    const manager = new SessionManager(() => ({...options, linked: false}));
    const layout = parseLayout('grid:2x2');
    const w = new FakeWindow('w');
    manager.start(workspace, 0, layout, layout.cells.map(c => ({...c, window: w})));
    assert.equal(w.listeners, 0);
    manager.destroy();
}

// placeWindow: a window closed before the move is never touched
{
    const w = new FakeWindow('closing');
    placeWindow(w, {x: 5, y: 5, width: 50, height: 50}, AREA);
    w.emit('unmanaged');
    await settle();
    assert.deepEqual(rect(w), [0, 0, 100, 100]);
    assert.equal(w.listeners, 0, 'no handler is left on the window');
}

// placeWindow: a window that cannot shrink is pulled back inside the work area
{
    const w = new FakeWindow('stubborn');
    w.move_resize_frame = (_u, x, y) => {
        w.frame = {x, y, width: 900, height: 700};
    };
    placeWindow(w, {x: 800, y: 300, width: 400, height: 300}, AREA);
    await settle();
    assert.deepEqual(rect(w), [300, 0, 900, 700].map((v, i) => (i === 1 ? 0 : v)));
    assert.equal(w.listeners, 0);
}

console.log('session: all tests passed');
