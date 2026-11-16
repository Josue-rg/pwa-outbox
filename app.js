/**
 * app.js
 * Logica de la interfaz (Tema 5.2): captura el envio, intenta el POST y, si
 * falla, guarda el mensaje en IndexedDB con estado 'pendiente' (patron Outbox).
 *
 * Sin async/await: todo con Promise.
 */
(function () {
  'use strict';

  var API_URL = 'https://jsonplaceholder.typicode.com/posts';
  var MAX_LINEAS_REGISTRO = 40;

  var elementos = {
    formulario: document.getElementById('form-mensaje'),
    titulo: document.getElementById('entrada-titulo'),
    mensaje: document.getElementById('entrada-mensaje'),
    simularFallo: document.getElementById('simular-fallo'),
    botonEnviar: document.getElementById('boton-enviar'),
    botonSincronizar: document.getElementById('boton-sincronizar'),
    botonPurgar: document.getElementById('boton-purgar'),
    lista: document.getElementById('lista-outbox'),
    registro: document.getElementById('registro'),
    estadoRed: document.getElementById('estado-red'),
    contador: document.getElementById('contador-pendientes')
  };

  /** Escribe una linea con hora en el panel de registro. */
  function registrar(texto) {
    var hora = new Date().toLocaleTimeString('es-MX', { hour12: false });
    var contenido = elementos.registro.textContent.trim();

    if (contenido === 'Esperando eventos...') {
      contenido = '';
    }

    var lineas = (contenido ? contenido + '\n' : '') + '[' + hora + '] ' + texto;

    elementos.registro.textContent = lineas
      .split('\n')
      .slice(-MAX_LINEAS_REGISTRO)
      .join('\n');

    elementos.registro.scrollTop = elementos.registro.scrollHeight;
  }

  /** Pinta la pildora de estado segun navigator.onLine. */
  function actualizarEstadoRed() {
    var enLinea = navigator.onLine;

    elementos.estadoRed.textContent = enLinea ? 'En linea' : 'Sin conexion';
    elementos.estadoRed.classList.toggle('pildora--en-linea', enLinea);
    elementos.estadoRed.classList.toggle('pildora--sin-linea', !enLinea);
  }

  /**
   * POST "real" al servidor de pruebas.
   * Devuelve una Promise que se rechaza si no hay red, si el servidor responde
   * con error o si el interruptor de fallo simulado esta activo.
   */
  function enviarAlServidor(datos) {
    if (elementos.simularFallo.checked) {
      return Promise.reject(new Error('Fallo simulado desde la interfaz'));
    }

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(datos)
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        throw new Error('El servidor respondio ' + respuesta.status);
      }
      return respuesta.json();
    });
  }

  /** Guarda el mensaje en la cola como 'pendiente'. */
  function encolar(datos, motivo) {
    var registro = {
      titulo: datos.titulo,
      mensaje: datos.mensaje,
      estado: DBHelper.ESTADOS.PENDIENTE,
      creadoEn: Date.now(),
      intentos: 0,
      ultimoError: motivo
    };

    return DBHelper.guardar(registro).then(function (id) {
      registrar('Guardado en la cola como pendiente (id ' + id + ').');
      return id;
    });
  }

  /** Recalcula el contador de pendientes de la cabecera. */
  function actualizarContador() {
    return DBHelper.contarPorEstado(DBHelper.ESTADOS.PENDIENTE)
      .then(function (total) {
        elementos.contador.textContent = total === 1
          ? '1 pendiente'
          : total + ' pendientes';
        return total;
      })
      .catch(function (error) {
        registrar('No se pudo contar pendientes: ' + error.message);
        return 0;
      });
  }

  /** Fecha legible a partir del timestamp guardado en IndexedDB. */
  function formatearFecha(marcaTiempo) {
    if (!marcaTiempo) {
      return 'sin fecha';
    }

    return new Date(marcaTiempo).toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  /** Pildora con el estado del registro. */
  function crearEtiqueta(estado) {
    var etiqueta = document.createElement('span');

    etiqueta.className = 'etiqueta';
    etiqueta.textContent = estado;

    if (estado === DBHelper.ESTADOS.SINCRONIZADO) {
      etiqueta.classList.add('etiqueta--sincronizado');
    } else if (estado === DBHelper.ESTADOS.ERROR) {
      etiqueta.classList.add('etiqueta--error');
    }

    return etiqueta;
  }

  /**
   * Construye el <li> de un registro.
   * Se usa textContent (nunca innerHTML) para que el contenido escrito por el
   * usuario no pueda inyectar HTML.
   */
  function crearItem(registro) {
    var item = document.createElement('li');
    var fila = document.createElement('div');
    var grupo = document.createElement('div');
    var titulo = document.createElement('span');
    var meta = document.createElement('span');
    var cuerpo = document.createElement('p');

    item.className = 'cola__item';

    if (registro.estado === DBHelper.ESTADOS.SINCRONIZADO) {
      item.classList.add('cola__item--sincronizado');
    } else if (registro.estado === DBHelper.ESTADOS.ERROR) {
      item.classList.add('cola__item--error');
    }

    fila.className = 'cola__fila';
    grupo.className = 'cola__grupo';

    titulo.className = 'cola__titulo';
    titulo.textContent = registro.titulo || '(sin titulo)';

    meta.className = 'cola__meta';
    meta.textContent = 'id ' + registro.id + ' | ' + formatearFecha(registro.creadoEn);

    grupo.appendChild(titulo);
    grupo.appendChild(crearEtiqueta(registro.estado));
    fila.appendChild(grupo);
    fila.appendChild(meta);

    cuerpo.className = 'cola__cuerpo';
    cuerpo.textContent = registro.mensaje || '';

    item.appendChild(fila);
    item.appendChild(cuerpo);

    if (registro.ultimoError) {
      var nota = document.createElement('span');

      nota.className = 'cola__meta';
      nota.textContent = 'Ultimo error: ' + registro.ultimoError +
        (registro.intentos ? ' | intentos: ' + registro.intentos : '');
      item.appendChild(nota);
    }

    return item;
  }

  /** Vuelve a dibujar la cola completa, del mas reciente al mas viejo. */
  function renderizarCola() {
    return DBHelper.listarTodos()
      .then(function (registros) {
        registros.sort(function (a, b) {
          return (b.creadoEn || 0) - (a.creadoEn || 0);
        });

        elementos.lista.textContent = '';

        if (!registros.length) {
          var vacio = document.createElement('li');

          vacio.className = 'cola__vacia';
          vacio.textContent = 'Todavia no hay mensajes en la cola.';
          elementos.lista.appendChild(vacio);
          return registros;
        }

        registros.forEach(function (registro) {
          elementos.lista.appendChild(crearItem(registro));
        });

        return registros;
      })
      .catch(function (error) {
        registrar('No se pudo dibujar la cola: ' + error.message);
        return [];
      });
  }

  /** Borra de IndexedDB los registros ya sincronizados. */
  function purgarSincronizados() {
    elementos.botonPurgar.disabled = true;

    return DBHelper.eliminarPorEstado(DBHelper.ESTADOS.SINCRONIZADO)
      .then(function (total) {
        registrar(total
          ? 'Purgados ' + total + ' registros sincronizados.'
          : 'No habia registros sincronizados que purgar.');

        return Promise.all([renderizarCola(), actualizarContador()]);
      })
      .catch(function (error) {
        registrar('No se pudo purgar: ' + error.message);
      })
      .then(function () {
        elementos.botonPurgar.disabled = false;
      });
  }

  function limpiarFormulario() {
    elementos.titulo.value = '';
    elementos.mensaje.value = '';
    elementos.titulo.focus();
  }

  /** Flujo principal del formulario. */
  function manejarEnvio(evento) {
    evento.preventDefault();

    var titulo = elementos.titulo.value.trim();
    var mensaje = elementos.mensaje.value.trim();

    if (!titulo || !mensaje) {
      registrar('Titulo y mensaje son obligatorios.');
      elementos.titulo.focus();
      return;
    }

    var datos = { titulo: titulo, mensaje: mensaje };
    elementos.botonEnviar.disabled = true;
    registrar('Enviando "' + titulo + '" al servidor...');

    enviarAlServidor(datos)
      .then(function (respuesta) {
        registrar('Enviado correctamente. id remoto: ' + (respuesta && respuesta.id ? respuesta.id : 'n/d'));
        limpiarFormulario();
      })
      .catch(function (error) {
        registrar('El envio fallo: ' + error.message);
        return encolar(datos, error.message).then(function () {
          limpiarFormulario();
          return Promise.all([renderizarCola(), actualizarContador()]);
        });
      })
      .then(function () {
        elementos.botonEnviar.disabled = false;
      })
      .catch(function (error) {
        registrar('Error inesperado: ' + error.message);
        elementos.botonEnviar.disabled = false;
      });
  }

  /** Arranque de la aplicacion. */
  function iniciar() {
    actualizarEstadoRed();
    window.addEventListener('online', actualizarEstadoRed);
    window.addEventListener('offline', actualizarEstadoRed);

    elementos.formulario.addEventListener('submit', manejarEnvio);
    elementos.botonPurgar.addEventListener('click', purgarSincronizados);

    DBHelper.abrir()
      .then(function () {
        registrar('IndexedDB lista (' + DBHelper.NOMBRE_BD + ' v1).');
        return Promise.all([renderizarCola(), actualizarContador()]);
      })
      .catch(function (error) {
        registrar('No se pudo abrir IndexedDB: ' + error.message);
      });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
