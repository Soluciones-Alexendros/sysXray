'use strict';
/*
 * build/knowledge-base.js
 * Base de conocimiento del arbol de ficheros para "desplantar-auditoria".
 *
 * FUENTE DE VERDAD de la taxonomia y las reglas de anotacion. Exporta
 * `annotate(path, type, target)` y, al ejecutarse como programa principal,
 * emite dos artefactos coherentes por construccion:
 *   - data/kb-summary.json   anotacion de los 26 top-level + conteo de reglas
 *   - web/kb-rules.js        mismo motor, autocontenido, para el navegador
 *
 * Modelo de anotacion enriquecido (3 capas -> 1 registro):
 *   1) hechos del nodo (los aporta el visor: tipo, profundidad, hijos, linea)
 *   2) anotacion KB: hashtag, categoria, rol, descripcion, detalle, formato,
 *      estandar, caracteristicas[{clave,valor}], fuentes[{texto,url,tipo}]
 *   3) analisis (lo aporta symlink-report / audit-report en el visor)
 *
 * Prioridad de reglas: exact-path > directory-pattern > nombre > extension > top-level.
 *
 * Uso:  node build/knowledge-base.js [repoDir]
 * Sin argumento usa el directorio padre del script como raiz del repositorio.
 */

const fs = require('fs');
const path = require('path');

/* 0. Taxonomia (18 etiquetas) con metadatos enriquecidos.
 * Cada etiqueta aporta: rol (ambito), detalle (parrafo) y una lista de
 * caracteristicas GENERICAS de la categoria, heredadas por todo nodo anotado. */
const TAXONOMY = [
  { tag: '#fhs', label_es: 'Jerarquia FHS', color: '#4C6EF5',
    descripcion: 'Directorio canonico del Filesystem Hierarchy Standard (FHS 3.0) o dato compartido del sistema.',
    rol: 'Sistema',
    detalle: 'El FHS 3.0 estandariza donde vive cada cosa en un sistema Linux: binarios en /usr/bin, configuracion en /etc, datos variables en /var, etc. Que una ruta se ajuste a este estandar es lo que permite que las herramientas funcionen igual en cualquier distribucion.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Directorio del sistema (FHS)' },
      { clave: 'Origen', valor: 'FHS 3.0 / usr-merge' },
      { clave: 'Persistencia', valor: 'Depende del subarbol' }
    ] },
  { tag: '#config', label_es: 'Configuracion', color: '#12B886',
    descripcion: 'Ficheros y directorios de configuracion del sistema, servicios y aplicaciones (normalmente bajo /etc).',
    rol: 'Sistema',
    detalle: 'La configuracion del sistema vive casi toda en /etc y se lee al arrancar los servicios. Suele ser texto plano editable, especifica de la maquina, y se conserva al actualizar paquetes. El sufijo .d indica un directorio de fragmentos que se combinan.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Configuracion' },
      { clave: 'Formato', valor: 'Texto / INI / YAML segun extension' },
      { clave: 'Ambito', valor: 'Host-especifico' },
      { clave: 'Al actualizar', valor: 'Se conserva' }
    ] },
  { tag: '#daemon', label_es: 'Servicios / systemd', color: '#7950F2',
    descripcion: 'Unidades de systemd (.service, .socket, .target, .timer, .mount) y arranque de servicios.',
    rol: 'Sistema (servicios)',
    detalle: 'systemd gestiona el arranque y los servicios. Cada unidad declara que se ejecuta, cuando y como. Los enlaces dentro de *.wants/ o /etc/systemd/system/ activan una unidad (enable).',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Unidad systemd' },
      { clave: 'Formato', valor: 'INI (estilo freedesktop)' },
      { clave: 'Activacion', valor: 'Arranque / socket / timer' }
    ] },
  { tag: '#binario', label_es: 'Ejecutables', color: '#15AABF',
    descripcion: 'Binarios ejecutables (ELF) y scripts invocables: /usr/bin, /usr/sbin, /usr/libexec, /usr/local/bin.',
    rol: 'Programa',
    detalle: 'Programas que el usuario o el sistema pueden ejecutar. Los mas habituales son ficheros ELF enlazados dinamicamente contra glibc; tambien los hay como scripts (#!). /usr/bin es para el usuario y /usr/sbin para administracion.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Programa ejecutable' },
      { clave: 'Formato', valor: 'ELF o script' },
      { clave: 'Ejecutable', valor: 'Si' }
    ] },
  { tag: '#biblioteca', label_es: 'Bibliotecas', color: '#1098AD',
    descripcion: 'Bibliotecas compartidas (.so), estaticas (.a) y cabeceras de desarrollo (/usr/lib, /usr/include).',
    rol: 'Sistema',
    detalle: 'Codigo reutilizable que otros programas cargan en ejecucion (bibliotecas compartidas .so) o enlazan al compilar (bibliotecas estaticas .a). Las versionadas suelen seguir el patron libX.so.MAYOR.MENOR.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Biblioteca' },
      { clave: 'Formato', valor: '.so (ELF) o .a (ar)' },
      { clave: 'Enlace', valor: 'Dinamico o estatico' }
    ] },
  { tag: '#kernel', label_es: 'Nucleo y arranque', color: '#E8590C',
    descripcion: 'Nucleo (vmlinuz), initramfs, modulos (.ko), firmware y cargador de arranque (GRUB/EFI).',
    rol: 'Sistema (arranque)',
    detalle: 'El nucleo Linux y todo lo necesario para arrancar: la imagen comprimida (vmlinuz), el initramfs que carga controladores minimos, los modulos (.ko) y el firmware de los dispositivos. Critico: un fallo aqui impide arrancar.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Nucleo / firmware / arranque' },
      { clave: 'Formato', valor: 'vmlinuz / initramfs / .ko' },
      { clave: 'Criticidad', valor: 'Arranque del sistema' }
    ] },
  { tag: '#dispositivo', label_es: 'Dispositivos', color: '#F59F00',
    descripcion: 'Nodos de dispositivo y reglas udev en el pseudo-sistema de archivos /dev (devtmpfs).',
    rol: 'Kernel (devtmpfs)',
    detalle: 'En /dev el nucleo expone los dispositivos como ficheros (p. ej. /dev/sda, /dev/null). udev los crea y renombra dinamicamente segun sus reglas, y ofrece alias estables por ID.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Nodo de dispositivo' },
      { clave: 'Filesystem', valor: 'devtmpfs (memoria)' },
      { clave: 'Gestion', valor: 'udev' }
    ] },
  { tag: '#datos-proceso', label_es: 'Pseudo-FS del nucleo', color: '#AE3EC9',
    descripcion: 'Sistemas de archivos virtuales generados en memoria por el nucleo: /proc, /sys, /run.',
    rol: 'Kernel (virtual)',
    detalle: 'No son ficheros reales en disco: el nucleo los genera al vuelo para exponer procesos (/proc), dispositivos y parametros (/sys) y datos de ejecucion (/run). Su contenido cambia constantemente y no se respalda.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Pseudo-filesystem' },
      { clave: 'Persistencia', valor: 'Ninguna (memoria)' },
      { clave: 'Generado por', valor: 'El nucleo' }
    ] },
  { tag: '#cache', label_es: 'Cache / temporales', color: '#868E96',
    descripcion: 'Datos regenerables o efimeros: caches, indices y ficheros temporales (/var/cache, /tmp).',
    rol: 'Temporal',
    detalle: 'Datos que se pueden borrar sin perdida real: caches de aplicaciones, indices del gestor de paquetes y temporales. /tmp suele vaciarse al reiniciar (tmpfs); /var/tmp sobrevive mas tiempo.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Datos regenerables' },
      { clave: 'Persistencia', valor: 'Prescindible' },
      { clave: 'Ubicacion', valor: '/var/cache, /tmp, /var/tmp' }
    ] },
  { tag: '#log', label_es: 'Registros', color: '#F08C00',
    descripcion: 'Registros de eventos y auditoria: /var/log, journald, logs rotados.',
    rol: 'Sistema',
    detalle: 'Historial de lo que ocurre en el sistema: arranques, errores, accesos. systemd-journald los centraliza (binario) y los ficheros de /var/log los escriben los servicios; logrotate los va rotando y comprimiendo.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Registro de eventos' },
      { clave: 'Formato', valor: 'Texto o journal binario' },
      { clave: 'Rotacion', valor: 'logrotate' }
    ] },
  { tag: '#datos-usuario', label_es: 'Datos de usuario', color: '#E64980',
    descripcion: 'Datos personales del usuario: /home, /root, configuraciones XDG y correo local.',
    rol: 'Usuario',
    detalle: 'Ficheros propios de cada persona o del administrador (root). Incluye documentos, configuracion personal (.config), caches (.cache) y datos (.local), siguiendo el estandar XDG Base Directory.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Datos personales' },
      { clave: 'Propietario', valor: 'Usuario / root' },
      { clave: 'Estandar', valor: 'XDG Base Directory' }
    ] },
  { tag: '#snap', label_es: 'Paquetes snap', color: '#FD7E14',
    descripcion: 'Aplicaciones empaquetadas como snaps (squashfs) y sus datos en /snap y /var/lib/snapd.',
    rol: 'Aplicacion',
    detalle: 'Ubuntu empaqueta parte del software como snaps: imagenes squashfs de solo lectura que se montan en /snap. Van confinados (aislados) y se actualizan de forma atomica e independiente.',
    caracteristicas: [
      { clave: 'Naturaleza', valor: 'Empaquetado snap' },
      { clave: 'Formato', valor: 'squashfs (solo lectura)' },
      { clave: 'Aislamiento', valor: 'Confinado' }
    ] },
  { tag: '#anomalia-top', label_es: 'Anomalia: nivel raiz', color: '#FA5252',
    descripcion: 'Entrada en la raiz fuera del conjunto esperado o punto de montaje huerfano/inusual.',
    rol: 'Aviso',
    detalle: 'Entrada en / que no forma parte del conjunto canonico de directorios. Puede ser normal (swap.img en Ubuntu, lost+found de ext4) o un residuo que conviene revisar (cdrom huerfano).',
    caracteristicas: [ { clave: 'Naturaleza', valor: 'Hallazgo de auditoria' }, { clave: 'Accion', valor: 'Revision manual' } ] },
  { tag: '#anomalia-symlink-roto', label_es: 'Anomalia: symlink roto', color: '#E03131',
    descripcion: 'Enlace simbolico cuyo destino no existe.',
    rol: 'Aviso',
    detalle: 'El enlace apunta a una ruta que no existe. Muchas veces es inofensivo (sockets efimeros, capas de contenedores) pero conviene confirmarlo.',
    caracteristicas: [ { clave: 'Naturaleza', valor: 'Hallazgo de auditoria' }, { clave: 'Accion', valor: 'Revision manual' } ] },
  { tag: '#anomalia-symlink-circular', label_es: 'Anomalia: symlink circular', color: '#C92A2A',
    descripcion: 'Enlace simbolico que forma un ciclo de resolucion.',
    rol: 'Aviso',
    detalle: 'La resolucion del enlace se realimenta y nunca termina. Impide acceder al fichero.',
    caracteristicas: [ { clave: 'Naturaleza', valor: 'Hallazgo de auditoria' }, { clave: 'Accion', valor: 'Corregir' } ] },
  { tag: '#anomalia-ubicacion', label_es: 'Anomalia: ubicacion', color: '#D6336C',
    descripcion: 'Fichero colocado en un directorio que no corresponde segun FHS (p. ej. datos personales fuera de /home).',
    rol: 'Aviso',
    detalle: 'El contenido no encaja con el proposito del directorio segun el FHS. Dificulta el mantenimiento y las copias de seguridad.',
    caracteristicas: [ { clave: 'Naturaleza', valor: 'Hallazgo de auditoria' }, { clave: 'Accion', valor: 'Reubicar o justificar' } ] },
  { tag: '#anomalia-contenido', label_es: 'Anomalia: contenido', color: '#F76707',
    descripcion: 'Contenido inesperado en una ubicacion del sistema (p. ej. el propio volcado dentro de /).',
    rol: 'Aviso',
    detalle: 'Hay algo que no deberia estar ahi (el ejemplo tipico: el fichero de volcado dentro de la propia raiz).',
    caracteristicas: [ { clave: 'Naturaleza', valor: 'Hallazgo de auditoria' }, { clave: 'Accion', valor: 'Retirar' } ] },
  { tag: '#anomalia-candidato', label_es: 'Anomalia: candidato', color: '#FAB005',
    descripcion: 'Elemento que merece revision manual: posible anomalia no concluyente.',
    rol: 'Aviso',
    detalle: 'No se puede decidir automaticamente si es anomalia; queda marcado para que una persona lo valore.',
    caracteristicas: [ { clave: 'Naturaleza', valor: 'Hallazgo de auditoria' }, { clave: 'Accion', valor: 'Revisar' } ] }
];

