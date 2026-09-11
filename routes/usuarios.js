/**
 * Administración de usuarios del panel.
 *
 * Solo una sesión de usuario ADMIN puede listar, crear o modificar cuentas;
 * una API Key nunca alcanza (una key filtrada no debe poder crear accesos).
 * Los usuarios no se borran: se desactivan, para conservar la autoría de
 * lo que hicieron (eventos, cotizaciones declaradas, etc.).
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verificarToken, requerirSesionAdmin } = require('../middleware/auth');

router.use(verificarToken, requerirSesionAdmin);

const ROLES = ['admin', 'usuario', 'contador'];

function publico(u) {
  return {
    _id: u._id,
    username: u.username,
    email: u.email,
    nombre: u.nombre,
    apellido: u.apellido,
    rol: u.rol,
    activo: u.activo,
    ultimoAcceso: u.ultimoAcceso,
    fechaCreacion: u.fechaCreacion || u.createdAt
  };
}

router.get('/', async (req, res) => {
  try {
    const usuarios = await User.find({}).sort({ createdAt: 1 });
    res.json({ success: true, data: usuarios.map(publico), total: usuarios.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'USUARIOS_LIST_ERROR', message: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, email, password, nombre, apellido, rol } = req.body || {};
    if (!username || !email || !password || !nombre || !apellido) {
      return res.status(400).json({ success: false, error: 'CAMPOS_REQUERIDOS', message: 'Usuario, email, contraseña, nombre y apellido son obligatorios' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'PASSWORD_CORTA', message: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (rol && !ROLES.includes(rol)) {
      return res.status(400).json({ success: false, error: 'ROL_INVALIDO', message: `Rol inválido. Válidos: ${ROLES.join(', ')}` });
    }
    const existente = await User.findOne({ $or: [{ email: String(email).toLowerCase() }, { username }] });
    if (existente) {
      return res.status(409).json({ success: false, error: 'USUARIO_EXISTENTE', message: 'Ya existe un usuario con ese email o nombre de usuario' });
    }
    const usuario = new User({ username, email, password, nombre, apellido, rol: rol || 'usuario' });
    await usuario.save();
    res.status(201).json({ success: true, message: 'Usuario creado', data: publico(usuario) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'USUARIO_CREAR_ERROR', message: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const usuario = await User.findById(req.params.id);
    if (!usuario) return res.status(404).json({ success: false, error: 'USUARIO_NOT_FOUND', message: 'Usuario no encontrado' });

    const { nombre, apellido, email, rol, activo } = req.body || {};
    const esUnoMismo = String(usuario._id) === String(req.usuario._id);

    if (rol !== undefined) {
      if (!ROLES.includes(rol)) {
        return res.status(400).json({ success: false, error: 'ROL_INVALIDO', message: `Rol inválido. Válidos: ${ROLES.join(', ')}` });
      }
      if (esUnoMismo && rol !== 'admin') {
        return res.status(400).json({ success: false, error: 'AUTO_DEGRADACION', message: 'No podés quitarte el rol de administrador a vos mismo' });
      }
      usuario.rol = rol;
    }
    if (activo !== undefined) {
      if (esUnoMismo && activo === false) {
        return res.status(400).json({ success: false, error: 'AUTO_DESACTIVACION', message: 'No podés desactivar tu propia cuenta' });
      }
      usuario.activo = Boolean(activo);
    }
    if (nombre !== undefined) usuario.nombre = nombre;
    if (apellido !== undefined) usuario.apellido = apellido;
    if (email !== undefined && email !== usuario.email) {
      const otro = await User.findOne({ email: String(email).toLowerCase(), _id: { $ne: usuario._id } });
      if (otro) return res.status(409).json({ success: false, error: 'EMAIL_EN_USO', message: 'Ese email ya lo usa otro usuario' });
      usuario.email = email;
    }

    await usuario.save();
    res.json({ success: true, message: 'Usuario actualizado', data: publico(usuario) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'USUARIO_ACTUALIZAR_ERROR', message: error.message });
  }
});

router.post('/:id/password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'PASSWORD_CORTA', message: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const usuario = await User.findById(req.params.id);
    if (!usuario) return res.status(404).json({ success: false, error: 'USUARIO_NOT_FOUND', message: 'Usuario no encontrado' });
    usuario.password = password; // el pre-save la hashea
    await usuario.save();
    res.json({ success: true, message: `Contraseña de ${usuario.username} restablecida` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'USUARIO_PASSWORD_ERROR', message: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (String(req.params.id) === String(req.usuario._id)) {
      return res.status(400).json({ success: false, error: 'AUTO_DESACTIVACION', message: 'No podés desactivar tu propia cuenta' });
    }
    const usuario = await User.findById(req.params.id);
    if (!usuario) return res.status(404).json({ success: false, error: 'USUARIO_NOT_FOUND', message: 'Usuario no encontrado' });
    usuario.activo = false;
    await usuario.save();
    res.json({ success: true, message: `Usuario ${usuario.username} desactivado`, data: publico(usuario) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'USUARIO_DESACTIVAR_ERROR', message: error.message });
  }
});

module.exports = router;
