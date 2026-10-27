# TODO — QScreen

## Prima verifica (non ancora fatta)
- [ ] Logout/login (Wayland non vede estensioni nuove senza riavvio sessione)
- [ ] `gnome-extensions enable qscreen@rossiandrea.dev`
- [ ] Aprire 4 finestre e provare `Super+Alt+2`, menu nel pannello, overlay (`Super+Alt+G`)
- [ ] Provare 3x3, 4x4, 3x1, cols:1,2, layout personalizzati dalle preferenze
- [ ] Provare con finestre massimizzate/fullscreen/minimizzate e con più monitor
- [ ] Log in caso di problemi: `journalctl -f -o cat /usr/bin/gnome-shell`
- [ ] Chiarire "2x2+1x2+3x1": al momento approssimato con `rows:2,2,1,3`

- [ ] Provare l'overlay con anteprima (hover, frecce, Invio) e l'hot corner in basso a destra (ritardo 300 ms)

## Correzioni prima della pubblicazione su extensions.gnome.org
- [x] `lib/tiler.js`: `GLib.idle_add` non viene rimosso in `disable()` → tenere traccia delle sorgenti e rimuoverle
- [ ] Aggiungere `"url"` in `metadata.json` (repository pubblico)
- [ ] Aggiungere `url` e eventuale `Source` corretto nello spec RPM
- [ ] Traduzione italiana (`po/it.po`) — la UI è solo in inglese
- [ ] Controllare che lo zip non contenga file inutili (`unzip -l dist/*.zip`)

## Pubblicazione
- [ ] Creare repository pubblico (GitHub/GitLab) e fare il push
- [ ] `make pack` → caricare `dist/qscreen@rossiandrea.dev.shell-extension.zip` su https://extensions.gnome.org/upload/
- [ ] Attendere la review (giorni/settimane); correggere, aumentare `version-name`, ricaricare
- [ ] Linee guida: https://gjs.guide/extensions/review-guidelines/review-guidelines.html

## Alternativa: COPR Fedora
- [ ] Provare `make rpm` (lo spec non è mai stato eseguito con rpmbuild)
- [ ] Creare progetto COPR e caricare l'SRPM da `dist/rpm`
- [ ] Utenti: `dnf copr enable <utente>/qscreen` + `dnf install gnome-shell-extension-qscreen`

## Idee future
- [ ] Gestione finestre in eccesso (minimizza / cella condivisa)
- [ ] Drag & drop su zone (snap)
- [x] Layout per monitor (monitor sotto il mouse)
- [ ] Layout diversi per workspace
- [ ] Chiave del layout per monitor: ora è l'indice, non il connettore (può cambiare con hotplug)
