// ============================================================
// app.js - FLUJO PRINCIPAL (pasos 1 a 9 y 15)
// Lado de la pagina: escucha el formulario, intenta enviar, si
// falla guarda en la cola, vigila la red y pinta lo guardado.
// Los pasos 10 a 14 estan en sw.js y el acceso a datos (6, 7, 11, 13,
// y el borrado P1) en db-helper.js.
// ============================================================

var API = 'https://jsonplaceholder.typicode.com/posts';
var ETIQUETA = 'outbox-sync';
var haySyncManager = 'serviceWorker' in navigator && 'SyncManager' in window;
var CHEQUEO_MS = 2000;
var enLinea = null;
var checando = false;

var form = document.getElementById('form');
var titulo = document.getElementById('titulo');
var mensaje = document.getElementById('mensaje');
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
  if (enLinea === null) {
    badge.textContent = 'Viendo la red...';
    badge.className = 'badge';
    return;
  }

  badge.textContent = enLinea ? 'Con red' : 'Sin red';
  badge.className = 'badge ' + (enLinea ? 'online' : 'offline');
}

function pingRed() {
  var opciones = { cache: 'no-store' };
  var control = typeof AbortController === 'function' ? new AbortController() : null;
  var temporizador;

  if (control) {
    temporizador = setTimeout(function () {
      control.abort();
    }, 2500);
    opciones.signal = control.signal;
  }

  return fetch('./manifest.json?ping=' + Date.now(), opciones)
    .then(function (respuesta) {
      return respuesta.ok;
    })
    .catch(function () {
      return false;
    })
    .then(function (ok) {
      if (temporizador) {
        clearTimeout(temporizador);
      }
      return ok;
    });
}

function checarRed() {
  if (checando) {
    return;
  }

  checando = true;
  pingRed().then(function (ok) {
    checando = false;
    actualizarRed(ok);
  });
}

// 8. Aqui se decide que hacer cuando cambia la red: si volvio, se
//    dispara la sincronizacion automatica (paso 9).
function actualizarRed(conRed) {
  if (conRed === enLinea) {
    return;
  }

  var primeraVez = enLinea === null;
  enLinea = conRed;
  pintarRed();

  if (conRed) {
    if (!primeraVez) {
      log('Volvio la red.');
    }
    sincronizar();
  } else {
    log('No hay red.');
  }
}

// Revisa la red cada 2 segundos con un fetch real (no window.online).
// Cuando el resultado cambia, cae en el paso 8.
function vigilarRed() {
  checarRed();
  setInterval(checarRed, CHEQUEO_MS);
}

// 3. Intento de envio real: POST a la API. Si el servidor no responde
//    ok, lanza el error que activa el paso 4. Lo reusa sincronizarAqui().
function enviarAlServidor(datos) {
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

// 5. El envio fallo: arma el registro con estado 'pendiente' y lo manda
//    a DBHelper.guardar() (paso 6) para que quede en IndexedDB.
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

// 7. Lee todo lo guardado con DBHelper.listarTodos() (db-helper.js)
//    y dibuja la cola, lo mas nuevo primero.
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

// 7b. Cuenta los 'pendiente' con DBHelper.contarPorEstado() y lo pinta
//     en el badge "N en cola".
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

// 1 y 2. Punto de entrada: el submit del formulario (paso 1, index.html)
//    llega aqui. Valida los campos y arranca el envio.
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

  // 3. Primer intento directo contra la API, sin pasar por el SW.
  enviarAlServidor({ titulo: t, mensaje: m })
    .then(function (respuesta) {
      log('Enviado, id ' + (respuesta.id || 'n/d'));
    })
    // 4. Fallo el POST: el mensaje no se pierde, se manda a la cola.
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

// Plan B (sin Service Worker o sin Background Sync): la pagina hace el
// mismo trabajo que el SW (pasos 11, 12 y 13) pero en primer plano.
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

// 9b. Camino alterno al Background Sync: la pagina le pide al SW que
//     sincronice ya por mensaje (el SW lo recibe en el paso 10b).
function avisarAlSW() {
  if (!navigator.serviceWorker.controller) {
    return false;
  }

  navigator.serviceWorker.controller.postMessage({ tipo: 'SINCRONIZAR_AHORA' });
  return true;
}

// 9. Aqui se decide quien sincroniza:
//    a) el navegador con Background Sync (sync.register), o
//    b) el SW por mensaje (paso 9b), o
//    c) la pagina misma (sincronizarAqui, plan B).
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

// P1. Borra de IndexedDB los 'sincronizado' con DBHelper.eliminarPorEstado()
//     y repinta la cola.
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

// 15. Escucha el aviso 'SYNC_FIN' que manda el SW al terminar (paso 14).
//     Al recibirlo repinta para que se vea el cambio de estado.
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

// Arranque: pinta la red, engancha botones, registra el SW y vigila.
function iniciar() {
  pintarRed();
  escucharSW();

  form.addEventListener('submit', enviar);
  btnPurgar.addEventListener('click', purgar);

  window.addEventListener('offline', checarRed);
  window.addEventListener('online', checarRed);

  if ('serviceWorker' in navigator) {
    // Registro del SW: a partir de aqui sw.js toma el control (C1, C2, C3).
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
  vigilarRed();
}

iniciar();
