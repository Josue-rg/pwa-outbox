# GUIA PARA ESTUDIAR — Outbox PWA

> Esta guia es para ti, no para GitHub. La idea es que puedas leerla en voz
> alta y contarla con tus palabras.
>
> En el codigo, cada comentario empieza con el numero de paso que aparece aqui.

---

## 0. La idea en UNA frase

> La pagina intenta enviar. Si no puede, **guarda el mensaje**. Cuando vuelve
> la red, el **service worker** lo manda solo y le avisa a la pagina para que
> se actualice.

Eso es todo el proyecto. Lo demas son detalles.

---

## 1. Las 3 cosas que hace el sistema

Piensalo como una oficina de correos:

| # | Que hace | Donde vive |
| --- | --- | --- |
| 1 | **MOSTRAR** el formulario y la cola | `index.html` + `app.js` |
| 2 | **GUARDAR** lo que no se pudo enviar | `db-helper.js` + IndexedDB |
| 3 | **ENVIAR** cuando hay red | `sw.js` (o `app.js` como plan B) |

Regla de oro para no perderte:

> **La pagina pinta. El service worker manda. La base de datos guarda.**

---

## 2. El mapa del flujo

```
                 (1) submit
  [index.html] ─────────────► [app.js]
                                  │
                          (3) intenta POST
                             │           │
                           OK          FALLA
                             │           │
                           listo     (4) no se pierde
                                         │
                                (5) guardarPendiente
                                         │
                                (6) db-helper.js ──► IndexedDB
                                         │
                                (7) repinta la cola
                                         │
        ┌────────────────────────────────┘
        │
        │  (8) el ping ve que volvio la red
        ▼
     [app.js] ──(9) sync.register──► [sw.js]
                                         │
                                (11) lee los pendientes
                                (12) hace el POST de cada uno
                                (13) los marca sincronizado
                                         │
                                (14) avisa "SYNC_FIN"
                                         │
     [app.js] ◄───────────────────────────┘
        │
        └─(15) repinta: ahora se ven sincronizados
```

---

## 3. Quien es quien (en una linea cada uno)

- **`index.html`** → la cara. Formulario, lista y panel de log.
- **`app.js`** → el cerebro del primer plano. Recibe, envia, encola, vigila
  la red y pinta.
- **`db-helper.js`** → el archivero. La **unica** puerta a IndexedDB.
- **`sw.js`** → el mensajero. Trabaja en segundo plano, sin pantalla.
- **`manifest.json`** + **`icons/`** → identidad de la PWA. No participan
  en el flujo.
- **`styles.css`** → solo se ve bonito. No participa.
- **`geo-helper.js`** → la ubicacion, empaquetada en promesas.
- **`geo-ui.js`** → la tarjeta de pre-permiso, el resultado y el plan B.

---

## 4. Los estados de un mensaje

Solo hay dos de verdad:

- **`pendiente`** → esta en la cola, esperando salir.
- **`sincronizado`** → el POST salio bien, ya no se toca.

Cuando un reintento falla, **no cambia de estado**: sigue `pendiente` y guarda
el motivo en `ultimoError`. Asi el proximo intento lo vuelve a tomar.

> Ojo: el README habla de un estado `error`, pero el codigo no lo usa.
> Lo que se guarda es `ultimoError` dentro del pendiente. Si te preguntan,
> di esto: "el error no saca al mensaje de la cola, solo lo anota".

---

## 5. EL FLUJO COMPLETO, PASO POR PASO

### FASE 1 — El usuario manda el mensaje (pasos 1 a 7)

**Paso 1 · `index.html`**
El usuario pulsa **Enviar** → el navegador dispara el evento `submit`
del `<form id="form">`.
Aqui no hay logica: solo existe el formulario que arranca todo.

**Paso 2 · `app.js` → `enviar()`**
`iniciar()` ya dejo escuchando el formulario. `enviar()` hace
`preventDefault()` (para que la pagina no se recargue), lee el titulo y el
mensaje, y si alguno esta vacio se detiene.

**Paso 3 · `app.js` → `enviarAlServidor()`**
Primer intento real: un `POST` a la API.
Si la respuesta no es `ok`, lanza un error a proposito.
Este paso es el unico lugar de la pagina donde se hace el POST.

