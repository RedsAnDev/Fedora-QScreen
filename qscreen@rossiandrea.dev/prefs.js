// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _, ngettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {editLayout, layoutPreview} from './lib/layoutEditor.js';
import {parseLayout} from './lib/layouts.js';

const SHORTCUTS = [
    ['grid-2x2', 'Grid 2×2'],
    ['grid-3x3', 'Grid 3×3'],
    ['grid-4x4', 'Grid 4×4'],
    ['next-layout', 'Next layout'],
    ['prev-layout', 'Previous layout'],
    ['retile', 'Re-apply current layout'],
    ['show-overlay', 'Layout picker'],
];

export default class QScreenPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(620, 760);

        const page = new Adw.PreferencesPage({
            title: _('QScreen'),
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        page.add(this._spacingGroup(settings));
        page.add(this._behaviourGroup(settings));
        page.add(this._customLayoutsGroup(settings, window));
        page.add(this._shortcutsGroup(settings));
    }

    _spacingGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Spacing')});
        for (const [key, title] of [
            ['gap', _('Gap between windows')],
            ['outer-gap', _('Gap to screen edges')],
        ]) {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1}),
            });
            settings.bind(key, row, 'value', 0);
            group.add(row);
        }
        return group;
    }

    _behaviourGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Behaviour')});

        const modes = ['position', 'recent'];
        const combo = new Adw.ComboRow({
            title: _('Assign windows to cells by'),
            subtitle: _('Position keeps windows near where they are; recent uses most recently used first.'),
            model: Gtk.StringList.new([_('Current position'), _('Recent use')]),
            selected: Math.max(0, modes.indexOf(settings.get_string('assignment'))),
        });
        combo.connect('notify::selected', () =>
            settings.set_string('assignment', modes[combo.selected]));
        group.add(combo);

        const linked = new Adw.SwitchRow({
            title: _('Keep tiled windows linked'),
            subtitle: _('Dragging the edge between two windows resizes both; dropping a window on another swaps them.'),
        });
        settings.bind('linked-windows', linked, 'active', 0);
        group.add(linked);

        const closeModes = ['expand', 'retile', 'keep'];
        const onClose = new Adw.ComboRow({
            title: _('When a tiled window closes'),
            subtitle: _('Neighbours grow over the space, the rest are re-tiled, or the space stays empty.'),
            model: Gtk.StringList.new([
                _('Neighbours expand'), _('Re-tile the remaining'), _('Leave empty'),
            ]),
            selected: Math.max(0, closeModes.indexOf(settings.get_string('on-close'))),
        });
        onClose.connect('notify::selected', () =>
            settings.set_string('on-close', closeModes[onClose.selected]));
        linked.bind_property('active', onClose, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        group.add(onClose);

        const minimized = new Adw.SwitchRow({title: _('Also tile minimized windows')});
        settings.bind('include-minimized', minimized, 'active', 0);
        group.add(minimized);

        const corners = ['off', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
        const corner = new Adw.ComboRow({
            title: _('Hot corner'),
            subtitle: _('Move the pointer into the corner to open the layout picker.'),
            model: Gtk.StringList.new([
                _('Disabled'), _('Top left'), _('Top right'), _('Bottom left'), _('Bottom right'),
            ]),
            selected: Math.max(0, corners.indexOf(settings.get_string('hot-corner'))),
        });
        corner.connect('notify::selected', () =>
            settings.set_string('hot-corner', corners[corner.selected]));
        group.add(corner);

        const delay = new Adw.SpinRow({
            title: _('Hot corner delay (ms)'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 2000, step_increment: 50}),
        });
        settings.bind('hot-corner-delay', delay, 'value', 0);
        group.add(delay);

        const icon = new Adw.SwitchRow({title: _('Show icon in the top bar')});
        settings.bind('show-panel-icon', icon, 'active', 0);
        group.add(icon);

        return group;
    }

    _customLayoutsGroup(settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Custom layouts'),
            description: _('Draw your own zone layouts. They show up in the panel menu and in the picker.'),
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Add layout'),
        });
        group.set_header_suffix(addButton);

        // Editing changes a layout's id (its spec): keep what refers to it.
        const rename = (oldId, newId) => {
            const favorites = settings.get_strv('favorite-layouts')
                .map(id => (id === oldId ? newId : id))
                .filter(id => id !== null);
            settings.set_strv('favorite-layouts', favorites);

            const perMonitor = Object.assign(Object.create(null),
                settings.get_value('monitor-layouts').recursiveUnpack());
            for (const [monitor, id] of Object.entries(perMonitor)) {
                if (id !== oldId)
                    continue;
                if (newId === null)
                    delete perMonitor[monitor];
                else
                    perMonitor[monitor] = newId;
            }
            settings.set_value('monitor-layouts', new GLib.Variant('a{ss}', perMonitor));
        };

        const store = specs => settings.set_strv('custom-layouts', [...new Set(specs)]);

        let rows = [];
        const rebuild = () => {
            rows.forEach(r => group.remove(r));
            rows = [];

            settings.get_strv('custom-layouts').forEach((spec, index) => {
                const layout = parseLayout(spec);
                const row = new Adw.ActionRow({
                    title: GLib.markup_escape_text(layout ? layout.name : spec, -1),
                    subtitle: layout
                        ? ngettext('%d zone', '%d zones', layout.cells.length).format(layout.cells.length)
                        : _('Invalid layout'),
                });
                if (layout)
                    row.add_prefix(layoutPreview(layout));

                if (layout) {
                    const edit = new Gtk.Button({
                        icon_name: 'document-edit-symbolic',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['flat'],
                        tooltip_text: _('Edit layout'),
                    });
                    edit.connect('clicked', () => editLayout(window, spec, newSpec => {
                        const specs = settings.get_strv('custom-layouts');
                        specs[index] = newSpec;
                        store(specs);
                        if (newSpec !== spec)
                            rename(spec, newSpec);
                    }));
                    row.add_suffix(edit);
                }

                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    tooltip_text: _('Remove layout'),
                });
                remove.connect('clicked', () => {
                    store(settings.get_strv('custom-layouts').filter((_s, i) => i !== index));
                    rename(spec, null);
                });
                row.add_suffix(remove);

                rows.push(row);
                group.add(row);
            });
        };

        addButton.connect('clicked', () => editLayout(window, null, newSpec =>
            store([...settings.get_strv('custom-layouts'), newSpec])));

        const changed = settings.connect('changed::custom-layouts', rebuild);
        window.connect('close-request', () => settings.disconnect(changed));
        rebuild();
        return group;
    }

    _shortcutsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Keyboard shortcuts'),
            description: _('Accelerator syntax, e.g. <Super><Alt>2. Leave empty to disable.'),
        });
        for (const [key, title] of SHORTCUTS) {
            const row = new Adw.EntryRow({
                title: _(title),
                text: settings.get_strv(key)[0] ?? '',
                show_apply_button: true,
            });
            row.connect('changed', () => {
                const text = row.get_text().trim();
                const [valid] = Gtk.accelerator_parse(text);
                if (text === '' || valid)
                    row.remove_css_class('error');
                else
                    row.add_css_class('error');
            });
            row.connect('apply', () => {
                const text = row.get_text().trim();
                if (text === '')
                    settings.set_strv(key, []);
                else if (Gtk.accelerator_parse(text)[0])
                    settings.set_strv(key, [text]);
            });
            group.add(row);
        }
        return group;
    }
}
