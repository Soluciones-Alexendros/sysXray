#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
PORT="${1:-8000}"

echo "sysXray — mesa"
echo "Raíz servida: $ROOT"
echo "Abre:         http://localhost:$PORT/web/"
echo "Árbol:        http://localhost:$PORT/web/tree.html"
echo "Placas:       http://localhost:$PORT/web/plates.html"
echo "Detén con:    Ctrl+C"
echo

cd "$ROOT"
exec python3 -m http.server "$PORT"
