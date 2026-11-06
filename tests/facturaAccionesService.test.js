const { test } = require('node:test');
const assert = require('node:assert/strict');

// El servicio carga modelos de mongoose y (vía facturaService) las colas de
// Bull: se stubea la cola para que el require no abra Redis.
const rutaColas = require.resolve('../queues/facturaQueue');
require.cache[rutaColas] = { id: rutaColas, filename: rutaColas, loaded: true, exports: { facturaQueue: {}, kudeQueue: {} } };

const {
  elegibleReintento, elegibleCancelacion, elegibleEliminacion, elegibleRegenerarPdf, elegibilidad,
  regenerarPdf, nombreArchivo, filaCsv, aCsv
} = require('../services/facturaAccionesService');

const hace = (horas) => new Date(Date.now() - horas * 3600000);

test('reintento: solo documentos que no existen en SET y con datos guardados', () => {
  assert.equal(elegibleReintento({ estadoSifen: 'rechazado', datosFactura: { data: { x: 1 } } }).ok, true);
  assert.equal(elegibleReintento({ estadoSifen: 'error', datosFactura: { data: { x: 1 } } }).ok, true);
  assert.equal(elegibleReintento({ estadoSifen: 'aceptado', cdc: 'x', datosFactura: { data: { x: 1 } } }).ok, false);
  assert.equal(elegibleReintento({ estadoSifen: 'cancelado', cdc: 'x', datosFactura: { data: { x: 1 } } }).ok, false);
  assert.equal(elegibleReintento({ estadoSifen: 'encolado', datosFactura: { data: { x: 1 } } }).ok, false);
  assert.match(elegibleReintento({ estadoSifen: 'rechazado', datosFactura: {} }).motivo, /Sin datos/);
});

test('cancelación: aprobado y dentro del plazo (48 h factura, 168 h el resto)', () => {
  assert.equal(elegibleCancelacion({ estadoSifen: 'aceptado', cdc: 'x', de: 'Factura electrónica', fechaProceso: hace(10) }).ok, true);
  const fueraFE = elegibleCancelacion({ estadoSifen: 'aceptado', cdc: 'x', de: 'Factura electrónica', fechaProceso: hace(60) });
  assert.equal(fueraFE.ok, false);
  assert.equal(fueraFE.horasLimite, 48);
  assert.equal(elegibleCancelacion({ estadoSifen: 'aceptado', cdc: 'x', de: 'Nota de crédito electrónica', fechaProceso: hace(60) }).ok, true);
  assert.equal(elegibleCancelacion({ estadoSifen: 'rechazado', de: 'Factura electrónica' }).ok, false);
  assert.equal(elegibleCancelacion({ estadoSifen: 'cancelado', cdc: 'x', de: 'Factura electrónica', fechaProceso: hace(1) }).ok, false);
});

test('eliminación: nunca un documento que existe en SET', () => {
  assert.equal(elegibleEliminacion({ estadoSifen: 'rechazado' }).ok, true);
  assert.equal(elegibleEliminacion({ estadoSifen: 'error' }).ok, true);
  assert.equal(elegibleEliminacion({ estadoSifen: 'recibido' }).ok, true);
  for (const estado of ['aceptado', 'observado', 'cancelado']) {
    const r = elegibleEliminacion({ estadoSifen: estado });
    assert.equal(r.ok, false, estado);
    assert.match(r.motivo, /5 años/);
  }
  assert.equal(elegibleEliminacion({ estadoSifen: 'encolado' }).ok, false);
});

test('elegibilidad agrupa las cinco acciones', () => {
  const e = elegibilidad({ estadoSifen: 'rechazado', datosFactura: { data: { x: 1 } } });
  assert.deepEqual(Object.keys(e), ['reintento', 'cancelacion', 'eliminacion', 'consultaEstado', 'regenerarPdf']);
  assert.equal(e.consultaEstado.ok, false);
});

