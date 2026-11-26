// ============================================================
// geo-ui.js - INTERFAZ DE LA PRACTICA DE UBICACION (G5)
// Solo pinta: pre-permiso, resultado, errores y plan B manual.
// La logica reutilizable esta en geo-helper.js.
// ============================================================

var geoBadge = document.getElementById('geo-permiso');
var geoBtn = document.getElementById('geo-btn');
var geoBtnManual = document.getElementById('geo-btn-manual');
var geoConsent = document.getElementById('geo-consent');
var geoPermitir = document.getElementById('geo-permitir');
var geoCancelar = document.getElementById('geo-cancelar');
var geoManual = document.getElementById('geo-manual');
var geoZona = document.getElementById('geo-zona');
var geoUsarZona = document.getElementById('geo-usar-zona');
var geoResultado = document.getElementById('geo-resultado');
var geoNota = document.getElementById('geo-nota');
var geoReintentar = document.getElementById('geo-reintentar');

function mostrar(elemento, visible) {
  if (elemento) {
    elemento.hidden = !visible;
  }
}

// Pinta el estado del permiso que ya tiene el navegador. Esto NO abre
// el dialogo nativo: solo informa.
function refrescarPermiso() {
  return GeoHelper.consultarPermiso().then(function (estado) {
    if (estado === 'granted') {
      geoBadge.textContent = 'Permiso concedido';
      geoBadge.className = 'badge online';
    } else if (estado === 'denied') {
      geoBadge.textContent = 'Permiso bloqueado';
      geoBadge.className = 'badge offline';
      geoNota.textContent = 'El navegador tiene bloqueada la ubicacion para este sitio. Puedes usar una zona a mano o revisar el candado de la barra.';
      mostrar(geoNota, true);
      mostrar(geoManual, true);
    } else if (estado === 'prompt') {
      geoBadge.textContent = 'Permiso sin pedir';
      geoBadge.className = 'badge badge-cola';
    } else {
      geoBadge.textContent = 'Permiso desconocido';
      geoBadge.className = 'badge';
    }
  });
}

function llenarZonas() {
  GeoHelper.zonas().forEach(function (zona) {
    var opcion = document.createElement('option');
    opcion.value = zona.id;
    opcion.textContent = zona.nombre;
    geoZona.appendChild(opcion);
  });
}

function pintarResultado(datos) {
  geoResultado.textContent = '';
  mostrar(geoResultado, true);
  mostrar(geoReintentar, false);
  geoNota.textContent = '';
  mostrar(geoNota, false);

  var etiqueta = document.createElement('span');
  etiqueta.className = 'badge ' + datos.precision.clase;
  etiqueta.textContent = datos.precision.texto;

  var coordenadas = document.createElement('p');
  coordenadas.className = 'geo-coords';
  coordenadas.textContent = 'Lat ' + Number(datos.lat).toFixed(5) + ' | Lon ' + Number(datos.lon).toFixed(5);

  var margen = document.createElement('p');
  margen.className = 'geo-margen';
  margen.textContent = (datos.accuracy === null || datos.accuracy === undefined)
    ? 'Margen: no aplica (zona elegida a mano).'
    : 'Margen de error: +/- ' + Math.round(datos.accuracy) + ' m.';

  var detalle = document.createElement('p');
  detalle.className = 'nota';
  detalle.textContent = datos.precision.detalle;

  var enlace = document.createElement('a');
  enlace.className = 'geo-mapa';
  enlace.href = 'https://www.openstreetmap.org/?mlat=' + datos.lat
    + '&mlon=' + datos.lon + '#map=16/' + datos.lat + '/' + datos.lon;
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  enlace.textContent = 'Ver en el mapa (necesita red)';

  geoResultado.appendChild(etiqueta);
  geoResultado.appendChild(coordenadas);
  geoResultado.appendChild(margen);
  geoResultado.appendChild(detalle);
  geoResultado.appendChild(enlace);
}

