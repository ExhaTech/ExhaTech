/**
 * Yurguen: localhost — sitio + API; cobros.json cifrado en Git; clave en auth.local.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('./lib/cobros-crypto');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'cobros.json');
const AUTH_FILE = path.join(ROOT, 'data', 'auth.local.json');
const AUTH_EXAMPLE = path.join(ROOT, 'data', 'auth.local.example.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function defaultData() {
  return {
    settings: {
      defaultExchangeRate: 520,
      ivaPercent: 13,
      retentionMonths: 12,
      autoPurge: true,
    },
    clients: [],
    services: [],
    payments: [],
    // Yurguen: catálogo de precios (categoría, costo, moneda, unidad)
    prices: [],
  };
}

function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveAuth(email, password) {
  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ adminEmail: email, adminPassword: password }, null, 2),
    'utf8'
  );
}

function ensureAuthLocal() {
  if (fs.existsSync(AUTH_FILE)) return;
  if (fs.existsSync(AUTH_EXAMPLE)) {
    fs.copyFileSync(AUTH_EXAMPLE, AUTH_FILE);
    console.log('Yurguen: creá data/auth.local.json con tu contraseña real.');
  }
}

function authOk(email, password) {
  const auth = loadAuth();
  if (!auth) return false;
  return (
    email &&
    password &&
    email === auth.adminEmail &&
    password === auth.adminPassword
  );
}

function stripCredentials(data) {
  const out = JSON.parse(JSON.stringify(data));
  if (!out.settings) out.settings = {};
  delete out.settings.adminEmail;
  delete out.settings.adminPassword;
  return out;
}

function publicSettings(data) {
  const s = data.settings || {};
  return {
    defaultExchangeRate: Number(s.defaultExchangeRate) || 520,
    ivaPercent: s.ivaPercent != null ? Number(s.ivaPercent) : 13,
    retentionMonths: s.retentionMonths != null ? Number(s.retentionMonths) : 12,
    autoPurge: s.autoPurge !== false,
  };
}

function stripSecrets(data) {
  return { ...stripCredentials(data), settings: publicSettings(data) };
}

function migrateLegacyPlain(raw, diskPassword) {
  const parsed = JSON.parse(raw);
  if (!parsed.settings) parsed.settings = {};
  const email = parsed.settings.adminEmail;
  const pass = parsed.settings.adminPassword;
  if (!loadAuth() && email && pass) {
    saveAuth(email, pass);
    console.log('Yurguen: credenciales movidas a data/auth.local.json');
  } else if (!loadAuth() && diskPassword) {
    saveAuth(email || 'admin@exhatech.com', diskPassword);
  }
  return stripCredentials(parsed);
}

function loadData(password) {
  ensureAuthLocal();
  if (!fs.existsSync(DATA_FILE)) {
    const d = defaultData();
    if (password) saveData(d, password);
    return d;
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  if (crypto.isEncryptedFile(raw)) {
    if (!password) throw new Error('password required');
    return stripCredentials(crypto.decryptJson(JSON.parse(raw), password));
  }
  if (crypto.isPlainDataFile(raw)) {
    const data = migrateLegacyPlain(raw, password);
    if (password) saveData(data, password);
    return data;
  }
  return defaultData();
}

function saveData(data, password) {
  if (!password) throw new Error('password required');
  const clean = stripCredentials(data);
  const envelope = crypto.encryptJson(clean, password);
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(envelope, null, 2), 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const email = req.headers['x-admin-email'] || '';
  const password = req.headers['x-admin-password'] || '';

  if (
    url.pathname === '/api/eh-data' ||
    url.pathname === '/api/eh-data.php' ||
    url.pathname === '/api/cobros.php'
  ) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Email, X-Admin-Password',
      });
      res.end();
      return;
    }

    if (req.method === 'POST') {
      let body = {};
      try {
        body = await readBody(req);
      } catch {
        send(res, 400, { error: 'invalid body' });
        return;
      }

      // Yurguen: login va en el body — no exigir headers antes de esta acción
      if (body.action === 'auth') {
        send(res, 200, { ok: authOk(body.email || '', body.password || '') });
        return;
      }

      if (!authOk(email, password)) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }

      if (body.action === 'save' && body.data) {
        try {
          const incoming = stripCredentials(body.data);
          if (!incoming.settings.defaultExchangeRate) {
            incoming.settings.defaultExchangeRate = 520;
          }
          saveData(incoming, password);
          send(res, 200, { ok: true });
        } catch (e) {
          send(res, 500, { error: 'save_failed' });
        }
        return;
      }

      send(res, 400, { error: 'unknown action' });
      return;
    }

    if (!authOk(email, password)) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && url.searchParams.get('action') === 'auth') {
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET') {
      try {
        const data = loadData(password);
        send(res, 200, stripSecrets(data));
      } catch (e) {
        send(res, 500, { error: 'decrypt_failed' });
      }
      return;
    }

    send(res, 405, { error: 'method not allowed' });
    return;
  }

  let filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' && filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  ensureAuthLocal();
  console.log(`ExhaTech → http://localhost:${PORT}`);
  console.log(`Panel → http://localhost:${PORT}/eh-mnt.html`);
  console.log('Yurguen: cobros.json cifrado (Git). Clave en data/auth.local.json (solo local).');
});
