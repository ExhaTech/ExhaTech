/**
 * Yurguen: Bitácora para Workers sobre R2 cifrado.
 * Mantiene reglas de negocio de `lib/foco-store.js` y mueve el I/O a async.
 */
import { loadFoco, saveFoco } from './foco-io.js';
import {
  applyBoardRules,
  createItemData,
  DEFAULT_FORMAS_PAGO,
  DEFAULT_ORIGENES,
  DEFAULT_ROLES,
  deleteCajaMovData,
  deleteCondoData,
  deleteContactData,
  deleteFormaPagoData,
  deleteItemData,
  deleteOrigenData,
  deleteRoleData,
  emptyData,
  HECHO_KEEP_DAYS,
  moveCatalogData,
  moveItemData,
  normalizeData,
  saveCajaMovData,
  saveCondoData,
  saveContactData,
  saveFormaPagoData,
  saveOrigenData,
  saveRoleData,
  STATUSES,
  toggleActionData,
  updateItemData,
} from './foco-model.js';

async function saveAndReturn(env, userId, data, result) {
  await saveFoco(env, userId, data);
  return result;
}

export async function resetUserData(env, userId) {
  const data = emptyData();
  await saveFoco(env, userId, data);
  return data;
}

export async function wipeAllToDefaults(env) {
  let cursor;
  let total = 0;
  do {
    const listed = await env.DATA.list({ prefix: 'foco/', cursor });
    for (const object of listed.objects || []) {
      const userId = String(object.key || '').replace(/^foco\//, '').replace(/\.json$/i, '');
      if (!userId) continue;
      await saveFoco(env, userId, emptyData());
      total += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return total;
}

export async function getSnapshot(env, userId) {
  const data = await loadFoco(env, userId);
  if (applyBoardRules(data)) {
    await saveFoco(env, userId, data);
  }
  return data;
}

export async function saveCondo(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const condo = saveCondoData(data, payload);
  return saveAndReturn(env, userId, data, condo);
}

export async function deleteCondo(env, userId, condoId) {
  const data = await loadFoco(env, userId);
  const result = deleteCondoData(data, condoId);
  return saveAndReturn(env, userId, data, result);
}

export async function saveOrigen(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const origen = saveOrigenData(data, payload);
  return saveAndReturn(env, userId, data, origen);
}

export async function deleteOrigen(env, userId, origenId) {
  const data = await loadFoco(env, userId);
  const result = deleteOrigenData(data, origenId);
  return saveAndReturn(env, userId, data, result);
}

export async function saveRole(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const role = saveRoleData(data, payload);
  return saveAndReturn(env, userId, data, role);
}

export async function deleteRole(env, userId, roleId) {
  const data = await loadFoco(env, userId);
  const result = deleteRoleData(data, roleId);
  return saveAndReturn(env, userId, data, result);
}

export async function saveFormaPago(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const formaPago = saveFormaPagoData(data, payload);
  return saveAndReturn(env, userId, data, formaPago);
}

export async function deleteFormaPago(env, userId, formaPagoId) {
  const data = await loadFoco(env, userId);
  const result = deleteFormaPagoData(data, formaPagoId);
  return saveAndReturn(env, userId, data, result);
}

export async function saveCajaMov(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const movimiento = saveCajaMovData(data, payload);
  return saveAndReturn(env, userId, data, movimiento);
}

export async function deleteCajaMov(env, userId, movId) {
  const data = await loadFoco(env, userId);
  const result = deleteCajaMovData(data, movId);
  return saveAndReturn(env, userId, data, result);
}

export async function saveContact(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const contact = saveContactData(data, payload);
  return saveAndReturn(env, userId, data, contact);
}

export async function deleteContact(env, userId, contactId) {
  const data = await loadFoco(env, userId);
  const result = deleteContactData(data, contactId);
  return saveAndReturn(env, userId, data, result);
}

export async function moveCatalog(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const moved = moveCatalogData(data, payload);
  return saveAndReturn(env, userId, data, moved);
}

export async function createItem(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const item = createItemData(data, payload);
  return saveAndReturn(env, userId, data, item);
}

export async function updateItem(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const item = updateItemData(data, payload);
  return saveAndReturn(env, userId, data, item);
}

export async function moveItem(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const moved = moveItemData(data, payload);
  await saveFoco(env, userId, data);
  return moved;
}

export async function toggleAction(env, userId, payload) {
  const data = await loadFoco(env, userId);
  const item = toggleActionData(data, payload);
  return saveAndReturn(env, userId, data, item);
}

export async function deleteItem(env, userId, itemId) {
  const data = await loadFoco(env, userId);
  const result = deleteItemData(data, itemId);
  return saveAndReturn(env, userId, data, result);
}

export {
  STATUSES,
  HECHO_KEEP_DAYS,
  DEFAULT_ORIGENES,
  DEFAULT_ROLES,
  DEFAULT_FORMAS_PAGO,
  emptyData,
  normalizeData,
};
