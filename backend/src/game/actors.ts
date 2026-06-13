// Estrazione delle schede-attore da attori.md.
//
// attori.md è organizzato in gruppi (# H1), sottosezioni (## H2) e una scheda per
// attore (### H3) chiusa dalla riga "---". Per la Fase 2.2 ogni agente-Attore riceve
// SOLO la propria scheda (contesto ristretto): qui la si ritaglia per nome.

export interface ActorCard {
  nome: string; // testo dell'intestazione ### (senza il "### ")
  testo: string; // la scheda completa, intestazione inclusa
}

// Divide attori.md nelle singole schede ### (ignora H1/H2 e il testo libero).
export function parseActorCards(attoriMd: string): ActorCard[] {
  const lines = attoriMd.split("\n");
  const cards: ActorCard[] = [];
  let curName: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (curName !== null) {
      // togli un eventuale separatore "---" finale e le righe vuote di coda
      for (let last = buf[buf.length - 1]; last !== undefined; last = buf[buf.length - 1]) {
        const t = last.trim();
        if (t !== "" && t !== "---") break;
        buf.pop();
      }
      cards.push({ nome: curName, testo: buf.join("\n").trim() });
    }
  };

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      flush();
      curName = (h3[1] ?? "").trim();
      buf = [line];
    } else if (curName !== null) {
      buf.push(line);
    }
  }
  flush();
  return cards;
}

// Trova la scheda di un attore per nome (match esatto, poi case-insensitive,
// infine per inclusione — l'Arbitro dovrebbe dare il nome esatto dell'H3).
export function findActorCard(attoriMd: string, nome: string): ActorCard | null {
  const cards = parseActorCards(attoriMd);
  const target = nome.trim().toLowerCase();
  return (
    cards.find((c) => c.nome.toLowerCase() === target) ??
    cards.find((c) => c.nome.toLowerCase().includes(target)) ??
    cards.find((c) => target.includes(c.nome.toLowerCase())) ??
    null
  );
}
