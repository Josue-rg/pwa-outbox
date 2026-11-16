/**
 * db-helper.js
 * Mini-wrapper promisificado sobre IndexedDB (JavaScript vanilla, sin librerias).
 *
 * Se usa igual en la pagina (app.js) y dentro del Service Worker (sw.js), porque
 * ambos contextos exponen `indexedDB` en su objeto global.
 *
 * Regla de la practica: cero async/await. Toda la asincronia se resuelve con
 * `new Promise()`, `.then()`, `.catch()` y `Promise.all()`.
 */
(function (global) {
  'use strict';

  var NOMBRE_BD = 'outbox-db';
  var VERSION_BD = 1;
  var ALMACEN = 'outbox';

  var ESTADOS = {
    PENDIENTE: 'pendiente',
    SINCRONIZADO: 'sincronizado',
    ERROR: 'error'
  };

  // Cache de la conexion: abrir la base en cada operacion es caro.
  var conexionActual = null;

  /**
   * Abre (o crea) la base de datos.
   * `onupgradeneeded` solo se dispara cuando la version pedida es mayor que la
   * guardada en disco: ahi es donde se define el esquema.
   */
  function abrir() {
    if (conexionActual) {
      return Promise.resolve(conexionActual);
    }

    return new Promise(function (resolve, reject) {
      var solicitud = global.indexedDB.open(NOMBRE_BD, VERSION_BD);

      solicitud.onupgradeneeded = function (evento) {
        var db = evento.target.result;

        if (!db.objectStoreNames.contains(ALMACEN)) {
          // keyPath 'id' + autoIncrement: IndexedDB asigna el id solo.
          var almacen = db.createObjectStore(ALMACEN, {
            keyPath: 'id',
            autoIncrement: true
          });

          // Indices para consultar sin recorrer toda la cola.
          almacen.createIndex('por_estado', 'estado', { unique: false });
          almacen.createIndex('por_fecha', 'creadoEn', { unique: false });
        }
      };

      solicitud.onsuccess = function (evento) {
        var db = evento.target.result;

        // Si otra pestana pide una version nueva, cerramos esta conexion.
        db.onversionchange = function () {
          db.close();
          conexionActual = null;
        };

        conexionActual = db;
        resolve(db);
      };

      solicitud.onerror = function () {
        reject(solicitud.error || new Error('No se pudo abrir IndexedDB'));
      };

      solicitud.onblocked = function () {
        reject(new Error('La base esta bloqueada por otra pestana abierta'));
      };
    });
  }

  /**
   * Envuelve una transaccion en una Promise.
   *
   * @param {'readonly'|'readwrite'} modo
   * @param {Function} operacion recibe el objectStore y devuelve un IDBRequest
   *                             (o un arreglo de IDBRequest).
   *
   * Regla de oro: 'readonly' para leer, 'readwrite' para crear/editar/borrar.
   * Si se usa 'readonly' con put/delete, la transaccion falla.
   */
  function transaccion(modo, operacion) {
    return abrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        var resultados = [];

        try {
          tx = db.transaction(ALMACEN, modo);
        } catch (error) {
          reject(error);
          return;
        }

        var almacen = tx.objectStore(ALMACEN);
        var pendientes = operacion(almacen);

        if (pendientes) {
          // Normalizamos: siempre trabajamos con un arreglo de peticiones.
          var peticiones = Array.isArray(pendientes) ? pendientes : [pendientes];

          peticiones.forEach(function (peticion, indice) {
            peticion.onsuccess = function () {
              resultados[indice] = peticion.result;
            };
          });
        }

        // `oncomplete` es la unica senal fiable de que la escritura se
        // confirmo en disco; por eso resolvemos ahi y no en cada onsuccess.
        tx.oncomplete = function () {
          resolve(resultados.length === 1 ? resultados[0] : resultados);
        };

        tx.onerror = function () {
          reject(tx.error || new Error('Error dentro de la transaccion'));
        };

        tx.onabort = function () {
          reject(tx.error || new Error('Transaccion abortada'));
        };
      });
    });
  }

  /** Guarda un registro nuevo y devuelve el id generado. */
  function guardar(registro) {
    return transaccion('readwrite', function (almacen) {
      return almacen.add(registro);
    });
  }

  /** Lee un registro por su id (undefined si no existe). */
  function obtenerPorId(id) {
    return transaccion('readonly', function (almacen) {
      return almacen.get(id);
    });
  }

  /** Devuelve todos los registros del almacen. */
  function listarTodos() {
    return transaccion('readonly', function (almacen) {
      return almacen.getAll();
    }).then(function (registros) {
      return registros || [];
    });
  }

  /** Devuelve los registros de un estado ('pendiente', 'sincronizado', ...). */
  function listarPorEstado(estado) {
    return transaccion('readonly', function (almacen) {
      return almacen.index('por_estado').getAll(estado);
    }).then(function (registros) {
      return registros || [];
    });
  }

  /** Cuenta cuantos registros hay en un estado. */
  function contarPorEstado(estado) {
    return transaccion('readonly', function (almacen) {
      return almacen.index('por_estado').count(estado);
    }).then(function (total) {
      return total || 0;
    });
  }

  /**
   * Actualiza un registro existente combinando los campos nuevos.
   * Se hace get + put dentro de la MISMA transaccion readwrite para que no
   * exista una ventana en la que otra pestana lo modifique a medias.
   */
  function actualizar(id, cambios) {
    return abrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(ALMACEN, 'readwrite');
        var almacen = tx.objectStore(ALMACEN);
        var registroActualizado = null;

        almacen.get(id).onsuccess = function (evento) {
          var registro = evento.target.result;

          if (!registro) {
            reject(new Error('No existe el registro con id ' + id));
            tx.abort();
            return;
          }

          registroActualizado = Object.assign({}, registro, cambios);
          almacen.put(registroActualizado);
        };

        tx.oncomplete = function () {
          resolve(registroActualizado);
        };

        tx.onerror = function () {
          reject(tx.error || new Error('No se pudo actualizar el registro'));
        };

        tx.onabort = function () {
          if (registroActualizado) {
            resolve(registroActualizado);
          } else {
            reject(tx.error || new Error('Actualizacion abortada'));
          }
        };
      });
    });
  }

  /** Borra un registro por id. */
  function eliminar(id) {
    return transaccion('readwrite', function (almacen) {
      return almacen.delete(id);
    });
  }

  /** Borra TODOS los registros (util al purgar o reiniciar la demo). */
  function vaciar() {
    return transaccion('readwrite', function (almacen) {
      return almacen.clear();
    });
  }

  /** Borra todos los registros de un estado. Devuelve cuantos elimino. */
  function eliminarPorEstado(estado) {
    return abrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(ALMACEN, 'readwrite');
        var solicitados = 0;

        tx.objectStore(ALMACEN)
          .index('por_estado')
          .openCursor(IDBKeyRange.only(estado))
          .onsuccess = function (evento) {
            var cursor = evento.target.result;

            if (!cursor) {
              return;
            }

            cursor.delete();
            solicitados += 1;
            cursor.continue();
          };

        tx.oncomplete = function () {
          resolve(solicitados);
        };

        tx.onerror = function () {
          reject(tx.error || new Error('No se pudo vaciar el estado ' + estado));
        };
      });
    });
  }

  /** Cierra la conexion (lo usa el Service Worker al terminar una sync). */
  function cerrar() {
    if (!conexionActual) {
      return Promise.resolve();
    }

    conexionActual.close();
    conexionActual = null;
    return Promise.resolve();
  }

  /** Borra la base completa. Se usa solo en pruebas manuales. */
  function eliminarBaseDeDatos() {
    return cerrar().then(function () {
      return new Promise(function (resolve, reject) {
        var solicitud = global.indexedDB.deleteDatabase(NOMBRE_BD);

        solicitud.onsuccess = function () {
          resolve(true);
        };

        solicitud.onerror = function () {
          reject(solicitud.error || new Error('No se pudo borrar la base'));
        };

        solicitud.onblocked = function () {
          reject(new Error('Hay otra pestana usando la base'));
        };
      });
    });
  }

  var DBHelper = {
    ESTADOS: ESTADOS,
    NOMBRE_BD: NOMBRE_BD,
    ALMACEN: ALMACEN,
    abrir: abrir,
    guardar: guardar,
    obtenerPorId: obtenerPorId,
    listarTodos: listarTodos,
    listarPorEstado: listarPorEstado,
    contarPorEstado: contarPorEstado,
    actualizar: actualizar,
    eliminar: eliminar,
    vaciar: vaciar,
    eliminarPorEstado: eliminarPorEstado,
    cerrar: cerrar,
    eliminarBaseDeDatos: eliminarBaseDeDatos
  };

  // Funciona tanto en window como en self (Service Worker).
  global.DBHelper = DBHelper;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBHelper;
  }
})(typeof self !== 'undefined' ? self : this);
