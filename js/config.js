/**
 * config.js — Configuración de TECNIMAX Taller
 *
 * ⚠️  INSTRUCCIONES ANTES DE SUBIR A GITHUB:
 *
 *  1. Entra a Supabase > Settings > API
 *  2. Copia "Project URL"  → pégala en SUPABASE_URL
 *  3. Copia "anon public" key → pégala en SUPABASE_ANON_KEY
 *
 *  La anon key ES SEGURA de exponer públicamente (está pensada para eso).
 *  NUNCA pegues aquí la "service_role" key — esa es secreta y no va al frontend.
 */

const CONFIG = {
  // ↓↓↓ REEMPLAZAR CON TUS VALORES REALES ↓↓↓
  SUPABASE_URL: 'https://tdbtjnvsmoikzrgudxig.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkYnRqbnZzbW9pa3pyZ3VkeGlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTYxMzQsImV4cCI6MjA5MjM3MjEzNH0.7smu7hVy_UjSyoWF5Nsu7GF1u8FakA0TF9j-zhf4HDY',
  // ↑↑↑ REEMPLAZAR ↑↑↑

  // Dominio virtual para emails de Supabase Auth (NO cambiar)
  AUTH_EMAIL_DOMAIN: '@tecnimax.local',

  // Versión del Service Worker (incrementar en cada release para invalidar cache)
  SW_VERSION: 'v1.0.0',

  // Duración de sesión en horas antes de cerrar por inactividad
  SESSION_HOURS: 12,

  // Modo debug (logs en consola)
  DEBUG: true,
};

// Validación al cargar
(() => {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('TU_PROYECTO')) {
    console.error('[CONFIG] ⚠️ SUPABASE_URL no configurado en config.js');
  }
  if (!CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY.includes('PEGA_AQUI')) {
    console.error('[CONFIG] ⚠️ SUPABASE_ANON_KEY no configurado en config.js');
  }
})();
