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

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ARCHIVOS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

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

function avisar() {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({ tipo: 'SYNC_FIN' });
      });
    });
}

function correrSync() {
  return sincronizar().then(avisar);
}

self.addEventListener('sync', function (evento) {
  if (evento.tag === ETIQUETA) {
    evento.waitUntil(correrSync());
  }
});

self.addEventListener('message', function (evento) {
  if (evento.data && evento.data.tipo === 'SINCRONIZAR_AHORA') {
    evento.waitUntil(correrSync());
  }
});
