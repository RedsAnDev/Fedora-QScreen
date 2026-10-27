// SPDX-License-Identifier: GPL-2.0-or-later
//
// Visual editor for custom layouts. Preferences only: it imports Gtk/Adw and
// must never be loaded from the shell process.

import Adw from 'gi://Adw';
import Cairo from 'cairo';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {formatRects, labelOf, overlaps, parseLayout} from './layouts.js';

const MAX_UNITS = 24;
const INSET = 2;

/**
 * Draw zones filling the widget. With `numbers` it also draws the grid lines
 * and the order in which windows fill the zones.
 */
export function paintZones(widget, cr, width, height, {cols, rows, cells}, {numbers = false, ghost = null} = {}) {
    const accent = Adw.StyleManager.get_default().get_accent_color_rgba();
    const fg = widget.get_color();
    const unitW = width / cols;
    const unitH = height / rows;

    if (numbers) {
        cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.15);
        cr.setLineWidth(1);
        for (let c = 0; c <= cols; c++) {
            cr.moveTo(Math.round(c * unitW) + 0.5, 0);
            cr.lineTo(Math.round(c * unitW) + 0.5, height);
        }
        for (let r = 0; r <= rows; r++) {
            cr.moveTo(0, Math.round(r * unitH) + 0.5);
            cr.lineTo(width, Math.round(r * unitH) + 0.5);
        }
        cr.stroke();
    }

    const box = cell => [
        cell.col * unitW + INSET, cell.row * unitH + INSET,
        cell.w * unitW - 2 * INSET, cell.h * unitH - 2 * INSET,
    ];

    cells.forEach((cell, i) => {
        const [x, y, w, h] = box(cell);
        cr.rectangle(x, y, w, h);
        cr.setSourceRGBA(accent.red, accent.green, accent.blue, 0.3);
        cr.fillPreserve();
        cr.setSourceRGBA(accent.red, accent.green, accent.blue, 0.9);
        cr.setLineWidth(numbers ? 2 : 1);
        cr.stroke();

        if (numbers) {
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.9);
            cr.selectFontFace('sans-serif', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
            cr.setFontSize(Math.min(20, h * 0.6));
            const ext = cr.textExtents(`${i + 1}`);
            cr.moveTo(x + (w - ext.width) / 2 - ext.xBearing, y + (h - ext.height) / 2 - ext.yBearing);
            cr.showText(`${i + 1}`);
        }
    });

    if (ghost) {
        const [x, y, w, h] = box(ghost);
        cr.rectangle(x, y, w, h);
        cr.setSourceRGBA(accent.red, accent.green, accent.blue, 0.2);
        cr.fillPreserve();
        cr.setDash([4, 3], 0);
        cr.setLineWidth(2);
        cr.setSourceRGBA(accent.red, accent.green, accent.blue, 0.9);
        cr.stroke();
        cr.setDash([], 0);
    }
}

/**
 * Small non-interactive preview of a parsed layout.
 */
export function layoutPreview(layout) {
    const area = new Gtk.DrawingArea({
        content_width: 56,
        content_height: 36,
        valign: Gtk.Align.CENTER,
        css_classes: ['card'],
    });
    area.set_draw_func((_area, cr, w, h) => {
        paintZones(area, cr, w, h, layout);
        cr.$dispose();
    });
    return area;
}

