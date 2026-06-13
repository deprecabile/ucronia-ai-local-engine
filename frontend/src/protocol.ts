// COPIA dei tipi del backend (sync manuale con backend/src/protocol.ts).
export type Channel = "advisor" | "turn";

// Client -> Server
export type ClientMessage =
  | {
      type: "user_message";
      id: string; // id univoco del turno, generato dal client
      channel: Channel;
      text: string;
    }
  | {
      // Pulisce la chat: il client svuota le bolle, il server dimentica la
      // sessione del canale (per "advisor" azzera il resume → riparte pulito).
      type: "reset";
      channel: Channel;
    }
  // Heartbeat app-level: il WebSocket del browser non espone i ping/pong di
  // protocollo, quindi il client manda "ping" e si aspetta "pong" per accorgersi
  // di una connessione morta (zombie/half-open) e riconnettersi.
  | { type: "ping" };

// Server -> Client
export type ServerMessage =
  | { type: "ready" }
  | { type: "assistant_delta"; channel: Channel; id: string; text: string }
  | { type: "assistant_done"; channel: Channel; id: string }
  | { type: "turn_progress"; id: string; label: string }
  | { type: "error"; channel?: Channel; id?: string; message: string }
  | { type: "pong" }; // risposta all'heartbeat app-level del client