test('nombreArchivo sin acentos ni espacios', () => {
  assert.equal(nombreArchivo({ de: 'Nota de crédito electrónica', correlativo: '001-002-0000001' }, 'xml'), 'Nota_de_credito_electronica_001-002-0000001.xml');
  assert.equal(nombreArchivo({ correlativo: '001-001-0000108' }, 'pdf'), 'Factura_electronica_001-001-0000108.pdf');
});

test('CSV: separador ; con BOM, comillas escapadas y el CDC protegido de Excel', () => {
  const fila = filaCsv({
    fechaCreacion: new Date('2026-09-10T12:18:00Z'), correlativo: '001-002-0000001', de: 'Nota de crédito electrónica',
    estadoSifen: 'aceptado', codigoRetorno: '0260', mensajeRetorno: 'Aprobado', cdc: '05800557832001002000000122026083112601724007',
    cliente: { ruc: '80097313-5', nombre: 'INTERPROD "PY" S.A.' }, total: 532750, rucEmpresa: '80055783-2', tipoEmision: 1,
    datosFactura: { data: { moneda: 'USD', cambio: 6000 } }, proceso: 'Completado',
    respuestaSifen: { codigo: '0260', estado: 'Aprobado', protocolo: '3556326022' }
  });
  const csv = aCsv([fila]);
  assert.ok(csv.startsWith('﻿"Fecha";"Número"'));
  const linea = csv.split('\r\n')[1];
  assert.ok(linea.includes('"INTERPROD ""PY"" S.A."'), 'comillas escapadas');
  assert.ok(linea.includes(`"'05800557832001002000000122026083112601724007"`), 'CDC con apóstrofo');
  assert.ok(linea.includes('"USD";"532750";"6000"'));
  assert.ok(linea.startsWith('"2026-09-10 09:18:00"'), 'fecha en hora de Paraguay (UTC-3), no UTC');
  assert.ok(csv.split('\r\n')[0].includes('"Protocolo SET"'), 'columna de protocolo');
  assert.ok(linea.includes('"0260";"Aprobado";"3556326022"'), 'protocolo de autorización de SET en la fila');
});

// ---------------------------------------------------------------------
// Regenerar PDF
// ---------------------------------------------------------------------

test('regenerar PDF: solo documentos que existen en SET', () => {
  for (const estado of ['aceptado', 'observado', 'cancelado']) {
    assert.equal(elegibleRegenerarPdf({ estadoSifen: estado, cdc: 'x' }).ok, true, estado);
  }
  for (const estado of ['rechazado', 'error', 'encolado', 'procesando']) {
    assert.equal(elegibleRegenerarPdf({ estadoSifen: estado, cdc: 'x' }).ok, false, estado);
  }
  assert.equal(elegibleRegenerarPdf({ estadoSifen: 'aceptado' }).ok, false, 'sin CDC');
});

