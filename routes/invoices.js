const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const OperationLog = require('../models/OperationLog');
const { verificarToken } = require('../middleware/auth');
const {
  extraerCodigoRetorno,
  extraerMensajeRetorno,
  extraerEstadoResultado,
  extraerEstadoDocumento
} = require('../utils/estadoSifen');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// Obtener todas las facturas
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, estado, rucEmpresa, search, searchType } = req.query;

    const query = {};
    if (estado) {
      query.estadoSifen = estado;
    }
    if (rucEmpresa) {
      query.rucEmpresa = rucEmpresa;
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      switch (searchType) {
        case 'ruc':
          query['cliente.ruc'] = searchRegex;
          break;
        case 'nombre':
          query['cliente.nombre'] = searchRegex;
          break;
        case 'cdc':
          query.cdc = searchRegex;
          break;
        case 'tipo':
          query.de = searchRegex;
          break;
        case 'id':
          if (mongoose.Types.ObjectId.isValid(search)) {
            query._id = search;
          } else {
            query._id = null;
          }
          break;
      }
    }

    const invoices = await Invoice.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Invoice.countDocuments(query);

    const invoicesTransformadas = invoices.map(invoice => {
      const invoiceObj = invoice.toObject();
      return {
        ...invoiceObj,
        estado: invoice.estadoSifen,
        estadoVisual: invoice.estadoVisual || 'rechazado',
        codigoRetorno: invoice.codigoRetorno || null,
        de: invoice.de || 'Factura electrónica'
      };
    });

    res.json({
      success: true,
      message: 'Facturas obtenidas exitosamente',
      invoices: invoicesTransformadas,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Error listando facturas:', error);
    res.status(500).json({ success: false, error: 'INVOICES_LIST_ERROR', message: error.message });
  }
});

// -------------------------------------------------------------------
// Rutas específicas (deben ir ANTES de /:id para evitar conflictos)
// -------------------------------------------------------------------

// Buscar factura por CDC (local + SET)
router.get('/cdc/:cdc', async (req, res) => {
  try {
    const cdc = req.params.cdc;

    if (!cdc) {
      res.status(400).json({ success: false, error: 'CDC_REQUIRED', message: 'CDC requerido' });
      return;
    }

    const invoiceRecord = await Invoice.findOne({ cdc });

    if (invoiceRecord) {
      res.status(200).json({
        success: true,
        message: 'Factura encontrada localmente',
        encontrado: true,
        fuente: 'local',
        data: {
          _id: invoiceRecord._id,
          correlativo: invoiceRecord.correlativo,
          cdc: invoiceRecord.cdc,
          estadoSifen: invoiceRecord.estadoSifen,
          proceso: invoiceRecord.proceso,
          fechaCreacion: invoiceRecord.fechaCreacion,
          fechaEnvio: invoiceRecord.fechaEnvio,
          fechaProceso: invoiceRecord.fechaProceso,
          digestValue: invoiceRecord.digestValue,
          total: invoiceRecord.total,
          cliente: invoiceRecord.cliente,
          xmlPath: invoiceRecord.xmlPath
        }
      });
      return;
    }

    try {
      const setApi = require('../services/setapi-wrapper');
      const idConsulta = crypto.randomBytes(16).toString('hex');
      const ambiente = "test";
      const certificateP12Path = path.join(__dirname, '..', 'certificados', 'p12', 'certificado.p12');
      const certificatePassword = '123456';

      const respuesta = await setApi.consulta(idConsulta, cdc, ambiente, certificateP12Path, certificatePassword);

      res.status(200).json({
        success: true,
        message: 'Factura encontrada en SIFEN',
        encontrado: true,
        fuente: 'sifen',
        data: { respuesta }
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: 'CDC_NOT_FOUND_SIFEN',
        message: 'CDC no encontrado en SIFEN',
        encontrado: false,
        cdc: cdc
      });
    }
  } catch (error) {
    console.error('Error al consultar por CDC:', error);
    res.status(500).json({ success: false, error: 'CDC_CONSULTA_ERROR', message: 'Error al consultar por CDC' });
  }
});

