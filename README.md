# DTE-PY Backend - Sistema de Facturación Electrónica SIFEN

Proyecto backend del sistema de facturación electrónica para Paraguay (SIFEN) con procesamiento asíncrono mediante colas de trabajo.

## 📋 Descripción

API RESTful para generar XML-KUDE, firmar xml, insertar QR y enviar facturas electrónicas a la SET (Superintendencia de Tributación) bajo el sistema SIFEN.

**Características principales:**
- ✅ Procesamiento asíncrono con colas (Bull + Redis)
- ✅ Multi-empresa (cada empresa con su propia configuración SIFEN)
- ✅ Firma digital de XML con certificados .p12
- ✅ Reintentos automáticos en caso de error

## 🏗️ Arquitectura

```
┌──────────┐      ┌─────────────┐      ┌──────────────┐
│  Cliente │─────▶│   Backend   │─────▶│    Redis     │
│  (API)   │      │  (Express)  │      │   (Bull)     │
└──────────┘      └─────────────┘      └──────┬───────┘
                                              │
                    ┌─────────────────────────┘
                    ▼
             ┌─────────────┐
             │   Worker    │
             │ (Procesador)│
             └─────────────┘
```

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 14+
- MongoDB 4.4.30+
- Redis 7.0+
- Java 8+ (para generación de KUDE/PDF)

### Instalación

```bash
# Clonar repositorio
git clone https://github.com/jaranetwork/dtepy-backend.git
cd dtepy-backend

# Instalar dependencias
npm install

# Aplicar parches a librerías
node patch-kude.js

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales
```

### Ejecución

```bash
# Iniciar Redis (si no está corriendo)
redis-server --daemonize yes

# Iniciar backend + worker juntos
npm run start:all

# O por separado:
# Terminal 1 - Backend
npm start

# Terminal 2 - Worker
npm run worker
```

## 📡 Endpoints Principales

### Enviar Factura (Asíncrono)

