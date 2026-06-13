import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, ClientMessage, ServerMessage } from "./protocol";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

interface ChannelState {
  messages: ChatMessage[];
  busy: boolean;
  progress: string | null; // solo per il canale "turn"
}

const EMPTY: ChannelState = { messages: [], busy: false, progress: null };

// Heartbeat app-level + riconnessione. Il WebSocket del browser non espone i
// ping/pong di protocollo, quindi mandiamo noi un "ping" periodico e, se non
// arriva NULLA dal server entro WATCHDOG_MS, consideriamo la connessione morta
// (zombie/half-open) e la chiudiamo per far ripartire la riconnessione.
const PING_MS = 25_000;
const WATCHDOG_MS = 35_000;
const RECONNECT_MAX_MS = 30_000;

// Una sola connessione WS, due canali ("advisor" / "turn") con stato separato.
export function useGameChat() {
  const [advisor, setAdvisor] = useState<ChannelState>(EMPTY);
  const [turn, setTurn] = useState<ChannelState>(EMPTY);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0); // tentativi di riconnessione falliti di fila (per il backoff)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null); // tiene sveglio lo schermo finché la pagina è aperta

  // Stabile tra i render (i dispatcher di useState lo sono già): così può comparire
  // nelle dipendenze degli hook sotto senza ricrearli a ogni render.
  const setters: Record<Channel, React.Dispatch<React.SetStateAction<ChannelState>>> = useMemo(
    () => ({ advisor: setAdvisor, turn: setTurn }),
    []
  );

  useEffect(() => {
    let closed = false;

    const clearTimers = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      pingRef.current = null;
      watchdogRef.current = null;
    };

    // Screen Wake Lock (come YouTube): tiene lo schermo acceso → impedisce la
    // sospensione del computer mentre la pagina è aperta. Best-effort: assente su
    // browser non supportati, ammesso solo a documento visibile e su contesti sicuri
    // (HTTPS/localhost), e rilasciato dal browser quando il tab diventa nascosto →
    // va ri-acquisito al ritorno (vedi onVisible).
    const acquireWakeLock = async () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      if (wakeLockRef.current) return; // già attivo
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        wakeLockRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        });
      } catch {
        // permesso negato / batteria scarica / non supportato: nessun errore, è opzionale
      }
    };

    const connect = () => {
      const url = `ws://${location.hostname}:8088`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // Watchdog: rearmato a ogni messaggio in arrivo (incluso "pong"). Se scade,
      // il socket è muto → chiudiamo per innescare la riconnessione.
      const armWatchdog = () => {
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        watchdogRef.current = setTimeout(() => ws.close(), WATCHDOG_MS);
      };

      ws.onopen = () => {
        setConnected(true);
        attemptsRef.current = 0; // riconnessione riuscita: azzera il backoff
        armWatchdog();
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, PING_MS);
      };

      ws.onmessage = (ev) => {
        armWatchdog(); // qualsiasi traffico dal server = connessione viva
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "ready":
            setConnected(true);
            break;
          case "pong":
            break; // l'effetto utile (rearm del watchdog) è già avvenuto sopra
          case "assistant_delta":
            setters[msg.channel]((s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === msg.id ? { ...m, text: m.text + msg.text } : m
              ),
            }));
            break;
          case "turn_progress":
            setTurn((s) => ({ ...s, progress: msg.label }));
            break;
          case "assistant_done":
            setters[msg.channel]((s) => ({ ...s, busy: false, progress: null }));
            break;
          case "error": {
            const ch: Channel = msg.channel ?? "advisor";
            setters[ch]((s) => ({
              ...s,
              busy: false,
              progress: null,
              messages: msg.id
                ? s.messages.map((m) =>
                    m.id === msg.id ? { ...m, text: m.text + `\n[errore] ${msg.message}` } : m
                  )
                : [
                    ...s.messages,
                    { id: makeId(), role: "assistant", text: `[errore] ${msg.message}` },
                  ],
            }));
            break;
          }
        }
      };

      ws.onclose = () => {
        clearTimers();
        setConnected(false);
        setAdvisor((s) => ({ ...s, busy: false, progress: null }));
        setTurn((s) => ({ ...s, busy: false, progress: null }));
        if (!closed) {
          // Backoff esponenziale: 1s, 2s, 4s… fino a RECONNECT_MAX_MS.
          const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** attemptsRef.current);
          attemptsRef.current += 1;
          reconnectRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => ws.close();
    };

    // Quando il tab torna visibile (o la pagina viene ripristinata), riconnetti SUBITO
    // se il socket non è aperto: nei tab nascosti il browser throttla i setTimeout, quindi
    // la riconnessione schedulata potrebbe essere congelata finché non torni sul tab.
    const ensureConnected = () => {
      if (closed) return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      attemptsRef.current = 0;
      connect();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        ensureConnected();
        void acquireWakeLock(); // il browser rilascia il wake lock quando il tab si nasconde: ri-acquisiscilo
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", ensureConnected);
    window.addEventListener("online", ensureConnected);

    connect();
    void acquireWakeLock();
    return () => {
      closed = true;
      clearTimers();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", ensureConnected);
      window.removeEventListener("online", ensureConnected);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
      wsRef.current?.close();
    };
  }, [setters]);

  const sendOn = useCallback((channel: Channel, busy: boolean, text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || busy) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const id = makeId();
    setters[channel]((s) => ({
      ...s,
      busy: true,
      messages: [
        ...s.messages,
        { id: makeId(), role: "user", text: trimmed },
        { id, role: "assistant", text: "" }, // bolla assistant vuota; id == id del turno
      ],
    }));

    const payload: ClientMessage = { type: "user_message", id, channel, text: trimmed };
    ws.send(JSON.stringify(payload));
  }, [setters]);

  const sendAdvisor = useCallback(
    (text: string) => sendOn("advisor", advisor.busy, text),
    [advisor.busy, sendOn]
  );
  const sendTurn = useCallback(
    (text: string) => sendOn("turn", turn.busy, text),
    [turn.busy, sendOn]
  );

  // Pulisce la chat di un canale: svuota le bolle e dice al server di
  // dimenticare la sessione (l'advisor riparte senza contesto). Ignorato se il
  // canale è occupato, per non troncare una risposta in corso.
  const clearChat = useCallback((channel: Channel) => {
    let didClear = false;
    setters[channel]((s) => {
      if (s.busy) return s;
      didClear = true;
      return EMPTY;
    });
    if (!didClear) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "reset", channel } satisfies ClientMessage));
    }
  }, [setters]);

  return { advisor, turn, connected, sendAdvisor, sendTurn, clearChat };
}