// Consultar estado con SET (incluye actualización)
router.get('/estado/:cdc', async (req, res) => {
  try {
    const cdc = req.params.cdc;

    if (!cdc) {
      res.status(400).json({ success: false, error: 'CDC_REQUIRED', message: 'CDC requerido' });
      return;
    }

    const invoiceRecord = await Invoice.findOne({ cdc });

    if (!invoiceRecord) {
      res.status(404).json({
        success: false,
        error: 'FACTURA_NOT_FOUND_LOCAL',
        message: 'Factura no encontrada en la base de datos local',
        encontrado: false,
        cdc: cdc
      });
      return;
    }

    let estadoSET = null;

    try {
      const Empresa = require('../models/Empresa');
      const setApi = require('../services/setapi-wrapper');
      const empresa = await Empresa.findById(invoiceRecord.empresaId);

      if (!empresa) {
        console.log('⚠️ No se encontró la empresa, usando configuración por defecto');
      }

      const idConsulta = crypto.randomBytes(16).toString('hex');
      const ambiente = empresa?.configuracionSifen?.modo || 'test';

      let certificateP12Path = path.join(__dirname, '..', 'certificados', 'p12', 'certificado.p12');
      let certificatePassword = '123456';

      if (empresa?.certificado?.nombreArchivo) {
        const certificadoService = require('../services/certificadoService');
        certificateP12Path = path.join(__dirname, '..', 'certificados', 'p12', empresa.certificado.nombreArchivo);
        certificatePassword = certificadoService.descifrarContrasena(empresa.certificado.contrasena);
        console.log(`🔑 Usando certificado de la empresa: ${empresa.certificado.nombreArchivo}`);
      } else {
        console.log('⚠️ Empresa no tiene certificado configurado, usando certificado por defecto');
      }

      const respuesta = await setApi.consulta(idConsulta, cdc, ambiente, certificateP12Path, certificatePassword);

      const codigoRetornoMatch =
        respuesta.match(/<ns2:dCodRes>(.*?)<\/ns2:dCodRes>/) ||
        respuesta.match(/<dCodRes>(.*?)<\/dCodRes>/) ||
        respuesta.match(/<codigoRetorno>(.*?)<\/codigoRetorno>/);

      let codigoRetorno = null;

      if (codigoRetornoMatch && codigoRetornoMatch[1]) {
        codigoRetorno = codigoRetornoMatch[1].trim();
      }

      estadoSET = extraerEstadoDocumento(respuesta);

      console.log(`📥 Consulta SET - CDC: ${cdc}, dCodRes: ${codigoRetorno}, estado: ${estadoSET}`);

      if (codigoRetorno && estadoSET) {
        let nuevoEstadoSifen = invoiceRecord.estadoSifen;
        let nuevoEstadoVisual = invoiceRecord.estadoVisual;

        if (codigoRetorno === '0421') {
          if (estadoSET === 'Aprobado' || estadoSET === 'aprobado') {
            nuevoEstadoSifen = 'aceptado';
            nuevoEstadoVisual = 'aceptado';
          } else if (estadoSET === 'Rechazado' || estadoSET === 'rechazado') {
            nuevoEstadoSifen = 'rechazado';
            nuevoEstadoVisual = 'rechazado';
          } else if (estadoSET === 'Aprobado con observación' || estadoSET === 'observado') {
            nuevoEstadoSifen = 'observado';
            nuevoEstadoVisual = 'observado';
          } else {
            nuevoEstadoSifen = 'procesando';
            nuevoEstadoVisual = 'observado';
          }
        } else if (codigoRetorno === '0420') {
          nuevoEstadoSifen = 'rechazado';
          nuevoEstadoVisual = 'rechazado';
        } else if (codigoRetorno === '1005') {
          nuevoEstadoSifen = 'observado';
          nuevoEstadoVisual = 'observado';
        }

        if (nuevoEstadoSifen !== invoiceRecord.estadoSifen || nuevoEstadoVisual !== invoiceRecord.estadoVisual) {
          invoiceRecord.estadoSifen = nuevoEstadoSifen;
          invoiceRecord.estadoVisual = nuevoEstadoVisual;
          invoiceRecord.codigoRetorno = codigoRetorno;
          await invoiceRecord.save();
          console.log(`🔄 Estado actualizado para CDC ${cdc}: ${nuevoEstadoSifen} / ${nuevoEstadoVisual}`);
        }
      }
    } catch (error) {
      console.log('⚠️ No se pudo consultar el estado a la SET, usando estado local');
    }

    res.status(200).json({
      success: true,
      message: 'Estado consultado exitosamente',
      encontrado: true,
      cdc: cdc,
      estadoLocal: invoiceRecord.estadoSifen,
      proceso: invoiceRecord.proceso,
      estadoSET: estadoSET,
      estadoActualizado: estadoSET !== invoiceRecord.estadoSifen,
      data: {
        correlativo: invoiceRecord.correlativo,
        codigoRetorno: invoiceRecord.codigoRetorno,
        mensajeRetorno: invoiceRecord.mensajeRetorno,
        fechaCreacion: invoiceRecord.fechaCreacion,
        fechaEnvio: invoiceRecord.fechaEnvio,
        fechaProceso: invoiceRecord.fechaProceso,
        total: invoiceRecord.total,
        cliente: invoiceRecord.cliente
      }
    });
  } catch (error) {
    console.error('Error al verificar estado:', error);
    res.status(500).json({ success: false, error: 'ESTADO_CONSULTA_ERROR', message: 'Error al verificar estado' });
  }
});

