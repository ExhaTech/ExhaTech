/**
 * Yurguen: reset local de cuentas (desarrollo).
 * Uso: node scripts/reset-dev-users.js
 * Crea admin + yurguen (user), borra budgets.
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

function makeUser(username, displayName, role, password) {
  const cred = usersAuth.hashPassword(password);
  return {
    id: usersAuth.uid(),
    username,
    displayName,
    role,
    active: true,
    billingDayStart: 1,
    passwordSalt: cred.salt,
    passwordHash: cred.hash,
    createdAt: new Date().toISOString(),
  };
}

wipeBudgets();
const store = {
  seedVersion: 4,
  users: [
    makeUser('admin', 'Admin', 'admin', 'Gunner00'),
    makeUser('yurguen', 'Yurguen', 'user', 'Gunner00'),
  ],
};
fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
console.log('OK — cuentas reseteadas:');
console.log('  admin   → admin / Gunner00');
console.log('  user    → yurguen / Gunner00');
console.log('Budgets borrados.');
