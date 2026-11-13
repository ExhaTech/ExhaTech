/**
 * Reescrituras de URL pública → archivo estático (mismo mapa que server.js Node).
 * App host: app.exhatech.com (Hub + Contabilidad + Bitácora + Inventario).
 */
const PUBLIC_PATH_MAP = {
  '/': '/hub.html',
  '/hub': '/hub.html',
  '/hub.js': '/hub.js',
  '/hub.css': '/hub.css',
  '/contabilidad': '/eh-mnt.html',
  '/contabilidad.js': '/eh-mnt.js',
  '/contabilidad.css': '/eh-mnt.css',
  '/bitacora': '/foco.html',
  '/bitacora.js': '/foco.js',
  '/bitacora.css': '/foco.css',
  '/inventario': '/inventario.html',
  '/inventario.js': '/inventario.js',
  '/inventario.css': '/inventario.css',
  '/eh-mnt': '/contabilidad',
  '/foco': '/bitacora',
};

/**
 * @param {URL} url
 * @returns {{ redirect?: string, assetPath?: string }}
 */
export function resolvePublicPath(url) {
  let pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Paths legacy de archivos → rutas amigables
  if (pathname === '/eh-mnt' || pathname === '/eh-mnt.html') {
    return { redirect: '/contabilidad' };
  }
  if (pathname === '/foco' || pathname === '/foco.html') {
    return { redirect: '/bitacora' };
  }
  if (pathname === '/hub.html') {
    return { redirect: '/' };
  }
  if (pathname === '/inventario.html') {
    return { redirect: '/inventario' };
  }

  const mapped = PUBLIC_PATH_MAP[pathname];
  if (mapped) {
    if (mapped.startsWith('/') && !mapped.includes('.')) {
      return { redirect: mapped };
    }
    return { assetPath: mapped };
  }

  return { assetPath: pathname };
}
