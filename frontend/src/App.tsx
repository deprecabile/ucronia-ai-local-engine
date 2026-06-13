import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useGameChat, type ChatMessage } from "./useGameChat";

const MIN_PCT = 20; // larghezza minima (%) per ciascun pannello

const styles = {
  page: {
    margin: 0,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#0d1117",
    color: "#e6edf3",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
  },
  topbar: {
    padding: "10px 16px",
    borderBottom: "1px solid #21262d",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 15,
    fontWeight: 700,
  },
  dot: (ok: boolean) => ({
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: ok ? "#3fb950" : "#f85149",
    boxShadow: ok ? "0 0 6px #3fb950" : "none",
  }),
  panels: {
    flex: 1,
    display: "flex",
    minHeight: 0,
  },
  panel: (accent: string, basisPct: number) => ({
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `${basisPct}%`,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderTop: `2px solid ${accent}`,
  }),
  divider: (dragging: boolean) => ({
    width: 6,
    flex: "0 0 6px",
    cursor: "col-resize",
    background: dragging ? "#484f58" : "#21262d",
    transition: dragging ? "none" : "background 0.15s",
  }),
  panelHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid #21262d",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  panelHeaderText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  panelTitle: { fontSize: 14, fontWeight: 700 },
  panelSub: { fontSize: 12, color: "#7d8590", fontWeight: 400 },
  clearBtn: (disabled: boolean) => ({
    flexShrink: 0,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #30363d",
    background: "transparent",
    color: disabled ? "#484f58" : "#7d8590",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  }),
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  bubble: (role: "user" | "assistant") => ({
    maxWidth: "88%",
    padding: "10px 14px",
    borderRadius: 12,
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    lineHeight: 1.5,
    fontSize: 14,
    alignSelf: role === "user" ? "flex-end" : "flex-start",
    background: role === "user" ? "#1f6feb" : "#161b22",
    border: role === "user" ? "none" : "1px solid #21262d",
  }),
  progress: {
    alignSelf: "flex-start",
    fontSize: 13,
    color: "#d29922",
    fontStyle: "italic",
    padding: "4px 2px",
  },
  empty: { color: "#7d8590", margin: "auto", fontSize: 13, textAlign: "center" },
  footer: {
    borderTop: "1px solid #21262d",
    padding: 12,
    display: "flex",
    gap: 8,
  },
  textarea: {
    flex: 1,
    resize: "none",
    background: "#0d1117",
    color: "#e6edf3",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
  },
  button: (disabled: boolean, accent: string) => ({
    padding: "0 18px",
    borderRadius: 8,
    border: "none",
    background: disabled ? "#21262d" : accent,
    color: disabled ? "#7d8590" : "#fff",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
} as const;

interface PanelProps {
  title: string;
  subtitle: string;
  accent: string;
  basisPct: number;
  placeholder: string;
  connected: boolean;
  busy: boolean;
  progress: string | null;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClear: () => void;
}

function ChatPanel(props: PanelProps) {
  const { title, subtitle, accent, basisPct, placeholder, connected, busy, progress, messages, onSend, onClear } = props;
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, progress]);

  const canSend = connected && !busy && input.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    onSend(input);
    setInput("");
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div style={styles.panel(accent, basisPct) as React.CSSProperties}>
      <div style={styles.panelHeader as React.CSSProperties}>
        <div style={styles.panelHeaderText as React.CSSProperties}>
          <span style={styles.panelTitle as React.CSSProperties}>{title}</span>
          <span style={styles.panelSub as React.CSSProperties}>{subtitle}</span>
        </div>
        <button
          style={styles.clearBtn(busy || messages.length === 0) as React.CSSProperties}
          onClick={onClear}
          disabled={busy || messages.length === 0}
          title="Svuota la chat e azzera il contesto"
        >
          🧹 Pulisci
        </button>
      </div>

      <div ref={listRef} className="chat-list" style={styles.list as React.CSSProperties}>
        {messages.length === 0 && (
          <div style={styles.empty as React.CSSProperties}>{placeholder}</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "bubble-user" : undefined}
            style={styles.bubble(m.role) as React.CSSProperties}
          >
            {m.text ? (
              <div className="bubble-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            ) : (
              m.role === "assistant" && busy ? "…" : ""
            )}
          </div>
        ))}
        {progress && <div style={styles.progress as React.CSSProperties}>⏳ {progress}</div>}
      </div>

      <div style={styles.footer as React.CSSProperties}>
        <textarea
          style={styles.textarea as React.CSSProperties}
          rows={2}
          placeholder={connected ? "Scrivi… (Invio per inviare, Shift+Invio a capo)" : "In attesa di connessione…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!connected || busy}
        />
        <button
          style={styles.button(!canSend, accent) as React.CSSProperties}
          onClick={submit}
          disabled={!canSend}
        >
          Invia
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { advisor, turn, connected, sendAdvisor, sendTurn, clearChat } = useGameChat();
  const panelsRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(50);
  const [dragging, setDragging] = useState(false);

  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (e: MouseEvent) => {
      const el = panelsRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(100 - MIN_PCT, Math.max(MIN_PCT, pct)));
    };
    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging]);

  return (
    <div style={styles.page as React.CSSProperties}>
      <div style={styles.topbar as React.CSSProperties}>
        <span style={styles.dot(connected) as React.CSSProperties} />
        Fantapolitica Italia '20
        <span style={{ fontWeight: 400, fontSize: 12, color: "#7d8590" }}>
          {connected ? "connesso" : "disconnesso"}
        </span>
      </div>

      <div ref={panelsRef} style={styles.panels as React.CSSProperties}>
        <ChatPanel
          title="🗣️ Consulente"
          subtitle="Il tempo è congelato: chiedi analisi, ipotesi e consigli. Il gioco non avanza."
          accent="#3fb950"
          basisPct={leftPct}
          placeholder="Chiedi al tuo consulente politico. Qui il tempo non passa."
          connected={connected}
          busy={advisor.busy}
          progress={advisor.progress}
          messages={advisor.messages}
          onSend={sendAdvisor}
          onClear={() => clearChat("advisor")}
        />
        <div
          style={styles.divider(dragging) as React.CSSProperties}
          onMouseDown={onDividerDown}
          role="separator"
          aria-orientation="vertical"
        />
        <ChatPanel
          title="⏭️ Avanza il turno"
          subtitle="Scrivi durata + ordini (es. «avanziamo di 2 settimane: comizio a Palermo»). Qui il tempo passa."
          accent="#1f6feb"
          basisPct={100 - leftPct}
          placeholder="Dai gli ordini e fai avanzare il tempo. Es.: «Facciamo passare un mese: …»"
          connected={connected}
          busy={turn.busy}
          progress={turn.progress}
          messages={turn.messages}
          onSend={sendTurn}
          onClear={() => clearChat("turn")}
        />
      </div>
    </div>
  );
}
