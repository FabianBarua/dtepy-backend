const { test } = require('node:test');
const assert = require('node:assert/strict');

const { evaluarPlazoTransmision, HORAS_TRANSMISION } = require('../utils/plazosSifen');

const ahora = new Date('2026-09-02T16:49:05-03:00').getTime();
const horasAtras = (h) => new Date(ahora - h * 3600000).toISOString();

test('la NC del caso real (emitida 31/08 09:00, enviada 02/09 16:49) entra en plazo', () => {
  const r = evaluarPlazoTransmision('2026-08-31T09:00:00-03:00', ahora);
  assert.equal(r.dentro, true);
  assert.ok(r.horasTranscurridas > 55 && r.horasTranscurridas < 56, `horas: ${r.horasTranscurridas}`);
});

test(`el borde son ${HORAS_TRANSMISION} h: justo en el límite entra, un minuto después no`, () => {
  assert.equal(evaluarPlazoTransmision(horasAtras(HORAS_TRANSMISION), ahora).dentro, true);
  assert.equal(evaluarPlazoTransmision(horasAtras(HORAS_TRANSMISION + 1 / 60), ahora).dentro, false);
});

test('tres días atrás a la misma hora entra; tres días atrás más unas horas ya no', () => {
  assert.equal(evaluarPlazoTransmision(horasAtras(72), ahora).dentro, true);
  assert.equal(evaluarPlazoTransmision(horasAtras(80), ahora).dentro, false);
});

test('fecha futura o ilegible no bloquea (lo resuelve SET)', () => {
  assert.equal(evaluarPlazoTransmision(horasAtras(-5), ahora).dentro, true);
  assert.equal(evaluarPlazoTransmision('no-es-fecha', ahora).dentro, true);
  assert.equal(evaluarPlazoTransmision(null, ahora).dentro, true);
});
