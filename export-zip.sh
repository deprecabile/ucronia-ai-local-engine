#!/usr/bin/env bash
# Esporta il progetto in un .zip portabile, pronto da importare su un altro PC.
#
# Esclude tutto ciò che si rigenera o è specifico di questa macchina:
#   - .git/                  cronologia git (pesante, non serve per importare)
#   - node_modules/          dipendenze (si reinstallano con npm install)
#   - dist/ build/ *.tsbuildinfo   output di build
#   - *.log                  log
#   - .env / .env.*          segreti (tranne .env.example)
#   - .claude/settings.local.json  settings locali di Claude (machine-specific)
#   - game/_ultimo_turno.md  recap derivato (lo rigenera il backend a fine turno)
#
# Tiene invece: codice, package.json/lockfile, prompt/, stato di gioco game/*.md,
# script (start.sh, reset-game.sh), README. Sul nuovo PC basta `npm install` in
# backend/ e frontend/ (vedi README) per ripartire.
#
# Uso:  ./export-zip.sh [nome-output.zip]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "$REPO_ROOT")"
OUT="${1:-${PROJECT_NAME}.zip}"

# Path assoluto dell'output, così resta valido anche lanciando da dentro la dir.
case "$OUT" in
  /*) OUT_ABS="$OUT" ;;
  *)  OUT_ABS="$(pwd)/$OUT" ;;
esac

cd "$REPO_ROOT"

# Riparti da zero se l'archivio esiste già (zip altrimenti fa append).
rm -f "$OUT_ABS"

# Si zippa la cartella di progetto dalla sua parent, così l'archivio contiene una
# cartella radice <PROJECT_NAME>/ e non un mucchio di file alla rinfusa.
cd "$REPO_ROOT/.."

zip -r -q "$OUT_ABS" "$PROJECT_NAME" \
  -x "$PROJECT_NAME/.git/*" \
     "*/node_modules/*" \
     "*/dist/*" \
     "*/build/*" \
     "*.tsbuildinfo" \
     "*.log" \
     "$PROJECT_NAME/.env" \
     "$PROJECT_NAME/.env.*" \
     "*/.claude/settings.local.json" \
     "$PROJECT_NAME/game/_ultimo_turno.md" \
     "*/.DS_Store"

SIZE="$(du -h "$OUT_ABS" | cut -f1)"
echo "✅ Esportato: $OUT_ABS ($SIZE)"
echo "   Sul nuovo PC: unzip, poi 'npm install' in backend/ e frontend/ (vedi README)."
