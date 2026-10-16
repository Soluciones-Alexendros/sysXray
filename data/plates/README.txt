Placas (Plate JSON)
===================

Formato: ver SPECLinkML-sysXray.txt y DATA-CONTRACT.md §5.

Ingestar una captura local (no se sube a GitHub si es role=capture):

  ls -la "$HOME" > /tmp/home-ls.txt
  node build/plate-ingest.js --instrument sh_ls --regime live /tmp/home-ls.txt

Publicado en el repo:
  - index.json          lista para la mesa
  - fixture-*.json      demos sin datos personales
  - capturas reales     gitignored (data/plates/* salvo excepciones del .gitignore)
