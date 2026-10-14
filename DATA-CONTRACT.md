# DATA-CONTRACT — desplantar-auditoria

Interfaz congelada entre las etapas del pipeline. **No cambiar sin actualizar este archivo.**

## 0. Fuente
- Dump: `/home/alexendros/Documentos/desplantar.md` (316 MB, 3.233.219 líneas).
- Es la salida de `tree` (con glifos `├── └── │` y `⇒` para symlinks) del **root `/`**.
- **Caveat mayor:** se generó *sin* `-a` → **no contiene NINGUNA entrada oculta** (0 nombres que empiezan por `.` en 3.233.218 registros). Faltan `.config`, `.cache`, `.local`, `.ssh`, `.bashrc`, `/etc/skel/.*`, `node_modules/.pnpm`, `.bun`, etc.
- El dump **no tiene metadatos**: sin tamaños, permisos, ni marca de fichero/directorio. Un nodo hoja sin hijos es ambiguo (fichero **o** directorio vacío) → se tipa `f` (limitación conocida).
- Recuentos verificados: entries 3.233.219 (root + 3.233.218), symlinks 114.265, dirs 305.975, files 2.812.979, top-level 26, unmatched 0.

## 1. `data/tree/chunk-<id>.tsv` (306 ficheros, ~98 MB)
Cabecera (1 línea):
```
#<id>\t<start>\t<end>\t<baseDepth>\t<parentPath>
```
Registros (`<depth>` = profundidad real del volcado; el nodo raíz `.` es depth −1 y NO se emite como registro):
```
<depth>\t<d|f|s>\t<name>\t<target>
```
- `d`=directorio, `f`=fichero (o dir vacío), `s`=symlink.
- `target` sólo para `s` (vacío en el resto).
- Nodo **lazy** (padre con subárbol > LIMIT=40000): su registro añade 2 campos:
```
<depth>\t<d>\t<name>\t\t<chunkIdsCSV>\t<childCount>
```
Ejemplo cabecera real: `#0\t1\t5393\t0\t/`; primeros registros: `0\ts\tbin\tusr/bin`, `0\td\tboot`, `1\tf\tconfig-7.0.0-34-generic`, `1\td\tefi`.
- Asunción: los nombres no contienen TAB ni salto de línea.
- Reparto top-level→chunk: bin/boot/cdrom/desplantar.md/dev/etc=chunk0; home=234(lazy); lib/lib32/lib64/libx32/lost+found/media/mnt/opt=235; proc=239(lazy); root/run/sbin=240; snap=258(lazy); srv/swap.img=259; sys=266(lazy); tmp=267; usr=291(lazy); var=305(lazy).

### Reconstrucción de rutas en el visor
Recorriendo los registros del chunk en orden:
```
stack = []            // nombre en cada profundidad
for each record r:
  parent = (r.depth === baseDepth) ? parentPath : stack[r.depth-1]
  path   = parent === '/' ? '/'+r.name : parent+'/'+r.name
  stack[r.depth] = path
  // índice global del nodo = start + offsetEnElChunk
```
Índice global → mapa de nodos lazy vía `manifest.chunks[id]`.

## 2. `data/manifest.json`
```
{
  source, generated,
  counts: { entries, symlinks, directories, files, unmatched, chunks, lazyNodes },
  topLevel: [ { name, type, target, index, lazy, childCount, chunks:[ids], chunk } ],  // 26
  chunks:   [ { id, start, end, baseDepth, parentPath, count } ]                       // 306
}
```

## 3. `data/symlink-report.json`
```
{
  stats: { total, ok, broken, brokenOculto, circular, pseudo },
  tagCount: { "merged-usr", "pseudo-fs", "systemd-enable", "bootloader", "efimero" },
  buckets: {
    broken:[{path,target,resolved}], brokenOculto:[...], circular:[...],
    pseudo:[{path,target}], mergedUsr:[...], systemdEnable:[...], candidates:[...]
  },
  linkCount
}
```
Interpretación de auditoría ya emitida: 1115 `broken` reales = Chrome Singleton (326, efímero por diseño) + alias SVG de snap gtk-common-themes (138) + internals de contenedores/overlayfs (containerd + Aplicaciones/datos/share/containers) + internals de snap + backups pre-hardening. **No** son anomalías de ubicación FHS. 2375 `brokenOculto` = falsos positivos por excluir el dump los directorios ocultos.

