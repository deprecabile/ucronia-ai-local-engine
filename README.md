# Fantapolitica Italia '20 — web app

Gioco di ruolo narrativo, strategico e gestionale di **fantapolitica storica**: il giocatore guida
un nuovo movimento politico italiano nel primo dopoguerra (febbraio 1919). Claude fa da **Game
Master** attraverso una pipeline di agenti specializzati. Versione web di un gioco prima giocato
"a mano" dentro Claude Code; le regole stabili stanno nei **prompt**, lo stato della partita nei
file **`game/*.md`**.

Il **motore è generico**: tutta l'ambientazione (mondo, epoca, attori, cos'è il potere) vive in un
unico file, **`prompt/scenario.md`**. I prompt degli agenti e la meccanica (`common.md`) sono
scenario-agnostici, così per riambientare il gioco — un altro Paese, un'altra epoca — basta
riscrivere `scenario.md` + lo stato iniziale in `game/`, senza toccare gli agenti. Lo scenario
attuale è l'Italia del primo dopoguerra.

```
React + TS (Vite)  ──WebSocket──►  Node backend (TS)  ──Agent SDK──►  claude CLI
       ▲                                    │
       └──────── streaming + progresso ─────┘
```

## Due canali

Una sola connessione WebSocket, due chat affiancate (campo `channel` del messaggio):

- **🗣️ Consulente (`advisor`)** — il **tempo è congelato**: analisi, ipotesi («cosa succederebbe
  se…»), pianificazione, chiarimenti storici. Non fa avanzare il gioco, non scrive su `game/`.
  Mantiene il contesto tra messaggi via `resume` della sessione SDK.
- **⏭️ Avanza il turno (`turn`)** — scrivi **durata + ordini** (es. *«avanziamo di 2 settimane:
  comizio a Palermo»*). Qui il tempo passa: parte la pipeline multi-agente, viene streammata la
  Gazzetta del turno e si aggiorna lo stato in `game/`.

Un lock `busy` per connessione serializza i due canali: condividono `game/`, un turno alla volta.

## La pipeline di un turno (6 agenti, modello "calderone")

Orchestrata in `backend/src/game/turn.ts`. Ogni agente-GM riceve meccanica (`common.md`) +
ambientazione (`scenario.md`) + slice di fase. Tre fonti — azioni del giocatore, mosse degli attori
simulati ed eventi storici di sfondo — confluiscono in **una timeline datata di "cose accadute"**
(il calderone), che poi un giornalista racconta:

