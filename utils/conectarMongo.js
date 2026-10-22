/**
 * Conexión a MongoDB con reintentos.
 *
 * Incidente del 22/10 en producción: tras un reinicio del servidor, el
 * contenedor del backend arrancó antes de que MongoDB aceptara conexiones.
 * server.js hacía process.exit(1) al primer fallo (el proceso HTTP moría y la
 * API devolvía 502 sin cabeceras CORS), y los workers quedaban vivos con un
 * Mongoose que nunca reintenta la conexión inicial: cada consulta terminaba en
 * "buffering timed out" durante horas, con MongoDB ya levantado.
 *
 * Una vez conectado, el driver reconecta solo ante caídas posteriores; lo que
 * hay que cubrir es la conexión inicial. Esta función reintenta hasta lograrla.
 */

const mongoose = require('mongoose');
const { ocultarCredenciales } = require('./ocultarCredenciales');

const OPCIONES_POR_DEFECTO = {
  serverSelectionTimeoutMS: 5000
};

/**
 * @param {object} params
 * @param {string} params.uri             URI de MongoDB
 * @param {string} [params.etiqueta]      Prefijo para los logs, p. ej. '[WORKER]'
 * @param {object} [params.opciones]      Opciones extra de mongoose.connect
 * @param {number} [params.reintentoMs]   Espera entre intentos (5 s por defecto)
 * @param {number} [params.maxIntentos]   Intentos máximos; Infinity = hasta lograrlo
 * @param {function} [params.conectar]    Inyectable para tests
 * @param {function} [params.esperar]     Inyectable para tests
 * @param {object} [params.log]           Inyectable para tests
 * @returns {Promise<mongoose.Connection>}
 */
async function conectarMongo({
  uri,
  etiqueta = '',
  opciones = {},
  reintentoMs = 5000,
  maxIntentos = Infinity,
  conectar = (u, o) => mongoose.connect(u, o),
  esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console
} = {}) {
  const prefijo = etiqueta ? `${etiqueta} ` : '';
  const opcionesFinales = { ...OPCIONES_POR_DEFECTO, ...opciones };

  for (let intento = 1; ; intento++) {
    try {
      await conectar(uri, opcionesFinales);
      log.log(`✅ ${prefijo}MongoDB conectado (${ocultarCredenciales(uri)})`);
      return mongoose.connection;
    } catch (error) {
      if (intento >= maxIntentos) {
        throw error;
      }
      log.error(
        `❌ ${prefijo}Error conectando a MongoDB (intento ${intento}): ${error.message}. ` +
        `Reintento en ${Math.round(reintentoMs / 1000)}s`
      );
      await esperar(reintentoMs);
    }
  }
}

module.exports = { conectarMongo, OPCIONES_POR_DEFECTO };