{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Invoice = require('../models/Invoice');
  const OperationLog = require('../models/OperationLog');

  // regenerarPdf carga estos módulos recién al ejecutarse: se reemplazan en la
  // caché para no tocar MongoDB ni levantar Java.
  const stub = (ruta, exports) => {
    const resuelta = require.resolve(ruta);
    require.cache[resuelta] = { id: resuelta, filename: resuelta, loaded: true, exports };
  };

  const preparar = ({ generar, empresa = { ruc: '80055783-2' } }) => {
    const estado = { llamadasKude: [], updates: [], logs: [] };
    stub('../models/Empresa', { findById: async () => empresa });
    stub('../services/procesarFacturaService', {
      generarKUDE: async (...args) => { estado.llamadasKude.push(args); return generar(); }
    });
    Invoice.updateOne = async (filtro, cambio) => { estado.updates.push({ filtro, cambio }); return { modifiedCount: 1 }; };
    OperationLog.prototype.save = async function () { estado.logs.push(this.toObject()); return this; };
    return estado;
  };

  const documento = (extra = {}) => ({
    _id: '6aedd711a1f290b6c27c9d5e', estadoSifen: 'aceptado', cdc: '01800557832001002000002522026110618319971046',
    correlativo: '001-002-0000025', fechaCreacion: new Date('2026-11-06T13:33:03Z'), empresaId: 'emp1',
    datosFactura: { data: { establecimiento: '001', punto: '002', numero: '0000025' } },
    xmlContent: '<rDE>firmado</rDE>', kudePath: '/app/de_output/viejo.pdf', ...extra
  });

  const pdfTemporal = (antiguedadMs = 0) => {
    const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'regen-pdf-')), 'kude.pdf');
    fs.writeFileSync(ruta, '%PDF-1.4');
    if (antiguedadMs) { const t = new Date(Date.now() - antiguedadMs); fs.utimesSync(ruta, t, t); }
    return ruta;
  };

  test('regenerar PDF: usa el XML firmado guardado y solo toca kudePath y proceso', async () => {
    const pdf = pdfTemporal();
    const estado = preparar({ generar: () => pdf });
    const doc = documento();

    const r = await regenerarPdf(doc);

    assert.equal(r.status, 200);
    assert.equal(r.body.data.correlativo, '001-002-0000025');
    assert.equal(estado.llamadasKude.length, 1);
    const [xml, cdc, correlativo, fecha, datos] = estado.llamadasKude[0];
    assert.equal(xml, '<rDE>firmado</rDE>', 'el mismo XML firmado: no se vuelve a generar ni a firmar');
    assert.equal(cdc, doc.cdc);
    assert.equal(correlativo, doc.correlativo);
    assert.equal(fecha.getTime(), doc.fechaCreacion.getTime(), 'misma fecha: mismo directorio que el PDF original');
    assert.equal(datos, doc.datosFactura);
    assert.deepEqual(estado.updates, [{ filtro: { _id: doc._id }, cambio: { $set: { kudePath: pdf, proceso: 'Completado' } } }]);
    assert.equal(estado.logs.length, 1);
    assert.equal(estado.logs[0].tipoOperacion, 'regeneracion_pdf');
    assert.equal(estado.logs[0].estado, 'success');
    assert.equal(estado.logs[0].detalle.pdfAnterior, '/app/de_output/viejo.pdf');
  });

  test('regenerar PDF: un documento que no existe en SET no llega a generar nada', async () => {
    const estado = preparar({ generar: () => pdfTemporal() });
    const r = await regenerarPdf(documento({ estadoSifen: 'rechazado' }));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'PDF_NO_REGENERABLE');
    assert.equal(estado.llamadasKude.length, 0);
    assert.equal(estado.updates.length, 0);
  });

  test('regenerar PDF: sin XML firmado responde 404 y no genera', async () => {
    const estado = preparar({ generar: () => pdfTemporal() });
    const r = await regenerarPdf(documento({ xmlContent: undefined, xmlPath: undefined }));
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'PDF_SIN_XML');
    assert.equal(estado.llamadasKude.length, 0);
  });

  test('regenerar PDF: si la generación falla el registro queda como estaba', async () => {
    const estado = preparar({ generar: () => null });
    const r = await regenerarPdf(documento());
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'PDF_REGENERAR_ERROR');
    assert.equal(estado.updates.length, 0, 'no se toca kudePath');
    assert.equal(estado.logs[0].estado, 'error');
  });

  test('regenerar PDF: un PDF que ya estaba (no se reescribió) cuenta como fallo', async () => {
    // El PDF nuevo pisa al anterior: si el archivo existe pero es viejo, el
    // generador no escribió nada y no se puede informar "regenerado".
    const estado = preparar({ generar: () => pdfTemporal(60000) });
    const r = await regenerarPdf(documento());
    assert.equal(r.status, 500);
    assert.equal(estado.updates.length, 0);
  });
}
