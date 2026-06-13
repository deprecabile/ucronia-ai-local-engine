// Stato di gioco: il backend è l'unico proprietario della cartella game/.
// Legge i 4 file markdown, scrive gli snapshot (movimento/nazione/attori) in modo
// atomico e accoda gli eventi a cronologia.md. Gli agenti non toccano mai i file:
// restituiscono testo/dati e qui si fa l'I/O, così la chat non vede mai le scritture.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// game/ vive nella root del progetto (../../.. da backend/src/game/).
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAME_DIR =
  process.env.GAME_DIR ?? path.resolve(HERE, "../../../game");

export interface GameState {
  movimento: string;
  nazione: string;
  attori: string;
  cronologia: string;
}

export interface ChronicleBlock {
  arcoDate: string; // es. "mar–set 1920" oppure "15 mag 1921"
  titolo: string;
  eventi: { data: string; testo: string }[];
}

const FILES = {
  movimento: "movimento.md",
  nazione: "nazione.md",
  attori: "attori.md",
  cronologia: "cronologia.md",
  ultimoTurno: "_ultimo_turno.md",
} as const;

export async function loadState(dir: string = GAME_DIR): Promise<GameState> {
  const [movimento, nazione, attori, cronologia] = await Promise.all([
    readFile(path.join(dir, FILES.movimento), "utf8"),
    readFile(path.join(dir, FILES.nazione), "utf8"),
    readFile(path.join(dir, FILES.attori), "utf8"),
    readFile(path.join(dir, FILES.cronologia), "utf8"),
  ]);
  return { movimento, nazione, attori, cronologia };
}

// Scrittura atomica: scrive su file temporaneo e poi rinomina (evita file a metà
// se due turni si sovrapponessero o il processo cadesse a metà write).
async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

export async function writeSnapshots(
  snapshots: { movimento: string; nazione: string; attori: string },
  dir: string = GAME_DIR
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeAtomic(path.join(dir, FILES.movimento), ensureTrailingNewline(snapshots.movimento)),
    writeAtomic(path.join(dir, FILES.nazione), ensureTrailingNewline(snapshots.nazione)),
    writeAtomic(path.join(dir, FILES.attori), ensureTrailingNewline(snapshots.attori)),
  ]);
}

// Append puro (zero token): formatta il blocco di turno e lo accoda a cronologia.md.
// Non riscrive mai la storia già presente.
export async function appendCronologia(
  block: ChronicleBlock,
  dir: string = GAME_DIR
): Promise<void> {
  const file = path.join(dir, FILES.cronologia);
  const current = await readFile(file, "utf8");
  const lines = [
    `## ${block.arcoDate} — «${block.titolo}»`,
    ...block.eventi.map((e) => `**${e.data}** — ${e.testo}`),
  ];
  const sep = current.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(file, current + sep + lines.join("\n") + "\n", "utf8");
}

// Recap dell'ultimo turno: il backend lo scrive a fine turno (da codice, zero token
// extra) e gli agenti lo ricevono sempre nel contesto. Sostituisce la lettura
// dell'intera cronologia.md, che cresce a centinaia di blocchi.
export async function writeUltimoTurno(
  block: ChronicleBlock,
  esitoIntegrato: string,
  dataCorrente: string,
  dir: string = GAME_DIR
): Promise<void> {
  const lines = [
    `# Ultimo turno`,
    ``,
    `**Data di gioco ora:** ${dataCorrente}`,
    `**Arco appena giocato:** ${block.arcoDate} — «${block.titolo}»`,
    ``,
    `## Cosa è successo (esito integrato)`,
    esitoIntegrato.trim(),
    ``,
    `## Eventi chiave del turno`,
    ...block.eventi.map((e) => `- **${e.data}** — ${e.testo}`),
    ``,
    `> Questo è solo il recap dell'ultimo turno. Per fatti più vecchi, usa lo strumento \`cerca_cronologia\`.`,
  ];
  await writeAtomic(path.join(dir, FILES.ultimoTurno), lines.join("\n") + "\n");
}

export async function loadUltimoTurno(dir: string = GAME_DIR): Promise<string> {
  try {
    return await readFile(path.join(dir, FILES.ultimoTurno), "utf8");
  } catch {
    return "(Nessun turno giocato finora: è l'inizio della partita.)";
  }
}

// Ricerca testuale in cronologia.md: ritorna i blocchi-turno (## ...) che contengono
// almeno uno dei termini della query. Read-only, esposta agli agenti come tool.
export async function searchCronologia(
  queryText: string,
  dir: string = GAME_DIR
): Promise<string> {
  const cronologia = await readFile(path.join(dir, FILES.cronologia), "utf8");
  const terms = queryText
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return "(query troppo generica: usa parole chiave specifiche)";

  // Spezza in blocchi di turno: ogni blocco inizia con un "## " (tranne il preludio H1).
  const blocks = cronologia.split(/\n(?=## )/);
  const hits = blocks.filter((b) => {
    const low = b.toLowerCase();
    return terms.some((t) => low.includes(t));
  });
  if (hits.length === 0) return `(nessun evento trovato per: ${queryText})`;
  // Limita per non gonfiare il contesto.
  const MAX = 12;
  const shown = hits.slice(0, MAX).join("\n\n");
  const extra = hits.length > MAX ? `\n\n(…e altri ${hits.length - MAX} blocchi non mostrati: affina la ricerca)` : "";
  return shown + extra;
}

// Estrae la data di gioco dal campo "**Data corrente:**" di movimento.md.
export function currentDate(state: GameState): string {
  const m = state.movimento.match(/\*\*Data corrente:\*\*\s*(.+)/);
  return m?.[1]?.trim() ?? "data sconosciuta";
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}