```bash
POST /api/facturar/crear
Authorization: Bearer <API_KEY>

{
  "param": {
  "version" : 150,
  "ruc" : "80069563-1",
  "razonSocial" : "DE generado en ambiente de prueba - sin valor comercial ni fiscal",
  "nombreFantasia" : "TEST EMPRESA",
  "actividadesEconomicas" : [{
    "codigo": "1254",
    "descripcion": "Desarrollo de Software",
  }],   
  "timbradoNumero" : "12558946",
  "timbradoFecha" : "2022-08-25",
  "tipoContribuyente" : 2, 
  "tipoRegimen" : 8, 
  "establecimientos" : [{
    "codigo" : "001",
    "direccion" : "Barrio Carolina", 
    "numeroCasa" : "0", 
    "complementoDireccion1" : "Entre calle 2", 
    "complementoDireccion2" : "y Calle 7",
    "departamento" : 11,
    "departamentoDescripcion" : "ALTO PARANA",
    "distrito" : 145,
    "distritoDescripcion" : "CIUDAD DEL ESTE",
    "ciudad" : 3432,
    "ciudadDescripcion" : "PUERTO PTE.STROESSNER (MUNIC)",
    "telefono" : "0973-527155",
    "email" : "test@test.com.py, test2@gmail.com",
    "denominacion" : "Sucursal 1",
  }]
  },
  
  "data": {
    "tipoDocumento" : 1,
    "establecimiento" : "001",
    "codigoSeguridadAleatorio" : "298398",
    "punto" : "001",
    "numero" : "0000001", 
    "descripcion" : "Aparece en el documento",
    "observacion" : "Cualquier informacion de marketing, publicidad, sorteos, promociones para el Receptor",
    "fecha" : "2022-08-14T10:11:00",
    "tipoEmision" : 1,
    "tipoTransaccion" : 1,
    "tipoImpuesto" : 1,
    "moneda" : "PYG",
    "condicionAnticipo" : 1,
    "condicionTipoCambio": 1,
    "descuentoGlobal": 0,
    "anticipoGlobal": 0,
    "cambio": 6700,
    "cliente" : {
        "contribuyente" : true,
        "ruc" : "2005001-1",
        "razonSocial" : "Marcos Adrian Jara Rodriguez",
        "nombreFantasia" : "Marcos Adrian Jara Rodriguez",
        "tipoOperacion" : 1,
        "direccion" : "Avda Calle Segunda y Proyectada",
        "numeroCasa" : "1515",
        "departamento" : 11,
        "departamentoDescripcion" : "ALTO PARANA",
        "distrito" : 143,
        "distritoDescripcion" : "DOMINGO MARTINEZ DE IRALA",
        "ciudad" : 3344,
        "ciudadDescripcion" : "PASO ITA (INDIGENA)",
        "pais" : "PRY",
        "paisDescripcion" : "Paraguay",
        "tipoContribuyente" : 1,
        "documentoTipo" : 1,
        "documentoNumero" : "2324234",
        "telefono" : "061-575903",
        "celular" : "0973-809103",
        "email" : "cliente@empresa.com, cliente@personal.com",
        "codigo" : "1548"
    },
    "usuario" : {
        "documentoTipo" : 1,
        "documentoNumero" : "157264",
        "nombre" : "Marcos Jara",
        "cargo" : "Vendedor"
    },
    "factura" : {
        "presencia" : 1,
        "fechaEnvio" : "2023-10-21",
        "dncp" : {
            "modalidad" : "ABC",
            "entidad" : 1,
            "año" : 2021,
            "secuencia" : 3377,
            "fecha" : "2022-09-14T10:11:00"
        }
    },
    "autoFactura" : {
        "tipoVendedor" : 1,
        "documentoTipo" : 1,
        "documentoNumero" : 1,
        "nombre" : "Vendedor autofactura",
        "direccion" : "Vendedor autofactura",
        "numeroCasa" : "Vendedor autofactura",
        "departamento" : 11,
        "departamentoDescripcion" : "ALTO PARANA",
        "distrito" : 143,
        "distritoDescripcion" : "DOMINGO MARTINEZ DE IRALA",
        "ciudad" : 3344,
        "ciudadDescripcion" : "PASO ITA (INDIGENA)",
        "transaccion" : {
            "lugar" : "Donde se realiza la transaccion",
            "departamento" : 11,
            "departamentoDescripcion" : "ALTO PARANA",
            "distrito" : 143,
            "distritoDescripcion" : "DOMINGO MARTINEZ DE IRALA",
            "ciudad" : 3344,
            "ciudadDescripcion" : "PASO ITA (INDIGENA)"
        }
    },
    "notaCreditoDebito" : {
        "motivo" : 1
    },
    "remision" : {
        "motivo" : 1,
        "tipoResponsable" : 1, 
        "kms" : 150,
        "fechaFactura" : "2022-08-21"
    },
    "condicion" : {
        "tipo" : 1,
        "entregas" : [{ 
            "tipo" : 1,
            "monto" : "150000",
            "moneda" : "PYG",
            "cambio" : 0
        }, { 
            "tipo" : 3,
            "monto" : "150000",
            "moneda" : "PYG",
            "cambio" : 0,
            "infoTarjeta" : {
                "tipo" : 1,
                "tipoDescripcion" : "Dinelco",
                "titular" : "Marcos Jara",
                "ruc" : "6969549654-1",
                "razonSocial" : "Bancard",
                "medioPago" : 1,
                "codigoAutorizacion" : 232524234
            }
        }, { 
            "tipo" : 2,
            "monto" : "150000",
            "moneda" : "PYG",
            "cambio" : 0,
            "infoCheque" : {
                "numeroCheque": "32323232",
                "banco" : "Sudameris"
            }
        }],
        "credito" : {
            "tipo" : 1,
            "plazo" : "30 días",
            "cuotas" : 2,
            "montoEntrega" : 1500000.00,
            "infoCuotas" : [{
                "moneda" : "PYG",
                "monto" : 800000.00,
                "vencimiento" : "2021-10-30"
            }, {
                "moneda" : "PYG",
                "monto" : 800000.00,
                "vencimiento" : "2021-11-30"
            }]
        }
    },
    "items" : [{
        "codigo" : "A-001",
        "descripcion": "Producto o Servicio", 
        "observacion": "Información adicional o complementaria sobre el producto", 
        "partidaArancelaria" : 4444,
        "ncm": "ABCD1234",
        "unidadMedida": 77,
        "cantidad": 10.5,
        "precioUnitario": 10800,
        "cambio": 0,
        "descuento": 0,
        "anticipo": 0,
        "pais" : "PRY",
        "paisDescripcion" : "Paraguay",
        "tolerancia" : 1,
        "toleranciaCantidad" : 1,
        "toleranciaPorcentaje" : 1,
        "cdcAnticipo" : "44digitos",
        "dncp" : {
            "codigoNivelGeneral" : "12345678",
            "codigoNivelEspecifico" : "1234",
            "codigoGtinProducto" : "12345678",
            "codigoNivelPaquete" : "12345678"
        },
        "ivaTipo" : 1,
        "ivaProporcion" : 100,
        "iva" : 5,
        "lote" : "A-001",
        "vencimiento" : "2022-10-30",
        "numeroSerie" : "",
        "numeroPedido" : "",
        "numeroSeguimiento" : "",
        "importador" : {
            "nombre" : "Importadora Parana S.A.",
            "direccion" : "Importadora Parana S.A.",
            "registroImportador" : "Importadora Parana S.A."
        },
        "registroSenave" : "323223",
        "registroEntidadComercial" : "RI-32/22",
        "sectorAutomotor" : {
            "tipo" : 1,
            "chasis" : "45252345235423532",
            "color" : "Rojo",
            "potencia" : 1500,
            "capacidadMotor" : 5,
            "capacidadPasajeros" : 5,
            "pesoBruto" : 10000,
            "pesoNeto" : 8000,
            "tipoCombustible" : 9,
            "tipoCombustibleDescripcion" : "Vapor",
            "numeroMotor" : "323234234234234234",
            "capacidadTraccion" : 151.01,
            "año" : 2009,
            "tipoVehiculo" : "Camioneta",
            "cilindradas" : "3500"
        }
    }],
    "sectorEnergiaElectrica" : {
        "numeroMedidor" : "132423424235425",
        "codigoActividad" : 125,
        "codigoCategoria" : "001",
        "lecturaAnterior" : 4,
        "lecturaActual" : 5
    },
    "sectorSeguros" : {
        "codigoAseguradora" : "",
        "codigoPoliza" : "AAAA",
        "numeroPoliza" : "BBBB",
        "vigencia" : 1,
        "vigenciaUnidad" : "año",
        "inicioVigencia" : "2021-10-01",
        "finVigencia" : "2022-10-01",
        "codigoInternoItem" : "A-001"
    },
    "sectorSupermercados" : {
        "nombreCajero" : "Juan Antonio Caceres",
        "efectivo" : 150000,
        "vuelto" : 30000,
        "donacion" : 1000,
        "donacionDescripcion" : "Donado para la caridad"
    },
    "sectorAdicional" : {
        "ciclo" : "Mensualidad",
        "inicioCiclo" : "2021-09-01",
        "finCiclo" : "2021-10-01",
        "vencimientoPago" : "2021-11-01",
        "numeroContrato" : "AF-2541",
        "saldoAnterior" : 1550000
    },
    "detalleTransporte" : {
        "tipo" : 1,
        "modalidad" : 1,
        "tipoResponsable" : 1,
        "condicionNegociacion" : "CFR",
        "numeroManifiesto" : "AF-2541",
        "numeroDespachoImportacion" : "153223232332",
        "inicioEstimadoTranslado" : "2021-11-01",
        "finEstimadoTranslado" : "2021-11-01",
        "paisDestino" : "PRY", 
        "paisDestinoNombre" : "Paraguay",
        "salida" : {
            "direccion" : "Paraguay",
            "numeroCasa" : "Paraguay",
            "complementoDireccion1" : "Entre calle 2", 
            "complementoDireccion2" : "y Calle 7",
            "departamento" : 11,
            "departamentoDescripcion" : "ALTO PARANA",
            "distrito" : 143,
            "distritoDescripcion" : "DOMINGO MARTINEZ DE IRALA",
            "ciudad" : 3344,
            "ciudadDescripcion" : "PASO ITA (INDIGENA)",
            "pais" : "PRY",
            "paisDescripcion" : "Paraguay",
            "telefonoContacto" : "097x"
        },
        "entrega" : {
            "direccion" : "Paraguay",
            "numeroCasa" : "Paraguay",
            "complementoDireccion1" : "Entre calle 2", 
            "complementoDireccion2" : "y Calle 7",
            "departamento" : 11,
            "departamentoDescripcion" : "ALTO PARANA",
            "distrito" : 143,
            "distritoDescripcion" : "DOMINGO MARTINEZ DE IRALA",
            "ciudad" : 3344,
            "ciudadDescripcion" : "PASO ITA (INDIGENA)",
            "pais" : "PRY",
            "paisDescripcion" : "Paraguay",
            "telefonoContacto" : "097x"
        },
        "vehiculo" : {
            "tipo" : 1,
            "marca" : "Nissan",
            "documentoTipo" : 1, 
            "documentoNumero" : "232323-1",
            "obs" : "",
            "numeroMatricula" : "ALTO PARANA",
            "numeroVuelo" : 143
        },
        "transportista" : {
            "contribuyente" : true,
            "nombre" : "Paraguay",
            "ruc" : "80068684-1", 
            "documentoTipo" : 1,
            "documentoNumero" : "99714584",
            "direccion" : "y Calle 7",
            "obs" : 11,
            "pais" : "PRY",
            "paisDescripcion" : "Paraguay",
            "chofer" : {
                "documentoNumero" : "",
                "nombre" : "Jose Benitez",
                "direccion" : "Jose Benitez"
            },
            "agente" : {
                "nombre" : "Jose Benitez",
                "ruc" : "515415-1",
                "direccion" : "Jose Benitez"
            }
        }
    },
    "complementarios" : {
        "ordenCompra" : "",
        "ordenVenta" : "",
        "numeroAsiento" : "",
        "carga" : {
            "ordenCompra" : "",
            "ordenVenta" : "",
            "numeroAsiento" : ""
        }
    },
    "documentoAsociado" : {
        "formato" : 1,
        "cdc" : "01800695631001001000000612021112917595714694",
        "tipo" : 1,
        "timbrado" : "32323",
        "establecimiento" : "001",
        "punto" : "001",
        "numero" : "00278211",
        "fecha" : "2022-09-14",
        "numeroRetencion" : "32323232",
        "resolucionCreditoFiscal" : "32323",
        "constanciaTipo" : 1,
        "constanciaNumero" : 32323,
        "constanciaControl" : "33232323"

    }
  }
}
```

