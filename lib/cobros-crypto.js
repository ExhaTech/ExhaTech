/**
 * Yurguen: cifra / descifra cobros.json con la clave local (AES-256-GCM)
 */
const crypto = require('crypto');

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function encryptJson(obj, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    encrypted: true,
    payload: {
      salt: salt.toString('base64'),
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
  const { salt, iv, tag, data } = envelope.payload;
  const key = deriveKey(password, Buffer.from(salt, 'base64'));
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
