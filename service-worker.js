/**
 * service-worker.js — TECNIMAX Taller
 *
 * Estrategia:
 *  - Cache-first para los assets estáticos del app shell (HTML, CSS, JS, iconos).
 *  - Network-only para Supabase (no cachear datos dinámicos ni tokens).
 *  - Invalidación por versión: al subir cambios, incrementa CACHE_VERSION.
 */

const CACHE_VERSION = 'tecnimax-taller-v1.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/supabase-client.js',
  './js/utils.js',
  './js/auth.js',
  './js/router.js',
  './pages/admin.html',
  './pages/jefe.html',
  './pages/tecnico.html',
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
    return; // Dejar que el navegador lo maneje directamente
  }

  // No cachear POST/PUT/DELETE
  if (event.request.method !== 'GET') return;

  // Cache-first para el app shell
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Solo cachear respuestas OK del mismo origen
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
        // Si falla la red y no hay cache, responder con el index (para SPA)
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
