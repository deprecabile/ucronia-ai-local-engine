// JSON Schema per l'output strutturato di ogni agente che produce dati.
// (Il Giornalista NON usa schema: streamma gli articoli a partire dalla timeline
//  già strutturata prodotta dall'Integratore — vedi turn.ts.)

// Arbitro: valutazione azioni (Fase 1) + collocazione temporale nella finestra
// (le azioni si spalmano nell'arco) + selezione attori (Fase 2.1).
export const arbitroSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    finestra: {
      // Arco temporale risolto dell'avanzamento: fonte unica condivisa con
      // Storico e Integratore per allineare tutte le date del turno.
      type: "object",
      additionalProperties: false,
      properties: {
        arco: { type: "string" },
      },
      required: ["arco"],
    },
    azioni: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ordine: { type: "string" },
          esito: { type: "string", enum: ["✅", "⚠️", "❌"] },
          // Collocazione dell'azione DENTRO la finestra (es. "prima settimana",
          // "inizio maggio"): serve a spalmarla nel tempo, non a risolverla "il primo giorno".
          collocazione: { type: "string" },
          spiegazione: { type: "string" },
          conseguenze: { type: "string" },
        },
        required: ["ordine", "esito", "collocazione", "spiegazione", "conseguenze"],
      },
    },
    attoriSelezionati: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nome: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["nome", "motivo"],
      },
    },
  },
  required: ["finestra", "azioni", "attoriSelezionati"],
} as const;

export interface ArbitroOutput {
  finestra: { arco: string };
  azioni: {
    ordine: string;
    esito: string;
    collocazione: string;
    spiegazione: string;
    conseguenze: string;
  }[];
  attoriSelezionati: { nome: string; motivo: string }[];
}

// Agente-Attore: mini-simulazione di un singolo attore (Fase 2.2).
export const attoreSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    attore: { type: "string" },
    orizzonte: { type: "string" },
    mosse: { type: "array", items: { type: "string" } },
    comunicazione: { type: "string" },
    reazioneAlMovimento: { type: "string" },
  },
  required: ["attore", "orizzonte", "mosse", "comunicazione", "reazioneAlMovimento"],
} as const;

export interface AttoreOutput {
  attore: string;
  orizzonte: string;
  mosse: string[];
  comunicazione: string;
  reazioneAlMovimento: string;
}

// Agente-Storico (Fase 2.5): eventi reali del periodo delle nazioni/fazioni NON
// simulate, già corretti per l'Effetto Farfalla (possono saltare, anticiparsi o
// ritardare in base a cosa è successo nella partita). `scostamento` annota la deviazione.
export const storicoSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    eventiStorici: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          data: { type: "string" },
          testo: { type: "string" },
          scostamento: { type: "string" },
        },
        required: ["data", "testo", "scostamento"],
      },
    },
  },
  required: ["eventiStorici"],
} as const;

export interface StoricoOutput {
  eventiStorici: { data: string; testo: string; scostamento: string }[];
}

// Integratore (Fase 2.6): fonde azioni del giocatore + mosse degli attori +
// eventi storici in UNA timeline datata coerente ("il calderone"), e produce i
// dati di fine turno per la memoria di gioco. Output strutturato → niente più
// estrazione regex di un blocco testuale.
export const integratoreSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dataCorrente: { type: "string" },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          data: { type: "string" },
          testo: { type: "string" },
          fonte: {
            type: "string",
            enum: ["giocatore", "attore", "storico", "integrazione"],
          },
          // Solo per gli eventi con fonte "giocatore": l'esito dell'azione, ripreso
          // dalla valutazione dell'Arbitro, così il Giornalista può mostrare l'icona
          // nell'intestazione senza doverlo dedurre dal testo. Assente sugli altri.
          esito: { type: "string", enum: ["✅", "⚠️", "❌"] },
        },
        required: ["data", "testo", "fonte"],
      },
    },
    esitoIntegrato: { type: "string" },
    scoperteProssimoTurno: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          attore: { type: "string" },
          cosaScopre: { type: "string" },
        },
        required: ["attore", "cosaScopre"],
      },
    },
    cronologia: {
      type: "object",
      additionalProperties: false,
      properties: {
        arcoDate: { type: "string" },
        titolo: { type: "string" },
        eventi: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              data: { type: "string" },
              testo: { type: "string" },
            },
            required: ["data", "testo"],
          },
        },
      },
      required: ["arcoDate", "titolo", "eventi"],
    },
  },
  required: ["dataCorrente", "timeline", "esitoIntegrato", "scoperteProssimoTurno", "cronologia"],
} as const;

export interface IntegratoreOutput {
  dataCorrente: string;
  timeline: { data: string; testo: string; fonte: string; esito?: string }[];
  esitoIntegrato: string;
  scoperteProssimoTurno: { attore: string; cosaScopre: string }[];
  cronologia: {
    arcoDate: string;
    titolo: string;
    eventi: { data: string; testo: string }[];
  };
}

// (Lo Snapshotter NON usa schema: gira come 3 agenti paralleli, uno per file,
//  e ciascuno restituisce il file come testo grezzo — vedi turn.ts.)
