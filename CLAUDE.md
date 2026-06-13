# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cos'è

Web app per un gioco di ruolo di **fantapolitica storica**. Claude fa da **Game Master** tramite una pipeline di agenti specializzati, invocati dal backend col **Claude Agent SDK**. Le **regole stabili** del gioco vivono nei prompt in `prompt/*.md`; lo **stato della partita** vive nei file `game/*.md`. Tutto il testo di gioco (prompt, stato, UI, risposte) è in **italiano**.

**Motore generico + scenario separato.** L'**ambientazione** (mondo, epoca, cosa è il potere, come circola l'informazione, attori preesistenti) vive **tutta** in `prompt/scenario.md`. I prompt degli agenti e la meccanica (`common.md`) sono **scenario-agnostici**: per riambientare il gioco (altro Paese, altra epoca) si riscrive **solo** `scenario.md` + lo stato iniziale in `game/`, senza toccare gli agenti. Lo scenario attuale è l'**Italia del primo dopoguerra (dal 1919)**.

## Comandi

```bash
# Setup (prima volta su una macchina)
cd backend && npm install
cd ../frontend && npm install

# Avvio backend + frontend insieme (log prefissati, Ctrl+C ferma entrambi — richiede bash/WSL/Git Bash)
./start.sh

# Oppure separati:
cd backend && npm run dev        # WebSocket + HTTP su porta 8088 (PORT per cambiarla)
cd frontend && npm run dev       # http://localhost:5173

# Build frontend
cd frontend && npm run build     # tsc && vite build

# Lint + type-check (entrambi i package: ESLint 9 flat config + tsc --noEmit)
cd backend  && npm run lint && npm run typecheck
cd frontend && npm run lint && npm run typecheck

# Sanity check dell'integrazione SDK ↔ CLI claude (no test framework)
cd backend && npm run sanity            # query base
cd backend && npm run sanity:structured # output strutturato (outputFormat json_schema)
cd backend && npm run sanity:tool       # tool MCP cerca_cronologia
```