**Respuesta (202 Accepted):**
```json
{
  "success": true,
  "message": "Factura encolada para procesamiento asíncrono",
  "data": {
    "facturaId": "65f1234567890abcdef12345",
    "correlativo": "001-001-0000060",
    "estado": "encolado",
    "jobId": "factura-65f1234567890abcdef12345"
  }
}
```

### Consultar Estado

```bash
GET /api/factura/estado/:id
```

### Estadísticas de la Cola

```bash
GET /api/queue/stats
```

## 🔧 Configuración

### Desarrollo (Mock-SET)

```bash
# .env
SIFEN_USAR_MOCK=true
SIFEN_MOCK_URL=http://localhost:8082
```
```javascript
// El código usa automáticamente el mock
const setApi = require('./services/setapi-wrapper');
await setApi.recibe(id, xml, 'test', certPath, password);
```

### Producción (SET Real)

```bash
# .env
SIFEN_USAR_MOCK=false
SIFEN_AMBIENTE=test  # o 'prod'
```

```javascript
// El código usa automáticamente la SET real
const setApi = require('./services/setapi-wrapper');
await setApi.recibe(id, xml, 'test', certPath, password);
```
## 📋 Variables de Entorno

| Variable | Descripción | Valores | Default |
|----------|-------------|---------|---------|
| `SIFEN_USAR_MOCK` | Usar Mock-SET en lugar de SET Real | `true` \| `false` | `false` |
| `SIFEN_MOCK_URL` | URL del servidor Mock-SET | URL válida | `http://localhost:8082` |

