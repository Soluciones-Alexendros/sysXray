# Fase Antigua — veredicto de la placa cero

Placa: `tree /` sin `-a`, 2026-10-12, 3.233.219 entradas. Ver [DATA-CONTRACT.md](../DATA-CONTRACT.md) y [data/audit-report.json](../data/audit-report.json).

## ¿Se cumple el FHS en su totalidad?

No. Los nombres canónicos están; la forma que describe el FHS 3.0 de 2015, no.

| Criterio | Resultado |
|----------|-----------|
| Nombres FHS 3.0 en la raíz | Presentes (`missing: []`) |
| Forma FHS 3.0 (`/bin`, `/lib` como directorios) | No: son enlaces usr-merge |
| Forma UAPI.9 / file-hierarchy(7) | Sí: usr-merge esperado |
| Extras | `snap`, `swap.img`, `lost+found`, `cdrom`, `desplantar.md` |
| Home en la placa | Inobservable (horizonte `no_dotfiles`) |
| Home medido en el sistema | Ocultos en `/home/alexendros/`; juzgar con XDG, no con FHS |

Cánones: [fhs-3.0.json](fhs-3.0.json), [hier-7.json](hier-7.json), [uapi-file-hierarchy.json](uapi-file-hierarchy.json), [xdg.json](xdg.json).

## Arranque y Secure Boot

Secure Boot enabled. Lockdown del núcleo en integrity. No esconden los nombres con punto; cierran lecturas de la imagen del núcleo y órdenes de GRUB que reescriben la cadena.

Explicación del interruptor: [secure-boot-lockdown.json](secure-boot-lockdown.json). Órdenes de la siguiente placa: [grub-ordenes.json](grub-ordenes.json).

## brokenOculto

Los 2.375 `brokenOculto` son ceguera del instrumento (`tree` sin `-a`), no roturas. En el sobre LinkML: `links_to` + `support: not_in_plate` + horizonte `no_dotfiles`.
