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
Applicando un layout le finestre minimizzate (se abilitato), a schermo intero o massimizzate vengono ripristinate per entrare nella loro zona.

## Finestre collegate

Dopo aver applicato un layout, le finestre che ha sistemato restano collegate tra loro (si disattiva dalle preferenze con *Keep tiled windows linked*):

- **Chiusura.** Quando una finestra si chiude, esce dalla zona o cambia area di lavoro o monitor, lo spazio libero si gestisce secondo *When a tiled window closes*: i vicini si espandono (predefinito), le restanti si riorganizzano in un layout bilanciato, oppure lo spazio resta vuoto.
- **Ridimensionamento.** Trascinando il bordo tra due finestre si ridimensionano anche le vicine: il divisore si sposta per intero. Nessuna finestra scende sotto una dimensione minima.
- **Trascinamento.** Rilasciando una finestra su un'altra zona le due si scambiano; rilasciandola dentro la propria torna a posto; rilasciandola fuori da ogni zona esce dal gruppo.

Il collegamento vale finché non si applica un altro layout sullo stesso monitor e area di lavoro. Le finestre minimizzate restano nella loro zona. Le finestre aperte dopo il layout non entrano nel gruppo.

## Layout

Un layout è una stringa (che ne è anche l'id):

| Sintassi | Significato |
|---|---|
| `grid:CxR` | griglia uniforme, es. `grid:3x2` |
| `rows:a,b,c` | righe con a, b, c finestre, es. `rows:2,1,3` |
| `cols:a,b,c` | colonne con a, b, c finestre, es. `cols:1,3` |
| `rects:c,r,w,h;…` | rettangoli espliciti in unità di griglia |

In `rects:` un primo elemento `CxR;` fissa la dimensione della griglia anche se le zone non la riempiono, es. `rects:12x6;0,0,9,2`.
Aggiungi `@Nome` per dare un'etichetta: `rects:0,0,1,2;1,0,1,1;1,1,1,1@Principale + 2`.
I layout personalizzati si disegnano dalle preferenze: si sceglie il numero di colonne e righe, poi si trascina sulla griglia per creare una zona (un clic su una zona la rimuove). La stringa corrispondente è visibile e modificabile in *Text format*. Le zone vengono riempite dalle finestre nell'ordine numerato.

## Sviluppo

```sh
make test      # test della logica dei layout, della geometria + validazione schema
make test-shell  # test della sessione con finestre finte (richiede gjs e la typelib di Mutter)
make pack      # dist/qscreen@rossiandrea.dev.shell-extension.zip
make install   # installa per l'utente corrente (poi riavvia la sessione su Wayland)
make nested    # prova in una shell annidata
make rpm       # RPM/SRPM in dist/rpm (per COPR)
```

Licenza: GPL-2.0-or-later.
