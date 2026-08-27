/**
 * Especificación OpenAPI 3.0 de la API de DTE-PY.
 *
 * Se sirve en /api/docs (Swagger UI) y en /api/openapi.json (JSON crudo).
 *
 * Escrita a mano contra las rutas reales: al agregar o cambiar un endpoint,
 * actualizar también este archivo.
 */

const { version } = require('../package.json');

// ---------------------------------------------------------------------------
// Respuestas y parámetros reutilizables
// ---------------------------------------------------------------------------

const respuestaError = (descripcion) => ({
  description: descripcion,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' }
    }
  }
});

const NO_AUTORIZADO = respuestaError('Token o API Key ausentes, inválidos o expirados');
const NO_ENCONTRADO = respuestaError('El recurso no existe');
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
      schema: schema || { $ref: '#/components/schemas/RespuestaOk' }
    }
  }
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
          200: okJson('El servicio responde', {
            type: 'object',
            properties: {
              ok: { type: 'boolean', example: true },
              servicio: { type: 'string', example: 'dtepy-backend' },
              version: { type: 'string', example: '1.0.0' },
              mongo: {
                type: 'string',
                enum: ['desconectado', 'conectado', 'conectando', 'desconectando'],
                description: 'Estado de la conexión a MongoDB'
              },
              fecha: { type: 'string', format: 'date-time' }
            }
          })
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
        description: 'Público. Devuelve el JWT que se usa como `Bearer` en el resto de la API.',
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
          200: okJson('Sesión iniciada', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  token: { type: 'string', description: 'JWT' },
                  usuario: { $ref: '#/components/schemas/Usuario' }
                }
              }
            }
          }),
          401: respuestaError('Credenciales inválidas o usuario inactivo')
        }
      }
    },

    '/api/auth/perfil': {
      get: {
        tags: ['Autenticación'],
        summary: 'Obtener el perfil del usuario autenticado',
        responses: { 200: okJson('Perfil'), 401: NO_AUTORIZADO }
      },
      put: {
        tags: ['Autenticación'],
        summary: 'Actualizar el perfil',
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
        responses: { 200: okJson('Perfil actualizado'), 401: NO_AUTORIZADO }
      }
    },

    '/api/auth/cambiar-password': {
      post: {
        tags: ['Autenticación'],
        summary: 'Cambiar la contraseña',
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
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/auth/logout': {
      post: {
        tags: ['Autenticación'],
        summary: 'Cerrar sesión',
        description: 'El JWT no se invalida del lado del servidor: el cliente debe descartarlo.',
        responses: { 200: okJson('Sesión cerrada'), 401: NO_AUTORIZADO }
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
        responses: { 200: okJson('Listado'), 401: NO_AUTORIZADO }
      },
      post: {
        tags: ['API Keys'],
        summary: 'Crear una API Key',
        description: '⚠️ La clave en texto plano se devuelve **una sola vez**, en esta respuesta. Después solo queda su hash: no hay forma de volver a verla.',
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
          201: okJson('API Key creada (única vez que se ve la clave)', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  key: { type: 'string', description: 'Clave en texto plano — guardala ahora' },
                  nombre: { type: 'string' },
                  permisos: { type: 'array', items: { type: 'string' } }
                }
              },
              advertencia: { type: 'string' }
            }
          }),
          400: respuestaError('Falta el nombre'),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/api-keys/{id}': {
      get: {
        tags: ['API Keys'],
        summary: 'Detalle de una API Key',
        parameters: [paramRuta('id', 'ID de la API Key')],
        responses: { 200: okJson('Detalle'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      },
      delete: {
        tags: ['API Keys'],
        summary: 'Revocar una API Key',
        parameters: [paramRuta('id', 'ID de la API Key')],
        responses: { 200: okJson('Revocada'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/api-keys/{id}/renew': {
      put: {
        tags: ['API Keys'],
        summary: 'Renovar una API Key',
        description: 'Genera una clave nueva manteniendo nombre y permisos. **La anterior deja de funcionar de inmediato.** La nueva se muestra una sola vez.',
        parameters: [paramRuta('id', 'ID de la API Key')],
        responses: { 200: okJson('Renovada'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
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
empresa cargada y activa, con certificado válido.
`.trim(),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SolicitudFactura' }
            }
          }
        },
        responses: {
          202: okJson('Encolada para procesamiento', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  facturaId: { type: 'string' },
                  correlativo: { type: 'string', example: '001-001-0000060' },
                  estado: { type: 'string', example: 'encolado' },
                  cdc: { type: 'string', nullable: true },
                  xmlLink: { type: 'string', format: 'uri' },
                  kudeLink: { type: 'string', format: 'uri' },
                  urls: {
                    type: 'object',
                    properties: {
                      estado: { type: 'string' },
                      consulta: { type: 'string' }
                    }
                  }
                }
              }
            }
          }),
          400: respuestaError('Datos inválidos o empresa sin certificado'),
          401: NO_AUTORIZADO,
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
          200: okJson('Empresa encontrada'),
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
        description: 'Devuelve el estado en la cola y en SIFEN. Es el endpoint a consultar tras un `202` de `/api/facturar/crear`.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: { 200: okJson('Estado'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
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
            schema: { $ref: '#/components/schemas/EstadoSifen' },
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
            description: 'Texto a buscar (se interpreta según `searchType`)'
          },
          {
            name: 'searchType',
            in: 'query',
            schema: { type: 'string', enum: ['ruc', 'nombre', 'cdc', 'tipo', 'id'] },
            description: 'Campo sobre el que aplica `search`: RUC o nombre del cliente, CDC, tipo de documento, o ID'
          }
        ],
        responses: { 200: okJson('Listado paginado'), 401: NO_AUTORIZADO }
      }
    },

    '/api/invoices/cdc/{cdc}': {
      get: {
        tags: ['Facturas'],
        summary: 'Buscar una factura por CDC',
        parameters: [paramRuta('cdc', 'Código de Control (44 dígitos)')],
        responses: { 200: okJson('Factura'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/invoices/estado/{cdc}': {
      get: {
        tags: ['Facturas'],
        summary: 'Consultar el estado de un CDC directamente en SET',
        description: 'Va contra los servicios de la SET, no contra la base local.',
        parameters: [paramRuta('cdc', 'Código de Control (44 dígitos)')],
        responses: { 200: okJson('Estado según SET'), 401: NO_AUTORIZADO, 500: ERROR_SERVIDOR }
      }
    },

    '/api/invoices/logs': {
      get: {
        tags: ['Facturas'],
        summary: 'Logs de operaciones de facturas',
        parameters: [
          ...paramPagina,
          { name: 'tipo', in: 'query', schema: { $ref: '#/components/schemas/TipoOperacion' } },
          { name: 'estado', in: 'query', schema: { type: 'string', enum: ['success', 'error', 'warning'] } }
        ],
        responses: { 200: okJson('Listado paginado'), 401: NO_AUTORIZADO }
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
          200: okJson('Facturas eliminadas'),
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
        responses: { 200: okJson('Factura'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      },
      delete: {
        tags: ['Facturas'],
        summary: 'Eliminar una factura',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: { 200: okJson('Eliminada'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/invoices/{id}/logs': {
      get: {
        tags: ['Facturas'],
        summary: 'Logs de una factura',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: { 200: okJson('Logs'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/invoices/{id}/eventos': {
      get: {
        tags: ['Facturas'],
        summary: 'Eventos SIFEN de una factura',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: { 200: okJson('Eventos'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/invoices/{id}/retry': {
      post: {
        tags: ['Facturas'],
        summary: 'Reintentar el envío a SIFEN',
        description: 'Vuelve a encolar una factura que quedó en error.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: { 200: okJson('Reencolada'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/invoices/{id}/refresh-status': {
      post: {
        tags: ['Facturas'],
        summary: 'Refrescar el estado desde SET',
        description: 'Consulta el CDC en SET y actualiza el estado local.',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: { 200: okJson('Estado actualizado'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/invoices/{id}/download-xml': {
      get: {
        tags: ['Facturas'],
        summary: 'Descargar el XML firmado',
        parameters: [paramRuta('id', 'ID de la factura')],
        responses: {
          200: {
            description: 'XML firmado',
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
            description: 'KUDE en PDF',
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
        responses: { 200: okJson('Listado'), 401: NO_AUTORIZADO }
      },
      post: {
        tags: ['Empresas'],
        summary: 'Crear una empresa',
        description: 'Solo con sesión JWT (las mutaciones de empresas no se permiten con API Key). El certificado digital se sube aparte, con `POST /api/empresas/{id}/certificado`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Empresa' }
            }
          }
        },
        responses: {
          201: okJson('Empresa creada'),
          400: respuestaError('Faltan campos requeridos o el RUC/CSC no cumple el formato'),
          401: NO_AUTORIZADO
        }
      }
    },

    '/api/empresas/{id}': {
      get: {
        tags: ['Empresas'],
        summary: 'Detalle de una empresa',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: { 200: okJson('Empresa'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      },
      put: {
        tags: ['Empresas'],
        summary: 'Actualizar una empresa',
        parameters: [paramRuta('id', 'ID de la empresa')],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Empresa' } } }
        },
        responses: { 200: okJson('Actualizada'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      },
      delete: {
        tags: ['Empresas'],
        summary: 'Eliminar una empresa',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: { 200: okJson('Eliminada'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/empresas/{id}/certificado': {
      post: {
        tags: ['Empresas'],
        summary: 'Subir el certificado digital (.p12)',
        description: `
Sube el certificado F1 emitido por un Prestador Cualificado de Servicios de
Confianza. Solo se aceptan archivos \`.p12\`, hasta 5 MB.

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
          200: okJson('Certificado cargado'),
          400: respuestaError('Archivo no es .p12, supera 5 MB, o la contraseña no abre el certificado'),
          401: NO_AUTORIZADO,
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
        responses: { 200: okJson('Resultado de la validación'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/empresas/{id}/stats': {
      get: {
        tags: ['Empresas'],
        summary: 'Estadísticas de una empresa',
        parameters: [paramRuta('id', 'ID de la empresa')],
        responses: { 200: okJson('Estadísticas'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
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
                  invoiceId: { type: 'string', description: 'ID de la factura' },
                  tipoEvento: { $ref: '#/components/schemas/TipoEvento' },
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
          200: okJson('Evento enviado a SET'),
          400: respuestaError('Faltan campos, el tipo no es válido, o la factura no está aprobada'),
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
          { name: 'tipoEvento', in: 'query', schema: { $ref: '#/components/schemas/TipoEvento' } },
          {
            name: 'estadoEvento',
            in: 'query',
            schema: { type: 'string', enum: ['enviado', 'registrado', 'rechazado', 'error'] }
          },
          { name: 'cdc', in: 'query', schema: { type: 'string' } }
        ],
        responses: { 200: okJson('Listado paginado'), 401: NO_AUTORIZADO }
      }
    },

    '/api/eventos/factura/{invoiceId}': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Eventos de una factura',
        parameters: [paramRuta('invoiceId', 'ID de la factura')],
        responses: { 200: okJson('Eventos'), 401: NO_AUTORIZADO }
      }
    },

    '/api/eventos/cdc/{cdc}': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Eventos por CDC',
        parameters: [paramRuta('cdc', 'Código de Control')],
        responses: { 200: okJson('Eventos'), 401: NO_AUTORIZADO }
      }
    },

    '/api/eventos/{id}': {
      get: {
        tags: ['Eventos SIFEN'],
        summary: 'Detalle de un evento',
        parameters: [paramRuta('id', 'ID del evento')],
        responses: { 200: okJson('Evento'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
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
        responses: { 200: okJson('Listado paginado'), 401: NO_AUTORIZADO }
      }
    },

    '/api/lotes/{id}': {
      get: {
        tags: ['Lotes'],
        summary: 'Detalle de un lote',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: { 200: okJson('Lote'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      },
      delete: {
        tags: ['Lotes'],
        summary: 'Eliminar un lote',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: { 200: okJson('Eliminado'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/lotes/enviar/{id}': {
      post: {
        tags: ['Lotes'],
        summary: 'Enviar un lote a SET',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: { 200: okJson('Lote enviado'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
      }
    },

    '/api/lotes/enviar-pendientes': {
      post: {
        tags: ['Lotes'],
        summary: 'Enviar todos los lotes en espera',
        responses: { 200: okJson('Lotes enviados'), 401: NO_AUTORIZADO }
      }
    },

    '/api/lotes/consultar/{id}': {
      post: {
        tags: ['Lotes'],
        summary: 'Consultar el resultado de un lote en SET',
        parameters: [paramRuta('id', 'ID del lote')],
        responses: { 200: okJson('Resultado del lote'), 401: NO_AUTORIZADO, 404: NO_ENCONTRADO }
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
        responses: { 200: okJson('Estadísticas'), 401: NO_AUTORIZADO }
      }
    },

    '/api/queue/jobs': {
      get: {
        tags: ['Cola'],
        summary: 'Trabajos recientes',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: { 200: okJson('Trabajos'), 401: NO_AUTORIZADO }
      }
    },

    '/api/queue/clear': {
      post: {
        tags: ['Cola'],
        summary: 'Limpiar trabajos completados',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LimpiezaCola' } } } },
        responses: { 200: okJson('Cola limpiada'), 401: NO_AUTORIZADO }
      }
    },

    '/api/queue/clear-completed': {
      post: {
        tags: ['Cola'],
        summary: 'Limpiar trabajos completados',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LimpiezaCola' } } } },
        responses: { 200: okJson('Cola limpiada'), 401: NO_AUTORIZADO }
      }
    },

    '/api/queue/clear-failed': {
      post: {
        tags: ['Cola'],
        summary: 'Limpiar trabajos fallidos',
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
        responses: { 200: okJson('Cola limpiada'), 401: NO_AUTORIZADO }
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
        responses: { 200: okJson('Cola vaciada'), 401: NO_AUTORIZADO }
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
          { name: 'tipoOperacion', in: 'query', schema: { $ref: '#/components/schemas/TipoOperacion' } },
          { name: 'invoiceId', in: 'query', schema: { type: 'string' } }
        ],
        responses: { 200: okJson('Listado paginado'), 401: NO_AUTORIZADO }
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
          200: okJson('Logs eliminados'),
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
        description: 'Totales por estado, facturas del día, tendencia de los últimos 7 días y uptime del proceso.',
        responses: { 200: okJson('Estadísticas'), 401: NO_AUTORIZADO }
      }
    },

    '/api/consulta/ruc/{ruc}': {
      get: {
        tags: ['Consultas SET'],
        summary: 'Consultar un RUC en SET',
        description: 'Consulta el padrón de la SET para validar un RUC de cliente antes de facturarle.',
        parameters: [paramRuta('ruc', 'RUC a consultar')],
        responses: {
          200: okJson('Datos del contribuyente'),
          400: respuestaError('RUC requerido'),
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
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', description: 'Código de error', example: 'FACTURA_NOT_FOUND' },
          message: { type: 'string', description: 'Descripción legible' }
        }
      },

      RespuestaOk: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object' }
        }
      },

      Usuario: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          username: { type: 'string' },
          email: { type: 'string', format: 'email' },
          nombre: { type: 'string' },
          apellido: { type: 'string' },
          rol: { type: 'string', enum: ['admin', 'usuario', 'contador'] },
          activo: { type: 'boolean' }
        }
      },

      EstadoSifen: {
        type: 'string',
        enum: ['recibido', 'encolado', 'procesando', 'enviado', 'aceptado', 'observado', 'rechazado', 'error'],
        description: 'Estado del documento en SIFEN'
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

      LimpiezaCola: {
        type: 'object',
        properties: {
          queue: { type: 'string', enum: ['facturacion', 'kude'], default: 'facturacion' },
          keep: { type: 'integer', default: 0, description: 'Cantidad de trabajos recientes a conservar' }
        }
      },

      Empresa: {
        type: 'object',
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
              ruc: { type: 'string', example: '80069563-1', description: 'RUC del emisor; debe existir como empresa activa' },
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
