/**
 * Compatibilidad con `lib/users-auth.js` para Workers.
 * Usa scrypt con salt/hash en base64 y hash de 64 bytes.
 */
import crypto from 'node:crypto';

export function hashPassword(password, saltB64) {
  const salt = saltB64
    ? Buffer.from(saltB64, 'base64')
    : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return {
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
}

export function verifyPassword(password, saltB64, hashB64) {
  if (!password || !saltB64 || !hashB64) return false;
  try {
    const { hash } = hashPassword(password, saltB64);
    const a = Buffer.from(hash, 'base64');
    const b = Buffer.from(hashB64, 'base64');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function uid() {
  return 'u_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.display_name || user.username,
    role: user.role === 'admin' ? 'admin' : 'user',
    active: user.active !== false && Number(user.active) !== 0,
    billingDayStart: Number(user.billingDayStart ?? user.billing_day_start) || 1,
    createdAt: user.createdAt || user.created_at || null,
  };
}