// Pre-Permiso UX: primero explicamos, y solo cuando el usuario pulsa
// "Permitir ubicacion" se llama a getCurrentPosition(). En iPhone ese
// clic es obligatorio: Safari ignora solicitudes que no vienen de un gesto.
function pedirConsentimiento() {
  mostrar(geoConsent, true);
  mostrar(geoManual, false);
  mostrar(geoReintentar, false);
}

function pedirUbicacion(altaPrecision) {
  mostrar(geoConsent, false);
  mostrar(geoManual, false);
  mostrar(geoReintentar, false);
  geoBtn.disabled = true;
  geoNota.textContent = '';
  mostrar(geoNota, false);

  var usarGps = altaPrecision !== false;
  log('Ubicacion: pidiendo al navegador' + (usarGps ? ' con GPS...' : ' sin exigir GPS...'));

  GeoHelper.obtenerUbicacion({
    altaPrecision: usarGps,
    timeout: usarGps ? 10000 : 15000
  })
    .then(function (datos) {
      pintarResultado(datos);
      log('Ubicacion: ' + datos.precision.texto + ' (margen ' + Math.round(datos.accuracy) + ' m).');
    })
    .catch(function (error) {
      manejarError(error);
    })
    .then(function () {
      geoBtn.disabled = false;
    });
}

function manejarError(error) {
  var texto = 'No se pudo obtener tu ubicacion: ' + error.message;

  log('Ubicacion: ' + error.codigo + ' - ' + error.message);
  mostrar(geoResultado, false);

  if (error.codigo === 'TIMEOUT') {
    texto += ' En laptops sin GPS es comun. Prueba "sin GPS" o elige una zona.';
    mostrar(geoReintentar, true);
    mostrar(geoManual, true);
  } else if (error.codigo === 'PERMISO') {
    texto += ' En iPhone revisa Ajustes > Safari > Ubicacion; la PWA instalada tiene su propio permiso.';
    mostrar(geoManual, true);
  } else {
    mostrar(geoManual, true);
  }

  geoNota.textContent = texto;
  mostrar(geoNota, true);
  refrescarPermiso();
}

function usarZona() {
  var zona = GeoHelper.buscarZona(geoZona.value);

  if (!zona) {
    return;
  }

  mostrar(geoManual, false);
  pintarResultado({
    lat: zona.lat,
    lon: zona.lon,
    accuracy: null,
    precision: {
      nivel: 'manual',
      texto: 'Zona manual (sin GPS)',
      clase: 'geo-manual',
      detalle: 'Elegiste "' + zona.nombre + '". Son coordenadas de ejemplo, no una medicion del dispositivo.'
    }
  });
  log('Ubicacion: zona manual "' + zona.nombre + '".');
}

function iniciarGeo() {
  if (!geoBtn) {
    return;
  }

  llenarZonas();

  geoBtn.addEventListener('click', pedirConsentimiento);
  geoBtnManual.addEventListener('click', function () {
    mostrar(geoConsent, false);
    mostrar(geoManual, true);
  });
  geoPermitir.addEventListener('click', function () {
    pedirUbicacion(true);
  });
  geoCancelar.addEventListener('click', function () {
    mostrar(geoConsent, false);
    mostrar(geoManual, true);
    log('Ubicacion: el usuario prefirio la zona manual.');
  });
  geoReintentar.addEventListener('click', function () {
    pedirUbicacion(false);
  });
  geoUsarZona.addEventListener('click', usarZona);

  if (!GeoHelper.soportado()) {
    geoBadge.textContent = 'Sin soporte';
    geoBadge.className = 'badge offline';
    geoBtn.disabled = true;
    geoNota.textContent = 'Este navegador no trae geolocalizacion. Usa el selector de zona.';
    mostrar(geoNota, true);
    mostrar(geoManual, true);
    return;
  }

  refrescarPermiso();
}

iniciarGeo();
