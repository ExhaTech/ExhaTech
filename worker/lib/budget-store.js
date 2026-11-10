/**
 * Yurguen: presupuesto por usuario — catálogo, plan, ejecución y ciclos.
 * Versión Worker: solo helpers puros; el I/O vive en `budget-io.js`.
 */
import crypto from 'node:crypto';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

export function emptyBudget() {
  return {
    categories: [],
    paymentTypes: [],
    periods: [],
    loans: [],
  };
}

export function normalizeCurrency(c) {
  return String(c || 'CRC').toUpperCase() === 'USD' ? 'USD' : 'CRC';
}

/** Yurguen: colones por 1 USD del ciclo */
export function normalizeExchangeRate(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return 0;
  return v;
}

/** Convierte monto a colones usando el tipo de cambio del ciclo */
export function toCrc(amount, currency, exchangeRate) {
  const n = Number(amount) || 0;
  if (normalizeCurrency(currency) === 'USD') {
    const rate = normalizeExchangeRate(exchangeRate);
    return n * rate;
  }
  return n;
}

export function isPeriodClosed(period) {
  return !!(period && period.status === 'closed');
}

export function todayIso() {
  return toIsoDate(new Date());
}

/** Ciclo abierto pero la fecha de fin ya pasó → hay que cerrarlo */
export function isPeriodExpired(period) {
  if (!period || period.status === 'closed') return false;
  if (!period.endDate) return false;
  return String(period.endDate) < todayIso();
}

/** Se puede editar plan/ejecución/TC solo si está abierto y no vencido */
export function canEditPeriod(period) {
  return !!(period && period.status !== 'closed' && !isPeriodExpired(period));
}

/**
 * Se puede cerrar desde el último día del ciclo (endDate <= hoy).
 * No se permite cierre anticipado.
 */
export function canClosePeriod(period) {
  if (!period || period.status === 'closed' || !period.endDate) return false;
  return String(period.endDate) <= todayIso();
}

export function findCategory(budget, categoryId) {
  return (budget.categories || []).find((c) => c.id === categoryId) || null;
}

export function findPaymentType(budget, paymentTypeId) {
  const id = String(paymentTypeId || '');
  if (!id) return null;
  return (budget.paymentTypes || []).find((p) => p.id === id) || null;
}

/**
 * Uso de un tipo de pago solo en ciclos abiertos (los cerrados no bloquean).
 */
export function paymentTypeUsage(budget, paymentTypeId) {
  const id = String(paymentTypeId || '');
  let executions = 0;
  if (!id) return { executions };
  (budget.periods || []).forEach((p) => {
    if (isPeriodClosed(p)) return;
    (p.executions || []).forEach((ex) => {
      if (String(ex.paymentTypeId || '') !== id) return;
      executions += 1;
    });
  });
  return { executions };
}

/**
 * ¿Se puede borrar el tipo de pago?
 * Solo mira ciclos abiertos: si hay ejecución asociada, no.
 */
export function assertPaymentTypeDeletable(budget, paymentTypeId) {
  const u = paymentTypeUsage(budget, paymentTypeId);
  if (u.executions > 0) {
    const err = new Error(
      'No se puede eliminar el tipo de pago: en el ciclo actual tiene ' +
        u.executions +
        ' movimiento(s) de ejecución. Borralos o dejá el tipo.'
    );
    err.code = 'payment_type_in_use';
    throw err;
  }
  return u;
}

export function findPlanLine(period, planLineId) {
  const id = String(planLineId || '');
  if (!id || !period) return null;
  return (period.budget || []).find((l) => l.id === id) || null;
}

export function planLineTagOf(line) {
  if (!line) return '';
  return String(line.tag || line.label || line.planLabel || '').trim();
}

/**
 * Uso de una línea de plan solo dentro del mismo ciclo (las líneas no cruzan periodos).
 */
export function planLineUsageInPeriod(period, planLineId) {
  const id = String(planLineId || '');
  let executions = 0;
  if (!id || !period) return { executions };
  (period.executions || []).forEach((ex) => {
    if (String(ex.planLineId || '') !== id) return;
    executions += 1;
  });
  return { executions };
}

/**
 * ¿Se puede borrar la línea de presupuesto?
 * Si hay movimientos del ciclo ligados a esa línea, no.
 */
