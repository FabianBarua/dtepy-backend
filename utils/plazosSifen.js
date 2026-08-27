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

module.exports = {
  HORAS_CANCELACION_FACTURA,
  HORAS_CANCELACION_OTROS,
  horasLimiteCancelacion,
  evaluarPlazoCancelacion
};
