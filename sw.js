importScripts('./db-helper.js');

var CACHE = 'outbox-v5';
var ETIQUETA = 'outbox-sync';
var API = 'https://jsonplaceholder.typicode.com/posts';

var ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];





// 10.1. Con Background Sync: el navegador dispara 'sync' solo cuando hay red o lo reintenta
self.addEventListener('sync', function (evento) {
  if (evento.tag === ETIQUETA) {
    evento.waitUntil(correrSync());
  }
});

// 10.2. Sinn Background Sync: la pagina no tiene SyncManager y pide el trabajo
//  por postMessage (lo manda avisarAlSW en app.js).
self.addEventListener('message', function (evento) {
  if (evento.data && evento.data.tipo === 'SINCRONIZAR_AHORA') {
    evento.waitUntil(correrSync());
  }
});

// 11. Pide a DBHelper los registros 'pendiente' (db-helper.js).
// 13. Si el POST sale, pasa sincronizado'; si falla, guarda el ultimoError y queda pendiente.
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

// Aviso al 14.
function correrSync() {
  return sincronizar().then(avisar);
}

// 12.- POST de cada registro uno por uno.
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

// 14. Avisa a todas las ventanas abiertas que ya termino (SYNC_FIN).
function avisar() {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({ tipo: 'SYNC_FIN' });
      });
    });
}





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

// C2. ACTIVATE: borra caches de versiones viejas y toma el control de las paginas ya abiertas (clients.claim).
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

// C3. FETCH: estrategia cache-first solo para GET. Si esta en cache responde de ahi; si no, va a la red. Los POST no se interceptan.
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