## 4. Salidas NUEVAS a producir
### 4.1 `web/kb-rules.js` (browser, sin build)  — subagente A
Debe exponer en `window`:
```
window.KB_TAXONOMY = [ {tag:'#fhs', label_es, color, descripcion}, ... ];
window.annotate = function(path, type, target) {
  return { hashtag, categoria, descripcion_corta_ES, enlaces:[{texto,url}] };
};
```
- Prioridad de reglas: **exact-path** → **directory-pattern** → **extension** → **top-level fallback**.
- Taxonomía: `#fhs #config #daemon #binario #biblioteca #kernel #dispositivo #datos-proceso #cache #log #datos-usuario #snap #anomalia-top #anomalia-symlink-roto #anomalia-symlink-circular #anomalia-ubicacion #anomalia-contenido #anomalia-candidato`.
- Español, tono usuario avanzado. Enlaces a Wikipedia/ArchWiki/freedesktop/manpages.
- Cubrir los 26 directorios raíz + patrones de `/etc`, `/usr`, `/var`, `/home`, `/snap`, `/boot`, `/opt`, `/srv`, `/run`, `/dev`, `/proc`, `/sys`, `/tmp`, `/root`.
- Entregar también `data/kb-summary.json`: anotación resuelta de los 26 top-level + conteo de reglas por categoría (lo consume audit.js e informe).

### 4.2 `build/audit.js` → `data/audit-report.json`  — subagente B
```
{
  generated, distro:'Ubuntu',
  fhs: { canonical:[14 nombres FHS 3.0], present:[], missing:[], nonCanonical:[{name,clase,comentario}] },
  mergedUsr: { ok:true, links:[...] },
  anomalies: [ { path, class, severity:'info|warn|error', message, link? } ],
  stats: { byClass:{...}, total }
}
```
Clases: `#anomalia-top`, `#anomalia-symlink-roto`, `#anomalia-symlink-circular`, `#anomalia-ubicacion`, `#anomalia-contenido`, `#anomalia-candidato`.
Conocidas: `cdrom` (mountpoint huérfano), `desplantar.md` (auto-inclusión del volcado en `/`), `swap.img` (normal Ubuntu), `snap` + `lost+found` (normales extra-FHS). Marcar kernel `7.0.0` como no estándar vs Ubuntu 6.x. Debe ser ejecutable con `node build/audit.js` leyendo manifest+symlink-report.

### 4.3 `web/` (visor)  — subagente C
`index.html`, `app.js`, `app.css`, `launch.sh`.
- Árbol **virtualizado**: solo nodos visibles + ventana ~500 en DOM; expandir un nodo lazy hace `fetch` del/los chunk(s) hijos.
- Buscador/filtros por nombre, tipo, hashtag y anomalía.
- Panel de detalle: hashtag, categoría, descripción, enlaces, ruta, tipo, target, línea, estado de auditoría.
- Dashboard inicial: 26 raíces con badges de color + contadores + aviso del caveat de ficheros ocultos.
- `launch.sh` arranca `python3 -m http.server 8000` (fetch requiere http, no file://).

### 4.4 `tests/` + `README.md`  — subagente D
- Tests de invariantes: recuentos del manifest, coherencia start/end/baseDepth de chunks, cabeceras TSV, resolución de symlinks conocidos, ramas del `annotate`.
- `README.md` en español: qué es, cómo se construyó, cómo se abre, caveat de ocultos, interpretación de la auditoría, arquitectura.

## 5. Sobre LinkML y placas (`data/plates/`)

Contrato normativo: `SPECLinkML-sysXray.txt`. Esquema: `schema/sysxray.yaml`.
Fichas de canon: `docs/*.json` (instancias `CanonFicha`, subclase de `Authority`).

### 5.1 `data/plates/`

Una captura real por fichero. Este contrato **no** inventa capturas: el operador
las deposita tras GRUB o `ls -la`.

Cabecera lógica (JSON Plate o texto con metadatos equivalentes):

- `id`, `role: capture`, `instrument`, `regime`, `captured_at`
- `horizons` (al menos uno)
- `body_uri` o cuerpo literal en el mismo fichero tras una línea `---`
- `statements` opcionales

Instrumentos admitidos: `tree`, `grub_ls`, `grub_cat`, `grub_hexdump`, `sh_ls`.
Prohibido: slots `exists`, `target_exists`, `compliant`, `parent`, `children`.

### 5.2 Secure Boot

Explicación del interruptor (qué es, ON/OFF, qué activa y desactiva):
`docs/secure-boot-lockdown.json`.
