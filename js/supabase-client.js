/**
 * supabase-client.js — Inicializa el cliente de Supabase
 *
 * Requiere que config.js y el SDK oficial (@supabase/supabase-js) se carguen antes.
 */

const supabaseClient = (() => {
  if (!window.supabase) {
    console.error('[Supabase] SDK no cargado. Verifica el <script> del CDN.');
    return null;
  }

  try {
    const client = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: window.localStorage,
          storageKey: 'tecnimax-taller-auth',
        },
        realtime: {
          params: { eventsPerSecond: 5 },
        },
      }
    );

    if (CONFIG.DEBUG) console.log('[Supabase] Cliente inicializado:', CONFIG.SUPABASE_URL);
    return client;
  } catch (err) {
    console.error('[Supabase] Error al inicializar:', err);
    return null;
  }
})();
