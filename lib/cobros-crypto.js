/**
 * Yurguen: cifra / descifra JSON con la clave local (AES-256-GCM).
 * v1 = scrypt (legacy); v2 = SHA-256(password) liviano — compatible con worker/lib/crypto-json.js.
 */
const crypto = require('crypto');

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
  return cacheSet(cacheKey, crypto.createHash('sha256').update(String(password), 'utf8').digest());
}

function encryptJson(obj, password) {
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

function decryptJson(envelope, password) {
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

function isEncryptedFile(raw) {
  try {
    const o = JSON.parse(raw);
    return o && o.encrypted === true && o.payload;
  } catch {
    return false;
  }
}

function isPlainDataFile(raw) {
  try {
    const o = JSON.parse(raw);
    return o && Array.isArray(o.clients);
  } catch {
    return false;
  }
}

module.exports = {
  encryptJson,
  decryptJson,
  isEncryptedFile,
  isPlainDataFile,
};
