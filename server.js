/**
 * Servidor para generar facturas electrónicas en XML para Paraguay
 * Con integración de base de datos MongoDB para registro de operaciones
 */

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');

// Configurar Express
const app = express();

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Importar rutas
const statsRoutes = require('./routes/stats');
const invoiceRoutes = require('./routes/invoices');
const authController = require('./controllers/authController');
const apiKeyController = require('./controllers/apiKeyController');
const { verificarToken, verificarAdmin } = require('./middleware/auth');

// Rutas de empresas y facturación
const empresaRoutes = require('./routes/empresas');
const facturarRoutes = require('./routes/facturar');
const eventosRoutes = require('./routes/eventos');
const lotesRoutes = require('./routes/lotes');

// Nuevos routers (refactor de endpoints inline)
const queueRoutes = require('./routes/queue');
const facturaRoutes = require('./routes/factura');
const consultaRoutes = require('./routes/consulta');
const logsRoutes = require('./routes/logs');

// Usar rutas
app.use('/api/stats', statsRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/empresas', empresaRoutes);
app.use('/api/facturar', facturarRoutes);
app.use('/api/eventos', eventosRoutes);
app.use('/api/lotes', lotesRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/factura', facturaRoutes);
app.use('/api/consulta', consultaRoutes);
app.use('/api/logs', logsRoutes);

// Rutas de autenticación (públicas)
app.post('/api/auth/login', authController.login);
// Rutas de autenticación (protegidas)
app.get('/api/auth/perfil', verificarToken, authController.getPerfil);
app.put('/api/auth/perfil', verificarToken, authController.actualizarPerfil);
app.post('/api/auth/cambiar-password', verificarToken, authController.cambiarPassword);
app.post('/api/auth/logout', verificarToken, authController.logout);

// Rutas de API Keys (protegidas, solo admin)
app.post('/api/api-keys', verificarToken, apiKeyController.crearApiKey);
app.get('/api/api-keys', verificarToken, apiKeyController.listarApiKeys);
app.get('/api/api-keys/:id', verificarToken, apiKeyController.obtenerApiKey);
app.put('/api/api-keys/:id/renew', verificarToken, apiKeyController.renovarApiKey);
app.delete('/api/api-keys/:id', verificarToken, apiKeyController.revocarApiKey);


// Conectar a MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/sifen_db', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    process.exit(1);
  }
};

// ========================================
// MIDDLEWARE DE CORS
// ========================================

// Middleware para manejar CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  next();
});

// ========================================
// INICIO DEL SERVIDOR
// ========================================

// Iniciar el servidor
const PORT = process.env.PORT || 8081;

const iniciarServidor = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor de facturación electrónica iniciado en http://localhost:${PORT}`);
    console.log(`📋 Endpoints disponibles:`);
    console.log(`   POST /api/facturar/crear - Genera factura electrónica (con cola asíncrona)`);
    console.log(`   GET  /api/stats - Estadísticas del sistema`);
    console.log(`   GET  /api/invoices - Lista de facturas`);
    console.log(`   GET  /api/invoices/:id - Detalle de factura`);
    console.log(`   GET  /api/invoices/cdc/:cdc - Consulta por CDC`);
    console.log(`   GET  /api/invoices/estado/:cdc - Estado SET por CDC`);
    console.log(`   POST /api/invoices/:id/refresh-status - Refrescar estado desde SET`);
    console.log(`   GET  /api/factura/estado/:id - Estado de factura (cola)`);
    console.log(`   GET  /api/queue/stats - Estadísticas de la cola`);
    console.log(`   GET  /api/logs - Logs de operaciones`);
    console.log(`   GET  /api/consulta/ruc/:ruc - Consulta RUC en SET`);
  });
};

// Si este archivo es ejecutado directamente, iniciar el servidor
if (require.main === module) {
  iniciarServidor();
}

module.exports = app;
