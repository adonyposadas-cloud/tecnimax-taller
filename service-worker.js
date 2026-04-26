/**
 * service-worker.js — TECNIMAX Taller
 *
 * Estrategia:
 *  - Cache-first para los assets estáticos del app shell (HTML, CSS, JS, iconos).
 *  - Network-only para Supabase (no cachear datos dinámicos ni tokens).
 *  - Invalidación por versión: al subir cambios, incrementa CACHE_VERSION.
 */

const CACHE_VERSION = 'tecnimax-taller-v1.4.1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './css/jefe.css',
  './css/tecnico.css',
  './css/orden-detalle.css',
  './js/config.js',
  './js/supabase-client.js',
  './js/utils.js',
  './js/auth.js',
  './js/router.js',
  './js/jefe.js',
  './js/tecnico.js',
  './js/orden-detalle.js',
  './pages/admin.html',
  './pages/jefe.html',
  './pages/tecnico.html',
  './pages/orden-detalle.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
];

// INSTALL: precargar app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Install error:', err))
  );
});

// ACTIVATE: limpiar cachés viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH: estrategia diferenciada
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No cachear peticiones a Supabase (datos dinámicos)
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.io')) {
    return;
  }

  // No cachear POST/PUT/DELETE
  if (event.request.method !== 'GET') return;

  // Para HTML, JS y CSS: NETWORK-FIRST (traer siempre lo nuevo si hay red)
  // Para imágenes y fuentes: CACHE-FIRST (son estáticos)
  const isAppCode = /\.(html|js|css)(\?.*)?$/.test(url.pathname) ||
                     url.pathname === '/' ||
                     url.pathname.endsWith('/');

  if (isAppCode) {
    // Network-first
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Si falla red, caer al cache
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        })
    );
    return;
  }

  // Cache-first para imágenes, fuentes y otros recursos estáticos
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (
          response &&
          response.status === 200 &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Mensaje del frontend para forzar update inmediato
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
