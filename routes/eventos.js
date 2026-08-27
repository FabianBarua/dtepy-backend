/**
 * Rutas para Gestión de Eventos SIFEN
 * 
 * Manual Técnico v150 - Sección 11: Gestión de Eventos
 * 
 * Tipos de eventos:
 * - Emisor: Cancelación, Devolución/Ajuste
 * - Receptor: Conformidad, Disconformidad, Desconocimiento, Notificación
 */

const express = require('express');
const router = express.Router();
const Evento = require('../models/Evento');
const Invoice = require('../models/Invoice');
const eventoService = require('../services/eventoService');
const { verificarToken, verificarPermiso } = require('../middleware/auth');
const { cargarAlcance, filtroEmpresa, perteneceAlAlcance } = require('../middleware/alcance');
const { evaluarPlazoCancelacion } = require('../utils/plazosSifen');

// Todas las rutas requieren autenticación y, para API Keys, permiso de lectura
router.use(verificarToken, verificarPermiso('facturas:leer'), cargarAlcance);

/**
 * @route   POST /api/eventos/enviar
 * @desc    Enviar evento a la SET
 * @access  Privada
 * 
 * Body:
 * {
 *   "invoiceId": "67f8a9b2c3d4e5f6a7b8c9d0",
 *   "tipoEvento": "cancelacion" | "disconformidad" | "conformidad" | "desconocimiento" | "notificacion_recepcion",
 *   "descripcion": "Motivo del evento",
 *   "usuario": {
 *     "documentoNumero": "1234567",
 *     "nombre": "Juan Pérez"
 *   }
 * }
 */