Non esiste una suite di test: la verifica funzionale è fatta tramite i tre `sanity*.ts` e
l'esecuzione reale. **Controllo dei tipi rigoroso** in entrambi i package:
- `tsc --noEmit` con `strict` **+** `noUncheckedIndexedAccess`, `noImplicitReturns`,
  `noImplicitOverride`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`. In particolare
  `noUncheckedIndexedAccess` rende `arr[i]` / `regex[1]` di tipo `T | undefined`: vanno sempre
  guardati (vedi i pattern `m?.[1] ?? …` in `state.ts`/`turn.ts`).
- ESLint flat config (`backend/eslint.config.js`, `frontend/eslint.config.js`) è **type-aware**
  (`parserOptions.projectService`): oltre alle regole sintattiche attiva `no-floating-promises` /
  `no-misused-promises` / `await-thenable` — fondamentali nel backend async (per questo gli handler
  di evento delegano a una funzione async invocata con `void`, vedi `server.ts`). `no-explicit-any`
  è **off** di proposito: i messaggi dell'Agent SDK sono non tipati e l'uso di `any` è deliberato.

### Gestione partita
- `./reset-game.sh` (o `reset-game.ps1` su Windows) — ripristina i 4 file di `game/` al turno 0 dello scenario da `game_initial_status.zip` (i 4 file alla radice dell'archivio) e rimuove il recap. Chiede conferma (`--force`/`-Force` per saltarla).
- `./export-zip.sh [out.zip]` — esporta un `.zip` portabile (esclude `.git`, `node_modules`, build, segreti, `_ultimo_turno.md`).

## Autenticazione (importante)

**L'app non contiene alcuna config di auth.** Chiama solo `query()` dell'Agent SDK, che usa la CLI `claude` installata sulla macchina ed **eredita la sua auth** (login standard Anthropic / abbonamento). Requisito: `claude` deve essere sul PATH e già autenticata nella shell che avvia il backend (provala con `claude -p "ciao"`). Funziona su Windows nativo (`claude.exe`) e su WSL/Linux; gli script `*.sh` richiedono bash.

## Architettura

```
React+TS (Vite, :5173)  ──WebSocket(:8088)──►  Node backend (TS)  ──Agent SDK──►  CLI claude
```

### Due canali sulla stessa connessione WebSocket
Smistati su `msg.channel` (vedi `backend/src/protocol.ts`, copiato in `frontend/src/protocol.ts`). Un lock `busy` **per connessione** serializza i due canali: condividono `game/`, **un turno alla volta**.

- **`advisor`** (Consulente) — tempo congelato, **sola lettura** di `game/`, stream classico. Mantiene il contesto tra messaggi col **`resume`** della sessione SDK (`advisorSession` in `server.ts`). Lo stato viene iniettato nel prompt **solo al primo messaggio**; un `reset` dimentica la sessione.
- **`turn`** (Avanza il turno) — input = **durata + ordini**. Lancia la pipeline multi-agente, streamma la Gazzetta e **scrive** su `game/`. Stateless lato server (lo stato vive nei file).

### La pipeline di un turno — `backend/src/game/turn.ts`
`runTurn()` è un **async generator** che `yield`-a SOLO i delta del Giornale (Fase 3, il Giornalista); il progresso delle altre fasi passa per `onProgress()`. Pipeline a **6 agenti** (modello "calderone": più fonti confluiscono in una timeline, poi un giornalista la racconta):

| Fase | Agente | Prompt | Output |
|---|---|---|---|
| 1 (valuta + **colloca le mosse nel tempo**) + 2.1 (seleziona 1-7 attori) | **Arbitro** | `arbitro.md` | strutturato (`arbitroSchema`) |
| 2.2 (immedesimazione, **in parallelo**) | **Attore** ×N | `attore.md` | strutturato (`attoreSchema`) |
| 2.5 (eventi di sfondo, corretti per l'Effetto Farfalla) | **Storico** | `storico.md` | strutturato (`storicoSchema`) |
| 2.6 (fonde le 3 fonti in **una timeline datata**) | **Integratore** | `integratore.md` | strutturato (`integratoreSchema`) |
| 3 (Gazzetta dalla timeline) | **Giornalista** | `giornalista.md` | **streaming** (nessuno schema) |
| 4-5 (riscrive movimento/nazione/attori) | **Snapshotter** | `snapshot.md` | blocchi `===FILE:nome===` |
| 6 (append cronologia) | — | — | **solo codice**, zero token |

Le tre **fonti del calderone**: (a) azioni del giocatore valutate dall'Arbitro; (b) mosse degli attori simulati; (c) eventi storici di sfondo delle forze NON simulate. L'Integratore le fonde in `timeline[{data,testo,fonte}]` + `esitoIntegrato` + `scoperteProssimoTurno` + `cronologia`.

Dettagli che richiedono di leggere più file:
- **Spalmatura nel tempo (Pax-Historia-like)**: l'Arbitro non risolve le azioni "il primo giorno" — assegna a ciascuna una `collocazione` nell'arco (`finestra.arco`, condiviso da Storico e Integratore). Così un'azione di inizio finestra può **condizionare**, nello stesso turno, ciò che accade dopo.
- **Storico sequenziale + Effetto Farfalla**: gira **dopo** Arbitro e Attori e ne riceve azioni+mosse, così corregge gli eventi storici reali (li **sopprime / anticipa / ritarda**) in base a cosa è successo nella partita — divergenze accumulate (via `cerca_cronologia`) e divergenze di questa finestra.
- **Contesto ristretto degli Attori**: ogni agente-Attore riceve **solo la propria scheda**, ritagliata da `attori.md` con `findActorCard`/`parseActorCards` (`game/actors.ts`), che divide il file sugli header `### `. Decide in isolamento col suo orizzonte di conoscenza; l'Integratore fa convergere tutto.
- **Niente più estrazione regex dei dati di turno**: l'Integratore produce **output strutturato** (`integratoreSchema`), quindi il Giornalista streamma la Gazzetta **grezza** (nessun blocco da nascondere). Lo Snapshotter invece resta a blocchi delimitati `===FILE:nome===`, ritagliati con `parseSnapshotBlocks`.
- **Le "scoperte" assegnate dall'Integratore** a ciascun attore vengono passate allo Snapshotter, che le sedimenta nel campo "cosa sa di lui" della scheda → l'agente-Attore le ritrova al turno dopo.

