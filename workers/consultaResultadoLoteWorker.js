require('dotenv').config();
const mongoose = require('mongoose');
const envioLoteService = require('../services/envioLoteService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sifen_db';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ [LOTE-WORKER] MongoDB conectado'))
.catch(err => console.error('❌ [LOTE-WORKER] Error conectando a MongoDB:', err.message));

const INTERVALO_MS = 30000;

async function consultarLotesPendientes() {
  try {
    const resultados = await envioLoteService.consultarPendientes();
    if (resultados.length > 0) {
      for (const res of resultados) {
        if (res.completado) {
          console.log(`✅ [LOTE-WORKER] Lote ${res.loteId} completado`);
        } else if (res.error) {
          console.warn(`⚠️ [LOTE-WORKER] Error lote ${res.loteId}: ${res.error}`);
        }
      }
    }
  } catch (err) {
    console.error('❌ [LOTE-WORKER] Error consultando lotes:', err.message);
  }
}

setInterval(consultarLotesPendientes, INTERVALO_MS);

console.log(`👷 [LOTE-WORKER] Iniciado - consultando cada ${INTERVALO_MS / 1000}s`);
console.log(`📍 MongoDB: ${MONGODB_URI}`);

process.on('SIGINT', async () => {
  console.log('\n🛑 [LOTE-WORKER] Cerrando...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 [LOTE-WORKER] SIGTERM recibido...');
  await mongoose.connection.close();
  process.exit(0);
});