const CATEGORIA = {
  '#fhs': 'Jerarquia FHS',
  '#config': 'Configuracion',
  '#daemon': 'Servicios / systemd',
  '#binario': 'Ejecutables',
  '#biblioteca': 'Bibliotecas',
  '#kernel': 'Nucleo y arranque',
  '#dispositivo': 'Dispositivos',
  '#datos-proceso': 'Pseudo-FS del nucleo',
  '#cache': 'Cache / temporales',
  '#log': 'Registros',
  '#datos-usuario': 'Datos de usuario',
  '#snap': 'Paquetes snap',
  '#anomalia-top': 'Anomalia: nivel raiz',
  '#anomalia-symlink-roto': 'Anomalia: symlink roto',
  '#anomalia-symlink-circular': 'Anomalia: symlink circular',
  '#anomalia-ubicacion': 'Anomalia: ubicacion',
  '#anomalia-contenido': 'Anomalia: contenido',
  '#anomalia-candidato': 'Anomalia: candidato'
};

/* Mapa tag -> metadatos enriquecidos, para lookup rapido en annotate(). */
const TAG_META = {};
TAXONOMY.forEach(function (t) { TAG_META[t.tag] = t; });

/* 0b. Formato por extension (capa "formato" del registro). */
const FORMATO_EXT = {
  '.so': 'Biblioteca compartida (ELF)', '.a': 'Archivo estatico (ar)',
  '.ko': 'Modulo del nucleo', '.gz': 'Comprimido (gzip)', '.xz': 'Comprimido (xz)',
  '.zst': 'Comprimido (zstd)', '.json': 'Datos JSON', '.yaml': 'Configuracion YAML',
  '.yml': 'Configuracion YAML', '.toml': 'Configuracion TOML', '.ini': 'Configuracion INI',
  '.conf': 'Configuracion (texto)', '.cfg': 'Configuracion (texto)',
  '.service': 'Unidad systemd (INI)', '.socket': 'Unidad systemd (INI)',
  '.target': 'Unidad systemd (INI)', '.timer': 'Unidad systemd (INI)',
  '.mount': 'Unidad systemd (INI)', '.path': 'Unidad systemd (INI)',
  '.desktop': 'Desktop Entry (INI)', '.rules': 'Reglas udev',
  '.db': 'Base de datos binaria', '.log': 'Registro (texto)', '.pid': 'PID (texto)',
  '.lock': 'Fichero de bloqueo', '.snap': 'Imagen squashfs', '.deb': 'Paquete Debian',
  '.sh': 'Script de shell', '.py': 'Script Python', '.md': 'Texto (Markdown)',
  '.txt': 'Texto plano', '.list': 'Lista (texto)'
};