**Paso 4 · `app.js` → el `.catch` de `enviar()`**
Aqui esta la decision importante del proyecto:

> si fallo el envio, **no se borra el mensaje: se encola**.

**Paso 5 · `app.js` → `guardarPendiente()`**
Arma el registro que se va a guardar:
`titulo`, `mensaje`, `estado: 'pendiente'`, `creadoEn` y `ultimoError`
(con el motivo del fallo).

**Paso 6 · `db-helper.js` → `guardar()`**
Hace un `add` en IndexedDB dentro de una transaccion `readwrite`.
El `id` lo pone la base sola (`keyPath: 'id'` + `autoIncrement`) y vuelve
a `app.js`, que lo muestra en el log.

**Paso 7 · `app.js` → `refrescar()`**
Vuelve a pintar leyendo la base:

- `pintarCola()` → `listarTodos()` → dibuja cada registro.
- `pintarContador()` → `contarPorEstado('pendiente')` → badge "N en cola".

El mensaje ya aparece en pantalla como `pendiente`, con su nota de error
si la hubo.

> **Para decir en la defensa:** "Si el POST falla, el mensaje no se pierde:
> pasa a IndexedDB como pendiente y la pagina repinta la cola desde la base."

---

### FASE 2 — Vuelve la red (pasos 8 y 9)

**Paso 8 · `app.js` → `actualizarRed()`**
La pagina no confia en `navigator.onLine`. Cada 2 segundos `vigilarRed()`
hace un `fetch` real a `manifest.json` (`no-store`, con corte a los 2.5 s).
Cuando el resultado cambia y ahora **si** hay red, llama a `sincronizar()`.

**Paso 9 · `app.js` → `sincronizar()`**
Aqui se elige quien va a mandar, en este orden:

1. Si el navegador soporta **Background Sync** →
   `sync.register('outbox-sync')`. El navegador se encarga solo.
2. Si no lo soporta → `avisarAlSW()`: un `postMessage` al service worker.
3. Si no hay service worker, o algo falla → `sincronizarAqui()` (plan B).

> **Para decir en la defensa:** "La etiqueta `outbox-sync` esta igual en
> `app.js` y en `sw.js` porque es el acuerdo entre los dos: uno pide, el otro
> escucha ese nombre."

---

### FASE 3 — El service worker hace el trabajo (pasos 10 a 14)

**Paso 10 · `sw.js` → evento `sync` o `message`**
El SW se despierta por una de dos vias:

- `sync` → lo desperto el navegador con Background Sync.
- `message` → la pagina le mando `SINCRONIZAR_AHORA`.

Las dos terminan en `correrSync()`.

**Paso 11 · `sw.js` → `sincronizar()`**
Pide a `DBHelper.listarPorEstado('pendiente')` los mensajes de la cola.
Aqui se entiende por que `db-helper.js` tambien se carga en el SW: es la
misma base y la misma consulta.

**Paso 12 · `sw.js` → `enviarPendiente()`**
Hace el `POST` de cada registro, uno por uno. Es el mismo trabajo del paso 3,
pero ahora sin pagina de por medio.

**Paso 13 · `sw.js` → `DBHelper.actualizar()`**
Segun como salio el POST:

- Bien → `estado: 'sincronizado'` y `ultimoError: null`.
- Mal → solo escribe `ultimoError`. **Sigue pendiente** para el proximo intento.

**Paso 14 · `sw.js` → `avisar()`**
Cuando terminan todas las tareas, busca las ventanas abiertas con
`clients.matchAll()` y les manda `{ tipo: 'SYNC_FIN' }`.

> **Para decir en la defensa:** "El service worker no toca la pantalla.
> Solo manda datos y avisa; quien dibuja es la pagina."

---

### FASE 4 — La pagina se entera (paso 15)

**Paso 15 · `app.js` → `escucharSW()`**
Ya tenia escuchando el evento `message`. Cuando llega `SYNC_FIN`, escribe
"Se sincronizo." en el log y llama a `refrescar()`.

Por eso el usuario ve el cambio de `pendiente` a `sincronizado`
**sin recargar la pagina**.

