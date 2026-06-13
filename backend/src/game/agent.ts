// Wrapper sopra il Claude Agent SDK per gli agenti di gioco.
//
// Due primitive:
//   - runAgent<T>(): una query con output STRUTTURATO (options.outputFormat).
//                    Ritorna { text, structured } leggendo result.structured_output.
//   - streamAgent(): una query in streaming token-by-token (per il Giornale e il
//                    consulente); opzionale resume per la continuità della sessione.
//
// L'auth è ereditata dalla CLI `claude` installata (l'app non la configura).
// Verificato con i sanity check (vedi backend/src/sanity-structured.ts):
//   - outputFormat: { type:'json_schema', schema } funziona e popola result.structured_output;
//   - lo structured output fa un tool-roundtrip interno → serve maxTurns alto (usiamo 8);
//   - systemPrompt come stringa dà un system prompt totalmente custom (niente preset).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { gameMcpServer, CERCA_CRONOLOGIA_TOOL } from "./tools.js";

// Lo structured output e l'uso di tool consumano "turni" interni (round-trip SDK).
const STRUCTURED_MAX_TURNS = 8;
const TOOLS_MAX_TURNS = 12;

// Gli agenti non scrivono nulla (l'I/O lo fa il backend); l'unico tool concesso è
// la ricerca read-only sulla cronologia, e solo se l'agente lo richiede (allowTools).
function toolOptions(allowTools: boolean) {
  return allowTools
    ? {
        mcpServers: { [gameMcpServer.name]: gameMcpServer },
        allowedTools: [CERCA_CRONOLOGIA_TOOL],
      }
    : { allowedTools: [] as string[] };
}

export interface RunAgentOpts {
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
  model?: string;
  allowTools?: boolean; // abilita cerca_cronologia
  abortController?: AbortController; // abortito alla caduta della connessione: la query si ferma
}

export interface RunAgentResult<T> {
  text: string;
  structured?: T;
}

export async function runAgent<T = unknown>(
  opts: RunAgentOpts
): Promise<RunAgentResult<T>> {
  // maxTurns deve coprire i round-trip dello structured output e/o dei tool.
  const maxTurns = opts.schema
    ? STRUCTURED_MAX_TURNS
    : opts.allowTools
    ? TOOLS_MAX_TURNS
    : 1;
  const response = query({
    prompt: opts.prompt,
    options: {
      systemPrompt: opts.system,
      ...toolOptions(!!opts.allowTools),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.schema ? { outputFormat: { type: "json_schema", schema: opts.schema } } : {}),
      ...(opts.abortController ? { abortController: opts.abortController } : {}),
      maxTurns,
    },
  });

  let text = "";
  let structured: T | undefined;

  for await (const message of response) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") text += block.text;
      }
    } else if (message.type === "result") {
      const m = message as any;
      if (m.subtype !== "success") {
        const detail =
          "errors" in m && m.errors?.length ? m.errors.join("; ") : m.subtype;
        throw new Error(`Claude result error: ${detail}`);
      }
      if (m.structured_output != null) structured = m.structured_output as T;
      if (!text && typeof m.result === "string") text = m.result;
    }
  }

  return { text, structured };
}

export interface StreamAgentOpts {
  system: string;
  prompt: string;
  model?: string;
  resume?: string; // session_id da riprendere (consulente)
  onSession?: (id: string) => void; // riceve il session_id corrente
  allowTools?: boolean; // abilita cerca_cronologia
  abortController?: AbortController; // abortito alla caduta della connessione: lo stream si ferma
}

export async function* streamAgent(
  opts: StreamAgentOpts
): AsyncGenerator<string, void, unknown> {
  const response = query({
    prompt: opts.prompt,
    options: {
      systemPrompt: opts.system,
      ...toolOptions(!!opts.allowTools),
      includePartialMessages: true,
      ...(opts.allowTools ? { maxTurns: TOOLS_MAX_TURNS } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.abortController ? { abortController: opts.abortController } : {}),
    },
  });

  let emitted = ""; // per il fallback sul messaggio assistant completo

  for await (const message of response) {
    if ("session_id" in message && message.session_id) {
      opts.onSession?.(message.session_id);
    }

    if (message.type === "stream_event") {
      const ev = message.event as any;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        const delta: string = ev.delta.text ?? "";
        if (delta) {
          emitted += delta;
          yield delta;
        }
      }
    } else if (message.type === "assistant") {
      // Fallback: se non sono arrivati gli stream_event, emetti il testo mancante.
      let full = "";
      for (const block of message.message.content) {
        if (block.type === "text") full += block.text;
      }
      if (full.length > emitted.length && full.startsWith(emitted)) {
        const rest = full.slice(emitted.length);
        emitted += rest;
        yield rest;
      }
    } else if (message.type === "result") {
      if (message.subtype !== "success") {
        const m = message as any;
        const detail =
          "errors" in m && m.errors?.length ? m.errors.join("; ") : m.subtype;
        throw new Error(`Claude result error: ${detail}`);
      }
    }
  }
}
