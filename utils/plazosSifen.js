/**
 * Plazos de eventos según el Manual Técnico SIFEN v150 (sección 11).
 *
 * Cancelación: la Factura Electrónica puede cancelarse hasta 48 horas después
 * de la aprobación del DTE por parte de SIFEN; los demás documentos (notas de
 * crédito/débito, autofactura, nota de remisión) hasta 168 horas (7 días).
 * Pasado el plazo de una factura, corresponde emitir una Nota de Crédito.
 *
 * SET aplica estos plazos del lado de ellos; validarlos acá evita gastar la
 * llamada y le da al usuario un error inmediato y claro.
 */

const HORAS_CANCELACION_FACTURA = 48;
const HORAS_CANCELACION_OTROS = 168;

/**
 * Ventana de transmisión: SET recibe un DTE hasta 72 horas después de la fecha
 * y hora de emisión declarada (dFeEmiDE). Pasado ese plazo el documento se
 * rechaza del lado de SET, así que emitir retroactivo funciona —incluso con
 * fecha de tres días atrás— siempre que el envío entre dentro de esa ventana.
 */
const HORAS_TRANSMISION = 72;

/**
 * Horas de plazo según la descripción del tipo de documento.
 * "Factura electrónica" → 48; "Autofactura", "Nota de crédito", etc. → 168.
 * (\bfactura no matchea "Autofactura": no hay borde de palabra entre "auto" y "factura")
 */
function horasLimiteCancelacion(descripcionTipoDE) {
  const esFactura = /\bfactura/i.test(String(descripcionTipoDE || 'Factura electrónica'));
  return esFactura ? HORAS_CANCELACION_FACTURA : HORAS_CANCELACION_OTROS;
}

/**
 * Evalúa si una cancelación está dentro del plazo.
 *
 * @param {Date|string} fechaAprobacion fecha de aprobación del DTE en SIFEN
 * @param {string} [descripcionTipoDE]  campo `de` de la factura
 * @param {number} [ahora]              timestamp actual (inyectable en tests)
 * @returns {{ dentro: boolean, horasLimite: number, horasTranscurridas: number }}
 */
function evaluarPlazoCancelacion(fechaAprobacion, descripcionTipoDE, ahora = Date.now()) {
  const horasLimite = horasLimiteCancelacion(descripcionTipoDE);
  // Ojo: new Date(null) es la época Unix (0), que ES finita; hay que
  // descartar null/undefined antes de convertir.
  const aprobada = fechaAprobacion == null ? NaN : new Date(fechaAprobacion).getTime();

  if (!Number.isFinite(aprobada)) {
    // Sin fecha de aprobación conocida no se puede afirmar que venció:
    // se deja pasar y decide SET (que es la autoridad sobre el plazo real).
    return { dentro: true, horasLimite, horasTranscurridas: 0 };
  }

  const horasTranscurridas = (ahora - aprobada) / 3600000;
  return { dentro: horasTranscurridas <= horasLimite, horasLimite, horasTranscurridas };
}

/**
 * Evalúa si un DTE con fecha de emisión retroactiva todavía entra en la
 * ventana de transmisión de SET.
 *
 * Una fecha ilegible se deja pasar (decide SET); una fecha futura da
 * horasTranscurridas negativas y por lo tanto entra en plazo (el adelanto de
 * fecha lo controla SET con su propia validación).
 *
 * @param {Date|string} fechaEmision  dFeEmiDE declarado en el documento
 * @param {number} [ahora]            timestamp actual (inyectable en tests)
 * @returns {{ dentro: boolean, horasLimite: number, horasTranscurridas: number }}
 */
function evaluarPlazoTransmision(fechaEmision, ahora = Date.now()) {
  const emitida = fechaEmision == null ? NaN : new Date(fechaEmision).getTime();

  if (!Number.isFinite(emitida)) {
    return { dentro: true, horasLimite: HORAS_TRANSMISION, horasTranscurridas: 0 };
  }

  const horasTranscurridas = (ahora - emitida) / 3600000;
  return { dentro: horasTranscurridas <= HORAS_TRANSMISION, horasLimite: HORAS_TRANSMISION, horasTranscurridas };
}

module.exports = {
  HORAS_CANCELACION_FACTURA,
  HORAS_CANCELACION_OTROS,
  HORAS_TRANSMISION,
  horasLimiteCancelacion,
  evaluarPlazoCancelacion,
  evaluarPlazoTransmision
};
