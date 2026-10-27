// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {targetMonitor} from './tiler.js';

const PREVIEW_W = 132;
const PREVIEW_H = 84;

function buildPreview(layout) {
    const preview = new St.Widget({
        style_class: 'qscreen-preview',
        layout_manager: new Clutter.FixedLayout(),
        width: PREVIEW_W,
        height: PREVIEW_H,
    });
    const unitW = (PREVIEW_W - 8) / layout.cols;
    const unitH = (PREVIEW_H - 8) / layout.rows;
    for (const cell of layout.cells) {
        const rect = new St.Widget({style_class: 'qscreen-preview-cell'});
        rect.set_position(4 + Math.round(cell.col * unitW) + 1, 4 + Math.round(cell.row * unitH) + 1);
        rect.set_size(
            Math.max(2, Math.round(cell.w * unitW) - 2),
            Math.max(2, Math.round(cell.h * unitH) - 2));
        preview.add_child(rect);
    }
    return preview;
}

// Buttons are wired by hand (press + release) so a click never depends on
// St.Button's own grab handling, which does not play well with the modal grab.
function onClick(actor, callback) {
    let pressed = false;
    actor.connect('button-press-event', () => {
        pressed = true;
        return Clutter.EVENT_STOP;
    });
    actor.connect('button-release-event', (_actor, event) => {
        if (pressed)
            callback(event.get_button());
        pressed = false;
        return Clutter.EVENT_STOP;
    });
    actor.connect('leave-event', () => {
        pressed = false;
        return Clutter.EVENT_PROPAGATE;
    });
}

/**
 * Full-screen picker with a tab for the standard layouts and one for the
 * user's own (plus favourites). Mouse: click to apply, right click to toggle
 * favourite. Keyboard: arrows move across the tiles, Tab switches tab,
 * Enter applies, F toggles favourite.
 */
export class LayoutOverlay {
    /**
     * @param {object} params
     * @param {() => {id: string, title: string, empty: string,
     *     sections: {title: string, layouts: object[]}[]}[]} params.getTabs
     * @param {string} params.currentId id of the layout to highlight
     * @param {(layout: object) => void} params.onPick
     * @param {(layout: object) => boolean} params.isFavorite
     * @param {(layout: object) => void} params.onToggleFavorite
     * @param {(layout: object) => object} params.getPlan preview of where windows would go
     */
    constructor({getTabs, currentId, onPick, isFavorite, onToggleFavorite, getPlan}) {
        this._getTabs = getTabs;
        this._currentId = currentId;
        this._onPick = onPick;
        this._isFavorite = isFavorite;
        this._onToggleFavorite = onToggleFavorite;
        this._getPlan = getPlan;
        this._ghosts = [];
        this._plans = new Map();
        this._grabbed = null;
        this._tiles = [];
        this._index = 0;
        this._done = false;

        this._tabs = getTabs();
        this._tab = Math.max(0, this._tabs.findIndex(t =>
            t.sections.some(s => s.layouts.some(l => l.id === currentId))));

        const monitor = Main.layoutManager.monitors[targetMonitor()] ??
            Main.layoutManager.currentMonitor;
        this._monitor = monitor;
        this._actor = new St.Widget({
            style_class: 'qscreen-overlay',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            opacity: 0,
        });
        this._actor.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._actor.connect('key-press-event', (_actor, event) =>
            this._onKey(event.get_key_symbol()));

        // Ghost zones drawn over the desktop, below the picker panel.
        this._ghostLayer = new St.Widget({layout_manager: new Clutter.FixedLayout()});
        this._actor.add_child(this._ghostLayer);

        const panel = new St.BoxLayout({
            style_class: 'qscreen-panel',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            reactive: true,
            style: 'margin-bottom: 28px;',
            width: Math.min(monitor.width - 80, 820),
        });
        // Clicks inside the panel must not close the overlay.
        panel.connect('button-press-event', () => Clutter.EVENT_STOP);

        const tabBar = new St.BoxLayout({style_class: 'qscreen-tabbar'});
        this._tabButtons = this._tabs.map((tab, i) => {
            const button = new St.Button({
                style_class: 'qscreen-tab',
                label: tab.title,
                reactive: true,
                track_hover: true,
            });
            onClick(button, () => this._selectTab(i));
            tabBar.add_child(button);
            return button;
        });
        panel.add_child(tabBar);

        this._scroll = new St.ScrollView({
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            height: Math.round(monitor.height * 0.3),
        });
        this._content = new St.BoxLayout({vertical: true, x_expand: true});
        this._scroll.add_child(this._content);
        panel.add_child(this._scroll);

        panel.add_child(new St.Label({
            style_class: 'qscreen-hint',
            text: _('Arrows: move · Enter / click: apply · Tab: switch tab · F / right click: favourite · Esc: close'),
        }));

        this._actor.add_child(panel);
        Main.uiGroup.add_child(this._actor);

        this._grabbed = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grabbed) {
            this._destroy();
            return;
        }
        this._render(currentId);
        this._actor.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // Rebuild the tab contents (e.g. after a favourite changed) keeping the focus.
    refresh() {
        if (!this._actor)
            return;
        const focused = this._tiles[this._index]?.layout.id ?? null;
        this._tabs = this._getTabs();
        this._render(focused);
    }

