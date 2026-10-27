/**
 * Copia el sitio + paneles a ./public para Workers Static Assets.
 * No incluye data/, worker/, node_modules ni secretos.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');

const FILES = [
  'index.html',
  'styles.css',
  'script.js',
  'CNAME',
  'eh-mnt.html',
  'eh-mnt.js',
  'eh-mnt.css',
  'foco.html',
  'foco.js',
  'foco.css',
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

FILES.forEach(copyFile);
DIRS.forEach(copyDir);

console.log('OK — public/ listo para wrangler deploy');
console.log('Archivos:', fs.readdirSync(OUT).join(', '));
