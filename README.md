# sysXray

Radiografía de un ordenador doméstico: placas de observación (instrumento + horizonte),
cánones citados como JSON LinkML (`CanonFicha`), y un visor del árbol reconstruido a
partir de un volcado `tree` — sin reescribir el arranque.

Dedicado a **Daniel Domingo Benito**, que pedía callar porque no quería saber nada de
ordenadores.

| Pieza | Ruta |
|-------|------|
| Contrato | [`SPECLinkML-sysXray.txt`](SPECLinkML-sysXray.txt) |
| Dossier | [`LinkML/LinkML.html`](LinkML/LinkML.html) |
| Esquema | [`schema/sysxray.yaml`](schema/sysxray.yaml) |
| Núcleo | [`docs/nucleo.md`](docs/nucleo.md) |
| Contraste de fuentes | [`docs/contraste-fuentes.json`](docs/contraste-fuentes.json) |
| Auditoría FHS (pública) | [`data/audit-fhs-public.json`](data/audit-fhs-public.json) |

## Qué publica este repo

- Método, esquema LinkML, ocho fichas de canon, informe de contraste.
- Código del pipeline (`build/`), visor (`web/`), tests (`tests/`).
- Manifest y resumen KB. **No** se publica `data/tree/` (chunks del volcado personal)
  ni los informes con rutas de home (`audit-report.json`, `symlink-report.json`).

Para reconstruir los TSV en privado:

```bash
node --max-old-space-size=6144 build/build.js /ruta/a/tu/desplantar.md .
```

## Tests

```bash
node tests/run.js
```

Sin dependencias de ejecución. Opcional (desarrollo): `requirements-dev.txt` (`linkml==1.12.1`).

Validar una ficha:

```bash
export PYSTOW_HOME="$PWD/.pystow"
.venv/bin/linkml-validate -s schema/sysxray.yaml -C CanonFicha docs/fhs-3.0.json
```

## Visor (con `data/tree/` local)

```bash
web/launch.sh   # http://localhost:8000/web/
```

## Licencias de estándares citados

Solo se enlazan (no se copian): FHS 3.0, hier(7), UAPI.9, XDG Base Directory,
manual GNU GRUB, documentación Red Hat RHEL 9, kernel_lockdown(7). Ver cada
`docs/*.json` → `source_url`.

## Historia del pipeline

El núcleo de parseo TSV / symlinks / auditoría FHS se documenta también en
[`DATA-CONTRACT.md`](DATA-CONTRACT.md) (nombre histórico: desplantar-auditoria).
