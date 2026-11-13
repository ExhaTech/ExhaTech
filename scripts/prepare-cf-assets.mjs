/**
 * Empaqueta Hub + Contabilidad + Bitácora + Inventario (+ assets de marca) en ./public
 * para el Worker de app.exhatech.com.
 * No incluye el marketing (ese va a Pages vía prepare-pages.mjs).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');

const FILES = [
  'hub.html',
  'hub.js',
  'hub.css',
  'eh-mnt.html',
  'eh-mnt.js',
  'eh-mnt.css',
  'foco.html',
  'foco.js',
  'foco.css',
  'inventario.html',
  'inventario.js',
  'inventario.css',
  'favicon.ico',
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

const assetsIgnore = [
  '# No subir basura al CDN',
  '.DS_Store',
  'Thumbs.db',
  '*.map',
].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, '.assetsignore'), assetsIgnore);

// Fallback HTML: el Worker resuelve / → hub.html vía paths.js
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  '<!DOCTYPE html><meta http-equiv="refresh" content="0;url=/"><title>ExhaTech App</title>\n'
);

FILES.forEach(copyFile);
DIRS.forEach(copyDir);

console.log('OK — public/ listo para Worker (app.exhatech.com)');
console.log('Archivos:', fs.readdirSync(OUT).join(', '));
