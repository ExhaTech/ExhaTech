/**
 * Yurguen: presupuesto por usuario — catálogo, plan, ejecución, ciclos cifrados
 * Montos CRC/USD; tipo de cambio por ciclo; totales siempre en colones.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cobrosCrypto = require('./cobros-crypto');

const BUDGETS_DIR = path.join(__dirname, '..', 'data', 'budgets');
const MASTER_KEY_FILE = path.join(__dirname, '..', 'data', 'budget.master.local');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

/**
 * Llave AES-256 (hex 64 chars).
 * Prioridad: env BUDGET_MASTER_KEY (Cloudflare/prod) → data/budget.master.local (dev).
 * Nunca va a Git. Sin la misma llave, los .json cifrados de budgets/ no se pueden leer.
 */
function ensureMasterKey() {
  const fromEnv = String(process.env.BUDGET_MASTER_KEY || '').trim();
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error('BUDGET_MASTER_KEY inválida (mín. 32 caracteres)');
    }
    return fromEnv;
  }
  if (fs.existsSync(MASTER_KEY_FILE)) {
    return fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
  }
  const dir = path.dirname(MASTER_KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(MASTER_KEY_FILE, key, 'utf8');
  console.log('Yurguen: creé data/budget.master.local (NO va a Git; respaldala aparte).');
  return key;
}

function budgetFilePath(userId) {
  return path.join(BUDGETS_DIR, userId + '.json');
}

function emptyBudget() {
  return {
    categories: [],
    periods: [],
    loans: [],
  };
}

function normalizeCurrency(c) {
  return String(c || 'CRC').toUpperCase() === 'USD' ? 'USD' : 'CRC';
}

/** Yurguen: colones por 1 USD del ciclo */
function normalizeExchangeRate(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return 0;
  return v;
}

/** Convierte monto a colones usando el tipo de cambio del ciclo */
function toCrc(amount, currency, exchangeRate) {
  const n = Number(amount) || 0;
  if (normalizeCurrency(currency) === 'USD') {
    const rate = normalizeExchangeRate(exchangeRate);
    return n * rate;
  }
  return n;
}

function isPeriodClosed(period) {
  return !!(period && period.status === 'closed');
}

function todayIso() {
  return toIsoDate(new Date());
}

/** Ciclo abierto pero la fecha de fin ya pasó → hay que cerrarlo */
function isPeriodExpired(period) {
  if (!period || period.status === 'closed') return false;
  if (!period.endDate) return false;
  return String(period.endDate) < todayIso();
}

/** Se puede editar plan/ejecución/TC solo si está abierto y no vencido */
function canEditPeriod(period) {
  return !!(period && period.status !== 'closed' && !isPeriodExpired(period));
}

/**
 * Se puede cerrar desde el último día del ciclo (endDate <= hoy).
 * No se permite cierre anticipado.
 */
function canClosePeriod(period) {
  if (!period || period.status === 'closed' || !period.endDate) return false;
  return String(period.endDate) <= todayIso();
}

function findCategory(budget, categoryId) {
  return (budget.categories || []).find((c) => c.id === categoryId) || null;
}

/**
 * Modelo: categoría (+ comentario) = qué; plan = tope del ciclo; ejecución = movimientos.
 * Migra y elimina rubros (dev).
 */
