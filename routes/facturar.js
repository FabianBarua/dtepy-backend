const express = require('express');
const router = express.Router();
const { verificarToken, verificarPermiso } = require('../middleware/auth');
const { cargarAlcance } = require('../middleware/alcance');
const facturaController = require('../controllers/facturaController');

router.use(verificarToken, cargarAlcance);

router.post('/crear', verificarPermiso('facturas:crear'), facturaController.crear);

router.get('/empresa/:ruc', verificarPermiso('facturas:leer'), facturaController.obtenerEmpresa);

module.exports = router;
