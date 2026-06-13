// Orchestratore dell'avanzamento di turno: pipeline a 6 agenti + cronologia da codice.
//
//   Arbitro      Fase 1 (valuta + colloca le mosse nel tempo) + Fase 2.1 (seleziona attori) [strutturato]
//   Attore #1..N Fase 2.2 (immedesimazione, in parallelo, contesto ristretto)               [strutturato]
//   Storico      Fase 2.5 (eventi di sfondo, corretti per l'Effetto Farfalla)               [strutturato]
//   Integratore  Fase 2.6 (fonde le 3 fonti in UNA timeline datata: il "calderone")         [strutturato]
//   Giornalista  Fase 3   (Gazzetta in streaming a partire dalla timeline)                  [streaming]
//   Snapshotter  Fasi 4-5 (riscrive movimento/nazione/attori.md)            [3 agenti paralleli, testo grezzo]
//   Cronologia   Fase 6   (append puro, zero token)                                         [solo codice]
//
// Memoria del passato: ogni agente riceve sempre il recap _ultimo_turno.md e può
// chiamare il tool read-only cerca_cronologia per fatti più vecchi (allowTools).
//
// runTurn() yield-a SOLO i delta del Giornale (Fase 3). Il progresso delle altre fasi
// passa per onProgress(). Le scritture su game/ avvengono dietro le quinte.
import { runAgent, streamAgent } from "./agent.js";
import { prompts } from "./prompts.js";
import {
  arbitroSchema,
  attoreSchema,
  storicoSchema,
  integratoreSchema,
  type ArbitroOutput,
  type AttoreOutput,
  type StoricoOutput,
  type IntegratoreOutput,
} from "./schemas.js";
import { findActorCard } from "./actors.js";
import {
  appendChatHistory,
  appendCronologia,
  currentDate,
  loadUltimoTurno,
  writeSnapshots,
  writeUltimoTurno,
  type GameState,
} from "./state.js";

export interface TurnResult {
  data: IntegratoreOutput | null; // null se l'Integratore non ha prodotto output
  snapshotsWritten: boolean;
}

export interface RunTurnOpts {
  // Abortito alla caduta della connessione: ferma la query in corso → runTurn
  // lancia e il turno viene scartato PRIMA delle scritture finali su game/
  // (Fasi 4-6 in fondo), evitando stato applicato a metà o scritture concorrenti.
  abortController?: AbortController;
}

