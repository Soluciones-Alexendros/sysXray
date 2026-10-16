# Núcleo de sysXray

Este trabajo es para Daniel Domingo Benito, que pedía callar porque no quería saber nada de ordenadores. La explicación queda escrita y se puede comprobar.

El contrato normativo es [`SPECLinkML-sysXray.txt`](../SPECLinkML-sysXray.txt). Las fichas de canon son JSON en [`docs/`](.) (instancias `CanonFicha`). El dossier legible es [`LinkML/LinkML.html`](../LinkML/LinkML.html).

## Nombre

**sysXray** — system X-ray: lectura clínica del sistema con un haz que no reescribe el arranque. SIG:se-ven. El objeto es un ordenador doméstico.

## Tres palabras

- **Galaxia.** Del griego γαλαξίας, «el círculo lechoso», de γάλα, leche: la Vía Láctea como banda, no como organigrama. Sistema ligado por gravedad: una estrella pertenece a la vez al disco, a un brazo y a un cúmulo. La contención es una relación entre otras.
- **Galáctico.** Lo propio de esa escala. Aquí nombra la representación cuya unidad es la relación vista desde un horizonte, no el sangrado de un listado.
- **Universo.** Del latín *universum*, «vuelto uno». El universo observable acaba en un horizonte: lo que el instrumento no ve no se rellena.

## Ordenador doméstico

El que hay en la mayoría de casas que tienen ordenador. Su potencia la limitan el precio y lo que el comercio ofrece. Recursos materiales de la relación: pantalla, teclado y puntero. El teclado y el puntero piden; la pantalla responde. Toda afirmación del proyecto es o bien algo que la pantalla puede mostrar, o bien algo marcado como no observado.

Instrumentos de solo lectura. El haz no se usa para reescribir el arranque.

## Tres capas

1. **Placa.** Captura cruda, inmutable: instrumento, régimen, instante, horizonte, cuerpo. La de octubre es `tree` sin `-a` (horizonte `no_dotfiles`).
2. **Carta.** Relaciones sacadas de placas (`contains`, `links_to`, `denies`, …). El visor actual proyecta una sola placa; no es la carta.
3. **Juicio.** Regla aplicada después, citando una `Authority` / `CanonFicha` por URL. «Cumple» no es propiedad del disco.

LinkML tipa el acto (placa, afirmación, juicio, canon). No tipa los 3,2 millones de rutas. Las seis prohibiciones están en el contrato.

## Fuentes

| Ficha | Papel |
|-------|--------|
| [fhs-3.0.json](fhs-3.0.json) | Nombres de la raíz (2015) |
| [hier-7.json](hier-7.json) | Man local; /bin como directorio |
| [uapi-file-hierarchy.json](uapi-file-hierarchy.json) | Canon vivo / usr-merge |
| [xdg.json](xdg.json) | Home mutable |
| [gnu.json](gnu.json) | ls y GRUB |
| [redhat.json](redhat.json) | Práctica de fabricante |
| [secure-boot-lockdown.json](secure-boot-lockdown.json) | Qué es Secure Boot y qué mueve el interruptor |
| [grub-ordenes.json](grub-ordenes.json) | Órdenes medidas para este disco |
