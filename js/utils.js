/**
 * utils.js — Funciones utilitarias reutilizables
 */

const Utils = {
  /** Normaliza un código de usuario: mayúsculas, sin espacios */
  normalizeCodigo(codigo) {
    return (codigo || '').trim().toUpperCase();
  },

  /** Valida formato del código: letra + 5 dígitos */
  isValidCodigo(codigo) {
    return /^[A-Z][0-9]{5}$/.test(codigo || '');
  },

  /** Valida PIN: exactamente 6 dígitos */
  isValidPin(pin) {
    return /^[0-9]{6}$/.test(pin || '');
  },

  /**
   * Construye el email sintético que usa Supabase Auth internamente.
   * IMPORTANTE: Supabase Auth normaliza emails a minúsculas automáticamente,
   * por eso enviamos en minúscula aunque el código en tabla usuarios sea mayúscula.
   */
  codigoToEmail(codigo) {
    return this.normalizeCodigo(codigo).toLowerCase() + CONFIG.AUTH_EMAIL_DOMAIN;
  },

  /** Resumen del dispositivo (para tabla sesiones) */
  getDeviceSummary() {
    const ua = navigator.userAgent;
    // Detección básica y resumida
    let device = 'Desktop';
    if (/Android/i.test(ua)) device = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) device = 'iOS';
    else if (/Windows Phone/i.test(ua)) device = 'WindowsPhone';

    let browser = 'Otro';
    if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Edg/i.test(ua)) browser = 'Edge';

    return `${device} / ${browser}`;
  },

  /** Muestra mensaje de error con animación */
  showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    // Reiniciar animación
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  },

  /** Oculta mensaje de error */
  hideError(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.hidden = true;
  },

  /** Actualiza el estado de conexión visible en el footer */
  updateConnectionStatus(online) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    el.classList.toggle('online', online);
    el.classList.toggle('offline', !online);
    const text = el.querySelector('.status-text');
    if (text) text.textContent = online ? 'Conectado' : 'Sin conexión';
  },

  /** Escapa texto para insertar en HTML de forma segura */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  },

  /** Debounce simple */
  debounce(fn, delay = 200) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  },

  /** Pequeño helper para esperar ms */
  sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  },

  /** Log estructurado */
  log(...args) {
    if (CONFIG.DEBUG) console.log('[Taller]', ...args);
  },
};