// Obtener todos los logs del sistema
router.get('/logs', async (req, res) => {
  try {
    const { page = 1, limit = 10, tipo, estado } = req.query;

    const query = {};
    if (tipo) {
      query.tipoOperacion = tipo;
    }
    if (estado) {
      query.estado = estado;
    }

    const logs = await OperationLog.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) * 1)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .exec();

    const total = await OperationLog.countDocuments(query);

    res.json({
      success: true,
      message: 'Logs obtenidos exitosamente',
      logs,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Error listando logs:', error);
    res.status(500).json({ success: false, error: 'LOGS_LIST_ERROR', message: error.message });
  }
});

// Limpiar todas las facturas (requiere contraseña)
router.delete('/clear', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'PASSWORD_REQUIRED', message: 'Contraseña requerida' });
    }

    const User = require('../models/User');
    const usuario = await User.findById(req.usuario._id).select('+password');
    if (!usuario) {
      return res.status(401).json({ success: false, error: 'USER_NOT_FOUND', message: 'Usuario no encontrado' });
    }

    const passwordValido = await usuario.compararPassword(password);
    if (!passwordValido) {
      return res.status(401).json({ success: false, error: 'PASSWORD_INCORRECT', message: 'Contraseña incorrecta' });
    }

    const result = await Invoice.deleteMany({});

    const logsResult = await OperationLog.deleteMany({});

    console.log(`🗑️ Base de datos limpiada: ${result.deletedCount} facturas, ${logsResult.deletedCount} registros eliminados`);

    res.status(200).json({
      success: true,
      message: 'Base de datos limpiada exitosamente',
      deletedCount: result.deletedCount,
      deletedLogs: logsResult.deletedCount
    });
  } catch (error) {
    console.error('Error al limpiar base de datos:', error);
    res.status(500).json({
      success: false,
      error: 'CLEAR_DB_ERROR',
      message: error.message
    });
  }
});

// -------------------------------------------------------------------
// Rutas con parámetro :id (ordenadas de más específicas a genéricas)
// -------------------------------------------------------------------

// Obtener una factura específica
router.get('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'FACTURA_NOT_FOUND', message: 'Factura no encontrada' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const xmlLink = invoice.xmlPath ? `${baseUrl}/api/invoices/${invoice._id}/download-xml` : null;
    const kudeLink = invoice.kudePath ? `${baseUrl}/api/invoices/${invoice._id}/download-pdf` : null;

    const estadosFinales = ['aceptado', 'rechazado', 'error', 'observado'];
    const esEstadoFinal = estadosFinales.includes(invoice.estadoSifen);

    const recomendarRefresh = !esEstadoFinal && invoice.cdc;

    res.json({
      success: true,
      data: {
        facturaId: invoice._id,
        correlativo: invoice.correlativo,
        cdc: invoice.cdc || null,
        estado: invoice.estadoSifen,
        proceso: invoice.proceso || null,
        estadoVisual: invoice.estadoVisual || 'rechazado',
        esEstadoFinal: esEstadoFinal,
        recomendarRefresh: recomendarRefresh,
        xmlPath: invoice.xmlPath,
        kudePath: invoice.kudePath,
        xmlLink: xmlLink,
        kudeLink: kudeLink,
        cliente: invoice.cliente,
        total: invoice.total,
        fechaCreacion: invoice.fechaCreacion,
        fechaEnvio: invoice.fechaEnvio,
        fechaProceso: invoice.fechaProceso,
        codigoRetorno: invoice.codigoRetorno,
        mensajeRetorno: invoice.mensajeRetorno,
        digestValue: invoice.digestValue,
        qrCode: invoice.qrCode,
        datosFactura: invoice.datosFactura || null,
        xmlContent: invoice.xmlContent || null,
        de: invoice.de || 'Factura electrónica',
        tipoEmision: invoice.tipoEmision || 1,
        grupoLoteId: invoice.grupoLoteId || null
      }
    });
  } catch (error) {
    console.error('Error obteniendo factura:', error);
    res.status(500).json({
      success: false,
      error: 'FACTURA_GET_ERROR',
      message: error.message
    });
  }
});

// Obtener logs de una factura
router.get('/:id/logs', async (req, res) => {
  try {
    const logs = await OperationLog.find({ invoiceId: req.params.id })
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (error) {
    console.error('Error obteniendo logs de factura:', error);
    res.status(500).json({ success: false, error: 'LOGS_GET_ERROR', message: error.message });
  }
});

// Obtener eventos de una factura
router.get('/:id/eventos', async (req, res) => {
  try {
    const Evento = require('../models/Evento');
    const eventos = await Evento.find({ invoiceId: req.params.id })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Eventos obtenidos',
      total: eventos.length,
      eventos
    });
  } catch (error) {
    console.error('Error obteniendo eventos de factura:', error);
    res.status(500).json({
      success: false,
      error: 'EVENTOS_GET_ERROR',
      message: error.message
    });
  }
});

