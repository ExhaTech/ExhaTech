/**
 * Auth para Workers con usuarios/sesiones en D1.
 */
import crypto from 'node:crypto';
import { json } from './http.js';
import { hashPassword, publicUser, uid } from './passwords.js';

export const SESSION_TTL = 14 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_TTL).toISOString();
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName || row.display_name || row.username,
    role: row.role === 'admin' ? 'admin' : 'user',
    active: row.active !== false && Number(row.active) !== 0,
    passwordSalt: row.passwordSalt || row.password_salt || '',
    passwordHash: row.passwordHash || row.password_hash || '',
    billingDayStart: Number(row.billingDayStart ?? row.billing_day_start) || 1,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

function baseUserSelect() {
  return `
    SELECT
      id,
      username,
      display_name AS displayName,
      role,
      active,
      password_salt AS passwordSalt,
      password_hash AS passwordHash,
      billing_day_start AS billingDayStart,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM users
  `;
}

export async function countUsers(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
  return Number(row && row.total) || 0;
}

export async function maybeSeedAdmin(env) {
  const password = String(env.SEED_ADMIN_PASSWORD || '').trim();
  if (!password) return false;
  const total = await countUsers(env);
  if (total > 0) return false;

  // Seed opcional de primer arranque: si no hay usuarios y existe el secret,
  // se crea `admin` una sola vez para permitir el primer login en Cloudflare.
  const cred = hashPassword(password);
  const now = nowIso();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO users (
      id, username, display_name, role, active,
      password_salt, password_hash, billing_day_start,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    uid(),
    'admin',
    'Admin',
    'admin',
    1,
    cred.salt,
    cred.hash,
    1,
    now,
    now
  ).run();
  return true;
}

export async function findUserByUsername(env, username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return null;
  const row = await env.DB.prepare(`
    ${baseUserSelect()}
    WHERE username = ?
    LIMIT 1
  `).bind(normalized).first();
  return mapUserRow(row);
}

export async function findUserById(env, id) {
  if (!id) return null;
  const row = await env.DB.prepare(`
    ${baseUserSelect()}
    WHERE id = ?
    LIMIT 1
  `).bind(String(id)).first();
  return mapUserRow(row);
}

export async function listUsers(env) {
  const result = await env.DB.prepare(`
    ${baseUserSelect()}
    ORDER BY username COLLATE NOCASE ASC
  `).all();
  const rows = Array.isArray(result && result.results) ? result.results : [];
  return rows.map(mapUserRow);
}

export async function createUser(env, input) {
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO users (
      id, username, display_name, role, active,
      password_salt, password_hash, billing_day_start,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.id,
    input.username,
    input.displayName,
    input.role === 'admin' ? 'admin' : 'user',
    input.active === false ? 0 : 1,
    input.passwordSalt,
    input.passwordHash,
    Number(input.billingDayStart) || 1,
    input.createdAt || now,
    now
  ).run();
  return findUserById(env, input.id);
}

export async function updateUser(env, id, changes) {
  const sets = [];
  const values = [];

  if (changes.displayName != null) {
    sets.push('display_name = ?');
    values.push(String(changes.displayName));
  }
  if (changes.role != null) {
    sets.push('role = ?');
    values.push(changes.role === 'admin' ? 'admin' : 'user');
  }
  if (changes.active != null) {
    sets.push('active = ?');
    values.push(changes.active ? 1 : 0);
  }
  if (changes.billingDayStart != null) {
    sets.push('billing_day_start = ?');
    values.push(Number(changes.billingDayStart) || 1);
  }
  if (changes.passwordSalt != null) {
    sets.push('password_salt = ?');
    values.push(String(changes.passwordSalt));
  }
  if (changes.passwordHash != null) {
    sets.push('password_hash = ?');
    values.push(String(changes.passwordHash));
  }
  if (!sets.length) {
    return findUserById(env, id);
  }

  sets.push('updated_at = ?');
  values.push(nowIso());
  values.push(String(id));

  await env.DB.prepare(`
    UPDATE users
    SET ${sets.join(', ')}
    WHERE id = ?
  `).bind(...values).run();

  return findUserById(env, id);
}

export async function deleteUserById(env, id) {
  if (!id) return;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(String(id)),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(String(id)),
  ]);
}

export async function createSession(env, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    tokenHash(token),
    String(userId),
    sessionExpiresAt(),
    now
  ).run();
  return token;
}

export async function getAuth(request, env) {
  const token = request.headers.get('X-Session-Token') || '';
  if (!token) return null;

  const row = await env.DB.prepare(`
    SELECT
      s.expires_at AS sessionExpiresAt,
      u.id,
      u.username,
      u.display_name AS displayName,
      u.role,
      u.active,
      u.password_salt AS passwordSalt,
      u.password_hash AS passwordHash,
      u.billing_day_start AS billingDayStart,
      u.created_at AS createdAt,
      u.updated_at AS updatedAt
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
    LIMIT 1
  `).bind(tokenHash(token)).first();

  if (!row) return null;

  if (String(row.sessionExpiresAt || '') <= nowIso()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(tokenHash(token))
      .run();
    return null;
  }

  const user = mapUserRow(row);
  if (!user || user.active === false) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(tokenHash(token))
      .run();
    return null;
  }

  await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
    .bind(sessionExpiresAt(), tokenHash(token))
    .run();

  return { token, user };
}

export async function revokeSession(requestOrToken, env) {
  const token = typeof requestOrToken === 'string'
    ? requestOrToken
    : (requestOrToken && requestOrToken.headers
      ? requestOrToken.headers.get('X-Session-Token') || ''
      : '');
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(tokenHash(token))
    .run();
}

export async function requireAuth(request, env) {
  const ctx = await getAuth(request, env);
  if (!ctx) {
    return { ctx: null, errorResponse: json({ error: 'unauthorized' }, 401) };
  }
  return { ctx, errorResponse: null };
}

export async function requireAdmin(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth;
  if (auth.ctx.user.role !== 'admin') {
    return { ctx: null, errorResponse: json({ error: 'forbidden' }, 403) };
  }
  return auth;
}

export { publicUser };