function normalizeBudget(data) {
  if (!data || typeof data !== 'object') return emptyBudget();
  if (!Array.isArray(data.categories)) data.categories = [];
  if (!Array.isArray(data.periods)) data.periods = [];
  if (!Array.isArray(data.loans)) data.loans = [];
  const oldRubros = Array.isArray(data.rubros) ? data.rubros : [];

  // Rubros huérfanos → categorías nuevas
  oldRubros.forEach((r) => {
    if (r.categoryId && findCategory(data, r.categoryId)) return;
    const cat = {
      id: uid('cat'),
      name: String(r.name || 'Sin nombre').trim() || 'Sin nombre',
      type: r.type === 'income' ? 'income' : 'expense',
      description: String(r.description || ''),
      createdAt: r.createdAt || new Date().toISOString(),
    };
    data.categories.push(cat);
    r.categoryId = cat.id;
  });

  data.categories.forEach((c, idx) => {
    c.type = c.type === 'income' ? 'income' : 'expense';
    if (c.description == null) c.description = '';
    else c.description = String(c.description);
    // Orden manual en la UI; si falta, usa el índice actual
    if (c.sortOrder == null || isNaN(Number(c.sortOrder))) c.sortOrder = idx;
    else c.sortOrder = Number(c.sortOrder);
  });

  data.loans = data.loans.map((loan) => {
    const movements = Array.isArray(loan.movements) ? loan.movements : [];
    return {
      id: loan.id || uid('loan'),
      person: String(loan.person || '').trim() || 'Sin nombre',
      side: loan.side === 'borrowed' ? 'borrowed' : 'lent',
      notes: String(loan.notes || ''),
      createdAt: loan.createdAt || null,
      movements: movements.map((m) => ({
        id: m.id || uid('lm'),
        date: String(m.date || '').slice(0, 10) || null,
        amount: Number(m.amount) || 0,
        currency: normalizeCurrency(m.currency),
        sign: Number(m.sign) === -1 ? -1 : 1,
        note: String(m.note || ''),
        createdAt: m.createdAt || null,
      })),
    };
  });

  data.periods.forEach((p) => {
    if (!Array.isArray(p.budget)) p.budget = [];
    if (!Array.isArray(p.executions)) p.executions = [];
    p.exchangeRate = normalizeExchangeRate(p.exchangeRate);
    p.status = p.status === 'closed' ? 'closed' : 'open';
    if (p.status !== 'closed') p.closedAt = null;

    // Plan → varias líneas por categoría (etiqueta + orden manual)
    const catLineIdx = {};
    p.budget = p.budget
      .map((line) => {
        let categoryId = line.categoryId || null;
        if (!categoryId && line.rubroId) {
          const rubro = oldRubros.find((r) => r.id === line.rubroId);
          categoryId = (rubro && rubro.categoryId) || null;
        }
        if (!categoryId || !findCategory(data, categoryId)) return null;
        // tag = etiqueta visible; se acepta también label/planLabel viejos
        const tag = String(
          line.tag || line.label || line.planLabel || ''
        ).trim();
        if (catLineIdx[categoryId] == null) catLineIdx[categoryId] = 0;
        let sortOrder = Number(line.sortOrder);
        if (isNaN(sortOrder)) {
          sortOrder = catLineIdx[categoryId];
        }
        catLineIdx[categoryId] += 1;
        return {
          id: line.id || uid('plan'),
          categoryId,
          planned: Number(line.planned) || 0,
          currency: normalizeCurrency(line.currency),
          tag,
          label: tag,
          sortOrder,
        };
      })
      .filter(Boolean);

    // Ejecución → categoría (sin rubro)
    p.executions = p.executions.map((ex) => {
      let categoryId = ex.categoryId || null;
      if (!categoryId && ex.rubroId) {
        const rubro = oldRubros.find((r) => r.id === ex.rubroId);
        categoryId = (rubro && rubro.categoryId) || null;
      }
      const cat = findCategory(data, categoryId);
      return {
        id: ex.id || uid('exe'),
        categoryId: categoryId || null,
        name: (cat && cat.name) || ex.name || '—',
        type: (cat && cat.type) || (ex.type === 'income' ? 'income' : 'expense'),
        amount: Number(ex.amount) || 0,
        currency: normalizeCurrency(ex.currency),
        notes: String(ex.notes || ''),
        date: String(ex.date || '').slice(0, 10) || null,
      };
    });

    if (Array.isArray(p.items) && p.items.length) {
      p.items.forEach((it) => {
        let cat = findCategory(data, it.categoryId);
        if (!cat) {
          cat = {
            id: uid('cat'),
            name: String(it.name || 'Sin nombre'),
            type: it.type === 'income' ? 'income' : 'expense',
            description: '',
            createdAt: new Date().toISOString(),
          };
          data.categories.push(cat);
        }
        p.executions.push({
          id: it.id || uid('exe'),
          categoryId: cat.id,
          name: cat.name,
          type: cat.type,
          amount: Number(it.amount) || 0,
          currency: 'CRC',
          notes: it.notes || '',
          date: it.createdAt ? String(it.createdAt).slice(0, 10) : null,
        });
        if (!p.budget.find((b) => b.categoryId === cat.id)) {
          p.budget.push({
            id: uid('plan'),
            categoryId: cat.id,
            planned: Number(it.amount) || 0,
            currency: 'CRC',
          });
        }
      });
      p.items = [];
    }
  });

  // Ya no usamos rubros
  data.rubros = [];
  return data;
}