> **Para decir en la defensa:** "La pagina no fue la que envio, solo se entero
> por mensaje. Por eso se actualiza sola."

---

## 6. El cache (C1, C2, C3) — esto es aparte del flujo

Esto es lo que hace que la app **abra aunque no haya red**.

| Codigo | Evento | Que hace |
| --- | --- | --- |
| **C1** | `install` | Guarda el shell (`index.html`, CSS, JS, iconos) en el cache `outbox-v6`. |
| **C2** | `activate` | Borra los caches viejos y toma el control de las paginas abiertas. |
| **C3** | `fetch` | Si es `GET`, responde **del cache primero**; si no esta, va a la red. |

Tres cosas que te pueden preguntar:

- **Por que `outbox-v5`** → el nombre es la version. Al cambiarlo se borra el
  cache viejo y se descargan archivos nuevos.
- **Por que `skipWaiting()` y `clients.claim()`** → para que el SW nuevo no
  espere a que cierres todas las pestanas. Toma el control de inmediato.
- **Por que solo `GET`** → el cache es para archivos. El `POST` de la API se
  deja pasar a proposito, para que falle de verdad y se vea la cola.

---

## 7. El boton "Borrar enviados" (P1)

`purgar()` en `app.js` → `DBHelper.eliminarPorEstado('sincronizado')`.
Lista los sincronizados y los borra uno por uno. Los `pendiente`
**nunca se borran** desde la interfaz.

---

## 8. Planes B (si algo no existe, igual funciona)

| Situacion | Quien manda | Como |
| --- | --- | --- |
| Todo normal | El navegador | `sync.register` → evento `sync` |
| Hay SW, pero no Background Sync | El SW | `postMessage` → evento `message` |
| Falla `sync.register` | El SW o la pagina | `avisarAlSW()` y, si no hay SW, `sincronizarAqui()` |
| No hay service worker | La pagina | `sincronizarAqui()` |
| El POST vuelve a fallar | Nadie | Guarda `ultimoError` y reintenta despues |

`sincronizarAqui()` es la red de seguridad: hace lo mismo que el SW
(pasos 11, 12 y 13) pero desde la pagina.

---

## 9. Preguntas rapidas (con respuesta corta)

**Por que IndexedDB y no `localStorage`?**
Porque `localStorage` es sincrono, solo guarda texto y no tiene indices.
IndexedDB es asincrono, guarda objetos, tiene indices y **el service worker
tambien puede usarla**.

**Por que un solo `db-helper.js`?**
Porque la pagina y el SW usan la misma base. Se escribe una vez y se comparte:
la pagina lo carga con `<script>` y el SW con `importScripts()`.

**Por que `autoIncrement`?**
Para no inventar ids a mano. La base asigna el `id` y luego sirve para
`get`, `put` y `delete`.

**Por que `Promise.all()`?**
Porque los pendientes son independientes: se mandan en paralelo y es mas
rapido. Cada tarea tiene su propio `.catch` para que un fallo no tumbe al resto.

**Se puede enviar dos veces el mismo mensaje?**
Si. El sistema garantiza **"al menos una vez"**, no "exactamente una".
Si el servidor recibe el POST pero la respuesta se pierde, el mensaje sigue
pendiente y se reenvia. En produccion se arreglaria con un id de idempotencia.

**Por que se vigila la red con `fetch`?**
Porque `navigator.onLine` solo dice si hay cable/WiFi, no si el servidor
responde. El ping a `manifest.json` es una prueba real.

**Que pasa si recargo la pagina?**
Nada se pierde: la cola esta en IndexedDB, no en memoria. Al abrir,
`iniciar()` → `refrescar()` la pinta de nuevo, y si hay red se reintenta.

---

## 10. Chuleta final (esto es lo que tienes que recordar)

1. **Formulario** → `app.js` intenta `POST`.
2. **Si falla** → `db-helper` guarda en IndexedDB como `pendiente`.
3. **La pagina pinta** → lista y contador salen de la base.
4. **Ping cada 2 s** → cuando vuelve la red, se dispara la sincronizacion.
5. **Background Sync** → el navegador despierta al SW con la etiqueta
   `outbox-sync`.
