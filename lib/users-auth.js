/**
 * Yurguen: hash de contraseñas (scrypt) + helpers de usuarios / módulos / uso.
 */
const crypto = require('crypto');

const INACTIVITY_DAYS = 31;

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

/** Admin no opera Contabilidad/Bitácora; user por defecto tiene ambos. */
function normalizeModules(raw, role) {
  if (role === 'admin') {
    return { contabilidad: false, bitacora: false };
  }
  const m = raw && typeof raw === 'object' ? raw : {};
  return {
    contabilidad: m.contabilidad !== false,
    bitacora: m.bitacora !== false,
  };
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizePhone(raw) {
  return String(raw || '').trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

/** Normaliza campos nuevos sobre un user persistido (mutación in-place). */
function normalizeUserRecord(u) {
  if (!u || typeof u !== 'object') return u;
  u.role = u.role === 'admin' ? 'admin' : 'user';
  u.active = u.active !== false;
  u.email = normalizeEmail(u.email);
  u.phone = normalizePhone(u.phone);
  u.modules = normalizeModules(u.modules, u.role);
  u.loginCount = Number(u.loginCount) || 0;
  u.lastLoginAt = u.lastLoginAt || null;
  u.dataClearedAt = u.dataClearedAt || null;
  u.mustChangePassword = !!u.mustChangePassword;
  if (!u.lastModuleAt || typeof u.lastModuleAt !== 'object') u.lastModuleAt = {};
  if (u.billingDayStart == null) u.billingDayStart = 1;
  u.billingDayStart = Math.min(28, Math.max(1, Number(u.billingDayStart) || 1));
  return u;
}

function publicUser(u) {
  if (!u) return null;
  normalizeUserRecord(u);
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    role: u.role,
    active: u.active !== false,
    email: u.email || '',
    phone: u.phone || '',
    modules: {
      contabilidad: !!u.modules.contabilidad,
      bitacora: !!u.modules.bitacora,
    },
    billingDayStart: Number(u.billingDayStart) || 1,
    loginCount: Number(u.loginCount) || 0,
    lastLoginAt: u.lastLoginAt || null,
    mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt || null,
  };
}

function hasModule(user, moduleName) {
  if (!user) return false;
  if (user.role === 'admin') return false;
  normalizeUserRecord(user);
  if (moduleName === 'contabilidad') return !!user.modules.contabilidad;
  if (moduleName === 'bitacora') return !!user.modules.bitacora;
  return false;
}

function touchLogin(user) {
  normalizeUserRecord(user);
  user.loginCount = (Number(user.loginCount) || 0) + 1;
  user.lastLoginAt = new Date().toISOString();
  return user;
}

function touchModule(user, moduleName) {
  normalizeUserRecord(user);
  if (moduleName !== 'contabilidad' && moduleName !== 'bitacora' && moduleName !== 'landing') {
    return user;
  }
  user.lastModuleAt[moduleName] = new Date().toISOString();
  return user;
}

/** Clave temporal legible (sin chars ambiguos). */
function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * ¿Debe limpiarse por inactividad (>31 días sin login)?
 * Usa lastLoginAt o createdAt; evita re-limpiar si ya se limpió desde la última actividad.
 */
function shouldPurgeUserData(user, nowMs) {
  normalizeUserRecord(user);
  if (user.role === 'admin') return false;
  const now = nowMs || Date.now();
  const lastActivity = Date.parse(user.lastLoginAt || user.createdAt || '') || 0;
  if (!lastActivity) return false;
  const cutoff = now - INACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  if (lastActivity > cutoff) return false;
  const cleared = Date.parse(user.dataClearedAt || '') || 0;
  if (cleared && cleared >= lastActivity) return false;
  return true;
}

module.exports = {
  INACTIVITY_DAYS,
  hashPassword,
  verifyPassword,
  uid,
  normalizeModules,
  normalizeEmail,
  normalizePhone,
  isValidEmail,
  normalizeUserRecord,
  publicUser,
  hasModule,
  touchLogin,
  touchModule,
  generateTempPassword,
  shouldPurgeUserData,
};
