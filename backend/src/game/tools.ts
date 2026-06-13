// Tool MCP in-process esposti agli agenti di gioco. Per ora uno solo, read-only:
// cerca_cronologia — permette a un agente, SE lo ritiene necessario, di interrogare
// gli eventi passati della partita senza ricevere l'intera cronologia.md nel contesto.
//
// Verificato funzionante (vedi backend/src/sanity-tool.ts).
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchCronologia } from "./state.js";

export const GAME_MCP_SERVER_NAME = "gioco";
// Nome qualificato da mettere in allowedTools.
export const CERCA_CRONOLOGIA_TOOL = `mcp__${GAME_MCP_SERVER_NAME}__cerca_cronologia`;

export const gameMcpServer = createSdkMcpServer({
  name: GAME_MCP_SERVER_NAME,
  version: "0.1.0",
  tools: [
    tool(
      "cerca_cronologia",
      "Cerca negli eventi passati della partita (cronologia.md) per parola chiave. " +
        "Usalo SOLO se ti serve capire cosa è successo nei turni precedenti oltre al recap dell'ultimo turno. " +
        "Ritorna i blocchi-turno che contengono i termini cercati.",
      { query: z.string().describe("parole chiave da cercare negli eventi passati") },
      async (args) => {
        const result = await searchCronologia(args.query);
        return { content: [{ type: "text", text: result }] };
      }
    ),
  ],
});
