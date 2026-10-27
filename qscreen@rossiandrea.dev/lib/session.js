// SPDX-License-Identifier: GPL-2.0-or-later
//
// Keeps tiled windows linked. After a layout is applied, the windows it placed
// form a session that remembers which zone holds which window. From then on:
//
//  - when a window closes (or leaves the zone, workspace or monitor), the
//    others take over its space, are re-tiled, or leave it empty (setting);
//  - dragging the edge between two windows resizes the neighbours with it;
//  - dropping a window on another zone swaps the two, dropping it anywhere
//    else releases it from the group.

import {cellRect, parseLayout} from './layouts.js';
import {balancedSpec, expandInto, moveLine} from './reflow.js';
import {placeWindow, workArea} from './tiler.js';

// Smallest size a dragged edge may squeeze a window to.
const MIN_ZONE_PX = 120;
// Movement below this is a click or jitter, not a drag.
const SLACK_PX = 3;

const copyRect = r => ({x: r.x, y: r.y, width: r.width, height: r.height});

export class SessionManager {
    /**
     * @param {function(): {gap: number, outerGap: number, linked: boolean,
     *     onClose: string}} getOptions read at every event, so setting
     *     changes apply immediately
     */
    constructor(getOptions) {
        this._options = getOptions;
        this._sessions = new Set();
        this._watched = new Map();     // window -> {session, ids}
        this._grabStart = new Map();   // window -> frame rect when a grab began

        this._displayIds = [
            global.display.connect('grab-op-begin', (_d, win) => this._grabBegan(win)),
            global.display.connect('grab-op-end', (_d, win) => this._grabEnded(win)),
            global.display.connect('window-left-monitor', (_d, _monitor, win) => this._release(win)),
        ];
    }

    destroy() {
        for (const id of this._displayIds)
            global.display.disconnect(id);
        this._displayIds = [];
        this.clear();
    }

    /** Forget every session (e.g. when monitors change or linking is turned off). */
    clear() {
        for (const session of [...this._sessions])
            this._end(session);
    }

    /**
     * Start linking the windows just placed by a layout.
     *
     * @param {Meta.Workspace} workspace
     * @param {number} monitor
     * @param {object} layout the layout that was applied
     * @param {object[]} zones its zones, each with the `window` it holds
     */
    start(workspace, monitor, layout, zones) {
        for (const session of [...this._sessions]) {
            if (session.workspace === workspace && session.monitor === monitor)
                this._end(session);
        }
        console.log(`[qscreen] start linked=${this._options().linked} zones=${zones.length} windows=${zones.filter(z => z.window).length}`);
        if (!this._options().linked || !zones.some(z => z.window))
            return;

        const session = {workspace, monitor, cols: layout.cols, rows: layout.rows, zones};
        this._sessions.add(session);
        for (const zone of zones) {
            if (!zone.window)
                continue;
            this._leaveSession(zone.window);
            this._watch(session, zone.window);
        }
    }

    // A window taken over by a new session must not stay in its old one.
    _leaveSession(win) {
        const old = this._watched.get(win)?.session;
        if (!old)
            return;
        old.zones = old.zones.map(z => (z.window === win ? {...z, window: null} : z));
        if (!old.zones.some(z => z.window))
            this._end(old);
    }

    _watch(session, win) {
        this._unwatch(win);
        const ids = [
            win.connect('unmanaged', () => this._release(win)),
            win.connect('workspace-changed', () => this._release(win)),
        ];
        this._watched.set(win, {session, ids});
    }

    _unwatch(win) {
        const entry = this._watched.get(win);
        if (!entry)
            return;
        this._watched.delete(win);
        this._grabStart.delete(win);
        for (const id of entry.ids)
            win.disconnect(id);
    }

    _end(session) {
        for (const zone of session.zones) {
            if (zone.window)
                this._unwatch(zone.window);
        }
        this._sessions.delete(session);
    }

    _geometry(session) {
        return {area: workArea(session.monitor, session.workspace), dims: session};
    }

    // Move the given windows (all of them when `only` is null) to their zones.
    _place(session, only = null) {
        const {area, dims} = this._geometry(session);
        const {gap, outerGap} = this._options();
        for (const zone of session.zones) {
            if (!zone.window || (only && !only.has(zone.window)))
                continue;
            placeWindow(zone.window, cellRect(dims, zone, area, gap, outerGap), area);
        }
    }

