/**
 * Especificación OpenAPI 3.0 de la API de DTE-PY.
 *
 * Se sirve en /api/docs (Swagger UI) y en /api/openapi.json (JSON crudo).
 *
 * Escrita a mano contra las rutas reales, con los responses tipados según lo
 * que cada handler devuelve de verdad (no genéricos). Al agregar o cambiar un
 * endpoint, actualizar también este archivo.
 */

const { version } = require('../package.json');

// ---------------------------------------------------------------------------
// Helpers de construcción
// ---------------------------------------------------------------------------

const ref = (nombre) => ({ $ref: `#/components/schemas/${nombre}` });

const respuestaError = (descripcion) => ({
  description: descripcion,
  content: {
    'application/json': { schema: ref('Error') }
  }
});

const NO_AUTORIZADO = respuestaError('Token o API Key ausentes, inválidos o expirados');
const NO_ENCONTRADO = respuestaError('El recurso no existe o está fuera del alcance del token');
const ERROR_SERVIDOR = respuestaError('Error interno');

const paramRuta = (nombre, descripcion) => ({
  name: nombre,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: descripcion
});

const paramPagina = [
  {
    name: 'page',
    in: 'query',
    schema: { type: 'integer', default: 1, minimum: 1 },
    description: 'Número de página'
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', default: 10, minimum: 1 },
    description: 'Cantidad de resultados por página'
  }
];

const okJson = (descripcion, schema) => ({
  description: descripcion,
  content: {
    'application/json': {
      schema: schema || ref('RespuestaOk')
    }
  }
});

/** Envoltorio estándar { success, message?, data } con `data` tipado. */
const envuelto = (dataSchema, conMensaje = true) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    ...(conMensaje ? { message: { type: 'string' } } : {}),
    data: dataSchema
  }
});

const fechaHora = (descripcion) => ({
  type: 'string',
  format: 'date-time',
  nullable: true,
  ...(descripcion ? { description: descripcion } : {})
});

const objectId = (descripcion) => ({
  type: 'string',
  example: '68ae1f2b9c3d4e5f6a7b8c9d',
  ...(descripcion ? { description: descripcion } : {})
});

// ---------------------------------------------------------------------------
// Especificación
// ---------------------------------------------------------------------------