const ZoneEditor = GObject.registerClass({
    Signals: {'changed': {}},
}, class ZoneEditor extends Gtk.DrawingArea {
    constructor() {
        super({
            content_width: 440,
            content_height: 250,
            hexpand: true,
            css_classes: ['card'],
        });
        this.cols = 2;
        this.rows = 2;
        this.cells = [];
        this._drag = null;

        this.set_draw_func((_area, cr, w, h) => {
            paintZones(this, cr, w, h, this, {
                numbers: true,
                ghost: this._drag ? this._merged(this._dragCell()).cell : null,
            });
            cr.$dispose();
        });

        const gesture = new Gtk.GestureDrag();
        gesture.connect('drag-begin', (_g, x, y) => {
            this._drag = {x, y, from: this._cellAt(x, y), to: this._cellAt(x, y)};
            this.queue_draw();
        });
        gesture.connect('drag-update', (_g, dx, dy) => {
            this._drag.to = this._cellAt(this._drag.x + dx, this._drag.y + dy);
            this.queue_draw();
        });
        gesture.connect('drag-end', (_g, dx, dy) => {
            this._drag.to = this._cellAt(this._drag.x + dx, this._drag.y + dy);
            this._finishDrag();
        });
        this.add_controller(gesture);
    }

    _cellAt(x, y) {
        const clamp = (v, max) => Math.min(max - 1, Math.max(0, v));
        return {
            col: clamp(Math.floor(x / (this.get_width() / this.cols)), this.cols),
            row: clamp(Math.floor(y / (this.get_height() / this.rows)), this.rows),
        };
    }

    _dragCell() {
        const {from, to} = this._drag;
        return {
            col: Math.min(from.col, to.col),
            row: Math.min(from.row, to.row),
            w: Math.abs(from.col - to.col) + 1,
            h: Math.abs(from.row - to.row) + 1,
        };
    }

    /**
     * What dragging over `cell` produces: the cell grown to swallow every zone
     * it touches (so no zone is left half covered) and the zones it replaces.
     */
    _merged(cell) {
        let merged = cell;
        let absorbed = [];
        for (;;) {
            const hit = this.cells.filter(c => overlaps(c, merged));
            if (hit.length === absorbed.length)
                return {cell: merged, absorbed};
            absorbed = hit;
            const col = Math.min(merged.col, ...hit.map(c => c.col));
            const row = Math.min(merged.row, ...hit.map(c => c.row));
            merged = {
                col,
                row,
                w: Math.max(merged.col + merged.w, ...hit.map(c => c.col + c.w)) - col,
                h: Math.max(merged.row + merged.h, ...hit.map(c => c.row + c.h)) - row,
            };
        }
    }

    _finishDrag() {
        const drawn = this._dragCell();
        this._drag = null;

        if (drawn.w === 1 && drawn.h === 1 && this.cells.some(c => overlaps(c, drawn))) {
            // A click on a zone removes it.
            this.cells = this.cells.filter(c => !overlaps(c, drawn));
        } else {
            // Drawing over existing zones merges them into one.
            const {cell, absorbed} = this._merged(drawn);
            if (absorbed.length === 1 && absorbed[0].col === cell.col && absorbed[0].row === cell.row &&
                absorbed[0].w === cell.w && absorbed[0].h === cell.h) {
                this.queue_draw();
                return;
            }
            this.cells = this.cells.filter(c => !absorbed.includes(c));
            this.cells.push(cell);
        }
        this._sort();
        this.emit('changed');
        this.queue_draw();
    }

    _sort() {
        this.cells.sort((a, b) => a.row - b.row || a.col - b.col);
    }

    /** Replace the whole content without emitting 'changed'. */
    setCells(cols, rows, cells) {
        this.cols = cols;
        this.rows = rows;
        this.cells = cells.map(c => ({...c}));
        this._sort();
        this.queue_draw();
    }

    /** Resize the grid, dropping the zones that no longer fit. */
    setDimensions(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = this.cells.filter(c => c.col + c.w <= cols && c.row + c.h <= rows);
        this.emit('changed');
        this.queue_draw();
    }

    fill() {
        this.cells = [];
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++)
                this.cells.push({col, row, w: 1, h: 1});
        }
        this.emit('changed');
        this.queue_draw();
    }

    clear() {
        this.cells = [];
        this.emit('changed');
        this.queue_draw();
    }
});

/**
 * Dialog to draw a layout. `spec` is the layout to edit (null for a new one);
 * `onSave` receives the resulting spec string.
 */
