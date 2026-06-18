const { crearFactura } = require('../services/facturaService');
const { buscarEmpresaPorRUC } = require('../services/empresaService');

exports.crear = async (req, res) => {
  try {
    const resultado = await crearFactura(req.body);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const facturaId = resultado.facturaId;

    const data = {
      facturaId,
      correlativo: resultado.correlativo,
      estado: resultado.estado,
      proceso: resultado.proceso,
      cdc: resultado.cdc || null,
      xmlLink: `${baseUrl}/api/invoices/${facturaId}/download-xml`,
      kudeLink: `${baseUrl}/api/invoices/${facturaId}/download-pdf`,
      urls: {
        estado: `/api/factura/estado/${facturaId}`,
        consulta: `/api/invoices/${facturaId}`
      }
    };

    if (resultado.tipo === 'pdf_regeneracion') {
      data.kudeJobId = resultado.kudeJobId;
      return res.status(202).json({
        success: true,
        message: 'PDF encolado para regeneración (factura ya aprobada por SET)',
        data
      });
    }

    if (resultado.tipo === 'reintento') {
      data.jobId = resultado.jobId;
      data.reintentando = true;
      data.intentoAnterior = resultado.intentoAnterior;
      return res.status(202).json({
        success: true,
        message: 'Factura encolada para procesamiento asíncrono (reintentando proceso fallido)',
        data
      });
    }

    data.jobId = resultado.jobId;
    res.status(202).json({
      success: true,
      message: 'Factura encolada para procesamiento asíncrono',
      data
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const errorCode = error.errorCode || 'INTERNAL_ERROR';
    const response = { success: false, error: errorCode, message: error.message };
    if (error.detalles) response.detalles = error.detalles;
    res.status(statusCode).json(response);
  }
};

exports.obtenerEmpresa = async (req, res) => {
  try {
    const ruc = req.params.ruc?.trim();
    if (!ruc) {
      return res.status(400).json({ success: false, error: 'RUC_REQUIRED', message: 'RUC requerido' });
    }

    const empresa = await buscarEmpresaPorRUC(ruc);
    if (!empresa) {
      return res.status(404).json({ success: false, error: 'EMPRESA_NOT_FOUND', message: `No se encontró una empresa con RUC ${ruc}` });
    }

    res.json({
      success: true,
      data: {
        ruc: empresa.ruc,
        nombreFantasia: empresa.nombreFantasia,
        razonSocial: empresa.razonSocial,
        tieneCertificadoValido: empresa.tieneCertificadoValido(),
        activo: empresa.activo
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Error al obtener empresa' });
  }
};
