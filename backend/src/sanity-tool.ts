// Sanity check #3: verifica che un tool MCP in-process (createSdkMcpServer + tool)
// venga effettivamente INVOCATO dal modello, e che il suo
// risultato torni nel flusso. È il prerequisito per il tool read-only
// `cerca_cronologia` che daremo agli agenti di gioco.
//
// Run con: npm run sanity:tool
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

let toolWasCalled = false;

const server = createSdkMcpServer({
  name: "gioco",
  version: "0.0.1",
  tools: [
    tool(
      "cerca_cronologia",
      "Cerca eventi passati della partita per parola chiave. Usalo se devi capire cosa è successo prima.",
      { query: z.string().describe("parola chiave da cercare") },
      async (args) => {
        toolWasCalled = true;
        console.log(`\n[tool] cerca_cronologia(query=${JSON.stringify(args.query)}) invocato`);
        // Dato fittizio: solo per provare il round-trip.
        return {
          content: [
            {
              type: "text",
              text:
                "Risultati per «" +
                args.query +
                "»:\n**mar 1921** — il movimento fonda il suo primo quotidiano regionale.",
            },
          ],
        };
      }
    ),
  ],
});

async function main() {
  console.log("[sanity3] query con tool MCP in-process…");
  const response = query({
    prompt:
      "Quando il movimento ha fondato il suo primo quotidiano? Usa lo strumento cerca_cronologia per scoprirlo, poi rispondimi in una frase.",
    options: {
      systemPrompt:
        "Sei l'archivista della partita. Quando ti servono fatti del passato, usa lo strumento cerca_cronologia.",
      mcpServers: { gioco: server },
      // Va abilitato il tool col nome qualificato mcp__<server>__<tool>.
      allowedTools: ["mcp__gioco__cerca_cronologia"],
      includePartialMessages: true,
      maxTurns: 6,
    },
  });

  for await (const message of response) {
    const subtype = (message as { subtype?: string }).subtype;
    if (message.type === "result") {
      const m = message as any;
      console.log(`\n[sanity3] result.subtype: ${m.subtype}`);
      console.log("[sanity3] testo:", JSON.stringify(m.result));
      if (m.subtype !== "success") throw new Error(`result subtype != success: ${m.subtype}`);
    } else if (message.type === "stream_event") {
      // Delta di testo: in questo sanity non interessa il contenuto, solo che il
      // tool venga invocato (toolWasCalled), quindi li ignoriamo.
    } else {
      console.log(`[msg] type=${message.type}${subtype ? ` subtype=${subtype}` : ""}`);
    }
  }

  console.log(
    toolWasCalled
      ? "\n[sanity3] ✅  il tool è stato invocato: i tool MCP in-process funzionano."
      : "\n[sanity3] ⚠️  il tool NON è stato invocato (il modello non l'ha usato)."
  );
}

main().catch((err) => {
  console.error("[sanity3] FAILED:", err);
  process.exit(1);
});
