#!/usr/bin/env node
/**
 * Genera SQL de seed para D1 usando el mismo hashing que Node local.
 *
 * Ejemplo:
 *   node scripts/cf-seed-admin.mjs --username admin --password Gunner00
 *   npx wrangler d1 execute exhatech-db --remote --file seed-admin.sql
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const usersAuth = require('../lib/users-auth.js');

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const username = String(readArg('username', 'admin')).trim().toLowerCase();
const password = String(readArg('password', '')).trim();
const displayName = String(readArg('display-name', 'Admin')).trim() || 'Admin';
const role = readArg('role', 'admin') === 'admin' ? 'admin' : 'user';
const billingDayStart = Math.min(28, Math.max(1, Number(readArg('billing-day-start', '1')) || 1));

if (!username || !password) {
  console.error('Uso: node scripts/cf-seed-admin.mjs --username admin --password <clave>');
  process.exit(1);
}

if (password.length < 6) {
  console.error('La contraseña debe tener al menos 6 caracteres.');
  process.exit(1);
}

const cred = usersAuth.hashPassword(password);
const id = usersAuth.uid();
const now = new Date().toISOString();

const sql = `-- Seed admin/user para Cloudflare D1
INSERT INTO users (
  id,
  username,
  display_name,
  role,
  active,
  password_salt,
  password_hash,
  billing_day_start,
  created_at,
  updated_at
) VALUES (
  ${sqlString(id)},
  ${sqlString(username)},
  ${sqlString(displayName)},
  ${sqlString(role)},
  1,
  ${sqlString(cred.salt)},
  ${sqlString(cred.hash)},
  ${billingDayStart},
  ${sqlString(now)},
  ${sqlString(now)}
);
`;

process.stdout.write(sql);
