// Sanity check: confirms SDK -> claude CLI works,
// and prints the message `type`/`subtype` observed on the installed 0.3.x SDK.
// Run with: npm run sanity
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("[sanity] starting query…");
  const response = query({
    prompt: "Rispondi solo con: pong. Poi una frase brevissima per confermare che funzioni.",
    options: {
      allowedTools: [],
      includePartialMessages: true,
    },
  });

  let sessionId: string | undefined;
  let text = "";

  for await (const message of response) {
    // Log a compact summary of every message type/subtype we observe.
    const subtype = (message as { subtype?: string }).subtype;
    console.log(`[msg] type=${message.type}${subtype ? ` subtype=${subtype}` : ""}`);

    if (!sessionId && "session_id" in message && message.session_id) {
      sessionId = message.session_id;
      console.log(`[sanity] session_id=${sessionId}`);
    }

    if (message.type === "stream_event") {
      const ev = message.event as any;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        process.stdout.write(ev.delta.text);
        text += ev.delta.text;
      }
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          // Full text already streamed via stream_event; this is the fallback path.
        }
      }
    } else if (message.type === "result") {
      console.log("\n[sanity] result:", JSON.stringify(message, null, 2).slice(0, 600));
      if (message.subtype !== "success") {
        throw new Error(`[sanity] result subtype != success: ${message.subtype}`);
      }
    }
  }

  console.log(`\n[sanity] OK — collected ${text.length} chars of streamed text.`);
}

main().catch((err) => {
  console.error("[sanity] FAILED:", err);
  process.exit(1);
});
