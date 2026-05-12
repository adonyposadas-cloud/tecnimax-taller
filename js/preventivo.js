/**
 * preventivo.js — Mantenimiento Preventivo · TECNIMAX Taller
 *
 * Muestra, por cada unidad de la flota, todos los servicios que se le han
 * realizado, la última vez que se hizo cada uno y los km acumulados desde
 * entonces (calculados con los registros de gps_km).
 *
 * Acceso: admin y jefe_pista.
 */

const Preventivo = {

  state: {
    profile: null,
    rpcData: [],     // resultado de resumen_km_preventivo(): { placa, servicio_id, ultima_fecha, km_desde, veces }
    ordenes: [],     // con join vehiculos — solo para obtener marca/modelo/año
    catalogo: [],    // catalogo_servicios — para nombres de servicio
    filtroPlaca: '',
    soloConGps: false,
    resumenFlota: [],
    expandidas: new Set(),
  },

  // ==================== INIT ====================
  async init() {
    Utils.log('Iniciando vista Preventivo...');

    // Mostrar estado de autenticación mientras verifica
    const loading = document.getElementById('prev-loading');
    if (loading) {
      loading.hidden = false;
      loading.innerHTML = `
        <div class="prev-spinner"></div>
        <div>Verificando sesión…</div>`;
    }

    const profile = await Auth.requireAuth();
    if (!profile) {
      if (loading) {
        loading.hidden = false;
        loading.innerHTML = `
          <p style="color:#fbbf24;text-align:center;font-size:0.9rem;">
            🔐 Sesión no activa.<br>
            <a href="admin.html" style="color:#5bc8f5;">Inicia sesión desde el panel</a>
          </p>`;
      }
      return;
    }

    if (!['admin', 'jefe_pista'].includes(profile.rol)) {
      alert('No tienes permisos para ver esta sección.');
      window.location.href = profile.rol === 'tecnico' ? 'tecnico.html' : 'admin.html';
      return;
    }

    this.state.profile = profile;
    document.getElementById('user-nombre-header').textContent = profile.nombre || 'Usuario';
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    if (profile.rol === 'jefe_pista') {
      const btnVolver = document.getElementById('btn-volver');
      if (btnVolver) btnVolver.href = 'jefe.html';
    }

    this.bindEventos();
    await this.cargarTodo();
    this.construirResumen();
    this.render();
  },

  // ==================== EVENTOS ====================
  bindEventos() {
    const inputPlaca = document.getElementById('prev-input-placa');
    if (inputPlaca) {
      let debounce;
      inputPlaca.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.state.filtroPlaca = e.target.value.trim().toLowerCase();
          this.render();
        }, 200);
      });
    }

    const toggleGps = document.getElementById('prev-toggle-gps');
    if (toggleGps) {
      toggleGps.addEventListener('change', (e) => {
        this.state.soloConGps = e.target.checked;
        this.render();
      });
    }
  },

  // ==================== CARGA ====================
  async cargarTodo() {
    const loading = document.getElementById('prev-loading');
    const main = document.getElementById('prev-main');
    if (loading) {
      loading.hidden = false;
      loading.innerHTML = `<div class="prev-spinner"></div><div>Cargando datos de flota…</div>`;
    }
    if (main) main.hidden = true;

    const timeoutId = setTimeout(() => {
      if (loading && !loading.hidden) {
        loading.innerHTML = `
          <p style="color:#ffc107;text-align:center;font-size:0.9rem;">
            ⏱ La carga está tardando más de lo esperado.<br>
            Revisa la consola (F12 → Console) para ver el error.
          </p>`;
      }
    }, 15000);

    try {
      const [rpcR, ordenesR, catalogoR] = await Promise.all([
        // RPC: toda la lógica de km se calcula en Postgres — escala sin límite
        supabaseClient.rpc('resumen_km_preventivo'),

        // Órdenes: solo para obtener marca/modelo/año de cada placa
        supabaseClient
          .from('ordenes')
          .select('placa, vehiculos(marca, modelo, anio)'),

        // Catálogo: nombres de servicios
        supabaseClient
          .from('catalogo_servicios')
          .select('id, nombre'),
      ]);

      clearTimeout(timeoutId);

      if (rpcR.error)     throw new Error(`RPC resumen_km_preventivo: ${rpcR.error.message}`);
      if (ordenesR.error) throw new Error(`ordenes: ${ordenesR.error.message}`);
      if (catalogoR.error) throw new Error(`catalogo_servicios: ${catalogoR.error.message}`);

      this.state.rpcData  = rpcR.data    || [];
      this.state.ordenes  = ordenesR.data || [];
      this.state.catalogo = catalogoR.data || [];

      Utils.log(`Preventivo cargado: ${this.state.rpcData.length} filas RPC, ${this.state.ordenes.length} órdenes.`);

    } catch (err) {
      clearTimeout(timeoutId);
      Utils.log('Error cargando preventivo:', err);
      if (loading) {
        loading.innerHTML = `
          <p style="color:#f87171;text-align:center;padding:20px;font-size:0.88rem;">
            ❌ Error: <strong>${Utils.escapeHtml(err.message || String(err))}</strong>
          </p>`;
        loading.hidden = false;
        if (main) main.hidden = true;
      }
      return;
    }

    if (loading) loading.hidden = true;
    if (main) main.hidden = false;
  },

  // ==================== CONSTRUCCIÓN DEL RESUMEN ====================
  /**
   * Agrupa los resultados del RPC por placa y arma la estructura de resumenFlota.
   * El cálculo de km_desde ya viene hecho desde Postgres — no hay lógica GPS aquí.
   */
  construirResumen() {
    // Mapa placa → info del vehículo (marca/modelo/año)
    const vehiculoPorPlaca = new Map();
    this.state.ordenes.forEach(o => {
      if (!vehiculoPorPlaca.has(o.placa) && o.vehiculos) {
        const v = o.vehiculos;
        vehiculoPorPlaca.set(o.placa, [v.marca, v.modelo, v.anio ? String(v.anio) : null]
          .filter(Boolean).join(' ') || '—');
      }
    });

    // Mapa placa → Map<servicio_id, row>
    const porPlaca = new Map();
    this.state.rpcData.forEach(row => {
      if (!porPlaca.has(row.placa)) porPlaca.set(row.placa, []);
      porPlaca.get(row.placa).push(row);
    });

    const resumen = [];
    porPlaca.forEach((filas, placa) => {
      const vehiculoTxt = vehiculoPorPlaca.get(placa) || '—';
      const tieneGps = filas.some(f => f.km_desde !== null && Number(f.km_desde) > 0);

      const serviciosArr = filas.map(f => {
        const cat = this.state.catalogo.find(c => String(c.id) === String(f.servicio_id));
        return {
          id: f.servicio_id,
          nombre: cat?.nombre || '(servicio eliminado)',
          ultimaFecha: f.ultima_fecha,
          kmDesde: f.km_desde !== null ? Number(f.km_desde) : null,
          vecesRealizado: Number(f.veces),
        };
      });

      // Mayor km primero, sin GPS al final
      serviciosArr.sort((a, b) => {
        if (a.kmDesde === null && b.kmDesde === null) return 0;
        if (a.kmDesde === null) return 1;
        if (b.kmDesde === null) return -1;
        return b.kmDesde - a.kmDesde;
      });

      resumen.push({ placa, vehiculoTxt, tieneGps, servicios: serviciosArr });
    });

    // Flota ordenada: vehículo con mayor km en su servicio más crítico arriba
    resumen.sort((a, b) => {
      const maxA = a.servicios.find(s => s.kmDesde !== null)?.kmDesde ?? -1;
      const maxB = b.servicios.find(s => s.kmDesde !== null)?.kmDesde ?? -1;
      return maxB - maxA;
    });

    this.state.resumenFlota = resumen;
    this.actualizarStats();
  },

  actualizarStats() {
    const totalVehiculos = document.getElementById('prev-stat-vehiculos');
    const totalServicios = document.getElementById('prev-stat-servicios');
    if (totalVehiculos) totalVehiculos.textContent = this.state.resumenFlota.length;
    if (totalServicios) {
      const tot = this.state.resumenFlota.reduce((s, v) => s + v.servicios.length, 0);
      totalServicios.textContent = tot;
    }
  },

  // ==================== RENDER ====================
  render() {
    const container = document.getElementById('prev-flota-list');
    if (!container) return;

    const filtro = this.state.filtroPlaca;
    let flota = this.state.resumenFlota;

    if (filtro) {
      flota = flota.filter(v => v.placa.toLowerCase().includes(filtro));
    }
    if (this.state.soloConGps) {
      flota = flota.filter(v => v.tieneGps);
    }

    const empty = document.getElementById('prev-empty');
    if (flota.length === 0) {
      container.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    container.innerHTML = flota.map(v => this.renderVehiculoCard(v)).join('');

    // Bind expand/collapse
    container.querySelectorAll('.prev-vehiculo-header').forEach(header => {
      header.addEventListener('click', () => {
        const placa = header.closest('.prev-vehiculo-card').dataset.placa;
        if (this.state.expandidas.has(placa)) {
          this.state.expandidas.delete(placa);
        } else {
          this.state.expandidas.add(placa);
        }
        this.render();
      });
    });
  },

  renderVehiculoCard(v) {
    const expandida = this.state.expandidas.has(v.placa);

    // Primer servicio con km (el de mayor km) para mostrarlo en el header
    const servicioDestacado = v.servicios.find(s => s.kmDesde !== null && s.kmDesde > 0);
    const kmMax = servicioDestacado?.kmDesde ?? null;

    let kmHeaderBadge = '';
    if (!v.tieneGps) {
      kmHeaderBadge = '<span class="prev-badge prev-badge-nogps">Sin GPS</span>';
    } else if (kmMax !== null) {
      kmHeaderBadge = `<span class="prev-badge prev-badge-km">📍 ${this.formatKm(kmMax)} en ${Utils.escapeHtml(servicioDestacado.nombre)}</span>`;
    }

    const serviciosHtml = expandida ? `
      <div class="prev-servicios-tabla">
        <div class="prev-servicios-header-row">
          <span>Servicio</span>
          <span>Última vez</span>
          <span>Km desde entonces</span>
          <span>Realizaciones</span>
        </div>
        ${v.servicios.map(s => this.renderServicioFila(s, v.tieneGps)).join('')}
      </div>` : '';

    return `
      <div class="prev-vehiculo-card${expandida ? ' expandida' : ''}" data-placa="${Utils.escapeHtml(v.placa)}">
        <div class="prev-vehiculo-header" role="button" tabindex="0">
          <div class="prev-vehiculo-info">
            <span class="prev-placa">${Utils.escapeHtml(v.placa)}</span>
            <span class="prev-vehiculo-txt">${Utils.escapeHtml(v.vehiculoTxt)}</span>
            ${kmHeaderBadge}
          </div>
          <div class="prev-vehiculo-right">
            <span class="prev-servicios-count">${v.servicios.length} tipo${v.servicios.length !== 1 ? 's' : ''} de servicio</span>
            <span class="prev-toggle-icon">${expandida ? '▲' : '▼'}</span>
          </div>
        </div>
        ${serviciosHtml}
      </div>
    `;
  },

  renderServicioFila(s, tieneGps) {
    const fecha = s.ultimaFecha ? this.formatFecha(s.ultimaFecha) : '—';

    let kmTxt = '—';
    let kmClass = '';
    if (!tieneGps) {
      kmTxt = '<span class="prev-sin-gps-txt">Sin datos GPS</span>';
    } else if (s.kmDesde !== null) {
      kmTxt = this.formatKm(s.kmDesde);
      // Colorear de mayor a menor urgencia (orientativo — sin umbrales fijos)
      if (s.kmDesde >= 10000) kmClass = 'prev-km-alto';
      else if (s.kmDesde >= 5000) kmClass = 'prev-km-medio';
      else kmClass = 'prev-km-bajo';
    }

    return `
      <div class="prev-servicio-fila">
        <span class="prev-servicio-nombre">${Utils.escapeHtml(s.nombre)}</span>
        <span class="prev-servicio-fecha">${fecha}</span>
        <span class="prev-servicio-km ${kmClass}">${kmTxt}</span>
        <span class="prev-servicio-veces">${s.vecesRealizado}×</span>
      </div>
    `;
  },

  // ==================== HELPERS ====================
  formatKm(km) {
    if (km === null || km === undefined) return '—';
    if (km < 1) return '< 1 km';
    return km.toLocaleString('es-HN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
  },

  formatFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    console.error('Supabase no inicializado');
    return;
  }
  Preventivo.init();
});