function loadBudget(userId) {
  ensureMasterKey();
  const file = budgetFilePath(userId);
  if (!fs.existsSync(file)) return emptyBudget();
  const raw = fs.readFileSync(file, 'utf8');
  let data;
  if (cobrosCrypto.isEncryptedFile(raw)) {
    data = cobrosCrypto.decryptJson(JSON.parse(raw), ensureMasterKey());
  } else {
    data = JSON.parse(raw);
  }
  return normalizeBudget(data);
}

function saveBudget(userId, data) {
  const key = ensureMasterKey();
  if (!fs.existsSync(BUDGETS_DIR)) fs.mkdirSync(BUDGETS_DIR, { recursive: true });
  const envelope = cobrosCrypto.encryptJson(normalizeBudget(data), key);
  fs.writeFileSync(budgetFilePath(userId), JSON.stringify(envelope, null, 2), 'utf8');
}

function cycleForDate(billingDayStart, refDate) {
  const day = Math.min(28, Math.max(1, Number(billingDayStart) || 1));
  const ref = refDate ? new Date(refDate) : new Date();
  ref.setHours(12, 0, 0, 0);
  let start = new Date(ref.getFullYear(), ref.getMonth(), day, 12, 0, 0, 0);
  if (ref.getDate() < day) {
    start = new Date(ref.getFullYear(), ref.getMonth() - 1, day, 12, 0, 0, 0);
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, day - 1, 12, 0, 0, 0);
  const key = start.getFullYear() + '-' + pad2(start.getMonth() + 1) + '-d' + pad2(day);
  return {
    key,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    billingDayStart: day,
  };
}

function shiftCycle(billingDayStart, cycleKey, delta) {
  const day = Math.min(28, Math.max(1, Number(billingDayStart) || 1));
  let start;
  if (cycleKey && /^\d{4}-\d{2}-d\d{2}$/.test(cycleKey)) {
    const y = Number(cycleKey.slice(0, 4));
    const m = Number(cycleKey.slice(5, 7)) - 1;
    start = new Date(y, m + delta, day, 12, 0, 0, 0);
  } else {
    const cur = cycleForDate(day);
    const parts = cur.startDate.split('-');
    start = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, day, 12, 0, 0, 0);
  }
  return cycleForDate(day, start);
}

function addDaysIso(isoDate, delta) {
  const parts = String(isoDate || '').split('-');
  if (parts.length !== 3) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + delta);
    return toIsoDate(d);
  }
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  return toIsoDate(d);
}

/**
 * Yurguen: al cambiar corte nunca se corta hacia atrás:
 * startDate no avanza; endDate no retrocede. Solo se puede extender.
 */
function mergePeriodDates(period, cycle) {
  if (!period.startDate || String(cycle.startDate) < String(period.startDate)) {
    period.startDate = cycle.startDate;
  }
  if (!period.endDate || String(cycle.endDate) > String(period.endDate)) {
    period.endDate = cycle.endDate;
  }
}

function findPeriod(budget, cycleKey) {
  if (!cycleKey) return null;
  return (budget.periods || []).find((x) => x.key === cycleKey) || null;
}

/** Crea un ciclo solo si no existe. No recalcula fechas de ciclos ya guardados. */
function ensurePeriod(budget, cycle) {
  let p = budget.periods.find((x) => x.key === cycle.key);
  if (!p) {
    p = {
      key: cycle.key,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      exchangeRate: 0,
      status: 'open',
      closedAt: null,
      budget: [],
      executions: [],
    };
    budget.periods.push(p);
  } else if (p.status === 'closed') {
    // Ciclo cerrado: no tocar fechas, TC ni montos
    if (!Array.isArray(p.budget)) p.budget = [];
    if (!Array.isArray(p.executions)) p.executions = [];
  } else {
    if (!Array.isArray(p.budget)) p.budget = [];
    if (!Array.isArray(p.executions)) p.executions = [];
    p.exchangeRate = normalizeExchangeRate(p.exchangeRate);
    p.status = 'open';
  }
  return p;
}

