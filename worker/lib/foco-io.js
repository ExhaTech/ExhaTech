/**
 * I/O de Bitácora en R2 para Workers.
 */
import { decryptJson, encryptJson, isEncryptedFile } from './crypto-json.js';
import { emptyData, normalizeData } from './foco-model.js';

function masterKeyFromEnv(env) {
  const key = String(env.DATA_ENCRYPTION_KEY || env.BUDGET_MASTER_KEY || '').trim();
  if (key.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY/BUDGET_MASTER_KEY inválida (mín. 32 caracteres)');
  }
  return key;
}

function focoObjectKey(userId) {
  return `foco/${userId}.json`;
}

export async function loadFoco(env, userId) {
  const object = await env.DATA.get(focoObjectKey(userId));
  if (!object) return emptyData();

  const raw = await object.text();
  let data;
  if (isEncryptedFile(raw)) {
    data = decryptJson(JSON.parse(raw), masterKeyFromEnv(env));
  } else {
    data = JSON.parse(raw);
  }
  return normalizeData(data);
}

export async function saveFoco(env, userId, data) {
  const envelope = encryptJson(normalizeData(data), masterKeyFromEnv(env));
  await env.DATA.put(
    focoObjectKey(userId),
    JSON.stringify(envelope, null, 2),
    {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
      },
    }
  );
}
