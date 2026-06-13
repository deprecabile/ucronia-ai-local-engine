#!/usr/bin/env bash
# Avvia backend (porta 8088) e frontend (porta 5173) insieme.
# I log di entrambi vengono mostrati in console in tempo reale, prefissati
# con [backend] / [frontend]. Ctrl+C ferma entrambi (e i loro sottoprocessi).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8088}"

# Assicura che la CLI `claude` sia sul PATH (in questo ambiente serve ~/.bashrc).
if ! command -v claude >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  source ~/.bashrc 2>/dev/null || true
fi

# Prefissa ogni riga di stdin con un'etichetta.
prefix() {
  local tag="$1"
  while IFS= read -r line; do
    printf '%s %s\n' "$tag" "$line"
  done
}

backend_pid=""
frontend_pid=""

cleanup() {
  trap '' INT TERM            # evita doppi ingressi nel cleanup
  echo
  echo "[start] arresto in corso…"
  # setsid rende ogni servizio leader del proprio process group (PGID == PID),
  # quindi kill su -PID termina npm + tsx/vite e tutti i figli.
  for pid in "$backend_pid" "$frontend_pid"; do
    [ -n "$pid" ] && kill -TERM -- -"$pid" 2>/dev/null
  done
  sleep 1
  for pid in "$backend_pid" "$frontend_pid"; do
    [ -n "$pid" ] && kill -KILL -- -"$pid" 2>/dev/null
  done
  echo "[start] fermato."
  exit 0
}
trap cleanup INT TERM

echo "[start] backend  -> http://localhost:${PORT}  (ws ws://localhost:${PORT})"
echo "[start] frontend -> http://localhost:5173"
echo "[start] Ctrl+C per fermare entrambi."
echo

# Process substitution: il job in background è il `setsid`, quindi $! ne è il PID
# (e, essendo session leader, anche il PGID). L'output passa per prefix in tempo reale.
setsid bash -c "cd '$ROOT/backend' && PORT='$PORT' exec npm run dev" \
  > >(prefix "[backend] ") 2>&1 &
backend_pid=$!

setsid bash -c "cd '$ROOT/frontend' && exec npm run dev" \
  > >(prefix "[frontend]") 2>&1 &
frontend_pid=$!

# Attendi finché entrambi terminano (o Ctrl+C, gestito da cleanup).
wait
