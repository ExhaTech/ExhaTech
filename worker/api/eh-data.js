import { json } from '../lib/http.js';
import {
  createSession,
  createUser,
  deleteUserById,
  findUserById,
  findUserByUsername,
  listUsers,
  maybeSeedAdmin,
  publicUser,
  requireAdmin,
  requireAuth,
  revokeSession,
  updateUser,
} from '../lib/auth.js';
import { loadBudget, saveBudget } from '../lib/budget-io.js';
import { hashPassword, uid, verifyPassword } from '../lib/passwords.js';
import * as budgetStore from '../lib/budget-store.js';

function billingDayStartOf(value) {
  return Math.min(28, Math.max(1, Number(value) || 1));
}

function findActionPeriod(budget, cycleKey) {
  return budgetStore.findPeriod(budget, cycleKey)
    || budgetStore.findPeriod(budget, budgetStore.resolveDefaultCycleKey(budget));
}

export async function handleEhData(request, env, body) {
  const action = body && body.action;

  if (action === 'auth') {
    await maybeSeedAdmin(env);
    const user = await findUserByUsername(env, body.username || body.email || '');
    if (!user || user.active === false) {
      return json({ ok: false, error: 'Credenciales inválidas' }, 200);
    }
    const ok = verifyPassword(
      body.password || '',
      user.passwordSalt,
      user.passwordHash
    );
    if (!ok) {
      return json({ ok: false, error: 'Credenciales inválidas' }, 200);
    }
    const token = await createSession(env, user.id);
    return json({
      ok: true,
      token,
      user: publicUser(user),
    }, 200);
  }

  if (action === 'logout') {
    await revokeSession(request, env);
    return json({ ok: true }, 200);
  }

  if (action === 'me') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    return json({ ok: true, user: publicUser(auth.ctx.user) }, 200);
  }

  if (action === 'changePassword') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (next.length < 6) {
      return json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' }, 400);
    }
    const ok = verifyPassword(
      current,
      auth.ctx.user.passwordSalt,
      auth.ctx.user.passwordHash
    );
    if (!ok) {
      return json({ error: 'Contraseña actual incorrecta' }, 400);
    }
    const cred = hashPassword(next);
    await updateUser(env, auth.ctx.user.id, {
      passwordSalt: cred.salt,
      passwordHash: cred.hash,
    });
    return json({ ok: true }, 200);
  }

  if (action === 'users.list') {
    const auth = await requireAdmin(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const users = await listUsers(env);
    return json({
      ok: true,
      users: users.map(publicUser),
    }, 200);
  }

  if (action === 'users.create') {
    const auth = await requireAdmin(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || username).trim();
    const role = body.role === 'admin' ? 'admin' : 'user';
    const billingDayStart = billingDayStartOf(body.billingDayStart);
    if (!username || password.length < 6) {
      return json({ error: 'Usuario y contraseña (mín. 6) obligatorios' }, 400);
    }
    if (await findUserByUsername(env, username)) {
      return json({ error: 'Ese usuario ya existe' }, 400);
    }
    const cred = hashPassword(password);
    const user = await createUser(env, {
      id: uid(),
      username,
      displayName,
      role,
      active: true,
      billingDayStart,
      passwordSalt: cred.salt,
      passwordHash: cred.hash,
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true, user: publicUser(user) }, 200);
  }

  if (action === 'users.update') {
    const auth = await requireAdmin(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const target = await findUserById(env, body.id);
    if (!target) {
      return json({ error: 'Usuario no encontrado' }, 404);
    }

    const changes = {};
    if (body.displayName != null) {
      changes.displayName = String(body.displayName).trim() || target.username;
    }
    if (body.active != null) {
      if (target.id === auth.ctx.user.id && body.active === false) {
        return json({ error: 'No podés desactivarte a vos mismo' }, 400);
      }
      changes.active = !!body.active;
    }
    if (body.billingDayStart != null) {
      changes.billingDayStart = billingDayStartOf(body.billingDayStart);
    }
    if (body.role === 'admin' || body.role === 'user') {
      if (target.id === auth.ctx.user.id && body.role !== 'admin') {
        return json({ error: 'No podés quitarte el rol admin' }, 400);
      }
      changes.role = body.role;
    }
    if (body.newPassword) {
      if (String(body.newPassword).length < 6) {
        return json({ error: 'Contraseña mínima 6 caracteres' }, 400);
      }
      const cred = hashPassword(body.newPassword);
      changes.passwordSalt = cred.salt;
      changes.passwordHash = cred.hash;
    }

    const updated = await updateUser(env, target.id, changes);
    return json({ ok: true, user: publicUser(updated) }, 200);
  }

  if (action === 'users.delete') {
    const auth = await requireAdmin(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    if (body.id === auth.ctx.user.id) {
      return json({ error: 'No podés eliminarte a vos mismo' }, 400);
    }
    const target = await findUserById(env, body.id);
    if (!target) {
      return json({ error: 'Usuario no encontrado' }, 404);
    }
    await deleteUserById(env, body.id);
    return json({ ok: true }, 200);
  }

  if (action === 'profile.update') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;

    let syncedPeriod = null;
    const changes = {};

    if (body.billingDayStart != null) {
      const newDay = billingDayStartOf(body.billingDayStart);
      changes.billingDayStart = newDay;
      try {
        const budget = await loadBudget(env, auth.ctx.user.id);
        if (!(budget.periods || []).length) {
          budgetStore.bootstrapFirstPeriod(budget, newDay);
        }
        const sync = budgetStore.syncOpenPeriodEndToCutDay(budget, newDay);
        if (!sync || !sync.period) {
          budgetStore.bootstrapFirstPeriod(budget, newDay);
          budgetStore.syncOpenPeriodEndToCutDay(budget, newDay);
        }
        await saveBudget(env, auth.ctx.user.id, budget);
        const open = (budget.periods || []).find((p) => p.status !== 'closed') || null;
        syncedPeriod = open
          ? { key: open.key, startDate: open.startDate, endDate: open.endDate }
          : null;
      } catch (e) {
        if (e && e.code === 'cut_in_past') {
          return json({ error: e.message || 'El cierre del periodo no puede ser antes de hoy.' }, 400);
        }
        console.error('profile.update sync periodo:', e && e.message ? e.message : e);
        return json({ error: 'No se pudo actualizar el periodo con el nuevo día de inicio' }, 500);
      }
    }

    if (body.displayName != null) {
      changes.displayName = String(body.displayName).trim() || auth.ctx.user.username;
    }

    const updatedUser = await updateUser(env, auth.ctx.user.id, changes);
    return json({
      ok: true,
      user: publicUser(updatedUser),
      period: syncedPeriod,
    }, 200);
  }

  if (action === 'budget.get') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    try {
      const day = Number(auth.ctx.user.billingDayStart) || 1;
      const budget = await loadBudget(env, auth.ctx.user.id);
      budgetStore.purgeOldPeriods(budget);
      if (!(budget.periods || []).length) {
        budgetStore.bootstrapFirstPeriod(budget, day);
      }
      try {
        budgetStore.syncOpenPeriodEndToCutDay(budget, day);
      } catch (e) {
        if (!e || e.code !== 'cut_in_past') throw e;
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
      await saveBudget(env, auth.ctx.user.id, budget);
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
      return json({
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
      }, 200);
    } catch (e) {
      return json({ error: 'budget_load_failed' }, 500);
    }
  }

  if (action === 'budget.period.update') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const budget = await loadBudget(env, auth.ctx.user.id);
    const period = findActionPeriod(budget, body.cycleKey);
    if (!period) {
      return json({ error: 'Ciclo no encontrado' }, 404);
    }
    if (!budgetStore.canEditPeriod(period)) {
      return json({
        error: budgetStore.isPeriodClosed(period)
          ? 'Ciclo cerrado: no se puede modificar'
          : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
      }, 403);
    }
    if (body.exchangeRate != null) {
      const rate = Number(body.exchangeRate);
      if (isNaN(rate) || rate < 0) {
        return json({ error: 'Tipo de cambio inválido' }, 400);
      }
      period.exchangeRate = budgetStore.normalizeExchangeRate(rate);
    }
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({
      ok: true,
      period,
      summary: budgetStore.periodSummary(budget, period),
    }, 200);
  }

  if (action === 'budget.period.close') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const day = Number(auth.ctx.user.billingDayStart) || 1;
    const budget = await loadBudget(env, auth.ctx.user.id);
    try {
      const cycleKey = body.cycleKey || budgetStore.resolveDefaultCycleKey(budget);
      const result = budgetStore.closePeriod(budget, cycleKey, day);
      budgetStore.purgeOldPeriods(budget);
      await saveBudget(env, auth.ctx.user.id, budget);
      return json({
        ok: true,
        closed: result.closed,
        nextCycle: result.nextCycle,
        nextPeriod: result.next,
      }, 200);
    } catch (e) {
      const bad = e
        && (e.code === 'already_closed' || e.code === 'not_found' || e.code === 'cut_not_reached');
      return json({ error: e && e.message ? e.message : 'No se pudo cerrar el ciclo' }, bad ? 400 : 500);
    }
  }

  if (action === 'budget.category.save') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const name = String(body.name || '').trim();
    const type = body.type === 'income' ? 'income' : 'expense';
    const description = String(body.description || '').trim();
    if (!name) {
      return json({ error: 'Nombre de categoría obligatorio' }, 400);
    }
    const budget = await loadBudget(env, auth.ctx.user.id);
    let catId = body.id || null;
    if (body.id) {
      const cat = budget.categories.find((c) => c.id === body.id);
      if (!cat) {
        return json({ error: 'Categoría no encontrada' }, 404);
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
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, categories: budget.categories, categoryId: catId }, 200);
  }

  if (action === 'budget.category.move') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const dir = body.direction === 'up' ? -1 : 1;
    if (!body.id || (body.direction !== 'up' && body.direction !== 'down')) {
      return json({ error: 'Id y dirección (up/down) obligatorios' }, 400);
    }
    const budget = await loadBudget(env, auth.ctx.user.id);
    const cats = (budget.categories || []).slice().sort((a, b) => {
      const ao = Number(a.sortOrder);
      const bo = Number(b.sortOrder);
      if (ao !== bo) return ao - bo;
      return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });
    cats.forEach((c, i) => { c.sortOrder = i; });
    const idx = cats.findIndex((c) => c.id === body.id);
    if (idx < 0) {
      return json({ error: 'Categoría no encontrada' }, 404);
    }
    const swap = idx + dir;
    if (swap < 0 || swap >= cats.length) {
      return json({ ok: true, categories: budget.categories }, 200);
    }
    const tmp = cats[idx].sortOrder;
    cats[idx].sortOrder = cats[swap].sortOrder;
    cats[swap].sortOrder = tmp;
    budget.categories = cats.sort((a, b) => a.sortOrder - b.sortOrder);
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, categories: budget.categories }, 200);
  }

  if (action === 'budget.category.delete') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const budget = await loadBudget(env, auth.ctx.user.id);
    budget.categories = (budget.categories || []).filter((c) => c.id !== body.id);
    (budget.periods || []).forEach((p) => {
      if (budgetStore.isPeriodClosed(p)) return;
      p.budget = (p.budget || []).filter((b) => b.categoryId !== body.id);
    });
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, categories: budget.categories }, 200);
  }

  if (action === 'budget.plan.save') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const categoryId = body.categoryId;
    const planned = Number(body.planned);
    const currency = budgetStore.normalizeCurrency(body.currency);
    if (!categoryId || body.planned === '' || body.planned == null || isNaN(planned)) {
      return json({ error: 'Categoría y monto planeado obligatorios' }, 400);
    }
    const budget = await loadBudget(env, auth.ctx.user.id);
    if (!budgetStore.findCategory(budget, categoryId)) {
      return json({ error: 'Categoría no encontrada' }, 404);
    }
    const period = findActionPeriod(budget, body.cycleKey);
    if (!period) {
      return json({ error: 'Ciclo no encontrado' }, 404);
    }
    if (!budgetStore.canEditPeriod(period)) {
      return json({
        error: budgetStore.isPeriodClosed(period)
          ? 'Ciclo cerrado: no se puede modificar'
          : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
      }, 403);
    }
    if (currency === 'USD' && !(Number(period.exchangeRate) > 0)) {
      return json({ error: 'Definí el tipo de cambio del ciclo antes de usar USD' }, 400);
    }
    const tag = String(
      body.tag != null && body.tag !== ''
        ? body.tag
        : (body.label != null && body.label !== '' ? body.label : (body.planLabel || ''))
    ).trim();
    if (!Array.isArray(period.budget)) period.budget = [];
    let savedLine = null;
    if (body.id) {
      const line = period.budget.find((b) => b.id === body.id);
      if (!line) {
        return json({ error: 'Línea de presupuesto no encontrada' }, 404);
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
    await saveBudget(env, auth.ctx.user.id, budget);
    const reloaded = await loadBudget(env, auth.ctx.user.id);
    const periodSaved = budgetStore.findPeriod(reloaded, period.key) || period;
    const lineSaved = (periodSaved.budget || []).find((b) => b.id === savedLine.id) || savedLine;
    return json({
      ok: true,
      period: periodSaved,
      line: lineSaved,
      summary: budgetStore.periodSummary(reloaded, periodSaved),
    }, 200);
  }

  if (action === 'budget.plan.move') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    if (!body.id || (body.direction !== 'up' && body.direction !== 'down')) {
      return json({ error: 'Id y dirección (up/down) obligatorios' }, 400);
    }
    const budget = await loadBudget(env, auth.ctx.user.id);
    const period = findActionPeriod(budget, body.cycleKey);
    if (!period) {
      return json({ error: 'Ciclo no encontrado' }, 404);
    }
    if (!budgetStore.canEditPeriod(period)) {
      return json({
        error: budgetStore.isPeriodClosed(period)
          ? 'Ciclo cerrado: no se puede modificar'
          : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
      }, 403);
    }
    if (!Array.isArray(period.budget)) period.budget = [];
    const target = period.budget.find((b) => b.id === body.id);
    if (!target) {
      return json({ error: 'Línea de presupuesto no encontrada' }, 404);
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
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({
      ok: true,
      period,
      summary: budgetStore.periodSummary(budget, period),
    }, 200);
  }

  if (action === 'budget.plan.delete') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const budget = await loadBudget(env, auth.ctx.user.id);
    const period = findActionPeriod(budget, body.cycleKey);
    if (!period) {
      return json({ error: 'Ciclo no encontrado' }, 404);
    }
    if (!budgetStore.canEditPeriod(period)) {
      return json({
        error: budgetStore.isPeriodClosed(period)
          ? 'Ciclo cerrado: no se puede modificar'
          : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
      }, 403);
    }
    if (!body.id) {
      return json({ error: 'Id de línea de presupuesto obligatorio' }, 400);
    }
    period.budget = (period.budget || []).filter((b) => b.id !== body.id);
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({
      ok: true,
      period,
      summary: budgetStore.periodSummary(budget, period),
    }, 200);
  }

  if (action === 'budget.execution.save') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const amount = Number(body.amount);
    const currency = budgetStore.normalizeCurrency(body.currency);
    if (!body.categoryId || body.amount === '' || body.amount == null || isNaN(amount)) {
      return json({ error: 'Categoría y monto obligatorios' }, 400);
    }
    const budget = await loadBudget(env, auth.ctx.user.id);
    const cat = budgetStore.findCategory(budget, body.categoryId);
    if (!cat) {
      return json({ error: 'Categoría no encontrada' }, 404);
    }
    const period = findActionPeriod(budget, body.cycleKey);
    if (!period) {
      return json({ error: 'Ciclo no encontrado' }, 404);
    }
    if (!budgetStore.canEditPeriod(period)) {
      return json({
        error: budgetStore.isPeriodClosed(period)
          ? 'Ciclo cerrado: no se puede modificar'
          : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
      }, 403);
    }
    if (currency === 'USD' && !(Number(period.exchangeRate) > 0)) {
      return json({ error: 'Definí el tipo de cambio del ciclo antes de usar USD' }, 400);
    }
    if (!Array.isArray(period.executions)) period.executions = [];
    if (body.id) {
      const ex = period.executions.find((x) => x.id === body.id);
      if (!ex) {
        return json({ error: 'Ejecución no encontrada' }, 404);
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
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({
      ok: true,
      period,
      summary: budgetStore.periodSummary(budget, period),
      history: budgetStore.buildHistory(budget),
    }, 200);
  }

  if (action === 'budget.execution.delete') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const budget = await loadBudget(env, auth.ctx.user.id);
    const period = findActionPeriod(budget, body.cycleKey);
    if (!period) {
      return json({ error: 'Ciclo no encontrado' }, 404);
    }
    if (!budgetStore.canEditPeriod(period)) {
      return json({
        error: budgetStore.isPeriodClosed(period)
          ? 'Ciclo cerrado: no se puede modificar'
          : 'El ciclo ya venció. Debés cerrarlo en Ejecución para continuar.',
      }, 403);
    }
    period.executions = (period.executions || []).filter((x) => x.id !== body.id);
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({
      ok: true,
      period,
      summary: budgetStore.periodSummary(budget, period),
      history: budgetStore.buildHistory(budget),
    }, 200);
  }

  if (action === 'budget.loan.save') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const person = String(body.person || '').trim();
    if (!person) {
      return json({ error: 'Nombre de la persona obligatorio' }, 400);
    }
    const side = body.side === 'borrowed' ? 'borrowed' : 'lent';
    const notes = String(body.notes || '').trim();
    const budget = await loadBudget(env, auth.ctx.user.id);
    if (!Array.isArray(budget.loans)) budget.loans = [];
    if (body.id) {
      const loan = budgetStore.findLoan(budget, body.id);
      if (!loan) {
        return json({ error: 'Préstamo no encontrado' }, 404);
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
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, loans: budget.loans }, 200);
  }

  if (action === 'budget.loan.delete') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const budget = await loadBudget(env, auth.ctx.user.id);
    budget.loans = (budget.loans || []).filter((l) => l.id !== body.id);
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, loans: budget.loans }, 200);
  }

  if (action === 'budget.loan.movement.save') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const amount = Number(body.amount);
    const currency = budgetStore.normalizeCurrency(body.currency);
    const sign = Number(body.sign) === -1 ? -1 : 1;
    if (!body.loanId || body.amount === '' || body.amount == null || isNaN(amount) || amount < 0) {
      return json({ error: 'Préstamo y monto obligatorios' }, 400);
    }
    const budget = await loadBudget(env, auth.ctx.user.id);
    const loan = budgetStore.findLoan(budget, body.loanId);
    if (!loan) {
      return json({ error: 'Préstamo no encontrado' }, 404);
    }
    if (currency === 'USD' && !(budgetStore.referenceExchangeRate(budget) > 0)) {
      return json({ error: 'Definí el tipo de cambio del ciclo para usar USD en préstamos' }, 400);
    }
    if (!Array.isArray(loan.movements)) loan.movements = [];
    const date = String(body.date || '').slice(0, 10) || budgetStore.todayIso();
    const note = String(body.note || '').trim();
    if (body.id) {
      const mov = loan.movements.find((m) => m.id === body.id);
      if (!mov) {
        return json({ error: 'Movimiento no encontrado' }, 404);
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
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, loans: budget.loans }, 200);
  }

  if (action === 'budget.loan.movement.delete') {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const budget = await loadBudget(env, auth.ctx.user.id);
    const loan = budgetStore.findLoan(budget, body.loanId);
    if (!loan) {
      return json({ error: 'Préstamo no encontrado' }, 404);
    }
    loan.movements = (loan.movements || []).filter((m) => m.id !== body.id);
    await saveBudget(env, auth.ctx.user.id, budget);
    return json({ ok: true, loans: budget.loans }, 200);
  }

  return json({ error: 'unknown action' }, 400);
}
