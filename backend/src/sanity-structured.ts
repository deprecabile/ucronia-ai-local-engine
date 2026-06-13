// Sanity check #2: verifica che lo STRUCTURED OUTPUT (options.outputFormat)
// e un systemPrompt stringa (custom, niente preset Claude Code) funzionino.
// Questo è il rischio tecnico principale del motore di gioco: se
// result.structured_output non arriva popolato, gli agenti che modificano lo
// stato dovranno usare il fallback "JSON in blocco delimitato".
//
// Run con: npm run sanity:structured
import { query } from "@anthropic-ai/claude-agent-sdk";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    capitale: { type: "string" },
    popolazione_milioni: { type: "number" },
    confina_con: { type: "array", items: { type: "string" } },
  },
  required: ["capitale", "popolazione_milioni", "confina_con"],
} as const;

async function main() {
  console.log("[sanity2] query con outputFormat json_schema + systemPrompt stringa…");

  const response = query({
    prompt:
      "Dammi i dati essenziali dell'Italia (capitale, popolazione in milioni approssimata, stati confinanti).",
    options: {
      allowedTools: [],
      includePartialMessages: true,
      maxTurns: 6,
      // systemPrompt come STRINGA: deve dare un prompt totalmente custom,
      // senza il preset di Claude Code.
      systemPrompt:
        "Sei un atlante geografico conciso. Rispondi solo con i dati richiesti, in italiano.",
      // STRUCTURED OUTPUT nativo dell'SDK 0.3.x.
      outputFormat: { type: "json_schema", schema },
    },
  });

  let sessionId: string | undefined;

  for await (const message of response) {
    const subtype = (message as { subtype?: string }).subtype;
    console.log(`[msg] type=${message.type}${subtype ? ` subtype=${subtype}` : ""}`);

    if (!sessionId && "session_id" in message && message.session_id) {
      sessionId = message.session_id;
    }

    if (message.type === "result") {
      const m = message as any;
      console.log("\n[sanity2] result.subtype:", m.subtype);
      console.log("[sanity2] result.result (testo):", JSON.stringify(m.result));
      console.log(
        "[sanity2] result.structured_output:",
        JSON.stringify(m.structured_output, null, 2)
      );

      if (m.subtype !== "success") {
        throw new Error(`[sanity2] result subtype != success: ${m.subtype}`);
      }
      if (m.structured_output == null) {
        console.warn(
          "\n[sanity2] ⚠️  structured_output è VUOTO → serve il fallback JSON-in-blocco."
        );
      } else {
        console.log("\n[sanity2] ✅  structured_output popolato: l'approccio nativo funziona.");
      }
    }
  }
}

main().catch((err) => {
  console.error("[sanity2] FAILED:", err);
  process.exit(1);
});
