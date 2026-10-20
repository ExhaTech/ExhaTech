/**
 * Yurguen: sitio + API presupuesto familiar (paso 1: multi-usuario)
 * Usuarios en data/users.local.json (hashes). Sesión por token.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const usersAuth = require('./lib/users-auth');
let budgetStore = require('./lib/budget-store');

/** Dev: recarga budget-store (Node cachea el require y dejaba la lógica vieja del fin del ciclo) */
function reloadBudgetStore() {
  delete require.cache[require.resolve('./lib/budget-store')];
  budgetStore = require('./lib/budget-store');
  return budgetStore;
}

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const USERS_FILE = path.join(ROOT, 'data', 'users.local.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// Yurguen: sesiones en memoria (reinicio del server las limpia)
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Limpia presupuestos locales (desarrollo) */
function wipeAllBudgets() {
  const dir = path.join(ROOT, 'data', 'budgets');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  fs.readdirSync(dir).forEach((f) => {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
  });
}

function upsertDevUser(store, opts) {
  let u = findUserByUsername(store, opts.username);
  if (!u) {
    u = { id: usersAuth.uid(), createdAt: new Date().toISOString() };
    store.users.push(u);
  }
  const cred = usersAuth.hashPassword(opts.password);
  u.username = opts.username;
  u.displayName = opts.displayName;
  u.role = opts.role;
  u.active = true;
  u.billingDayStart = 1;
  u.passwordSalt = cred.salt;
  u.passwordHash = cred.hash;
  return u;
}

function ensurePrimaryAdmin(store) {
  // Yurguen: seedVersion 4 = admin + yurguen (user), budgets limpios
  if (store.seedVersion >= 4) return store;
  store.users = [];
  upsertDevUser(store, {
    username: 'admin',
    displayName: 'Admin',
    role: 'admin',
    password: 'Gunner00',
  });
  upsertDevUser(store, {
    username: 'yurguen',
    displayName: 'Yurguen',
    role: 'user',
    password: 'Gunner00',
  });
  wipeAllBudgets();
  store.seedVersion = 4;
  return store;
}

function ensureUsersFile() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let store = { users: [], seedVersion: 0 };
  if (fs.existsSync(USERS_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (!Array.isArray(store.users)) store.users = [];
    } catch {
      store = { users: [], seedVersion: 0 };
    }
  }
  const before = store.seedVersion || 0;
  store = ensurePrimaryAdmin(store);
  if (!fs.existsSync(USERS_FILE) || before < 4) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
    console.log('Yurguen: cuentas dev — admin (admin) + yurguen (user)');
  }
}

function loadUsersStore() {
  ensureUsersFile();
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (!raw.users || !Array.isArray(raw.users)) return { users: [] };
    return raw;
  } catch {
    return { users: [] };
  }
}

function saveUsersStore(store) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function findUserByUsername(store, username) {
  const u = String(username || '').trim().toLowerCase();
  return store.users.find((x) => String(x.username || '').toLowerCase() === u) || null;
}