## 📊 Estados de una Factura

| Estado | Descripción |
|--------|-------------|
| `encolado` | Recibido, esperando procesamiento |
| `procesando` | Worker está generando XML, firmando, enviando a SET |
| `aceptado` | SET aprobó la factura (CDC generado) |
| `rechazado` | SET rechazó la factura |
| `error` | Error en el proceso |

## 📁 Estructura del Proyecto

```
dtepy-backend/
├── server.js                 # Servidor principal
├── package.json
├── patch-kude.js            # Parche para librería KUDE
├── models/
│   ├── Invoice.js           # Modelo de factura
│   ├── Empresa.js           # Modelo de empresa (multi-tenant)
│   ├── ApiKey.js            # Modelo de API Keys
│   ├── User.js              # Modelo de usuario
│   └── OperationLog.js      # Log de operaciones
├── routes/
│   ├── get_einvoice.js      # Endpoint principal
│   ├── invoices.js          # Rutas de facturas
│   ├── empresas.js          # Rutas de empresas
│   └── stats.js             # Estadísticas
├── controllers/
│   ├── authController.js    # Autenticación
│   ├── apiKeyController.js  # Gestión de API Keys
│   └── empresaController.js # CRUD de empresas
├── services/
│   ├── procesarFacturaService.js  # Lógica de facturación
│   └── certificadoService.js      # Gestión de certificados
├── workers/
│   └── facturaWorker.js     # Procesador asíncrono
├── queues/
│   └── facturaQueue.js      # Configuración de colas
├── middleware/
│   └── auth.js              # Autenticación JWT
└── certificados/
    └── :ruc/
        └── certificado.p12  # Certificados por empresa
```

