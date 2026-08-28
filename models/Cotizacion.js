const mongoose = require('mongoose');

/**
 * Cotización de moneda extranjera declarada por el usuario.
 *
 * Cada declaración crea un documento nuevo (historial completo, con quién y
 * cuándo — respaldo contable). La cotización "vigente" de una moneda es la
 * última declarada para esa empresa. El valor es en guaraníes por unidad de
 * la moneda (ej.: USD 7300 = 7.300 Gs por dólar).
 */
const cotizacionSchema = new mongoose.Schema({
  empresaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Empresa',
    required: true,
    index: true
  },
  moneda: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3
  },
  valor: {
    type: Number,
    required: true,
    min: [0.000001, 'La cotización debe ser mayor a 0']
  },
  // Quién la declaró (sesión de usuario o API Key)
  declaradaPor: {
    tipo: { type: String, enum: ['usuario', 'api_key'], required: true },
    nombre: { type: String, default: '' },
    email: { type: String, default: '' }
  }
}, {
  timestamps: true
});

// La vigente se busca por empresa+moneda ordenando por fecha de creación
cotizacionSchema.index({ empresaId: 1, moneda: 1, createdAt: -1 });

module.exports = mongoose.model('Cotizacion', cotizacionSchema);
