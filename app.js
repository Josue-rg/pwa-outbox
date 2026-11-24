var API = 'https://jsonplaceholder.typicode.com/posts';
var ETIQUETA = 'outbox-sync';
var haySyncManager = 'serviceWorker' in navigator && 'SyncManager' in window;

var form = document.getElementById('form');
var titulo = document.getElementById('titulo');
var mensaje = document.getElementById('mensaje');
var fallo = document.getElementById('fallo');
var btnEnviar = document.getElementById('btn-enviar');
var btnPurgar = document.getElementById('btn-purgar');
var lista = document.getElementById('lista');
var cajaLog = document.getElementById('log');
var badge = document.getElementById('badge');
var contador = document.getElementById('contador');

function log(texto) {
  if (cajaLog.textContent === 'Esperando...') {
    cajaLog.textContent = '';
  }

  var hora = new Date().toLocaleTimeString('es-MX', { hour12: false });
  cajaLog.textContent += '[' + hora + '] ' + texto + '\n';
  cajaLog.scrollTop = cajaLog.scrollHeight;
}

function pintarRed() {
  var enLinea = navigator.onLine;

  badge.textContent = enLinea ? 'Con red' : 'Sin red';
  badge.className = 'badge ' + (enLinea ? 'online' : 'offline');
}

function enviarAlServidor(datos) {
  if (fallo.checked) {
    return Promise.reject(new Error('simulado'));
  }

  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo: datos.titulo, mensaje: datos.mensaje })
  }).then(function (respuesta) {
    if (!respuesta.ok) {
      throw new Error('el server dijo ' + respuesta.status);
    }
    return respuesta.json();
  });
}

function guardarPendiente(datos, motivo) {
  return DBHelper.guardar({
    titulo: datos.titulo,
    mensaje: datos.mensaje,
    estado: 'pendiente',
    creadoEn: Date.now(),
    ultimoError: motivo
  }).then(function (id) {
    log('Se guardo en la cola (id ' + id + ').');
  });
}

function crearItem(r) {
  var item = document.createElement('li');
  item.className = 'item ' + r.estado;

  var fila = document.createElement('div');
  fila.className = 'fila';

  var nombre = document.createElement('strong');
  nombre.textContent = r.titulo;

  var estado = document.createElement('span');
  estado.className = 'estado';
  estado.textContent = r.estado;

  fila.appendChild(nombre);
  fila.appendChild(estado);

  var meta = document.createElement('small');
  meta.textContent = 'id ' + r.id + ' - ' + new Date(r.creadoEn).toLocaleString('es-MX');

  var cuerpo = document.createElement('p');
  cuerpo.textContent = r.mensaje;

  item.appendChild(fila);
  item.appendChild(meta);
  item.appendChild(cuerpo);

  if (r.ultimoError) {
    var nota = document.createElement('small');
    nota.className = 'error';
    nota.textContent = 'Ojo: ' + r.ultimoError;
    item.appendChild(nota);
  }

  return item;
}

function pintarCola() {
  return DBHelper.listarTodos().then(function (registros) {
    registros.sort(function (a, b) {
      return b.creadoEn - a.creadoEn;
    });

    lista.textContent = '';

    if (!registros.length) {
      var vacio = document.createElement('li');
      vacio.className = 'vacia';
      vacio.textContent = 'Nada por aqui.';
      lista.appendChild(vacio);
      return;
    }

    registros.forEach(function (r) {
      lista.appendChild(crearItem(r));
    });
  });
}

function pintarContador() {
  return DBHelper.contarPorEstado('pendiente').then(function (total) {
    contador.textContent = total + ' en cola';
  });
}

function refrescar() {
  return Promise.all([pintarCola(), pintarContador()]).catch(function (error) {
    log('No se pudo pintar la cola: ' + error.message);
  });
}

