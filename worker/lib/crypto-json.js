/**
 * Cifrado/descifrado JSON compatible con `lib/cobros-crypto.js`.
 *
 * v1: AES-256-GCM + scrypt por operación (pesado en Workers → a veces 503).
 * v2: AES-256-GCM + SHA-256(password) (liviano; misma clave maestra).
 * Al guardar se escribe v2; al leer se aceptan v1 y v2.
 */
import crypto from 'node:crypto';

/** Cache por isolate: evita recalcular scrypt/SHA en el mismo Worker caliente. */
const keyCache = new Map();

function cacheGet(key) {
  return keyCache.get(key) || null;
}

function cacheSet(key, value) {
  if (keyCache.size > 64) keyCache.clear();
  keyCache.set(key, value);
  return value;
}

function deriveKeyV1(password, salt) {
  const cacheKey = 'v1:' + String(password) + ':' + Buffer.from(salt).toString('base64');
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  return cacheSet(cacheKey, crypto.scryptSync(String(password), salt, 32));
}

function deriveKeyV2(password) {
  const cacheKey = 'v2:' + String(password);
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  // La llave maestra ya es alta entropía; SHA-256 basta y es barato en Workers.
  return cacheSet(cacheKey, crypto.createHash('sha256').update(String(password), 'utf8').digest());
}

export function encryptJson(obj, password) {
  const iv = crypto.randomBytes(12);
  const key = deriveKeyV2(password);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 2,
    encrypted: true,
    payload: {
      kdf: 'sha256',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: enc.toString('base64'),
    },
  };
}

export function decryptJson(envelope, password) {
  if (!envelope || !envelope.encrypted || !envelope.payload) {
    throw new Error('invalid envelope');
  }
  const { salt, iv, tag, data, kdf } = envelope.payload;
  const version = Number(envelope.v) || 1;
  const useV2 = version >= 2 || kdf === 'sha256' || !salt;
  const key = useV2
    ? deriveKeyV2(password)
    : deriveKeyV1(password, Buffer.from(salt, 'base64'));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8'));
}

export function isEncryptedFile(raw) {
  try {
    const obj = JSON.parse(raw);
    return obj && obj.encrypted === true && obj.payload;
  } catch {
    return false;
  }
}
