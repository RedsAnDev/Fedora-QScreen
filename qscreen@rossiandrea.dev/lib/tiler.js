// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {cellRect, sortByPosition} from './layouts.js';

// How long to wait before checking that a window really took its frame.
const SETTLE_MS = 150;

// Windows with something scheduled: window -> {source, unmanaged}. Each entry
// is dropped if the window goes away first, so nothing runs on a dead window.
const pending = new Map();

function forget(win) {
    const entry = pending.get(win);
    if (!entry)
        return;
    pending.delete(win);
    if (entry.source)
        GLib.source_remove(entry.source);
    win.disconnect(entry.unmanaged);
}

export function cancelPending() {
    for (const win of [...pending.keys()])
        forget(win);
}

function isTileable(win, monitor, includeMinimized) {
    if (win.get_window_type() !== Meta.WindowType.NORMAL)
        return false;
    if (win.is_skip_taskbar() || win.is_attached_dialog() || win.is_override_redirect())
        return false;
    // Pinned, floating-on-top and sticky windows are meant to stay out of the way.
    if (win.is_above() || win.is_on_all_workspaces())
        return false;
    if (win.minimized && !includeMinimized)
        return false;
    return win.get_monitor() === monitor;
}

// The monitor holding the mouse pointer.
export function targetMonitor() {
    return global.display.get_current_monitor();
}

/**
 * A stable name for a monitor: its connector (e.g. "DP-1"), which survives
 * unplugging and re-plugging, unlike the index. Falls back to the index.
 */
export function monitorKey(index) {
    const manager = global.backend.get_monitor_manager();
    for (const monitor of manager.get_monitors()) {
        const connector = monitor.get_connector();
        if (connector && manager.get_monitor_for_connector(connector) === index)
            return connector;
    }
    return String(index);
}

export function workArea(monitor, workspace = global.workspace_manager.get_active_workspace()) {
    return workspace.get_work_area_for_monitor(monitor);
}

// Keep a window that refused to shrink (minimum size) inside the work area.
function keepInside(win, area) {
    const frame = win.get_frame_rect();
    const x = Math.max(area.x, Math.min(frame.x, area.x + area.width - frame.width));
    const y = Math.max(area.y, Math.min(frame.y, area.y + area.height - frame.height));
    if (x !== frame.x || y !== frame.y)
        win.move_frame(true, x, y);
}

/**
 * Put `win` in `rect`. Unmaximizing and the like are applied asynchronously,
 * so the resize waits for the next idle, then a short settle delay lets us
 * correct windows that could not take the size.
 */
export function placeWindow(win, rect, area) {
    forget(win);

    if (win.minimized)
        win.unminimize();
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    if (win.is_maximized())
        win.unmaximize();

    const entry = {source: 0, unmanaged: win.connect('unmanaged', () => forget(win))};
    pending.set(win, entry);

    entry.source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (win.allows_resize())
            win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        else
            win.move_frame(true, rect.x, rect.y);

        entry.source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            entry.source = 0;
            keepInside(win, area);
            forget(win);
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Work out where each window would go for `layout`, without moving anything.
 *
 * @param {object} layout a layout returned by parseLayout()
 * @param {{gap: number, outerGap: number, assignment: string,
 *     includeMinimized: boolean, monitor: ?number}} opts `monitor` defaults
 *     to the one under the pointer
 * @returns {{monitor: number, area: object,
 *     cells: {rect: object, window: ?Meta.Window}[]}}
 *     one entry per layout cell, `window` is null for cells left empty
 */
export function plan(layout, opts) {
    const monitor = opts.monitor ?? targetMonitor();
    const workspace = global.workspace_manager.get_active_workspace();
    const area = workArea(monitor, workspace);

    let windows;
    if (opts.assignment === 'recent') {
        windows = global.display
            .get_tab_list(Meta.TabList.NORMAL, workspace)
            .filter(w => isTileable(w, monitor, opts.includeMinimized));
    } else {
        windows = workspace.list_windows()
            .filter(w => isTileable(w, monitor, opts.includeMinimized));
        windows = sortByPosition(windows, w => w.get_frame_rect(), layout, area);
    }

    return {
        monitor,
        area,
        cells: layout.cells.map((cell, i) => ({
            rect: cellRect(layout, cell, area, opts.gap, opts.outerGap),
            window: windows[i] ?? null,
        })),
    };
}

/**
 * Arrange the windows of the active workspace, on the monitor under the
 * pointer, into the cells of `layout`.
 *
 * @returns {{count: number, monitor: number,
 *     zones: {col: number, row: number, w: number, h: number, window: ?Meta.Window}[]}}
 *     how many windows were placed, and every zone with the window it got
 */
export function tile(layout, opts) {
    const {monitor, area, cells} = plan(layout, opts);
    let count = 0;
    cells.forEach(({rect, window}) => {
        if (!window)
            return;
        placeWindow(window, rect, area);
        count++;
    });
    return {
        count,
        monitor,
        zones: layout.cells.map((cell, i) => ({...cell, window: cells[i].window})),
    };
}
