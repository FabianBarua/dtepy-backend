const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth');
const facturaController = require('../controllers/facturaController');

router.use(verificarToken);

router.post('/crear', facturaController.crear);

router.get('/empresa/:ruc', facturaController.obtenerEmpresa);

module.exports = router;
