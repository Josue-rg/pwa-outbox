# Outbox PWA

Practica 5.1 - 5.3. Los envios que fallan por falta de red se guardan en
IndexedDB como `pendiente` y el service worker los reenvia despues con
Background Sync.

Demo: <https://josue-rg.github.io/pwa-outbox/>

## Como esta hecho

- JavaScript vanilla, sin librerias.
- IndexedDB: base `outbox-db`, almacen `outbox` con `keyPath: 'id'` y
  `autoIncrement`. Estados: `pendiente`, `sincronizado`, `error`.
- Service worker: cache del shell y motor de sincronizacion en el evento `sync`.
- Sin `async / await`: todo con `new Promise()`, `.then()`, `.catch()` y
  `Promise.all()`.
- Rutas relativas (`./`) para que funcione en GitHub Pages.

## Archivos

| Archivo | Que hace |
| --- | --- |
| `index.html` | Formulario, cola y registro. |
| `styles.css` | Estilos. |
| `db-helper.js` | Funciones de IndexedDB (sirve en la pagina y en el SW). |
| `app.js` | Envio, encolado, render y purga. |
| `sw.js` | Cache y sincronizacion en segundo plano. |
| `manifest.json`, `icons/` | Datos e iconos de la PWA. |

## Probar en local

```bash
python -m http.server 8080
```

Abrir <http://localhost:8080>.

1. Marcar "Simular que el server fallo", enviar un mensaje y ver que queda
   `pendiente` (DevTools -> Application -> IndexedDB -> `outbox-db`).
2. Quitar la marca y pulsar "Sincronizar": pasa a `sincronizado` sin
   recargar.
3. Poner la red en offline, enviar otro mensaje y volver a conectar.
4. "Borrar enviados" borra los que ya se enviaron.
