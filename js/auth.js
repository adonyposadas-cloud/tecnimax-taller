/**
 * auth.js — Autenticación de usuarios (login/logout) + gestión de sesiones
 *
 * Flujo:
 *  1. Usuario ingresa código (ej: A03404) y PIN (6 dígitos).
 *  2. Convertimos a email sintético: a03404@tecnimax.local (Supabase normaliza a minúsculas).
 *  3. signInWithPassword contra Supabase Auth.
 *  4. Si OK: leemos tabla `usuarios` para obtener rol, nombre, pin_cambiado.
 *  5. Registramos entrada en tabla `sesiones`.
 *  6. Redirigimos a la pantalla según el rol.
 */

const Auth = {

  /** Intenta iniciar sesión. Devuelve { ok, profile?, error? } */
  async login(codigoRaw, pin) {
    const codigo = Utils.normalizeCodigo(codigoRaw);

    // Validaciones locales antes de llamar al servidor
    if (!Utils.isValidCodigo(codigo)) {
      return { ok: false, error: 'Código inválido. Debe ser una letra + 5 dígitos.' };
    }
    if (!Utils.isValidPin(pin)) {
      return { ok: false, error: 'El PIN debe ser de 6 dígitos numéricos.' };
    }
    if (!supabaseClient) {
      return { ok: false, error: 'No hay conexión al servidor. Revisa tu internet.' };
    }

    const email = Utils.codigoToEmail(codigo);

    // 1. Login contra Supabase Auth
    const { data: signInData, error: signInErr } = await supabaseClient.auth.signInWithPassword({
      email,
      password: pin,
    });

    if (signInErr) {
      Utils.log('Error de login:', signInErr);
      // Mensaje genérico por seguridad (no revelar si es usuario o pin)
      return { ok: false, error: 'Código o PIN incorrecto.' };
    }

    // 2. Obtener perfil desde tabla usuarios
    const userId = signInData.user.id;
    const { data: profile, error: profErr } = await supabaseClient
      .from('usuarios')
      .select('id, codigo, nombre, rol, activo, pin_cambiado')
      .eq('id', userId)
      .maybeSingle();

    if (profErr || !profile) {
      Utils.log('Error al obtener perfil:', profErr);
      await supabaseClient.auth.signOut();
      return { ok: false, error: 'Usuario sin perfil asignado. Contacta al administrador.' };
    }

    if (!profile.activo) {
      await supabaseClient.auth.signOut();
      return { ok: false, error: 'Tu cuenta está desactivada. Contacta al administrador.' };
    }

    // 3. Registrar sesión en tabla `sesiones`
    try {
      const { data: sesionData } = await supabaseClient
        .from('sesiones')
        .insert({
          usuario_id: userId,
          dispositivo: Utils.getDeviceSummary(),
          ip: null, // Supabase lo puede registrar por trigger si se desea; el cliente no lo conoce con fiabilidad
        })
        .select('id')
        .single();

      if (sesionData?.id) {
        localStorage.setItem('taller-sesion-id', String(sesionData.id));
      }
    } catch (e) {
      Utils.log('No se pudo registrar sesión (no crítico):', e);
    }

    // 4. Guardar perfil localmente para uso en las pantallas
    localStorage.setItem('taller-profile', JSON.stringify(profile));
    localStorage.setItem('taller-login-at', Date.now().toString());

    return { ok: true, profile };
  },

  /** Cierra sesión en Supabase y limpia datos locales */
  async logout() {
    // Cerrar sesión en tabla sesiones si hay id guardado
    const sesionId = localStorage.getItem('taller-sesion-id');
    if (sesionId && supabaseClient) {
      try {
        await supabaseClient
          .from('sesiones')
          .update({ hora_salida: new Date().toISOString() })
          .eq('id', parseInt(sesionId, 10));
      } catch (e) {
        Utils.log('No se pudo cerrar sesión en BD (no crítico):', e);
      }
    }

    // Signout en Supabase Auth
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }

    // Limpiar storage local
    localStorage.removeItem('taller-profile');
    localStorage.removeItem('taller-login-at');
    localStorage.removeItem('taller-sesion-id');

    // Redirigir a login
    window.location.href = './index.html';
  },

  /** Obtiene el perfil del usuario desde localStorage (sin hit a red) */
  getCurrentProfile() {
    const raw = localStorage.getItem('taller-profile');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  /** Verifica si la sesión expiró (>= CONFIG.SESSION_HOURS) */
  isSessionExpired() {
    const loginAt = localStorage.getItem('taller-login-at');
    if (!loginAt) return true;
    const elapsedMs = Date.now() - parseInt(loginAt, 10);
    const limitMs = CONFIG.SESSION_HOURS * 60 * 60 * 1000;
    return elapsedMs > limitMs;
  },

  /** Verifica sesión activa contra Supabase (llamado desde páginas internas) */
  async requireAuth() {
    if (!supabaseClient) {
      window.location.href = './index.html';
      return null;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = './index.html';
      return null;
    }

    if (this.isSessionExpired()) {
      await this.logout();
      return null;
    }

    return this.getCurrentProfile();
  },
};

/* ------------------------------------------------------------------
   Manejo del formulario de login (solo activo si existe en el DOM)
   ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  if (!form) return;

  const codigoInput = document.getElementById('codigo');
  const pinInput = document.getElementById('pin');
  const btn = document.getElementById('login-btn');

  // Auto-mayúsculas en código mientras escribe
  codigoInput.addEventListener('input', (e) => {
    const start = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(start, start);
  });

  // Solo dígitos en PIN (máx 6)
  pinInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    Utils.hideError('error-msg');
    btn.disabled = true;
    btn.classList.add('loading');

    try {
      const result = await Auth.login(codigoInput.value, pinInput.value);

      if (!result.ok) {
        Utils.showError('error-msg', result.error);
        btn.disabled = false;
        btn.classList.remove('loading');
        pinInput.value = '';
        pinInput.focus();
        return;
      }

      // Login exitoso: el router decide a dónde ir
      Router.redirectByRole(result.profile);

    } catch (err) {
      Utils.log('Excepción durante login:', err);
      Utils.showError('error-msg', 'Error inesperado. Intenta de nuevo.');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  // Auto-focus en código al cargar
  setTimeout(() => codigoInput.focus(), 150);

  // Verificar conectividad básica con Supabase
  checkConnection();
});

/** Verifica si Supabase responde y actualiza el indicador del footer */
async function checkConnection() {
  if (!supabaseClient) {
    Utils.updateConnectionStatus(false);
    return;
  }
  try {
    // Ping ligero: solo verificar que el cliente pueda hablar con el endpoint
    const { error } = await supabaseClient
      .from('categorias')
      .select('id')
      .limit(1);
    // Incluso si RLS lo bloquea, la conexión funcionó
    Utils.updateConnectionStatus(!error || error.code === 'PGRST301');
  } catch {
    Utils.updateConnectionStatus(false);
  }
}

// Monitor de online/offline del navegador
window.addEventListener('online', () => Utils.updateConnectionStatus(true));
window.addEventListener('offline', () => Utils.updateConnectionStatus(false));
