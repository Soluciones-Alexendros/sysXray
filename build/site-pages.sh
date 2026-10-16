#!/usr/bin/env bash
# Rebuild static dossier for GitHub Pages into site/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
mkdir -p "$SITE"
rm -f "$SITE"/*.json "$SITE"/*.md "$SITE"/SPECLinkML-sysXray.txt "$SITE"/index.html 2>/dev/null || true
cp "$ROOT"/docs/*.json "$SITE/"
cp "$ROOT"/docs/nucleo.md "$ROOT"/docs/fase-antiguo.md "$SITE/"
cp "$ROOT"/SPECLinkML-sysXray.txt "$SITE/"
sed \
  -e 's|href="../docs/|href="./|g' \
  -e 's|href="../SPECLinkML-sysXray.txt"|href="./SPECLinkML-sysXray.txt"|g' \
  -e 's|href="../schema/sysxray.yaml"|href="https://github.com/Soluciones-Alexendros/sysXray/blob/main/schema/sysxray.yaml"|g' \
  "$ROOT/LinkML/LinkML.html" > "$SITE/index.html"
echo "site/ ready ($(ls "$SITE" | wc -l) files)"
