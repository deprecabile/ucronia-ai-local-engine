// Carica a runtime i prompt degli agenti dai file .md in prompt/ (root del progetto).
// I prompt sono testo editabile (come il regolamento), non codice: si modificano
// senza ricompilare.
//
// Composizione: ogni agente-GM riceve  common (meccanica) + scenario (ambientazione)
// + slice di fase. L'ambientazione vive TUTTA in scenario.md: per ambientare il gioco
// altrove si riscrive solo quel file, non i prompt degli agenti.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR =
  process.env.PROMPT_DIR ?? path.resolve(HERE, "../../../prompt");

function load(name: string): string {
  return readFileSync(path.join(PROMPT_DIR, `${name}.md`), "utf8");
}

// Letti una volta all'avvio (sincroni: è bootstrap, non hot-path).
const common = load("common");
const scenario = load("scenario");
const advisor = load("advisor");
const arbitro = load("arbitro");
const attore = load("attore");
const storico = load("storico");
const integratore = load("integratore");
const giornalista = load("giornalista");
const snapshot = load("snapshot");

// Anteponi la meccanica comune a un prompt di fase.
function withCommon(slice: string): string {
  return `${common}\n\n---\n\n${slice}`;
}

// Anteponi lo scenario (ambientazione) a un prompt già composto.
function withScenario(slice: string): string {
  return `${scenario}\n\n---\n\n${slice}`;
}

// Agenti-GM: meccanica comune + scenario + slice di fase.
function gm(slice: string): string {
  return withScenario(withCommon(slice));
}

export const prompts = {
  // Il consulente NON usa il preludio-meccanica GM, ma ha bisogno dell'ambientazione.
  advisor: withScenario(advisor),
  // Agenti-GM: meccanica + scenario + slice di fase.
  arbitro: gm(arbitro),
  attore: gm(attore),
  storico: gm(storico),
  integratore: gm(integratore),
  giornalista: gm(giornalista),
  snapshot: gm(snapshot),
  common,
} as const;
