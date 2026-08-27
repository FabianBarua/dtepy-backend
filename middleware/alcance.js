/**
 * Alcance multi-empresa: qué empresas puede ver el token autenticado.
 *
 * Las empresas ya estaban scopeadas por dueño (usuarioId), pero facturas,
 * eventos, lotes y estadísticas se consultaban sin filtro: cualquier usuario
 * autenticado veía los datos de las empresas de los demás. Este middleware
 * cierra eso.
 *
 * Reglas:
 *   - Sesión JWT de un admin        → sin restricción (ve todo el sistema).
 *   - Sesión JWT de otro rol        → solo sus propias empresas.
 *   - API Key atada a una empresa   → solo esa empresa.
 *   - API Key sin empresa asociada  → todas las empresas de su dueño.
 *
 * Uso: aplicar `cargarAlcance` después de verificarToken, y en los handlers
 * usar `filtroEmpresa(req)` para listados/agregaciones y
 * `perteneceAlAlcance(req, empresaId)` para documentos puntuales.
 */

const Empresa = require('../models/Empresa');

async function cargarAlcance(req, res, next) {
  try {
    if (req.tipoAutenticacion === 'jwt' && req.usuario.rol === 'admin') {
      req.alcance = { total: true, ids: null };
      return next();
    }

    if (req.apiKey?.empresaId) {
      req.alcance = { total: false, ids: [req.apiKey.empresaId] };
      return next();
    }

    const empresas = await Empresa.find({ usuarioId: req.usuario._id }).select('_id');
    req.alcance = { total: false, ids: empresas.map((e) => e._id) };
    next();
  } catch (error) {
    console.error('Error cargando alcance de empresas:', error);
    res.status(500).json({ success: false, error: 'ALCANCE_ERROR', message: 'Error resolviendo permisos' });
  }
}

/**
 * Filtro de Mongo para listados y agregaciones.
 * @param {object} req
 * @param {string} [campo='empresaId'] nombre del campo en la colección
 * @returns {object} `{}` si el alcance es total, `{ campo: { $in: [...] } }` si no
 */
function filtroEmpresa(req, campo = 'empresaId') {
  if (!req.alcance || req.alcance.total) return {};
  return { [campo]: { $in: req.alcance.ids } };
}

/**
 * ¿Este documento (por su empresaId) está dentro del alcance?
 * Acepta un ObjectId, un string o un documento populado.
 */
function perteneceAlAlcance(req, empresaId) {
  if (!req.alcance || req.alcance.total) return true;
  if (!empresaId) return false; // sin empresa asignada: solo visible para admin
  const idStr = String(empresaId._id ?? empresaId);
  return req.alcance.ids.some((id) => String(id) === idStr);
}

/**
 * Empresa del alcance con certificado activo, para las consultas a SET que
 * no parten de una factura (consulta de RUC, CDC ajeno). Devuelve null si
 * no hay ninguna.
 */
async function empresaParaConsultas(req) {
  const filtro = {
    activo: true,
    'certificado.activo': true,
    ...(req.alcance && !req.alcance.total ? { _id: { $in: req.alcance.ids } } : {})
  };
  return Empresa.findOne(filtro).sort({ updatedAt: -1 });
}

module.exports = { cargarAlcance, filtroEmpresa, perteneceAlAlcance, empresaParaConsultas };
