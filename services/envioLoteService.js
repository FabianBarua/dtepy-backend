const LoteEnvio = require('../models/LoteEnvio');
const { generarIdSifen } = require('../utils/idSifen');
const Invoice = require('../models/Invoice');
const setApi = require('./setapi-wrapper');
const OperacionLog = require('../models/OperationLog');
const crypto = require('crypto');

const tiposDocumentoMap = {
  1: 'Factura electrónica',
  2: 'Factura electrónica de exportación',
  3: 'Factura electrónica de importación',
  4: 'Autofactura electrónica',
  5: 'Nota de crédito electrónica',
  6: 'Nota de débito electrónica',
  7: 'Nota de remisión electrónica',
  8: 'Comprobante de retención electrónico'
};

async function agregarFacturaALote(invoiceId, cdc, empresa, tipoDocumento) {
  const ambiente = empresa.configuracionSifen.modo;

  let lote = await LoteEnvio.findOne({
    empresaId: empresa._id,
    tipoDocumento: tipoDocumento,
    ambiente: ambiente,
    estado: 'en_espera'
  });

  if (!lote) {
    lote = new LoteEnvio({
      empresaId: empresa._id,
      tipoDocumento: tipoDocumento,
      descripcion: tiposDocumentoMap[tipoDocumento] || 'Documento electrónico',
      ambiente: ambiente,
      facturas: [],
      count: 0
    });
  }

  lote.facturas.push({
    facturaId: invoiceId,
    cdc: cdc,
    estadoIndividual: 'pendiente'
  });
  lote.count = lote.facturas.length;

  Invoice.findByIdAndUpdate(invoiceId, {
    grupoLoteId: lote._id,
    estadoSifen: 'encolado'
  }).catch(err => console.warn('⚠️ No se pudo actualizar invoice con grupoLoteId:', err.message));

  await lote.save();

  if (lote.count >= 50) {
    await enviarLote(lote._id);
  }

  return lote;
}

async function enviarLote(loteId) {
  const lote = await LoteEnvio.findById(loteId);
  if (!lote) throw new Error('Lote no encontrado');
  if (lote.estado !== 'en_espera') throw new Error(`El lote ya está en estado ${lote.estado}`);

  lote.estado = 'enviado';
  await lote.save();

  const invoiceIds = lote.facturas.map(f => f.facturaId);
  const invoices = await Invoice.find({ _id: { $in: invoiceIds } });
  const xmlMap = {};
  for (const inv of invoices) {
    xmlMap[inv._id.toString()] = inv.xmlContent;
  }

  const xmls = lote.facturas
    .map(f => xmlMap[f.facturaId.toString()])
    .filter(Boolean);

  if (xmls.length === 0) {
    lote.estado = 'error';
    await lote.save();
    throw new Error('Ninguna factura del lote tiene XML');
  }

  const Empresa = require('../models/Empresa');
  const empresa = await Empresa.findById(lote.empresaId);
  if (!empresa) throw new Error('Empresa no encontrada');

  const certificadoService = require('./certificadoService');
  const rutaCertificado = empresa.obtenerRutaCertificado();
  const contrasena = certificadoService.descifrarContrasena(empresa.certificado.contrasena);
  const idDocumento = generarIdSifen();

  let soapResponse;
  try {
    soapResponse = await setApi.recibeLote(
      idDocumento,
      xmls,
      lote.ambiente,
      rutaCertificado,
      contrasena
    );
  } catch (err) {
    lote.estado = 'error';
    await lote.save();
    throw err;
  }

  const loteIdMatch =
    soapResponse.match(/<ns2:dProtConsLote>(.*?)<\/ns2:dProtConsLote>/) ||
    soapResponse.match(/<dProtConsLote>(.*?)<\/dProtConsLote>/);

  const codigoMatch =
    soapResponse.match(/<ns2:dCodRes>(.*?)<\/ns2:dCodRes>/) ||
    soapResponse.match(/<dCodRes>(.*?)<\/dCodRes>/);

  const dProtConsLote = loteIdMatch ? loteIdMatch[1].trim() : null;
  const codigo = codigoMatch ? codigoMatch[1].trim() : null;

  lote.dProtConsLote = dProtConsLote;
  lote.respuestaSifen = {
    codigo: codigo,
    dProtConsLote: dProtConsLote,
    raw: soapResponse
  };

  await OperacionLog.create({
    invoiceId: lote._id,
    tipoOperacion: 'envio_lote',
    descripcion: `Lote enviado - ${lote.count} facturas, dProtConsLote: ${dProtConsLote}`,
    estado: codigo === '0260' ? 'success' : 'error',
    detalle: { loteId: lote._id, dProtConsLote, codigo }
  });

  lote.estado = 'procesando';
  await lote.save();

  return lote;
}