/* 0c. Seccion del FHS por directorio de primer nivel (capa "estandar"). */
const FHS_SECTION = {
  bin: 'FHS 3.0 §3.4  /bin (usr-merge)', sbin: 'FHS 3.0 §3.17 /sbin (usr-merge)',
  boot: 'FHS 3.0 §3.5  /boot', dev: 'FHS 3.0 §3.6  /dev', etc: 'FHS 3.0 §3.7  /etc',
  home: 'FHS 3.0 §3.8  /home', lib: 'FHS 3.0 §3.9  /lib (usr-merge)',
  lib32: 'Ext. multilib /lib32', lib64: 'Ext. multilib /lib64', libx32: 'Ext. multilib /libx32',
  media: 'FHS 3.0 §3.11 /media', mnt: 'FHS 3.0 §3.12 /mnt', opt: 'FHS 3.0 §3.13 /opt',
  proc: 'FHS 3.0 §3.14 /proc', root: 'FHS 3.0 §3.15 /root', run: 'FHS 3.0 §3.16 /run',
  srv: 'FHS 3.0 §3.18 /srv', sys: 'FHS 3.0 §3.19 /sys', tmp: 'FHS 3.0 §3.20 /tmp',
  usr: 'FHS 3.0 §3.21 /usr', var: 'FHS 3.0 §3.22 /var',
  snap: 'Extra-FHS (Ubuntu)', 'swap.img': 'Extra-FHS (Ubuntu)',
  cdrom: 'Mountpoint huerfano (no FHS)', 'lost+found': 'Extra-FHS (ext4)',
  'desplantar.md': 'Extra-FHS (artefacto de auditoria)'
};