    // A window leaves the group: closed, moved away, or dropped outside it.
    _release(win) {
        const entry = this._watched.get(win);
        console.log(`[qscreen] release watched=${!!entry} mode=${this._options().onClose}`);
        if (!entry)
            return;
        const {session} = entry;
        const index = session.zones.findIndex(z => z.window === win);
        this._unwatch(win);
        if (index < 0)
            return;

        if (!session.zones.some((z, i) => i !== index && z.window)) {
            this._end(session);
            return;
        }

        const mode = this._options().onClose;
        if (mode === 'keep') {
            session.zones[index] = {...session.zones[index], window: null};
            return;
        }
        if (mode === 'expand') {
            const grown = expandInto(session.zones, index);
            console.log(`[qscreen] expand index=${index} grown=${grown ? 'yes' : 'null'}`);
            if (grown) {
                const before = new Map(session.zones.map(z => [z.window, z]));
                session.zones = grown;
                const moved = new Set(grown
                    .filter(z => z.window && !sameZone(before.get(z.window), z))
                    .map(z => z.window));
                this._place(session, moved);
                return;
            }
        }
        this._retile(session, index);
    }

    // Re-arrange the windows still in the group in a balanced layout of their own.
    _retile(session, without = -1) {
        const windows = session.zones
            .filter((z, i) => i !== without && z.window)
            .sort((a, b) => a.row - b.row || a.col - b.col)
            .map(z => z.window);
        const layout = parseLayout(balancedSpec(windows.length));
        if (!layout)
            return;
        session.cols = layout.cols;
        session.rows = layout.rows;
        session.zones = layout.cells.map((cell, i) => ({...cell, window: windows[i] ?? null}));
        this._place(session);
    }

    _grabBegan(win) {
        if (win && this._watched.has(win))
            this._grabStart.set(win, copyRect(win.get_frame_rect()));
    }

    _grabEnded(win) {
        const begin = win && this._grabStart.get(win);
        const entry = win && this._watched.get(win);
        this._grabStart.delete(win);
        if (!begin || !entry)
            return;

        const end = copyRect(win.get_frame_rect());
        const resized = Math.abs(end.width - begin.width) > SLACK_PX ||
            Math.abs(end.height - begin.height) > SLACK_PX;
        if (resized)
            this._resized(entry.session, win, begin, end);
        else
            this._dropped(entry.session, win, end);
    }

    // The edges the user dragged move the lines shared with the neighbours.
    _resized(session, win, begin, end) {
        const {area} = this._geometry(session);
        const unitW = area.width / session.cols;
        const unitH = area.height / session.rows;

        const edges = [
            ['x', 'start', end.x - begin.x],
            ['x', 'end', end.x + end.width - (begin.x + begin.width)],
            ['y', 'start', end.y - begin.y],
            ['y', 'end', end.y + end.height - (begin.y + begin.height)],
        ];
        const affected = new Set([win]);

        for (const [axis, side, delta] of edges) {
            if (Math.abs(delta) < SLACK_PX)
                continue;
            const zone = session.zones.find(z => z.window === win);
            const horizontal = axis === 'x';
            const from = horizontal ? zone.col : zone.row;
            const length = horizontal ? zone.w : zone.h;
            const at = side === 'start' ? from : from + length;
            const unit = horizontal ? unitW : unitH;
            const span = horizontal ? [zone.row, zone.row + zone.h] : [zone.col, zone.col + zone.w];

            const result = moveLine(session.zones, axis, at, span, at + delta / unit, MIN_ZONE_PX / unit);
            if (!result)
                continue;
            session.zones = result.zones;
            for (const i of result.moved) {
                if (session.zones[i].window)
                    affected.add(session.zones[i].window);
            }
        }
        // Always re-place the dragged window: it snaps to the exact zone, even
        // when its edge was a screen edge and nothing moved.
        this._place(session, affected);
    }

    // A window was dragged and dropped: snap back, swap, or let go of it.
    _dropped(session, win, end) {
        const origin = session.zones.findIndex(z => z.window === win);
        const centre = {x: end.x + end.width / 2, y: end.y + end.height / 2};

        let target = -1;
        if (win.get_monitor() === session.monitor && win.get_workspace() === session.workspace) {
            const {area, dims} = this._geometry(session);
            target = session.zones.findIndex(z => {
                const r = cellRect(dims, z, area, 0, 0);
                return centre.x >= r.x && centre.x < r.x + r.width &&
                    centre.y >= r.y && centre.y < r.y + r.height;
            });
        }

        if (target < 0) {
            this._release(win);
            return;
        }
        if (target !== origin) {
            const other = session.zones[target].window;
            session.zones[target] = {...session.zones[target], window: win};
            session.zones[origin] = {...session.zones[origin], window: other};
        }
        this._place(session, new Set([win, session.zones[target].window, session.zones[origin].window]));
    }
}

const sameZone = (a, b) => a && b &&
    a.col === b.col && a.row === b.row && a.w === b.w && a.h === b.h;