async function consultarResultadoLote(loteId) {
  const lote = await LoteEnvio.findById(loteId);
  if (!lote) throw new Error('Lote no encontrado');
  if (lote.estado !== 'procesando' && lote.estado !== 'enviado') {
    return { lote, completado: false, mensaje: `Estado actual: ${lote.estado}` };
  }

  const Empresa = require('../models/Empresa');
  const empresa = await Empresa.findById(lote.empresaId);
  if (!empresa) throw new Error('Empresa no encontrada');

  if (!lote.dProtConsLote) {
    lote.estado = 'error';
    await lote.save();
    return { lote, completado: false, mensaje: 'Sin dProtConsLote' };
  }

  const certificadoService = require('./certificadoService');
  const rutaCertificado = empresa.obtenerRutaCertificado();
  const contrasena = certificadoService.descifrarContrasena(empresa.certificado.contrasena);
  const idDocumento = generarIdSifen();

  let soapResponse;
  try {
    soapResponse = await setApi.consultaLote(
      idDocumento,
      parseInt(lote.dProtConsLote),
      lote.ambiente,
      rutaCertificado,
      contrasena
    );
  } catch (err) {
    console.warn(`⚠️ Error consultando lote ${loteId}: ${err.message}`);
    return { lote, completado: false, mensaje: err.message };
  }

  const codigoMatch =
    soapResponse.match(/<ns2:dCodRes>(.*?)<\/ns2:dCodRes>/) ||
    soapResponse.match(/<dCodRes>(.*?)<\/dCodRes>/);
  const codigo = codigoMatch ? codigoMatch[1].trim() : null;

  const resultadosMatch = soapResponse.match(/<ns2:dProtDE>.*?<\/ns2:dProtDE>/gs) ||
                          soapResponse.match(/<dProtDE>.*?<\/dProtDE>/gs);

  if (resultadosMatch && resultadosMatch.length > 0) {
    let todosResueltos = true;
    for (let i = 0; i < resultadosMatch.length && i < lote.facturas.length; i++) {
      const bloque = resultadosMatch[i];
      const estResMatch = bloque.match(/<ns2:dEstRes>(.*?)<\/ns2:dEstRes>/) ||
                          bloque.match(/<dEstRes>(.*?)<\/dEstRes>/);
      const msgResMatch = bloque.match(/<ns2:dMsgRes>(.*?)<\/ns2:dMsgRes>/) ||
                          bloque.match(/<dMsgRes>(.*?)<\/dMsgRes>/);
      const cdcMatch = bloque.match(/<ns2:dCDCGestion>(.*?)<\/ns2:dCDCGestion>/) ||
                       bloque.match(/<dCDCGestion>(.*?)<\/dCDCGestion>/);

      const estRes = estResMatch ? estResMatch[1].trim() : null;
      const msgRes = msgResMatch ? msgResMatch[1].trim() : null;
      const cdcResp = cdcMatch ? cdcMatch[1].trim() : null;

      let estadoIndividual;
      let estadoVisual;
      if (estRes === 'Aprobado' || estRes === 'Apobado') {
        estadoIndividual = 'aceptado';
        estadoVisual = 'aceptado';
      } else if (estRes === 'Rechazado') {
        estadoIndividual = 'rechazado';
        estadoVisual = 'rechazado';
      } else if (estRes === 'Aprobado con observación' || estRes === 'Observado') {
        estadoIndividual = 'observado';
        estadoVisual = 'observado';
      } else {
        todosResueltos = false;
        continue;
      }

      lote.facturas[i].estadoIndividual = estadoIndividual;

      Invoice.findByIdAndUpdate(lote.facturas[i].facturaId, {
        estadoSifen: estadoIndividual,
        estadoVisual: estadoVisual,
        mensajeRetorno: msgRes
      }).catch(err => console.warn('⚠️ No se pudo actualizar factura del lote:', err.message));
    }

    if (todosResueltos) {
      lote.estado = 'completado';
    }

    lote.respuestaSifen = {
      codigo: codigo,
      dProtConsLote: lote.dProtConsLote,
      raw: soapResponse
    };

    await lote.save();
    return { lote, completado: todosResueltos, mensaje: `Procesadas ${resultadosMatch.length} facturas` };
  }

  return { lote, completado: false, mensaje: `Código: ${codigo}` };
}

async function enviarPendientes() {
  const lotes = await LoteEnvio.find({ estado: 'en_espera', count: { $gt: 0 } });
  const resultados = [];
  for (const lote of lotes) {
    try {
      await enviarLote(lote._id);
      resultados.push({ loteId: lote._id, success: true });
    } catch (err) {
      resultados.push({ loteId: lote._id, success: false, error: err.message });
    }
  }
  return resultados;
}

async function consultarPendientes() {
  const lotes = await LoteEnvio.find({ estado: { $in: ['enviado', 'procesando'] }, dProtConsLote: { $ne: null } });
  const resultados = [];
  for (const lote of lotes) {
    try {
      const res = await consultarResultadoLote(lote._id);
      resultados.push({ loteId: lote._id, completado: res.completado });
    } catch (err) {
      resultados.push({ loteId: lote._id, completado: false, error: err.message });
    }
  }
  return resultados;
}

module.exports = {
  agregarFacturaALote,
  enviarLote,
  consultarResultadoLote,
  enviarPendientes,
  consultarPendientes
};