export function editLayout(parent, spec, onSave) {
    const dialog = new Adw.Dialog({
        title: spec ? _('Edit layout') : _('New layout'),
        content_width: 520,
    });

    const cancel = new Gtk.Button({label: _('Cancel')});
    cancel.connect('clicked', () => dialog.close());
    const save = new Gtk.Button({label: _('Save'), css_classes: ['suggested-action']});

    const header = new Adw.HeaderBar({
        show_start_title_buttons: false,
        show_end_title_buttons: false,
    });
    header.pack_start(cancel);
    header.pack_end(save);

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 12,
        margin_bottom: 18,
        margin_start: 18,
        margin_end: 18,
    });

    const nameRow = new Adw.EntryRow({title: _('Name (optional)')});
    const cols = new Adw.SpinRow({
        title: _('Columns'),
        adjustment: new Gtk.Adjustment({lower: 1, upper: MAX_UNITS, step_increment: 1, value: 2}),
    });
    const rows = new Adw.SpinRow({
        title: _('Rows'),
        adjustment: new Gtk.Adjustment({lower: 1, upper: MAX_UNITS, step_increment: 1, value: 2}),
    });
    const details = new Adw.PreferencesGroup();
    for (const row of [nameRow, cols, rows])
        details.add(row);
    box.append(details);

    const editor = new ZoneEditor();
    box.append(editor);

    const hint = new Gtk.Label({
        label: _('Drag on the grid to draw a zone. Drag over existing zones to merge them, click a zone to remove it. Windows fill the zones in the numbered order.'),
        wrap: true,
        xalign: 0,
        css_classes: ['dim-label', 'caption'],
    });
    box.append(hint);

    const actions = new Gtk.Box({spacing: 6, halign: Gtk.Align.END});
    const fill = new Gtk.Button({label: _('Fill grid')});
    const clear = new Gtk.Button({label: _('Clear')});
    fill.connect('clicked', () => editor.fill());
    clear.connect('clicked', () => editor.clear());
    actions.append(fill);
    actions.append(clear);
    box.append(actions);

    const advanced = new Adw.ExpanderRow({
        title: _('Text format'),
        subtitle: _('For advanced use: the same layout as a spec string'),
    });
    const specRow = new Adw.EntryRow({title: _('Layout spec')});
    advanced.add_row(specRow);
    const advancedGroup = new Adw.PreferencesGroup();
    advancedGroup.add(advanced);
    box.append(advancedGroup);

    // `loading` silences the widgets while they are being set from code;
    // `typing` keeps refresh() from rewriting the spec entry being edited, and
    // `writing` keeps that entry's own handler from reacting to refresh().
    let loading = false;
    let typing = false;
    let writing = false;

    const refresh = () => {
        if (!typing) {
            writing = true;
            specRow.set_text(editor.cells.length > 0
                ? formatRects(editor.cells, nameRow.get_text())
                : '');
            writing = false;
        }
        save.sensitive = editor.cells.length > 0;
    };

    const load = (layout, label) => {
        loading = true;
        cols.value = layout.cols;
        rows.value = layout.rows;
        editor.setCells(layout.cols, layout.rows, layout.cells);
        nameRow.set_text(label);
        loading = false;
        refresh();
    };

    const initial = spec ? parseLayout(spec) : null;
    if (initial) {
        load(initial, labelOf(spec));
    } else {
        editor.setCells(2, 2, []);
        editor.fill();
    }
    refresh();

    editor.connect('changed', refresh);
    nameRow.connect('changed', () => {
        if (!loading)
            refresh();
    });
    const resize = () => {
        if (!loading)
            editor.setDimensions(Math.round(cols.value), Math.round(rows.value));
    };
    cols.connect('notify::value', resize);
    rows.connect('notify::value', resize);

    specRow.connect('changed', () => {
        if (loading || writing)
            return;
        const text = specRow.get_text();
        const layout = parseLayout(text);
        if (!layout) {
            if (text === '')
                specRow.remove_css_class('error');
            else
                specRow.add_css_class('error');
            return;
        }
        specRow.remove_css_class('error');
        typing = true;
        load(layout, labelOf(text));
        typing = false;
    });

    save.connect('clicked', () => {
        onSave(formatRects(editor.cells, nameRow.get_text()));
        dialog.close();
    });

    const scrolled = new Gtk.ScrolledWindow({
        child: box,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        propagate_natural_height: true,
    });
    const toolbar = new Adw.ToolbarView({content: scrolled});
    toolbar.add_top_bar(header);
    dialog.set_child(toolbar);
    dialog.set_default_widget(save);
    dialog.present(parent);
}
