const crypto = require('crypto');
const Invoice = require('../models/Invoice');
const SecuenciaFactura = require('../models/SecuenciaFactura');
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

/**
 * Asigna el siguiente número correlativo (7 dígitos) para la secuencia
 * timbrado + tipo de documento + establecimiento + punto de la empresa.
 *
 * El contador es atómico ($inc), así que emisiones concurrentes reciben
 * números distintos. Los números que una integración ya usó mandando
 * data.numero explícito se saltan (el contador avanza hasta uno libre).
 */
async function asignarNumeroCorrelativo(empresa, datosFactura) {
  const data = datosFactura.data || datosFactura;
  const clave = {
    empresaId: empresa._id,
    timbrado: String(datosFactura.param?.timbradoNumero || empresa.configuracionSifen?.timbrado || ''),
    tipoDocumento: Number(data.tipoDocumento || datosFactura.tipoDocumento || 1),
    establecimiento: String(data.establecimiento || '001').padStart(3, '0'),
    punto: String(data.punto || '001').padStart(3, '0')
  };
  const deDescripcion = tiposDocumentoMap[clave.tipoDocumento] || 'Factura electrónica';

  for (let intento = 0; intento < 200; intento++) {
    let secuencia;
    try {
      secuencia = await SecuenciaFactura.findOneAndUpdate(
        clave,
        { $inc: { ultimoNumero: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      // E11000: dos requests crearon la secuencia a la vez; reintentar toma
      // el documento ya insertado.
      if (error.code === 11000) continue;
      throw error;
    }

    if (secuencia.ultimoNumero > 9999999) {
      throw Object.assign(new Error(`Numeración agotada para ${clave.establecimiento}-${clave.punto} (timbrado ${clave.timbrado}): se llegó al 9999999`), {
        statusCode: 409, errorCode: 'NUMERACION_AGOTADA'
      });
    }

    const numero = String(secuencia.ultimoNumero).padStart(7, '0');
    const correlativo = `${clave.establecimiento}-${clave.punto}-${numero}`;
    const ocupado = await Invoice.exists({ empresaId: empresa._id, correlativo, de: deDescripcion });
    if (!ocupado) return numero;
  }

  throw Object.assign(new Error('No se pudo asignar un número correlativo libre'), {
    statusCode: 500, errorCode: 'NUMERACION_SIN_LIBRES'
  });
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

  // Establecimiento y punto de expedición: si el payload no los trae, se usan
  // los configurados por defecto en la empresa. Debe resolverse ANTES de la
  // numeración (la secuencia es por establecimiento+punto).
  if (!data.establecimiento) data.establecimiento = empresa.configuracionSifen?.establecimiento || '001';
  if (!data.punto) data.punto = empresa.configuracionSifen?.puntoExpedicion || '001';

  // Numeración: si la integración no manda data.numero, el sistema asigna el
  // siguiente correlativo. Debe ocurrir ANTES de construir hash/correlativo
  // (y de encolar) porque el número forma parte del CDC del documento.
  if (!data.numero) {
    data.numero = await asignarNumeroCorrelativo(empresa, datosFactura);
    console.log(`🔢 Número correlativo asignado: ${data.numero}`);
  } else {
    data.numero = String(data.numero).padStart(7, '0');
  }

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
