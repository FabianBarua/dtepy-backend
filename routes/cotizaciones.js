/**
 * Cotizaciones de moneda extranjera (guaraníes por unidad).
 *
 * La cotización la DECLARA el usuario: desde la UI (sesión JWT) o vía API
 * (API Key con permiso 'cotizaciones:editar' — pensado para un actualizador
 * automático externo). Cada declaración queda en el historial con quién y
 * cuándo. La vigente es la última declarada por empresa+moneda.
 */

const express = require('express');
const router = express.Router();
const { verificarToken, verificarPermiso } = require('../middleware/auth');
const { cargarAlcance, filtroEmpresa, perteneceAlAlcance } = require('../middleware/alcance');
const cotizacionService = require('../services/cotizacionService');
const Empresa = require('../models/Empresa');

router.use(verificarToken, cargarAlcance);

/**
 * Resuelve sobre qué empresa opera el pedido:
 * body/query explícito (validado contra el alcance) o, si el alcance tiene
 * una sola empresa, esa.
 */
async function resolverEmpresa(req, valorExplicito) {
  if (valorExplicito) {
    const texto = String(valorExplicito).trim();
    const empresa = /^[0-9a-fA-F]{24}$/.test(texto)
      ? await Empresa.findById(texto)
      : await Empresa.findOne({ ruc: texto });
    if (!empresa || !perteneceAlAlcance(req, empresa._id)) {
      const error = new Error('La empresa indicada no existe o no corresponde a este usuario o API Key');
      error.statusCode = 404;
      error.errorCode = 'EMPRESA_FUERA_DE_ALCANCE';
      throw error;
    }
    return empresa;
  }

  if (req.alcance?.ids?.length === 1) {
    return Empresa.findById(req.alcance.ids[0]);
  }

  const error = new Error('Indicá la empresa: empresaId o ruc');
  error.statusCode = 400;
  error.errorCode = 'EMPRESA_REQUERIDA';
  throw error;
}

/**
 * @route GET /api/cotizaciones
 * @desc  Cotizaciones vigentes (última declarada por empresa y moneda)
 */
router.get('/', verificarPermiso('facturas:leer'), async (req, res) => {
  try {
    const ids = req.alcance.total ? null : req.alcance.ids;
    const lista = await cotizacionService.vigentes(ids);
    res.json({ success: true, data: lista, monedasSoportadas: cotizacionService.monedasValidas() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Error al listar cotizaciones' });
  }
});

/**
 * @route GET /api/cotizaciones/historial
 * @desc  Historial de declaraciones (?moneda=USD&limit=50)
 */
router.get('/historial', verificarPermiso('facturas:leer'), async (req, res) => {
  try {
    const filtro = filtroEmpresa(req);
    const lista = await cotizacionService.historial({
      empresaIds: filtro.empresaId ? filtro.empresaId.$in : null,
      moneda: req.query.moneda,
      limite: req.query.limit
    });
    res.json({ success: true, data: lista });
  } catch (error) {
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Error al listar historial' });
  }
});

/**
 * @route POST /api/cotizaciones
 * @desc  Declarar una cotización { moneda, valor, empresaId? | ruc? }
 *        JWT: cualquier usuario sobre sus empresas.
 *        API Key: requiere permiso 'cotizaciones:editar'.
 */
router.post('/', verificarPermiso('cotizaciones:editar'), async (req, res) => {
  try {
    const { moneda, valor } = req.body || {};
    const empresa = await resolverEmpresa(req, req.body?.empresaId || req.body?.ruc);

    const declaradaPor = req.tipoAutenticacion === 'jwt'
      ? {
          tipo: 'usuario',
          nombre: [req.usuario?.nombre, req.usuario?.apellido].filter(Boolean).join(' '),
          email: req.usuario?.email || ''
        }
      : { tipo: 'api_key', nombre: req.apiKey?.nombre || 'API Key', email: '' };

    const cotizacion = await cotizacionService.declarar({
      empresaId: empresa._id,
      moneda,
      valor,
      declaradaPor
    });

    res.status(201).json({
      success: true,
      message: `Cotización ${cotizacion.moneda} declarada: ${cotizacion.valor} Gs`,
      data: {
        cotizacionId: cotizacion._id,
        empresaId: empresa._id,
        ruc: empresa.ruc,
        moneda: cotizacion.moneda,
        valor: cotizacion.valor,
        declaradaPor: cotizacion.declaradaPor,
        declaradaEn: cotizacion.createdAt
      }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: error.errorCode || 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

module.exports = router;