/**
 * Primer ciclo del usuario: usa el corte solo como punto de partida.
 * Si ya hay ciclos guardados, no inventa ninguno.
 */
function bootstrapFirstPeriod(budget, billingDayStart) {
  if ((budget.periods || []).length) {
    return findPeriod(budget, resolveDefaultCycleKey(budget));
  }
  const seed = cycleForDate(billingDayStart);
  return ensurePeriod(budget, seed);
}

/** Primera fecha con día `day` estrictamente posterior a afterIso (YYYY-MM-DD). */
function nextStartDayAfter(afterIso, day) {
  const p = String(afterIso).slice(0, 10).split('-').map(Number);
  const y = p[0];
  const mIndex = p[1] - 1;
  let cand = toIsoDate(new Date(y, mIndex, day, 12, 0, 0, 0));
  if (cand <= afterIso) {
    cand = toIsoDate(new Date(y, mIndex + 1, day, 12, 0, 0, 0));
  }
  return cand;
}

/**
 * Día N = día de INICIO del ciclo (no es el fin).
 * Fin = día anterior al próximo N.
 * Ej. N=22 y periodo desde 1/10 → fin 21/10 (el 22 arranca el siguiente).
 * Ej. N=1 → fin = último día del mes.
 */
function resolveCutEndDate(startDate, billingDay, refToday) {
  const day = Math.min(28, Math.max(1, Number(billingDay) || 1));
  const today = refToday || todayIso();
  const start = String(startDate || today).slice(0, 10);
  const floor = start > today ? start : today;

  let nextStart = nextStartDayAfter(start, day);
  let endIso = addDaysIso(nextStart, -1);

  // Si el fin natural ya pasó (antes de hoy), saltar al siguiente ciclo
  while (endIso < floor) {
    nextStart = nextStartDayAfter(nextStart, day);
    endIso = addDaysIso(nextStart, -1);
  }
  return endIso;
}

/**
 * Sincroniza el FIN del ciclo abierto según el día de inicio (el startDate no cambia).
 * Fin = día anterior al próximo inicio. No puede quedar antes de hoy.
 */
function syncOpenPeriodEndToCutDay(budget, billingDay) {
  const day = Math.min(28, Math.max(1, Number(billingDay) || 1));
  const open = (budget.periods || [])
    .filter((p) => p.status !== 'closed')
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0];
  if (!open) return { period: null, changed: false };
  const newEnd = resolveCutEndDate(open.startDate, day);
  if (String(newEnd) < todayIso()) {
    const err = new Error('El fin del periodo no puede ser antes de hoy.');
    err.code = 'cut_in_past';
    throw err;
  }
  const changed = String(open.endDate || '') !== String(newEnd);
  open.endDate = newEnd;
  return { period: open, newEnd, changed };
}

/** @deprecated usar syncOpenPeriodEndToCutDay */
function applyBillingDayChange(budget, oldDay, newDay) {
  return syncOpenPeriodEndToCutDay(budget, newDay);
}

/** Conserva los 13 ciclos más recientes por fecha guardada (no por calendario). */
function purgeOldPeriods(budget) {
  const sorted = (budget.periods || []).slice().sort(function (a, b) {
    return String(b.startDate || '').localeCompare(String(a.startDate || ''));
  });
  const before = sorted.length;
  budget.periods = sorted.slice(0, 13);
  return before - budget.periods.length;
}

/**
 * Solo ciclos guardados. Sin datos → lista vacía (no se inventan por corte).
 */
function listCycles(budget) {
  return (budget.periods || [])
    .slice()
    .sort(function (a, b) {
      return String(b.startDate || '').localeCompare(String(a.startDate || ''));
    })
    .map(function (p) {
      return {
        key: p.key,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status === 'closed' ? 'closed' : 'open',
        exchangeRate: normalizeExchangeRate(p.exchangeRate),
      };
    });
}

/** Ciclo activo: abierto más reciente; si no hay abierto, el guardado más reciente. */
function resolveDefaultCycleKey(budget) {
  const opens = (budget.periods || [])
    .filter((p) => p.status !== 'closed')
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  if (opens.length) return opens[0].key;
  const all = listCycles(budget);
  return all.length ? all[0].key : null;
}

