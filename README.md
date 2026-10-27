# QScreen

Estensione GNOME Shell (49/50, Wayland e X11) che riorganizza le finestre aperte in griglie da 2x2 fino a 4x4 e in combinazioni miste.

## Uso

- **Menu nel pannello** (icona a griglia): scegli un layout dai sottomenu *Grids*, *Rows and columns*, *Combinations*, *Custom*.
- **Overlay** (`Super+Alt+G` oppure hot corner, di default in basso a destra): selettore con anteprima dal vivo. Passando su un layout (o con le frecce) sul desktop compaiono le zone con icona e titolo della finestra che andrebbe in ciascuna. Clic o `Invio` per applicare, `Esc` per chiudere. L'hot corner si cambia o si disattiva dalle preferenze.
- **Scorciatoie** (modificabili nelle preferenze):

| Scorciatoia | Azione |
|---|---|
| `Super+Alt+2` / `3` / `4` | griglia 2x2 / 3x3 / 4x4 |
| `Super+Alt+→` / `←` | layout successivo / precedente |
| `Super+Alt+R` | riapplica l'ultimo layout |
| `Super+Alt+G` | selettore layout |

Le finestre tilate sono quelle normali dell'area di lavoro attiva, sul monitor in cui si trova il mouse. Ogni monitor ricorda il proprio ultimo layout, quindi applicarne uno (o usare `Super+Alt+→/←`, `Super+Alt+R`) non tocca gli altri monitor.
Se le finestre sono più delle celle, quelle in eccesso restano dove sono.

## Layout

Un layout è una stringa (che ne è anche l'id):

| Sintassi | Significato |
|---|---|
| `grid:CxR` | griglia uniforme, es. `grid:3x2` |
| `rows:a,b,c` | righe con a, b, c finestre, es. `rows:2,1,3` |
| `cols:a,b,c` | colonne con a, b, c finestre, es. `cols:1,3` |
| `rects:c,r,w,h;…` | rettangoli espliciti in unità di griglia |

Aggiungi `@Nome` per dare un'etichetta: `rects:0,0,1,2;1,0,1,1;1,1,1,1@Principale + 2`.
I layout personalizzati si aggiungono dalle preferenze.

## Sviluppo

```sh
make test      # test della logica dei layout + validazione schema
make pack      # dist/qscreen@rossiandrea.dev.shell-extension.zip
make install   # installa per l'utente corrente (poi riavvia la sessione su Wayland)
make nested    # prova in una shell annidata
make rpm       # RPM/SRPM in dist/rpm (per COPR)
```

Licenza: GPL-2.0-or-later.
