const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { verificarToken, verificarPermiso } = require('../middleware/auth');
const { cargarAlcance, empresaParaConsultas } = require('../middleware/alcance');
const { resolverCertificadoEmpresa } = require('../services/certificadoService');

router.use(verificarToken, verificarPermiso('facturas:leer'), cargarAlcance);

router.get('/ruc/:ruc', async (req, res) => {
  try {
    const ruc = req.params.ruc;

    if (!ruc) {
      res.status(400).json({ success: false, error: 'RUC_REQUIRED', message: 'RUC requerido' });
      return;
    }

    // La consulta a SET va firmada: se usa el certificado de una empresa
    // del alcance (antes apuntaba a un path hardcodeado inexistente).
    const empresa = await empresaParaConsultas(req);
    if (!empresa) {
      return res.status(400).json({
        success: false,
        error: 'CERTIFICADO_NO_DISPONIBLE',
        message: 'Para consultar a SIFEN se necesita una empresa con certificado digital activo'
      });
    }

    try {
      const setApi = require('../services/setapi-wrapper');
      const idConsulta = crypto.randomBytes(16).toString('hex');
      const ambiente = empresa.configuracionSifen?.modo || 'test';
      const cert = resolverCertificadoEmpresa(empresa);

      const respuesta = await setApi.consultaRUC(idConsulta, ruc, ambiente, cert.ruta, cert.contrasena);

      res.status(200).json({
        success: true,
        data: { ruc, encontrado: true, respuesta }
      });
    } catch (error) {
      // Un fallo acá puede ser "el RUC no existe" o un problema real
      // (certificado, red, SET caído). Antes todo devolvía 404 y los
      // errores de infraestructura quedaban enmascarados.
      console.error('Error consultando RUC en SET:', error.message);
      res.status(502).json({
        success: false,
        error: 'CONSULTA_SET_ERROR',
        message: `No se pudo consultar el RUC en SET: ${error.message}`,
        data: { ruc, encontrado: false }
      });
    }
  } catch (error) {
    console.error('Error al consultar RUC:', error);
    res.status(500).json({ success: false, error: 'CONSULTA_ERROR', message: 'Error al consultar RUC' });
  }
});

module.exports = router;
