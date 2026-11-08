/**
 * Empaqueta solo el sitio marketing para Cloudflare Pages.
 * Contabilidad/Bitácora NO van aquí (viven en app.exhatech.com).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'pages-out');

const FILES = [
  'index.html',
  'styles.css',
  'script.js',
  'favicon.ico',
  'CNAME',
];

const DIRS = ['assets'];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.warn('skip (no existe):', rel);
    return;
  }
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(rel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    console.warn('skip dir:', rel);
    return;
  }
  fs.cpSync(src, path.join(OUT, rel), { recursive: true });
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

FILES.forEach(copyFile);
DIRS.forEach(copyDir);

console.log('OK — pages-out/ listo para Cloudflare Pages');
console.log('Archivos:', fs.readdirSync(OUT).join(', '));
