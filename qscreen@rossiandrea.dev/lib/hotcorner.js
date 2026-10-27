// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SIZE = 3;

/**
 * Invisible hot spot in a corner of the primary monitor. Fires `onTrigger`
 * once the pointer has rested in it for `delay` ms.
 */
export class HotCorner {
    constructor(corner, delay, onTrigger) {
        this._corner = corner;
        this._delay = delay;
        this._onTrigger = onTrigger;
        this._timeoutId = 0;

        this._actor = new St.Widget({reactive: true, width: SIZE, height: SIZE});
        this._actor.connect('enter-event', () => {
            this._arm();
            return Clutter.EVENT_PROPAGATE;
        });
        this._actor.connect('leave-event', () => {
            this._disarm();
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.addChrome(this._actor, {
            trackFullscreen: true,
        });

        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());
        this._reposition();
    }

    _reposition() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const right = this._corner.endsWith('right');
        const bottom = this._corner.startsWith('bottom');
        this._actor.set_position(
            right ? m.x + m.width - SIZE : m.x,
            bottom ? m.y + m.height - SIZE : m.y);
    }

    _arm() {
        this._disarm();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._delay, () => {
            this._timeoutId = 0;
            this._onTrigger();
            return GLib.SOURCE_REMOVE;
        });
    }

    _disarm() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    destroy() {
        this._disarm();
        Main.layoutManager.disconnect(this._monitorsId);
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
        this._actor = null;
    }
}
