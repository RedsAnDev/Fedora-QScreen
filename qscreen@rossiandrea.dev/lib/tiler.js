// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {cellRect, sortByPosition} from './layouts.js';

// Pending idle sources, so disable() can cancel them.
const pendingSources = new Set();

export function cancelPending() {
    for (const id of pendingSources)
        GLib.source_remove(id);
    pendingSources.clear();
}

function isTileable(win, monitor, includeMinimized) {
    if (win.get_window_type() !== Meta.WindowType.NORMAL)
        return false;
    if (win.is_skip_taskbar() || win.is_attached_dialog())
        return false;
    if (win.minimized && !includeMinimized)
        return false;
    return win.get_monitor() === monitor;
}

// The monitor holding the mouse pointer.
export function targetMonitor() {
    return global.display.get_current_monitor();
}

function place(win, rect) {
    if (win.minimized)
        win.unminimize();
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    if (win.is_maximized?.() ?? win.get_maximized())
        win.unmaximize();

    // Unmaximizing is applied asynchronously; resize on the next idle so the
    // new frame is not overridden by the restored geometry.
    const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        pendingSources.delete(id);
        if (win.allows_resize())
            win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        else
            win.move_frame(true, rect.x, rect.y);
        return GLib.SOURCE_REMOVE;
    });
    pendingSources.add(id);
}

/**
 * Work out where each window would go for `layout`, without moving anything.
 *
 * @param {object} layout a layout returned by parseLayout()
 * @param {{gap: number, outerGap: number, assignment: string,
 *     includeMinimized: boolean, monitor: ?number}} opts `monitor` defaults
 *     to the one under the pointer
 * @returns {{monitor: number, cells: {rect: object, window: ?Meta.Window}[]}}
 *     one entry per layout cell, `window` is null for cells left empty
 */
export function plan(layout, opts) {
    const monitor = opts.monitor ?? targetMonitor();
    const workspace = global.workspace_manager.get_active_workspace();
    const area = workspace.get_work_area_for_monitor(monitor);

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
 * @returns {number} how many windows were placed
 */
export function tile(layout, opts) {
    let count = 0;
    for (const {rect, window} of plan(layout, opts).cells) {
        if (!window)
            continue;
        place(window, rect);
        count++;
    }
    return count;
}