export function assertPlanLineDeletable(period, planLineId) {
  const u = planLineUsageInPeriod(period, planLineId);
  if (u.executions > 0) {
    const err = new Error(
      'No se puede eliminar la línea de presupuesto: tiene ' +
        u.executions +
        ' movimiento(s) de ejecución asociados. Borralos o dejá la línea.'
    );
    err.code = 'plan_line_in_use';
    throw err;
  }
  return u;
}

/**
 * Uso de una categoría solo en ciclos abiertos (los cerrados son histórico y no bloquean).
 */
export function categoryUsage(budget, categoryId) {
  const id = String(categoryId || '');
  let planLines = 0;
  let executions = 0;
  (budget.periods || []).forEach((p) => {
    if (isPeriodClosed(p)) return;
    (p.budget || []).forEach((line) => {
      if (String(line.categoryId || '') !== id) return;
      planLines += 1;
    });
    (p.executions || []).forEach((ex) => {
      if (String(ex.categoryId || '') !== id) return;
      executions += 1;
    });
  });
  return { planLines, executions };
}

/** true si el periodo tiene ejecución ligada a la categoría */
export function periodHasExecutionForCategory(period, categoryId) {
  const id = String(categoryId || '');
  if (!id || !period) return false;
  return (period.executions || []).some((ex) => String(ex.categoryId || '') === id);
}

/**
 * ¿Se puede borrar la categoría?
 * Solo mira el ciclo abierto: si hay ejecución, no. Plan sin ejecución se limpia en cascada.
 * Ciclos cerrados no se tocan ni bloquean el borrado del catálogo.
 */
export function assertCategoryDeletable(budget, categoryId) {
  const u = categoryUsage(budget, categoryId);
  if (u.executions > 0) {
    const err = new Error(
      'No se puede eliminar la categoría: en el ciclo actual tiene ' +
        u.executions +
        ' movimiento(s) de ejecución. Borralos o dejá la categoría.'
    );
    err.code = 'category_in_use';
    throw err;
  }
  return u;
}

/**
 * Modelo: categoría (+ comentario) = qué; plan = tope del ciclo; ejecución = movimientos.
 * Migra y elimina rubros (dev).
 */
