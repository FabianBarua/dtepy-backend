const express = require('express');
const router = express.Router();
const LoteEnvio = require('../models/LoteEnvio');
const Invoice = require('../models/Invoice');
const envioLoteService = require('../services/envioLoteService');
const { verificarToken } = require('../middleware/auth');

router.use(verificarToken);

router.get('/list', async (req, res) => {
  try {
    const { estado, empresaId, tipoDocumento, page = 1, limit = 20 } = req.query;
    const filtro = {};
    if (estado) filtro.estado = estado;
    if (empresaId) filtro.empresaId = empresaId;
    if (tipoDocumento) filtro.tipoDocumento = parseInt(tipoDocumento);

    const options = {
      sort: { createdAt: -1 },
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };

    const lotes = await LoteEnvio.find(filtro, null, options)
      .populate('empresaId', 'ruc nombreFantasia razonSocial')
      .populate('facturas.facturaId', 'correlativo cdc estadoSifen');
    const total = await LoteEnvio.countDocuments(filtro);

    res.json({
      success: true,
      data: lotes,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Error listando lotes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const lote = await LoteEnvio.findById(req.params.id)
      .populate('empresaId', 'ruc nombreFantasia razonSocial')
      .populate('facturas.facturaId', 'correlativo cdc estadoSifen xmlPath');

    if (!lote) {
      return res.status(404).json({ success: false, error: 'Lote no encontrado' });
    }

    res.json({ success: true, data: lote });
  } catch (error) {
    console.error('Error obteniendo lote:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/enviar/:id', async (req, res) => {
  try {
    const lote = await envioLoteService.enviarLote(req.params.id);
    res.json({ success: true, data: lote, message: 'Lote enviado a SIFEN' });
  } catch (error) {
    console.error('Error enviando lote:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/enviar-pendientes', async (req, res) => {
  try {
    const resultados = await envioLoteService.enviarPendientes();
    res.json({ success: true, data: resultados });
  } catch (error) {
    console.error('Error enviando pendientes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/consultar/:id', async (req, res) => {
  try {
    const resultado = await envioLoteService.consultarResultadoLote(req.params.id);
    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('Error consultando lote:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const lote = await LoteEnvio.findById(id);
    if (!lote) {
      return res.status(404).json({ success: false, error: 'Lote no encontrado' });
    }

    if (!['en_espera', 'error'].includes(lote.estado)) {
      return res.status(400).json({
        success: false,
        error: 'Solo se pueden eliminar lotes en estado "en_espera" o "error"'
      });
    }

    // Desvincular facturas del lote
    const facturaIds = lote.facturas.map(f => f.facturaId).filter(Boolean);
    if (facturaIds.length > 0) {
      await Invoice.updateMany(
        { _id: { $in: facturaIds } },
        { $unset: { grupoLoteId: '' } }
      );
    }

    await LoteEnvio.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Lote eliminado correctamente',
      facturasDesvinculadas: facturaIds.length
    });
  } catch (error) {
    console.error('Error eliminando lote:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
