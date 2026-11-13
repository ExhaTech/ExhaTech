/**
 * Yurguen: reset local de cuentas (desarrollo).
 * Uso: node scripts/reset-dev-users.js
 * Crea admin (solo gestión) + yurguen (user, ambos módulos). Borra budgets.
 */
const fs = require('fs');
const path = require('path');
const usersAuth = require('../lib/users-auth');

const ROOT = path.join(__dirname, '..');
const USERS_FILE = path.join(ROOT, 'data', 'users.local.json');
const BUDGETS_DIR = path.join(ROOT, 'data', 'budgets');

function wipeBudgets() {
  if (!fs.existsSync(BUDGETS_DIR)) {
    fs.mkdirSync(BUDGETS_DIR, { recursive: true });
    return;
  }
  fs.readdirSync(BUDGETS_DIR).forEach((f) => {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(BUDGETS_DIR, f));
  });
}

function makeUser(opts) {
  const cred = usersAuth.hashPassword(opts.password);
  const u = {
    id: usersAuth.uid(),
    username: opts.username,
    displayName: opts.displayName,
    role: opts.role,
    active: true,
    email: usersAuth.normalizeEmail(opts.email || ''),
    phone: usersAuth.normalizePhone(opts.phone || ''),
    modules: usersAuth.normalizeModules(opts.modules, opts.role),
    billingDayStart: 1,
    passwordSalt: cred.salt,
    passwordHash: cred.hash,
    createdAt: new Date().toISOString(),
  };
  return usersAuth.normalizeUserRecord(u);
}

wipeBudgets();
const store = {
  seedVersion: 5,
  users: [
    makeUser({
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      password: 'Gunner00',
      email: 'admin@exhatech.com',
    }),
    makeUser({
      username: 'yurguen',
      displayName: 'Yurguen',
      role: 'user',
      password: 'Gunner00',
      email: 'yurguen@exhatech.com',
      modules: { contabilidad: true, bitacora: true, inventario: true },
    }),
  ],
};
fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
console.log('OK — cuentas reseteadas (seed v5):');
console.log('  admin   → solo gestión de usuarios en / / Gunner00');
console.log('  user    → yurguen (Contabilidad+Bitácora+Inventario) / Gunner00');
console.log('Budgets borrados.');
