const crypto = require('crypto');
const Invoice = require('../models/Invoice');
const { facturaQueue, kudeQueue } = require('../queues/facturaQueue');
const { normalizarFechasEnObjeto } = require('../utils/fechaUtils');
const { buscarEmpresaPorRUC, validarEmpresaActiva, validarCertificadoValido } = require('./empresaService');

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

function generarFacturaHash(datosFactura) {
  const ruc = datosFactura.param?.ruc;
  const csa = datosFactura.data?.codigoSeguridadAleatorio;
  const numero = datosFactura.data?.numero;
  const cadena = `${ruc}|${csa}|${numero}`;
  return crypto.createHash('sha256').update(cadena).digest('hex');
}

function construirCorrelativo(datosFactura) {
  const data = datosFactura.data || datosFactura;
  const establecimiento = String(data.establecimiento || '001').padStart(3, '0');
  const punto = String(data.punto || '001').padStart(3, '0');
  const numero = String(data.numero || '0000001').padStart(7, '0');
  return `${establecimiento}-${punto}-${numero}`;
}

function calcularTotal(datosFactura) {
  const data = datosFactura.data || datosFactura;
  return data.totalPago || data.total ||
         datosFactura.totalPago || datosFactura.total ||
         (data.items?.reduce((sum, item) => sum + (item.precioTotal || item.precioUnitario * item.cantidad || 0), 0) || 0);
}

async function encolarFactura(facturaId, datosFactura, empresaId) {
  return facturaQueue.add('generar-factura', {
    facturaId: facturaId.toString(),
    datosFactura,
    empresaId: empresaId.toString()
  }, {
    priority: 0,
    removeOnComplete: true,
    timeout: 300000
  });
}

async function encolarKUDE(facturaId, xmlPath, cdc, correlativo, fechaCreacion, datosFactura, empresaId) {
  return kudeQueue.add('generar-kude', {
    facturaId: facturaId.toString(),
    xmlPath,
    cdc,
    correlativo,
    fechaCreacion,
    datosFactura,
    empresaId: empresaId?.toString()
  }, { priority: 1 });
}

async function crearFactura(datosFactura) {
  const data = datosFactura.data || datosFactura;

  normalizarFechasEnObjeto(data);

  const rucEmpresa = datosFactura.param?.ruc || datosFactura.ruc?.trim();
  if (!rucEmpresa) {
    throw Object.assign(new Error('El campo RUC es requerido para identificar la empresa emisora'), {
      statusCode: 400, errorCode: 'RUC_REQUIRED'
    });
  }

  const empresa = await buscarEmpresaPorRUC(rucEmpresa);
  validarEmpresaActiva(empresa);
  validarCertificadoValido(empresa);

  const correlativo = construirCorrelativo(datosFactura);
  const totalFactura = calcularTotal(datosFactura);
  const facturaHash = generarFacturaHash(datosFactura);
  const tipoDocumentoCodigo = data.tipoDocumento || datosFactura.tipoDocumento;
  const deDescripcion = tiposDocumentoMap[tipoDocumentoCodigo] || 'Factura electrónica';
  const tipoEmisionVal = data.tipoEmision || datosFactura.tipoEmision || 1;
  const cliente = data.cliente || datosFactura.cliente || {};

  const facturaExistente = await Invoice.findOne({ facturaHash });

  if (facturaExistente) {
    const estadosFinalesAprobados = ['aceptado', 'observado'];
    const estaAprobada = estadosFinalesAprobados.includes(facturaExistente.estadoSifen) && facturaExistente.cdc;

    if (estaAprobada && facturaExistente.proceso === 'No completado') {
      facturaExistente.proceso = null;
      facturaExistente.kudePath = null;
      await facturaExistente.save();

      const job = await encolarKUDE(
        facturaExistente._id,
        facturaExistente.xmlPath,
        facturaExistente.cdc,
        facturaExistente.correlativo,
        facturaExistente.fechaCreacion,
        facturaExistente.datosFactura,
        facturaExistente.empresaId
      );

      return {
        tipo: 'pdf_regeneracion',
        facturaId: facturaExistente._id,
        correlativo: facturaExistente.correlativo,
        estado: facturaExistente.estadoSifen,
        proceso: null,
        cdc: facturaExistente.cdc,
        kudeJobId: job.id
      };
    }

    if (estaAprobada && facturaExistente.proceso !== 'No completado') {
      throw Object.assign(new Error(`La factura ya tiene estado "${facturaExistente.estadoSifen}" en SET. Los archivos (XML/PDF) ya están generados.`), {
        statusCode: 409, errorCode: 'FACTURA_YA_APROBADA',
        detalles: {
          facturaId: facturaExistente._id,
          fechaCreacion: facturaExistente.fechaCreacion,
          correlativo: facturaExistente.correlativo,
          estadoSifen: facturaExistente.estadoSifen,
          cdc: facturaExistente.cdc,
          proceso: facturaExistente.proceso
        }
      });
    }

    facturaExistente.datosFactura = datosFactura;
    facturaExistente.estadoSifen = 'encolado';
    facturaExistente.proceso = null;
    facturaExistente.fechaCreacion = new Date();
    facturaExistente.de = deDescripcion;
    facturaExistente.tipoEmision = tipoEmisionVal;
    facturaExistente.cdc = null;
    facturaExistente.xmlPath = null;
    facturaExistente.kudePath = null;
    facturaExistente.codigoRetorno = null;
    facturaExistente.mensajeRetorno = null;
    facturaExistente.digestValue = null;
    facturaExistente.fechaProceso = null;
    facturaExistente.respuestaSifen = {};

    const estadoAnterior = facturaExistente.estadoSifen;
    const mensajeAnterior = facturaExistente.mensajeRetorno;

    await facturaExistente.save();

    const job = await encolarFactura(facturaExistente._id, datosFactura, empresa._id);

    return {
      tipo: 'reintento',
      facturaId: facturaExistente._id,
      correlativo,
      estado: 'encolado',
      proceso: null,
      jobId: job.id,
      reintentando: true,
      intentoAnterior: { estadoSifen: estadoAnterior, mensajeRetorno: mensajeAnterior },
      cdc: null
    };
  }

  const invoice = new Invoice({
    empresaId: empresa._id,
    rucEmpresa: empresa.ruc,
    correlativo,
    cliente: {
      ruc: cliente.ruc || cliente.documentoNumero || 'N/A',
      nombre: cliente.razonSocial || cliente.nombreFantasia || cliente.nombre || 'N/A',
      razonSocial: cliente.razonSocial,
      nombreFantasia: cliente.nombreFantasia,
      direccion: cliente.direccion,
      telefono: cliente.telefono,
      email: cliente.email,
      documentoTipo: cliente.documentoTipo,
      documentoNumero: cliente.documentoNumero
    },
    total: totalFactura,
    fechaCreacion: new Date(),
    estadoSifen: 'encolado',
    proceso: null,
    datosFactura,
    facturaHash,
    de: deDescripcion,
    tipoEmision: tipoEmisionVal
  });

  await invoice.save();

  const job = await encolarFactura(invoice._id, datosFactura, empresa._id);

  return {
    tipo: 'nueva',
    facturaId: invoice._id,
    correlativo,
    estado: 'encolado',
    proceso: null,
    jobId: job.id,
    cdc: null
  };
}

module.exports = { crearFactura, tiposDocumentoMap };
