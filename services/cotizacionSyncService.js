/**
 * Sincronización automática de cotizaciones desde un proveedor del catálogo.
 *
 * Cómo funciona en Paraguay: la SET/DNIT publica la cotización del día D
 * durante la tarde del propio día D, y ESA es la que rige para facturar el
 * día D+1. O sea: al arrancar el día, la cotización a usar es la publicada
 * ayer, y normalmente ya está disponible desde la tarde anterior.
 *
 * De ahí la estrategia: apenas cambia el día (hora de Asunción) la empresa
 * queda "sin la cotización de ayer" y el worker la busca; si la fuente todavía
 * no la publicó, reintenta. No hay cron a las 00:00 — el estado se deriva de
 * los datos, así que un reinicio, un corte de red o un despliegue en el medio
 * no saltean la actualización: al volver, sigue faltando y se reintenta.
 *
 * Sábados, domingos y feriados la fuente no publica: sigue vigente la última
 * cotización, que es exactamente lo que corresponde.
 */

const Cotizacion = require('../models/Cotizacion');
const Empresa = require('../models/Empresa');
const proveedores = require('./cotizacionProveedores');

const TZ = 'America/Asuncion';

// Antigüedad máxima aceptable de la fecha publicada por la fuente. Cubre un
// fin de semana largo; más viejo que esto es una fuente abandonada y no se usa.
const ANTIGUEDAD_MAXIMA_DIAS = 5;

// Caché en memoria de la descarga: en un mismo tick, todas las empresas que
// usan el mismo proveedor comparten una sola petición HTTP.
const cacheDescarga = new Map();   // proveedorId -> { en: ms, datos }

function hoyAsuncion() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function horaAsuncion() {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date())
  );
}

/** Aritmética sobre fechas puras YYYY-MM-DD, sin que la zona horaria la corra. */
function sumarDias(fechaISO, dias) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const t = new Date(Date.UTC(anio, mes - 1, dia));
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/** La cotización que rige hoy es la publicada ayer. */
function fechaObjetivo() {
  return sumarDias(hoyAsuncion(), -1);
}

async function descargarConCache(proveedor, { usarCache, maxEdadMs }) {
  // `usarCache: false` (sincronización forzada desde la UI) tiene que ir a la
  // red sí o sí: con un TTL de 0 alcanzaba con que dos llamadas cayeran en el
  // mismo milisegundo para devolver el valor viejo.
  if (usarCache) {
    const cacheado = cacheDescarga.get(proveedor.id);
    if (cacheado && Date.now() - cacheado.en <= maxEdadMs) {
      return cacheado.datos;
    }
  }
  const datos = await proveedores.descargar(proveedor);
  cacheDescarga.set(proveedor.id, { en: Date.now(), datos });
  return datos;
}

/** Última cotización de la empresa para esa moneda (cualquier origen). */
async function vigenteDe(empresaId, moneda) {
  return Cotizacion.findOne({ empresaId, moneda }).sort({ createdAt: -1 });
}

/** ¿Ese timestamp cae en el día de hoy, hora de Asunción? */
function esDeHoy(fecha) {
  if (!fecha) return false;
  return new Date(fecha).toLocaleDateString('en-CA', { timeZone: TZ }) === hoyAsuncion();
}

function normalizarMonedas(monedas) {
  return (monedas || []).map((m) => String(m).toUpperCase().trim()).filter(Boolean);
}

function valorSegunTipo(par, tipoValor) {
  if (tipoValor === 'compra') return par.compra;
  if (tipoValor === 'promedio') return (par.compra + par.venta) / 2;
  return par.venta;
}

/**
 * ¿La empresa ya tiene la cotización de la fecha objetivo en todas sus monedas?
 * Si sí, no se toca la red: el caso normal del día es cero peticiones.
 */
async function estaAlDia(empresa, monedas) {
  const objetivo = fechaObjetivo();
  const lista = monedas || normalizarMonedas(empresa.cotizacionesAutomaticas?.monedas);
  for (const moneda of lista) {
    const ultima = await vigenteDe(empresa._id, moneda);
    const fecha = ultima?.fuente?.fechaCotizacion;
    if (fecha && fecha >= objetivo) continue;
    // Una cotización declarada a mano HOY es una decisión humana sobre el día
    // en curso: cuenta como al día para no salir a pisarla.
    if (esDeHoy(ultima?.createdAt)) continue;
    return false;
  }
  return true;
}

/**
 * Sincroniza una empresa. No lanza: devuelve el resumen de lo que hizo.
 *
 * @param {object} empresa            documento de Empresa
 * @param {object} opciones
 * @param {boolean} opciones.forzado  ignora el atajo de "ya está al día" y la caché
 * @param {number} opciones.maxEdadCacheMs
 */