/** Crea el ciclo siguiente a partir del cerrado (fechas propias, no calendario fantasma). */
function createNextPeriod(budget, closedPeriod, billingDayStart) {
  const startDate = addDaysIso(closedPeriod.endDate || closedPeriod.startDate, 1);
  const provisional = cycleForDate(billingDayStart, startDate);
  let endDate = provisional.endDate;
  if (String(endDate) < String(startDate)) endDate = startDate;
  let key = provisional.key;
  if (findPeriod(budget, key)) key = uid('cyc');
  const next = ensurePeriod(budget, { key, startDate, endDate });
  next.status = 'open';
  next.closedAt = null;
  next.startDate = startDate;
  next.endDate = endDate;
  if (!next.exchangeRate) next.exchangeRate = normalizeExchangeRate(closedPeriod.exchangeRate);
  return { next, nextCycle: { key, startDate, endDate, billingDayStart: Number(billingDayStart) || 1 } };
}

/** @deprecated rubros eliminados; se mantiene por compat de exports */
function findRubro() {
  return null;
}

/** Planeado / ejecutado / restante de una categoría en el ciclo (₡) */
function categoryPeriodStats(budget, period, categoryId) {
  const rate = normalizeExchangeRate(period && period.exchangeRate);
  const cat = findCategory(budget, categoryId);
  let planned = 0;
  let actual = 0;
  (period.budget || []).forEach((line) => {
    if (line.categoryId !== categoryId) return;
    planned += toCrc(line.planned, line.currency, rate);
  });
  (period.executions || []).forEach((ex) => {
    if (ex.categoryId !== categoryId) return;
    actual += toCrc(ex.amount, ex.currency, rate);
  });
  return {
    categoryId,
    type: (cat && cat.type) || 'expense',
    planned,
    actual,
    remaining: planned - actual,
  };
}

function findLoan(budget, loanId) {
  return (budget.loans || []).find((l) => l.id === loanId) || null;
}

/** Saldo del préstamo en colones (histórico; no entra al presupuesto) */
function loanBalanceCrc(loan, exchangeRate) {
  const rate = normalizeExchangeRate(exchangeRate);
  let total = 0;
  (loan.movements || []).forEach((m) => {
    const sign = Number(m.sign) === -1 ? -1 : 1;
    total += sign * toCrc(m.amount, m.currency, rate);
  });
  return total;
}

/** Tipo de cambio de referencia: ciclo abierto, o el más reciente con TC */
function referenceExchangeRate(budget) {
  const open = (budget.periods || []).find((p) => p.status !== 'closed');
  if (open && Number(open.exchangeRate) > 0) return normalizeExchangeRate(open.exchangeRate);
  const withRate = (budget.periods || [])
    .slice()
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))
    .find((p) => Number(p.exchangeRate) > 0);
  return withRate ? normalizeExchangeRate(withRate.exchangeRate) : 0;
}

/** Totales siempre en colones — plan y ejecución por categoría */
function periodSummary(budget, period) {
  let plannedIncome = 0;
  let plannedExpense = 0;
  let actualIncome = 0;
  let actualExpense = 0;
  const byCategory = {};
  const rate = normalizeExchangeRate(period && period.exchangeRate);

  (period.budget || []).forEach((line) => {
    const cat = findCategory(budget, line.categoryId);
    const plannedCrc = toCrc(line.planned, line.currency, rate);
    if (!cat) return;
    if (cat.type === 'income') plannedIncome += plannedCrc;
    else plannedExpense += plannedCrc;
  });

  (period.executions || []).forEach((ex) => {
    const cat = findCategory(budget, ex.categoryId);
    const type = (cat && cat.type) || ex.type || 'expense';
    const n = toCrc(ex.amount, ex.currency, rate);
    if (type === 'income') {
      actualIncome += n;
      return;
    }
    actualExpense += n;
    const catId = ex.categoryId || 'none';
    if (!byCategory[catId]) byCategory[catId] = 0;
    byCategory[catId] += n;
  });

  return {
    plannedIncome,
    plannedExpense,
    actualIncome,
    actualExpense,
    plannedBalance: plannedIncome - plannedExpense,
    actualBalance: actualIncome - actualExpense,
    byCategory,
    exchangeRate: rate,
    currencyBase: 'CRC',
  };
}

