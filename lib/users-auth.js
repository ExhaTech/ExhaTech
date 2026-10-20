/**
 * Yurguen: hash de contraseñas (scrypt) + helpers de usuarios
 */
const crypto = require('crypto');

function hashPassword(password, saltB64) {
  const salt = saltB64
    ? Buffer.from(saltB64, 'base64')
    : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return {
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
}

function verifyPassword(password, saltB64, hashB64) {
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

function uid() {
  return 'u_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    role: u.role === 'admin' ? 'admin' : 'user',
    active: u.active !== false,
    billingDayStart: Number(u.billingDayStart) || 1,
    createdAt: u.createdAt || null,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  uid,
  publicUser,
};