function enviar(evento) {
  evento.preventDefault();

  var t = titulo.value.trim();
  var m = mensaje.value.trim();

  if (!t || !m) {
    log('Falta el titulo o el mensaje.');
    return;
  }

  btnEnviar.disabled = true;
  log('Mandando "' + t + '"...');

  enviarAlServidor({ titulo: t, mensaje: m })
    .then(function (respuesta) {
      log('Enviado, id ' + (respuesta.id || 'n/d'));
    })
    .catch(function (error) {
      log('No salio (' + error.message + '). Va a la cola.');
      return guardarPendiente({ titulo: t, mensaje: m }, error.message);
    })
    .then(function () {
      form.reset();
      btnEnviar.disabled = false;
      return refrescar();
    })
    .catch(function (error) {
      log('Algo fallo: ' + error.message);
      btnEnviar.disabled = false;
    });
}

function sincronizarAqui() {
  log('Sincronizando aqui...');

  return DBHelper.listarPorEstado('pendiente')
    .then(function (pendientes) {
      if (!pendientes.length) {
        log('No hay nada pendiente.');
        return;
      }

      var tareas = pendientes.map(function (r) {
        return enviarAlServidor(r)
          .then(function () {
            return DBHelper.actualizar(r.id, { estado: 'sincronizado', ultimoError: null });
          })
          .catch(function (error) {
            return DBHelper.actualizar(r.id, { ultimoError: error.message });
          });
      });

      return Promise.all(tareas).then(function () {
        log('Se mandaron ' + pendientes.length + '.');
        return refrescar();
      });
    })
    .catch(function (error) {
      log('No se pudo sincronizar: ' + error.message);
    });
}

function avisarAlSW() {
  if (!navigator.serviceWorker.controller) {
    return false;
  }

  navigator.serviceWorker.controller.postMessage({ tipo: 'SINCRONIZAR_AHORA' });
  return true;
}

function sincronizar() {
  log('Sincronizando automaticamente...');

  var trabajo;

  if (!('serviceWorker' in navigator)) {
    trabajo = sincronizarAqui();
  } else {
    trabajo = navigator.serviceWorker.ready
      .then(function (registroSw) {
        if (!haySyncManager) {
          log('Sin background sync, le aviso al SW.');
          return avisarAlSW() || sincronizarAqui();
        }

        return registroSw.sync.register(ETIQUETA)
          .then(function () {
            log('Listo, el navegador lo hace solo.');
          })
          .catch(function () {
            log('No se pudo, se lo pido al SW.');
            return avisarAlSW() || sincronizarAqui();
          });
      })
      .catch(function () {
        return sincronizarAqui();
      });
  }

  return Promise.resolve(trabajo);
}

function purgar() {
  btnPurgar.disabled = true;

  DBHelper.eliminarPorEstado('sincronizado')
    .then(function (total) {
      log(total === 0 ? 'No hay nada que borrar.' : 'Borre ' + total + '.');
      return refrescar();
    })
    .catch(function (error) {
      log('No se pudo borrar: ' + error.message);
    })
    .then(function () {
      btnPurgar.disabled = false;
    });
}

function escucharSW() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener('message', function (evento) {
    if (!evento.data || evento.data.tipo !== 'SYNC_FIN') {
      return;
    }

    log('Se sincronizo.');
    refrescar();
  });
}

function iniciar() {
  pintarRed();
  escucharSW();

  form.addEventListener('submit', enviar);
  btnPurgar.addEventListener('click', purgar);

  window.addEventListener('offline', pintarRed);
  window.addEventListener('online', function () {
    pintarRed();
    log('Volvio la red.');
    sincronizar();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(function () {
        log('SW listo.');
      })
      .catch(function (error) {
        log('No se pudo activar el SW: ' + error.message);
      });
  } else {
    log('Este navegador no trae service workers.');
  }

  log('Todo listo.');
  refrescar();

  if (navigator.onLine) {
    sincronizar();
  }
}

iniciar();
