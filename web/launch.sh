#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
PORT="${1:-8000}"

echo "desplantar-auditoria — visor"
echo "Raíz servida: $ROOT"
echo "Abre:         http://localhost:$PORT/web/"
echo "Detén con:    Ctrl+C"
echo

cd "$ROOT"
exec python3 -m http.server "$PORT"