export function normalizeBudget(data) {
  if (!data || typeof data !== 'object') return emptyBudget();
  if (!Array.isArray(data.categories)) data.categories = [];
  if (!Array.isArray(data.paymentTypes)) data.paymentTypes = [];
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

  // Catálogo de tipos de pago (opcional en cada movimiento ejecutado)
  data.paymentTypes = data.paymentTypes
    .map((pt, idx) => {
      const name = String(pt && pt.name != null ? pt.name : '').trim();
      if (!name) return null;
      let sortOrder = Number(pt.sortOrder);
      if (isNaN(sortOrder)) sortOrder = idx;
      return {
        id: (pt && pt.id) || uid('pay'),
        name,
        sortOrder,
        createdAt: (pt && pt.createdAt) || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.name).localeCompare(String(b.name), 'es');
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

    // Ejecución → categoría (+ tipo de pago y línea de plan opcionales)
    p.executions = p.executions.map((ex) => {
      let categoryId = ex.categoryId || null;
      if (!categoryId && ex.rubroId) {
        const rubro = oldRubros.find((r) => r.id === ex.rubroId);
        categoryId = (rubro && rubro.categoryId) || null;
      }
      const cat = findCategory(data, categoryId);
      const rawPayId = String(ex.paymentTypeId || '').trim();
      const pay = rawPayId ? findPaymentType(data, rawPayId) : null;
      const paymentTypeId = pay ? pay.id : (rawPayId || null);
      const rawPlanId = String(ex.planLineId || '').trim();
      let planLine = rawPlanId ? findPlanLine(p, rawPlanId) : null;
      // La línea debe pertenecer a la misma categoría del movimiento
      if (planLine && categoryId && String(planLine.categoryId) !== String(categoryId)) {
        planLine = null;
      }
      const planLineId = planLine ? planLine.id : (rawPlanId || null);
      return {
        id: ex.id || uid('exe'),
        categoryId: categoryId || null,
        name: (cat && cat.name) || ex.name || '—',
        type: (cat && cat.type) || (ex.type === 'income' ? 'income' : 'expense'),
        amount: Number(ex.amount) || 0,
        currency: normalizeCurrency(ex.currency),
        notes: String(ex.notes || ''),
        date: String(ex.date || '').slice(0, 10) || null,
        paymentTypeId,
        paymentTypeName: (pay && pay.name) || String(ex.paymentTypeName || ''),
        planLineId,
        planLineTag: planLine ? planLineTagOf(planLine) : String(ex.planLineTag || ''),
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
          paymentTypeId: null,
          paymentTypeName: '',
          planLineId: null,
          planLineTag: '',
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

export function cycleForDate(billingDayStart, refDate) {
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

export function shiftCycle(billingDayStart, cycleKey, delta) {
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
export function mergePeriodDates(period, cycle) {
  if (!period.startDate || String(cycle.startDate) < String(period.startDate)) {
    period.startDate = cycle.startDate;
  }
  if (!period.endDate || String(cycle.endDate) > String(period.endDate)) {
    period.endDate = cycle.endDate;
  }
}

export function findPeriod(budget, cycleKey) {
  if (!cycleKey) return null;
  return (budget.periods || []).find((x) => x.key === cycleKey) || null;
}

/** Crea un ciclo solo si no existe. No recalcula fechas de ciclos ya guardados. */
export function ensurePeriod(budget, cycle) {
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
export function bootstrapFirstPeriod(budget, billingDayStart) {
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
 * Fin = día anterior al próximo N (fin natural; puede quedar en el pasado).
 * Ej. N=22 y periodo desde 1/10 → fin 21/10 (el 22 arranca el siguiente).
 * Ej. N=1 → fin = último día del mes.
 * refToday solo se usa si falta startDate (compat API / smoke tests).
 */
export function resolveCutEndDate(startDate, billingDay, refToday) {
  const day = Math.min(28, Math.max(1, Number(billingDay) || 1));
  const today = refToday || todayIso();
  const start = String(startDate || today).slice(0, 10);
  const nextStart = nextStartDayAfter(start, day);
  return addDaysIso(nextStart, -1);
}

/**
 * Sincroniza el FIN del ciclo abierto según el día de inicio (el startDate no cambia).
 * Fin = día anterior al próximo inicio. Si ese fin ya pasó, se fija igual
 * (periodo vencido y cerrable); no se estira al siguiente corte.
 */
export function syncOpenPeriodEndToCutDay(budget, billingDay) {
  const day = Math.min(28, Math.max(1, Number(billingDay) || 1));
  const open = (budget.periods || [])
    .filter((p) => p.status !== 'closed')
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0];
  if (!open) return { period: null, changed: false };
  const newEnd = resolveCutEndDate(open.startDate, day);
  const changed = String(open.endDate || '') !== String(newEnd);
  open.endDate = newEnd;
  return {
    period: open,
    newEnd,
    changed,
    expired: String(newEnd) < todayIso(),
  };
}

/** @deprecated usar syncOpenPeriodEndToCutDay */
export function applyBillingDayChange(budget, oldDay, newDay) {
  return syncOpenPeriodEndToCutDay(budget, newDay);
}

/** Conserva los 13 ciclos más recientes por fecha guardada (no por calendario). */
export function purgeOldPeriods(budget) {
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
export function listCycles(budget) {
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
export function resolveDefaultCycleKey(budget) {
  const opens = (budget.periods || [])
    .filter((p) => p.status !== 'closed')
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  if (opens.length) return opens[0].key;
  const all = listCycles(budget);
  return all.length ? all[0].key : null;
}

/** Copia líneas de plan (nuevos ids). No copia ejecución. */
export function copyPlanLinesFrom(sourceLines) {
  return (sourceLines || []).map((line, idx) => {
    const tag = String(line.tag || line.label || line.planLabel || '').trim();
    let sortOrder = Number(line.sortOrder);
    if (isNaN(sortOrder)) sortOrder = idx;
    return {
      id: uid('plan'),
      categoryId: line.categoryId,
      planned: Number(line.planned) || 0,
      currency: normalizeCurrency(line.currency),
      tag,
      label: tag,
      sortOrder,
    };
  });
}

/**
 * Si el ciclo abierto quedó sin plan (cierre viejo no heredaba),
 * rellena desde el cerrado que termina el día anterior.
 */
export function seedOpenPlanFromPriorClosed(budget) {
  const open = (budget.periods || [])
    .filter((p) => p.status !== 'closed')
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0];
  if (!open) return { period: null, seeded: false };
  if (!Array.isArray(open.budget)) open.budget = [];
  if (open.budget.length) return { period: open, seeded: false };
  const start = String(open.startDate || '').slice(0, 10);
  const prior = (budget.periods || []).find((p) => {
    if (p.status !== 'closed' || !p.endDate) return false;
    return addDaysIso(String(p.endDate).slice(0, 10), 1) === start;
  });
  if (!prior || !(prior.budget || []).length) return { period: open, seeded: false };
  open.budget = copyPlanLinesFrom(prior.budget);
  if (!open.exchangeRate) open.exchangeRate = normalizeExchangeRate(prior.exchangeRate);
  return { period: open, seeded: true };
}

/** Crea el ciclo siguiente a partir del cerrado (fechas propias, no calendario fantasma). */
export function createNextPeriod(budget, closedPeriod, billingDayStart) {
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
  // Heredar presupuesto del ciclo cerrado; la ejecución arranca vacía
  if (!(next.budget || []).length && (closedPeriod.budget || []).length) {
    next.budget = copyPlanLinesFrom(closedPeriod.budget);
  }
  if (!Array.isArray(next.executions)) next.executions = [];
  return { next, nextCycle: { key, startDate, endDate, billingDayStart: Number(billingDayStart) || 1 } };
}

/** @deprecated rubros eliminados; se mantiene por compat de exports */
export function findRubro() {
  return null;
}

/** Planeado / ejecutado / restante de una categoría en el ciclo (CRC) */
export function categoryPeriodStats(budget, period, categoryId) {
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

export function findLoan(budget, loanId) {
  return (budget.loans || []).find((l) => l.id === loanId) || null;
}

/** Saldo del préstamo en colones (histórico; no entra al presupuesto) */
export function loanBalanceCrc(loan, exchangeRate) {
  const rate = normalizeExchangeRate(exchangeRate);
  let total = 0;
  (loan.movements || []).forEach((m) => {
    const sign = Number(m.sign) === -1 ? -1 : 1;
    total += sign * toCrc(m.amount, m.currency, rate);
  });
  return total;
}

/** Tipo de cambio de referencia: ciclo abierto, o el más reciente con TC */
export function referenceExchangeRate(budget) {
  const open = (budget.periods || []).find((p) => p.status !== 'closed');
  if (open && Number(open.exchangeRate) > 0) return normalizeExchangeRate(open.exchangeRate);
  const withRate = (budget.periods || [])
    .slice()
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))
    .find((p) => Number(p.exchangeRate) > 0);
  return withRate ? normalizeExchangeRate(withRate.exchangeRate) : 0;
}

/** Totales siempre en colones — plan y ejecución por categoría */
export function periodSummary(budget, period) {
  let plannedIncome = 0;
  let plannedExpense = 0;
  let actualIncome = 0;
  let actualExpense = 0;
  // Egresos por categoría: { planned, actual } en CRC (para pastel y leyenda)
  const byCategory = {};
  const rate = normalizeExchangeRate(period && period.exchangeRate);

  function ensureCatBucket(catId) {
    if (!byCategory[catId]) byCategory[catId] = { planned: 0, actual: 0 };
    return byCategory[catId];
  }

  (period.budget || []).forEach((line) => {
    const cat = findCategory(budget, line.categoryId);
    const plannedCrc = toCrc(line.planned, line.currency, rate);
    if (!cat) return;
    if (cat.type === 'income') plannedIncome += plannedCrc;
    else {
      plannedExpense += plannedCrc;
      ensureCatBucket(line.categoryId || 'none').planned += plannedCrc;
    }
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
    ensureCatBucket(ex.categoryId || 'none').actual += n;
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

export function buildHistory(budget) {
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
        paymentTypeId: ex.paymentTypeId || null,
        paymentTypeName: ex.paymentTypeName || '',
        planLineId: ex.planLineId || null,
        planLineTag: ex.planLineTag || '',
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
 * El siguiente ciclo hereda TC y líneas de presupuesto (no la ejecución).
 */
export function closePeriod(budget, cycleKey, billingDayStart) {
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
    paymentTypeId: ex.paymentTypeId || null,
    paymentTypeName: String(ex.paymentTypeName || ''),
    planLineId: ex.planLineId || null,
    planLineTag: String(ex.planLineTag || ''),
  }));
  const created = createNextPeriod(budget, period, billingDayStart);
  return { closed: period, next: created.next, nextCycle: created.nextCycle };
}
