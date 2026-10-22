const { test } = require('node:test');
const assert = require('node:assert/strict');
const { conectarMongo } = require('../utils/conectarMongo');

const logSilencioso = { log: () => {}, error: () => {} };
const URI = 'mongodb://mongo:s3cr3t@db-host:27017/sifen_db';

test('reintenta hasta que MongoDB acepta la conexión y no tira el proceso', async () => {
  let intentos = 0;
  const esperas = [];
  const conectar = async () => {
    intentos++;
    if (intentos < 3) throw new Error('connect ECONNREFUSED');
  };

  await conectarMongo({
    uri: URI,
    reintentoMs: 1234,
    conectar,
    esperar: async (ms) => { esperas.push(ms); },
    log: logSilencioso
  });

  assert.equal(intentos, 3);
  assert.deepEqual(esperas, [1234, 1234]);
});

test('con maxIntentos agotados propaga el último error', async () => {
  const conectar = async () => { throw new Error('sin red'); };

  await assert.rejects(
    conectarMongo({ uri: URI, maxIntentos: 2, conectar, esperar: async () => {}, log: logSilencioso }),
    { message: 'sin red' }
  );
});

test('los logs llevan la etiqueta y nunca la contraseña', async () => {
  const lineas = [];
  const log = { log: (m) => lineas.push(m), error: (m) => lineas.push(m) };
  let primera = true;
  const conectar = async () => {
    if (primera) { primera = false; throw new Error('timeout'); }
  };

  await conectarMongo({ uri: URI, etiqueta: '[WORKER]', conectar, esperar: async () => {}, log });

  assert.equal(lineas.length, 2);
  assert.ok(lineas.every((l) => l.includes('[WORKER]')));
  assert.ok(lineas.every((l) => !l.includes('s3cr3t')));
  assert.match(lineas[0], /intento 1/);
  assert.match(lineas[1], /conectado/);
});

test('mantiene serverSelectionTimeoutMS por defecto y acepta opciones extra', async () => {
  let recibidas;
  await conectarMongo({
    uri: URI,
    opciones: { maxPoolSize: 7 },
    conectar: async (_uri, opciones) => { recibidas = opciones; },
    log: logSilencioso
  });
  assert.equal(recibidas.serverSelectionTimeoutMS, 5000);
  assert.equal(recibidas.maxPoolSize, 7);
});
