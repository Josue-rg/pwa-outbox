var DBHelper = (function () {
  var NOMBRE = 'outbox-db';
  var ALMACEN = 'outbox';
  var conexion = null;

  function abrir() {
    if (conexion) {
      return Promise.resolve(conexion);
    }

    return new Promise(function (resolver, rechazar) {
      var peticion = indexedDB.open(NOMBRE, 1);

      peticion.onupgradeneeded = function (evento) {
        var almacen = evento.target.result.createObjectStore(ALMACEN, {
          keyPath: 'id',
          autoIncrement: true
        });

        almacen.createIndex('por_estado', 'estado');
        almacen.createIndex('por_fecha', 'creadoEn');
      };

      peticion.onsuccess = function (evento) {
        conexion = evento.target.result;
        resolver(conexion);
      };

      peticion.onerror = function () {
        rechazar(peticion.error);
      };
    });
  }

  function ejecutar(modo, operacion) {
    return abrir().then(function (db) {
      return new Promise(function (resolver, rechazar) {
        var tx = db.transaction(ALMACEN, modo);
        var peticion = operacion(tx.objectStore(ALMACEN));

        tx.oncomplete = function () {
          resolver(peticion.result);
        };

        tx.onerror = function () {
          rechazar(tx.error);
        };
      });
    });
  }

  function guardar(registro) {
    return ejecutar('readwrite', function (almacen) {
      return almacen.add(registro);
    });
  }

  function listarTodos() {
    return ejecutar('readonly', function (almacen) {
      return almacen.getAll();
    });
  }

  function listarPorEstado(estado) {
    return ejecutar('readonly', function (almacen) {
      return almacen.index('por_estado').getAll(estado);
    });
  }

  function contarPorEstado(estado) {
    return ejecutar('readonly', function (almacen) {
      return almacen.index('por_estado').count(estado);
    });
  }

  function actualizar(id, cambios) {
    return abrir().then(function (db) {
      return new Promise(function (resolver, rechazar) {
        var tx = db.transaction(ALMACEN, 'readwrite');
        var almacen = tx.objectStore(ALMACEN);
        var peticion = almacen.get(id);

        peticion.onsuccess = function () {
          var registro = peticion.result;

          if (!registro) {
            rechazar(new Error('No existe el registro ' + id));
            tx.abort();
            return;
          }

          Object.assign(registro, cambios);
          almacen.put(registro);
        };

        tx.oncomplete = function () {
          resolver(true);
        };

        tx.onerror = function () {
          rechazar(tx.error);
        };
      });
    });
  }

  function eliminarPorEstado(estado) {
    return listarPorEstado(estado).then(function (lista) {
      var tareas = lista.map(function (registro) {
        return ejecutar('readwrite', function (almacen) {
          return almacen.delete(registro.id);
        });
      });

      return Promise.all(tareas).then(function () {
        return lista.length;
      });
    });
  }

  return {
    abrir: abrir,
    guardar: guardar,
    listarTodos: listarTodos,
    listarPorEstado: listarPorEstado,
    contarPorEstado: contarPorEstado,
    actualizar: actualizar,
    eliminarPorEstado: eliminarPorEstado
  };
})();

self.DBHelper = DBHelper;
