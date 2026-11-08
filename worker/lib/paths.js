/**
 * Reescrituras de URL pública → archivo estático (mismo mapa que server.js Node).
 * App host: app.exhatech.com (Contabilidad + Bitácora).
 */
const PUBLIC_PATH_MAP = {
  '/contabilidad': '/eh-mnt.html',
  '/contabilidad.js': '/eh-mnt.js',
  '/contabilidad.css': '/eh-mnt.css',
  '/bitacora': '/foco.html',
  '/bitacora.js': '/foco.js',
  '/bitacora.css': '/foco.css',
  '/eh-mnt': '/contabilidad',
  '/foco': '/bitacora',
};

/**
 * @param {URL} url
 * @returns {{ redirect?: string, assetPath?: string }}
 */
export function resolvePublicPath(url) {
  let pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Raíz de la app → Contabilidad
  if (pathname === '/') {
    return { redirect: '/contabilidad' };
  }

  // Paths legacy de archivos → rutas amigables
  if (pathname === '/eh-mnt' || pathname === '/eh-mnt.html') {
    return { redirect: '/contabilidad' };
  }
  if (pathname === '/foco' || pathname === '/foco.html') {
    return { redirect: '/bitacora' };
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
