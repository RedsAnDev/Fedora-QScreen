// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {BUILTIN_SECTIONS, parseLayout} from './lib/layouts.js';
import {LayoutOverlay} from './lib/overlay.js';
import {HotCorner} from './lib/hotcorner.js';
import {cancelPending, plan, targetMonitor, tile} from './lib/tiler.js';

// Resolved lazily: gettext is only usable once the extension is running.
const sectionTitle = id => ({
    grids: _('Grids'),
    lines: _('Rows and columns'),
    mixed: _('Combinations'),
})[id];

const QScreenIndicator = GObject.registerClass(
class QScreenIndicator extends PanelMenu.Button {
    _init(controller) {
        super._init(0.0, 'QScreen');
        this._controller = controller;
        this.add_child(new St.Icon({
            icon_name: 'view-grid-symbolic',
            style_class: 'system-status-icon',
        }));
        this.rebuild();
    }

    rebuild() {
        this.menu.removeAll();
        const current = this._controller.currentId();

        for (const section of this._controller.sections()) {
            if (section.layouts.length === 0)
                continue;
            const sub = new PopupMenu.PopupSubMenuMenuItem(section.title);
            for (const layout of section.layouts) {
                const item = new PopupMenu.PopupMenuItem(layout.name);
                item.setOrnament(layout.id === current
                    ? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE);
                item.connect('activate', () => this._controller.apply(layout));
                sub.menu.addMenuItem(item);
            }
            this.menu.addMenuItem(sub);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Layout picker…'), () => this._controller.showOverlay());
        this.menu.addAction(_('Re-tile'), () => this._controller.retile());
        this.menu.addAction(_('Preferences'), () => this._controller.openPreferences());
    }
});

export default class QScreenExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = null;
        this._signals = [];
        this._shortcuts = [];

        this._indicator = new QScreenIndicator(this._controller());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._syncIndicatorVisibility();

        this._connect('show-panel-icon', () => this._syncIndicatorVisibility());
        this._connect('custom-layouts', () => this._indicator.rebuild());

        this._syncHotCorner();
        this._connect('hot-corner', () => this._syncHotCorner());
        this._connect('hot-corner-delay', () => this._syncHotCorner());

        this._addShortcut('grid-2x2', () => this._applySpec('grid:2x2'));
        this._addShortcut('grid-3x3', () => this._applySpec('grid:3x3'));
        this._addShortcut('grid-4x4', () => this._applySpec('grid:4x4'));
        this._addShortcut('next-layout', () => this._cycle(1));
        this._addShortcut('prev-layout', () => this._cycle(-1));
        this._addShortcut('retile', () => this._retile());
        // POPUP too, so the same shortcut can close the overlay (which holds a modal grab).
        this._addShortcut('show-overlay', () => this._showOverlay(),
            Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP);
    }

    disable() {
        for (const name of this._shortcuts)
            Main.wm.removeKeybinding(name);
        for (const id of this._signals)
            this._settings.disconnect(id);
        cancelPending();
        this._hotCorner?.destroy();
        this._hotCorner = null;
        this._overlay?.close();
        this._indicator?.destroy();

        this._shortcuts = null;
        this._signals = null;
        this._overlay = null;
        this._indicator = null;
        this._settings = null;
    }

    // Object handed to the indicator so it does not reach into the extension.
    _controller() {
        return {
            sections: () => this._sections(),
            apply: layout => this._apply(layout),
            showOverlay: () => this._showOverlay(),
            retile: () => this._retile(),
            openPreferences: () => this.openPreferences(),
            currentId: () => this._lastLayoutId(),
        };
    }

    _connect(key, callback) {
        this._signals.push(this._settings.connect(`changed::${key}`, callback));
    }

    _addShortcut(name, handler, modes = Shell.ActionMode.NORMAL) {
        Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.NONE,
            modes, handler);
        this._shortcuts.push(name);
    }

    _syncIndicatorVisibility() {
        this._indicator.visible = this._settings.get_boolean('show-panel-icon');
    }

    _customLayouts() {
        return this._settings.get_strv('custom-layouts')
            .map(parseLayout)
            .filter(l => l !== null);
    }

    _sections() {
        const sections = BUILTIN_SECTIONS.map(s => ({
            id: s.id,
            title: sectionTitle(s.id) ?? s.title,
            layouts: s.specs.map(parseLayout).filter(l => l !== null),
        }));
        sections.push({id: 'custom', title: _('Custom'), layouts: this._customLayouts()});
        return sections;
    }

    _favoriteIds() {
        return this._settings.get_strv('favorite-layouts');
    }

    _toggleFavorite(layout) {
        const ids = this._favoriteIds();
        const next = ids.includes(layout.id)
            ? ids.filter(id => id !== layout.id)
            : [...ids, layout.id];
        this._settings.set_strv('favorite-layouts', next);
        this._overlay?.refresh();
    }

    _tabs() {
        const all = this._allLayouts();
        const favorites = this._favoriteIds()
            .map(id => all.find(l => l.id === id))
            .filter(l => l !== undefined);
        return [
            {
                id: 'standard',
                title: _('Standard'),
                empty: '',
                sections: this._sections().filter(s => s.id !== 'custom'),
            },
            {
                id: 'custom',
                title: _('Custom'),
                empty: _('Nothing here yet. Add layouts in Preferences, or press F on any layout to favourite it.'),
                sections: [
                    {title: _('Favourites'), layouts: favorites},
                    {title: _('My layouts'), layouts: this._customLayouts()},
                ],
            },
        ];
    }

    _allLayouts() {
        return this._sections().flatMap(s => s.layouts);
    }

    // Each monitor remembers its own layout; the pointer decides which one acts.
    _lastLayoutId(monitor = targetMonitor()) {
        const map = this._settings.get_value('monitor-layouts').recursiveUnpack();
        return map[monitor] ?? '';
    }

    _setLastLayoutId(monitor, id) {
        const map = this._settings.get_value('monitor-layouts').recursiveUnpack();
        map[monitor] = id;
        this._settings.set_value('monitor-layouts', new GLib.Variant('a{ss}', map));
    }

    _tileOptions() {
        return {
            gap: this._settings.get_int('gap'),
            outerGap: this._settings.get_int('outer-gap'),
            assignment: this._settings.get_string('assignment'),
            includeMinimized: this._settings.get_boolean('include-minimized'),
        };
    }

    _syncHotCorner() {
        this._hotCorner?.destroy();
        this._hotCorner = null;
        const corner = this._settings.get_string('hot-corner');
        if (corner === 'off')
            return;
        this._hotCorner = new HotCorner(
            corner, this._settings.get_int('hot-corner-delay'), () => this._showOverlay());
    }

    _apply(layout) {
        const monitor = targetMonitor();
        const placed = tile(layout, {...this._tileOptions(), monitor});
        this._setLastLayoutId(monitor, layout.id);
        this._indicator.rebuild();

        const cells = layout.cells.length;
        const note = placed < cells ? ` (${placed}/${cells})` : '';
        Main.osdWindowManager.show(-1, null, `${layout.name}${note}`, null);
    }

    _applySpec(spec) {
        const layout = parseLayout(spec);
        if (layout)
            this._apply(layout);
    }

    _retile() {
        const layout = parseLayout(this._lastLayoutId());
        if (layout)
            this._apply(layout);
        else
            this._applySpec('grid:2x2');
    }

    _cycle(step) {
        const all = this._allLayouts();
        if (all.length === 0)
            return;
        const index = all.findIndex(l => l.id === this._lastLayoutId());
        const next = index < 0
            ? (step > 0 ? 0 : all.length - 1)
            : (index + step + all.length) % all.length;
        this._apply(all[next]);
    }

    _showOverlay() {
        if (this._overlay?.isOpen) {
            this._overlay.close();
            return;
        }
        this._overlay = new LayoutOverlay({
            getTabs: () => this._tabs(),
            currentId: this._lastLayoutId(),
            onPick: layout => this._apply(layout),
            isFavorite: layout => this._favoriteIds().includes(layout.id),
            onToggleFavorite: layout => this._toggleFavorite(layout),
            getPlan: layout => plan(layout, this._tileOptions()),
        });
    }
}