export async function* runTurn(
  messaggio: string, // durata + ordini, es. "avanziamo di 2 settimane: faccio X e Y"
  state: GameState,
  onProgress: (label: string) => void,
  opts: RunTurnOpts = {}
): AsyncGenerator<string, TurnResult, unknown> {
  const { abortController } = opts;
  const data = currentDate(state);
  const ultimoTurno = await loadUltimoTurno();
  const recapBlock = `=== RECAP DELL'ULTIMO TURNO (_ultimo_turno.md) ===\n${ultimoTurno}`;

  // ---- Fase 1 + 2.1 — Arbitro -----------------------------------------------
  onProgress("Valuto le tue mosse…");
  const arbitro = await runAgent<ArbitroOutput>({
    system: prompts.arbitro,
    schema: arbitroSchema,
    allowTools: true,
    abortController,
    prompt: [
      `DATA DI GIOCO CORRENTE: ${data}`,
      `RICHIESTA DEL GIOCATORE (durata + ordini): ${messaggio}`,
      ``,
      recapBlock,
      ``,
      `=== movimento.md ===\n${state.movimento}`,
      `=== nazione.md ===\n${state.nazione}`,
      `=== attori.md ===\n${state.attori}`,
    ].join("\n"),
  });
  const arb = arbitro.structured;
  if (!arb) throw new Error("Arbitro: nessun output strutturato");
  const arco = arb.finestra?.arco ?? messaggio;

  // ---- Fase 2.2 — agenti-Attore in parallelo --------------------------------
  const selezionati = arb.attoriSelezionati ?? [];
  onProgress(
    `Simulo gli altri attori: ${selezionati.map((a) => a.nome).join(", ") || "—"}…`
  );

  const attoriOut = await Promise.all(
    selezionati.map(async (sel): Promise<AttoreOutput | null> => {
      const card = findActorCard(state.attori, sel.nome);
      const scheda = card?.testo ?? `### ${sel.nome}\n(scheda non trovata nel salvataggio)`;
      try {
        const res = await runAgent<AttoreOutput>({
          system: prompts.attore,
          schema: attoreSchema,
          allowTools: true,
          abortController,
          prompt: [
            `TU SEI: ${sel.nome}`,
            `DATA DI GIOCO CORRENTE: ${data}`,
            `DURATA DELL'AVANZAMENTO: ${messaggio}`,
            ``,
            recapBlock,
            ``,
            `LA TUA SCHEDA (dal salvataggio attori.md):`,
            scheda,
          ].join("\n"),
        });
        return res.structured ?? null;
      } catch (err) {
        // Un abort (connessione caduta) NON è un fallimento dell'agente da tollerare:
        // va propagato per fermare subito il turno (lo Promise.all rigetta).
        if (abortController?.signal.aborted) throw err;
        console.error(`[turn] agente-attore "${sel.nome}" fallito:`, err);
        return null;
      }
    })
  );
  const attori = attoriOut.filter((a): a is AttoreOutput => a !== null);

  const azioniJson = JSON.stringify(arb.azioni, null, 2);
  const attoriJson = JSON.stringify(attori, null, 2);

  // ---- Fase 2.5 — Storico (eventi di sfondo, corretti per l'Effetto Farfalla) ----
  // Sequenziale dopo Arbitro+Attori: vede le azioni e le mosse di QUESTO turno, così
  // può sopprimere/anticipare/ritardare gli eventi storici che esse alterano.
  onProgress("Ricostruisco gli eventi del mondo…");
  let eventiStoriciJson = "[]";
  try {
    const storico = await runAgent<StoricoOutput>({
      system: prompts.storico,
      schema: storicoSchema,
      allowTools: true,
      abortController,
      prompt: [
        `ARCO DELLA FINESTRA (eventi databili in questo intervallo): ${arco}`,
        `DATA DI GIOCO CORRENTE (inizio finestra): ${data}`,
        ``,
        recapBlock,
        ``,
        `=== VALUTAZIONE AZIONI DEL GIOCATORE (con collocazione nel tempo) ===`,
        azioniJson,
        ``,
        `=== MOSSE DEGLI ATTORI SIMULATI IN QUESTO TURNO ===`,
        attoriJson,
        ``,
        `=== nazione.md (sfondo materiale) ===\n${state.nazione}`,
        `=== attori.md (chi è in scena e chi resta fuori scena) ===\n${state.attori}`,
      ].join("\n"),
    });
    if (storico.structured) {
      eventiStoriciJson = JSON.stringify(storico.structured.eventiStorici, null, 2);
    }
  } catch (err) {
    // Un abort (connessione caduta) deve fermare il turno, non degradare a "niente sfondo".
    if (abortController?.signal.aborted) throw err;
    console.error("[turn] Storico fallito, proseguo senza eventi di sfondo:", err);
  }

  // ---- Fase 2.6 — Integratore (il calderone: una timeline unica) -------------
  onProgress("Fondo gli eventi del turno…");
  const integratore = await runAgent<IntegratoreOutput>({
    system: prompts.integratore,
    schema: integratoreSchema,
    allowTools: true,
    abortController,
    prompt: [
      `DATA DI GIOCO CORRENTE (inizio finestra): ${data}`,
      `ARCO DELLA FINESTRA: ${arco}`,
      `DURATA RICHIESTA DAL GIOCATORE: ${messaggio}`,
      ``,
      recapBlock,
      ``,
      `=== AZIONI DEL GIOCATORE valutate dall'Arbitro (Fase 1, con collocazione) ===`,
      azioniJson,
      ``,
      `=== MINI-SIMULAZIONI DEGLI ATTORI (Fase 2.2) ===`,
      attoriJson,
      ``,
      `=== EVENTI DI SFONDO dello Storico (Fase 2.5, già corretti per l'Effetto Farfalla) ===`,
      eventiStoriciJson,
    ].join("\n"),
  });
  const integ = integratore.structured;
  if (!integ) throw new Error("Integratore: nessun output strutturato");

  // ---- Fase 3 — Giornalista (stream del Giornale a partire dalla timeline) ----
  // Nessun blocco-dati da nascondere: i dati di servizio li ha già prodotti
  // l'Integratore come output strutturato. Lo stream va all'utente così com'è.
  onProgress("Scrivo il Giornale del turno…");
  const giornalistaPrompt = [
    `DATA DI GIOCO A FINE TURNO: ${integ.dataCorrente}`,
    `DURATA DELL'AVANZAMENTO: ${messaggio}`,
    `ARCO DELLA FINESTRA: ${arco}`,
    ``,
    `=== TIMELINE DEGLI EVENTI DEL TURNO (il calderone, da raccontare) ===`,
    JSON.stringify(integ.timeline, null, 2),
    ``,
    `=== ESITO INTEGRATO (sintesi in prosa) ===`,
    integ.esitoIntegrato,
  ].join("\n");

  // Accumula la Gazzetta intera mentre la streammiamo: serve per l'append a fine
  // turno in chat_history.json (un solo append, a streaming concluso).
  let gazzetta = "";
  for await (const delta of streamAgent({
    system: prompts.giornalista,
    prompt: giornalistaPrompt,
    allowTools: true,
    abortController,
  })) {
    gazzetta += delta;
    yield delta;
  }

  // ---- Fasi 4-5 — Snapshotter (3 agenti paralleli, uno per file, testo grezzo) ----
  // Come gli Attori, gira in Promise.all: ogni agente riscrive UN solo file e la
  // risposta È già il file. Niente più marcatori testuali da ritagliare.
  // La coerenza incrociata (relazioni giocatore↔attore presenti sia in movimento.md
  // sia nelle schede di attori.md) è affidata all'esitoIntegrato, fonte condivisa.
  onProgress("Aggiorno lo stato di gioco…");
  let snapshotsWritten = false;
  const esitoIntegrato = integ.esitoIntegrato;

  // Le "scoperte" che l'Integratore assegna a ciascun attore sono l'evoluzione del
  // suo ORIZZONTE DI CONOSCENZA: vanno fatte sedimentare nel campo "cosa sa di lui"
  // della sua scheda, così al prossimo turno l'agente-Attore le ritrova. Riguardano
  // solo attori.md, quindi il blocco va dato esclusivamente a quell'agente.
  const scoperte = integ.scoperteProssimoTurno ?? [];
  const scoperteBlock = scoperte.length
    ? scoperte.map((s) => `- ${s.attore}: ${s.cosaScopre}`).join("\n")
    : "(nessuna scoperta segnalata per questo turno)";

  const snapTargets = [
    { key: "movimento", file: "movimento.md", attuale: state.movimento, extra: "" },
    { key: "nazione", file: "nazione.md", attuale: state.nazione, extra: "" },
    {
      key: "attori",
      file: "attori.md",
      attuale: state.attori,
      extra: [
        ``,
        `=== COSA CIASCUN ATTORE SCOPRE A FINE TURNO (aggiorna gli orizzonti di conoscenza) ===`,
        scoperteBlock,
      ].join("\n"),
    },
  ] as const;

  const snapResults = await Promise.all(
    snapTargets.map(async (t): Promise<string | null> => {
      try {
        const res = await runAgent({
          system: prompts.snapshot,
          allowTools: true,
          abortController,
          prompt: [
            `FILE DA RISCRIVERE: ${t.file} — produci SOLO questo file, per intero.`,
            ``,
            `ESITO INTEGRATO DEL TURNO (dall'Integratore):`,
            esitoIntegrato,
            t.extra,
            ``,
            `=== ${t.file} (attuale) ===\n${t.attuale}`,
          ].join("\n"),
        });
        return cleanSnapshotFile(res.text);
      } catch (err) {
        // Un abort (connessione caduta) deve fermare il turno: rilancia.
        if (abortController?.signal.aborted) throw err;
        console.error(`[turn] Snapshotter "${t.file}" fallito:`, err);
        return null;
      }
    })
  );

  const [movimentoMd, nazioneMd, attoriMd] = snapResults;
  if (movimentoMd && nazioneMd && attoriMd) {
    await writeSnapshots({ movimento: movimentoMd, nazione: nazioneMd, attori: attoriMd });
    snapshotsWritten = true;
  } else {
    console.error(
      "[turn] Snapshotter: uno o più file non prodotti, snapshot non scritti (nessuna scrittura parziale)"
    );
  }

  // ---- Fase 6 — Cronologia (append puro, zero token) ------------------------
  if (integ.cronologia?.eventi?.length) {
    await appendCronologia(integ.cronologia);
  } else {
    console.warn("[turn] nessun blocco cronologia: append saltato");
  }

  // ---- Recap _ultimo_turno.md (da codice, zero token) -----------------------
  if (integ.cronologia) {
    await writeUltimoTurno(integ.cronologia, esitoIntegrato, integ.dataCorrente || data);
  }

  // ---- Storico chat (transcript giocatore↔Gazzetta, NON dato agli agenti) ----
  // A fine pipeline: se la connessione fosse caduta prima (abort → throw), il turno
  // è scartato e non viene registrato, coerentemente con cronologia/_ultimo_turno.
  if (gazzetta.trim()) {
    await appendChatHistory(messaggio, gazzetta);
  }

  return { data: integ, snapshotsWritten };
}

// Normalizza l'output grezzo di un agente-Snapshotter: il corpo della risposta È
// già il file. Difesa minima contro un eventuale code fence di contorno (```… ```,
// anche ```markdown) o spazi in eccesso. Ritorna null se vuoto (→ niente scrittura).
function cleanSnapshotFile(text: string): string | null {
  let s = text.trim();
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  const inner = fence?.[1];
  if (inner != null) s = inner.trim();
  return s || null;
}