## 🔐 Autenticación

El sistema usa **API Keys** para autenticación:

1. Crear API Key desde el frontend
2. Incluir en headers: `Authorization: Bearer <API_KEY>`
3. Las API Keys pueden estar asociadas a una empresa específica

## Proyectos

- [DTE-PY frontend](https://github.com/jaranetwork/dtepy-frontend) Interface web
- [Módulo ERPNext](https://github.com/jaranetwork/einvoice) para el envío de facturas a DTE-PY

## 📚 Recursos

- [Manual Técnico SIFEN v150](https://www.set.gov.py)
- [Documentación de Bull](https://docs.bullmq.io/)
- [Redis Documentation](https://redis.io/documentation)

## 📚 Librerías de código abierto

- [facturacionelectronicapy-xmlgen](https://github.com/TIPS-SA/facturacionelectronicapy-xmlgen)
- [facturacionelectronicapy-xmlsign](https://github.com/marcosjara/facturacionelectronicapy-xmlsign)
- [facturacionelectronicapy-qrgen](https://github.com/marcosjara/facturacionelectronicapy-qrgen)
- [facturacionelectronicapy-kude](https://github.com/marcosjara/facturacionelectronicapy-kude)
- [facturacionelectronicapy-setapi](https://github.com/marcosjara/facturacionelectronicapy-setapi)

## 📄 Licencia

MIT

## 👥 Autores

Jara Network
