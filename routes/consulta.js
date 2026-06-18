const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const { verificarToken } = require('../middleware/auth');

router.use(verificarToken);

router.get('/ruc/:ruc', async (req, res) => {
  try {
    const ruc = req.params.ruc;

    if (!ruc) {
      res.status(400).json({ success: false, error: 'RUC_REQUIRED', message: 'RUC requerido' });
      return;
    }

    try {
      const setApi = require('../services/setapi-wrapper');
      const idConsulta = crypto.randomBytes(16).toString('hex');
      const ambiente = "test";
      const certificateP12Path = path.join(__dirname, '..', 'certificados', 'p12', 'certificado.p12');
      const certificatePassword = '123456';

      const respuesta = await setApi.consultaRuc(idConsulta, ruc, ambiente, certificateP12Path, certificatePassword);

      res.status(200).json({
        success: true,
        data: { ruc, encontrado: true, respuesta }
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: 'RUC_NOT_FOUND',
        message: 'RUC no encontrado o error en consulta',
        data: { ruc, encontrado: false }
      });
    }
  } catch (error) {
    console.error('Error al consultar RUC:', error);
    res.status(500).json({ success: false, error: 'CONSULTA_ERROR', message: 'Error al consultar RUC' });
  }
});

module.exports = router;
