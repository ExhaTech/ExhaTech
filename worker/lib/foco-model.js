/**
 * Yurguen: modelo puro de Bitácora para Workers.
 * Contiene defaults, normalización y reglas de negocio sin I/O.
 */
import crypto from 'node:crypto';

export const HECHO_KEEP_DAYS = 30;

export const STATUSES = ['inbox', 'hoy', 'esperando', 'despues', 'hecho'];

/** Orígenes iniciales (id estable para migrar source string legacy). */
export const DEFAULT_ORIGENES = [
  { id: 'src_correo', key: 'correo', name: 'Correo' },
  { id: 'src_mensaje', key: 'mensaje', name: 'Mensaje' },
  { id: 'src_llamada', key: 'llamada', name: 'Llamada' },
  { id: 'src_evento', key: 'evento', name: 'Evento' },
  { id: 'src_otro', key: 'otro', name: 'Otro' },
];

/** Roles de contacto iniciales. */
export const DEFAULT_ROLES = [
  { id: 'role_vecino', key: 'vecino', name: 'Vecino' },
  { id: 'role_junta', key: 'junta', name: 'Junta' },
  { id: 'role_proveedor', key: 'proveedor', name: 'Proveedor' },
  { id: 'role_otro', key: 'otro', name: 'Otro' },
];

/** Formas de pago iniciales (caja chica solo registra egresos). */
export const DEFAULT_FORMAS_PAGO = [
  { id: 'fp_efectivo', key: 'efectivo', name: 'Efectivo' },
  { id: 'fp_transferencia', key: 'transferencia', name: 'Transferencia' },
  { id: 'fp_sinpe', key: 'sinpe', name: 'Sinpe' },
];

export function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** Color de condominio: #RRGGBB o null. */
function normalizeCondoColor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hex = s.charAt(0) === '#' ? s : '#' + s;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return hex.toLowerCase();
}