/* 0d. Clasificacion del tipo de fuente por URL. */
function classifyFuente(url) {
  var u = String(url || '');
  if (u.indexOf('wikipedia.org') !== -1) return 'enciclopedia';
  if (u.indexOf('man7.org') !== -1 || /\/man[1-9]\//.test(u)) return 'man';
  if (u.indexOf('specifications.freedesktop.org') !== -1) return 'especificacion';
  if (u.indexOf('freedesktop.org') !== -1) return 'oficial';
  if (u.indexOf('wiki.archlinux.org') !== -1 || u.indexOf('wiki.debian.org') !== -1) return 'distro';
  if (u.indexOf('gnu.org') !== -1 || u.indexOf('sudo.ws') !== -1 || u.indexOf('netplan.io') !== -1 ||
      u.indexOf('snapcraft.io') !== -1 || u.indexOf('python.org') !== -1 || u.indexOf('json.org') !== -1 ||
      u.indexOf('tukaani.org') !== -1 || u.indexOf('sqlite.org') !== -1 || u.indexOf('facebook.github.io') !== -1) return 'oficial';
  return 'oficial';
}

/* 0e. Estandar (seccion FHS) a partir de la ruta. */
function estandarDe(p) {
  var segs = String(p || '').split('/').filter(function (s) { return s.length > 0; });
  if (!segs.length) return '';
  return FHS_SECTION[segs[0]] || '';
}

/* 1. Enlaces de referencia: clave -> lista de {texto,url} */
const LINKS = {
  fhs: [
    { texto: 'FHS 3.0 - Filesystem Hierarchy Standard (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Filesystem_Hierarchy_Standard' },
    { texto: 'hier(7) - arbol de directorios (man7.org)', url: 'https://man7.org/linux/man-pages/man7/hier.7.html' },
    { texto: 'Jerarquia estandar de sistemas de archivos (Wikipedia, ES)', url: 'https://es.wikipedia.org/wiki/Jerarqu%C3%ADa_est%C3%A1ndar_de_sistemas_de_archivos' }
  ],
  mergedUsr: [
    { texto: 'The Case for the /usr Merge (freedesktop.org)', url: 'https://www.freedesktop.org/wiki/Software/systemd/TheCaseForTheUsrMerge/' },
    { texto: 'File hierarchy (Arch Wiki)', url: 'https://wiki.archlinux.org/title/File_hierarchy' }
  ],
  config: [{ texto: 'Ficheros de configuracion (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Configuration_file' }],
  passwd: [{ texto: 'passwd(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/passwd.5.html' }],
  shadow: [{ texto: 'shadow(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/shadow.5.html' }],
  group: [{ texto: 'group(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/group.5.html' }],
  fstab: [{ texto: 'fstab(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/fstab.5.html' }],
  hosts: [{ texto: 'hosts(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/hosts.5.html' }],
  resolvconf: [{ texto: 'resolv.conf(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/resolv.conf.5.html' }],
  osrelease: [{ texto: 'os-release(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/os-release.5.html' }],
  machineid: [{ texto: 'machine-id(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/machine-id.5.html' }],
  sudoers: [{ texto: 'sudoers(5) (sudo.ws)', url: 'https://www.sudo.ws/docs/man/sudoers.man/' }],
  crontab: [{ texto: 'crontab(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/crontab.5.html' }],
  systemd: [{ texto: 'systemd(1) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.html' }],
  systemdUnit: [{ texto: 'systemd.unit(5) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html' }],
  systemdService: [{ texto: 'systemd.service(5) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html' }],
  systemdSocket: [{ texto: 'systemd.socket(5) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html' }],
  systemdTarget: [{ texto: 'systemd.target(5) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.target.html' }],
  systemdTimer: [{ texto: 'systemd.timer(5) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html' }],
  systemdMount: [{ texto: 'systemd.mount(5) (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd.mount.html' }],
  apt: [{ texto: 'APT (Debian Wiki)', url: 'https://wiki.debian.org/Apt' }],
  netplan: [{ texto: 'Netplan - referencia YAML', url: 'https://netplan.io/reference' }],
  netif: [{ texto: 'Network configuration (Debian Wiki)', url: 'https://wiki.debian.org/NetworkConfiguration' }],
  xorg: [{ texto: 'Xorg (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Xorg' }],
  fonts: [{ texto: 'Font configuration (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Font_configuration' }],
  pam: [{ texto: 'pam.conf(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/pam.conf.5.html' }],
  sysctl: [{ texto: 'sysctl.conf(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/sysctl.conf.5.html' }],
  modules: [{ texto: 'Kernel modules (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Kernel_module' }],
  ssh: [{ texto: 'sshd_config(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/sshd_config.5.html' }],
  ssl: [{ texto: 'Transport Layer Security (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Transport_Layer_Security' }],
  logrotate: [{ texto: 'logrotate(8) (man7.org)', url: 'https://man7.org/linux/man-pages/man8/logrotate.8.html' }],
  sysv: [{ texto: 'init / SysV (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Init' }],
  binario: [
    { texto: 'ELF - formato de ejecutables y enlazables (Wikipedia, ES)', url: 'https://es.wikipedia.org/wiki/Formato_de_ficheros_ejecutables_y_enlazables' },
    { texto: '/bin y /usr/bin (hier(7), man7.org)', url: 'https://man7.org/linux/man-pages/man7/hier.7.html' }
  ],
  biblioteca: [
    { texto: 'ld.so(8) - enlazador dinamico (man7.org)', url: 'https://man7.org/linux/man-pages/man8/ld.so.8.html' },
    { texto: 'Biblioteca (informatica) (Wikipedia, ES)', url: 'https://es.wikipedia.org/wiki/Biblioteca_(inform%C3%A1tica)' },
    { texto: 'ar(1) - archivos estaticos .a (man7.org)', url: 'https://man7.org/linux/man-pages/man1/ar.1.html' }
  ],
  kernel: [
    { texto: 'Arch boot process - nucleo e initramfs (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Arch_boot_process' },
    { texto: 'Initial ramdisk / initramfs (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Initial_ramdisk' },
    { texto: 'modprobe(8) - modulos del nucleo (man7.org)', url: 'https://man7.org/linux/man-pages/man8/modprobe.8.html' }
  ],
  kernelMod: [{ texto: 'Kernel modules (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Kernel_module' }],
  grub: [
    { texto: 'GRUB (Arch Wiki)', url: 'https://wiki.archlinux.org/title/GRUB' },
    { texto: 'GNU GRUB (Wikipedia, ES)', url: 'https://es.wikipedia.org/wiki/GNU_GRUB' }
  ],
  efi: [{ texto: 'EFI System Partition (Arch Wiki)', url: 'https://wiki.archlinux.org/title/EFI_system_partition' }],
  dispositivo: [
    { texto: 'udev(7) - gestion de /dev (man7.org)', url: 'https://man7.org/linux/man-pages/man7/udev.7.html' },
    { texto: 'Device file (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Device_file' }
  ],
  procfs: [{ texto: 'proc(5) - /proc (man7.org)', url: 'https://man7.org/linux/man-pages/man5/proc.5.html' }],
  sysfs: [{ texto: 'sysfs(5) - /sys (man7.org)', url: 'https://man7.org/linux/man-pages/man5/sysfs.5.html' }],
  tmpfs: [{ texto: 'tmpfs (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Tmpfs' }],
  snap: [
    { texto: 'Snapcraft - documentacion', url: 'https://snapcraft.io/docs' },
    { texto: 'Snap (software) (Wikipedia, ES)', url: 'https://es.wikipedia.org/wiki/Snap_(software)' }
  ],
  usuario: [
    { texto: 'hier(7) - /home y /root (man7.org)', url: 'https://man7.org/linux/man-pages/man7/hier.7.html' },
    { texto: 'XDG Base Directory (Arch Wiki)', url: 'https://wiki.archlinux.org/title/XDG_Base_Directory' }
  ],
  xdg: [{ texto: 'XDG Base Directory Specification', url: 'https://specifications.freedesktop.org/basedir-spec/latest/' }],
  cache: [{ texto: 'Cache (computing) (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Cache_(computing)' }],
  log: [
    { texto: 'systemd-journald.service (freedesktop.org)', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemd-journald.service.html' },
    { texto: 'Log file (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Log_file' }
  ],
  shell: [{ texto: 'Bash startup files (GNU)', url: 'https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html' }],
  python: [{ texto: 'Python (sitio oficial)', url: 'https://www.python.org/' }],
  json: [{ texto: 'JSON (json.org)', url: 'https://www.json.org/json-en.html' }],
  desktop: [{ texto: 'Desktop Entry Specification (freedesktop.org)', url: 'https://specifications.freedesktop.org/desktop-entry-spec/latest/' }],
  udevRules: [{ texto: 'udev(7) - reglas .rules (man7.org)', url: 'https://man7.org/linux/man-pages/man7/udev.7.html' }],
  deb: [{ texto: 'deb - formato de paquete Debian (Debian Wiki)', url: 'https://wiki.debian.org/deb' }],
  gzip: [{ texto: 'gzip (GNU)', url: 'https://www.gnu.org/software/gzip/' }],
  xz: [{ texto: 'XZ Utils (xz)', url: 'https://tukaani.org/xz/' }],
  zstd: [{ texto: 'Zstandard (zstd)', url: 'https://facebook.github.io/zstd/' }],
  lostfound: [{ texto: 'lost+found (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Lost%2Bfound' }],
  swap: [{ texto: 'Swap (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Swap' }],
  spool: [{ texto: 'Spooling (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Spooling' }],
  mail: [{ texto: 'mbox(5) (man7.org)', url: 'https://man7.org/linux/man-pages/man5/mbox.5.html' }],
  sqlite: [{ texto: 'SQLite database file format', url: 'https://www.sqlite.org/fileformat2.html' }],
  pid: [{ texto: 'Process identifier (Wikipedia, EN)', url: 'https://en.wikipedia.org/wiki/Process_identifier' }],
  lock: [{ texto: 'flock(2) - bloqueo de ficheros (man7.org)', url: 'https://man7.org/linux/man-pages/man2/flock.2.html' }],
  fw: [{ texto: 'Firmware (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Firmware' }],
  cron: [{ texto: 'cron (Arch Wiki)', url: 'https://wiki.archlinux.org/title/Cron' }]
};

const RULES = {
  /* 2a. exact-path */
  exact: [
    { p: '/bin', tag: '#fhs', lk: 'mergedUsr', d: 'Enlace de la fusion /usr: /bin -> usr/bin (ejecutables esenciales).' },
    { p: '/sbin', tag: '#fhs', lk: 'mergedUsr', d: 'Enlace de la fusion /usr: /sbin -> usr/sbin (binarios de administracion).' },
    { p: '/lib', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr: /lib -> usr/lib (bibliotecas esenciales).' },
    { p: '/lib32', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr: /lib32 -> usr/lib32 (bibliotecas de 32 bits).' },
    { p: '/lib64', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr: /lib64 -> usr/lib64 (bibliotecas de 64 bits).' },
    { p: '/libx32', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr: /libx32 -> usr/libx32 (ABI x32).' },
    { p: '/etc/passwd', tag: '#config', lk: 'passwd', d: 'Base de datos de cuentas de usuario (UID/GID, shell, home).' },
    { p: '/etc/shadow', tag: '#config', lk: 'shadow', d: 'Hashes de contrasenas y politica de caducidad (solo root).' },
    { p: '/etc/gshadow', tag: '#config', lk: 'shadow', d: 'Version protegida de /etc/group (contrasenas de grupo).' },
    { p: '/etc/group', tag: '#config', lk: 'group', d: 'Grupos del sistema y sus miembros.' },
    { p: '/etc/fstab', tag: '#config', lk: 'fstab', d: 'Tabla de sistemas de archivos montados al arranque.' },
    { p: '/etc/hosts', tag: '#config', lk: 'hosts', d: 'Resolucion estatica de nombres locales.' },
    { p: '/etc/hostname', tag: '#config', lk: 'config', d: 'Nombre del equipo (hostname).' },
    { p: '/etc/resolv.conf', tag: '#config', lk: 'resolvconf', d: 'Servidores DNS; habitual enlace gestionado por systemd-resolved.' },
    { p: '/etc/os-release', tag: '#config', lk: 'osrelease', d: 'Identificacion de la distribucion (nombre, version, ID).' },
    { p: '/etc/machine-id', tag: '#config', lk: 'machineid', d: 'Identificador unico de la maquina (systemd).' },
    { p: '/etc/sudoers', tag: '#config', lk: 'sudoers', d: 'Politica de privilegios de sudo.' },
    { p: '/etc/crontab', tag: '#config', lk: 'crontab', d: 'Programacion de tareas periodicas del sistema.' },
    { p: '/etc/ld.so.conf', tag: '#config', lk: 'biblioteca', d: 'Rutas de busqueda del enlazador dinamico.' },
    { p: '/etc/ld.so.cache', tag: '#config', lk: 'biblioteca', d: 'Cache binaria del enlazador (ldconfig).' },
    { p: '/etc/shells', tag: '#config', lk: 'shell', d: 'Lista de interpretes de comandos validos.' },
    { p: '/etc/nsswitch.conf', tag: '#config', lk: 'config', d: 'Orden de fuentes para resolucion de nombres/servicios.' },
    { p: '/etc/environment', tag: '#config', lk: 'config', d: 'Variables de entorno globales para PAM.' },
    { p: '/etc/services', tag: '#config', lk: 'config', d: 'Asignacion de nombres de servicio a puertos/protocolos.' },
    { p: '/etc/protocols', tag: '#config', lk: 'config', d: 'Protocolos de red conocidos y sus numeros.' },
    { p: '/etc/apt/sources.list', tag: '#config', lk: 'apt', d: 'Repositorios APT de Ubuntu/Debian.' },
    { p: '/etc/ssh/sshd_config', tag: '#config', lk: 'ssh', d: 'Configuracion del servidor SSH.' },
    { p: '/etc/systemd/journald.conf', tag: '#config', lk: 'systemd', d: 'Configuracion del registro (journald).' },
    { p: '/etc/systemd/resolved.conf', tag: '#config', lk: 'systemd', d: 'Configuracion del resolutor DNS (systemd-resolved).' },
    { p: '/etc/systemd/logind.conf', tag: '#config', lk: 'systemd', d: 'Configuracion de sesiones y logind.' },
    { p: '/swap.img', tag: '#anomalia-top', lk: 'swap', d: 'Fichero de intercambio (swapfile) en la raiz; normal en Ubuntu.' },
    { p: '/cdrom', tag: '#anomalia-top', lk: 'fhs', d: 'Punto de montaje de CD-ROM huerfano en la raiz (residuo).' },
    { p: '/desplantar.md', tag: '#anomalia-contenido', lk: 'fhs', d: 'El propio volcado tree(1) autocontenido en la raiz.' },
    { p: '/lost+found', tag: '#anomalia-top', lk: 'lostfound', d: 'Directorio de recuperacion de fsck de ext4 (normal, extra-FHS en raiz).' }
  ],
  /* 2b. directory-pattern (subarbol). Orden = prioridad. */
  dir: [
    { p: '/etc/systemd/system', tag: '#daemon', lk: 'systemdUnit', d: 'Unidades de systemd del administrador; enlaces de enable.' },
    { p: '/etc/systemd/user', tag: '#daemon', lk: 'systemdUnit', d: 'Unidades systemd de sesion de usuario.' },
    { p: '/etc/systemd', tag: '#config', lk: 'systemd', d: 'Configuracion global de systemd (defaults, journald, logind).' },
    { p: '/usr/lib/systemd/system', tag: '#daemon', lk: 'systemdUnit', d: 'Unidades de sistema instaladas por los paquetes.' },
    { p: '/usr/lib/systemd/user', tag: '#daemon', lk: 'systemdUnit', d: 'Unidades de usuario instaladas por los paquetes.' },
    { p: '/usr/lib/systemd', tag: '#daemon', lk: 'systemd', d: 'Unidades y binarios internos de systemd.' },
    { p: '/lib/systemd/system', tag: '#daemon', lk: 'systemdUnit', d: 'Unidades systemd (ruta de la fusion /usr).' },
    { p: '/lib/systemd', tag: '#daemon', lk: 'systemd', d: 'systemd (ruta de la fusion /usr).' },
    { p: '/etc/init.d', tag: '#daemon', lk: 'sysv', d: 'Scripts de arranque SysV clasicos (compatibilidad).' },
    { p: '/etc/apt', tag: '#config', lk: 'apt', d: 'Configuracion de APT y definicion de repositorios.' },
    { p: '/etc/network', tag: '#config', lk: 'netif', d: 'Configuracion de red clasica (/etc/network/interfaces).' },
    { p: '/etc/netplan', tag: '#config', lk: 'netplan', d: 'Configuracion de red declarativa de Netplan (YAML, Ubuntu).' },
    { p: '/etc/X11', tag: '#config', lk: 'xorg', d: 'Configuracion del servidor grafico Xorg.' },
    { p: '/etc/fonts', tag: '#config', lk: 'fonts', d: 'Configuracion de fuentes (fontconfig).' },
    { p: '/etc/cron.d', tag: '#config', lk: 'cron', d: 'Fragmentos de cron del sistema.' },
    { p: '/etc/cron.daily', tag: '#config', lk: 'cron', d: 'Tareas cron diarias.' },
    { p: '/etc/cron.hourly', tag: '#config', lk: 'cron', d: 'Tareas cron horarias.' },
    { p: '/etc/cron.weekly', tag: '#config', lk: 'cron', d: 'Tareas cron semanales.' },
    { p: '/etc/cron.monthly', tag: '#config', lk: 'cron', d: 'Tareas cron mensuales.' },
    { p: '/etc/cron.yearly', tag: '#config', lk: 'cron', d: 'Tareas cron anuales.' },
    { p: '/etc/skel', tag: '#config', lk: 'usuario', d: 'Plantilla de ficheros para nuevos usuarios.' },
    { p: '/etc/profile.d', tag: '#config', lk: 'shell', d: 'Scripts de shell cargados al iniciar sesion.' },
    { p: '/etc/default', tag: '#config', lk: 'config', d: 'Parametros por defecto de servicios.' },
    { p: '/etc/logrotate.d', tag: '#config', lk: 'logrotate', d: 'Reglas de rotacion de registros.' },
    { p: '/etc/pam.d', tag: '#config', lk: 'pam', d: 'Configuracion de modulos de autenticacion (PAM).' },
    { p: '/etc/sysctl.d', tag: '#config', lk: 'sysctl', d: 'Fragmentos de parametros del nucleo (sysctl).' },
    { p: '/etc/security', tag: '#config', lk: 'pam', d: 'Limites y politicas de seguridad de PAM.' },
    { p: '/etc/modules-load.d', tag: '#kernel', lk: 'modules', d: 'Modulos del nucleo a cargar al arranque.' },
    { p: '/etc/modprobe.d', tag: '#kernel', lk: 'modules', d: 'Opciones y alias de modulos del nucleo.' },
    { p: '/etc/tmpfiles.d', tag: '#config', lk: 'tmpfs', d: 'Reglas de systemd-tmpfiles para directorios efimeros.' },
    { p: '/etc/ssh', tag: '#config', lk: 'ssh', d: 'Configuracion del servidor y cliente SSH.' },
    { p: '/etc/ssl', tag: '#config', lk: 'ssl', d: 'Certificados y claves TLS del sistema.' },
    { p: '/etc/pki', tag: '#config', lk: 'ssl', d: 'Infraestructura de clave publica (certificados).' },
    { p: '/etc/dpkg', tag: '#config', lk: 'deb', d: 'Configuracion local de dpkg.' },
    { p: '/etc/xdg', tag: '#config', lk: 'xdg', d: 'Configuracion de aplicaciones segun el estandar XDG.' },
    { p: '/etc', tag: '#config', lk: 'config', d: 'Configuracion del sistema (host-specific).' },
    { p: '/usr/lib/firmware', tag: '#kernel', lk: 'fw', d: 'Firmware cargado por el nucleo para dispositivos.' },
    { p: '/usr/lib/modules', tag: '#kernel', lk: 'kernelMod', d: 'Modulos del nucleo versionados (/usr/lib/modules/<ver>).' },
    { p: '/usr/local/bin', tag: '#binario', lk: 'binario', d: 'Ejecutables instalados localmente por el administrador.' },
    { p: '/usr/local/sbin', tag: '#binario', lk: 'binario', d: 'Binarios de administracion locales.' },
    { p: '/usr/local/lib', tag: '#biblioteca', lk: 'biblioteca', d: 'Bibliotecas instaladas localmente.' },
    { p: '/usr/local', tag: '#fhs', lk: 'fhs', d: 'Software instalado localmente, fuera del gestor de paquetes.' },
    { p: '/usr/bin', tag: '#binario', lk: 'binario', d: 'Ejecutables de usuario del sistema.' },
    { p: '/usr/sbin', tag: '#binario', lk: 'binario', d: 'Ejecutables no esenciales de administracion.' },
    { p: '/usr/libexec', tag: '#binario', lk: 'binario', d: 'Ejecutables internos invocados por otros programas.' },
    { p: '/usr/games', tag: '#binario', lk: 'binario', d: 'Juegos del sistema.' },
    { p: '/usr/lib', tag: '#biblioteca', lk: 'biblioteca', d: 'Bibliotecas compartidas y datos de los paquetes.' },
    { p: '/usr/lib32', tag: '#biblioteca', lk: 'biblioteca', d: 'Bibliotecas de 32 bits.' },
    { p: '/usr/lib64', tag: '#biblioteca', lk: 'biblioteca', d: 'Bibliotecas de 64 bits.' },
    { p: '/usr/include', tag: '#biblioteca', lk: 'biblioteca', d: 'Cabeceras C/C++ para desarrollo.' },
    { p: '/usr/share', tag: '#fhs', lk: 'fhs', d: 'Datos compartidos independientes de la arquitectura (docs, icons, man).' },
    { p: '/usr/src', tag: '#kernel', lk: 'kernel', d: 'Codigo fuente, en Ubuntu cabeceras del nucleo.' },
    { p: '/usr', tag: '#fhs', lk: 'fhs', d: 'Jerarquia secundaria de solo lectura con la mayor parte del software.' },
    { p: '/var/log', tag: '#log', lk: 'log', d: 'Registros del sistema y de servicios.' },
    { p: '/var/cache', tag: '#cache', lk: 'cache', d: 'Cache de aplicaciones y del gestor de paquetes.' },
    { p: '/var/lib/snapd', tag: '#snap', lk: 'snap', d: 'Estado y datos del demonio de snaps.' },
    { p: '/var/lib/systemd', tag: '#daemon', lk: 'systemd', d: 'Estado persistente de systemd.' },
    { p: '/var/lib/apt', tag: '#cache', lk: 'apt', d: 'Indices y listas de paquetes de APT.' },
    { p: '/var/lib/dpkg', tag: '#fhs', lk: 'deb', d: 'Base de datos del gestor de paquetes dpkg.' },
    { p: '/var/lib', tag: '#fhs', lk: 'fhs', d: 'Estado persistente de aplicaciones y servicios.' },
    { p: '/var/spool/mail', tag: '#fhs', lk: 'mail', d: 'Buzones de correo locales (alias de /var/mail).' },
    { p: '/var/spool', tag: '#fhs', lk: 'spool', d: 'Colas de trabajos en espera (impresion, cron, correo).' },
    { p: '/var/tmp', tag: '#cache', lk: 'tmpfs', d: 'Ficheros temporales que sobreviven a reinicios.' },
    { p: '/var/backups', tag: '#fhs', lk: 'fhs', d: 'Copias de seguridad del sistema.' },
    { p: '/var/mail', tag: '#fhs', lk: 'mail', d: 'Buzones de correo locales.' },
    { p: '/var/run', tag: '#datos-proceso', lk: 'tmpfs', d: 'Enlace a /run (datos de ejecucion).' },
    { p: '/var/lock', tag: '#datos-proceso', lk: 'lock', d: 'Enlace a /run/lock (ficheros de bloqueo).' },
    { p: '/var/opt', tag: '#fhs', lk: 'fhs', d: 'Datos variables de paquetes en /opt.' },
    { p: '/var', tag: '#fhs', lk: 'fhs', d: 'Datos variables: registros, caches, spools y estado.' },
    { p: '/home', tag: '#datos-usuario', lk: 'usuario', d: 'Directorios personales de los usuarios.' },
    { p: '/snap', tag: '#snap', lk: 'snap', d: 'Montajes de aplicaciones snap (imagenes squashfs).' },
    { p: '/boot', tag: '#kernel', lk: 'kernel', d: 'Nucleo, initramfs y cargador de arranque.' },
    { p: '/dev', tag: '#dispositivo', lk: 'dispositivo', d: 'Nodos de dispositivo gestionados por udev (devtmpfs).' },
    { p: '/proc', tag: '#datos-proceso', lk: 'procfs', d: 'Sistema de archivos virtual de procesos e informacion del nucleo.' },
    { p: '/sys', tag: '#datos-proceso', lk: 'sysfs', d: 'Sistema de archivos virtual que expone objetos del nucleo (sysfs).' },
    { p: '/run', tag: '#datos-proceso', lk: 'tmpfs', d: 'Datos de ejecucion en tmpfs desde el arranque.' },
    { p: '/tmp', tag: '#cache', lk: 'tmpfs', d: 'Ficheros temporales, a menudo en tmpfs y borrados al reiniciar.' },
    { p: '/root', tag: '#datos-usuario', lk: 'usuario', d: 'Directorio personal del superusuario root.' },
    { p: '/opt', tag: '#fhs', lk: 'fhs', d: 'Paquetes de software opcionales de terceros.' },
    { p: '/srv', tag: '#fhs', lk: 'fhs', d: 'Datos servidos por el sistema (web, ftp).' },
    { p: '/media', tag: '#fhs', lk: 'fhs', d: 'Puntos de montaje de medios extraibles.' },
    { p: '/mnt', tag: '#fhs', lk: 'fhs', d: 'Punto de montaje temporal para el administrador.' }
  ],
  /* 2c. nombre de directorio/fichero (suffix, name exacto, startswith) */
  name: [
    { suffix: '.d', tag: '#config', lk: 'config', d: 'Directorio de fragmentos de configuracion (*.d).' },
    { name: '.config', tag: '#config', lk: 'xdg', d: 'Configuracion de usuario XDG.' },
    { name: '.cache', tag: '#cache', lk: 'cache', d: 'Cache de usuario XDG.' },
    { name: '.local', tag: '#datos-usuario', lk: 'xdg', d: 'Datos de usuario XDG (bin, share, state).' },
    { startswith: 'vmlinuz', tag: '#kernel', lk: 'kernel', d: 'Imagen comprimida del nucleo Linux.' },
    { startswith: 'vmlinux', tag: '#kernel', lk: 'kernel', d: 'Imagen del nucleo sin comprimir (con simbolos).' },
    { startswith: 'initrd.img', tag: '#kernel', lk: 'kernel', d: 'Initramfs usado para el arranque.' },
    { startswith: 'initramfs', tag: '#kernel', lk: 'kernel', d: 'Initramfs del nucleo.' },
    { startswith: 'System.map', tag: '#kernel', lk: 'kernel', d: 'Mapa de simbolos del nucleo.' },
    { startswith: 'config-', tag: '#kernel', lk: 'kernel', d: 'Configuracion de compilacion del nucleo (kconfig).' }
  ],
  /* 2d. extension de fichero */
  ext: [
    { e: '.service', tag: '#daemon', lk: 'systemdService', d: 'Unidad de servicio de systemd.' },
    { e: '.socket', tag: '#daemon', lk: 'systemdSocket', d: 'Unidad de socket de systemd (activacion por socket).' },
    { e: '.target', tag: '#daemon', lk: 'systemdTarget', d: 'Unidad target de systemd (agrupacion de unidades).' },
    { e: '.timer', tag: '#daemon', lk: 'systemdTimer', d: 'Unidad timer de systemd (tareas programadas).' },
    { e: '.mount', tag: '#daemon', lk: 'systemdMount', d: 'Unidad mount de systemd (punto de montaje).' },
    { e: '.path', tag: '#daemon', lk: 'systemdUnit', d: 'Unidad path de systemd (activacion por ruta).' },
    { e: '.conf', tag: '#config', lk: 'config', d: 'Fichero de configuracion.' },
    { e: '.cfg', tag: '#config', lk: 'config', d: 'Fichero de configuracion.' },
    { e: '.ini', tag: '#config', lk: 'config', d: 'Fichero de configuracion con secciones INI.' },
    { e: '.toml', tag: '#config', lk: 'config', d: 'Fichero de configuracion TOML.' },
    { e: '.yaml', tag: '#config', lk: 'config', d: 'Fichero de configuracion YAML.' },
    { e: '.yml', tag: '#config', lk: 'config', d: 'Fichero de configuracion YAML.' },
    { e: '.json', tag: '#config', lk: 'json', d: 'Fichero de datos/configuracion JSON.' },
    { e: '.desktop', tag: '#config', lk: 'desktop', d: 'Entrada de aplicacion de escritorio (XDG Desktop Entry).' },
    { e: '.rules', tag: '#dispositivo', lk: 'udevRules', d: 'Reglas udev para nombrar/permisos de dispositivos.' },
    { e: '.so', tag: '#biblioteca', lk: 'biblioteca', d: 'Biblioteca compartida (objeto compartido ELF).' },
    { e: '.a', tag: '#biblioteca', lk: 'biblioteca', d: 'Biblioteca estatica (archivo ar).' },
    { e: '.ko', tag: '#kernel', lk: 'kernelMod', d: 'Modulo del nucleo.' },
    { e: '.db', tag: '#cache', lk: 'sqlite', d: 'Base de datos binaria; a menudo cache/indice (SQLite, mime, rpm).' },
    { e: '.log', tag: '#log', lk: 'log', d: 'Fichero de registro de eventos.' },
    { e: '.pid', tag: '#datos-proceso', lk: 'pid', d: 'Fichero con el PID de un proceso en ejecucion.' },
    { e: '.lock', tag: '#datos-proceso', lk: 'lock', d: 'Fichero de bloqueo para exclusion mutua.' },
    { e: '.snap', tag: '#snap', lk: 'snap', d: 'Paquete snap (imagen squashfs).' },
    { e: '.gz', tag: '#fhs', lk: 'gzip', d: 'Fichero comprimido con gzip.' },
    { e: '.xz', tag: '#fhs', lk: 'xz', d: 'Fichero comprimido con xz.' },
    { e: '.zst', tag: '#fhs', lk: 'zstd', d: 'Fichero comprimido con zstd.' },
    { e: '.deb', tag: '#fhs', lk: 'deb', d: 'Paquete de software Debian/Ubuntu.' },
    { e: '.list', tag: '#config', lk: 'apt', d: 'Lista (p. ej. repositorios de APT).' },
    { e: '.sh', tag: '#binario', lk: 'shell', d: 'Script de shell.' },
    { e: '.py', tag: '#binario', lk: 'python', d: 'Script de Python.' },
    { e: '.md', tag: '#fhs', lk: 'fhs', d: 'Documento de texto Markdown.' },
    { e: '.txt', tag: '#fhs', lk: 'fhs', d: 'Fichero de texto plano.' }
  ],
  /* 2e. top-level fallback (26 raices del manifest) */
  top: [
    { name: 'bin', tag: '#fhs', lk: 'mergedUsr', d: 'Enlace de la fusion /usr hacia usr/bin.' },
    { name: 'boot', tag: '#kernel', lk: 'kernel', d: 'Nucleo, initramfs y cargador de arranque.' },
    { name: 'cdrom', tag: '#anomalia-top', lk: 'fhs', d: 'Punto de montaje de CD-ROM huerfano en la raiz.' },
    { name: 'desplantar.md', tag: '#anomalia-contenido', lk: 'fhs', d: 'Volcado del arbol de ficheros creado dentro de la raiz.' },
    { name: 'dev', tag: '#dispositivo', lk: 'dispositivo', d: 'Nodos de dispositivo (devtmpfs).' },
    { name: 'etc', tag: '#config', lk: 'config', d: 'Configuracion del sistema.' },
    { name: 'home', tag: '#datos-usuario', lk: 'usuario', d: 'Directorios personales de los usuarios.' },
    { name: 'lib', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr hacia usr/lib.' },
    { name: 'lib32', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr hacia usr/lib32.' },
    { name: 'lib64', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr hacia usr/lib64.' },
    { name: 'libx32', tag: '#biblioteca', lk: 'mergedUsr', d: 'Enlace de la fusion /usr hacia usr/libx32.' },
    { name: 'lost+found', tag: '#anomalia-top', lk: 'lostfound', d: 'Directorio de recuperacion de fsck de ext4 (normal).' },
    { name: 'media', tag: '#fhs', lk: 'fhs', d: 'Puntos de montaje de medios extraibles.' },
    { name: 'mnt', tag: '#fhs', lk: 'fhs', d: 'Punto de montaje temporal.' },
    { name: 'opt', tag: '#fhs', lk: 'fhs', d: 'Paquetes de software opcionales de terceros.' },
    { name: 'proc', tag: '#datos-proceso', lk: 'procfs', d: 'Sistema de archivos virtual de procesos (procfs).' },
    { name: 'root', tag: '#datos-usuario', lk: 'usuario', d: 'Directorio personal del superusuario root.' },
    { name: 'run', tag: '#datos-proceso', lk: 'tmpfs', d: 'Datos de ejecucion en tmpfs.' },
    { name: 'sbin', tag: '#fhs', lk: 'mergedUsr', d: 'Enlace de la fusion /usr hacia usr/sbin.' },
    { name: 'snap', tag: '#snap', lk: 'snap', d: 'Montajes de aplicaciones snap.' },
    { name: 'srv', tag: '#fhs', lk: 'fhs', d: 'Datos servidos por el sistema.' },
    { name: 'swap.img', tag: '#anomalia-top', lk: 'swap', d: 'Fichero de intercambio (swapfile) en la raiz.' },
    { name: 'sys', tag: '#datos-proceso', lk: 'sysfs', d: 'Sistema de archivos virtual del nucleo (sysfs).' },
    { name: 'tmp', tag: '#cache', lk: 'tmpfs', d: 'Ficheros temporales.' },
    { name: 'usr', tag: '#fhs', lk: 'fhs', d: 'Jerarquia secundaria de solo lectura.' },
    { name: 'var', tag: '#fhs', lk: 'fhs', d: 'Datos variables del sistema.' }
  ]
};

/* 3. Motor de anotacion: prioridad exact > dir > name > ext > top-level. */
function annotate(pathArg, type, target) {
  var p = (typeof pathArg === 'string' && pathArg.length) ? pathArg : '/';
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) { p = p.replace(/\/+$/, ''); }
  if (p === '') { p = '/'; }
  var segs = p.split('/').filter(function (s) { return s.length > 0; });
  var base = segs.length ? segs[segs.length - 1] : '';
  var dot = base.lastIndexOf('.');
  var ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  var ctx = { path: p, base: base, segs: segs, type: type, target: target, ext: ext };
  var i, r;

  function shape(r) {
    var tag = r.tag;
    var meta = TAG_META[tag] || {};
    var carac = [];
    (meta.caracteristicas || []).forEach(function (c) { carac.push({ clave: c.clave, valor: c.valor }); });
    (r.caracteristicas || []).forEach(function (c) { carac.push({ clave: c.clave, valor: c.valor }); });
    var fmt = r.formato || FORMATO_EXT[ctx.ext] || '';
    if (fmt) { carac.push({ clave: 'Formato', valor: fmt }); }
    var est = r.estandar || estandarDe(ctx.path);
    if (est) { carac.push({ clave: 'Estandar', valor: est }); }
    if (ctx.ext) { carac.push({ clave: 'Extension', valor: ctx.ext }); }
    var linkList = LINKS[r.lk] || LINKS.fhs;
    return {
      hashtag: tag,
      categoria: CATEGORIA[tag] || CATEGORIA['#fhs'],
      rol: r.rol || meta.rol || 'Sistema',
      descripcion_corta_ES: r.d || meta.descripcion || '',
      detalle: r.detalle || meta.detalle || '',
      formato: fmt,
      estandar: est,
      caracteristicas: carac,
      fuentes: linkList.map(function (x) { return { texto: x.texto, url: x.url, tipo: classifyFuente(x.url) }; }),
      /* compatibilidad hacia atras con versiones previas del visor */
      enlaces: linkList.map(function (x) { return { texto: x.texto, url: x.url }; })
    };
  }

  /* 3.1 exact-path */
  for (i = 0; i < RULES.exact.length; i++) {
    if (RULES.exact[i].p === p) { return shape(RULES.exact[i]); }
  }
  /* 3.2 directory-pattern (subarbol) */
  for (i = 0; i < RULES.dir.length; i++) {
    r = RULES.dir[i];
    if (p === r.p || p.indexOf(r.p + '/') === 0) { return shape(r); }
  }
  /* 3.2b nombre de directorio/fichero */
  for (i = 0; i < RULES.name.length; i++) {
    r = RULES.name[i];
    if ((r.name && base === r.name) ||
        (r.suffix && base.length > r.suffix.length && base.slice(-r.suffix.length) === r.suffix) ||
        (r.startswith && base.indexOf(r.startswith) === 0)) {
      return shape(r);
    }
  }
  /* 3.3 extension */
  for (i = 0; i < RULES.ext.length; i++) {
    r = RULES.ext[i];
    if (base.length > r.e.length && base.slice(-r.e.length).toLowerCase() === r.e) {
      return shape(r);
    }
  }
  /* 3.3b patrones especiales (bibliotecas versionadas, modulos comprimidos) */
  if (/\.so(\.[0-9]+)*$/.test(base)) {
    return shape({ tag: '#biblioteca', lk: 'biblioteca', d: 'Biblioteca compartida versionada (ELF).' });
  }
  if (/\.ko(\.(gz|xz|zst))?$/.test(base)) {
    return shape({ tag: '#kernel', lk: 'kernelMod', d: 'Modulo del nucleo, opcionalmente comprimido.' });
  }
  /* 3.4 top-level fallback */
  if (segs.length) {
    for (i = 0; i < RULES.top.length; i++) {
      if (RULES.top[i].name === segs[0]) { return shape(RULES.top[i]); }
    }
  }
  /* 3.5 por defecto */
  return shape({ tag: '#fhs', lk: 'fhs', d: 'Ruta generica dentro del arbol de directorios del sistema.' });
}

/* 4. Metricas de reglas */
function countByCategory() {
  var out = {};
  [RULES.exact, RULES.dir, RULES.name, RULES.ext, RULES.top].forEach(function (t) {
    t.forEach(function (r) { out[r.tag] = (out[r.tag] || 0) + 1; });
  });
  return out;
}
function ruleTotals() {
  return {
    exact: RULES.exact.length,
    directoryPattern: RULES.dir.length + RULES.name.length,
    extension: RULES.ext.length,
    topLevel: RULES.top.length
  };
}

module.exports = {
  annotate: annotate,
  KB_TAXONOMY: TAXONOMY,
  KB_CATEGORIA: CATEGORIA,
  KB_RULES: RULES,
  KB_LINKS: LINKS,
  KB_ruleTotals: ruleTotals,
  KB_countByCategory: countByCategory
};

/* 5. Emision del artefacto de navegador web/kb-rules.js */
function browserSource(totals) {
  var nl = '\n';
  return '/* web/kb-rules.js - GENERADO por build/knowledge-base.js. No editar a mano. */' + nl +
    '(function (root) {' + nl +
    '  "use strict";' + nl +
    '  var KB_TAXONOMY = ' + JSON.stringify(TAXONOMY, null, 2) + ';' + nl +
    '  var CATEGORIA = ' + JSON.stringify(CATEGORIA, null, 2) + ';' + nl +
    '  var LINKS = ' + JSON.stringify(LINKS, null, 2) + ';' + nl +
    '  var RULES = ' + JSON.stringify(RULES, null, 2) + ';' + nl +
    '  var FORMATO_EXT = ' + JSON.stringify(FORMATO_EXT, null, 2) + ';' + nl +
    '  var FHS_SECTION = ' + JSON.stringify(FHS_SECTION, null, 2) + ';' + nl +
    '  var TAG_META = {}; KB_TAXONOMY.forEach(function (t) { TAG_META[t.tag] = t; });' + nl +
    '  var classifyFuente = ' + classifyFuente.toString() + ';' + nl +
    '  var estandarDe = ' + estandarDe.toString() + ';' + nl +
    '  var annotate = ' + annotate.toString() + ';' + nl +
    '  root.KB_TAXONOMY = KB_TAXONOMY;' + nl +
    '  root.annotate = annotate;' + nl +
    '  root.KB_CATEGORIA = CATEGORIA;' + nl +
    '  root.KB_RULES = RULES;' + nl +
    '  root.KB_LINKS = LINKS;' + nl +
    '  root.KB_RULES_META = { ruleTotals: ' + JSON.stringify(totals) + ' };' + nl +
    '  if (typeof module !== "undefined" && module.exports) {' + nl +
    '    module.exports = { KB_TAXONOMY: KB_TAXONOMY, KB_CATEGORIA: CATEGORIA, KB_RULES: RULES, KB_LINKS: LINKS, annotate: annotate };' + nl +
    '  }' + nl +
    '})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));' + nl;
}

/* 6. Ejecucion: escribe data/kb-summary.json y web/kb-rules.js */
function main() {
  var repo = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  var manifestPath = path.join(repo, 'data', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('no se encuentra ' + manifestPath);
  }
  var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  var tops = manifest.topLevel.map(function (e) {
    var a = annotate('/' + e.name, e.type, e.target);
    return {
      name: e.name,
      hashtag: a.hashtag,
      categoria: a.categoria,
      rol: a.rol,
      descripcion_corta_ES: a.descripcion_corta_ES,
      detalle: a.detalle,
      formato: a.formato,
      estandar: a.estandar,
      caracteristicas: a.caracteristicas,
      fuentes: a.fuentes,
      enlaces: a.enlaces
    };
  });
  var summary = {
    generated: new Date().toISOString(),
    taxonomy: TAXONOMY,
    topLevelAnnotated: tops,
    ruleCountByCategory: countByCategory(),
    ruleTotals: ruleTotals()
  };
  var outDir = path.join(repo, 'data');
  if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
  fs.writeFileSync(path.join(outDir, 'kb-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(repo, 'web', 'kb-rules.js'), browserSource(summary.ruleTotals));
  return { repo: repo, summary: summary };
}

if (require.main === module) {
  try {
    const res = main();
    console.log('escrito: ' + path.join(res.repo, 'data', 'kb-summary.json'));
    console.log('escrito: ' + path.join(res.repo, 'web', 'kb-rules.js'));
    console.log('topLevelAnnotated: ' + res.summary.topLevelAnnotated.length);
    console.log('ruleTotals: ' + JSON.stringify(res.summary.ruleTotals));
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
