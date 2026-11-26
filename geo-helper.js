// ============================================================
// geo-helper.js - PRACTICA DE UBICACION (G1 a G4)
// Toda la logica de geolocalizacion vive aqui. No toca el DOM:
// devuelve promesas para que cualquier parte de la app las use.
// Sin librerias y sin async/await.
// ============================================================

var GeoHelper = (function () {
  // Plan B: zonas de ejemplo para cuando no hay GPS, el usuario
  // dice que no o el navegador se tarda demasiado. Son coordenadas
  // aproximadas, NO una medicion real del dispositivo.
  var ZONAS = [
    { id: 'centro', nombre: 'Centro', lat: 19.4326, lon: -99.1332 },
    { id: 'norte', nombre: 'Norte', lat: 19.49, lon: -99.13 },
    { id: 'sur', nombre: 'Sur', lat: 19.35, lon: -99.16 },
    { id: 'oriente', nombre: 'Oriente', lat: 19.43, lon: -99.05 },
    { id: 'poniente', nombre: 'Poniente', lat: 19.43, lon: -99.22 }
  ];

  // G1. Pregunta basica: el navegador tiene geolocalizacion?
  function soportado() {
    return 'geolocation' in navigator;
  }

  // G2. Consulta el permiso SIN abrir el dialogo nativo.
  //     Devuelve: 'granted', 'prompt', 'denied' o 'desconocido'.
  //     Safari viejo no tiene permissions.query: por eso el catch.
  function consultarPermiso() {
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve('desconocido');
    }

    return navigator.permissions
      .query({ name: 'geolocation' })
      .then(function (estado) {
        return estado.state;
      })
      .catch(function () {
        return 'desconocido';
      });
  }

  // G3. Envuelve getCurrentPosition() en una promesa.
  //     opciones: { altaPrecision: true/false, timeout: ms, maximumAge: ms }
  //     Devuelve: { lat, lon, accuracy, precision, momento }
  function obtenerUbicacion(opciones) {
    var config = opciones || {};
    var altaPrecision = config.altaPrecision !== false;

    return new Promise(function (resolver, rechazar) {
      if (!soportado()) {
        var sinSoporte = new Error('Este navegador no tiene geolocalizacion.');
        sinSoporte.codigo = 'SIN_SOPORTE';
        rechazar(sinSoporte);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (posicion) {
          resolver({
            lat: posicion.coords.latitude,
            lon: posicion.coords.longitude,
            accuracy: posicion.coords.accuracy,
            precision: clasificarPrecision(posicion.coords.accuracy),
            momento: posicion.timestamp
          });
        },
        function (errorNativo) {
          rechazar(normalizarError(errorNativo));
        },
        {
          enableHighAccuracy: altaPrecision,
          timeout: config.timeout || 10000,
          maximumAge: config.maximumAge || 0
        }
      );
    });
  }

  // G4. Traduce el margen en metros (coords.accuracy) a algo que se
  //     entienda en pantalla.
  //     <= 50 m  -> GPS de alta precision
  //     <= 500 m -> Wi-Fi / antenas
  //     > 500 m  -> IP (muy aproximada)
  function clasificarPrecision(metros) {
    var margen = Number(metros);

    if (!isFinite(margen)) {
      margen = 99999;
    }

    if (margen <= 50) {
      return {
        nivel: 'alta',
        texto: 'GPS de alta precision',
        clase: 'geo-alta',
        detalle: 'Margen de ' + Math.round(margen) + ' m. Lo calculo el GPS.'
      };
    }

    if (margen <= 500) {
      return {
        nivel: 'media',
        texto: 'Ubicacion aproximada (Wi-Fi)',
        clase: 'geo-media',
        detalle: 'Margen de ' + Math.round(margen) + ' m. Se apoyo en Wi-Fi o antenas.'
      };
    }

    return {
      nivel: 'baja',
      texto: 'Ubicacion muy aproximada (IP)',
      clase: 'geo-baja',
      detalle: 'Margen de ' + Math.round(margen) + ' m. Sin GPS, calculada por IP.'
    };
  }

  // Convierte los codigos del navegador en algo que la interfaz pueda
  // mostrar sin adivinar.
  function normalizarError(errorNativo) {
    var tabla = {
      1: { codigo: 'PERMISO', mensaje: 'Dijiste que no o el navegador lo bloqueo.' },
      2: { codigo: 'SIN_SENAL', mensaje: 'No se pudo calcular la posicion.' },
      3: { codigo: 'TIMEOUT', mensaje: 'El navegador se tardo demasiado.' }
    };
    var base = tabla[errorNativo.code] || {
      codigo: 'DESCONOCIDO',
      mensaje: errorNativo.message || 'Fallo la ubicacion.'
    };
    var fallo = new Error(base.mensaje);
    fallo.codigo = base.codigo;
    fallo.codigoNativo = errorNativo.code;
    return fallo;
  }

  // Lista de zonas para el selector manual (copia, para no exponer
  // el arreglo interno).
  function zonas() {
    return ZONAS.map(function (zona) {
      return { id: zona.id, nombre: zona.nombre, lat: zona.lat, lon: zona.lon };
    });
  }

  function buscarZona(id) {
    var encontrada = null;

    ZONAS.forEach(function (zona) {
      if (zona.id === id) {
        encontrada = zona;
      }
    });

    return encontrada
      ? { id: encontrada.id, nombre: encontrada.nombre, lat: encontrada.lat, lon: encontrada.lon }
      : null;
  }

  return {
    soportado: soportado,
    consultarPermiso: consultarPermiso,
    obtenerUbicacion: obtenerUbicacion,
    clasificarPrecision: clasificarPrecision,
    zonas: zonas,
    buscarZona: buscarZona
  };
})();