function slugKey(name) {
  let s = String(name || '').trim().toLowerCase();
  try {
    if (typeof s.normalize === 'function') {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
  } catch {
    /* ignore */
  }
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return s || 'origen';
}

/** Clave única en un catálogo con key. */
function uniqueCatalogKey(list, desiredKey, exceptId, fallback) {
  const base = desiredKey || fallback || 'item';
  let key = base;
  let n = 2;
  while (list.some((o) => o.id !== exceptId && o.key === key)) {
    key = base + '_' + n;
    n += 1;
  }
  return key;
}

function defaultOrigenes() {
  const t = nowIso();
  return DEFAULT_ORIGENES.map((o, i) => ({
    id: o.id,
    key: o.key,
    name: o.name,
    sortOrder: i,
    createdAt: t,
    updatedAt: t,
  }));
}

function defaultRoles() {
  const t = nowIso();
  return DEFAULT_ROLES.map((o, i) => ({
    id: o.id,
    key: o.key,
    name: o.name,
    sortOrder: i,
    createdAt: t,
    updatedAt: t,
  }));
}

function defaultFormasPago() {
  const t = nowIso();
  return DEFAULT_FORMAS_PAGO.map((o, i) => ({
    id: o.id,
    key: o.key,
    name: o.name,
    sortOrder: i,
    createdAt: t,
    updatedAt: t,
  }));
}

export function emptyData() {
  return {
    origenes: defaultOrigenes(),
    roles: defaultRoles(),
    formasPago: defaultFormasPago(),
    condominios: [],
    contactos: [],
    items: [],
    cajaMovimientos: [],
  };
}

function normalizeStatus(s) {
  const v = String(s || 'inbox').toLowerCase();
  return STATUSES.includes(v) ? v : 'inbox';
}

function normalizeNamedCatalog(raw, defaultsFn, idPrefix) {
  if (!Array.isArray(raw) || !raw.length) return defaultsFn();
  const list = raw
    .map((o, i) => {
      const name = String(o.name || '').trim();
      if (!name) return null;
      const key = String(o.key || slugKey(name)).toLowerCase();
      return {
        id: o.id || uid(idPrefix),
        key,
        name,
        sortOrder: Number.isFinite(Number(o.sortOrder)) ? Number(o.sortOrder) : i,
        createdAt: o.createdAt || nowIso(),
        updatedAt: o.updatedAt || o.createdAt || nowIso(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  list.forEach((o, i) => {
    o.sortOrder = i;
  });
  return list;
}

function normalizeOrigenes(raw) {
  return normalizeNamedCatalog(raw, defaultOrigenes, 'src');
}

function normalizeRoles(raw) {
  return normalizeNamedCatalog(raw, defaultRoles, 'role');
}

function normalizeFormasPago(raw) {
  return normalizeNamedCatalog(raw, defaultFormasPago, 'fp');
}

function resolveCatalogId(list, defaultsFn, value, idPrefix) {
  const items = list && list.length ? list : defaultsFn();
  const s = String(value || '').trim();
  if (!s) return items[0] ? items[0].id : null;
  if (items.some((o) => o.id === s)) return s;
  const lower = s.toLowerCase();
  const byKey = items.find((o) => o.key === lower || o.name.toLowerCase() === lower);
  if (byKey) return byKey.id;
  const legacy = items.find((o) => o.id === idPrefix + '_' + lower);
  if (legacy) return legacy.id;
  return items[0] ? items[0].id : null;
}

function normalizeMonto(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Caja chica: solo egresos (se ignoran ingresos legacy). */
function normalizeCajaMovimientos(raw, data) {
  if (!Array.isArray(raw)) return [];
  const fpIds = new Set((data.formasPago || []).map((c) => c.id));
  const condoIds = new Set((data.condominios || []).map((c) => c.id));
  const fallbackFp = data.formasPago[0] ? data.formasPago[0].id : null;
  return raw
    .map((m) => {
      const tipoLegacy = String(m.tipo || 'egreso').toLowerCase();
      if (tipoLegacy === 'ingreso') return null;
      const monto = normalizeMonto(m.monto);
      if (monto == null) return null;
      let formaPagoId = String(m.formaPagoId || '');
      if (!fpIds.has(formaPagoId)) formaPagoId = fallbackFp;
      if (!formaPagoId) return null;
      let condoId = m.condoId || null;
      if (condoId && !condoIds.has(condoId)) condoId = null;
      return {
        id: m.id || uid('caja'),
        tipo: 'egreso',
        monto,
        fecha: m.fecha ? String(m.fecha).slice(0, 10) : todayIsoDate(),
        formaPagoId,
        condoId,
        concepto: String(m.concepto || '').trim(),
        createdAt: m.createdAt || nowIso(),
        updatedAt: m.updatedAt || m.createdAt || nowIso(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const fd = String(b.fecha).localeCompare(String(a.fecha));
      if (fd) return fd;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
}

function resolveRoleId(roles, roleOrId) {
  const list = roles && roles.length ? roles : defaultRoles();
  const s = String(roleOrId || '').trim();
  if (!s) return list[0].id;
  if (list.some((o) => o.id === s)) return s;
  const lower = s.toLowerCase();
  const byKey = list.find((o) => o.key === lower || o.name.toLowerCase() === lower);
  if (byKey) return byKey.id;
  const legacy = list.find((o) => o.id === 'role_' + lower);
  if (legacy) return legacy.id;
  return list[0].id;
}

function resolveSourceId(origenes, source) {
  const list = origenes && origenes.length ? origenes : defaultOrigenes();
  const s = String(source || '').trim();
  if (!s) return list[0].id;
  if (list.some((o) => o.id === s)) return s;
  const lower = s.toLowerCase();
  const byKey = list.find((o) => o.key === lower || o.name.toLowerCase() === lower);
  if (byKey) return byKey.id;
  const legacy = list.find((o) => o.id === 'src_' + lower);
  if (legacy) return legacy.id;
  return list[0].id;
}

function normalizeContactIds(raw, legacy) {
  let ids = [];
  if (Array.isArray(raw)) ids = raw;
  else if (legacy) ids = [legacy];
  return [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
}

/**
 * Checklist: { id, text, done }. Migra string / array legacy.
 */
function normalizeChecklist(raw, legacy, idPrefix) {
  const prefix = idPrefix || 'act';
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) list = [raw];
  else if (legacy != null && String(legacy).trim()) list = [String(legacy)];
  return list
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const text = String(entry.text != null ? entry.text : entry.title || '').trim();
        if (!text) return null;
        return {
          id: entry.id || uid(prefix),
          text,
          done: !!entry.done,
        };
      }
      const text = String(entry || '').trim();
      if (!text) return null;
      return { id: uid(prefix), text, done: false };
    })
    .filter(Boolean);
}

function normalizeNextActions(raw, legacy) {
  return normalizeChecklist(raw, legacy, 'act');
}

function normalizeWaitFors(raw, legacy) {
  return normalizeChecklist(raw, legacy, 'wait');
}

function hasChecklist(list) {
  return Array.isArray(list) && list.some((a) => a && a.text);
}

function hasWaitFors(item) {
  return hasChecklist(item.waitFors);
}

function waitForsSummary(item) {
  return (item.waitFors || []).map((w) => w.text).filter(Boolean);
}

export function normalizeData(raw) {
  const data = raw && typeof raw === 'object' ? raw : emptyData();
  data.origenes = normalizeOrigenes(data.origenes);
  data.roles = normalizeRoles(data.roles);
  data.formasPago = normalizeFormasPago(data.formasPago);
  delete data.cuentas;
  if (!Array.isArray(data.condominios)) data.condominios = [];
  if (!Array.isArray(data.contactos)) data.contactos = [];
  if (!Array.isArray(data.items)) data.items = [];
  if (!Array.isArray(data.cajaMovimientos)) data.cajaMovimientos = [];
  data.condominios = data.condominios
    .map((c, i) => ({
      id: c.id || uid('condo'),
      name: String(c.name || '').trim() || 'Sin nombre',
      notes: String(c.notes || ''),
      color: normalizeCondoColor(c.color),
      sortOrder: Number.isFinite(Number(c.sortOrder)) ? Number(c.sortOrder) : i,
      createdAt: c.createdAt || nowIso(),
      updatedAt: c.updatedAt || c.createdAt || nowIso(),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  data.condominios.forEach((c, i) => {
    c.sortOrder = i;
  });
  data.contactos = data.contactos
    .map((c, i) => ({
      id: c.id || uid('ct'),
      name: String(c.name || '').trim() || 'Sin nombre',
      roleId: resolveRoleId(data.roles, c.roleId != null ? c.roleId : c.role),
      condoId: c.condoId || null,
      phone: String(c.phone || ''),
      notes: String(c.notes || ''),
      sortOrder: Number.isFinite(Number(c.sortOrder)) ? Number(c.sortOrder) : i,
      createdAt: c.createdAt || nowIso(),
      updatedAt: c.updatedAt || c.createdAt || nowIso(),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  data.contactos.forEach((c, i) => {
    c.sortOrder = i;
  });
  const contactIdsSet = new Set(data.contactos.map((c) => c.id));
  data.items = data.items.map((it) => {
    const contactIds = normalizeContactIds(it.contactIds, it.contactId).filter((id) =>
      contactIdsSet.has(id)
    );
    return {
      id: it.id || uid('item'),
      source: resolveSourceId(data.origenes, it.source),
      title: String(it.title || '').trim() || 'Sin título',
      body: String(it.body || ''),
      condoId: it.condoId || null,
      contactIds,
      status: normalizeStatus(it.status),
      nextActions: normalizeNextActions(it.nextActions, it.nextAction),
      waitFors: normalizeWaitFors(it.waitFors, it.waitFor),
      dueDate: it.dueDate ? String(it.dueDate).slice(0, 10) : null,
      doneAt: it.doneAt || null,
      createdAt: it.createdAt || nowIso(),
      updatedAt: it.updatedAt || it.createdAt || nowIso(),
    };
  });
  data.cajaMovimientos = normalizeCajaMovimientos(data.cajaMovimientos, data);
  return data;
}

/**
 * Al abrir: Después con fecha = hoy → Hoy; Hecho > 30 días se borra.
 */
export function applyBoardRules(data) {
  const today = todayIsoDate();
  let changed = false;

  data.items.forEach((it) => {
    if (it.status === 'despues' && it.dueDate && String(it.dueDate).slice(0, 10) === today) {
      it.status = 'hoy';
      it.updatedAt = nowIso();
      changed = true;
    }
  });

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - HECHO_KEEP_DAYS);
  const cutoffIso = cutoff.toISOString();
  const before = data.items.length;
  data.items = data.items.filter((it) => {
    if (it.status !== 'hecho') return true;
    const stamp = it.doneAt || it.updatedAt;
    if (!stamp) return false;
    return String(stamp) >= cutoffIso;
  });
  if (data.items.length !== before) changed = true;

  return changed;
}

const MAX_CONDOMINIOS = 11;

export function saveCondoData(data, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Nombre del condominio obligatorio');
  const id = payload.id ? String(payload.id) : null;
  let condo = id ? data.condominios.find((c) => c.id === id) : null;
  if (id && !condo) throw new Error('Condominio no encontrado');
  if (!condo) {
    if (data.condominios.length >= MAX_CONDOMINIOS) {
      throw new Error('Máximo ' + MAX_CONDOMINIOS + ' condominios');
    }
    condo = {
      id: uid('condo'),
      name,
      notes: String(payload.notes || ''),
      color: normalizeCondoColor(payload.color),
      sortOrder: data.condominios.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    data.condominios.push(condo);
  } else {
    condo.name = name;
    if (payload.notes != null) condo.notes = String(payload.notes);
    if (payload.color !== undefined) condo.color = normalizeCondoColor(payload.color);
    condo.updatedAt = nowIso();
  }
  return condo;
}

export function deleteCondoData(data, condoId) {
  const before = data.condominios.length;
  data.condominios = data.condominios.filter((c) => c.id !== condoId);
  if (data.condominios.length === before) throw new Error('Condominio no encontrado');
  data.contactos.forEach((c) => {
    if (c.condoId === condoId) c.condoId = null;
  });
  data.items.forEach((it) => {
    if (it.condoId === condoId) it.condoId = null;
  });
  data.cajaMovimientos.forEach((m) => {
    if (m.condoId === condoId) m.condoId = null;
  });
  data.condominios.forEach((c, i) => {
    c.sortOrder = i;
  });
  return true;
}

function saveNamedCatalogItemData(data, listKey, idPrefix, label, payload) {
  const list = data[listKey];
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Nombre de ' + label + ' obligatorio');
  const id = payload.id ? String(payload.id) : null;
  let row = id ? list.find((o) => o.id === id) : null;
  if (id && !row) throw new Error(label.charAt(0).toUpperCase() + label.slice(1) + ' no encontrado');
  const dupName = list.find(
    (o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase()
  );
  if (dupName) throw new Error('Ya existe un registro con ese nombre');
  const key = uniqueCatalogKey(list, slugKey(payload.key || name), id, idPrefix);
  if (!row) {
    row = {
      id: uid(idPrefix),
      key,
      name,
      sortOrder: list.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    list.push(row);
  } else {
    row.name = name;
    row.key = key;
    row.updatedAt = nowIso();
  }
  return row;
}

export function saveFormaPagoData(data, payload) {
  return saveNamedCatalogItemData(data, 'formasPago', 'fp', 'forma de pago', payload);
}

export function deleteFormaPagoData(data, formaPagoId) {
  if (data.formasPago.length <= 1) {
    throw new Error('Debe quedar al menos una forma de pago');
  }
  const before = data.formasPago.length;
  data.formasPago = data.formasPago.filter((o) => o.id !== formaPagoId);
  if (data.formasPago.length === before) throw new Error('Forma de pago no encontrada');
  const fallback = data.formasPago[0].id;
  data.cajaMovimientos.forEach((m) => {
    if (m.formaPagoId === formaPagoId) m.formaPagoId = fallback;
  });
  data.formasPago.forEach((o, i) => {
    o.sortOrder = i;
  });
  return true;
}

export function saveCajaMovData(data, payload) {
  const monto = normalizeMonto(payload.monto);
  if (monto == null) throw new Error('Monto obligatorio y mayor a cero');
  const formaPagoId = resolveCatalogId(
    data.formasPago,
    defaultFormasPago,
    payload.formaPagoId,
    'fp'
  );
  if (!formaPagoId || !data.formasPago.some((c) => c.id === formaPagoId)) {
    throw new Error('Forma de pago no encontrada');
  }
  let condoId = payload.condoId || null;
  if (condoId && !data.condominios.some((c) => c.id === condoId)) {
    throw new Error('Condominio no encontrado');
  }
  const fecha = payload.fecha ? String(payload.fecha).slice(0, 10) : todayIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha inválida');
  const concepto = String(payload.concepto || '').trim();
  const id = payload.id ? String(payload.id) : null;
  let mov = id ? data.cajaMovimientos.find((m) => m.id === id) : null;
  if (id && !mov) throw new Error('Movimiento no encontrado');
  if (!mov) {
    mov = {
      id: uid('caja'),
      tipo: 'egreso',
      monto,
      fecha,
      formaPagoId,
      condoId,
      concepto,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    data.cajaMovimientos.unshift(mov);
  } else {
    mov.tipo = 'egreso';
    mov.monto = monto;
    mov.fecha = fecha;
    mov.formaPagoId = formaPagoId;
    if (payload.condoId !== undefined) mov.condoId = condoId;
    if (payload.concepto != null) mov.concepto = concepto;
    delete mov.cuentaId;
    mov.updatedAt = nowIso();
  }
  return mov;
}

export function deleteCajaMovData(data, movId) {
  const before = data.cajaMovimientos.length;
  data.cajaMovimientos = data.cajaMovimientos.filter((m) => m.id !== movId);
  if (data.cajaMovimientos.length === before) throw new Error('Movimiento no encontrado');
  return true;
}

export function saveOrigenData(data, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Nombre del origen obligatorio');
  const id = payload.id ? String(payload.id) : null;
  let origen = id ? data.origenes.find((o) => o.id === id) : null;
  if (id && !origen) throw new Error('Origen no encontrado');
  const dupName = data.origenes.find(
    (o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase()
  );
  if (dupName) throw new Error('Ya existe un origen con ese nombre');
  const key = uniqueCatalogKey(data.origenes, slugKey(payload.key || name), id, 'origen');
  if (!origen) {
    origen = {
      id: uid('src'),
      key,
      name,
      sortOrder: data.origenes.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    data.origenes.push(origen);
  } else {
    origen.name = name;
    origen.key = key;
    origen.updatedAt = nowIso();
  }
  return origen;
}

export function saveRoleData(data, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Nombre del rol obligatorio');
  const id = payload.id ? String(payload.id) : null;
  let role = id ? data.roles.find((o) => o.id === id) : null;
  if (id && !role) throw new Error('Rol no encontrado');
  const dupName = data.roles.find(
    (o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase()
  );
  if (dupName) throw new Error('Ya existe un rol con ese nombre');
  const key = uniqueCatalogKey(data.roles, slugKey(payload.key || name), id, 'rol');
  if (!role) {
    role = {
      id: uid('role'),
      key,
      name,
      sortOrder: data.roles.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    data.roles.push(role);
  } else {
    role.name = name;
    role.key = key;
    role.updatedAt = nowIso();
  }
  return role;
}

export function deleteRoleData(data, roleId) {
  if (data.roles.length <= 1) {
    throw new Error('Debe quedar al menos un rol');
  }
  const before = data.roles.length;
  data.roles = data.roles.filter((o) => o.id !== roleId);
  if (data.roles.length === before) throw new Error('Rol no encontrado');
  const fallback = data.roles[0].id;
  data.contactos.forEach((c) => {
    if (c.roleId === roleId) c.roleId = fallback;
  });
  data.roles.forEach((o, i) => {
    o.sortOrder = i;
  });
  return true;
}

export function deleteOrigenData(data, origenId) {
  if (data.origenes.length <= 1) {
    throw new Error('Debe quedar al menos un origen');
  }
  const before = data.origenes.length;
  data.origenes = data.origenes.filter((o) => o.id !== origenId);
  if (data.origenes.length === before) throw new Error('Origen no encontrado');
  const fallback = data.origenes[0].id;
  data.items.forEach((it) => {
    if (it.source === origenId) it.source = fallback;
  });
  data.origenes.forEach((o, i) => {
    o.sortOrder = i;
  });
  return true;
}

export function saveContactData(data, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Nombre del contacto obligatorio');
  const id = payload.id ? String(payload.id) : null;
  let contact = id ? data.contactos.find((c) => c.id === id) : null;
  if (id && !contact) throw new Error('Contacto no encontrado');
  const condoId = payload.condoId || null;
  if (condoId && !data.condominios.some((c) => c.id === condoId)) {
    throw new Error('Condominio no encontrado');
  }
  const roleId = resolveRoleId(
    data.roles,
    payload.roleId != null ? payload.roleId : payload.role
  );
  if (!contact) {
    contact = {
      id: uid('ct'),
      name,
      roleId,
      condoId,
      phone: String(payload.phone || ''),
      notes: String(payload.notes || ''),
      sortOrder: data.contactos.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    data.contactos.push(contact);
  } else {
    contact.name = name;
    if (payload.roleId != null || payload.role != null) {
      contact.roleId = roleId;
    }
    if (payload.condoId !== undefined) contact.condoId = condoId;
    if (payload.phone != null) contact.phone = String(payload.phone);
    if (payload.notes != null) contact.notes = String(payload.notes);
    contact.updatedAt = nowIso();
  }
  return contact;
}

export function deleteContactData(data, contactId) {
  const before = data.contactos.length;
  data.contactos = data.contactos.filter((c) => c.id !== contactId);
  if (data.contactos.length === before) throw new Error('Contacto no encontrado');
  data.items.forEach((it) => {
    it.contactIds = (it.contactIds || []).filter((id) => id !== contactId);
  });
  data.contactos.forEach((c, i) => {
    c.sortOrder = i;
  });
  return true;
}

const CATALOG_LISTS = ['origenes', 'roles', 'condominios', 'contactos', 'formasPago'];

/**
 * Sube / baja un ítem de catálogo. Los combos usan este orden.
 */
export function moveCatalogData(data, payload) {
  const listName = String(payload.list || '');
  if (!CATALOG_LISTS.includes(listName)) {
    throw new Error('Catálogo inválido');
  }
  const direction = String(payload.direction || '').toLowerCase();
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Dirección inválida (up/down)');
  }
  const id = String(payload.id || '');
  if (!id) throw new Error('Id obligatorio');

  const list = data[listName] || [];
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error('Elemento no encontrado');

  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) {
    return data;
  }

  const tmp = list[idx];
  list[idx] = list[swapWith];
  list[swapWith] = tmp;
  list.forEach((item, i) => {
    item.sortOrder = i;
    item.updatedAt = nowIso();
  });
  data[listName] = list;
  return data;
}

function applyNextActionsFromPayload(item, payload) {
  if (payload.nextActions != null) {
    item.nextActions = normalizeNextActions(payload.nextActions);
  } else if (payload.nextAction != null) {
    item.nextActions = normalizeNextActions([payload.nextAction]);
  }
}

function applyWaitForsFromPayload(item, payload) {
  if (payload.waitFors != null) {
    item.waitFors = normalizeWaitFors(payload.waitFors);
  } else if (payload.waitFor != null) {
    item.waitFors = normalizeWaitFors(
      typeof payload.waitFor === 'string' ? [payload.waitFor] : payload.waitFor
    );
  }
}

function resolveContactIds(data, payload) {
  let ids = [];
  if (payload.contactIds != null) ids = normalizeContactIds(payload.contactIds);
  else if (payload.contactId != null) ids = normalizeContactIds(null, payload.contactId);
  else return null;
  for (const id of ids) {
    if (!data.contactos.some((c) => c.id === id)) {
      throw new Error('Contacto no encontrado');
    }
  }
  return ids;
}

export function createItemData(data, payload) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Título obligatorio');
  const condoId = payload.condoId || null;
  if (condoId && !data.condominios.some((c) => c.id === condoId)) {
    throw new Error('Condominio no encontrado');
  }
  const contactIds = resolveContactIds(data, payload) || [];
  const item = {
    id: uid('item'),
    source: resolveSourceId(data.origenes, payload.source),
    title,
    body: String(payload.body || ''),
    condoId,
    contactIds,
    status: 'inbox',
    nextActions: normalizeNextActions(payload.nextActions, payload.nextAction),
    waitFors: normalizeWaitFors(payload.waitFors, payload.waitFor),
    dueDate: payload.dueDate ? String(payload.dueDate).slice(0, 10) : null,
    doneAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  data.items.unshift(item);
  return item;
}

export function updateItemData(data, payload) {
  const id = String(payload.id || '');
  const item = data.items.find((it) => it.id === id);
  if (!item) throw new Error('Ítem no encontrado');
  if (payload.title != null) {
    const title = String(payload.title).trim();
    if (!title) throw new Error('Título obligatorio');
    item.title = title;
  }
  if (payload.body != null) item.body = String(payload.body);
  if (payload.source != null) item.source = resolveSourceId(data.origenes, payload.source);
  applyNextActionsFromPayload(item, payload);
  applyWaitForsFromPayload(item, payload);
  if (payload.dueDate !== undefined && item.status !== 'hecho') {
    item.dueDate = payload.dueDate ? String(payload.dueDate).slice(0, 10) : null;
    // Fecha editable en Hoy/Después: futuro → Después; hoy o pasado → Hoy.
    if (item.status === 'hoy' || item.status === 'despues') {
      if (item.dueDate && item.dueDate > todayIsoDate()) {
        item.status = 'despues';
      } else if (item.dueDate) {
        item.status = 'hoy';
      } else if (item.status === 'despues') {
        throw new Error('En Después, poné una fecha');
      }
    }
  }
  if (payload.condoId !== undefined) {
    const condoId = payload.condoId || null;
    if (condoId && !data.condominios.some((c) => c.id === condoId)) {
      throw new Error('Condominio no encontrado');
    }
    item.condoId = condoId;
  }
  const contactIds = resolveContactIds(data, payload);
  if (contactIds) item.contactIds = contactIds;
  item.updatedAt = nowIso();
  return item;
}

/**
 * Mueve tarjeta. Limpia waitFors al salir de Esperando.
 * Siguientes acciones: opcionales.
 * Después exige dueDate; si es hoy → Hoy.
 * Hecho: congela dueDate = día del cierre y setea doneAt.
 */
export function moveItemData(data, payload) {
  const id = String(payload.id || '');
  const item = data.items.find((it) => it.id === id);
  if (!item) throw new Error('Ítem no encontrado');

  let status = normalizeStatus(payload.status);
  const prevStatus = item.status;
  applyNextActionsFromPayload(item, payload);
  if (status === 'esperando') {
    applyWaitForsFromPayload(item, payload);
  }
  if (status !== 'hecho' && payload.dueDate != null) {
    item.dueDate = String(payload.dueDate).slice(0, 10) || null;
  }

  if (status === 'esperando' && !hasWaitFors(item)) {
    throw new Error('En Esperando, agregá al menos un pendiente de espera');
  }

  if (status === 'despues') {
    if (!item.dueDate) {
      throw new Error('En Después, poné una fecha');
    }
    if (item.dueDate === todayIsoDate()) {
      status = 'hoy';
    }
  }

  let clearedWait = null;
  if (prevStatus === 'esperando' && status !== 'esperando') {
    const summary = waitForsSummary(item);
    if (summary.length) clearedWait = summary.join('; ');
    item.waitFors = [];
  }

  if (status === 'hecho') {
    item.doneAt = nowIso();
    item.dueDate = todayIsoDate();
  } else if (prevStatus === 'hecho' && status !== 'hecho') {
    item.doneAt = null;
  }

  item.status = status;
  item.updatedAt = nowIso();
  return { item, clearedWait };
}

/** list: nextActions | waitFors */
export function toggleActionData(data, payload) {
  const item = data.items.find((it) => it.id === String(payload.id || ''));
  if (!item) throw new Error('Ítem no encontrado');
  const listName = payload.list === 'waitFors' ? 'waitFors' : 'nextActions';
  const actionId = String(payload.actionId || '');
  const act = (item[listName] || []).find((a) => a.id === actionId);
  if (!act) throw new Error(listName === 'waitFors' ? 'Pendiente no encontrado' : 'Acción no encontrada');
  if (payload.done === undefined) act.done = !act.done;
  else act.done = !!payload.done;
  item.updatedAt = nowIso();
  return item;
}

export function deleteItemData(data, itemId) {
  const before = data.items.length;
  data.items = data.items.filter((it) => it.id !== itemId);
  if (data.items.length === before) throw new Error('Ítem no encontrado');
  return true;
}