### Proprietà dello stato (`backend/src/game/state.ts`)
Il **backend è l'unico** a scrivere su `game/`; **gli agenti non toccano mai i file** — restituiscono testo/dati e l'I/O lo fa il codice (la chat non vede mai le scritture).
- `loadState()` legge i 4 `.md`. `writeSnapshots()` riscrive movimento/nazione/attori in modo **atomico** (write su `.tmp` + `rename`). `appendCronologia()` fa **append puro** a `cronologia.md` (mai riscritta).
- **Memoria del passato**: a fine turno `writeUltimoTurno()` rigenera `game/_ultimo_turno.md` (recap, da codice, zero token); ogni agente lo riceve sempre nel contesto. Per fatti più vecchi gli agenti possono chiamare il tool read-only `cerca_cronologia` (`searchCronologia` per parole chiave), evitando di ingoiare l'intera `cronologia.md`.
- `currentDate()` estrae la data di gioco dal campo `**Data corrente:**` di `movimento.md`.

### Wrapper Agent SDK (`backend/src/game/agent.ts`)
Due primitive sopra `query()`:
- `runAgent<T>()` — output **strutturato** via `outputFormat: { type:'json_schema', schema }`; legge `result.structured_output`. Lo structured output fa un tool-roundtrip interno → serve `maxTurns` alto (8; 12 con tool).
- `streamAgent()` — streaming token-by-token (Giornale del Giornalista e Consulente) con `includePartialMessages`; opzionale `resume`/`onSession`.

Gli agenti hanno **un solo tool** concesso (read-only): `cerca_cronologia`, server MCP in-process in `game/tools.ts` (`createSdkMcpServer`). Abilitato solo con `allowTools`.

### Prompt (`backend/src/game/prompts.ts`)
Caricati a runtime da `prompt/*.md` (`PROMPT_DIR`), editabili **senza ricompilare**. Ogni agente-GM (Arbitro/Attore/Storico/Integratore/Giornalista/Snapshotter) riceve `withScenario(withCommon(slice))`: **meccanica** (`common.md`, scenario-agnostica) + **ambientazione** (`scenario.md`) + slice di fase. Il Consulente (`advisor.md`) non usa la meccanica-GM ma riceve comunque lo scenario (`withScenario(advisor)`).

## Convenzioni e accortezze

- **Il protocollo WS è duplicato per copia**: modificando `backend/src/protocol.ts` aggiorna anche `frontend/src/protocol.ts` (e viceversa).
- **Output dello Snapshotter via marcatori testuali** (`===FILE:nome===`): se cambi questo formato in `snapshot.md`, aggiorna il parser `parseSnapshotBlocks` in `turn.ts`. (Le altre fasi usano output strutturato via schema: nessun marcatore testuale da mantenere.)
- **Ambientazione tutta in `scenario.md`**: non reintrodurre riferimenti all'Italia/1919 nei prompt degli agenti né in `common.md`; restano scenario-agnostici. Lo stato in `game/*.md` è invece contenuto dello scenario (Italia), con schema generico (es. campo `**Relazione con la fazione del giocatore:**`).
- **`_ultimo_turno.md` è derivato** (in `.gitignore`): lo stato vero sono gli altri 4 file di `game/`. Non trattarlo come fonte di verità.
- Le `.md` di `prompt/` e `game/` sono **dati di gioco**, non documentazione: trattale come tali quando modifichi il comportamento.