module.exports = {
  openapi: '3.0.3',

  info: {
    title: 'DTE-PY — API de Facturación Electrónica (SIFEN Paraguay)',
    version,
    description: `
API del backend DTE-PY para emisión de Documentos Tributarios Electrónicos
ante SIFEN (Paraguay).

## Autenticación

Todos los endpoints requieren autenticación salvo \`/api/health\` y
\`/api/auth/login\`. Se aceptan dos credenciales, ambas en la misma cabecera:

    Authorization: Bearer <token>

- **JWT**: se obtiene con \`POST /api/auth/login\`. Vence según \`JWT_EXPIRES_IN\`
  (24h por defecto). Es lo que usa el frontend.
- **API Key**: se genera con \`POST /api/api-keys\` y no vence salvo que se le
  defina expiración. Es lo que usan las integraciones (ERPNext y similares).

El middleware intenta primero validar el valor como JWT; si no lo es, lo busca
como API Key.

### Permisos de las API Keys

Una sesión JWT opera con el rol del usuario. Una API Key, en cambio, solo
alcanza lo que declaran sus \`permisos\`:

| Permiso | Habilita |
|---|---|
| \`facturas:crear\` | Emitir documentos, reintentos, eventos, envío de lotes |
| \`facturas:leer\` | Consultas, descargas, estado, empresas (lectura) |
| \`facturas:eliminar\` | Borrar facturas y lotes individuales |
| \`stats:leer\` | Estadísticas, logs y estado de la cola |
| \`admin\` | Todos los anteriores |

Además hay operaciones **vedadas a las API Keys** sin importar sus permisos:

- Gestión de credenciales (\`/api/api-keys/*\`, perfil, contraseña): solo
  sesión JWT. Una key filtrada no puede crear ni renovar credenciales.
- Mutaciones de empresas y subida de certificados: solo sesión JWT.
- Destructivas masivas (\`DELETE /api/invoices/clear\`,
  \`DELETE /api/logs/clear\`, \`POST /api/queue/clear*\`): solo sesión JWT
  de un usuario **admin**.

### Alcance multi-empresa

Facturas, eventos, lotes y estadísticas se limitan a las **empresas del
token**: un admin ve todo el sistema; los demás usuarios solo sus empresas;
una API Key, las empresas de su dueño (o únicamente la empresa a la que esté
asociada). Los documentos fuera del alcance responden \`404\`.

### Límites

\`POST /api/auth/login\` admite 10 intentos fallidos por IP cada 15 minutos;
después responde \`429\`.

## Flujo típico de emisión

1. \`POST /api/facturar/crear\` → la factura se encola y responde \`202\` al instante.
2. \`GET /api/factura/estado/:id\` → seguimiento del procesamiento.
3. \`GET /api/invoices/:id/download-xml\` y \`/download-pdf\` → XML firmado y KUDE.

El procesamiento (generar XML, firmar, enviar a SET, generar el PDF) ocurre en
workers asíncronos sobre Redis, no en el request.
`.trim()
  },

  servers: [
    { url: '/', description: 'Servidor actual' },
    { url: 'http://localhost:8081', description: 'Desarrollo local' }
  ],

  tags: [
    { name: 'Salud', description: 'Estado del servicio' },
    { name: 'Autenticación', description: 'Login, perfil y contraseña' },
    { name: 'API Keys', description: 'Credenciales para integraciones' },
    { name: 'Facturación', description: 'Emisión de documentos electrónicos' },
    { name: 'Facturas', description: 'Consulta, descarga y mantenimiento' },
    { name: 'Empresas', description: 'Multi-empresa y certificados digitales' },
    { name: 'Eventos SIFEN', description: 'Cancelación, conformidad, disconformidad' },
    { name: 'Lotes', description: 'Envío agrupado de documentos' },
    { name: 'Cola', description: 'Estado y mantenimiento de la cola de trabajos' },
    { name: 'Logs', description: 'Auditoría de operaciones' },
    { name: 'Estadísticas', description: 'Métricas del sistema' },
    { name: 'Consultas SET', description: 'Consultas directas a la SET' }
  ],

  security: [{ bearerAuth: [] }],

  paths: {
    // -----------------------------------------------------------------------
    // Salud
    // -----------------------------------------------------------------------
    '/api/health': {
      get: {
        tags: ['Salud'],
        summary: 'Estado del servicio',
        description: 'Público, sin autenticación. Lo usa el frontend para validar la URL del backend antes de iniciar sesión.',
        security: [],
        responses: {
          200: okJson('El servicio responde', ref('SaludServicio'))
        }
      }
    },

    '/api/openapi.json': {
      get: {
        tags: ['Salud'],
        summary: 'Especificación OpenAPI de esta API',
        description: 'Público. Devuelve este mismo documento en JSON, para importarlo en Postman/Insomnia o generar un cliente.',
        security: [],
        responses: {
          200: okJson('Especificación OpenAPI 3.0', { type: 'object' })
        }
      }
    },

    // -----------------------------------------------------------------------
    // Autenticación
    // -----------------------------------------------------------------------
    '/api/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión',
        description: 'Público. Devuelve el JWT que se usa como `Bearer` en el resto de la API. Máximo 10 intentos fallidos por IP cada 15 minutos.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', description: 'Usuario o email', example: 'admin' },
                  password: { type: 'string', format: 'password' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Sesión iniciada', ref('LoginRespuesta')),
          400: respuestaError('Faltan username o password'),
          401: respuestaError('Credenciales inválidas o usuario inactivo'),
          429: respuestaError('Demasiados intentos de inicio de sesión')
        }
      }
    },

    '/api/auth/perfil': {
      get: {
        tags: ['Autenticación'],
        summary: 'Obtener el perfil del usuario autenticado',
        description: 'Solo con sesión JWT.',
        responses: {
          200: okJson('Perfil', envuelto({
            type: 'object',
            properties: { usuario: ref('PerfilUsuario') }
          }, false)),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)')
        }
      },
      put: {
        tags: ['Autenticación'],
        summary: 'Actualizar el perfil',
        description: 'Solo con sesión JWT.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  nombre: { type: 'string' },
                  apellido: { type: 'string' },
                  email: { type: 'string', format: 'email' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Perfil actualizado', envuelto({
            type: 'object',
            properties: { usuario: ref('PerfilUsuario') }
          })),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)')
        }
      }
    },

    '/api/auth/cambiar-password': {
      post: {
        tags: ['Autenticación'],
        summary: 'Cambiar la contraseña',
        description: 'Solo con sesión JWT.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['passwordActual', 'passwordNuevo'],
                properties: {
                  passwordActual: { type: 'string', format: 'password' },
                  passwordNuevo: { type: 'string', format: 'password' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Contraseña actualizada'),
          400: respuestaError('La contraseña actual no coincide'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)')
        }
      }
    },

    '/api/auth/logout': {
      post: {
        tags: ['Autenticación'],
        summary: 'Cerrar sesión',
        description: 'El JWT no se invalida del lado del servidor: el cliente debe descartarlo.',
        responses: {
          200: okJson('Sesión cerrada'),
          401: NO_AUTORIZADO
        }
      }
    },

    // -----------------------------------------------------------------------
    // API Keys
    // -----------------------------------------------------------------------
    '/api/api-keys': {
      get: {
        tags: ['API Keys'],
        summary: 'Listar API Keys',
        description: 'Solo con sesión JWT (no con API Key). Devuelve solo `keyParcial` (prefijo y sufijo): la clave completa no se guarda en la base y no se puede recuperar.',
        responses: {
          200: okJson('Listado de API Keys del usuario', envuelto({
            type: 'array',
            items: ref('ApiKeyResumen')
          }, false)),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)')
        }
      },
      post: {
        tags: ['API Keys'],
        summary: 'Crear una API Key',
        description: '⚠️ La clave en texto plano se devuelve **una sola vez**, en esta respuesta. Después solo queda su hash: no hay forma de volver a verla. Solo con sesión JWT.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nombre'],
                properties: {
                  nombre: { type: 'string', example: 'Integración ERPNext' },
                  descripcion: { type: 'string' },
                  permisos: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['facturas:crear', 'facturas:leer', 'facturas:eliminar', 'stats:leer', 'admin']
                    },
                    default: ['facturas:crear', 'facturas:leer', 'stats:leer']
                  },
                  expiracion: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Opcional. Sin este campo la key no vence.'
                  }
                }
              }
            }
          }
        },
        responses: {
          201: okJson('API Key creada (única vez que se ve la clave)', ref('ApiKeyCreada')),
          400: respuestaError('Falta el nombre'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)')
        }
      }
    },

    '/api/api-keys/{id}': {
      get: {
        tags: ['API Keys'],
        summary: 'Detalle de una API Key',
        description: 'Solo con sesión JWT. No incluye la clave ni su hash.',
        parameters: [paramRuta('id', 'ID de la API Key')],
        responses: {
          200: okJson('Detalle', envuelto(ref('ApiKeyResumen'), false)),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)'),
          404: NO_ENCONTRADO
        }
      },
      delete: {
        tags: ['API Keys'],
        summary: 'Revocar una API Key',
        description: 'Solo con sesión JWT.',
        parameters: [paramRuta('id', 'ID de la API Key')],
        responses: {
          200: okJson('Revocada'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)'),
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/api-keys/{id}/renew': {
      put: {
        tags: ['API Keys'],
        summary: 'Renovar una API Key',
        description: 'Genera una clave nueva manteniendo nombre y permisos. **La anterior deja de funcionar de inmediato.** La nueva se muestra una sola vez. Solo con sesión JWT.',
        parameters: [paramRuta('id', 'ID de la API Key')],
        responses: {
          200: okJson('Renovada (única vez que se ve la clave nueva)', ref('ApiKeyCreada')),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)'),
          404: NO_ENCONTRADO
        }
      }
    },

    // -----------------------------------------------------------------------
    // Facturación
    // -----------------------------------------------------------------------
    '/api/facturar/crear': {
      post: {
        tags: ['Facturación'],
        summary: 'Emitir un documento electrónico',
        description: `
Endpoint principal de integración.

**Es asíncrono**: valida, encola y responde \`202\` de inmediato. El XML se
genera, firma y envía a SET en un worker aparte. Para seguir el avance, usar
\`GET /api/factura/estado/:facturaId\`.

La empresa emisora se resuelve por el \`param.ruc\`, que debe corresponder a una
empresa del alcance del token, activa y con certificado válido.
`.trim(),
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: ref('SolicitudFactura') }
          }
        },
        responses: {
          202: okJson('Encolada para procesamiento', ref('FacturaEncolada')),
          400: respuestaError('Datos inválidos o empresa sin certificado'),
          401: NO_AUTORIZADO,
          403: respuestaError('El RUC emisor no pertenece al alcance del token (EMPRESA_FUERA_DE_ALCANCE)'),
          404: respuestaError('No existe una empresa con ese RUC')
        }
      }
    },

    '/api/facturar/empresa/{ruc}': {
      get: {
        tags: ['Facturación'],
        summary: 'Buscar empresa emisora por RUC',
        description: 'Útil para que la integración confirme que el RUC está dado de alta antes de emitir.',
        parameters: [paramRuta('ruc', 'RUC con o sin guión (ej: 80055783-2)')],
        responses: {
          200: okJson('Empresa encontrada', envuelto(ref('EmpresaEmisora'), false)),
          400: respuestaError('RUC requerido'),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/factura/estado/{id}': {
      get: {
        tags: ['Facturación'],
        summary: 'Estado de procesamiento de una factura',
        description: 'Devuelve el estado en SIFEN y el del trabajo en la cola. Es el endpoint a consultar tras un `202` de `/api/facturar/crear`.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Estado', envuelto(ref('EstadoFacturaCola'))),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    // -----------------------------------------------------------------------
    // Facturas
    // -----------------------------------------------------------------------
    '/api/invoices': {
      get: {
        tags: ['Facturas'],
        summary: 'Listar facturas',
        parameters: [
          ...paramPagina,
          {
            name: 'estado',
            in: 'query',
            schema: ref('EstadoSifen'),
            description: 'Filtrar por estado en SIFEN'
          },
          {
            name: 'rucEmpresa',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filtrar por RUC de la empresa emisora'
          },
          {
            name: 'search',
            in: 'query',
            schema: { type: 'string' },
            description: 'Texto a buscar (literal, se interpreta según `searchType`)'
          },
          {
            name: 'searchType',
            in: 'query',
            schema: { type: 'string', enum: ['ruc', 'nombre', 'cdc', 'tipo', 'id'] },
            description: 'Campo sobre el que aplica `search`: RUC o nombre del cliente, CDC, tipo de documento, o ID'
          }
        ],
        responses: {
          200: okJson('Listado paginado', ref('ListadoFacturas')),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/invoices/cdc/{cdc}': {
      get: {
        tags: ['Facturas'],
        summary: 'Buscar una factura por CDC',
        description: 'Primero busca en la base local; si no está, consulta directamente a SIFEN (requiere una empresa con certificado activo).',
        parameters: [paramRuta('cdc', 'Código de Control (44 dígitos)')],
        responses: {
          200: okJson('Factura encontrada (local o en SIFEN)', ref('BusquedaPorCdc')),
          400: respuestaError('CDC requerido, o no hay empresa con certificado para consultar a SIFEN'),
          401: NO_AUTORIZADO,
          404: respuestaError('CDC no encontrado ni localmente ni en SIFEN')
        }
      }
    },

    '/api/invoices/estado/{cdc}': {
      get: {
        tags: ['Facturas'],
        summary: 'Consultar el estado de un CDC directamente en SET',
        description: 'Consulta el CDC en los servicios de la SET usando el certificado de la empresa emisora, y actualiza el estado local si cambió.',
        parameters: [paramRuta('cdc', 'Código de Control (44 dígitos)')],
        responses: {
          200: okJson('Estado según SET', ref('EstadoSegunSet')),
          400: respuestaError('La empresa de la factura no tiene certificado cargado'),
          401: NO_AUTORIZADO,
          404: respuestaError('Factura no encontrada en la base local'),
          500: ERROR_SERVIDOR
        }
      }
    },

    '/api/invoices/logs': {
      get: {
        tags: ['Facturas'],
        summary: 'Logs de operaciones de facturas',
        parameters: [
          ...paramPagina,
          { name: 'tipo', in: 'query', schema: ref('TipoOperacion') },
          { name: 'estado', in: 'query', schema: { type: 'string', enum: ['success', 'error', 'warning'] } }
        ],
        responses: {
          200: okJson('Listado paginado', ref('ListadoLogs')),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/invoices/clear': {
      delete: {
        tags: ['Facturas'],
        summary: 'Eliminar TODAS las facturas',
        description: '⚠️ Destructivo e irreversible. Requiere **sesión JWT de admin** (una API Key no alcanza) y reconfirmación con la contraseña del usuario.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password'],
                properties: {
                  password: { type: 'string', format: 'password', description: 'Contraseña del usuario autenticado' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Facturas eliminadas', envuelto({
            type: 'object',
            properties: { deletedCount: { type: 'integer', example: 152 } }
          })),
          400: respuestaError('Falta la contraseña o no coincide'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario admin')
        }
      }
    },

    '/api/invoices/{id}': {
      get: {
        tags: ['Facturas'],
        summary: 'Detalle de una factura',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Factura', envuelto(ref('FacturaDetalle'), false)),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      },
      delete: {
        tags: ['Facturas'],
        summary: 'Eliminar una factura',
        description: 'Requiere el permiso `facturas:eliminar` en API Keys.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Eliminada'),
          401: NO_AUTORIZADO,
          403: respuestaError('La API Key no tiene el permiso facturas:eliminar'),
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/invoices/{id}/logs': {
      get: {
        tags: ['Facturas'],
        summary: 'Logs de una factura',
        description: 'A diferencia del resto de la API, responde el array directamente (sin envoltorio `{success, data}`).',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Logs de la factura, más recientes primero', {
            type: 'array',
            items: ref('LogOperacion')
          }),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/invoices/{id}/eventos': {
      get: {
        tags: ['Facturas'],
        summary: 'Eventos SIFEN de una factura',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Eventos de la factura', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              total: { type: 'integer' },
              eventos: { type: 'array', items: ref('Evento') }
            }
          }),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/invoices/{id}/retry': {
      post: {
        tags: ['Facturas'],
        summary: 'Reintentar el envío a SIFEN',
        description: 'Reenvía a SET el XML ya firmado de una factura que quedó en error. Requiere `facturas:crear` en API Keys.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Reenvío completado', envuelto({
            type: 'object',
            properties: {
              invoice: ref('FacturaResumen'),
              estado: ref('EstadoSifen'),
              codigoRetorno: { type: 'string', nullable: true, example: '0260' },
              mensajeRetorno: { type: 'string', nullable: true }
            }
          })),
          400: respuestaError('El XML no existe en disco, o la factura ya está en un estado final'),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/invoices/{id}/refresh-status': {
      post: {
        tags: ['Facturas'],
        summary: 'Refrescar el estado desde SET',
        description: 'Consulta el CDC en SET y actualiza el estado local. Si la factura ya está en un estado final (aceptado/rechazado/error/observado) no consulta: esos estados no cambian.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: okJson('Resultado de la consulta', ref('RefreshEstado')),
          400: respuestaError('La factura no tiene CDC asignado'),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/invoices/{id}/download-xml': {
      get: {
        tags: ['Facturas'],
        summary: 'Descargar el XML firmado',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: {
            description: 'XML firmado (attachment)',
            content: { 'application/xml': { schema: { type: 'string', format: 'binary' } } }
          },
          401: NO_AUTORIZADO,
          404: respuestaError('La factura no existe o el archivo no está en disco')
        }
      }
    },

    '/api/invoices/{id}/download-pdf': {
      get: {
        tags: ['Facturas'],
        summary: 'Descargar el KUDE (PDF)',
        description: 'El PDF lo genera un worker aparte tras la aprobación; puede no estar disponible inmediatamente.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: {
            description: 'KUDE en PDF (attachment)',
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } }
          },
          401: NO_AUTORIZADO,
          404: respuestaError('La factura no existe o el KUDE todavía no fue generado')
        }
      }
    },

    // -----------------------------------------------------------------------
    // Empresas
    // -----------------------------------------------------------------------
    '/api/empresas': {
      get: {
        tags: ['Empresas'],
        summary: 'Listar empresas',
        responses: {
          200: okJson('Empresas del usuario', envuelto({
            type: 'array',
            items: ref('EmpresaCompleta')
          }, false)),
          401: NO_AUTORIZADO
        }
      },
      post: {
        tags: ['Empresas'],
        summary: 'Crear una empresa',
        description: 'Solo con sesión JWT (las mutaciones de empresas no se permiten con API Key). El certificado digital se sube aparte, con `POST /api/empresas/{id}/certificado`.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: ref('Empresa') }
          }
        },
        responses: {
          201: okJson('Empresa creada', envuelto(ref('EmpresaCompleta'))),
          400: respuestaError('Faltan campos requeridos o el RUC/CSC no cumple el formato'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)')
        }
      }
    },

    '/api/empresas/{id}': {
      get: {
        tags: ['Empresas'],
        summary: 'Detalle de una empresa',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: {
          200: okJson('Empresa', envuelto(ref('EmpresaCompleta'), false)),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      },
      put: {
        tags: ['Empresas'],
        summary: 'Actualizar una empresa',
        description: 'Solo con sesión JWT.',
        parameters: [paramRuta('id', 'ID de la empresa')],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref('Empresa') } }
        },
        responses: {
          200: okJson('Actualizada', envuelto(ref('EmpresaCompleta'))),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)'),
          404: NO_ENCONTRADO
        }
      },
      delete: {
        tags: ['Empresas'],
        summary: 'Eliminar una empresa',
        description: 'Solo con sesión JWT.',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: {
          200: okJson('Eliminada'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)'),
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/empresas/{id}/certificado': {
      post: {
        tags: ['Empresas'],
        summary: 'Subir el certificado digital (.p12)',
        description: `
Sube el certificado F1 emitido por un Prestador Cualificado de Servicios de
Confianza. Solo se aceptan archivos \`.p12\`, hasta 5 MB. Solo con sesión JWT.

La contraseña se cifra con AES-256-GCM usando \`CERTIFICADO_MASTER_KEY\` antes
de guardarse: **esa variable de entorno tiene que estar configurada antes de
subir el primer certificado**, y si cambia, los certificados ya cargados
quedan indescifrables.
`.trim(),
        parameters: [paramRuta('id', 'ID de la empresa')],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['certificado', 'contrasena'],
                properties: {
                  certificado: { type: 'string', format: 'binary', description: 'Archivo .p12 (máx. 5 MB)' },
                  contrasena: { type: 'string', format: 'password', description: 'Contraseña del .p12' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Certificado cargado', envuelto({
            type: 'object',
            properties: {
              nombreArchivo: { type: 'string', example: 'kingston-f1.p12' },
              fechaCarga: fechaHora()
            }
          })),
          400: respuestaError('Archivo no es .p12, supera 5 MB, o la contraseña no abre el certificado'),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario (no API Key)'),
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/empresas/{id}/validar-certificado': {
      get: {
        tags: ['Empresas'],
        summary: 'Validar el certificado cargado',
        description: 'Verifica que el .p12 se pueda abrir con la contraseña guardada e informa su vencimiento.',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: {
          200: okJson('Resultado de la validación', envuelto(ref('ValidacionCertificado'), false)),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/empresas/{id}/stats': {
      get: {
        tags: ['Empresas'],
        summary: 'Estadísticas de una empresa',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: {
          200: okJson('Estadísticas', envuelto(ref('EstadisticasEmpresa'), false)),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    // -----------------------------------------------------------------------
    // Eventos SIFEN
    // -----------------------------------------------------------------------
    '/api/eventos/enviar': {
      post: {
        tags: ['Eventos SIFEN'],
        summary: 'Enviar un evento a SET',
        description: `
Manual Técnico SIFEN v150, sección 11.

**Cancelación**: solo la puede pedir el emisor, sobre una factura ya aprobada
por SET, y dentro de las **48 horas** de aprobada (168 horas para el resto de
los documentos). El backend valida el plazo localmente y responde
\`EVENTO_CANCELACION_FUERA_DE_PLAZO\` si venció; en ese caso corresponde
emitir una Nota de Crédito. La cancelación es **irreversible**.
`.trim(),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['invoiceId', 'tipoEvento', 'descripcion'],
                properties: {
                  invoiceId: objectId('ID de la factura'),
                  tipoEvento: ref('TipoEvento'),
                  descripcion: { type: 'string', description: 'Motivo del evento' },
                  usuario: {
                    type: 'object',
                    description: 'Opcional; por defecto se toma del usuario autenticado',
                    properties: {
                      documentoNumero: { type: 'string' },
                      nombre: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Evento enviado a SET', envuelto(ref('ResultadoEvento'))),
          400: respuestaError('Faltan campos, el tipo no es válido, la factura no está aprobada, o la cancelación está fuera de plazo (EVENTO_CANCELACION_FUERA_DE_PLAZO, con horasLimite y horasTranscurridas)'),
          401: NO_AUTORIZADO,
          404: respuestaError('Factura no encontrada')
        }
      }
    },

    '/api/eventos': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Listar eventos',
        parameters: [
          ...paramPagina,
          { name: 'tipoEvento', in: 'query', schema: ref('TipoEvento') },
          {
            name: 'estadoEvento',
            in: 'query',
            schema: { type: 'string', enum: ['enviado', 'registrado', 'rechazado', 'error'] }
          },
          { name: 'cdc', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: okJson('Listado paginado', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              eventos: { type: 'array', items: ref('Evento') },
              totalPages: { type: 'integer' },
              currentPage: { type: 'integer' },
              total: { type: 'integer' }
            }
          }),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/eventos/factura/{invoiceId}': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Eventos de una factura',
        parameters: [paramRuta('invoiceId', 'ID de la factura')],
        responses: {
          200: okJson('Eventos', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              total: { type: 'integer' },
              eventos: { type: 'array', items: ref('Evento') }
            }
          }),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/eventos/cdc/{cdc}': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Eventos por CDC',
        parameters: [paramRuta('cdc', 'Código de Control')],
        responses: {
          200: okJson('Eventos', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              total: { type: 'integer' },
              eventos: { type: 'array', items: ref('Evento') }
            }
          }),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/eventos/{id}': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Detalle de un evento',
        parameters: [paramRuta('id', 'ID del evento')],
        responses: {
          200: okJson('Evento', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              evento: ref('Evento')
            }
          }),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    // -----------------------------------------------------------------------
    // Lotes
    // -----------------------------------------------------------------------
    '/api/lotes/list': {
      get: {
        tags: ['Lotes'],
        summary: 'Listar lotes de envío',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          {
            name: 'estado',
            in: 'query',
            schema: { type: 'string', enum: ['en_espera', 'enviado', 'procesando', 'completado', 'error'] }
          },
          { name: 'empresaId', in: 'query', schema: { type: 'string' } },
          { name: 'tipoDocumento', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: okJson('Listado paginado', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: ref('Lote') },
              total: { type: 'integer' },
              page: { type: 'integer' },
              totalPages: { type: 'integer' }
            }
          }),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/lotes/{id}': {
      get: {
        tags: ['Lotes'],
        summary: 'Detalle de un lote',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: {
          200: okJson('Lote', envuelto(ref('Lote'), false)),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      },
      delete: {
        tags: ['Lotes'],
        summary: 'Eliminar un lote',
        description: 'Solo lotes en estado `en_espera` o `error`. Requiere `facturas:eliminar` en API Keys.',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: {
          200: okJson('Eliminado'),
          400: respuestaError('El lote no está en un estado eliminable'),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/lotes/enviar/{id}': {
      post: {
        tags: ['Lotes'],
        summary: 'Enviar un lote a SET',
        description: 'Requiere `facturas:crear` en API Keys.',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: {
          200: okJson('Lote enviado', envuelto(ref('Lote'))),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    '/api/lotes/enviar-pendientes': {
      post: {
        tags: ['Lotes'],
        summary: 'Enviar todos los lotes en espera',
        description: 'Requiere `facturas:crear` en API Keys.',
        responses: {
          200: okJson('Resultado por lote', envuelto({
            type: 'array',
            items: {
              type: 'object',
              properties: {
                loteId: objectId(),
                estado: { type: 'string' },
                error: { type: 'string', nullable: true }
              },
              additionalProperties: true
            }
          }, false)),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/lotes/consultar/{id}': {
      post: {
        tags: ['Lotes'],
        summary: 'Consultar el resultado de un lote en SET',
        description: 'Consulta el número de lote en SET y actualiza el estado de cada factura del lote. Requiere `facturas:crear` en API Keys.',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: {
          200: okJson('Resultado de la consulta', envuelto({
            type: 'object',
            description: 'Estado del lote y de sus facturas según SET',
            additionalProperties: true
          }, false)),
          401: NO_AUTORIZADO,
          404: NO_ENCONTRADO
        }
      }
    },

    // -----------------------------------------------------------------------
    // Cola
    // -----------------------------------------------------------------------
    '/api/queue/stats': {
      get: {
        tags: ['Cola'],
        summary: 'Estadísticas de las colas',
        description: 'Trabajos en espera, activos, completados y fallidos de las colas `facturacion` y `kude`.',
        responses: {
          200: okJson('Contadores por cola', envuelto(ref('ColaEstadisticas'))),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/queue/jobs': {
      get: {
        tags: ['Cola'],
        summary: 'Trabajos recientes',
        description: 'Trabajos de ambas colas combinados, más recientes primero.',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: {
          200: okJson('Trabajos recientes', envuelto({
            type: 'array',
            items: ref('TrabajoCola')
          })),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/queue/clear': {
      post: {
        tags: ['Cola'],
        summary: 'Limpiar trabajos completados',
        description: 'Requiere sesión JWT de admin.',
        requestBody: { content: { 'application/json': { schema: ref('LimpiezaCola') } } },
        responses: {
          200: okJson('Cola limpiada', ref('ResultadoLimpieza')),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario admin')
        }
      }
    },

    '/api/queue/clear-completed': {
      post: {
        tags: ['Cola'],
        summary: 'Limpiar trabajos completados',
        description: 'Requiere sesión JWT de admin.',
        requestBody: { content: { 'application/json': { schema: ref('LimpiezaCola') } } },
        responses: {
          200: okJson('Cola limpiada', ref('ResultadoLimpieza')),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario admin')
        }
      }
    },

    '/api/queue/clear-failed': {
      post: {
        tags: ['Cola'],
        summary: 'Limpiar trabajos fallidos',
        description: 'Requiere sesión JWT de admin.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  queue: { type: 'string', enum: ['facturacion', 'kude'], default: 'facturacion' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Cola limpiada', ref('ResultadoLimpieza')),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario admin')
        }
      }
    },

    '/api/queue/clear-all': {
      post: {
        tags: ['Cola'],
        summary: 'Vaciar la cola por completo',
        description: '⚠️ Elimina todos los trabajos, incluidos los pendientes de procesar. Requiere sesión JWT de admin.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  queue: { type: 'string', enum: ['facturacion', 'kude'], default: 'facturacion' }
                }
              }
            }
          }
        },
        responses: {
          200: okJson('Cola vaciada', ref('ResultadoLimpieza')),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario admin')
        }
      }
    },

    // -----------------------------------------------------------------------
    // Logs
    // -----------------------------------------------------------------------
    '/api/logs': {
      get: {
        tags: ['Logs'],
        summary: 'Listar logs de operaciones',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 15 } },
          { name: 'estado', in: 'query', schema: { type: 'string', enum: ['success', 'error', 'warning'] } },
          { name: 'tipoOperacion', in: 'query', schema: ref('TipoOperacion') },
          { name: 'invoiceId', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: okJson('Listado paginado', ref('ListadoLogs')),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/logs/clear': {
      delete: {
        tags: ['Logs'],
        summary: 'Eliminar logs',
        description: '⚠️ Borra el rastro de auditoría. Requiere **sesión JWT de admin**: una API Key no alcanza.',
        parameters: [
          {
            name: 'tipo',
            in: 'query',
            schema: { type: 'string', enum: ['all', 'success', 'error', 'warning'] },
            description: 'Sin este parámetro (o con `all`) se eliminan todos'
          }
        ],
        responses: {
          200: okJson('Logs eliminados', envuelto({
            type: 'object',
            properties: { deletedCount: { type: 'integer', example: 320 } }
          })),
          401: NO_AUTORIZADO,
          403: respuestaError('Requiere sesión de usuario admin')
        }
      }
    },

    // -----------------------------------------------------------------------
    // Estadísticas y consultas
    // -----------------------------------------------------------------------
    '/api/stats': {
      get: {
        tags: ['Estadísticas'],
        summary: 'Estadísticas generales',
        description: 'Totales por estado, facturas del día, tendencia de los últimos 7 días y uptime del proceso. Limitado a las empresas del alcance.',
        responses: {
          200: okJson('Estadísticas', envuelto(ref('Estadisticas'), false)),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/consulta/ruc/{ruc}': {
      get: {
        tags: ['Consultas SET'],
        summary: 'Consultar un RUC en SET',
        description: 'Consulta el padrón de la SET para validar un RUC de cliente antes de facturarle. Usa el certificado de una empresa del alcance.',
        parameters: [paramRuta('ruc', 'RUC a consultar')],
        responses: {
          200: okJson('Datos del contribuyente', envuelto({
            type: 'object',
            properties: {
              ruc: { type: 'string' },
              encontrado: { type: 'boolean', example: true },
              respuesta: {
                type: 'object',
                description: 'Respuesta SOAP de SET parseada (razón social, estado del contribuyente, etc.)',
                additionalProperties: true
              }
            }
          }, false)),
          400: respuestaError('RUC requerido, o no hay empresa con certificado activo para firmar la consulta'),
          401: NO_AUTORIZADO,
          404: respuestaError('RUC no encontrado en SET')
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  // Componentes
  // -------------------------------------------------------------------------
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'JWT obtenido en `/api/auth/login`, o una API Key creada en `/api/api-keys`. Van en la misma cabecera.'
      }
    },

    schemas: {
      // ------------------------------ genéricos ------------------------------
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', description: 'Código de error estable (para lógica del cliente)', example: 'FACTURA_NOT_FOUND' },
          message: { type: 'string', description: 'Descripción legible' }
        }
      },

      RespuestaOk: {
        type: 'object',
        description: 'Confirmación sin datos adicionales',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' }
        }
      },

      // ------------------------------ enums ------------------------------
      EstadoSifen: {
        type: 'string',
        enum: ['recibido', 'encolado', 'procesando', 'enviado', 'aceptado', 'observado', 'rechazado', 'error'],
        description: 'Estado del documento en SIFEN. aceptado/observado/rechazado/error son finales.'
      },

      Proceso: {
        type: 'string',
        nullable: true,
        enum: ['Completado', 'No completado', null],
        description: 'Completado cuando el DTE fue resuelto por SET y el KUDE generado'
      },

      TipoOperacion: {
        type: 'string',
        enum: [
          'inicio_proceso', 'generacion_xml', 'firma_xml', 'envio_sifen',
          'respuesta_sifen', 'error', 'envio_exitoso', 'reintento',
          'reintento_respuesta', 'actualizacion_estado', 'consulta_estado',
          'error_consulta_estado', 'error_respuesta_set', 'encolado_lote', 'envio_lote'
        ]
      },

      TipoEvento: {
        type: 'string',
        enum: [
          'cancelacion',
          'devolucion_ajuste',
          'conformidad',
          'disconformidad',
          'desconocimiento',
          'notificacion_recepcion'
        ],
        description: 'Emisor: cancelacion, devolucion_ajuste. Receptor: el resto.'
      },

      // ------------------------------ salud / auth ------------------------------
      SaludServicio: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          servicio: { type: 'string', example: 'dtepy-backend' },
          version: { type: 'string', example: version },
          mongo: {
            type: 'string',
            enum: ['desconectado', 'conectado', 'conectando', 'desconectando'],
            description: 'Estado de la conexión a MongoDB'
          },
          fecha: { type: 'string', format: 'date-time' }
        }
      },

      Usuario: {
        type: 'object',
        properties: {
          id: objectId(),
          username: { type: 'string', example: 'fabian' },
          email: { type: 'string', format: 'email' },
          nombre: { type: 'string' },
          apellido: { type: 'string' },
          rol: { type: 'string', enum: ['admin', 'usuario', 'contador'] }
        }
      },

      PerfilUsuario: {
        allOf: [
          ref('Usuario'),
          {
            type: 'object',
            properties: {
              activo: { type: 'boolean' },
              ultimoAcceso: fechaHora(),
              fechaCreacion: fechaHora()
            }
          }
        ]
      },

      LoginRespuesta: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Login exitoso' },
          data: {
            type: 'object',
            properties: {
              usuario: ref('Usuario'),
              token: { type: 'string', description: 'JWT para la cabecera Authorization', example: 'eyJhbGciOiJIUzI1NiIs...' }
            }
          }
        }
      },

      // ------------------------------ api keys ------------------------------
      ApiKeyResumen: {
        type: 'object',
        properties: {
          id: objectId(),
          nombre: { type: 'string', example: 'Integración ERPNext' },
          descripcion: { type: 'string' },
          permisos: {
            type: 'array',
            items: { type: 'string', enum: ['facturas:crear', 'facturas:leer', 'facturas:eliminar', 'stats:leer', 'admin'] }
          },
          activa: { type: 'boolean' },
          expiracion: fechaHora('null = no vence'),
          ultimoUso: fechaHora(),
          fechaCreacion: fechaHora(),
          keyParcial: {
            type: 'string',
            example: 'a1b2c3d4...e5f6a7b8',
            description: 'Prefijo y sufijo para identificarla; la clave completa no se puede recuperar'
          }
        }
      },

      ApiKeyCreada: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              id: objectId(),
              key: {
                type: 'string',
                example: '3f9c2b8e71a4d5f6b0c9e8d7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7',
                description: '⚠️ Única vez que se muestra: no queda guardada en la base'
              },
              nombre: { type: 'string' },
              descripcion: { type: 'string' },
              permisos: { type: 'array', items: { type: 'string' } },
              expiracion: fechaHora(),
              fechaCreacion: fechaHora()
            }
          },
          advertencia: { type: 'string', example: 'Guarda esta API Key en un lugar seguro. No podrás verla nuevamente.' }
        }
      },

      // ------------------------------ facturación ------------------------------
      FacturaEncolada: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Factura encolada para procesamiento asíncrono' },
          data: {
            type: 'object',
            properties: {
              facturaId: objectId(),
              correlativo: { type: 'string', example: '001-001-0000060' },
              estado: ref('EstadoSifen'),
              proceso: ref('Proceso'),
              cdc: { type: 'string', nullable: true, description: '44 dígitos; null hasta que se firma el XML' },
              jobId: { type: 'string', example: 'factura-68ae1f2b9c3d4e5f6a7b8c9d' },
              xmlLink: { type: 'string', format: 'uri' },
              kudeLink: { type: 'string', format: 'uri' },
              urls: {
                type: 'object',
                properties: {
                  estado: { type: 'string', example: '/api/factura/estado/68ae1f2b9c3d4e5f6a7b8c9d' },
                  consulta: { type: 'string', example: '/api/invoices/68ae1f2b9c3d4e5f6a7b8c9d' }
                }
              },
              reintentando: { type: 'boolean', description: 'Presente cuando el correlativo ya existía en error y se reintenta' },
              kudeJobId: { type: 'string', description: 'Presente cuando la factura ya estaba aprobada y solo se regenera el PDF' }
            }
          }
        }
      },

      EmpresaEmisora: {
        type: 'object',
        description: 'Vista mínima de la empresa para integraciones',
        properties: {
          ruc: { type: 'string', example: '80055783-2' },
          nombreFantasia: { type: 'string', example: 'Kingston Center' },
          razonSocial: { type: 'string', example: 'Kingston Center S.A.' },
          tieneCertificadoValido: { type: 'boolean' },
          activo: { type: 'boolean' }
        }
      },

      EstadoFacturaCola: {
        type: 'object',
        properties: {
          facturaId: objectId(),
          correlativo: { type: 'string', example: '001-001-0000060' },
          estado: ref('EstadoSifen'),
          cdc: { type: 'string', nullable: true },
          codigoRetorno: { type: 'string', nullable: true, example: '0260', description: 'Código de respuesta de SET (0260 = aprobado)' },
          mensajeRetorno: { type: 'string', nullable: true },
          fechaCreacion: fechaHora(),
          fechaEnvio: fechaHora(),
          tipoEmision: { type: 'integer', example: 1 },
          grupoLoteId: { ...objectId('Lote al que pertenece, si se envía por lotes'), nullable: true },
          proceso: ref('Proceso'),
          job: {
            type: 'object',
            description: 'Estado del trabajo en la cola de Bull',
            properties: {
              status: {
                type: 'string',
                nullable: true,
                enum: ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused', null],
                description: 'null si el trabajo ya no está en la cola'
              },
              progress: { type: 'integer', minimum: 0, maximum: 100, example: 100 },
              attempts: { type: 'integer', example: 1 },
              failedReason: { type: 'string', nullable: true }
            }
          }
        }
      },

      // ------------------------------ facturas ------------------------------
      FacturaResumen: {
        type: 'object',
        description: 'Documento de factura como viene de la base, con alias de compatibilidad',
        properties: {
          _id: objectId(),
          empresaId: objectId('Empresa emisora'),
          rucEmpresa: { type: 'string', example: '80055783-2' },
          correlativo: { type: 'string', example: '001-001-0000060' },
          cdc: { type: 'string', nullable: true },
          estadoSifen: ref('EstadoSifen'),
          estado: { allOf: [ref('EstadoSifen')], description: 'Alias de estadoSifen' },
          estadoVisual: { type: 'string', description: 'Estado simplificado para la UI', example: 'aceptado' },
          proceso: ref('Proceso'),
          de: { type: 'string', description: 'Descripción del tipo de documento', example: 'Factura electrónica' },
          cliente: {
            type: 'object',
            properties: {
              ruc: { type: 'string' },
              nombre: { type: 'string' }
            },
            additionalProperties: true
          },
          total: { type: 'number', example: 1500000 },
          codigoRetorno: { type: 'string', nullable: true },
          mensajeRetorno: { type: 'string', nullable: true },
          digestValue: { type: 'string', nullable: true },
          xmlPath: { type: 'string', nullable: true },
          kudePath: { type: 'string', nullable: true },
          grupoLoteId: { ...objectId(), nullable: true },
          fechaCreacion: fechaHora(),
          fechaEnvio: fechaHora(),
          fechaProceso: fechaHora('Fecha de resolución en SET'),
          createdAt: fechaHora(),
          updatedAt: fechaHora()
        },
        additionalProperties: true
      },

      ListadoFacturas: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          invoices: { type: 'array', items: ref('FacturaResumen') },
          totalPages: { type: 'integer', example: 8 },
          currentPage: { type: 'integer', example: 1 },
          total: { type: 'integer', example: 73 }
        }
      },

      FacturaDetalle: {
        type: 'object',
        properties: {
          facturaId: objectId(),
          correlativo: { type: 'string', example: '001-001-0000060' },
          cdc: { type: 'string', nullable: true },
          estado: ref('EstadoSifen'),
          proceso: ref('Proceso'),
          estadoVisual: { type: 'string', example: 'aceptado' },
          esEstadoFinal: { type: 'boolean', description: 'aceptado/rechazado/error/observado no cambian más' },
          recomendarRefresh: { type: 'boolean', description: 'true si conviene consultar el estado en SET' },
          xmlPath: { type: 'string', nullable: true },
          kudePath: { type: 'string', nullable: true },
          xmlLink: { type: 'string', format: 'uri', nullable: true },
          kudeLink: { type: 'string', format: 'uri', nullable: true },
          cliente: { type: 'object', additionalProperties: true },
          total: { type: 'number' },
          fechaCreacion: fechaHora(),
          fechaEnvio: fechaHora(),
          fechaProceso: fechaHora(),
          codigoRetorno: { type: 'string', nullable: true, example: '0260' },
          mensajeRetorno: { type: 'string', nullable: true },
          digestValue: { type: 'string', nullable: true },
          qrCode: { type: 'string', nullable: true, description: 'URL del QR impreso en el KUDE' },
          datosFactura: { type: 'object', nullable: true, description: 'JSON original con el que se emitió', additionalProperties: true },
          xmlContent: { type: 'string', nullable: true, description: 'XML firmado completo' },
          de: { type: 'string', example: 'Factura electrónica' },
          tipoEmision: { type: 'integer', example: 1 },
          grupoLoteId: { ...objectId(), nullable: true }
        }
      },

      BusquedaPorCdc: {
        type: 'object',
        description: 'La fuente indica de dónde salió el resultado',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          encontrado: { type: 'boolean' },
          fuente: { type: 'string', enum: ['local', 'sifen'] },
          data: {
            type: 'object',
            description: 'Con fuente=local: resumen de la factura (FacturaResumen). Con fuente=sifen: { respuesta } cruda de SET.',
            additionalProperties: true
          }
        }
      },

      EstadoSegunSet: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          encontrado: { type: 'boolean' },
          cdc: { type: 'string' },
          estadoLocal: ref('EstadoSifen'),
          estadoSET: { type: 'string', nullable: true, description: 'Estado del documento según la consulta a SET' },
          actualizado: { type: 'boolean', description: 'true si el estado local se actualizó con esta consulta' }
        },
        additionalProperties: true
      },

      RefreshEstado: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          esEstadoFinal: { type: 'boolean' },
          consultoSET: { type: 'boolean', description: 'false si no hizo falta consultar (estado final)' },
          estadoAnterior: ref('EstadoSifen'),
          estadoNuevo: { allOf: [ref('EstadoSifen')], description: 'Presente si consultó a SET' }
        },
        additionalProperties: true
      },

      // ------------------------------ logs ------------------------------
      LogOperacion: {
        type: 'object',
        properties: {
          _id: objectId(),
          invoiceId: {
            type: 'object',
            nullable: true,
            description: 'Factura relacionada (populada), o null en operaciones globales',
            properties: {
              _id: objectId(),
              correlativo: { type: 'string' },
              cdc: { type: 'string', nullable: true },
              estadoSifen: ref('EstadoSifen')
            }
          },
          tipoOperacion: ref('TipoOperacion'),
          descripcion: { type: 'string', example: 'XML firmado exitosamente' },
          estado: { type: 'string', enum: ['success', 'error', 'warning'] },
          fecha: fechaHora(),
          detalle: { type: 'object', nullable: true, description: 'Contexto adicional de la operación', additionalProperties: true }
        }
      },

      ListadoLogs: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          logs: { type: 'array', items: ref('LogOperacion') },
          total: { type: 'integer', example: 320 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 15 },
          totalPages: { type: 'integer', example: 22 }
        }
      },

      // ------------------------------ eventos ------------------------------
      Evento: {
        type: 'object',
        properties: {
          _id: objectId(),
          tipoEvento: ref('TipoEvento'),
          cdc: { type: 'string' },
          correlativo: { type: 'string' },
          invoiceId: {
            type: 'object',
            nullable: true,
            description: 'Factura relacionada (populada en algunos endpoints)',
            properties: {
              _id: objectId(),
              correlativo: { type: 'string' },
              cdc: { type: 'string' },
              estadoSifen: ref('EstadoSifen')
            }
          },
          empresaId: {
            type: 'object',
            nullable: true,
            description: 'Empresa emisora (populada en algunos endpoints)',
            properties: {
              _id: objectId(),
              ruc: { type: 'string' },
              nombreFantasia: { type: 'string' }
            }
          },
          descripcion: { type: 'string', description: 'Motivo declarado del evento' },
          estadoEvento: { type: 'string', enum: ['enviado', 'registrado', 'rechazado', 'error'] },
          codigoRetorno: { type: 'string', nullable: true },
          mensajeRetorno: { type: 'string', nullable: true },
          idEventoSET: { type: 'string', nullable: true, description: 'Identificador que asigna SET al registrar el evento' },
          fechaRegistro: fechaHora(),
          createdAt: fechaHora()
        },
        additionalProperties: true
      },

      ResultadoEvento: {
        type: 'object',
        properties: {
          eventoId: objectId('ID del evento guardado'),
          idEventoSET: { type: 'string', nullable: true },
          codigoRetorno: { type: 'string', nullable: true, example: '0600', description: '0600/0601 = evento registrado' },
          mensajeRetorno: { type: 'string', nullable: true },
          estadoEvento: { type: 'string', enum: ['enviado', 'registrado', 'rechazado', 'error'] },
          tipoEvento: ref('TipoEvento'),
          cdc: { type: 'string' },
          correlativo: { type: 'string' }
        }
      },

      // ------------------------------ lotes ------------------------------
      Lote: {
        type: 'object',
        properties: {
          _id: objectId(),
          empresaId: {
            type: 'object',
            description: 'Empresa emisora (populada)',
            properties: {
              _id: objectId(),
              ruc: { type: 'string' },
              nombreFantasia: { type: 'string' },
              razonSocial: { type: 'string' }
            }
          },
          tipoDocumento: { type: 'string', example: 'factura' },
          descripcion: { type: 'string' },
          ambiente: { type: 'string', enum: ['test', 'produccion'] },
          estado: { type: 'string', enum: ['en_espera', 'enviado', 'procesando', 'completado', 'error'] },
          count: { type: 'integer', description: 'Cantidad de facturas del lote' },
          facturas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                facturaId: {
                  type: 'object',
                  description: 'Factura del lote (populada)',
                  properties: {
                    _id: objectId(),
                    correlativo: { type: 'string' },
                    cdc: { type: 'string', nullable: true },
                    estadoSifen: ref('EstadoSifen')
                  }
                },
                estadoIndividual: {
                  type: 'string',
                  enum: ['pendiente', 'aceptado', 'rechazado', 'observado', 'error'],
                  description: 'Resultado de esta factura dentro del lote'
                }
              }
            }
          },
          createdAt: fechaHora(),
          updatedAt: fechaHora()
        },
        additionalProperties: true
      },

      // ------------------------------ cola ------------------------------
      ContadoresCola: {
        type: 'object',
        properties: {
          waiting: { type: 'integer', example: 2, description: 'En espera de un worker' },
          active: { type: 'integer', example: 1, description: 'Procesándose ahora' },
          completed: { type: 'integer', example: 148 },
          failed: { type: 'integer', example: 3 }
        }
      },

      ColaEstadisticas: {
        type: 'object',
        properties: {
          facturacion: ref('ContadoresCola'),
          kude: ref('ContadoresCola')
        }
      },

      TrabajoCola: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'factura-68ae1f2b9c3d4e5f6a7b8c9d' },
          queue: { type: 'string', enum: ['facturacion', 'kude'] },
          estado: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed'] },
          correlativo: { type: 'string', example: '001-001-0000060' },
          ruc: { type: 'string', description: 'RUC del cliente o emisor asociado al trabajo' },
          timestamp: { type: 'number', description: 'Epoch ms del último cambio de estado', example: 1787788748870 },
          error: { type: 'string', nullable: true, description: 'Motivo del fallo, si falló' },
          attempts: { type: 'integer', example: 1 }
        }
      },

      LimpiezaCola: {
        type: 'object',
        properties: {
          queue: { type: 'string', enum: ['facturacion', 'kude'], default: 'facturacion' },
          keep: { type: 'integer', default: 0, description: 'Cantidad de trabajos recientes a conservar' }
        }
      },

      ResultadoLimpieza: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string', example: 'Se eliminaron 148 trabajos de la cola facturacion' },
          data: {
            type: 'object',
            properties: {
              eliminados: { type: 'integer', example: 148 },
              queue: { type: 'string', enum: ['facturacion', 'kude'] }
            },
            additionalProperties: true
          }
        }
      },

      // ------------------------------ estadísticas ------------------------------
      ConteoPorEstado: {
        type: 'object',
        properties: {
          _id: { allOf: [ref('EstadoSifen')], description: 'El estado agrupado' },
          count: { type: 'integer', example: 25 }
        }
      },

      Estadisticas: {
        type: 'object',
        properties: {
          totalFacturas: { type: 'integer', example: 73 },
          facturasPorEstado: { type: 'array', items: ref('ConteoPorEstado') },
          facturasProcesando: { type: 'integer' },
          facturasEnviadas: { type: 'integer' },
          facturasError: { type: 'integer' },
          facturasRechazadas: { type: 'integer' },
          facturasAceptadas: { type: 'integer' },
          facturasHoy: { type: 'integer', example: 3 },
          ultimasFacturas: {
            type: 'array',
            description: 'Últimas 10, con campos resumidos',
            items: {
              type: 'object',
              properties: {
                _id: objectId(),
                correlativo: { type: 'string' },
                cdc: { type: 'string', nullable: true },
                estadoSifen: ref('EstadoSifen'),
                fechaCreacion: fechaHora(),
                total: { type: 'number' }
              }
            }
          },
          tendenciasPorDia: {
            type: 'array',
            description: 'Últimos 7 días',
            items: {
              type: 'object',
              properties: {
                _id: { type: 'string', example: '2026-08-26', description: 'Día (YYYY-MM-DD)' },
                count: { type: 'integer', example: 12 },
                total: { type: 'number', example: 18500000, description: 'Suma de montos del día' }
              }
            }
          },
          fechaUltimaConsulta: fechaHora(),
          uptime: { type: 'number', description: 'Segundos desde el arranque del proceso' },
          memoria: {
            type: 'object',
            description: 'process.memoryUsage() en bytes',
            properties: {
              rss: { type: 'integer' },
              heapTotal: { type: 'integer' },
              heapUsed: { type: 'integer' },
              external: { type: 'integer' }
            },
            additionalProperties: true
          }
        }
      },

      // ------------------------------ empresas ------------------------------
      Empresa: {
        type: 'object',
        description: 'Cuerpo para crear/actualizar una empresa',
        required: ['ruc', 'nombreFantasia', 'razonSocial'],
        properties: {
          ruc: {
            type: 'string',
            description: 'Con o sin guión, entre 6 y 12 dígitos',
            example: '80055783-2'
          },
          nombreFantasia: { type: 'string', example: 'Kingston Center' },
          razonSocial: { type: 'string', example: 'Kingston Center S.A.' },
          direccion: { type: 'string' },
          telefono: { type: 'string' },
          email: { type: 'string', format: 'email' },
          configuracionSifen: {
            type: 'object',
            properties: {
              timbrado: {
                type: 'string',
                maxLength: 8,
                description: 'Número de timbrado otorgado por SET',
                example: '12558946'
              },
              idCSC: { type: 'string', maxLength: 4, default: '0001' },
              csc: {
                type: 'string',
                minLength: 32,
                maxLength: 32,
                description: 'Código de Seguridad del Contribuyente. **Exactamente 32 caracteres**, lo entrega SET.'
              },
              modo: { type: 'string', enum: ['test', 'produccion'], default: 'test' },
              urlLogo: { type: 'string', format: 'uri', description: 'Logo que se imprime en el KUDE' },
              envioFacturas: {
                type: 'string',
                enum: ['normal', 'lotes'],
                default: 'normal',
                description: '`normal` envía cada documento por separado; `lotes` los agrupa'
              }
            }
          }
        }
      },

      EmpresaCompleta: {
        allOf: [
          ref('Empresa'),
          {
            type: 'object',
            description: 'Como la devuelve la API (la contraseña del certificado nunca se incluye)',
            properties: {
              _id: objectId(),
              usuarioId: objectId('Dueño de la empresa'),
              activo: { type: 'boolean' },
              certificado: {
                type: 'object',
                nullable: true,
                properties: {
                  nombreArchivo: { type: 'string', example: 'kingston-f1.p12' },
                  fechaVencimiento: fechaHora(),
                  fechaCarga: fechaHora(),
                  activo: { type: 'boolean' }
                }
              },
              certificadoEnFileSystem: {
                type: 'boolean',
                description: 'true si el archivo .p12 existe físicamente en el volumen'
              },
              createdAt: fechaHora(),
              updatedAt: fechaHora()
            }
          }
        ]
      },

      ValidacionCertificado: {
        type: 'object',
        properties: {
          tieneCertificado: { type: 'boolean', description: 'Metadatos completos y vigente' },
          certificadoActivo: { type: 'boolean' },
          certificadoEnFileSystem: { type: 'boolean', description: 'El archivo .p12 existe en el volumen' },
          fechaVencimiento: fechaHora(),
          fechaCarga: fechaHora(),
          nombreArchivo: { type: 'string', nullable: true },
          infoAdicional: {
            type: 'object',
            nullable: true,
            description: 'Detalle del archivo en disco (tamaño, ruta)',
            additionalProperties: true
          }
        }
      },

      EstadisticasEmpresa: {
        type: 'object',
        properties: {
          empresa: {
            type: 'object',
            properties: {
              nombreFantasia: { type: 'string' },
              ruc: { type: 'string' }
            }
          },
          totalFacturas: { type: 'integer' },
          facturasPorEstado: { type: 'array', items: ref('ConteoPorEstado') },
          ultimaFactura: {
            type: 'object',
            nullable: true,
            properties: {
              _id: objectId(),
              fechaCreacion: fechaHora(),
              correlativo: { type: 'string' }
            }
          }
        }
      },

      // ------------------------------ solicitud de factura ------------------------------
      SolicitudFactura: {
        type: 'object',
        required: ['param', 'data'],
        description: 'Estructura del DTE según el Manual Técnico SIFEN v150. `param` describe al emisor y `data` al documento.',
        properties: {
          param: {
            type: 'object',
            description: 'Datos del emisor y del timbrado',
            properties: {
              version: { type: 'integer', default: 150 },
              ruc: { type: 'string', example: '80069563-1', description: 'RUC del emisor; debe existir como empresa activa del alcance' },
              razonSocial: { type: 'string' },
              nombreFantasia: { type: 'string' },
              timbradoNumero: { type: 'string', example: '12558946' },
              timbradoFecha: { type: 'string', format: 'date', example: '2022-08-25' },
              tipoContribuyente: { type: 'integer', example: 2 },
              tipoRegimen: { type: 'integer', example: 8 },
              actividadesEconomicas: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    codigo: { type: 'string' },
                    descripcion: { type: 'string' }
                  }
                }
              },
              establecimientos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    codigo: { type: 'string', example: '001' },
                    direccion: { type: 'string' },
                    numeroCasa: { type: 'string' },
                    departamento: { type: 'integer' },
                    departamentoDescripcion: { type: 'string' },
                    distrito: { type: 'integer' },
                    distritoDescripcion: { type: 'string' },
                    ciudad: { type: 'integer' },
                    ciudadDescripcion: { type: 'string' },
                    telefono: { type: 'string' },
                    email: { type: 'string', format: 'email' }
                  }
                }
              }
            }
          },
          data: {
            type: 'object',
            description: 'Datos del documento a emitir',
            properties: {
              tipoDocumento: { type: 'integer', example: 1, description: '1 = Factura electrónica' },
              establecimiento: { type: 'string', example: '001' },
              punto: { type: 'string', example: '001' },
              numero: { type: 'string', example: '0000060' },
              fecha: { type: 'string', format: 'date-time' },
              tipoEmision: { type: 'integer', example: 1 },
              tipoTransaccion: { type: 'integer', example: 1 },
              tipoImpuesto: { type: 'integer', example: 1 },
              moneda: { type: 'string', example: 'PYG' },
              condicionAnticipo: { type: 'integer' },
              condicionTipoCambio: { type: 'integer' },
              descuentoGlobal: { type: 'number' },
              cliente: {
                type: 'object',
                properties: {
                  contribuyente: { type: 'boolean' },
                  ruc: { type: 'string' },
                  razonSocial: { type: 'string' },
                  nombreFantasia: { type: 'string' },
                  tipoOperacion: { type: 'integer' },
                  direccion: { type: 'string' },
                  numeroCasa: { type: 'string' },
                  departamento: { type: 'integer' },
                  distrito: { type: 'integer' },
                  ciudad: { type: 'integer' },
                  pais: { type: 'string', example: 'PRY' },
                  tipoContribuyente: { type: 'integer' },
                  documentoTipo: { type: 'integer' },
                  documentoNumero: { type: 'string' },
                  telefono: { type: 'string' },
                  celular: { type: 'string' },
                  email: { type: 'string', format: 'email' }
                }
              },
              condicion: {
                type: 'object',
                description: 'Forma de pago (contado o crédito)',
                properties: {
                  tipo: { type: 'integer', example: 1, description: '1 = contado, 2 = crédito' },
                  entregas: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        tipo: { type: 'integer' },
                        monto: { type: 'string' },
                        moneda: { type: 'string' }
                      }
                    }
                  }
                }
              },
              items: {
                type: 'array',
                description: 'Ítems del documento',
                items: {
                  type: 'object',
                  properties: {
                    codigo: { type: 'string' },
                    descripcion: { type: 'string' },
                    unidadMedida: { type: 'integer', example: 77 },
                    cantidad: { type: 'number' },
                    precioUnitario: { type: 'number' },
                    cambio: { type: 'number' },
                    ivaTipo: { type: 'integer', example: 1 },
                    ivaBase: { type: 'number', example: 100 },
                    iva: { type: 'integer', example: 10 }
                  }
                }
              },
              templateFactura: {
                type: 'string',
                enum: ['normal', 'ticket'],
                default: 'normal',
                description: 'Plantilla del KUDE: `ticket` usa el formato angosto'
              }
            }
          }
        }
      }
    }
  }
};