6. **El SW lee pendientes** → hace `POST` → los marca `sincronizado`.
7. **El SW avisa** `SYNC_FIN` → la pagina repinta sin recargar.
8. **Cache** → guarda el shell para que abra sin red.
9. **Plan B** → si no hay SW, la pagina hace el trabajo.

### Guion de 30 segundos

> "La app intenta mandar el mensaje de inmediato. Si falla, lo guarda en
> IndexedDB como pendiente en vez de perderlo. La pagina revisa la red cada
> dos segundos con un fetch real; cuando vuelve, pide la sincronizacion por
> Background Sync o le avisa al service worker por mensaje. El service worker
> lee los pendientes de la misma base, hace los POST, los marca sincronizados
> y avisa a la pagina para que repinte. Todo el acceso a IndexedDB esta en un
> solo archivo, db-helper, que comparten la pagina y el service worker."

---

## 11. Donde verlo funcionando (DevTools)

- **Application → Service Workers** → estado del SW y su evento `sync`.
- **Application → IndexedDB → `outbox-db` → `outbox`** → aqui se ve la cola
  con `estado` y `ultimoError`. Es la prueba mas fuerte.
- **Application → Cache Storage → `outbox-v6`** → los archivos del shell.
- **Application → Background Services → Background Sync** → la etiqueta
  `outbox-sync`.
- **Network → Offline** → la forma mas rapida de provocar todo el flujo.
- **Panel "Lo que pasa"** → el log cuenta los pasos en orden.

---

## 12. Practica de ubicacion (geo-helper.js + geo-ui.js)

### El flujo en 5 pasos

```
(1) abrir la app
      │  geo-ui.js pregunta el permiso con permissions.query
      │  (esto NO abre el dialogo del navegador)
      ▼
(2) clic "Ver mi ubicacion"
      │  aparece la tarjeta de Pre-Permiso
      ▼
(3) clic "Permitir ubicacion"   <-- gesto real del usuario
      │  GeoHelper.obtenerUbicacion() -> new Promise(...)
      │  navigator.geolocation.getCurrentPosition(...)
      ▼
(4) respuesta
      │  coords.latitude / coords.longitude / coords.accuracy
      ▼
(5) pintarResultado()
         accuracy <= 50 m  -> GPS alta precision
         accuracy <= 500 m -> Wi-Fi / antenas
         accuracy > 500 m  -> IP (muy aproximada)
```

### Los errores y el Plan B

| Codigo | Que significa | Que hace la app |
| --- | --- | --- |
| `PERMISO` | El usuario dijo que no o el navegador bloqueo el sitio. | Muestra el selector de zona y explica como revisar el candado. |
| `TIMEOUT` | El navegador se tardo (tipico en laptop sin GPS). | Muestra zona manual y el boton "Reintentar sin GPS". |
| `SIN_SENAL` | No pudo calcular la posicion. | Muestra zona manual. |
| `SIN_SOPORTE` | El navegador no trae geolocalizacion. | Deja solo la zona manual. |

> **Para decir en la defensa:** "Nunca llamamos a `getCurrentPosition` al
> cargar. Primero mostramos una tarjeta que explica el uso; el dialogo nativo
> solo sale cuando el usuario pulsa Permitir. Eso cumple el Pre-Permiso y en
> iOS es obligatorio, porque Safari exige un clic directo."

### Lo que hay que recordar por plataforma

- **iPhone / Safari:** el permiso tiene que venir de un clic. Ademas, Safari y
  la PWA instalada en pantalla de inicio guardan permisos **por separado**.
- **Laptop sin GPS:** no hay chip satelital; el navegador usa Wi-Fi o IP, el
  margen sube y `enableHighAccuracy: true` puede terminar en `TIMEOUT`.
- **HTTPS:** la geolocalizacion solo funciona en contexto seguro
  (`https://` o `localhost`). GitHub Pages ya es HTTPS.

### Donde verlo en DevTools

- **Sensors / Location** → simular coordenadas y ver cambiar el margen.
- **Application / Permissions** → conceder o bloquear la ubicacion.
- **Consola** → los errores nativos traen `code` 1, 2 o 3; `geo-helper.js`
  los convierte en `PERMISO`, `SIN_SENAL` y `TIMEOUT`.
