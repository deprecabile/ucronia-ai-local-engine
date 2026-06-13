// HTTP + WebSocketServer. Una connessione = un giocatore. Due canali sulla stessa
// connessione (smistati su msg.channel):
//   - "advisor": consulente, stream classico, legge game/ (non scrive). Usa resume.
//   - "turn":    avanzamento di turno, pipeline multi-agente (runTurn), scrive game/.
// Lock `busy` unico per connessione: i due canali condividono game/, un turno alla volta.
import http from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { streamAgent } from "./game/agent.js";
import { prompts } from "./game/prompts.js";
import { loadState, loadUltimoTurno, loadChatHistory, currentDate } from "./game/state.js";
import { runTurn } from "./game/turn.js";

const PORT = Number(process.env.PORT ?? 8088);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("mri backend ok\n");
});

const wss = new WebSocketServer({ server });

// Lock CONDIVISO tra tutte le connessioni (non per-connessione): i due canali
// condividono game/, un turno alla volta. Module-level perché una riconnessione a
// turno in corso non deve poter avviare un secondo turno concorrente (race su game/).
let busy = false;

// Heartbeat di protocollo: ogni HEARTBEAT_MS facciamo ws.ping(); se il client non
// ha risposto con un pong dal giro precedente lo consideriamo morto e lo terminiamo
// (→ evento "close" → abort del turno in corso → lock liberato).
const HEARTBEAT_MS = 30_000;

wss.on("connection", (ws: WebSocket) => {
  let advisorSession: string | undefined; // session_id per il resume del consulente
  // Abort del lavoro in corso su QUESTA connessione: alla caduta del socket ferma la
  // pipeline → il turno viene scartato prima delle scritture finali su game/.
  let currentAbort: AbortController | null = null;
  let isAlive = true; // settato a true dal pong di protocollo; false a ogni ping inviato

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  send({ type: "ready" });

  // Ripopola la chat del canale "turn" con lo storico persistente (giocatore↔Gazzetta)
  // dopo un reload/riavvio. Read-only e indipendente dal lock busy → fire-and-forget.
  void (async () => {
    const history = await loadChatHistory();
    if (history.length)
      send({
        type: "history",
        channel: "turn",
        messages: history.map((m, i) => ({ id: `h${i}-${m.role}`, ...m })),
      });
  })();

  ws.on("pong", () => {
    isAlive = true;
  });

  const heartbeat = setInterval(() => {
    if (!isAlive) {
      ws.terminate(); // socket zombie: chiudilo → "close" abortisce e libera il lock
      return;
    }
    isAlive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  ws.on("close", () => {
    clearInterval(heartbeat);
    currentAbort?.abort(); // ferma il turno/consulente in corso: niente scritture parziali né race
  });

  // Handler sincrono che delega: l'EventEmitter ignora la promise di una callback
  // async (eventuali reject sfuggirebbero), quindi la consumiamo esplicitamente con void.
  ws.on("message", (raw) => void handleMessage(raw));

  async function handleMessage(raw: RawData) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: "error", message: "Invalid JSON" });
      return;
    }

    // Heartbeat app-level: rispondi PRIMA del gate busy, così funziona anche mentre
    // un turno è in corso (il client lo usa per accorgersi di una connessione morta).
    if (msg.type === "ping") {
      send({ type: "pong" });
      return;
    }

    if (msg.type === "reset") {
      // Pulizia chat: per "advisor" dimentica la sessione → il prossimo messaggio
      // riparte senza contesto e re-inietta lo stato corrente. Il canale "turn" è
      // stateless lato server (lo stato vive in game/), non c'è nulla da azzerare.
      if (msg.channel !== "turn") advisorSession = undefined;
      return;
    }

    if (msg.type !== "user_message") {
      send({ type: "error", message: `Unknown message type: ${(msg as any).type}` });
      return;
    }
    const channel = msg.channel === "turn" ? "turn" : "advisor";

    if (busy) {
      send({ type: "error", channel, id: msg.id, message: "Server occupato: un turno alla volta" });
      return;
    }

    busy = true;
    const abortController = new AbortController();
    currentAbort = abortController;
    try {
      const state = await loadState();

      if (channel === "advisor") {
        // Consulente: inietta lo stato corrente (snapshot, sola lettura) + il recap
        // dell'ultimo turno. NON inietta tutta la cronologia: per i fatti più vecchi
        // può usare il tool cerca_cronologia. Solo al primo messaggio della sessione
        // serve iniettare lo stato; nei successivi il resume mantiene il contesto.
        const ultimoTurno = await loadUltimoTurno();
        const stateBlock = advisorSession
          ? "" // già in contesto via resume
          : [
              `=== STATO CORRENTE DELLA PARTITA ===`,
              `--- movimento.md ---\n${state.movimento}`,
              `--- nazione.md ---\n${state.nazione}`,
              `--- attori.md ---\n${state.attori}`,
              ``,
              `=== RECAP DELL'ULTIMO TURNO ===\n${ultimoTurno}`,
              ``,
            ].join("\n");
        const prompt = [stateBlock, `=== DOMANDA DEL GIOCATORE ===`, msg.text]
          .filter(Boolean)
          .join("\n");

        for await (const delta of streamAgent({
          system: prompts.advisor,
          prompt,
          resume: advisorSession,
          onSession: (id) => (advisorSession = id),
          allowTools: true,
          abortController,
        })) {
          send({ type: "assistant_delta", channel, id: msg.id, text: delta });
        }
      } else {
        // Avanzamento di turno: pipeline multi-agente.
        const gen = runTurn(
          msg.text,
          state,
          (label) => send({ type: "turn_progress", id: msg.id, label }),
          { abortController }
        );
        let next = await gen.next();
        while (!next.done) {
          send({ type: "assistant_delta", channel, id: msg.id, text: next.value });
          next = await gen.next();
        }
        const result = next.value;
        console.log(
          `[server] turno completato — snapshot:${result.snapshotsWritten}` +
            ` cronologia:${result.data?.cronologia?.eventi?.length ?? 0} eventi` +
            ` (data ora: ${currentDate(await loadState())})`
        );
      }

      send({ type: "assistant_done", channel, id: msg.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] ${channel} error:`, message);
      send({ type: "error", channel, id: msg.id, message });
    } finally {
      busy = false;
      if (currentAbort === abortController) currentAbort = null;
    }
  }

  ws.on("error", (err) => console.error("[server] ws error:", err));
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (ws ws://localhost:${PORT})`);
});
