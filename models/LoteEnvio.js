const mongoose = require('mongoose');

const loteEnvioSchema = new mongoose.Schema({
  empresaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Empresa',
    required: true,
    index: true
  },
  tipoDocumento: {
    type: Number,
    required: true
  },
  descripcion: {
    type: String,
    default: 'Lote de envío'
  },
  ambiente: {
    type: String,
    enum: ['test', 'produccion'],
    required: true
  },
  estado: {
    type: String,
    enum: ['en_espera', 'enviado', 'procesando', 'completado', 'error'],
    default: 'en_espera'
  },
  facturas: [{
    facturaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice'
    },
    cdc: String,
    estadoIndividual: {
      type: String,
      enum: ['pendiente', 'aceptado', 'rechazado', 'observado', 'error'],
      default: 'pendiente'
    }
  }],
  count: {
    type: Number,
    default: 0
  },
  dProtConsLote: String,
  respuestaSifen: Object
}, {
  timestamps: true
});

loteEnvioSchema.index({ empresaId: 1, tipoDocumento: 1, ambiente: 1, estado: 1 });

module.exports = mongoose.model('LoteEnvio', loteEnvioSchema);
