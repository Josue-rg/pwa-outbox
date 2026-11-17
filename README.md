# Outbox PWA

Practica de persistencia offline: los envios `POST` que fallan por falta de red se
guardan en **IndexedDB** como `pendiente` y se sincronizan despues desde el
**Service Worker** con la Background Sync API.

## Reglas tecnicas

- 100% JavaScript vanilla (sin PouchDB, Dexie, idb ni Workbox).
- Cero `async / await`: toda la asincronia se maneja con `new Promise()`,
  `.then()`, `.catch()` y `Promise.all()`.

## Estructura

| Archivo | Rol |
| --- | --- |
| `index.html` | Interfaz: formulario, cola outbox y registro de actividad. |
| `styles.css` | Estilos de la aplicacion. |
| `db-helper.js` | Mini-wrapper promisificado de IndexedDB. |
| `app.js` | Logica de la interfaz y encolado de envios fallidos. |
| `sw.js` | Service Worker: cache del shell y sincronizacion en segundo plano. |
| `manifest.json` | Metadatos de la PWA. |

## Avance

- [x] Estructura base de la interfaz.
- [x] Mini-wrapper de IndexedDB (Tema 5.1).
- [x] Patron Outbox y purga (Tema 5.2).
- [x] Manifest e iconos.
- [x] Service Worker con cache del shell.
- [x] Background Sync con `postMessage` (Tema 5.3).
- [x] Respaldo con el evento `online`.
- [ ] Despliegue en GitHub Pages.