| Fase | Agente | Prompt | Output |
|---|---|---|---|
| 1 (valuta + **colloca le mosse nel tempo**) + 2.1 (seleziona 3-5 attori) | **Arbitro** | `arbitro.md` | strutturato (JSON) |
| 2.2 (immedesimazione, in parallelo) | **Attore** ×N | `attore.md` | strutturato (JSON) |
| 2.5 (eventi di sfondo, corretti per l'Effetto Farfalla) | **Storico** | `storico.md` | strutturato (JSON) |
| 2.6 (fonde le 3 fonti in una timeline datata) | **Integratore** | `integratore.md` | strutturato (JSON) |
| 3 (Gazzetta dalla timeline) | **Giornalista** | `giornalista.md` | **streaming** |
| 4-5 (riscrive movimento/nazione/attori.md) | **Snapshotter** | `snapshot.md` | blocchi `===FILE:…===` |
| 6 (append cronologia) | — | — | **solo codice**, zero token |

Tre idee chiave: **(1)** le azioni del giocatore si **spalmano nel tempo** (l'Arbitro dà a ciascuna
una collocazione nell'arco, non tutto "il primo giorno"); **(2)** lo **Storico** gira dopo Arbitro e
Attori e corregge gli eventi storici reali — li sopprime, anticipa o ritarda — secondo cosa è
successo nella partita (**Effetto Farfalla**); **(3)** l'**Integratore** produce output strutturato,
quindi il Giornalista streamma la Gazzetta grezza (niente più blocco di servizio da nascondere).

Ogni agente-Attore (Fase 2.2) riceve **solo la propria scheda** e decide in isolamento, con il suo
**orizzonte di conoscenza** limitato; l'Integratore poi fa convergere tutto. Il backend è l'unico a
scrivere su `game/` (scrittura atomica): gli agenti restituiscono testo/dati, l'I/O lo fa il codice,
così la chat non vede mai le scritture.

**Memoria del passato:** ogni agente riceve il recap `game/_ultimo_turno.md` (rigenerato a fine
turno) e può chiamare il tool read-only `cerca_cronologia` per fatti più vecchi, senza ingoiare
l'intera `cronologia.md`.

## Struttura

- `prompt/` — i prompt del gioco: `scenario.md` (tutta l'ambientazione), `common.md` (meccanica
  condivisa, scenario-agnostica) e gli slice di fase `advisor.md`, `arbitro.md`, `attore.md`,
  `storico.md`, `integratore.md`, `giornalista.md`, `snapshot.md`.
- `game/` — lo **stato** della partita: `movimento.md`, `nazione.md`, `attori.md`, `cronologia.md`
  (cumulativo). `_ultimo_turno.md` è un recap derivato, rigenerato a ogni turno (in `.gitignore`).
- `backend/` — Node + TS. `server.ts` (HTTP + WebSocket su **8088**), `game/turn.ts` (pipeline),
  `game/agent.ts` (wrapper Agent SDK: `runAgent` strutturato + `streamAgent` streaming),
  `game/state.ts` (I/O su `game/`), `game/actors.ts` (ritaglio schede), `game/schemas.ts`,
  `game/prompts.ts`, `game/tools.ts` (tool `cerca_cronologia`), `protocol.ts` (tipi WS).
- `frontend/` — React + TS (Vite). UI a due pannelli ridimensionabili, hook `useGameChat.ts`.

## Autenticazione (importante)

**L'app non contiene nessuna configurazione di autenticazione.** Chiama solo `query()` dell'Agent
SDK, che a sua volta usa la CLI `claude` installata sulla macchina ed **eredita la sua auth**
(login standard Anthropic / abbonamento). **Zero config nell'app**: basta che `claude` funzioni dal
terminale (provala con `claude -p "ciao"`). Verificato qui con i tre sanity check sotto — query,
output strutturato e tool MCP.

## Avvio

Prima volta su una macchina nuova, installa le dipendenze:
```bash
cd backend && npm install
cd ../frontend && npm install
```

Tutto insieme (backend + frontend, log prefissati, Ctrl+C ferma entrambi — richiede bash/WSL):
```bash
./start.sh
```

Oppure separatamente — backend (porta 8088):
```bash
cd backend && PORT=8088 npm run dev      # default già 8088
```
frontend:
```bash
cd frontend && npm run dev               # http://localhost:5173
```
Poi apri http://localhost:5173.

### Lint e type-check
```bash
cd backend  && npm run lint && npm run typecheck   # ESLint 9 (flat config) + tsc --noEmit
cd frontend && npm run lint && npm run typecheck
```

### Sanity check SDK ↔ CLI claude
```bash
cd backend && npm run sanity             # vedi anche sanity-structured / sanity-tool
```

## Gestione partita

- **Reset al turno 0** (stato iniziale dello scenario): `./reset-game.sh` (o `reset-game.ps1` su
  Windows) ripristina i 4 file di `game/` estraendoli da `game_initial_status.zip` e rimuove il
  recap. Chiede conferma (`--force`/`-Force` per saltarla).
- **Esportare il progetto** su un altro PC: `./export-zip.sh` produce un `.zip` portabile
  (esclude `.git`, `node_modules`, build, segreti). Sul nuovo PC: unzip + `npm install` in
  `backend/` e `frontend/`.

## Note ambiente

- Il backend va avviato da una shell in cui la CLI `claude` è **sul PATH e già autenticata** (provala
  con `claude -p "ciao"`): l'Agent SDK la trova ed eredita la sua auth (vedi **Autenticazione**).
- Funziona sia su **Windows nativo** (Node per Windows, `claude.exe`) sia su **WSL/Linux**. Gli
  script `*.sh` (`start.sh`, `reset-game.sh`, `export-zip.sh`) richiedono però **bash** — su Windows
  usa Git Bash o WSL. In alternativa, avvia i due `npm run dev` a mano (vedi sopra).
- Se in WSL `claude` è disponibile solo dopo `source ~/.bashrc`, avvia da una shell già inizializzata
  dal profilo (`start.sh` fa il source di `~/.bashrc` se serve).
- Gli agenti possono usare **solo** il tool read-only `cerca_cronologia`: non scrivono mai sui file
  (l'I/O su `game/` è tutto nel backend).
