// ============================================================
// sw.js - FLUJO EN SEGUNDO PLANO (pasos 10 a 14 y cache C1-C3)
// No tiene DOM. El navegador lo despierta con eventos: instala,
// activa, intercepta GET y dispara la sincronizacion.
// ============================================================

// Carga la misma capa de IndexedDB que usa la pagina (pasos 6, 11, 13).
importScripts('./db-helper.js');

var CACHE = 'outbox-v6';
var ETIQUETA = 'outbox-sync';
var API = 'https://jsonplaceholder.typicode.com/posts';

var ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './geo-helper.js',
  './geo-ui.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// C1. INSTALL: guarda el "shell" (HTML, CSS, JS, iconos) en Cache Storage.
self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ARCHIVOS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// C2. ACTIVATE: borra caches de versiones viejas y toma el control
//     de las paginas ya abiertas (clients.claim).
self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.filter(function (nombre) {
        return nombre !== CACHE;
      }).map(function (nombre) {
        return caches.delete(nombre);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// C3. FETCH: estrategia cache-first solo para GET. Si esta en cache
//     responde de ahi; si no, va a la red. Los POST no se interceptan.
self.addEventListener('fetch', function (evento) {
  if (evento.request.method !== 'GET') {
    return;
  }

  evento.respondWith(
    caches.match(evento.request).then(function (guardada) {
      return guardada || fetch(evento.request);
    })
  );
});

// 12. Igual que el paso 3 pero desde el SW: POST de un solo registro.
function enviarPendiente(registro) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: registro.titulo, mensaje: registro.mensaje })
  }).then(function (respuesta) {
    if (!respuesta.ok) {
      throw new Error('el server dijo ' + respuesta.status);
    }
  });
}

// 11. Pide a DBHelper los registros 'pendiente' (db-helper.js).
// 13. Por cada uno: si el POST sale, pasa a 'sincronizado'; si falla,
//     solo guarda el ultimoError y lo deja pendiente para reintentar.
function sincronizar() {
  return self.DBHelper.listarPorEstado('pendiente').then(function (pendientes) {
    var tareas = pendientes.map(function (registro) {
      return enviarPendiente(registro)
        .then(function () {
          return self.DBHelper.actualizar(registro.id, {
            estado: 'sincronizado',
            ultimoError: null
          });
        })
        .catch(function (error) {
          return self.DBHelper.actualizar(registro.id, {
            ultimoError: error.message
          });
        });
    });

    return Promise.all(tareas);
  });
}

// 14. Avisa a todas las ventanas abiertas que ya termino (SYNC_FIN).
function avisar() {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({ tipo: 'SYNC_FIN' });
      });
    });
}

// Orden del trabajo: 11 + 12 + 13, y al final el aviso del 14.
function correrSync() {
  return sincronizar().then(avisar);
}

// 10a. Background Sync: el navegador dispara 'sync' solo cuando hay red
//      (o reintenta solo si falla). La etiqueta tiene que coincidir con app.js.
self.addEventListener('sync', function (evento) {
  if (evento.tag === ETIQUETA) {
    evento.waitUntil(correrSync());
  }
});

// 10b. Camino alterno: la pagina no tiene SyncManager y pide el trabajo
//      por postMessage (lo manda avisarAlSW en app.js).
self.addEventListener('message', function (evento) {
  if (evento.data && evento.data.tipo === 'SINCRONIZAR_AHORA') {
    evento.waitUntil(correrSync());
  }
});
