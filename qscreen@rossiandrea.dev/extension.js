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
import {SessionManager} from './lib/session.js';
import {cancelPending, monitorKey, plan, targetMonitor, tile} from './lib/tiler.js';

// A bad spec in dconf must never break the menu: treat it as invalid.
function safeParse(spec) {
    try {
        return parseLayout(spec);
    } catch (e) {
        console.warn(`[qscreen] ignoring layout "${spec}": ${e.message}`);
        return null;
    }
}

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
        this._items = new Map();
        this.add_child(new St.Icon({
            icon_name: 'view-grid-symbolic',
            style_class: 'system-status-icon',
        }));
        this.rebuild();
        // The pointer may have moved to another monitor since the last apply.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this.setCurrent(this._controller.currentId());
        });
    }

    // Move the dot to the active layout without rebuilding the menu.
    setCurrent(id) {
        for (const [layoutId, item] of this._items) {
            item.setOrnament(layoutId === id
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);
        }
    }

    rebuild() {
        this.menu.removeAll();
        this._items.clear();
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
                this._items.set(layout.id, item);
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
        this._builtin = null;
        this._custom = null;
        this._monitorLayouts = null;

        this._sessions = new SessionManager(() => this._sessionOptions());
        this._monitorsChanged = Main.layoutManager.connect('monitors-changed',
            () => this._sessions.clear());

        this._indicator = new QScreenIndicator(this._controller());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._syncIndicatorVisibility();

        this._connect('show-panel-icon', () => this._syncIndicatorVisibility());
        this._connect('custom-layouts', () => {
            this._custom = null;
            this._indicator.rebuild();
        });
        this._connect('monitor-layouts', () => {
            this._monitorLayouts = null;
        });
        this._connect('linked-windows', () => {
            if (!this._settings.get_boolean('linked-windows'))
                this._sessions.clear();
        });

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
        Main.layoutManager.disconnect(this._monitorsChanged);
        this._sessions.destroy();
        cancelPending();
        this._hotCorner?.destroy();
        this._hotCorner = null;
        this._overlay?.destroy();
        this._indicator?.destroy();

        this._shortcuts = null;
        this._signals = null;
        this._overlay = null;
        this._indicator = null;
        this._sessions = null;
        this._settings = null;
        this._builtin = null;
        this._custom = null;
        this._monitorLayouts = null;
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

    // Parsed once; rebuilt only when the custom-layouts setting changes.
    _customLayouts() {
        this._custom ??= this._settings.get_strv('custom-layouts')
            .map(safeParse)
            .filter(l => l !== null);
        return this._custom;
    }

    _builtinLayouts() {
        this._builtin ??= BUILTIN_SECTIONS.map(s =>
            s.specs.map(safeParse).filter(l => l !== null));
        return this._builtin;
    }

    _sections() {
        const builtin = this._builtinLayouts();
        const sections = BUILTIN_SECTIONS.map((s, i) => ({
            id: s.id,
            title: sectionTitle(s.id) ?? s.title,
            layouts: builtin[i],
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
    // Keyed by connector so it survives hotplug; older entries used the index.
    _monitorMap() {
        this._monitorLayouts ??= this._settings.get_value('monitor-layouts').recursiveUnpack();
        return this._monitorLayouts;
    }

    _lastLayoutId(monitor = targetMonitor()) {
        const map = this._monitorMap();
        return map[monitorKey(monitor)] ?? map[String(monitor)] ?? '';
    }

    _setLastLayoutId(monitor, id) {
        const map = {...this._monitorMap()};
        delete map[String(monitor)];
        map[monitorKey(monitor)] = id;
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

    _sessionOptions() {
        return {
            gap: this._settings.get_int('gap'),
            outerGap: this._settings.get_int('outer-gap'),
            linked: this._settings.get_boolean('linked-windows'),
            onClose: this._settings.get_string('on-close'),
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
        const {count: placed, zones} = tile(layout, {...this._tileOptions(), monitor});
        this._sessions.start(global.workspace_manager.get_active_workspace(), monitor, layout, zones);
        this._setLastLayoutId(monitor, layout.id);
        this._indicator.setCurrent(layout.id);

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
