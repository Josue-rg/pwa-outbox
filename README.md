# Outbox PWA

Practica de persistencia offline (Temas 5.1, 5.2 y 5.3): los envios `POST` que
fallan por falta de red se guardan en **IndexedDB** con estado `pendiente` y se
sincronizan despues desde el **Service Worker** usando la Background Sync API.

Aplicacion publicada: <https://josue-rg.github.io/pwa-outbox/>

## Reglas tecnicas que cumple

- **100% JavaScript vanilla**: sin PouchDB, Dexie, idb, Workbox ni ninguna otra
  libreria.
- **Cero `async / await`**: toda la asincronia se resuelve con `new Promise()`,
  `.then()`, `.catch()` y `Promise.all()`.
- **Rutas relativas** (`./`) para que funcione en un subdirectorio de GitHub
  Pages.

## Estructura

| Archivo | Rol |
| --- | --- |
| `index.html` | Interfaz: formulario, cola outbox y registro de actividad. |
| `styles.css` | Estilos. |
| `db-helper.js` | Mini-wrapper promisificado de IndexedDB (sirve en `window` y en `self`). |
| `app.js` | Envio `POST`, encolado de fallos, render de la cola, purga y comunicacion con el Service Worker. |
| `sw.js` | Cache del shell y motor de sincronizacion en segundo plano. |
| `manifest.json` | Metadatos de la PWA. |
| `icons/` | Iconos 192, 512 y maskable. |

## Como funciona

1. **Tema 5.1** - `db-helper.js` abre la base `outbox-db` (version 1) y dentro de
   `onupgradeneeded` crea el object store `outbox` (`keyPath: 'id'`,
   `autoIncrement`) con los indices `por_estado` y `por_fecha`. Cada operacion
   se envuelve en una `Promise` sobre la transaccion, usando `readonly` para
   leer y `readwrite` para escribir.
2. **Tema 5.2** - Al enviar el formulario se intenta el `POST`. Si falla (sin
   red, servidor con error o fallo simulado), el mensaje se guarda como
   `pendiente`. La cola se pinta desde IndexedDB y el boton "Purgar
   sincronizados" borra los registros ya enviados.
3. **Tema 5.3** - El Service Worker recorre los pendientes dentro del evento
   `sync` (etiqueta `outbox-sync`), los envia con `fetch` y actualiza cada
   registro (`sincronizado` + `intentos` + `sincronizadoEn`, o `ultimoError` si
   vuelve a fallar). Al terminar avisa a la interfaz con `postMessage`
   (`SYNC_FIN`) y la pagina se redibuja sola. En navegadores sin `SyncManager`
   (Safari/iOS) se usa el mismo motor por `postMessage`, y el evento `online`
   actua como respaldo.

## Probar en local

Sirve la carpeta por HTTP (el Service Worker no funciona con `file://`):

```bash
python -m http.server 8080
# abrir http://localhost:8080
```

Pruebas sugeridas:

1. Marcar "Simular servidor caido", enviar un mensaje: aparece en la cola como
   `PENDIENTE` (verificar en DevTools -> Application -> IndexedDB -> `outbox-db`).
2. Quitar la marca y pulsar "Sincronizar ahora": el registro pasa a
   `SINCRONIZADO` sin recargar la pagina.
3. Desconectar la red (DevTools -> Network -> Offline), enviar otro mensaje y
   volver a conectarse: se sincroniza al recuperar la conexion.
4. Pulsar "Purgar sincronizados" y comprobar que desaparecen de la cola y de
   IndexedDB.

## Despliegue en GitHub Pages

1. Subir el repositorio a GitHub (`git push`).
2. Settings -> Pages -> Deploy from a branch -> `main` / `/ (root)`.
3. Abrir `https://<usuario>.github.io/pwa-outbox/`.

El Service Worker y la Background Sync requieren HTTPS (o `localhost`), por eso
Pages funciona para la entrega.

## Notas

- `CACHE_NOMBRE` esta en `outbox-shell-v2`. Si se modifican los archivos del
  shell hay que subir ese numero para invalidar el cache viejo.
- Los `POST` del formulario no se interceptan en el `fetch` del Service Worker:
  asi la pagina puede detectar el fallo y encolarlo.