async function sincronizarEmpresa(empresa, { forzado = false, maxEdadCacheMs = 60000 } = {}) {
  const config = empresa.cotizacionesAutomaticas || {};
  const resumen = { empresaId: empresa._id, ruc: empresa.ruc, estado: 'sin_cambios', monedas: [] };

  if (!config.activo && !forzado) {
    resumen.estado = 'sin_cambios';
    resumen.mensaje = 'Actualización automática desactivada';
    return resumen;
  }

  const monedas = normalizarMonedas(config.monedas);
  if (monedas.length === 0) {
    resumen.estado = 'sin_cambios';
    resumen.mensaje = 'No hay monedas configuradas para sincronizar';
    return resumen;
  }

  const proveedor = proveedores.obtener(config.proveedor);
  if (!proveedor) {
    resumen.estado = 'error';
    resumen.mensaje = `Proveedor "${config.proveedor}" no existe en el catálogo`;
    await guardarUltimaSincronizacion(empresa, resumen);
    return resumen;
  }

  if (!forzado && (await estaAlDia(empresa, monedas))) {
    resumen.estado = 'sin_cambios';
    resumen.mensaje = 'Ya está la cotización vigente del día';
    return resumen;
  }

  // --- descarga ---
  let datos;
  try {
    datos = await descargarConCache(proveedor, { usarCache: !forzado, maxEdadMs: maxEdadCacheMs });
  } catch (err) {
    resumen.estado = 'error';
    resumen.mensaje = String(err.message).slice(0, 250);
    await guardarUltimaSincronizacion(empresa, resumen);
    return resumen;
  }

  // --- validación de la fecha publicada ---
  const hoy = hoyAsuncion();
  const objetivo = fechaObjetivo();
  resumen.fechaCotizacion = datos.fecha;

  if (datos.fecha > hoy) {
    resumen.estado = 'error';
    resumen.mensaje = `La fuente publicó una fecha futura (${datos.fecha}); se ignora`;
    await guardarUltimaSincronizacion(empresa, resumen);
    return resumen;
  }
  // La fuente publica la cotización del día D durante la tarde del propio día D,
  // pero ESE valor recién rige el día D+1. Si ya publicó la de hoy, todavía NO se
  // aplica: hasta la medianoche sigue rigiendo la de ayer. Sin esta guarda, una
  // sincronización hecha a las 18:00 facturaría el resto del día con la cotización
  // de mañana.
  if (datos.fecha > objetivo) {
    resumen.estado = 'sin_cambios';
    resumen.mensaje = `La fuente ya publicó la cotización del ${datos.fecha}, que rige a partir de mañana. Hoy sigue vigente la del ${objetivo}.`;
    await guardarUltimaSincronizacion(empresa, resumen);
    return resumen;
  }

  if (datos.fecha < sumarDias(hoy, -ANTIGUEDAD_MAXIMA_DIAS)) {
    resumen.estado = 'error';
    resumen.mensaje = `La fuente está desactualizada: su última cotización es del ${datos.fecha}`;
    await guardarUltimaSincronizacion(empresa, resumen);
    return resumen;
  }

  // --- aplicación por moneda ---
  let aplicadas = 0;
  let bloqueadas = 0;
  const tipoValor = config.tipoValor || 'venta';
  const variacionMaxima = Number(config.variacionMaximaPct ?? 10);

  for (const moneda of monedas) {
    const par = datos.valores[moneda];
    if (!par) {
      resumen.monedas.push({ moneda, estado: 'no_publicada', mensaje: `${proveedor.nombre} no publica ${moneda}` });
      continue;
    }

    const valor = valorSegunTipo(par, tipoValor);
    if (!proveedores.esValorRazonable(valor)) {
      resumen.monedas.push({ moneda, estado: 'error', mensaje: `Valor fuera de rango: ${valor}` });
      continue;
    }

    const ultima = await vigenteDe(empresa._id, moneda);
    const fechaNuestra = ultima?.fuente?.fechaCotizacion || null;

    // Si hoy alguien la declaró a mano, esa corrección manda por el resto del
    // día: el robot no deshace una decisión humana. Mañana vuelve a tomar el
    // control con la cotización nueva.
    if (!fechaNuestra && esDeHoy(ultima?.createdAt)) {
      resumen.monedas.push({
        moneda,
        estado: 'sin_cambios',
        valor: ultima.valor,
        mensaje: 'Declarada a mano hoy: la automática no la pisa hasta mañana'
      });
      continue;
    }

    // Ya tenemos exactamente esta fecha: nada que hacer (idempotente)
    if (fechaNuestra && fechaNuestra >= datos.fecha) {
      resumen.monedas.push({
        moneda,
        estado: fechaNuestra >= objetivo ? 'sin_cambios' : 'pendiente_fuente',
        valor: ultima.valor,
        fechaCotizacion: fechaNuestra
      });
      continue;
    }

    // Guarda de variación: un salto grande es casi siempre un error de la
    // fuente, y acá termina en documentos fiscales firmados. No se aplica solo.
    if (ultima && Number.isFinite(ultima.valor) && ultima.valor > 0 && variacionMaxima > 0) {
      const variacion = Math.abs((valor - ultima.valor) / ultima.valor) * 100;
      if (variacion > variacionMaxima) {
        bloqueadas++;
        resumen.monedas.push({
          moneda,
          estado: 'bloqueada',
          valor,
          valorAnterior: ultima.valor,
          variacionPct: Number(variacion.toFixed(2)),
          fechaCotizacion: datos.fecha,
          mensaje:
            `Variación de ${variacion.toFixed(2)}% sobre la vigente (${ultima.valor} → ${valor}), ` +
            `supera el máximo de ${variacionMaxima}%. No se aplicó: declarala a mano si es correcta.`
        });
        continue;
      }
    }

    try {
      const cotizacion = await Cotizacion.create({
        empresaId: empresa._id,
        moneda,
        valor,
        declaradaPor: { tipo: 'automatica', nombre: proveedor.nombre, email: '' },
        fuente: {
          proveedor: proveedor.id,
          fechaCotizacion: datos.fecha,
          tipoValor,
          url: datos.url
        }
      });
      aplicadas++;
      resumen.monedas.push({
        moneda,
        estado: 'aplicada',
        valor: cotizacion.valor,
        valorAnterior: ultima?.valor ?? null,
        fechaCotizacion: datos.fecha
      });
    } catch (err) {
      // 11000 = choque con el índice único: otro tick la declaró en paralelo
      if (err.code === 11000) {
        resumen.monedas.push({ moneda, estado: 'sin_cambios', fechaCotizacion: datos.fecha });
      } else {
        resumen.monedas.push({ moneda, estado: 'error', mensaje: String(err.message).slice(0, 150) });
      }
    }
  }

  if (aplicadas > 0) {
    resumen.estado = 'ok';
    resumen.mensaje = `${aplicadas} cotización(es) actualizada(s) con la fecha ${datos.fecha}`;
    if (bloqueadas > 0) {
      resumen.mensaje += `; ${bloqueadas} bloqueada(s) por variación excesiva`;
    }
  } else if (bloqueadas > 0) {
    resumen.estado = 'bloqueada';
    resumen.mensaje = `${bloqueadas} cotización(es) no aplicada(s) por variación excesiva — requieren revisión`;
  } else if (datos.fecha < objetivo) {
    resumen.estado = 'pendiente_fuente';
    resumen.mensaje = `La fuente todavía publica la cotización del ${datos.fecha}; se esperaba la del ${objetivo}`;
  } else {
    resumen.estado = 'sin_cambios';
    resumen.mensaje = `Sin novedades (fecha vigente ${datos.fecha})`;
  }

  await guardarUltimaSincronizacion(empresa, resumen);
  return resumen;
}