// Reintentar envío de factura
router.post('/:id/retry', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'FACTURA_NOT_FOUND', message: 'Factura no encontrada' });
    }

    const retryLog = new OperationLog({
      invoiceId: invoice._id,
      tipoOperacion: 'reintento',
      descripcion: `Reintento de envío a SIFEN - CDC: ${invoice.cdc}`,
      estado: 'warning',
      fecha: new Date(),
      detalle: {
        cdc: invoice.cdc,
        correlativo: invoice.correlativo,
        estadoAnterior: invoice.estadoSifen,
        xmlPath: invoice.xmlPath,
        motivo: 'Reintento manual desde frontend'
      }
    });

    await retryLog.save();

    if (!invoice.xmlPath || !fs.existsSync(path.join(__dirname, '../de_output', invoice.xmlPath))) {
      return res.status(400).json({
        success: false,
        error: 'RETRY_XML_NOT_FOUND',
        message: 'No se puede reenviar: XML no encontrado',
        detalle: 'El archivo XML de esta factura no existe en el servidor'
      });
    }

    const estadosFinales = ['aceptado', 'observado'];
    if (estadosFinales.includes(invoice.estadoSifen) && invoice.cdc) {
      return res.status(400).json({
        success: false,
        error: 'RETRY_ESTADO_FINAL',
        message: 'No es necesario reenviar a SET',
        detalle: `La factura ya tiene estado "${invoice.estadoSifen}" en la base de datos. Si necesitas actualizar el estado, usa "Consultar Estado" en lugar de "Reintentar".`,
        estadoActual: invoice.estadoSifen,
        cdc: invoice.cdc
      });
    }

    const xmlPath = path.join(__dirname, '../de_output', invoice.xmlPath);
    const xmlOriginal = fs.readFileSync(xmlPath, 'utf8');

    const cdc = invoice.cdc;

    if (!cdc) {
      return res.status(400).json({
        success: false,
        error: 'RETRY_CDC_NOT_FOUND',
        message: 'No se puede reenviar: CDC no encontrado',
        detalle: 'La factura no tiene un CDC asociado'
      });
    }

    invoice.estadoSifen = 'procesando';
    await invoice.save();

    try {
      const setApi = require('../services/setapi-wrapper');
      const idDocumento = 'retry-' + Date.now();
      const ambiente = process.env.AMBIENTE_SET || 'test';

      console.log(`🔄 Reenviando factura CDC ${cdc} a la SET...`);

      const soapResponse = await setApi.recibe(idDocumento, xmlOriginal, ambiente);

      console.log('📄 Respuesta SOAP recibida en reenvío:');
      console.log(soapResponse.substring(0, 500) + '...');

      const codigoRetorno = extraerCodigoRetorno(soapResponse);
      const mensajeRetorno = extraerMensajeRetorno(soapResponse);
      const estadoResultado = extraerEstadoResultado(soapResponse);

      let nuevoEstado = 'enviado';
      let estadoVisual = 'observado';

      if (codigoRetorno === '0260') {
        nuevoEstado = 'aceptado';
        estadoVisual = 'aceptado';
      } else if (codigoRetorno === '1005') {
        nuevoEstado = 'observado';
        estadoVisual = 'observado';
      } else if (['1000', '1001', '1002', '1003', '1004', '0420'].includes(codigoRetorno)) {
        nuevoEstado = 'rechazado';
        estadoVisual = 'rechazado';
      } else if (['0', '2'].includes(codigoRetorno)) {
        nuevoEstado = 'aceptado';
        estadoVisual = 'aceptado';
      }

      invoice.estadoSifen = nuevoEstado;
      invoice.estadoVisual = estadoVisual;
      invoice.codigoRetorno = codigoRetorno;
      invoice.mensajeRetorno = mensajeRetorno;
      await invoice.save();

      const resultLog = new OperationLog({
        invoiceId: invoice._id,
        tipoOperacion: 'reintento_respuesta',
        descripcion: `Reenvío completado - Estado: ${nuevoEstado}, Visual: ${estadoVisual}, Código: ${codigoRetorno}`,
        estadoAnterior: 'procesando',
        estadoNuevo: nuevoEstado,
        fecha: new Date(),
        detalle: {
          cdc: cdc,
          codigoRetorno: codigoRetorno,
          mensajeRetorno: mensajeRetorno,
          estadoResultado: estadoResultado,
          estadoVisual: estadoVisual,
          idDocumento: idDocumento
        }
      });
      await resultLog.save();

      console.log(`✅ Reenvío completado - CDC: ${cdc}, Estado: ${nuevoEstado}`);

      res.json({
        success: true,
        message: 'Reenvío completado',
        data: {
          invoice,
          estado: nuevoEstado,
          codigoRetorno,
          mensajeRetorno
        }
      });

    } catch (error) {
      console.error('❌ Error al reenviar:', error.message);

      invoice.estadoSifen = 'error';
      invoice.estadoVisual = 'error';
      invoice.mensajeRetorno = `Error al reenviar: ${error.message}`;
      await invoice.save();

      const errorLog = new OperationLog({
        invoiceId: invoice._id,
        tipoOperacion: 'error',
        descripcion: `Error en reintento de envío: ${error.message}`,
        estado: 'error',
        detalle: {
          error: error.message,
          stack: error.stack
        },
        fecha: new Date()
      });
      await errorLog.save();

      res.status(500).json({
        success: false,
        error: 'RETRY_ERROR',
        message: 'Error al reenviar factura',
        detalle: error.message
      });
    }

  } catch (error) {
    console.error('Error en retry:', error);
    res.status(500).json({ success: false, error: 'RETRY_ERROR', message: error.message });
  }
});

