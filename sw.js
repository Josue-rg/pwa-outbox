/**
 * sw.js
 * Service Worker: cache del shell de la aplicacion y motor de sincronizacion
 * del patron Outbox usando la Background Sync API (Tema 5.3).
 *
 * Sin async/await: eventos con waitUntil() + cadenas de Promise.
 */

importScripts('./db-helper.js');

var CACHE_NOMBRE = 'outbox-shell-v2';
var ETIQUETA_SYNC = 'outbox-sync';
var API_URL = 'https://jsonplaceholder.typicode.com/posts';

// Todo con rutas relativas: GitHub Pages sirve la app desde un subdirectorio.
var ARCHIVOS_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db-helper.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(CACHE_NOMBRE)
      .then(function (cache) {
        return cache.addAll(ARCHIVOS_SHELL);
      })
      .then(function () {
        // Toma el control sin esperar a que se cierren las pestanas viejas.
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys()
      .then(function (nombres) {
        return Promise.all(
          nombres
            .filter(function (nombre) {
              return nombre !== CACHE_NOMBRE;
            })
            .map(function (nombre) {
              return caches.delete(nombre);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

/** Cache primero; si no esta, red y se guarda una copia. */
function desdeCache(solicitud) {
  return caches.match(solicitud).then(function (respuesta) {
    if (respuesta) {
      return respuesta;
    }

    return fetch(solicitud).then(function (respuestaRed) {
      if (respuestaRed && respuestaRed.ok) {
        var copia = respuestaRed.clone();

        caches.open(CACHE_NOMBRE).then(function (cache) {
          cache.put(solicitud, copia);
        });
      }

      return respuestaRed;
    });
  });
}

/** Red primero (contenido fresco) y cache como respaldo sin conexion. */
function desdeRed(solicitud) {
  return fetch(solicitud).catch(function () {
    return caches.match(solicitud).then(function (respuesta) {
      return respuesta || caches.match('./index.html');
    });
  });
}

self.addEventListener('fetch', function (evento) {
  var solicitud = evento.request;

  // Los POST (los envios del formulario) NO se interceptan: que el navegador
  // los haga tal cual para poder detectar el fallo de red en app.js.
  if (solicitud.method !== 'GET') {
    return;
  }

  var url = new URL(solicitud.url);

  // Recursos externos (la API de pruebas) van siempre a la red.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (solicitud.mode === 'navigate') {
    evento.respondWith(desdeRed(solicitud));
    return;
  }

  evento.respondWith(desdeCache(solicitud));
});

/** Envia un registro pendiente al servidor. Nunca lanza: devuelve resultado. */
function enviarPendiente(registro) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      titulo: registro.titulo,
      mensaje: registro.mensaje
    })
  })
    .then(function (respuesta) {
      if (!respuesta.ok) {
        throw new Error('El servidor respondio ' + respuesta.status);
      }

      return respuesta.json().then(function (datos) {
        return { ok: true, remoto: datos };
      });
    })
    .catch(function (error) {
      return { ok: false, error: error.message || 'Error de red' };
    });
}

/**
 * Recorre la cola de pendientes y la envia.
 * Cada registro se actualiza por separado: si uno falla, los demas siguen.
 */
function sincronizarOutbox() {
  return self.DBHelper.listarPorEstado(self.DBHelper.ESTADOS.PENDIENTE)
    .then(function (pendientes) {
      if (!pendientes.length) {
        return { total: 0, enviados: 0, fallidos: 0 };
      }

      var tareas = pendientes.map(function (registro) {
        var intentos = (registro.intentos || 0) + 1;

        return enviarPendiente(registro).then(function (resultado) {
          if (resultado.ok) {
            return self.DBHelper.actualizar(registro.id, {
              estado: self.DBHelper.ESTADOS.SINCRONIZADO,
              sincronizadoEn: Date.now(),
              intentos: intentos,
              ultimoError: null
            }).then(function () {
              return true;
            });
          }

          return self.DBHelper.actualizar(registro.id, {
            intentos: intentos,
            ultimoError: resultado.error
          }).then(function () {
            return false;
          });
        });
      });

      return Promise.all(tareas)
        .then(function (marcas) {
          var enviados = marcas.filter(function (ok) {
            return ok;
          }).length;

          return {
            total: pendientes.length,
            enviados: enviados,
            fallidos: pendientes.length - enviados
          };
        });
    })
    .catch(function (error) {
      return { total: 0, enviados: 0, fallidos: 0, error: error.message };
    });
}

/**
 * Avisa a todas las pestanas abiertas el resultado de una sincronizacion.
 * Asi la interfaz se actualiza sola, sin recargar.
 */
function avisarClientes(resultado) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({ tipo: 'SYNC_FIN', resultado: resultado });
      });

      return resultado;
    });
}

function sincronizarYAvisar() {
  return sincronizarOutbox().then(avisarClientes);
}

// El navegador dispara este evento cuando detecta que hay conexion.
self.addEventListener('sync', function (evento) {
  if (evento.tag !== ETIQUETA_SYNC) {
    return;
  }

  evento.waitUntil(sincronizarYAvisar());
});

// Permite forzar la sincronizacion desde la pagina (respaldo para navegadores
// sin SyncManager) mediante postMessage.
self.addEventListener('message', function (evento) {
  var datos = evento.data || {};

  if (datos.tipo !== 'SINCRONIZAR_AHORA') {
    return;
  }

  evento.waitUntil(sincronizarYAvisar());
});