async function guardarUltimaSincronizacion(empresa, resumen) {
  try {
    await Empresa.updateOne(
      { _id: empresa._id },
      {
        $set: {
          'cotizacionesAutomaticas.ultimaSincronizacion': {
            en: new Date(),
            estado: resumen.estado,
            fechaCotizacion: resumen.fechaCotizacion || null,
            mensaje: resumen.mensaje || ''
          }
        }
      }
    );
  } catch (err) {
    console.error('❌ [COTIZACIONES] No se pudo guardar el estado de sincronización:', err.message);
  }
}

/**
 * Sincroniza todas las empresas que tienen la actualización automática activa.
 * Pensado para el worker: comparte una sola descarga entre todas.
 */
async function sincronizarTodas() {
  const empresas = await Empresa.find({
    activo: true,
    'cotizacionesAutomaticas.activo': true
  });

  const resultados = [];
  for (const empresa of empresas) {
    try {
      resultados.push(await sincronizarEmpresa(empresa));
    } catch (err) {
      console.error(`❌ [COTIZACIONES] Error sincronizando ${empresa.ruc}:`, err.message);
      resultados.push({ empresaId: empresa._id, ruc: empresa.ruc, estado: 'error', mensaje: err.message });
    }
  }
  return resultados;
}

module.exports = {
  sincronizarEmpresa,
  sincronizarTodas,
  estaAlDia,
  fechaObjetivo,
  hoyAsuncion,
  horaAsuncion,
  sumarDias
};