router.post('/enviar', verificarPermiso('facturas:crear'), async (req, res) => {
  try {
    const { invoiceId, tipoEvento, descripcion, usuario } = req.body;

    // Validaciones
    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        error: 'EVENTO_INVOICE_ID_REQUIRED',
        message: 'ID de factura requerido'
      });
    }

    if (!tipoEvento) {
      return res.status(400).json({
        success: false,
        error: 'EVENTO_TIPO_REQUIRED',
        message: 'Tipo de evento requerido'
      });
    }

    if (!descripcion) {
      return res.status(400).json({
        success: false,
        error: 'EVENTO_DESCRIPCION_REQUIRED',
        message: 'Descripción del evento requerida'
      });
    }

    // Validar tipo de evento
    const tiposValidos = [
      'cancelacion',
      'devolucion_ajuste',
      'conformidad',
      'disconformidad',
      'desconocimiento',
      'notificacion_recepcion'
    ];

    if (!tiposValidos.includes(tipoEvento)) {
      return res.status(400).json({
        success: false,
        error: 'EVENTO_TIPO_INVALIDO',
        message: 'Tipo de evento no válido',
        tiposValidos
      });
    }

    // Verificar que la factura existe
    const invoice = await Invoice.findById(invoiceId);

    if (!invoice || !perteneceAlAlcance(req, invoice.empresaId)) {
      return res.status(404).json({
        success: false,
        error: 'EVENTO_FACTURA_NOT_FOUND',
        message: 'Factura no encontrada'
      });
    }

    // Validaciones específicas por tipo de evento
    if (tipoEvento === 'cancelacion') {
      // Solo el emisor, sobre un DTE aprobado, y dentro del plazo del
      // Manual Técnico v150: 48h para facturas, 168h para el resto.
      if (invoice.estadoSifen !== 'aceptado') {
        return res.status(400).json({
          success: false,
          error: 'EVENTO_CANCELACION_INVALIDA',
          message: 'Solo se puede cancelar facturas aprobadas por SET'
        });
      }

      const plazo = evaluarPlazoCancelacion(
        invoice.fechaProceso || invoice.updatedAt,
        invoice.de
      );

      if (!plazo.dentro) {
        return res.status(400).json({
          success: false,
          error: 'EVENTO_CANCELACION_FUERA_DE_PLAZO',
          message: `El plazo de cancelación es de ${plazo.horasLimite} horas desde la aprobación ` +
            `(pasaron ${Math.floor(plazo.horasTranscurridas)}). ` +
            `Para anular esta factura corresponde emitir una Nota de Crédito.`,
          horasLimite: plazo.horasLimite,
          horasTranscurridas: Math.floor(plazo.horasTranscurridas)
        });
      }
    }

    // Enviar evento
    const resultado = await eventoService.enviarEvento({
      invoiceId,
      tipoEvento,
      descripcion,
      usuario: usuario || {
        documentoNumero: req.user?.documento || '0',
        nombre: req.user?.nombre || 'Sistema'
      }
    });

    res.status(200).json({
      success: true,
      message: 'Evento enviado a SET correctamente',
      data: resultado
    });

  } catch (error) {
    console.error('❌ Error enviando evento:', error);
    
    res.status(500).json({
      success: false,
      error: 'EVENTO_ENVIO_ERROR',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/eventos/factura/:invoiceId
 * @desc    Obtener eventos de una factura
 * @access  Privada
 */
router.get('/factura/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await Invoice.findById(invoiceId).select('empresaId');
    if (!invoice || !perteneceAlAlcance(req, invoice.empresaId)) {
      return res.status(404).json({ success: false, error: 'EVENTO_FACTURA_NOT_FOUND', message: 'Factura no encontrada' });
    }

    const eventos = await eventoService.obtenerEventos(invoiceId);

    res.status(200).json({
      success: true,
      total: eventos.length,
      eventos
    });

  } catch (error) {
    console.error('❌ Error obteniendo eventos:', error);
    
    res.status(500).json({
      success: false,
      error: 'EVENTOS_OBTENER_ERROR',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/eventos/cdc/:cdc
 * @desc    Obtener eventos por CDC
 * @access  Privada
 */
router.get('/cdc/:cdc', async (req, res) => {
  try {
    const { cdc } = req.params;

    const todos = await eventoService.obtenerEventosPorCDC(cdc);
    const eventos = todos.filter((e) => perteneceAlAlcance(req, e.empresaId));

    res.status(200).json({
      success: true,
      total: eventos.length,
      eventos
    });

  } catch (error) {
    console.error('❌ Error obteniendo eventos:', error);
    
    res.status(500).json({
      success: false,
      error: 'EVENTOS_OBTENER_ERROR',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/eventos/:id
 * @desc    Obtener detalle de un evento
 * @access  Privada
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await Evento.findById(id)
      .populate('invoiceId', 'correlativo cdc estadoSifen')
      .populate('empresaId', 'ruc nombreFantasia');

    if (!evento || !perteneceAlAlcance(req, evento.empresaId)) {
      return res.status(404).json({
        success: false,
        error: 'EVENTO_NOT_FOUND',
        message: 'Evento no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      evento
    });

  } catch (error) {
    console.error('❌ Error obteniendo evento:', error);
    
    res.status(500).json({
      success: false,
      error: 'EVENTO_OBTENER_ERROR',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/eventos
 * @desc    Listar eventos (con filtros)
 * @access  Privada
 */
router.get('/', async (req, res) => {
  try {
    const { tipoEvento, estadoEvento, cdc, page = 1, limit = 10 } = req.query;

    const filtro = { ...filtroEmpresa(req) };
    if (tipoEvento) filtro.tipoEvento = tipoEvento;
    if (estadoEvento) filtro.estadoEvento = estadoEvento;
    if (cdc) filtro.cdc = cdc;

    const eventos = await Evento.find(filtro)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) * 1)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('invoiceId', 'correlativo cdc')
      .populate('empresaId', 'ruc nombreFantasia');

    const total = await Evento.countDocuments(filtro);

    res.status(200).json({
      success: true,
      eventos,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('❌ Error listando eventos:', error);
    
    res.status(500).json({
      success: false,
      error: 'EVENTOS_LISTAR_ERROR',
      message: error.message
    });
  }
});

module.exports = router;
