const { test } = require('node:test');
const assert = require('node:assert/strict');

// facturaService carga las colas Bull al requerirse (abren conexiones a
// Redis); acá se reemplazan por stubs para probar la identidad del documento
// sin infraestructura.
const rutaColas = require.resolve('../queues/facturaQueue');
require.cache[rutaColas] = {
  id: rutaColas, filename: rutaColas, loaded: true,
  exports: { facturaQueue: {}, kudeQueue: {} }
};

const { generarFacturaHash, construirCorrelativo, validarPuntoHabilitado } = require('../services/facturaService');

const empresa = { ruc: '80055783-2', configuracionSifen: { timbrado: '18646542' } };
const payload = (data) => ({ param: { ruc: '80055783-2' }, data });

test('construirCorrelativo arma EST-PUNTO-NUMERO con ceros a la izquierda', () => {
  assert.equal(construirCorrelativo(payload({ establecimiento: '1', punto: 2, numero: 7 })), '001-002-0000007');
  assert.equal(construirCorrelativo(payload({ establecimiento: '001', punto: '002', numero: '0000010' })), '001-002-0000010');
});

test('el caso de producción: FE 001-002-0000001 y NC 001-001-0000001 tienen hashes distintos', () => {
  // Con la fórmula vieja (ruc|csa|numero) ambos daban
  // e1e2a6d6f99709e89872625b2cc4d38160a68cc558fbc83b37ec37dcd28bc15a
  // y la NC pisó el registro de la FE (2026-09-02).
  const fe = generarFacturaHash(payload({ tipoDocumento: 1, establecimiento: '001', punto: '002', numero: '0000001' }), empresa);
  const nc = generarFacturaHash(payload({ tipoDocumento: 5, establecimiento: '001', punto: '001', numero: '0000001' }), empresa);
  assert.notEqual(fe, nc);
  assert.notEqual(fe, 'e1e2a6d6f99709e89872625b2cc4d38160a68cc558fbc83b37ec37dcd28bc15a');
  assert.notEqual(nc, 'e1e2a6d6f99709e89872625b2cc4d38160a68cc558fbc83b37ec37dcd28bc15a');
});

test('mismo correlativo pero distinto tipo de documento → distinto hash', () => {
  const base = { establecimiento: '001', punto: '002', numero: '0000001' };
  const fe = generarFacturaHash(payload({ ...base, tipoDocumento: 1 }), empresa);
  const nc = generarFacturaHash(payload({ ...base, tipoDocumento: 5 }), empresa);
  const nd = generarFacturaHash(payload({ ...base, tipoDocumento: 6 }), empresa);
  assert.notEqual(fe, nc);
  assert.notEqual(nc, nd);
});

test('mismo documento → mismo hash, con o sin codigoSeguridadAleatorio (el CSA no es identidad)', () => {
  const sin = generarFacturaHash(payload({ tipoDocumento: 5, establecimiento: '001', punto: '002', numero: '0000001' }), empresa);
  const con = generarFacturaHash(payload({ tipoDocumento: 5, establecimiento: '001', punto: '002', numero: '0000001', codigoSeguridadAleatorio: '123456789' }), empresa);
  assert.equal(sin, con);
});

test('distinto punto de expedición o distinto timbrado → distinto hash', () => {
  const p1 = generarFacturaHash(payload({ tipoDocumento: 5, establecimiento: '001', punto: '001', numero: '0000001' }), empresa);
  const p2 = generarFacturaHash(payload({ tipoDocumento: 5, establecimiento: '001', punto: '002', numero: '0000001' }), empresa);
  assert.notEqual(p1, p2);
  const otroTimbrado = generarFacturaHash(payload({ tipoDocumento: 5, establecimiento: '001', punto: '002', numero: '0000001' }), { ...empresa, configuracionSifen: { timbrado: '99999999' } });
  assert.notEqual(p2, otroTimbrado);
});

test('el timbrado del payload (param.timbradoNumero) prevalece sobre el de la empresa', () => {
  const data = { tipoDocumento: 1, establecimiento: '001', punto: '002', numero: '0000001' };
  const conParam = generarFacturaHash({ param: { ruc: '80055783-2', timbradoNumero: '18646542' }, data }, { ruc: '80055783-2', configuracionSifen: { timbrado: 'otro' } });
  const conEmpresa = generarFacturaHash(payload(data), empresa);
  assert.equal(conParam, conEmpresa);
});

// ── Punto de expedición habilitado ──────────────────────────────────
// El 001-001 de Kingston pertenece a otro sistema; la NC del 02/09 salió ahí
// porque el payload mandaba establecimiento/punto explícitos.
const kingston = {
  ruc: '80055783-2',
  configuracionSifen: { timbrado: '18646542', establecimiento: '001', puntoExpedicion: '002' },
  establecimientos: [{ codigo: '001' }]
};

test('el punto por defecto de la empresa siempre pasa y queda normalizado a 3 dígitos', () => {
  const data = { establecimiento: '1', punto: 2 };
  validarPuntoHabilitado(kingston, data);
  assert.deepEqual(data, { establecimiento: '001', punto: '002' });
});

test('un punto que la empresa no tiene habilitado se rechaza con 400', () => {
  assert.throws(
    () => validarPuntoHabilitado(kingston, { establecimiento: '001', punto: '001' }),
    (error) => {
      assert.match(error.message, /Punto de expedición 001 no habilitado/);
      assert.equal(error.statusCode, 400);
      assert.equal(error.errorCode, 'PUNTO_NO_HABILITADO');
      assert.deepEqual(error.detalles.habilitados, ['002']);
      return true;
    }
  );
});

test('puntosExpedicion habilita puntos adicionales', () => {
  const empresaMultipunto = {
    ...kingston,
    configuracionSifen: { ...kingston.configuracionSifen, puntosExpedicion: ['003', '001'] }
  };
  for (const punto of ['001', '002', '003']) {
    assert.doesNotThrow(() => validarPuntoHabilitado(empresaMultipunto, { establecimiento: '001', punto }));
  }
});

test('un establecimiento no registrado se rechaza con 400', () => {
  assert.throws(
    () => validarPuntoHabilitado(kingston, { establecimiento: '002', punto: '002' }),
    (error) => {
      assert.match(error.message, /Establecimiento 002 no registrado/);
      assert.equal(error.statusCode, 400);
      assert.equal(error.errorCode, 'ESTABLECIMIENTO_NO_HABILITADO');
      return true;
    }
  );
});