function findUserById(store, id) {
  return store.users.find((x) => x.id === id) || null;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    expires: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSessionUser(req) {
  const token = req.headers['x-session-token'] || '';
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  s.expires = Date.now() + SESSION_TTL_MS;
  const store = loadUsersStore();
  const user = findUserById(store, s.userId);
  if (!user || user.active === false) {
    sessions.delete(token);
    return null;
  }
  return { token, user, store };
}

function revokeSession(req) {
  const token = req.headers['x-session-token'] || '';
  if (token) sessions.delete(token);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function requireAuth(req, res) {
  const ctx = getSessionUser(req);
  if (!ctx) {
    send(res, 401, { error: 'unauthorized' });
    return null;
  }
  return ctx;
}

function requireAdmin(req, res) {
  const ctx = requireAuth(req, res);
  if (!ctx) return null;
  if (ctx.user.role !== 'admin') {
    send(res, 403, { error: 'forbidden' });
    return null;
  }
  return ctx;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (
    url.pathname === '/api/eh-data' ||
    url.pathname === '/api/eh-data.php' ||
    url.pathname === '/api/budget'
  ) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
      });
      res.end();
      return;
    }

    if (req.method === 'POST') {
      let body = {};
      try {
        body = await readBody(req);
      } catch {
        send(res, 400, { error: 'invalid body' });
        return;
      }

      const action = body.action;

      // Yurguen: login — usuario + contraseña
      if (action === 'auth') {
        const store = loadUsersStore();
        const user = findUserByUsername(store, body.username || body.email || '');
        if (!user || user.active === false) {
          send(res, 200, { ok: false, error: 'Credenciales inválidas' });
          return;
        }
        const ok = usersAuth.verifyPassword(
          body.password || '',
          user.passwordSalt,
          user.passwordHash
        );
        if (!ok) {
          send(res, 200, { ok: false, error: 'Credenciales inválidas' });
          return;
        }
        const token = createSession(user);
        send(res, 200, {
          ok: true,
          token,
          user: usersAuth.publicUser(user),
        });
        return;
      }

      if (action === 'logout') {
        revokeSession(req);
        send(res, 200, { ok: true });
        return;
      }

      if (action === 'me') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        send(res, 200, { ok: true, user: usersAuth.publicUser(ctx.user) });
        return;
      }

      // Yurguen: cambio de contraseña del usuario en sesión
      if (action === 'changePassword') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const current = String(body.currentPassword || '');
        const next = String(body.newPassword || '');
        if (next.length < 6) {
          send(res, 400, { error: 'La contraseña nueva debe tener al menos 6 caracteres' });
          return;
        }
        const ok = usersAuth.verifyPassword(
          current,
          ctx.user.passwordSalt,
          ctx.user.passwordHash
        );
        if (!ok) {
          send(res, 400, { error: 'Contraseña actual incorrecta' });
          return;
        }
        const cred = usersAuth.hashPassword(next);
        ctx.user.passwordSalt = cred.salt;
        ctx.user.passwordHash = cred.hash;
        saveUsersStore(ctx.store);
        send(res, 200, { ok: true });
        return;
      }

      if (action === 'users.list') {
        const ctx = requireAdmin(req, res);
        if (!ctx) return;
        send(res, 200, {
          ok: true,
          users: ctx.store.users.map(usersAuth.publicUser),
        });
        return;
      }

      if (action === 'users.create') {
        const ctx = requireAdmin(req, res);
        if (!ctx) return;
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        const displayName = String(body.displayName || username).trim();
        const role = body.role === 'admin' ? 'admin' : 'user';
        const billingDayStart = Math.min(28, Math.max(1, Number(body.billingDayStart) || 1));
        if (!username || password.length < 6) {
          send(res, 400, { error: 'Usuario y contraseña (mín. 6) obligatorios' });
          return;
        }
        if (findUserByUsername(ctx.store, username)) {
          send(res, 400, { error: 'Ese usuario ya existe' });
          return;
        }
        const cred = usersAuth.hashPassword(password);
        const nu = {
          id: usersAuth.uid(),
          username,
          displayName,
          role,
          active: true,
          billingDayStart,
          passwordSalt: cred.salt,
          passwordHash: cred.hash,
          createdAt: new Date().toISOString(),
        };
        ctx.store.users.push(nu);
        saveUsersStore(ctx.store);
        send(res, 200, { ok: true, user: usersAuth.publicUser(nu) });
        return;
      }

      if (action === 'users.update') {
        const ctx = requireAdmin(req, res);
        if (!ctx) return;
        const target = findUserById(ctx.store, body.id);
        if (!target) {
          send(res, 404, { error: 'Usuario no encontrado' });
          return;
        }
        if (body.displayName != null) {
          target.displayName = String(body.displayName).trim() || target.username;
        }
        if (body.active != null) {
          if (target.id === ctx.user.id && body.active === false) {
            send(res, 400, { error: 'No podés desactivarte a vos mismo' });
            return;
          }
          target.active = !!body.active;
        }
        if (body.billingDayStart != null) {
          target.billingDayStart = Math.min(28, Math.max(1, Number(body.billingDayStart) || 1));
        }
        if (body.role === 'admin' || body.role === 'user') {
          if (target.id === ctx.user.id && body.role !== 'admin') {
            send(res, 400, { error: 'No podés quitarte el rol admin' });
            return;
          }
          target.role = body.role;
        }
        if (body.newPassword) {
          if (String(body.newPassword).length < 6) {
            send(res, 400, { error: 'Contraseña mínima 6 caracteres' });
            return;
          }
          const cred = usersAuth.hashPassword(body.newPassword);
          target.passwordSalt = cred.salt;
          target.passwordHash = cred.hash;
        }
        saveUsersStore(ctx.store);
        send(res, 200, { ok: true, user: usersAuth.publicUser(target) });
        return;
      }

      if (action === 'users.delete') {
        const ctx = requireAdmin(req, res);
        if (!ctx) return;
        if (body.id === ctx.user.id) {
          send(res, 400, { error: 'No podés eliminarte a vos mismo' });
          return;
        }
        const before = ctx.store.users.length;
        ctx.store.users = ctx.store.users.filter((u) => u.id !== body.id);
        if (ctx.store.users.length === before) {
          send(res, 404, { error: 'Usuario no encontrado' });
          return;
        }
        saveUsersStore(ctx.store);
        for (const [tok, s] of sessions.entries()) {
          if (s.userId === body.id) sessions.delete(tok);
        }
        send(res, 200, { ok: true });
        return;
      }

      // Yurguen: cada usuario define su propio día de inicio del ciclo
      if (action === 'profile.update') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        let syncedPeriod = null;
        if (body.billingDayStart != null) {
          const newDay = Math.min(28, Math.max(1, Number(body.billingDayStart) || 1));
          ctx.user.billingDayStart = newDay;
          try {
            reloadBudgetStore();
            const budget = budgetStore.loadBudget(ctx.user.id);
            if (!(budget.periods || []).length) {
              budgetStore.bootstrapFirstPeriod(budget, newDay);
            }
            const sync = budgetStore.syncOpenPeriodEndToCutDay(budget, newDay);
            if (!sync || !sync.period) {
              // No hay abierto: crear/usar default y reintentar
              budgetStore.bootstrapFirstPeriod(budget, newDay);
              budgetStore.syncOpenPeriodEndToCutDay(budget, newDay);
            }
            budgetStore.saveBudget(ctx.user.id, budget);
            const open = (budget.periods || []).find((p) => p.status !== 'closed') || null;
            syncedPeriod = open
              ? { key: open.key, startDate: open.startDate, endDate: open.endDate }
              : null;
          } catch (e) {
            if (e.code === 'cut_in_past') {
              send(res, 400, { error: e.message || 'El cierre del periodo no puede ser antes de hoy.' });
              return;
            }
            console.error('profile.update sync periodo:', e && e.message ? e.message : e);
            send(res, 500, { error: 'No se pudo actualizar el periodo con el nuevo día de inicio' });
            return;
          }
        }
        if (body.displayName != null) {
          ctx.user.displayName = String(body.displayName).trim() || ctx.user.username;
        }
        saveUsersStore(ctx.store);
        send(res, 200, {
          ok: true,
          user: usersAuth.publicUser(ctx.user),
          period: syncedPeriod,
        });
        return;
      }

      // ---- Yurguen: presupuesto por usuario ----
      if (action === 'budget.get') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        try {
          reloadBudgetStore();
          const day = Number(ctx.user.billingDayStart) || 1;
          const budget = budgetStore.loadBudget(ctx.user.id);
          budgetStore.purgeOldPeriods(budget);
          // Solo ciclos guardados; si no hay ninguno, crea el primero
          if (!(budget.periods || []).length) {
            budgetStore.bootstrapFirstPeriod(budget, day);
          }
          // Alinea fin del periodo abierto con el día de inicio del usuario
          try {
            budgetStore.syncOpenPeriodEndToCutDay(budget, day);
          } catch (e) {
            if (e.code !== 'cut_in_past') throw e;
          }
          const cycles = budgetStore.listCycles(budget);
          const preferred = body.cycleKey || budgetStore.resolveDefaultCycleKey(budget);
          let period = budgetStore.findPeriod(budget, preferred);
          if (!period && cycles.length) {
            period = budgetStore.findPeriod(budget, cycles[0].key);
          }
          if (!period) {
            period = budgetStore.bootstrapFirstPeriod(budget, day);
          }
          budgetStore.saveBudget(ctx.user.id, budget);
          const cycle = {
            key: period.key,
            startDate: period.startDate,
            endDate: period.endDate,
            billingDayStart: day,
            status: period.status === 'closed' ? 'closed' : 'open',
          };
          const summary = budgetStore.periodSummary(budget, period);
          const catMap = {};
          (budget.categories || []).forEach((c) => { catMap[c.id] = c.name; });
          // Barras: ingresos y egresos, planeado vs ejecutado. Pastel: gastos por categoría.
          const charts = {
            plannedVsActual: [
              { label: 'Ingresos presupuestados', value: summary.plannedIncome, kind: 'income', series: 'planned' },
              { label: 'Ingresos ejecutados', value: summary.actualIncome, kind: 'income', series: 'actual' },
              { label: 'Egresos presupuestados', value: summary.plannedExpense, kind: 'expense', series: 'planned' },
              { label: 'Egresos ejecutados', value: summary.actualExpense, kind: 'expense', series: 'actual' },
            ],
            byCategory: Object.keys(summary.byCategory).map((id) => ({
              id,
              label: id === 'none' ? 'Sin categoría' : (catMap[id] || 'Otra'),
              value: summary.byCategory[id],
            })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value),
          };
          send(res, 200, {
            ok: true,
            billingDayStart: day,
            cycles: budgetStore.listCycles(budget),
            cycle,
            categories: budget.categories || [],
            loans: budget.loans || [],
            loanFxRate: budgetStore.referenceExchangeRate(budget),
            period,
            periodClosed: budgetStore.isPeriodClosed(period),
            periodExpired: budgetStore.isPeriodExpired(period),
            canClosePeriod: budgetStore.canClosePeriod(period),
            summary,
            charts,
            history: budgetStore.buildHistory(budget),
          });
        } catch (e) {
          send(res, 500, { error: 'budget_load_failed' });
        }
        return;
      }

      // Yurguen: tipo de cambio del ciclo (₡ por 1 USD)
      if (action === 'budget.period.update') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const budget = budgetStore.loadBudget(ctx.user.id);
        const period = budgetStore.findPeriod(budget, body.cycleKey)
          || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
        if (!period) {
          send(res, 404, { error: 'Ciclo no encontrado' });
          return;
        }
        if (!budgetStore.canEditPeriod(period)) {
          send(res, 403, {
            error: budgetStore.isPeriodClosed(period)
              ? 'Ciclo cerrado: no se puede modificar'
              : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
          });
          return;
        }
        if (body.exchangeRate != null) {
          const rate = Number(body.exchangeRate);
          if (isNaN(rate) || rate < 0) {
            send(res, 400, { error: 'Tipo de cambio inválido' });
            return;
          }
          period.exchangeRate = budgetStore.normalizeExchangeRate(rate);
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, {
          ok: true,
          period,
          summary: budgetStore.periodSummary(budget, period),
        });
        return;
      }

      // Yurguen: cerrar ciclo → solo lectura + abre el siguiente
      if (action === 'budget.period.close') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const day = Number(ctx.user.billingDayStart) || 1;
        const budget = budgetStore.loadBudget(ctx.user.id);
        try {
          const cycleKey = body.cycleKey || budgetStore.resolveDefaultCycleKey(budget);
          const result = budgetStore.closePeriod(budget, cycleKey, day);
          budgetStore.purgeOldPeriods(budget);
          budgetStore.saveBudget(ctx.user.id, budget);
          send(res, 200, {
            ok: true,
            closed: result.closed,
            nextCycle: result.nextCycle,
            nextPeriod: result.next,
          });
        } catch (e) {
          const bad =
            e.code === 'already_closed' ||
            e.code === 'not_found' ||
            e.code === 'cut_not_reached';
          send(res, bad ? 400 : 500, { error: e.message || 'No se pudo cerrar el ciclo' });
        }
        return;
      }

      if (action === 'budget.category.save') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const name = String(body.name || '').trim();
        const type = body.type === 'income' ? 'income' : 'expense';
        const description = String(body.description || '').trim();
        if (!name) {
          send(res, 400, { error: 'Nombre de categoría obligatorio' });
          return;
        }
        const budget = budgetStore.loadBudget(ctx.user.id);
        let catId = body.id || null;
        if (body.id) {
          const cat = budget.categories.find((c) => c.id === body.id);
          if (!cat) {
            send(res, 404, { error: 'Categoría no encontrada' });
            return;
          }
          cat.name = name;
          cat.type = type;
          cat.description = description;
          catId = cat.id;
        } else {
          catId = budgetStore.uid('cat');
          const maxOrder = (budget.categories || []).reduce(
            (m, c) => Math.max(m, Number(c.sortOrder) || 0),
            -1
          );
          budget.categories.push({
            id: catId,
            name,
            type,
            description,
            sortOrder: maxOrder + 1,
            createdAt: new Date().toISOString(),
          });
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, categories: budget.categories, categoryId: catId });
        return;
      }

      // Subir / bajar categoría en el listado de Presupuesto
      if (action === 'budget.category.move') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        reloadBudgetStore();
        const dir = body.direction === 'up' ? -1 : 1;
        if (!body.id || (body.direction !== 'up' && body.direction !== 'down')) {
          send(res, 400, { error: 'Id y dirección (up/down) obligatorios' });
          return;
        }
        const budget = budgetStore.loadBudget(ctx.user.id);
        const cats = (budget.categories || []).slice().sort((a, b) => {
          const ao = Number(a.sortOrder);
          const bo = Number(b.sortOrder);
          if (ao !== bo) return ao - bo;
          return String(a.name || '').localeCompare(String(b.name || ''), 'es');
        });
        // Normaliza sortOrder 0..n-1 antes de intercambiar
        cats.forEach((c, i) => { c.sortOrder = i; });
        const idx = cats.findIndex((c) => c.id === body.id);
        if (idx < 0) {
          send(res, 404, { error: 'Categoría no encontrada' });
          return;
        }
        const swap = idx + dir;
        if (swap < 0 || swap >= cats.length) {
          send(res, 200, { ok: true, categories: budget.categories });
          return;
        }
        const tmp = cats[idx].sortOrder;
        cats[idx].sortOrder = cats[swap].sortOrder;
        cats[swap].sortOrder = tmp;
        budget.categories = cats.sort((a, b) => a.sortOrder - b.sortOrder);
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, categories: budget.categories });
        return;
      }

      if (action === 'budget.category.delete') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const budget = budgetStore.loadBudget(ctx.user.id);
        budget.categories = (budget.categories || []).filter((c) => c.id !== body.id);
        (budget.periods || []).forEach((p) => {
          if (budgetStore.isPeriodClosed(p)) return;
          p.budget = (p.budget || []).filter((b) => b.categoryId !== body.id);
        });
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, categories: budget.categories });
        return;
      }

      if (action === 'budget.plan.save') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        // Dev: recargar store para no perder campos nuevos (ej. tag) con require cacheado
        reloadBudgetStore();
        const categoryId = body.categoryId;
        const planned = Number(body.planned);
        const currency = budgetStore.normalizeCurrency(body.currency);
        if (!categoryId || body.planned === '' || body.planned == null || isNaN(planned)) {
          send(res, 400, { error: 'Categoría y monto planeado obligatorios' });
          return;
        }
        const budget = budgetStore.loadBudget(ctx.user.id);
        if (!budgetStore.findCategory(budget, categoryId)) {
          send(res, 404, { error: 'Categoría no encontrada' });
          return;
        }
        const period = budgetStore.findPeriod(budget, body.cycleKey)
          || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
        if (!period) {
          send(res, 404, { error: 'Ciclo no encontrado' });
          return;
        }
        if (!budgetStore.canEditPeriod(period)) {
          send(res, 403, {
            error: budgetStore.isPeriodClosed(period)
              ? 'Ciclo cerrado: no se puede modificar'
              : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
          });
          return;
        }
        if (currency === 'USD' && !(Number(period.exchangeRate) > 0)) {
          send(res, 400, { error: 'Definí el tipo de cambio del ciclo antes de usar USD' });
          return;
        }
        // Etiqueta de la línea: tag (preferido) | label | planLabel
        const tag = String(
          body.tag != null && body.tag !== ''
            ? body.tag
            : (body.label != null && body.label !== '' ? body.label : (body.planLabel || ''))
        ).trim();
        if (!Array.isArray(period.budget)) period.budget = [];
        // Varias líneas por categoría permitidas (no upsert por categoryId)
        let savedLine = null;
        if (body.id) {
          const line = period.budget.find((b) => b.id === body.id);
          if (!line) {
            send(res, 404, { error: 'Línea de presupuesto no encontrada' });
            return;
          }
          line.categoryId = categoryId;
          line.planned = planned;
          line.currency = currency;
          line.tag = tag;
          line.label = tag;
          savedLine = line;
        } else {
          const maxOrder = period.budget
            .filter((b) => b.categoryId === categoryId)
            .reduce((m, b) => Math.max(m, Number(b.sortOrder) || 0), -1);
          savedLine = {
            id: budgetStore.uid('plan'),
            categoryId,
            planned,
            currency,
            tag,
            label: tag,
            sortOrder: maxOrder + 1,
          };
          period.budget.push(savedLine);
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        const reloaded = budgetStore.loadBudget(ctx.user.id);
        const periodSaved = budgetStore.findPeriod(reloaded, period.key) || period;
        const lineSaved = (periodSaved.budget || []).find((b) => b.id === savedLine.id) || savedLine;
        send(res, 200, {
          ok: true,
          period: periodSaved,
          line: lineSaved,
          summary: budgetStore.periodSummary(reloaded, periodSaved),
        });
        return;
      }

      // Subir / bajar línea de presupuesto dentro de su categoría
      if (action === 'budget.plan.move') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        reloadBudgetStore();
        if (!body.id || (body.direction !== 'up' && body.direction !== 'down')) {
          send(res, 400, { error: 'Id y dirección (up/down) obligatorios' });
          return;
        }
        const budget = budgetStore.loadBudget(ctx.user.id);
        const period = budgetStore.findPeriod(budget, body.cycleKey)
          || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
        if (!period) {
          send(res, 404, { error: 'Ciclo no encontrado' });
          return;
        }
        if (!budgetStore.canEditPeriod(period)) {
          send(res, 403, {
            error: budgetStore.isPeriodClosed(period)
              ? 'Ciclo cerrado: no se puede modificar'
              : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
          });
          return;
        }
        if (!Array.isArray(period.budget)) period.budget = [];
        const target = period.budget.find((b) => b.id === body.id);
        if (!target) {
          send(res, 404, { error: 'Línea de presupuesto no encontrada' });
          return;
        }
        const siblings = period.budget
          .filter((b) => b.categoryId === target.categoryId)
          .sort((a, b) => {
            const ao = Number(a.sortOrder);
            const bo = Number(b.sortOrder);
            if (ao !== bo) return (isNaN(ao) ? 9999 : ao) - (isNaN(bo) ? 9999 : bo);
            return String(a.id).localeCompare(String(b.id));
          });
        siblings.forEach((b, i) => { b.sortOrder = i; });
        const idx = siblings.findIndex((b) => b.id === body.id);
        const swap = idx + (body.direction === 'up' ? -1 : 1);
        if (idx >= 0 && swap >= 0 && swap < siblings.length) {
          const tmp = siblings[idx].sortOrder;
          siblings[idx].sortOrder = siblings[swap].sortOrder;
          siblings[swap].sortOrder = tmp;
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, {
          ok: true,
          period,
          summary: budgetStore.periodSummary(budget, period),
        });
        return;
      }

      if (action === 'budget.plan.delete') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const budget = budgetStore.loadBudget(ctx.user.id);
        const period = budgetStore.findPeriod(budget, body.cycleKey)
          || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
        if (!period) {
          send(res, 404, { error: 'Ciclo no encontrado' });
          return;
        }
        if (!budgetStore.canEditPeriod(period)) {
          send(res, 403, {
            error: budgetStore.isPeriodClosed(period)
              ? 'Ciclo cerrado: no se puede modificar'
              : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
          });
          return;
        }
        if (!body.id) {
          send(res, 400, { error: 'Id de línea de presupuesto obligatorio' });
          return;
        }
        period.budget = (period.budget || []).filter((b) => b.id !== body.id);
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, {
          ok: true,
          period,
          summary: budgetStore.periodSummary(budget, period),
        });
        return;
      }

      if (action === 'budget.execution.save') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const amount = Number(body.amount);
        const currency = budgetStore.normalizeCurrency(body.currency);
        if (!body.categoryId || body.amount === '' || body.amount == null || isNaN(amount)) {
          send(res, 400, { error: 'Categoría y monto obligatorios' });
          return;
        }
        const budget = budgetStore.loadBudget(ctx.user.id);
        const cat = budgetStore.findCategory(budget, body.categoryId);
        if (!cat) {
          send(res, 404, { error: 'Categoría no encontrada' });
          return;
        }
        const period = budgetStore.findPeriod(budget, body.cycleKey)
          || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
        if (!period) {
          send(res, 404, { error: 'Ciclo no encontrado' });
          return;
        }
        if (!budgetStore.canEditPeriod(period)) {
          send(res, 403, {
            error: budgetStore.isPeriodClosed(period)
              ? 'Ciclo cerrado: no se puede modificar'
              : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
          });
          return;
        }
        if (currency === 'USD' && !(Number(period.exchangeRate) > 0)) {
          send(res, 400, { error: 'Definí el tipo de cambio del ciclo antes de usar USD' });
          return;
        }
        if (!Array.isArray(period.executions)) period.executions = [];
        if (body.id) {
          const ex = period.executions.find((x) => x.id === body.id);
          if (!ex) {
            send(res, 404, { error: 'Ejecución no encontrada' });
            return;
          }
          ex.categoryId = cat.id;
          ex.name = cat.name;
          ex.type = cat.type;
          ex.amount = amount;
          ex.currency = currency;
          ex.notes = String(body.notes || '').trim();
          ex.date = String(body.date || ex.date || period.startDate).slice(0, 10);
        } else {
          period.executions.push({
            id: budgetStore.uid('exe'),
            categoryId: cat.id,
            name: cat.name,
            type: cat.type,
            amount,
            currency,
            notes: String(body.notes || '').trim(),
            date: String(body.date || new Date().toISOString()).slice(0, 10),
          });
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, {
          ok: true,
          period,
          summary: budgetStore.periodSummary(budget, period),
          history: budgetStore.buildHistory(budget),
        });
        return;
      }

      if (action === 'budget.execution.delete') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const budget = budgetStore.loadBudget(ctx.user.id);
        const period = budgetStore.findPeriod(budget, body.cycleKey)
          || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
        if (!period) {
          send(res, 404, { error: 'Ciclo no encontrado' });
          return;
        }
        if (!budgetStore.canEditPeriod(period)) {
          send(res, 403, {
            error: budgetStore.isPeriodClosed(period)
              ? 'Ciclo cerrado: no se puede modificar'
              : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
          });
          return;
        }
        period.executions = (period.executions || []).filter((x) => x.id !== body.id);
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, {
          ok: true,
          period,
          summary: budgetStore.periodSummary(budget, period),
          history: budgetStore.buildHistory(budget),
        });
        return;
      }

      // ---- Préstamos históricos (no afectan presupuesto) ----
      if (action === 'budget.loan.save') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const person = String(body.person || '').trim();
        if (!person) {
          send(res, 400, { error: 'Nombre de la persona obligatorio' });
          return;
        }
        const side = body.side === 'borrowed' ? 'borrowed' : 'lent';
        const notes = String(body.notes || '').trim();
        const budget = budgetStore.loadBudget(ctx.user.id);
        if (!Array.isArray(budget.loans)) budget.loans = [];
        if (body.id) {
          const loan = budgetStore.findLoan(budget, body.id);
          if (!loan) {
            send(res, 404, { error: 'Préstamo no encontrado' });
            return;
          }
          loan.person = person;
          loan.side = side;
          loan.notes = notes;
        } else {
          budget.loans.push({
            id: budgetStore.uid('loan'),
            person,
            side,
            notes,
            movements: [],
            createdAt: new Date().toISOString(),
          });
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, loans: budget.loans });
        return;
      }

      if (action === 'budget.loan.delete') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const budget = budgetStore.loadBudget(ctx.user.id);
        budget.loans = (budget.loans || []).filter((l) => l.id !== body.id);
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, loans: budget.loans });
        return;
      }

      if (action === 'budget.loan.movement.save') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const amount = Number(body.amount);
        const currency = budgetStore.normalizeCurrency(body.currency);
        const sign = Number(body.sign) === -1 ? -1 : 1;
        if (!body.loanId || body.amount === '' || body.amount == null || isNaN(amount) || amount < 0) {
          send(res, 400, { error: 'Préstamo y monto obligatorios' });
          return;
        }
        const budget = budgetStore.loadBudget(ctx.user.id);
        const loan = budgetStore.findLoan(budget, body.loanId);
        if (!loan) {
          send(res, 404, { error: 'Préstamo no encontrado' });
          return;
        }
        if (currency === 'USD' && !(budgetStore.referenceExchangeRate(budget) > 0)) {
          send(res, 400, { error: 'Definí el tipo de cambio del ciclo para usar USD en préstamos' });
          return;
        }
        if (!Array.isArray(loan.movements)) loan.movements = [];
        const date = String(body.date || '').slice(0, 10) || budgetStore.todayIso();
        const note = String(body.note || '').trim();
        if (body.id) {
          const mov = loan.movements.find((m) => m.id === body.id);
          if (!mov) {
            send(res, 404, { error: 'Movimiento no encontrado' });
            return;
          }
          mov.amount = amount;
          mov.currency = currency;
          mov.sign = sign;
          mov.date = date;
          mov.note = note;
        } else {
          loan.movements.push({
            id: budgetStore.uid('lm'),
            amount,
            currency,
            sign,
            date,
            note,
            createdAt: new Date().toISOString(),
          });
        }
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, loans: budget.loans });
        return;
      }

      if (action === 'budget.loan.movement.delete') {
        const ctx = requireAuth(req, res);
        if (!ctx) return;
        const budget = budgetStore.loadBudget(ctx.user.id);
        const loan = budgetStore.findLoan(budget, body.loanId);
        if (!loan) {
          send(res, 404, { error: 'Préstamo no encontrado' });
          return;
        }
        loan.movements = (loan.movements || []).filter((m) => m.id !== body.id);
        budgetStore.saveBudget(ctx.user.id, budget);
        send(res, 200, { ok: true, loans: budget.loans });
        return;
      }

      send(res, 400, { error: 'unknown action' });
      return;
    }

    send(res, 405, { error: 'method not allowed' });
    return;
  }

  let filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' && filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  ensureUsersFile();
  reloadBudgetStore();
  // Smoke test: día inicio 22 desde 1/10 → fin 21/10 (nunca el 22)
  const probe = budgetStore.resolveCutEndDate('2026-10-01', 22, '2026-10-20');
  console.log(`ExhaTech → http://localhost:${PORT}`);
  console.log(`Presupuesto → http://localhost:${PORT}/eh-mnt.html`);
  console.log('Yurguen: usuarios en data/users.local.json (hashes, no va a Git).');
  console.log('Login → admin (admin) | yurguen (user) — clave Gunner00');
  console.log('Check ciclo: inicio 22 desde 01/10 → fin', probe, probe === '2026-10-21' ? 'OK' : 'FALLÓ');
});
