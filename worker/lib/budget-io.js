/**
 * I/O de presupuestos en R2 para Workers.
 */
import { decryptJson, encryptJson, isEncryptedFile } from './crypto-json.js';
import { emptyBudget, normalizeBudget } from './budget-store.js';

function masterKeyFromEnv(env) {
  const key = String(env.DATA_ENCRYPTION_KEY || env.BUDGET_MASTER_KEY || '').trim();
  if (key.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY/BUDGET_MASTER_KEY inválida (mín. 32 caracteres)');
  }
  return key;
}

function budgetObjectKey(userId) {
  return `budgets/${userId}.json`;
}

export async function loadBudget(env, userId) {
  const object = await env.DATA.get(budgetObjectKey(userId));
  if (!object) return emptyBudget();

  const raw = await object.text();
  let data;
  if (isEncryptedFile(raw)) {
    data = decryptJson(JSON.parse(raw), masterKeyFromEnv(env));
  } else {
    data = JSON.parse(raw);
  }
  return normalizeBudget(data);
}

export async function saveBudget(env, userId, data) {
  const envelope = encryptJson(normalizeBudget(data), masterKeyFromEnv(env));
  await env.DATA.put(
    budgetObjectKey(userId),
    JSON.stringify(envelope, null, 2),
    {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
      },
    }
  );
}