// Refrescar estado desde SET
router.post('/:id/refresh-status', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🔄 Consultando estado para factura ID: ${id}`);

    const invoiceRecord = await Invoice.findById(id);

    if (!invoiceRecord) {
      console.log(`❌ Factura no encontrada: ${id}`);
      return res.status(404).json({
        success: false,
        error: 'Factura no encontrada'
      });
    }

    if (!invoiceRecord.cdc) {
      console.log(`❌ Factura sin CDC: ${id}`);
      return res.status(400).json({
        success: false,
        error: 'CDC_REQUIRED',
        message: 'La factura no tiene CDC asignado'
      });
    }

    console.log(`📋 CDC encontrado: ${invoiceRecord.cdc}, Estado actual: ${invoiceRecord.estadoSifen}`);

    const estadosFinales = ['aceptado', 'rechazado', 'error', 'observado'];
    const esEstadoFinal = estadosFinales.includes(invoiceRecord.estadoSifen);

    if (esEstadoFinal) {
      console.log(`✅ Estado final '${invoiceRecord.estadoSifen}' - No es necesario consultar a SET`);
      console.log(`   Los estados finales no cambian según Manual Técnico v150`);

      return res.json({
        success: true,
        message: 'Estado final - No se consultó a SET (no hay cambios posibles)',
        esEstadoFinal: true,
        consultoSET: false,
        estadoAnterior: invoiceRecord.estadoSifen,
        estadoActual: invoiceRecord.estadoSifen,
        estadoVisual: invoiceRecord.estadoVisual,
        estadoCambio: false,
        data: {
          estado: invoiceRecord.estadoSifen,
          estadoVisual: invoiceRecord.estadoVisual,
          facturaId: invoiceRecord._id,
          correlativo: invoiceRecord.correlativo,
          cdc: invoiceRecord.cdc,
          codigoRetorno: invoiceRecord.codigoRetorno,
          mensajeRetorno: invoiceRecord.mensajeRetorno,
          fechaProceso: invoiceRecord.fechaProceso
        }
      });
    }

    try {
      const Empresa = require('../models/Empresa');
      const setApi = require('../services/setapi-wrapper');
      const empresa = await Empresa.findById(invoiceRecord.empresaId);

      if (!empresa) {
        console.log('⚠️ No se encontró la empresa, usando configuración por defecto');
      }

      const idConsulta = crypto.randomBytes(16).toString('hex');
      const ambiente = empresa?.configuracionSifen?.modo || 'test';

      let certificateP12Path = path.join(__dirname, '..', 'certificados', 'p12', 'certificado.p12');
      let certificatePassword = '123456';

      if (empresa?.certificado?.nombreArchivo) {
        const certificadoService = require('../services/certificadoService');
        certificateP12Path = path.join(__dirname, '..', 'certificados', 'p12', empresa.certificado.nombreArchivo);
        certificatePassword = certificadoService.descifrarContrasena(empresa.certificado.contrasena);
        console.log(`🔑 Usando certificado de la empresa: ${empresa.certificado.nombreArchivo}`);
      } else {
        console.log('⚠️ Empresa no tiene certificado configurado, usando certificado por defecto');
      }

      console.log('📤 Enviando consulta a la SET...');

      const respuesta = await setApi.consulta(idConsulta, invoiceRecord.cdc, ambiente, certificateP12Path, certificatePassword);

      console.log('📥 Respuesta recibida de la SET');
      console.log('Respuesta:', respuesta.substring(0, 500));

      const codigoRetornoMatch =
        respuesta.match(/<ns2:dCodRes>(.*?)<\/ns2:dCodRes>/) ||
        respuesta.match(/<dCodRes>(.*?)<\/dCodRes>/) ||
        respuesta.match(/<codigoRetorno>(.*?)<\/codigoRetorno>/);

      const estadoRetornoMatch =
        respuesta.match(/<ns2:estado>(.*?)<\/ns2:estado>/) ||
        respuesta.match(/<estado>(.*?)<\/estado>/) ||
        respuesta.match(/<ns2:dEstRes>(.*?)<\/ns2:dEstRes>/) ||
        respuesta.match(/<dEstRes>(.*?)<\/dEstRes>/) ||
        respuesta.match(/<estadoResultado>(.*?)<\/estadoResultado>/);

      const mensajeRetornoMatch =
        respuesta.match(/<ns2:dMsgRes>(.*?)<\/ns2:dMsgRes>/) ||
        respuesta.match(/<dMsgRes>(.*?)<\/dMsgRes>/) ||
        respuesta.match(/<mensajeRetorno>(.*?)<\/mensajeRetorno>/);

      const fechaProcesoMatch =
        respuesta.match(/<ns2:dFecProc>(.*?)<\/ns2:dFecProc>/) ||
        respuesta.match(/<dFecProc>(.*?)<\/dFecProc>/) ||
        respuesta.match(/<fechaProceso>(.*?)<\/fechaProceso>/);

      const digestValueMatch =
        respuesta.match(/<ns2:dDigVal>(.*?)<\/ns2:dDigVal>/) ||
        respuesta.match(/<dDigVal>(.*?)<\/dDigVal>/) ||
        respuesta.match(/<digestValue>(.*?)<\/digestValue>/);

      console.log('🔍 Extrayendo datos de la respuesta...');
      console.log('  codigoRetornoMatch:', codigoRetornoMatch);
      console.log('  estadoRetornoMatch:', estadoRetornoMatch);
      console.log('  mensajeRetornoMatch:', mensajeRetornoMatch);
      console.log('  Respuesta SOAP (primeros 800 chars):', respuesta.substring(0, 800));

      let codigoRetorno = invoiceRecord.codigoRetorno;
      let estadoRetorno = invoiceRecord.respuestaSifen?.estado;
      let mensajeRetorno = invoiceRecord.mensajeRetorno;
      let fechaProceso = invoiceRecord.fechaProceso;
      let digestValueResp = invoiceRecord.digestValue;

      if (codigoRetornoMatch && codigoRetornoMatch[1]) {
        codigoRetorno = codigoRetornoMatch[1].trim();
        console.log('  Código de retorno extraído:', codigoRetorno);
      }

      if (estadoRetornoMatch && estadoRetornoMatch[1]) {
        estadoRetorno = estadoRetornoMatch[1].trim();
        console.log('  Estado de retorno extraído:', estadoRetorno);
      }

      if (mensajeRetornoMatch && mensajeRetornoMatch[1]) {
        mensajeRetorno = mensajeRetornoMatch[1].trim();
        console.log('  Mensaje extraído:', mensajeRetorno);
      }

      if (fechaProcesoMatch && fechaProcesoMatch[1]) {
        fechaProceso = fechaProcesoMatch[1].trim();
        console.log('  Fecha de proceso extraída:', fechaProceso);
      }

      if (digestValueMatch && digestValueMatch[1]) {
        digestValueResp = digestValueMatch[1].trim();
        console.log('  DigestValue extraído:', digestValueResp);
      }

      let estadoVisual = 'rechazado';
      let estadoSifen = 'rechazado';

      if (codigoRetorno === '0260') {
        estadoVisual = 'aceptado';
        estadoSifen = 'aceptado';
        console.log('  ✅ Código 0260: Autorización satisfactoria');
      } else if (codigoRetorno === '1005') {
        estadoVisual = 'observado';
        estadoSifen = 'observado';
        console.log('  ⚠️ Código 1005: Transmisión extemporánea');
      } else if (['1000', '1001', '1002', '1003', '1004'].includes(codigoRetorno)) {
        estadoVisual = 'rechazado';
        estadoSifen = 'rechazado';
        console.log('  ❌ Código', codigoRetorno, ': Error de validación - Rechazado');
      } else if (codigoRetorno === '0420') {
        estadoVisual = 'error';
        estadoSifen = 'error';
        console.log('  ❌ Código 0420: CDC inexistente - Factura no encontrada en SET');
      } else if (codigoRetorno === '0421') {
        estadoVisual = 'rechazado';
        estadoSifen = 'rechazado';
        console.log('  ❌ Código 0421: RUC Certificado sin permiso para consultar');
      } else if (codigoRetorno === '0422') {
        estadoVisual = 'aceptado';
        estadoSifen = 'aceptado';
        console.log('  ✅ Código 0422: CDC encontrado - Documento APROBADO');
      }

      console.log('  Estado visual:', estadoVisual, '(desde código:', codigoRetorno + ')');
      console.log('  Estado SIFEN:', estadoSifen);

      const estadoCambio = estadoSifen !== invoiceRecord.estadoSifen;

      if (estadoCambio || !invoiceRecord.respuestaSifen?.codigo) {
        invoiceRecord.estadoSifen = estadoSifen;
        invoiceRecord.estadoVisual = estadoVisual;
        invoiceRecord.codigoRetorno = codigoRetorno;
        invoiceRecord.mensajeRetorno = mensajeRetorno;
        invoiceRecord.fechaProceso = fechaProceso;

        invoiceRecord.respuestaSifen = {
          codigo: codigoRetorno,
          estado: estadoRetorno,
          mensaje: mensajeRetorno,
          fechaProceso: fechaProceso,
          digestValue: digestValueResp
        };

        let tipoOperacion = 'actualizacion_estado';
        let logEstado = 'success';
        let descripcion = `Estado actualizado a ${estadoSifen}`;

        if (estadoVisual === 'rechazado') {
          tipoOperacion = 'error_respuesta_set';
          logEstado = 'error';
          descripcion = `Factura rechazada por SET: ${mensajeRetorno || codigoRetorno}`;

          if (codigoRetorno === '0420') {
            descripcion = `CDC inexistente en SET - La factura no fue encontrada en la base de datos de la SET`;
          }
        } else if (estadoVisual === 'observado') {
          tipoOperacion = 'actualizacion_estado';
          logEstado = 'warning';
          descripcion = `Factura aceptada con observación: ${mensajeRetorno || 'Transmisión extemporánea'}`;
        } else if (estadoVisual === 'aceptado') {
          descripcion = `Factura aceptada por SET: ${mensajeRetorno || 'Autorización satisfactoria'}`;
        }

        const log = new OperationLog({
          invoiceId: id,
          tipoOperacion: tipoOperacion,
          descripcion: descripcion,
          estadoAnterior: invoiceRecord.estadoSifen,
          estadoNuevo: estadoSifen,
          estado: logEstado,
          fecha: new Date(),
          detalle: {
            cdc: invoiceRecord.cdc,
            correlativo: invoiceRecord.correlativo,
            codigoRetorno: codigoRetorno,
            estadoRetorno: estadoRetorno,
            mensajeRetorno: mensajeRetorno,
            estadoVisual: estadoVisual,
            huboCambio: estadoCambio
          }
        });
        await log.save();

        await invoiceRecord.save();

        if (logEstado === 'error') {
          console.log(`❌ Factura rechazada para factura ${id}: ${descripcion}`);
        } else if (logEstado === 'warning') {
          console.log(`⚠️ Factura observada para factura ${id}: ${descripcion}`);
        } else {
          console.log(`✅ Estado actualizado para factura ${id}: ${invoiceRecord.estadoSifen} → ${estadoSifen}`);
        }
      } else {
        console.log(`ℹ️ Estado sin cambios: ${estadoSifen}`);

        const log = new OperationLog({
          invoiceId: id,
          tipoOperacion: 'consulta_estado',
          descripcion: `Consulta de estado realizada - Estado actual: ${estadoSifen}`,
          estado: 'success',
          fecha: new Date(),
          detalle: {
            cdc: invoiceRecord.cdc,
            correlativo: invoiceRecord.correlativo,
            codigoRetorno: codigoRetorno,
            estadoRetorno: estadoRetorno,
            mensajeRetorno: mensajeRetorno,
            estadoVisual: estadoVisual,
            huboCambio: false
          }
        });
        await log.save();
      }

      res.status(200).json({
        success: true,
        message: estadoCambio ? 'Estado actualizado' : 'Estado sin cambios',
        estadoAnterior: invoiceRecord.estadoSifen,
        estadoActual: estadoSifen,
        estadoVisual: estadoVisual,
        proceso: invoiceRecord.proceso,
        estadoCambio: estadoCambio,
        codigoRetorno: codigoRetorno,
        mensajeRetorno: mensajeRetorno,
        respuestaSifen: invoiceRecord.respuestaSifen,
        esEstadoFinal: estadosFinales.includes(estadoSifen),
        consultoSET: true
      });

    } catch (error) {
      console.error('❌ Error consultando a la SET:', error);
      console.error('Stack trace:', error.stack);

      const log = new OperationLog({
        invoiceId: id,
        tipoOperacion: 'error_consulta_estado',
        descripcion: `Error al consultar estado en SET: ${error.message}`,
        estado: 'error',
        fecha: new Date(),
        detalle: {
          error: error.message,
          stack: error.stack
        }
      });
      await log.save();

      if (invoiceRecord.estadoSifen !== 'error') {
        invoiceRecord.estadoSifen = 'error';
        await invoiceRecord.save();
      }

      res.status(500).json({
        success: false,
        error: 'REFRESH_STATUS_CONSULTA_ERROR',
        message: error.message,
        estadoActual: 'error'
      });
    }
  } catch (error) {
    console.error('❌ Error al actualizar estado:', error);
    res.status(500).json({
      success: false,
      error: 'REFRESH_STATUS_ERROR',
      message: error.message
    });
  }
});

// Descargar XML de una factura
router.get('/:id/download-xml', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'FACTURA_NOT_FOUND', message: 'Factura no encontrada' });
    }

    if (!invoice.xmlPath) {
      return res.status(404).json({
        success: false,
        error: 'XML_NOT_AVAILABLE',
        message: 'XML no disponible',
        detalle: 'Esta factura no tiene un archivo XML asociado. Puede que haya sido creada antes de implementar el guardado de XMLs o que el envío a SET haya fallado.'
      });
    }

    const xmlPath = path.join(__dirname, '../de_output', invoice.xmlPath);
    console.log(`📂 Buscando documento XML en: ${xmlPath}`);

    if (!fs.existsSync(xmlPath)) {
      console.error(`❌ Archivo no encontrado: ${xmlPath}`);
      return res.status(404).json({
        success: false,
        error: 'XML_FILE_NOT_FOUND',
        message: 'Archivo XML no encontrado en el servidor',
        ruta: xmlPath,
        correlativo: invoice.correlativo,
        detalle: 'El archivo XML no existe en el servidor. Puede que se haya eliminado manualmente o que haya un error en la ruta.'
      });
    }

    const fileName = `factura_${invoice.correlativo}.xml`;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const fileStream = fs.createReadStream(xmlPath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error en stream:', error);
      res.status(500).json({ success: false, error: 'XML_STREAM_ERROR', message: 'Error al leer el archivo XML' });
    });
  } catch (error) {
    console.error('Error descargando XML:', error);
    res.status(500).json({ success: false, error: 'XML_DOWNLOAD_ERROR', message: 'Error al descargar XML' });
  }
});

// Descargar PDF de una factura (KUDE)
router.get('/:id/download-pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'FACTURA_NOT_FOUND', message: 'Factura no encontrada' });
    }

    if (!invoice.kudePath) {
      return res.status(404).json({
        success: false,
        error: 'PDF_NOT_AVAILABLE',
        message: 'PDF no disponible',
        detalle: 'Esta factura no tiene un archivo PDF KUDE asociado. Puede que el PDF no haya sido generado correctamente.'
      });
    }

    let pdfPath = invoice.kudePath;

    if (!path.isAbsolute(pdfPath)) {
      pdfPath = path.join(__dirname, '../de_output', pdfPath);
    }

    console.log(`📂 Buscando documento PDF en: ${pdfPath}`);

    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ Archivo PDF no encontrado: ${pdfPath}`);
      return res.status(404).json({
        success: false,
        error: 'PDF_FILE_NOT_FOUND',
        message: 'Archivo PDF no encontrado en el servidor',
        ruta: pdfPath,
        correlativo: invoice.correlativo,
        detalle: 'El archivo PDF no existe en el servidor. Puede que se haya eliminado manualmente o que haya un error en la ruta.'
      });
    }

    const fileName = pdfPath.split('/').pop();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error en stream PDF:', error);
      res.status(500).json({ success: false, error: 'PDF_STREAM_ERROR', message: 'Error al leer el archivo PDF' });
    });
  } catch (error) {
    console.error('Error descargando PDF:', error);
    res.status(500).json({ success: false, error: 'PDF_DOWNLOAD_ERROR', message: 'Error al descargar PDF' });
  }
});

// Eliminar una factura específica por ID
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await Invoice.findById(id).populate('grupoLoteId', 'descripcion');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'FACTURA_NOT_FOUND',
        message: 'Factura no encontrada'
      });
    }

    if (invoice.grupoLoteId) {
      return res.status(400).json({
        success: false,
        error: 'FACTURA_BLOQUEADA_POR_LOTE',
        message: `No se puede eliminar: la factura pertenece al lote "${invoice.grupoLoteId.descripcion || invoice.grupoLoteId._id}"`,
        bloqueadoPorLote: true,
        loteId: invoice.grupoLoteId._id
      });
    }

    await Invoice.findByIdAndDelete(id);

    await OperationLog.deleteMany({ invoiceId: id });

    console.log(`🗑️ Factura eliminada: ${id}`);

    res.status(200).json({
      success: true,
      message: 'Factura eliminada exitosamente',
      deletedId: id
    });
  } catch (error) {
    console.error('Error al eliminar factura:', error);
    res.status(500).json({
      success: false,
      error: 'FACTURA_DELETE_ERROR',
      message: error.message
    });
  }
});

module.exports = router;