function buildHistory(budget) {
  const rows = [];
  (budget.periods || []).forEach((p) => {
    const rate = normalizeExchangeRate(p.exchangeRate);
    (p.executions || []).forEach((ex) => {
      const currency = normalizeCurrency(ex.currency);
      const amount = Number(ex.amount) || 0;
      rows.push({
        cycleKey: p.key,
        startDate: p.startDate,
        endDate: p.endDate,
        periodStatus: p.status === 'closed' ? 'closed' : 'open',
        id: ex.id,
        name: ex.name,
        categoryId: ex.categoryId,
        type: ex.type || 'expense',
        amount,
        currency,
        amountCrc: toCrc(amount, currency, rate),
        exchangeRate: rate,
        notes: ex.notes || '',
        date: ex.date || p.startDate,
      });
    });
  });
  rows.sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date));
  });
  return rows;
}

/**
 * Cierra el ciclo y lo congela para siempre:
 * tipo de cambio, fechas e info (plan/ejecución) quedan inmutables.
 * El siguiente ciclo arranca con una copia del TC solo como punto de partida.
 */
function closePeriod(budget, cycleKey, billingDayStart) {
  const period = findPeriod(budget, cycleKey);
  if (!period) {
    const err = new Error('Ciclo no encontrado');
    err.code = 'not_found';
    throw err;
  }
  if (isPeriodClosed(period)) {
    const err = new Error('Este ciclo ya está cerrado');
    err.code = 'already_closed';
    throw err;
  }
  if (!canClosePeriod(period)) {
    const err = new Error(
      'No se puede cerrar el ciclo hasta el último día (' +
        (period.endDate || '') +
        ').'
    );
    err.code = 'cut_not_reached';
    throw err;
  }
  // Congelar snapshot actual — no se recalcula ni se vuelve a editar
  period.status = 'closed';
  period.closedAt = new Date().toISOString();
  period.exchangeRate = normalizeExchangeRate(period.exchangeRate);
  period.startDate = String(period.startDate || '').slice(0, 10);
  period.endDate = String(period.endDate || '').slice(0, 10);
  if (!Array.isArray(period.budget)) period.budget = [];
  if (!Array.isArray(period.executions)) period.executions = [];
  period.budget = period.budget.map((line, idx) => {
    const tag = String(line.tag || line.label || line.planLabel || '').trim();
    let sortOrder = Number(line.sortOrder);
    if (isNaN(sortOrder)) sortOrder = idx;
    return {
      id: line.id || uid('plan'),
      categoryId: line.categoryId,
      planned: Number(line.planned) || 0,
      currency: normalizeCurrency(line.currency),
      tag,
      label: tag,
      sortOrder,
    };
  });
  period.executions = period.executions.map((ex) => ({
    id: ex.id || uid('exe'),
    name: ex.name || '',
    categoryId: ex.categoryId || null,
    type: ex.type === 'income' ? 'income' : 'expense',
    amount: Number(ex.amount) || 0,
    currency: normalizeCurrency(ex.currency),
    notes: ex.notes || '',
    date: String(ex.date || period.startDate).slice(0, 10),
  }));
  const created = createNextPeriod(budget, period, billingDayStart);
  return { closed: period, next: created.next, nextCycle: created.nextCycle };
}

module.exports = {
  uid,
  loadBudget,
  saveBudget,
  normalizeBudget,
  normalizeCurrency,
  normalizeExchangeRate,
  toCrc,
  isPeriodClosed,
  isPeriodExpired,
  canEditPeriod,
  canClosePeriod,
  todayIso,
  cycleForDate,
  shiftCycle,
  ensurePeriod,
  findPeriod,
  bootstrapFirstPeriod,
  createNextPeriod,
  mergePeriodDates,
  applyBillingDayChange,
  syncOpenPeriodEndToCutDay,
  resolveCutEndDate,
  purgeOldPeriods,
  listCycles,
  resolveDefaultCycleKey,
  periodSummary,
  buildHistory,
  closePeriod,
  findRubro,
  findCategory,
  categoryPeriodStats,
  findLoan,
  loanBalanceCrc,
  referenceExchangeRate,
  emptyBudget,
};
