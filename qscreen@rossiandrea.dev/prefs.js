// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
        page.add(this._customLayoutsGroup(settings));
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

    _customLayoutsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Custom layouts'),
            description: _('One layout per row. Examples: cols:1,2 · rows:2,1,3 · grid:3x2 · rects:0,0,1,2;1,0,1,1;1,1,1,1@My layout'),
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Add layout'),
        });
        group.set_header_suffix(addButton);

        let rows = [];
        const save = () => {
            const specs = rows
                .map(r => parseLayout(r.get_text())?.id)
                .filter(id => id !== undefined);
            settings.set_strv('custom-layouts', specs);
        };

        const addRow = text => {
            const row = new Adw.EntryRow({title: _('Layout spec'), text});
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            row.add_suffix(remove);
            row.connect('changed', () => {
                const ok = row.get_text() === '' || parseLayout(row.get_text()) !== null;
                if (ok)
                    row.remove_css_class('error');
                else
                    row.add_css_class('error');
            });
            row.connect('apply', save);
            row.set_show_apply_button(true);
            remove.connect('clicked', () => {
                group.remove(row);
                rows = rows.filter(r => r !== row);
                save();
            });
            rows.push(row);
            group.add(row);
        };

        settings.get_strv('custom-layouts').forEach(addRow);
        addButton.connect('clicked', () => addRow(''));
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
