// Protocollo dei messaggi WebSocket, condiviso (per copia) col frontend.
//
// Due canali logici sulla stessa connessione:
//   - "advisor": consulente, tempo congelato, stream classico (legge game/, non scrive).
//   - "turn":    avanzamento di turno, pipeline multi-agente; emette eventi di
//                progresso (turn_progress) e poi lo stream del Giornale.
export type Channel = "advisor" | "turn";

// Client -> Server
export type ClientMessage =
  | {
      type: "user_message";
      id: string; // id univoco del turno, generato dal client
      channel: Channel; // su quale canale è stato inviato il messaggio
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
  // Storico persistente di un canale, inviato alla connessione per ripopolare la UI
  // dopo un reload/riavvio (oggi solo "turn": transcript giocatore↔Gazzetta).
  | {
      type: "history";
      channel: Channel;
      messages: { id: string; role: "user" | "assistant"; text: string }[];
    }
  | { type: "assistant_delta"; channel: Channel; id: string; text: string }
  | { type: "assistant_done"; channel: Channel; id: string }
  | { type: "turn_progress"; id: string; label: string } // solo canale "turn"
  | { type: "error"; channel?: Channel; id?: string; message: string }
  | { type: "pong" }; // risposta all'heartbeat app-level del client
