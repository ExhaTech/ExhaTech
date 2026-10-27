/**
 * Reescrituras de URL pública → archivo estático (mismo mapa que server.js Node).
 * DevOps: agregar aquí cualquier subsitio nuevo.
 */
const PUBLIC_PATH_MAP = {
  '/contabilidad': '/eh-mnt.html',
  '/contabilidad.js': '/eh-mnt.js',
  '/contabilidad.css': '/eh-mnt.css',
  '/bitacora': '/foco.html',
  '/bitacora.js': '/foco.js',
  '/bitacora.css': '/foco.css',
  '/foco': '/bitacora', // redirect legacy
};

/**
 * @param {URL} url
 * @returns {{ redirect?: string, assetPath?: string }}
 */
export function resolvePublicPath(url) {
  let pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/foco') {
    return { redirect: '/bitacora' };
  }

  const mapped = PUBLIC_PATH_MAP[pathname];
  if (mapped) {
    if (mapped.startsWith('/') && !mapped.includes('.')) {
      return { redirect: mapped };
    }
    return { assetPath: mapped };
  }

  return { assetPath: pathname === '/' ? '/index.html' : pathname };
}
