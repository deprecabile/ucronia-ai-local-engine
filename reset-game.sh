#!/usr/bin/env bash
# Reset dei file di gioco allo stato iniziale (turno 0 dello scenario).
#
# Lo stato di partenza autorevole vive nell'archivio `game_initial_status.zip`
# (nella root del progetto): contiene i quattro snapshot movimento/nazione/attori/
# cronologia.md così come erano al turno 0. Questo script li estrae in `game/`,
# sovrascrivendo la partita in corso, e rimuove il recap derivato `_ultimo_turno.md`
# (lo rigenera il backend a fine turno).
#
# Uso:  ./reset-game.sh [--force]
#   senza --force chiede conferma, perché sovrascrive la partita in corso.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

ZIP=game_initial_status.zip
GAME_DIR=game
# Nomi dei file COSÌ COME COMPAIONO NELL'ARCHIVIO (alla radice dello zip, senza
# prefisso game/). Vengono estratti dentro GAME_DIR/.
GAME_FILES=(movimento.md nazione.md attori.md cronologia.md)
RECAP=game/_ultimo_turno.md
CHAT=game/chat_history.json

# Verifica che l'archivio sorgente esista.
if [[ ! -f "$ZIP" ]]; then
  echo "Errore: archivio '$ZIP' non trovato nella root del progetto." >&2
  echo "È lì che vive lo stato iniziale (turno 0)." >&2
  exit 1
fi

# Serve unzip.
if ! command -v unzip >/dev/null 2>&1; then
  echo "Errore: 'unzip' non disponibile sul PATH." >&2
  exit 1
fi

# Verifica che l'archivio contenga davvero i quattro file attesi (alla radice).
listing="$(unzip -Z1 "$ZIP")"
for f in "${GAME_FILES[@]}"; do
  if ! grep -qxF "$f" <<<"$listing"; then
    echo "Errore: '$f' assente in '$ZIP' (o non alla radice dell'archivio)." >&2
    echo "Contenuto dell'archivio:" >&2
    echo "$listing" >&2
    exit 1
  fi
done

# Conferma, a meno di --force.
if [[ "${1:-}" != "--force" ]]; then
  echo "Sto per RIPRISTINARE la partita al turno 0 (stato iniziale) da '$ZIP'."
  echo "Verranno sovrascritti in $GAME_DIR/: ${GAME_FILES[*]}"
  echo "e cancellati il recap ($RECAP) e lo storico chat ($CHAT)"
  read -r -p "Procedo? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Annullato."; exit 0; }
fi

# Estrae gli snapshot dallo stato iniziale dentro game/.
#   -o  sovrascrive senza chiedere
#   -j  ignora i path interni (i file finiscono direttamente in GAME_DIR/)
#   -d  cartella di destinazione
mkdir -p "$GAME_DIR"
unzip -o -j "$ZIP" "${GAME_FILES[@]}" -d "$GAME_DIR" >/dev/null

# Rimuove il recap derivato (è in .gitignore: il backend lo rigenera a fine turno).
rm -f "$RECAP"

# Svuota lo storico chat: nuova partita = transcript vuoto (il backend lo ricrea
# al primo turno con append).
rm -f "$CHAT"

echo "✅ Partita riportata al turno 0 (stato iniziale)."
