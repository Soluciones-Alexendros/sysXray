schema/sysxray.yaml — fuente LinkML del sobre (Plate, CanonFicha, …).
schema/sysxray.schema.json — generado desde el YAML (commiteado).

Pin de desarrollo: linkml==1.12.1 (requirements-dev.txt).
Python de este equipo: 3.14.4. PYSTOW_HOME debe apuntar a un directorio
escribible (p. ej. .pystow/ dentro del repo; está en .gitignore).

Regenerar:
  python3 -m venv .venv
  .venv/bin/pip install -r requirements-dev.txt
  export PYSTOW_HOME="$PWD/.pystow"
  mkdir -p .pystow
  .venv/bin/linkml generate json-schema --closed -t Plate schema/sysxray.yaml \
    > schema/sysxray.schema.json

Validar (ejemplos):
  export PYSTOW_HOME="$PWD/.pystow"
  .venv/bin/linkml-validate -s schema/sysxray.yaml -C Plate \
    tests/fixtures/plates/tree-bin-link.json
  .venv/bin/linkml-validate -s schema/sysxray.yaml -C CanonFicha \
    docs/secure-boot-lockdown.json

node tests/run.js no pide Python ni LinkML.

Fichas CanonFicha: docs/*.json (is_a Authority), integrables como Authority
en juicios. Incluyen trazabilidad de contraste: source_checked_at,
source_http_status, contrast_verdict, secondary_urls, local_witness.
Informe: docs/contraste-fuentes.json.
