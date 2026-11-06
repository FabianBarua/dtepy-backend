#!/usr/bin/env node
/**
 * Compila las plantillas propias de KUDE: cada `assets/kude/jrxml/<Nombre>.jrxml`
 * genera `assets/kude/jasper/<Nombre>.jasper`, que es lo que usa el servicio.
 *
 * Hace falta un JDK 21, no alcanza con un JRE: JasperReports compila las
 * expresiones de la plantilla con javac, y las clases quedan para la misma
 * versión de Java con la que corre el servicio.
 *
 * Uso: npm run kude:compilar                   compila todas
 *      npm run kude:compilar -- NotaRemision   compila una
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolverDistKude, resolverJava, JASPER_PROPIOS_DIR } = require('../services/kudeRunner');

const FUENTES_DIR = path.join(__dirname, '..', 'assets', 'kude', 'jrxml');
const COMPILADOR = path.join(FUENTES_DIR, 'CompilarJasper.java');

const pedidas = process.argv.slice(2).map((nombre) => nombre.replace(/\.jrxml$/i, ''));
const plantillas = fs.readdirSync(FUENTES_DIR)
  .filter((archivo) => archivo.toLowerCase().endsWith('.jrxml'))
  .map((archivo) => path.basename(archivo, path.extname(archivo)))
  .filter((nombre) => pedidas.length === 0 || pedidas.includes(nombre));

if (plantillas.length === 0) {
  console.error(`❌ No hay plantillas .jrxml para compilar en ${FUENTES_DIR}`);
  process.exit(1);
}

const classpath = path.join(resolverDistKude(), 'jasperLibs') + path.sep + '*';
// JasperReports deja los archivos intermedios en el directorio de trabajo.
const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'kude-compilar-'));

try {
  for (const nombre of plantillas) {
    const fuente = path.join(FUENTES_DIR, `${nombre}.jrxml`);
    const destino = path.join(JASPER_PROPIOS_DIR, `${nombre}.jasper`);
    try {
      execFileSync(resolverJava(), ['-cp', classpath, COMPILADOR, fuente, destino], {
        cwd: trabajo,
        stdio: 'pipe',
        encoding: 'utf8',
        windowsHide: true
      });
      console.log(`✅ ${nombre}.jasper`);
    } catch (error) {
      console.error(`❌ No se pudo compilar ${nombre}.jrxml`);
      console.error(String(error.stderr || error.message).trim());
      process.exitCode = 1;
    }
  }
} finally {
  fs.rmSync(trabajo, { recursive: true, force: true });
}