    _render(focusId) {
        this._tabButtons.forEach((button, i) => {
            if (i === this._tab)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        });

        this._content.destroy_all_children();
        this._tiles = [];

        const tab = this._tabs[this._tab];
        for (const section of tab.sections) {
            if (section.layouts.length === 0)
                continue;
            this._content.add_child(new St.Label({
                style_class: 'qscreen-section-title',
                text: section.title,
            }));
            const flow = new St.Widget({
                x_expand: true,
                layout_manager: new Clutter.FlowLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    column_spacing: 10,
                    row_spacing: 10,
                }),
            });
            for (const layout of section.layouts)
                flow.add_child(this._makeTile(layout));
            this._content.add_child(flow);
        }

        if (this._tiles.length === 0) {
            this._content.add_child(new St.Label({
                style_class: 'qscreen-empty',
                text: tab.empty,
            }));
            this._hideGhosts();
            this._actor.grab_key_focus();
            return;
        }

        let index = this._tiles.findIndex(t => t.layout.id === focusId);
        if (index < 0)
            index = 0;
        this._focus(index);
    }

    _makeTile(layout) {
        const tile = new St.Button({
            style_class: 'qscreen-tile',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        if (layout.id === this._currentId)
            tile.add_style_pseudo_class('checked');
        const box = new St.BoxLayout({vertical: true});
        box.add_child(buildPreview(layout));
        box.add_child(new St.Label({
            style_class: 'qscreen-tile-label',
            text: this._isFavorite(layout) ? `★ ${layout.name}` : layout.name,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        tile.set_child(box);

        const entry = {actor: tile, layout};
        this._tiles.push(entry);
        tile.connect('notify::hover', () => {
            if (tile.hover)
                this._focus(this._tiles.indexOf(entry), false);
        });
        tile.connect('key-focus-in', () => {
            this._index = this._tiles.indexOf(entry);
            this._showGhosts(layout);
        });
        // Keyboard activation (Enter/Space) comes through St.Button as 'clicked'.
        tile.connect('clicked', () => this._pick(layout));
        onClick(tile, button => {
            if (button === Clutter.BUTTON_SECONDARY)
                this._onToggleFavorite(layout);
            else
                this._pick(layout);
        });
        return entry.actor;
    }

    _pick(layout) {
        if (this._done)
            return;
        this._done = true;
        this.close();
        this._onPick(layout);
    }

    _focus(index, grab = true) {
        const entry = this._tiles[index];
        if (!entry)
            return;
        this._index = index;
        if (grab)
            entry.actor.grab_key_focus();
        else
            this._showGhosts(entry.layout);
        ensureActorVisibleInScrollView(this._scroll, entry.actor);
    }

    _selectTab(index) {
        if (index === this._tab || index < 0 || index >= this._tabs.length)
            return;
        this._tab = index;
        this._render(this._currentId);
    }

    // Closest tile in the previous/next visual row, by horizontal centre.
    _moveVertical(direction) {
        const rect = actor => {
            const [x, y] = actor.get_transformed_position();
            return {cx: x + actor.width / 2, top: y};
        };
        const from = rect(this._tiles[this._index].actor);
        let best = -1;
        let bestRow = Infinity;
        let bestDx = Infinity;
        this._tiles.forEach((entry, i) => {
            const r = rect(entry.actor);
            const dy = (r.top - from.top) * direction;
            if (dy < 4)
                return;
            const dx = Math.abs(r.cx - from.cx);
            if (dy < bestRow - 4 || (Math.abs(dy - bestRow) <= 4 && dx < bestDx)) {
                best = i;
                bestRow = dy;
                bestDx = dx;
            }
        });
        if (best >= 0)
            this._focus(best);
    }

    _onKey(symbol) {
        switch (symbol) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this._selectTab((this._tab + 1) % this._tabs.length);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_ISO_Left_Tab:
            this._selectTab((this._tab - 1 + this._tabs.length) % this._tabs.length);
            return Clutter.EVENT_STOP;
        }
        if (this._tiles.length === 0)
            return Clutter.EVENT_PROPAGATE;

        switch (symbol) {
        case Clutter.KEY_Left:
            this._focus(Math.max(0, this._index - 1));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
            this._focus(Math.min(this._tiles.length - 1, this._index + 1));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._moveVertical(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveVertical(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._focus(0);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._focus(this._tiles.length - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_f:
        case Clutter.KEY_F:
            this._onToggleFavorite(this._tiles[this._index].layout);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_space:
            this._pick(this._tiles[this._index].layout);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _hideGhosts() {
        for (const ghost of this._ghosts)
            ghost.ease({opacity: 0, duration: 120});
    }

    _makeGhost() {
        const inner = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const ghost = new St.BoxLayout({style_class: 'qscreen-ghost', vertical: true, opacity: 0});
        ghost.add_child(inner);
        ghost._inner = inner;
        this._ghostLayer.add_child(ghost);
        return ghost;
    }

    _showGhosts(layout) {
        if (!this._actor)
            return;
        // Windows do not change while the picker holds the grab: plan once per layout.
        let plan = this._plans.get(layout.id);
        if (!plan) {
            plan = this._getPlan(layout);
            this._plans.set(layout.id, plan);
        }
        const {monitor, cells} = plan;
        if (Main.layoutManager.monitors[monitor] !== this._monitor)
            return;

        while (this._ghosts.length < cells.length)
            this._ghosts.push(this._makeGhost());

        const tracker = Shell.WindowTracker.get_default();
        this._ghosts.forEach((ghost, i) => {
            const cell = cells[i];
            if (!cell) {
                ghost.ease({opacity: 0, duration: 120});
                return;
            }
            const x = cell.rect.x - this._monitor.x;
            const y = cell.rect.y - this._monitor.y;
            const {width, height} = cell.rect;

            // Same window at the same width as last time: keep the icon and label.
            const unchanged = ghost._window === cell.window && ghost._width === width;
            ghost._window = cell.window;
            ghost._width = width;

            if (unchanged) {
                // nothing to rebuild
            } else if (cell.window) {
                ghost._inner.destroy_all_children();
                ghost.remove_style_class_name('qscreen-ghost-empty');
                const app = tracker.get_window_app(cell.window);
                const icon = app?.create_icon_texture(56) ??
                    new St.Icon({icon_name: 'window-symbolic', icon_size: 56});
                icon.x_align = Clutter.ActorAlign.CENTER;
                ghost._inner.add_child(icon);
                const label = new St.Label({
                    style_class: 'qscreen-ghost-label',
                    text: cell.window.get_title() ?? '',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                label.set_style(`max-width: ${Math.max(40, width - 24)}px;`);
                ghost._inner.add_child(label);
            } else {
                ghost._inner.destroy_all_children();
                ghost.add_style_class_name('qscreen-ghost-empty');
            }

            if (ghost.opacity === 0) {
                // First appearance: jump into place, then fade in.
                ghost.set_position(x, y);
                ghost.set_size(width, height);
                ghost.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            } else {
                ghost.ease({
                    x, y, width, height,
                    opacity: 255,
                    duration: 160,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        });
    }

    get isOpen() {
        return this._actor !== null && this._actor !== undefined;
    }

    close() {
        if (!this._actor)
            return;
        if (this._grabbed) {
            Main.popModal(this._grabbed);
            this._grabbed = null;
        }
        const actor = this._actor;
        actor.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._actor === actor)
                    this._destroy(actor);
            },
        });
    }

    /** Tear down at once, skipping the fade (extension being disabled). */
    destroy() {
        this._actor?.remove_all_transitions();
        this._destroy();
    }

    _destroy(actor = this._actor) {
        if (this._grabbed) {
            Main.popModal(this._grabbed);
            this._grabbed = null;
        }
        actor?.destroy();
        this._actor = null;
    }
}
