const Empresa = require('../models/Empresa');

async function buscarEmpresaPorRUC(ruc) {
  if (!ruc) return null;

  let empresa = await Empresa.findOne({ ruc });

  if (!empresa && ruc.includes('-')) {
    const rucSinGuiones = ruc.replace(/[^0-9]/g, '');
    empresa = await Empresa.findOne({ ruc: rucSinGuiones });
  }

  if (!empresa && !ruc.includes('-')) {
    const rucSinGuiones = ruc.replace(/[^0-9]/g, '');
    if (rucSinGuiones.length >= 7 && rucSinGuiones.length <= 9) {
      const parteNumerica = rucSinGuiones.slice(0, -1);
      const dv = rucSinGuiones.slice(-1);
      empresa = await Empresa.findOne({ ruc: `${parteNumerica}-${dv}` });
    }
  }

  return empresa;
}

function validarEmpresaActiva(empresa) {
  if (!empresa) {
    throw Object.assign(new Error('No se encontró una empresa con el RUC proporcionado'), {
      statusCode: 404, errorCode: 'EMPRESA_NOT_FOUND'
    });
  }
  if (!empresa.activo) {
    throw Object.assign(new Error(`La empresa "${empresa.nombreFantasia}" está inactiva`), {
      statusCode: 400, errorCode: 'EMPRESA_INACTIVE'
    });
  }
}

function validarCertificadoValido(empresa) {
  if (!empresa.tieneCertificadoValido()) {
    throw Object.assign(new Error('La empresa no tiene un certificado digital válido cargado'), {
      statusCode: 400, errorCode: 'CERTIFICADO_INVALID'
    });
  }
}

module.exports = { buscarEmpresaPorRUC, validarEmpresaActiva, validarCertificadoValido };
