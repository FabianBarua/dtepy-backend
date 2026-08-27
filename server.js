/**
 * Servidor para generar facturas electrónicas en XML para Paraguay
 * Con integración de base de datos MongoDB para registro de operaciones
 */

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Configurar Express
const app = express();

// ========================================
// CORS
// ========================================
// Va ANTES de las rutas: si se registra después, Express ya respondió y las
// cabeceras nunca se envían (por eso el frontend solo funcionaba con proxy).
//
// CORS_ORIGINS: lista separada por comas con los orígenes del frontend.
// Ej: CORS_ORIGINS=https://app.midominio.com,http://localhost:3000
// Con '*' (por defecto) se acepta cualquier origen.
const origenesPermitidos = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((origen) => origen.trim())
  .filter(Boolean);

app.use(cors({
  origin: origenesPermitidos.includes('*') ? '*' : origenesPermitidos,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition']
}));

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


// ========================================
// DOCUMENTACION DE LA API (publica, sin auth)
// ========================================
// Swagger UI interactivo en /api/docs y el JSON crudo en /api/openapi.json
// (util para generar clientes o importarlo en Postman/Insomnia).
const swaggerUi = require('swagger-ui-express');
const openapi = require('./docs/openapi');

app.get('/api/openapi.json', (req, res) => res.json(openapi));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
  customSiteTitle: 'DTE-PY API',
  swaggerOptions: {
    persistAuthorization: true,  // el token sobrevive al refresco de la pagina
    docExpansion: 'none',
    tagsSorter: 'alpha'
  }
}));

// ========================================
// HEALTH CHECK (publico, sin auth)
// ========================================
// Lo usa el frontend para validar la URL del backend antes de iniciar sesion.
app.get('/api/health', (req, res) => {
  const estadosMongo = ['desconectado', 'conectado', 'conectando', 'desconectando'];
  res.json({
    ok: true,
    servicio: 'dtepy-backend',
    version: require('./package.json').version,
    mongo: estadosMongo[mongoose.connection.readyState] || 'desconocido',
    fecha: new Date().toISOString()
  });
});

// Conectar a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sifen_db';

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
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
// INICIO DEL SERVIDOR
// ========================================

// Iniciar el servidor
const PORT = process.env.PORT || 8081;

const iniciarServidor = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor de facturación electrónica iniciado en http://localhost:${PORT}`);
    console.log(`   CORS permitido para: ${origenesPermitidos.join(', ')}`);
    console.log(`📋 Endpoints disponibles:`);
    console.log(`   GET  /api/health - Estado del servicio (público)`);
    console.log(`   GET  /api/docs - Documentación interactiva de la API`);
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
