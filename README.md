# sysXray

Radiografía de un ordenador doméstico. El haz mira; no reescribe el arranque.

Para **Daniel Domingo Benito**, que pedía callar porque no quería saber nada de ordenadores.

## Tres pasos

1. **Abre la mesa**
   ```bash
   web/launch.sh
   # http://localhost:8000/web/
   ```
2. **Mete una placa** (sin reinicio)
   ```bash
   ls -la "$HOME" > /tmp/home-ls.txt
   node build/plate-ingest.js --instrument sh_ls --regime live /tmp/home-ls.txt
   ```
   Luego recarga **Placas y juicios** en la mesa.
3. **Lee el juicio de `/bin`** (hier dice directorio, UAPI dice enlace) y el dossier de Secure Boot.

Dossier publicado: https://soluciones-alexendros.github.io/sysXray/

| Pieza | Ruta |
|-------|------|
| Mesa | [`web/index.html`](web/index.html) |
| Contrato | [`SPECLinkML-sysXray.txt`](SPECLinkML-sysXray.txt) |
| Contraste | [`docs/contraste-fuentes.json`](docs/contraste-fuentes.json) |
| Juicios `/bin` | [`data/judgments/`](data/judgments/) |

## Taller (opcional)

```bash
node tests/run.js
# volcado privado del árbol:
node --max-old-space-size=6144 build/build.js /ruta/a/desplantar.md .
# validar ficha LinkML:
export PYSTOW_HOME="$PWD/.pystow"
.venv/bin/linkml-validate -s schema/sysxray.yaml -C CanonFicha docs/fhs-3.0.json
```

`data/tree/` y los informes con rutas de home **no** se publican. Las capturas `role: capture` quedan en local (gitignore).

## Licencias citadas

Solo enlaces: FHS 3.0, hier(7), UAPI.9, XDG, GNU GRUB, Red Hat RHEL 9, kernel_lockdown(7). Ver `docs/*.json`.
